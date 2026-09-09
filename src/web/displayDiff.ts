import * as vscode from 'vscode';
import { getGitConfiguration } from './configuration';

const gitApiVersion = 1;
const gitTagRefType = 2;
const githubAuthenticationProvider = 'github';
const githubAuthenticationExtension = 'vscode.github-authentication';
const githubAuthScopes = ['repo'];
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

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

interface GitApi {
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  getRefs(query: { pattern?: string | string[]; sort?: 'alphabetically' | 'committerdate' | 'creatordate' }): Promise<GitRef[]>;
  log(options?: { readonly maxEntries?: number; readonly path?: string }): Promise<GitCommit[]>;
  show(ref: string, path: string): Promise<string>;
}

interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  readonly remotes: readonly GitRemote[];
}

interface GitBranch {
  readonly name?: string;
  readonly upstream?: GitUpstreamRef;
}

interface GitUpstreamRef {
  readonly remote: string;
  readonly name: string;
}

interface GitRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

interface GitRef {
  readonly type: number;
  readonly name?: string;
  readonly commit?: string;
}

interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly commitDate?: Date;
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

interface PullRequestBase {
  readonly sha: string;
  readonly baseRef: string;
  readonly title: string;
}

interface CargoPackageMetadata {
  readonly name?: string;
  readonly version?: string;
}

export class DisplayDiffService {
  private readonly availabilityCache = new Map<string, Promise<DiffAvailability>>();

  public constructor(private readonly output: vscode.OutputChannel) { }

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
        const repository = await getGitRepository(document.uri);
        if (!repository) {
          throw new Error('Git history is unavailable for this document.');
        }

        const relativePath = getRepositoryRelativePath(document.uri, repository.rootUri);
        if (!relativePath) {
          throw new Error('The current document is not located under the repository root.');
        }

        return {
          baseline,
          label: formatBaselineLabel(document.uri, baseline),
          markdown: await repository.show(baseline.ref, relativePath),
        };
      }
    }
  }

  private async loadAvailability(
    document: vscode.TextDocument,
    promptForGitHubAuth: boolean,
  ): Promise<DiffAvailability> {
    const repository = await getGitRepository(document.uri);
    const canPickFile = true;
    if (!repository) {
      return { candidates: [], canPickFile };
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

    const session = await getGitHubSession(promptForGitHubAuth);
    if (!session) {
      return undefined;
    }

    try {
      const pullRequest = await loadPullRequestBase(session.accessToken, githubRepository.owner, githubRepository.repo, branch);
      if (!pullRequest) {
        return undefined;
      }

      const taggedBase = tagCandidates.find(candidate => candidate.commit === pullRequest.sha);
      if (taggedBase) {
        return taggedBase.candidate.baseline;
      }

      await repository.show(pullRequest.sha, relativePath);
      return { kind: 'commit', ref: pullRequest.sha };
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

async function getGitRepository(uri: vscode.Uri): Promise<GitRepository | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) {
    return undefined;
  }

  if (!extension.isActive) {
    await extension.activate();
  }

  const exports = extension.exports;
  if (!exports?.enabled) {
    return undefined;
  }

  return exports.getAPI(gitApiVersion).getRepository(uri) ?? undefined;
}

async function getGitHubSession(prompt: boolean): Promise<vscode.AuthenticationSession | undefined> {
  try {
    return await vscode.authentication.getSession(
      githubAuthenticationProvider,
      githubAuthScopes,
      { createIfNone: prompt },
    );
  } catch {
    return undefined;
  }
}

async function loadPullRequestBase(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<PullRequestBase | undefined> {
  const request = new Request(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  const response = await fetch(request);
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as unknown;
  if (!Array.isArray(payload) || payload.length === 0) {
    return undefined;
  }

  const pullRequest = payload[0];
  if (!isRecord(pullRequest) || !isRecord(pullRequest.base) || typeof pullRequest.title !== 'string') {
    return undefined;
  }

  return typeof pullRequest.base.sha === 'string' && typeof pullRequest.base.ref === 'string'
    ? {
      sha: pullRequest.base.sha,
      baseRef: pullRequest.base.ref,
      title: pullRequest.title,
    }
    : undefined;
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

function parseGitHubRepository(url: string | undefined): { owner: string; repo: string } | undefined {
  if (!url) {
    return undefined;
  }

  const httpsMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/iu);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/iu);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return undefined;
}

function getRepositoryRelativePath(uri: vscode.Uri, rootUri: vscode.Uri): string | undefined {
  const rootPath = rootUri.path.replace(/\/$/, '');
  if (!uri.path.startsWith(`${rootPath}/`)) {
    return undefined;
  }

  return uri.path.slice(rootPath.length + 1);
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

function formatCommitDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const githubAuthenticationDependency = githubAuthenticationExtension;

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
