import * as vscode from 'vscode';
import { getGitConfiguration } from './configuration';
import {
  GitClient,
  GitCommit,
  GitRef,
  GitRemote,
  GitRepository,
  GitRepositoryState,
  getRepositoryRelativePath,
} from './gitClient';
import {
  GitHubClient,
  GitHubDocumentRef,
  GitHubTag,
  parseGitHubRepository,
} from './githubClient';

const gitTagRefType = 2;
const maxLogEntries = 64;

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

export interface ParsedVersion {
  readonly raw: string;
  readonly normalized: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
}

export interface TagCandidate {
  readonly candidate: DiffCandidate;
  readonly version: ParsedVersion;
  readonly commit?: string;
}

interface TagVersionPattern {
  readonly expression: RegExp;
}

interface CargoPackageMetadata {
  readonly name?: string;
  readonly version?: string;
}

export class DisplayDiffService {
  private readonly availabilityCache = new Map<string, Promise<DiffAvailability>>();

  public constructor(
    private readonly output: vscode.OutputChannel,
    private readonly githubClient: GitHubClient,
    private readonly gitClient: GitClient,
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
        ? this.loadGitHubAvailability(document.uri, githubDocument, promptForGitHubAuth)
        : { candidates: [], canPickFile };
    }

    const relativePath = getRepositoryRelativePath(document.uri, repository.rootUri);
    if (!relativePath) {
      return { candidates: [], canPickFile };
    }

    const currentPackage = await getCurrentPackageMetadata(document.uri, repository.rootUri);
    const commits = await repository.log({ path: relativePath, maxEntries: maxLogEntries });
    const tagCandidates = await this.getTagCandidates(document.uri, repository, relativePath, currentPackage.name);
    const taggedCommits = new Set(tagCandidates.map(candidate => candidate.commit).filter(isDefined));
    const commitCandidates = commits
      .filter(commit => !taggedCommits.has(commit.hash))
      .map(commit => ({
        baseline: { kind: 'commit', ref: commit.hash } as const,
        label: shortSha(commit.hash),
        description: commit.commitDate ? formatCommitDate(commit.commitDate) : undefined,
        detail: firstLine(commit.message),
      }));

    const pullRequestBase = await this.getPullRequestBase(repository, relativePath, tagCandidates, promptForGitHubAuth);
    const candidates = [
      ...tagCandidates.map(candidate => candidate.candidate),
      ...commitCandidates,
    ];

    return {
      candidates,
      defaultBaseline: selectDefaultBaseline(
        tagCandidates,
        commitCandidates,
        currentPackage.version ? parseVersion(currentPackage.version) : undefined,
        pullRequestBase,
      ),
      canPickFile,
    };
  }

  private async loadGitHubAvailability(
    documentUri: vscode.Uri,
    document: GitHubDocumentRef,
    promptForGitHubAuth: boolean,
  ): Promise<DiffAvailability> {
    const [tagsResult, commitsResult] = await Promise.allSettled([
      this.githubClient.getTags({
        repository: document.repository,
        promptForAuth: promptForGitHubAuth,
      }),
      this.githubClient.getCommits({
        repository: document.repository,
        ref: document.ref,
        path: document.path,
        maxEntries: maxLogEntries,
        promptForAuth: promptForGitHubAuth,
      }),
    ]);

    try {
      const tags = settledValue(tagsResult, error => {
        this.output.appendLine(`Unable to load GitHub tags for ${documentUri.toString()}: ${formatError(error)}`);
        return [];
      });
      const commits = settledValue(commitsResult, error => {
        this.output.appendLine(`Unable to load GitHub commits for ${documentUri.toString()}: ${formatError(error)}`);
        return [];
      });
      const tagCandidates = await this.getGitHubTagCandidates(documentUri, document, tags ?? [], promptForGitHubAuth);
      const taggedCommits = new Set(tagCandidates.map(candidate => candidate.commit).filter(isDefined));
      const commitCandidates = (commits ?? [])
        .filter(commit => !taggedCommits.has(commit.hash))
        .map(commit => ({
          baseline: { kind: 'commit', ref: commit.hash } as const,
          label: shortSha(commit.hash),
          description: commit.committedAt ? formatCommitDate(commit.committedAt) : undefined,
          detail: firstLine(commit.message),
        }));
      const pullRequestBase = await this.getGitHubPullRequestBase(
        document,
        tagCandidates,
        promptForGitHubAuth,
      );

      return {
        candidates: [...tagCandidates.map(candidate => candidate.candidate), ...commitCandidates],
        defaultBaseline: selectDefaultBaseline(tagCandidates, commitCandidates, undefined, pullRequestBase),
        canPickFile: true,
      };
    } catch (error) {
      this.output.appendLine(`Unable to load GitHub history for ${documentUri.toString()}: ${formatError(error)}`);
      return { candidates: [], canPickFile: true };
    }
  }

  private async getGitHubTagCandidates(
    documentUri: vscode.Uri,
    document: GitHubDocumentRef,
    tags: readonly GitHubTag[],
    promptForGitHubAuth: boolean,
  ): Promise<readonly TagCandidate[]> {
    const patterns = getTagVersionPatterns(documentUri, this.output);
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

      return {
        candidate: {
          baseline: { kind: 'tag', ref: tag.name } as const,
          label: version.raw,
        },
        version,
        commit: tag.commit,
      } satisfies TagCandidate;
    }));

    return candidates
      .filter(isDefined)
      .sort((left, right) => compareVersions(right.version, left.version));
  }

  private async getGitHubPullRequestBase(
    document: GitHubDocumentRef,
    tagCandidates: readonly TagCandidate[],
    promptForGitHubAuth: boolean,
  ): Promise<DiffBaselineSelection | undefined> {
    if (/^[0-9a-f]{40}$/iu.test(document.ref)) {
      return undefined;
    }

    const pullRequest = await this.githubClient.getPullRequestBase({
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
  ): Promise<readonly TagCandidate[]> {
    const refs = await repository.getRefs({ sort: 'creatordate' });
    const patterns = getTagVersionPatterns(documentUri, this.output);
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

      candidates.push({
        candidate: {
          baseline: { kind: 'tag', ref: ref.name },
          label: version.raw,
        },
        version,
        commit: ref.commit,
      });
    }

    return candidates.sort((left, right) => compareVersions(right.version, left.version));
  }

  private async getPullRequestBase(
    repository: GitRepository,
    relativePath: string,
    tagCandidates: readonly TagCandidate[],
    promptForGitHubAuth: boolean,
  ): Promise<DiffBaselineSelection | undefined> {
    const branch = repository.state.HEAD?.name;
    const remote = getPreferredRemote(repository.state);
    if (!branch || !remote) {
      return undefined;
    }

    const githubRepository = parseGitHubRepository(remote.fetchUrl ?? remote.pushUrl);
    if (!githubRepository) {
      return undefined;
    }

    try {
      const pullRequest = await this.githubClient.getPullRequestBase({
        repository: githubRepository,
        branch,
        headOwner: githubRepository.owner,
        promptForAuth: promptForGitHubAuth,
      });
      if (!pullRequest) {
        return undefined;
      }

      const taggedBase = tagCandidates.find(candidate => candidate.commit === pullRequest.baseSha);
      if (taggedBase) {
        return taggedBase.candidate.baseline;
      }

      await repository.show(pullRequest.baseSha, relativePath);
      return { kind: 'commit', ref: pullRequest.baseSha };
    } catch (error) {
      this.output.appendLine(`Unable to resolve pull request base for ${branch}: ${formatError(error)}`);
      return undefined;
    }
  }
}

function getPreferredRemote(state: GitRepositoryState): GitRemote | undefined {
  const upstreamRemote = state.HEAD?.upstream?.remote;
  if (upstreamRemote) {
    const match = state.remotes.find(remote => remote.name === upstreamRemote);
    if (match) {
      return match;
    }
  }

  return state.remotes.find(remote => parseGitHubRepository(remote.fetchUrl ?? remote.pushUrl) !== undefined);
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

export function parseCargoVersion(content: string): string | undefined {
  return parseCargoPackage(content).version;
}

function parseCargoPackage(content: string): CargoPackageMetadata {
  let inPackage = false;
  let name: string | undefined;
  let version: string | undefined;

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
      continue;
    }

    const packageVersion = line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/);
    if (packageVersion) {
      version = packageVersion[1];
    }
  }

  return { name, version };
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
  currentVersion: ParsedVersion | undefined,
  pullRequestBase: DiffBaselineSelection | undefined,
): DiffBaselineSelection | undefined {
  if (pullRequestBase) {
    return pullRequestBase;
  }

  const stableTags = tagCandidates.filter(candidate => isStableVersion(candidate.version));
  const unstableTags = tagCandidates.filter(candidate => isUnstableVersion(candidate.version));

  if (currentVersion) {
    if (isBetaVersion(currentVersion)) {
      const previousBeta = tagCandidates.find(candidate =>
        sameRelease(candidate.version, currentVersion)
        && isBetaVersion(candidate.version)
        && compareVersions(candidate.version, currentVersion) < 0,
      );
      if (previousBeta) {
        return previousBeta.candidate.baseline;
      }
    }

    if (!isUnstableVersion(currentVersion)) {
      const previousStable = stableTags.find(candidate => compareVersions(candidate.version, currentVersion) < 0);
      if (previousStable) {
        return previousStable.candidate.baseline;
      }
    }

    const previousUnstable = unstableTags.find(candidate => compareVersions(candidate.version, currentVersion) < 0);
    if (previousUnstable) {
      return previousUnstable.candidate.baseline;
    }
  }

  return tagCandidates[0]?.candidate.baseline ?? commitCandidates[0]?.baseline;
}

export function parseVersion(value: string): ParsedVersion | undefined {
  const normalized = value.trim().replace(/^v/i, '');
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/u);
  if (!match) {
    return undefined;
  }

  return {
    raw: value,
    normalized,
    major: Number(match[1]),
    minor: Number(match[2] ?? '0'),
    patch: Number(match[3] ?? '0'),
    prerelease: parsePrerelease(match[4]),
  };
}

export function parseConfiguredTagVersion(
  tagName: string,
  patterns: readonly TagVersionPattern[],
): ParsedVersion | undefined {
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

function parsePrerelease(value: string | undefined): readonly (string | number)[] {
  if (!value) {
    return [];
  }

  return value.split('.').map(part => /^\d+$/u.test(part) ? Number(part) : part.toLowerCase());
}

export function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  const release = compareRelease(left, right);
  if (release !== 0) {
    return release;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }
  if (left.prerelease.length === 0) {
    return 1;
  }
  if (right.prerelease.length === 0) {
    return -1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      if (leftPart !== rightPart) {
        return leftPart - rightPart;
      }
      continue;
    }
    if (typeof leftPart === 'number') {
      return -1;
    }
    if (typeof rightPart === 'number') {
      return 1;
    }
    const comparison = leftPart.localeCompare(rightPart);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function compareRelease(left: ParsedVersion, right: ParsedVersion): number {
  return left.major - right.major
    || left.minor - right.minor
    || left.patch - right.patch;
}

function sameRelease(left: ParsedVersion, right: ParsedVersion): boolean {
  return compareRelease(left, right) === 0;
}

export function isBetaVersion(version: ParsedVersion): boolean {
  return version.prerelease.some(part => part === 'beta');
}

export function isStableVersion(version: ParsedVersion): boolean {
  return version.major > 0 && version.prerelease.length === 0;
}

export function isUnstableVersion(version: ParsedVersion): boolean {
  return version.major === 0;
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

function firstLine(message: string): string {
  return message.split(/\r?\n/u, 1)[0] ?? message;
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

function getTagVersionPatterns(
  scope: vscode.Uri,
  output?: vscode.OutputChannel,
): readonly TagVersionPattern[] {
  const patterns: TagVersionPattern[] = [];

  for (const value of getGitConfiguration(scope).tags) {
    try {
      patterns.push({ expression: new RegExp(value, 'u') });
    } catch (error) {
      output?.appendLine(`Ignoring invalid tag regex "${value}": ${formatError(error)}`);
    }
  }

  return patterns;
}
