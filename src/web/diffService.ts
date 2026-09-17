import * as vscode from 'vscode';
import { getGitConfiguration } from './configuration';
import {
  GitClient,
  GitCommit,
  GitRepository,
  getRepositoryRelativePath,
} from './gitClient';
import {
  GitHubClient,
  GitHubCommit,
  GitHubDocumentRef,
  GitHubTag,
} from './githubClient';
import { PullRequestService, getPullRequestBaseBaseline } from './pullRequestService';
import { parseVersion, sortByVersionDescending, Version } from './semver';

const gitTagRefType = 2;
const maxLogEntries = 64;
const maxTagHistoryEntries = 256;

export type DiffBaselineSelection =
  | DiffTagSelection
  | DiffCommitSelection
  | DiffFileSelection;

export interface DiffTagSelection {
  readonly kind: 'tag';
  readonly ref: string;
}

export interface DiffCommitSelection {
  readonly kind: 'commit';
  readonly ref: string;
}

export interface DiffFileSelection {
  readonly kind: 'file';
  readonly uri: string;
}

export interface DiffCandidate {
  readonly baseline: DiffBaselineSelection;
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
}

export interface DiffAvailability {
  readonly candidates: readonly DiffCandidate[];
  readonly defaultBaseline?: DiffBaselineSelection;
  readonly canPickFile: boolean;
}

export interface ResolvedBaseline {
  readonly baseline: DiffBaselineSelection;
  readonly label: string;
  readonly markdown: string;
}

export interface TagCandidate {
  readonly candidate: DiffCandidate;
  readonly version: Version;
  readonly commit?: string;
}

interface TagVersionPattern {
  readonly expression: RegExp;
}

interface CargoPackageMetadata {
  readonly name?: string;
}

export class DiffService {
  private readonly availabilityCache = new Map<string, Promise<DiffAvailability>>();

  public constructor(
    private readonly logger: vscode.LogOutputChannel,
    private readonly githubClient: GitHubClient,
    private readonly gitClient: GitClient,
    private readonly pullRequestService: PullRequestService,
  ) { }

  public invalidate(uri?: vscode.Uri): void {
    if (uri) {
      this.availabilityCache.delete(uri.toString());
      return;
    }

    this.availabilityCache.clear();
  }

  public async getAvailability(
    document: vscode.TextDocument,
    options?: { readonly promptForGitHubAuth?: boolean },
  ): Promise<DiffAvailability> {
    const key = document.uri.toString();
    const shouldPrompt = options?.promptForGitHubAuth === true;

    if (shouldPrompt) {
      return this.loadAvailability(document, shouldPrompt);
    }

    let cached = this.availabilityCache.get(key);
    if (!cached) {
      cached = this.loadAvailability(document, false);
      this.availabilityCache.set(key, cached);
    }
    return cached;
  }

  public async resolveBaseline(
    document: vscode.TextDocument,
    baseline: DiffBaselineSelection,
  ): Promise<ResolvedBaseline> {
    switch (baseline.kind) {
      case 'file': {
        const uri = vscode.Uri.parse(baseline.uri);
        return {
          baseline,
          label: getFileBaselineLabel(uri),
          markdown: await readText(uri),
        };
      }

      case 'tag':
      case 'commit': {
        const repository = await this.gitClient.getRepository(document.uri);
        if (repository) {
          const relativePath = getRepositoryRelativePath(document.uri, repository.rootUri);
          if (relativePath) {
            return {
              baseline,
              label: formatBaselineLabel(document.uri, baseline),
              markdown: await repository.show(baseline.ref, relativePath),
            };
          }
        }

        const githubDocument = this.githubClient.resolveDocument(document.uri);
        const markdown = githubDocument
          ? await this.githubClient.getFileContent({
            repository: githubDocument.repository,
            ref: baseline.ref,
            path: githubDocument.path,
            promptForAuth: true,
          })
          : undefined;
        if (markdown === undefined) {
          throw new Error('Git history is unavailable for this document.');
        }
        return {
          baseline,
          label: formatBaselineLabel(document.uri, baseline),
          markdown,
        };
      }
    }
  }

  private async loadAvailability(
    document: vscode.TextDocument,
    promptForGitHubAuth: boolean,
  ): Promise<DiffAvailability> {
    const repository = await this.gitClient.getRepository(document.uri);
    const canPickFile = true;
    if (!repository) {
      const githubDocument = this.githubClient.resolveDocument(document.uri);
      return githubDocument
        ? this.loadGitHubAvailability(document, githubDocument, promptForGitHubAuth)
        : { candidates: [], canPickFile };
    }

    const relativePath = getRepositoryRelativePath(document.uri, repository.rootUri);
    if (!relativePath) {
      return { candidates: [], canPickFile };
    }

    const currentPackage = await getCurrentPackageMetadata(document.uri, repository.rootUri);
    const [commits, history] = await Promise.all([
      repository.log({ path: relativePath, maxEntries: maxLogEntries }),
      repository.log({ maxEntries: maxTagHistoryEntries }),
    ]);
    const tagCandidates = await this.getTagCandidates(
      document.uri,
      repository,
      relativePath,
      currentPackage.name,
      createCommitDetailsByHash([...history, ...commits]),
    );
    const taggedCommits = new Set(tagCandidates.map(candidate => candidate.commit).filter(isDefined));
    const headCommit = repository.state.HEAD?.commit;
    const commitCandidates = commits
      .filter(commit => commit.hash !== headCommit && !taggedCommits.has(commit.hash))
      .map(commit => ({
        baseline: { kind: 'commit', ref: commit.hash } as const,
        label: shortSha(commit.hash),
        description: commit.commitDate ? formatCommitDate(commit.commitDate) : undefined,
        detail: getDisplayDetail(commit.message),
      }));

    const pullRequestBase = await this.getPullRequestBase(
      document,
      repository,
      relativePath,
      tagCandidates,
      promptForGitHubAuth,
    );
    const candidates = [
      ...tagCandidates.map(candidate => candidate.candidate),
      ...commitCandidates,
    ];

    return {
      candidates,
      defaultBaseline: selectDefaultBaseline(
        tagCandidates,
        commitCandidates,
        pullRequestBase,
      ),
      canPickFile,
    };
  }

  private async loadGitHubAvailability(
    previewDocument: vscode.TextDocument,
    githubDocument: GitHubDocumentRef,
    promptForGitHubAuth: boolean,
  ): Promise<DiffAvailability> {
    const pullRequestContext = await this.pullRequestService.getContext(previewDocument, { promptForGitHubAuth });
    const historyDocument = pullRequestContext
      ? { ...githubDocument, ref: pullRequestContext.pullRequest.headSha }
      : githubDocument;
    const [tagsResult, commitsResult, headCommitResult] = await Promise.allSettled([
      this.githubClient.getTags({
        repository: githubDocument.repository,
        promptForAuth: promptForGitHubAuth,
      }),
      this.githubClient.getCommits({
        repository: historyDocument.repository,
        ref: historyDocument.ref,
        path: historyDocument.path,
        maxEntries: maxLogEntries,
        promptForAuth: promptForGitHubAuth,
      }),
      this.githubClient.getCommit({
        repository: historyDocument.repository,
        ref: historyDocument.ref,
        promptForAuth: promptForGitHubAuth,
      }),
    ]);

    try {
      const tags = settledValue(tagsResult, error => {
        this.logger.warn(`Unable to load GitHub tags for ${previewDocument.uri.toString()}: ${formatError(error)}`);
        return [];
      });
      const commits = settledValue(commitsResult, error => {
        this.logger.warn(`Unable to load GitHub commits for ${previewDocument.uri.toString()}: ${formatError(error)}`);
        return [];
      });
      const headCommit = settledValue(headCommitResult, error => {
        this.logger.warn(`Unable to load GitHub head commit for ${previewDocument.uri.toString()}: ${formatError(error)}`);
        return undefined;
      });
      const tagCandidates = await this.getGitHubTagCandidates(
        previewDocument.uri,
        githubDocument,
        tags ?? [],
        promptForGitHubAuth,
      );
      const taggedCommits = new Set(tagCandidates.map(candidate => candidate.commit).filter(isDefined));
      const commitCandidates = (commits ?? [])
        .filter(commit => commit.hash !== headCommit?.hash && !taggedCommits.has(commit.hash))
        .map(commit => ({
          baseline: { kind: 'commit', ref: commit.hash } as const,
          label: shortSha(commit.hash),
          description: commit.committedAt ? formatCommitDate(commit.committedAt) : undefined,
          detail: getDisplayDetail(commit.message),
        }));
      const pullRequestBase = await this.getGitHubPullRequestBase(
        historyDocument,
        tagCandidates,
        promptForGitHubAuth,
        pullRequestContext?.pullRequest,
      );

      return {
        candidates: [...tagCandidates.map(candidate => candidate.candidate), ...commitCandidates],
        defaultBaseline: selectDefaultBaseline(tagCandidates, commitCandidates, pullRequestBase),
        canPickFile: true,
      };
    } catch (error) {
      this.logger.warn(`Unable to load GitHub history for ${previewDocument.uri.toString()}: ${formatError(error)}`);
      return { candidates: [], canPickFile: true };
    }
  }

  private async getGitHubTagCandidates(
    documentUri: vscode.Uri,
    document: GitHubDocumentRef,
    tags: readonly GitHubTag[],
    promptForGitHubAuth: boolean,
  ): Promise<readonly TagCandidate[]> {
    const patterns = getTagVersionPatterns(documentUri, this.logger);
    const candidates = await Promise.all(tags.map(async tag => {
      const version = parseConfiguredTagVersion(tag.name, patterns);
      if (!version) {
        return undefined;
      }

      try {
        const markdown = await this.githubClient.getFileContent({
          repository: document.repository,
          ref: tag.name,
          path: document.path,
          promptForAuth: promptForGitHubAuth,
        });
        if (markdown === undefined) {
          return undefined;
        }
      } catch {
        return undefined;
      }

      const commit = await this.getGitHubCommitDetails(document.repository, tag.commit, promptForGitHubAuth);

      return {
        candidate: {
          baseline: { kind: 'tag', ref: tag.name } as const,
          label: version.raw,
          description: commit?.committedAt ? formatCommitDate(commit.committedAt) : undefined,
          detail: getDisplayDetail(commit?.message),
        },
        version,
        commit: tag.commit,
      } satisfies TagCandidate;
    }));

    return sortByVersionDescending(candidates.filter(isDefined));
  }

  private async getGitHubPullRequestBase(
    document: GitHubDocumentRef,
    tagCandidates: readonly TagCandidate[],
    promptForGitHubAuth: boolean,
    resolvedPullRequest?: { readonly baseSha: string; readonly baseRef: string },
  ): Promise<DiffBaselineSelection | undefined> {
    if (looksLikeFullCommitSha(document.ref) && !resolvedPullRequest) {
      return undefined;
    }

    const pullRequest = resolvedPullRequest ?? await this.githubClient.getPullRequestBase({
        repository: document.repository,
        branch: document.ref,
        headOwner: document.repository.owner,
        promptForAuth: promptForGitHubAuth,
    });
    if (!pullRequest) {
      return undefined;
    }

    const taggedBase = tagCandidates.find(candidate => candidate.commit === pullRequest.baseSha);
    if (taggedBase) {
      return taggedBase.candidate.baseline;
    }

    const markdown = await this.githubClient.getFileContent({
      repository: document.repository,
      ref: pullRequest.baseSha,
      path: document.path,
      promptForAuth: promptForGitHubAuth,
    });
    return markdown === undefined ? undefined : { kind: 'commit', ref: pullRequest.baseSha };
  }

  private async getTagCandidates(
    documentUri: vscode.Uri,
    repository: GitRepository,
    relativePath: string,
    packageName: string | undefined,
    commitDetails: ReadonlyMap<string, GitCommit>,
  ): Promise<readonly TagCandidate[]> {
    const refs = await repository.getRefs({ sort: 'creatordate' });
    const patterns = getTagVersionPatterns(documentUri, this.logger);
    const candidates: TagCandidate[] = [];

    for (const ref of refs) {
      if (ref.type !== gitTagRefType || !ref.name) {
        continue;
      }

      const version = parseConfiguredTagVersion(ref.name, patterns);
      if (!version) {
        continue;
      }
      if (packageName && !matchesPackageTag(ref.name, packageName)) {
        continue;
      }

      try {
        await repository.show(ref.name, relativePath);
      } catch {
        continue;
      }

      const tagCommit = ref.commit ? commitDetails.get(ref.commit) : undefined;

      candidates.push({
        candidate: {
          baseline: { kind: 'tag', ref: ref.name },
          label: version.raw,
          description: tagCommit?.commitDate ? formatCommitDate(tagCommit.commitDate) : undefined,
          detail: getDisplayDetail(tagCommit?.message),
        },
        version,
        commit: ref.commit,
      });
    }

    return sortByVersionDescending(candidates);
  }

  private async getGitHubCommitDetails(
    repository: GitHubDocumentRef['repository'],
    ref: string,
    promptForAuth: boolean,
  ): Promise<GitHubCommit | undefined> {
    try {
      return await this.githubClient.getCommit({ repository, ref, promptForAuth });
    } catch (error) {
      this.logger.warn(`Unable to load GitHub commit ${ref}: ${formatError(error)}`);
      return undefined;
    }
  }

  private async getPullRequestBase(
    document: vscode.TextDocument,
    repository: GitRepository,
    relativePath: string,
    tagCandidates: readonly TagCandidate[],
    promptForGitHubAuth: boolean,
  ): Promise<DiffBaselineSelection | undefined> {
    const pullRequestContext = await this.pullRequestService.getContext(document, { promptForGitHubAuth });
    if (!pullRequestContext) {
      return undefined;
    }

    try {
      return await getPullRequestBaseBaseline(repository, relativePath, pullRequestContext, tagCandidates);
    } catch (error) {
      const branch = pullRequestContext.document.ref;
      this.logger.warn(`Unable to resolve pull request base for ${branch}: ${formatError(error)}`);
      return undefined;
    }
  }
}

function looksLikeFullCommitSha(ref: string): boolean {
  return /^[0-9a-f]{40}$/iu.test(ref);
}

async function getCurrentPackageMetadata(
  documentUri: vscode.Uri,
  repositoryRoot: vscode.Uri,
): Promise<CargoPackageMetadata> {
  const cargoToml = await findNearestFile(documentUri, repositoryRoot, 'Cargo.toml');
  if (!cargoToml) {
    return {};
  }

  return parseCargoPackage(await readText(cargoToml));
}

async function findNearestFile(
  documentUri: vscode.Uri,
  rootUri: vscode.Uri,
  fileName: string,
): Promise<vscode.Uri | undefined> {
  let currentPath = documentUri.path.slice(0, documentUri.path.lastIndexOf('/'));
  const rootPath = rootUri.path.replace(/\/$/, '');

  while (currentPath.startsWith(rootPath)) {
    const candidate = documentUri.with({ path: `${currentPath}/${fileName}` });
    if (await exists(candidate)) {
      return candidate;
    }
    if (currentPath === rootPath) {
      break;
    }
    currentPath = currentPath.slice(0, currentPath.lastIndexOf('/'));
  }

  return undefined;
}

function parseCargoPackage(content: string): CargoPackageMetadata {
  let inPackage = false;
  let name: string | undefined;

  for (const line of content.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      inPackage = section[1] === 'package';
      continue;
    }
    if (!inPackage) {
      continue;
    }

    const packageName = line.match(/^\s*name\s*=\s*"([^"]+)"\s*$/);
    if (packageName) {
      name = packageName[1];
    }
  }

  return { name };
}

function matchesPackageTag(tagName: string, packageName: string): boolean {
  const separator = tagName.lastIndexOf('@');
  if (separator < 0) {
    return true;
  }

  return normalizePackageTagName(tagName.slice(0, separator)) === normalizePackageTagName(packageName);
}

function normalizePackageTagName(value: string): string {
  return value.replace(/[-_]+/g, '_').toLowerCase();
}

function formatBaselineLabel(documentUri: vscode.Uri, baseline: DiffBaselineSelection): string {
  switch (baseline.kind) {
    case 'tag': {
      const version = parseConfiguredTagVersion(baseline.ref, getTagVersionPatterns(documentUri));
      return version?.raw ?? baseline.ref;
    }

    case 'commit':
      return shortSha(baseline.ref);

    case 'file':
      return baseline.uri;
  }
}

export function selectDefaultBaseline(
  tagCandidates: readonly TagCandidate[],
  commitCandidates: readonly DiffCandidate[],
  pullRequestBase: DiffBaselineSelection | undefined,
): DiffBaselineSelection | undefined {
  if (pullRequestBase) {
    return pullRequestBase;
  }

  return tagCandidates[0]?.candidate.baseline ?? commitCandidates[0]?.baseline;
}

export function parseConfiguredTagVersion(
  tagName: string,
  patterns: readonly TagVersionPattern[],
): Version | undefined {
  for (const pattern of patterns) {
    const match = pattern.expression.exec(tagName);
    if (!match) {
      continue;
    }

    const version = typeof match.groups?.version === 'string' && match.groups.version.length > 0
      ? match.groups.version
      : match[1];
    if (!version) {
      continue;
    }

    const parsed = parseVersion(version);
    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function getLabelForUri(uri: vscode.Uri): string {
  return uri.path.slice(uri.path.lastIndexOf('/') + 1) || uri.toString();
}

export function getFileBaselineLabel(uri: vscode.Uri): string {
  const parts = uri.path.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }

  return getLabelForUri(uri);
}

function shortSha(commit: string): string {
  return commit.slice(0, 8);
}

function getDisplayDetail(message: string | undefined): string | undefined {
  if (!message) {
    return undefined;
  }

  for (const line of message.split(/\r?\n/u)) {
    if (line.startsWith('----- BEGIN')) {
      return undefined;
    }
    if (line.trim().length > 0) {
      return line;
    }
  }

  return undefined;
}

function settledValue<T>(
  result: PromiseSettledResult<T>,
  onRejected: (reason: unknown) => T,
): T {
  return result.status === 'fulfilled' ? result.value : onRejected(result.reason);
}

function formatCommitDate(date: Date | string): string {
  return (typeof date === 'string' ? date : date.toISOString()).slice(0, 10);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function createCommitDetailsByHash(commits: readonly GitCommit[]): ReadonlyMap<string, GitCommit> {
  const values = new Map<string, GitCommit>();
  for (const commit of commits) {
    if (!values.has(commit.hash)) {
      values.set(commit.hash, commit);
    }
  }
  return values;
}

function getTagVersionPatterns(
  scope: vscode.Uri,
  output?: vscode.LogOutputChannel,
): readonly TagVersionPattern[] {
  const patterns: TagVersionPattern[] = [];

  for (const value of getGitConfiguration(scope).tags) {
    try {
      patterns.push({ expression: new RegExp(value, 'u') });
    } catch (error) {
      output?.warn(`Ignoring invalid tag regex "${value}": ${formatError(error)}`);
    }
  }

  return patterns;
}
