import * as vscode from 'vscode';
import { CacheStore } from './cache';

const githubAuthenticationProvider = 'github';
const githubAuthenticationExtension = 'vscode.github-authentication';
const githubAuthScopes = ['repo'];
const maxPullRequestSearchResults = 10;

const openPullRequestBaseQuery = `
  query OpenPullRequestBase($query: String!, $count: Int!) {
    search(query: $query, type: ISSUE, first: $count) {
      nodes {
        ... on PullRequest {
          title
          headRefName
          headRepositoryOwner {
            login
          }
          baseRefName
          baseRefOid
        }
      }
    }
  }
`;

export interface GitHubRepositoryRef {
  readonly owner: string;
  readonly repo: string;
}

export interface GitHubDocumentRef {
  readonly repository: GitHubRepositoryRef;
  readonly ref: string;
  readonly path: string;
}

export interface GitHubTag {
  readonly name: string;
  readonly commit: string;
}

export interface GitHubCommit {
  readonly hash: string;
  readonly message: string;
  readonly committedAt?: string;
}

export interface GitHubRepositoryRequest {
  readonly repository: GitHubRepositoryRef;
  readonly promptForAuth?: boolean;
}

export interface GitHubHistoryRequest extends GitHubRepositoryRequest {
  readonly ref: string;
  readonly path: string;
  readonly maxEntries?: number;
}

export interface GitHubFileContentRequest extends GitHubRepositoryRequest {
  readonly ref: string;
  readonly path: string;
}

export interface GitHubPullRequestBase {
  readonly baseSha: string;
  readonly baseRef: string;
  readonly title: string;
}

export interface GitHubPullRequestBaseRequest {
  readonly repository: GitHubRepositoryRef;
  readonly branch: string;
  readonly headOwner?: string;
  readonly promptForAuth?: boolean;
}

export interface GitHubClient {
  getPullRequestBase(request: GitHubPullRequestBaseRequest): Promise<GitHubPullRequestBase | undefined>;
  getTags(request: GitHubRepositoryRequest): Promise<readonly GitHubTag[] | undefined>;
  getCommits(request: GitHubHistoryRequest): Promise<readonly GitHubCommit[] | undefined>;
  getFileContent(request: GitHubFileContentRequest): Promise<string | undefined>;
}

export interface GitHubSession {
  readonly accessToken: string;
  readonly accountId: string;
}

export interface GitHubAuthProvider {
  getSession(prompt: boolean): Promise<GitHubSession | undefined>;
}

export interface GitHubTransportResponse<T> {
  readonly data: T;
  readonly headers: Readonly<Record<string, string | number | readonly string[] | undefined>>;
  readonly status: number;
}

export interface GitHubTransport {
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
  request<T>(route: string, parameters: Record<string, unknown>): Promise<GitHubTransportResponse<T>>;
}

export interface GitHubClientOptions {
  readonly cache: CacheStore;
  readonly output?: vscode.OutputChannel;
  readonly authProvider?: GitHubAuthProvider;
  readonly transportFactory?: (accessToken: string) => GitHubTransport;
  readonly now?: () => number;
}

interface GraphQlPullRequestSearchResponse {
  readonly search?: {
    readonly nodes?: readonly (GraphQlPullRequestNode | null)[];
  };
}

interface GraphQlPullRequestNode {
  readonly title?: string;
  readonly headRefName?: string;
  readonly headRepositoryOwner?: {
    readonly login?: string;
  } | null;
  readonly baseRefName?: string;
  readonly baseRefOid?: string;
}

interface OctokitLike {
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
  request(route: string, parameters: Record<string, unknown>): Promise<{
    readonly data: unknown;
    readonly headers: Record<string, string | number | readonly string[] | undefined>;
    readonly status: number;
  }>;
}

export const githubAuthenticationDependency = githubAuthenticationExtension;

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  return new OctokitGitHubClient(
    options.cache,
    options.output,
    options.authProvider ?? new VsCodeGitHubAuthProvider(),
    options.transportFactory ?? createOctokitTransport,
    options.now ?? (() => Date.now()),
  );
}

export function parseGitHubRepository(url: string | undefined): GitHubRepositoryRef | undefined {
  if (!url) {
    return undefined;
  }

  const httpsMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/iu);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/iu);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return undefined;
}

export function parseGitHubDocument(url: string | undefined): GitHubDocumentRef | undefined {
  if (!url) {
    return undefined;
  }

  const webMatch = url.match(
    /^https:\/\/(?:www\.)?(?:github\.com|github\.dev|vscode\.dev)\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)(?:[?#].*)?$/iu,
  );
  if (webMatch) {
    return {
      repository: { owner: decodeURIComponent(webMatch[1]), repo: decodeURIComponent(webMatch[2]) },
      ref: decodeURIComponent(webMatch[3]),
      path: decodeURIComponent(webMatch[4]),
    };
  }

  const virtualMatch = url.match(/^vscode-vfs:\/\/github\/([^/]+)\/([^/]+)\/([^/]+)\/(.+?)(?:[?#].*)?$/iu);
  if (virtualMatch) {
    return {
      repository: { owner: decodeURIComponent(virtualMatch[1]), repo: decodeURIComponent(virtualMatch[2]) },
      ref: decodeURIComponent(virtualMatch[3]),
      path: decodeURIComponent(virtualMatch[4]),
    };
  }

  return undefined;
}

class OctokitGitHubClient implements GitHubClient {
  public constructor(
    private readonly cache: CacheStore,
    private readonly output: vscode.OutputChannel | undefined,
    private readonly authProvider: GitHubAuthProvider,
    private readonly transportFactory: (accessToken: string) => GitHubTransport,
    private readonly now: () => number,
  ) { }

  public async getPullRequestBase(request: GitHubPullRequestBaseRequest): Promise<GitHubPullRequestBase | undefined> {
    const session = await this.authProvider.getSession(request.promptForAuth === true);
    if (!session) {
      return undefined;
    }

    const headOwner = request.headOwner ?? request.repository.owner;
    const cacheNamespace = createCacheNamespace(session.accountId, request.repository, headOwner, request.branch);
    const graphQlCacheKey = `graphql:${cacheNamespace}`;
    const restCacheKey = `rest:${cacheNamespace}`;
    const cachedGraphQl = this.cache.get<GitHubPullRequestBase>(graphQlCacheKey);
    const cachedGraphQlValue = cachedGraphQl?.value;
    if (cachedGraphQl) {
      return cachedGraphQl.value;
    }

    const transport = this.transportFactory(session.accessToken);

    try {
      const graphQlResult = await transport.graphql<GraphQlPullRequestSearchResponse>(openPullRequestBaseQuery, {
        query: createPullRequestSearchQuery(request.repository, request.branch),
        count: maxPullRequestSearchResults,
      });
      const normalized = normalizeGraphQlPullRequestBase(graphQlResult, headOwner, request.branch);
      if (normalized) {
        const entry = { value: normalized, fetchedAt: this.now() };
        this.cache.set(graphQlCacheKey, entry);
        this.cache.set(restCacheKey, entry);
        return normalized;
      }
    } catch (error) {
      if (cachedGraphQlValue) {
        this.output?.appendLine(`Unable to refresh GitHub PR base from GraphQL; using cached data: ${formatError(error)}`);
        return cachedGraphQlValue;
      }
    }

    return this.loadPullRequestBaseFromRest(transport, restCacheKey, request, headOwner);
  }

  public async getTags(request: GitHubRepositoryRequest): Promise<readonly GitHubTag[] | undefined> {
    return this.loadRest(
      request,
      `tags:${repositoryCacheKey(request.repository)}`,
      'GET /repos/{owner}/{repo}/tags',
      { per_page: 100 },
      normalizeTags,
    );
  }

  public async getCommits(request: GitHubHistoryRequest): Promise<readonly GitHubCommit[] | undefined> {
    const maxEntries = Math.min(Math.max(request.maxEntries ?? 30, 1), 100);
    return this.loadRest(
      request,
      `commits:${repositoryCacheKey(request.repository)}:${request.ref}:${request.path}:${maxEntries}`,
      'GET /repos/{owner}/{repo}/commits',
      { sha: request.ref, path: request.path, per_page: maxEntries },
      normalizeCommits,
    );
  }

  public async getFileContent(request: GitHubFileContentRequest): Promise<string | undefined> {
    return this.loadRest(
      request,
      `content:${repositoryCacheKey(request.repository)}:${request.ref}:${request.path}`,
      'GET /repos/{owner}/{repo}/contents/{path}',
      {
        path: request.path,
        ref: request.ref,
        headers: { Accept: 'application/vnd.github.raw+json' },
      },
      payload => typeof payload === 'string' ? payload : undefined,
    );
  }

  private async loadRest<T>(
    request: GitHubRepositoryRequest,
    cacheKey: string,
    route: string,
    parameters: Record<string, unknown>,
    normalize: (payload: unknown) => T | undefined,
  ): Promise<T | undefined> {
    const session = await this.authProvider.getSession(request.promptForAuth === true);
    if (!session) {
      return undefined;
    }

    const accountCacheKey = `${session.accountId}:${cacheKey}`;
    const cached = this.cache.get<T>(accountCacheKey);
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(isRecord(parameters.headers) ? parameters.headers as Record<string, string> : {}),
    };
    if (cached?.etag) {
      headers['if-none-match'] = cached.etag;
    }

    try {
      const response = await this.transportFactory(session.accessToken).request<unknown>(route, {
        owner: request.repository.owner,
        repo: request.repository.repo,
        ...parameters,
        headers,
      });
      if (response.status === 304 && cached) {
        return cached.value;
      }

      const value = normalize(response.data);
      if (value === undefined) {
        this.cache.delete(accountCacheKey);
        return undefined;
      }

      this.cache.set(accountCacheKey, {
        value,
        etag: getHeader(response.headers, 'etag'),
        fetchedAt: this.now(),
      });
      return value;
    } catch (error) {
      if (isResponseStatus(error, 304) && cached) {
        return cached.value;
      }
      if (cached) {
        this.output?.appendLine(`Unable to refresh GitHub data; using cached data: ${formatError(error)}`);
        return cached.value;
      }
      throw error;
    }
  }

  private async loadPullRequestBaseFromRest(
    transport: GitHubTransport,
    cacheKey: string,
    request: GitHubPullRequestBaseRequest,
    headOwner: string,
  ): Promise<GitHubPullRequestBase | undefined> {
    const cached = this.cache.get<GitHubPullRequestBase>(cacheKey);
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (cached?.etag) {
      headers['if-none-match'] = cached.etag;
    }

    try {
      const response = await transport.request<unknown>('GET /repos/{owner}/{repo}/pulls', {
        owner: request.repository.owner,
        repo: request.repository.repo,
        state: 'open',
        head: `${headOwner}:${request.branch}`,
        headers,
      });

      if (response.status === 304 && cached) {
        return cached.value;
      }

      const normalized = normalizeRestPullRequestBase(response.data);
      if (!normalized) {
        this.cache.delete(cacheKey);
        return undefined;
      }

      this.cache.set(cacheKey, {
        value: normalized,
        etag: getHeader(response.headers, 'etag'),
        fetchedAt: this.now(),
      });
      return normalized;
    } catch (error) {
      if (isResponseStatus(error, 304) && cached) {
        return cached.value;
      }
      if (cached) {
        this.output?.appendLine(`Unable to refresh GitHub PR base from REST; using cached data: ${formatError(error)}`);
        return cached.value;
      }
      throw error;
    }
  }
}

class VsCodeGitHubAuthProvider implements GitHubAuthProvider {
  public async getSession(prompt: boolean): Promise<GitHubSession | undefined> {
    try {
      const session = await vscode.authentication.getSession(
        githubAuthenticationProvider,
        githubAuthScopes,
        { createIfNone: prompt },
      );
      if (!session) {
        return undefined;
      }

      return {
        accessToken: session.accessToken,
        accountId: session.account.id,
      };
    } catch {
      return undefined;
    }
  }
}

function createOctokitTransport(accessToken: string): GitHubTransport {
  let octokitPromise: Promise<OctokitLike> | undefined;

  const getOctokit = async (): Promise<OctokitLike> => {
    octokitPromise ??= loadOctokit(accessToken);
    return octokitPromise;
  };

  return {
    async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      return (await getOctokit()).graphql<T>(query, variables);
    },
    async request<T>(route: string, parameters: Record<string, unknown>): Promise<GitHubTransportResponse<T>> {
      const response = await (await getOctokit()).request(route, parameters);
      return {
        data: response.data as T,
        headers: response.headers,
        status: response.status,
      };
    },
  };
}

async function loadOctokit(accessToken: string): Promise<OctokitLike> {
  const { Octokit } = await import('octokit');
  return new Octokit({ auth: accessToken });
}

function createPullRequestSearchQuery(repository: GitHubRepositoryRef, branch: string): string {
  return `repo:${repository.owner}/${repository.repo} is:pr is:open head:${branch}`;
}

function createCacheNamespace(
  accountId: string,
  repository: GitHubRepositoryRef,
  headOwner: string,
  branch: string,
): string {
  return [
    accountId,
    repository.owner.toLowerCase(),
    repository.repo.toLowerCase(),
    headOwner.toLowerCase(),
    branch,
  ].join(':');
}

function normalizeGraphQlPullRequestBase(
  payload: GraphQlPullRequestSearchResponse,
  headOwner: string,
  branch: string,
): GitHubPullRequestBase | undefined {
  for (const node of payload.search?.nodes ?? []) {
    if (!node || node.headRefName !== branch) {
      continue;
    }

    const login = node.headRepositoryOwner?.login;
    if (typeof login === 'string' && !sameIgnoreCase(login, headOwner)) {
      continue;
    }

    if (typeof node.title !== 'string' || typeof node.baseRefName !== 'string' || typeof node.baseRefOid !== 'string') {
      continue;
    }

    return {
      baseSha: node.baseRefOid,
      baseRef: node.baseRefName,
      title: node.title,
    };
  }

  return undefined;
}

function normalizeRestPullRequestBase(payload: unknown): GitHubPullRequestBase | undefined {
  if (!Array.isArray(payload) || payload.length === 0) {
    return undefined;
  }

  const pullRequest = payload[0];
  if (!isRecord(pullRequest) || !isRecord(pullRequest.base) || typeof pullRequest.title !== 'string') {
    return undefined;
  }

  return typeof pullRequest.base.sha === 'string' && typeof pullRequest.base.ref === 'string'
    ? {
      baseSha: pullRequest.base.sha,
      baseRef: pullRequest.base.ref,
      title: pullRequest.title,
    }
    : undefined;
}

function normalizeTags(payload: unknown): readonly GitHubTag[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }

  return payload.flatMap(value => {
    if (!isRecord(value) || typeof value.name !== 'string' || !isRecord(value.commit)
      || typeof value.commit.sha !== 'string') {
      return [];
    }
    return [{ name: value.name, commit: value.commit.sha }];
  });
}

function normalizeCommits(payload: unknown): readonly GitHubCommit[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }

  return payload.flatMap(value => {
    if (!isRecord(value) || typeof value.sha !== 'string' || !isRecord(value.commit)
      || typeof value.commit.message !== 'string') {
      return [];
    }

    const committer = isRecord(value.commit.committer) ? value.commit.committer : undefined;
    return [{
      hash: value.sha,
      message: value.commit.message,
      committedAt: typeof committer?.date === 'string' ? committer.date : undefined,
    }];
  });
}

function repositoryCacheKey(repository: GitHubRepositoryRef): string {
  return `${repository.owner.toLowerCase()}:${repository.repo.toLowerCase()}`;
}

function getHeader(
  headers: Readonly<Record<string, string | number | readonly string[] | undefined>>,
  name: string,
): string | undefined {
  for (const [headerName, value] of Object.entries(headers)) {
    if (!sameIgnoreCase(headerName, name)) {
      continue;
    }

    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (value) {
      return value[0];
    }
    return undefined;
  }

  return undefined;
}

function isResponseStatus(error: unknown, status: number): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === status;
}

function sameIgnoreCase(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
