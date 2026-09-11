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

export interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly baseRef: string;
  readonly baseSha: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly headOwner?: string;
}

export type GitHubPullRequestCommentKind = 'individual' | 'review' | 'reply';

export interface GitHubPullRequestComment {
  readonly id: number;
  readonly body: string;
  readonly path: string;
  readonly line: number;
  readonly commitId: string;
  readonly kind: GitHubPullRequestCommentKind;
  readonly reviewId?: number;
  readonly inReplyToId?: number;
  /**
   * The top-level review comment id for this discussion. GitHub reply APIs must
   * target this original comment id, and replies to replies are not supported.
   */
  readonly originalPostId: number;
  readonly author?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface GitHubPullRequestReview {
  readonly id: number;
  readonly state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  readonly body?: string;
  readonly commitId?: string;
  readonly author?: string;
  readonly submittedAt?: string;
}

export interface GitHubPullRequestBaseRequest {
  readonly repository: GitHubRepositoryRef;
  readonly branch: string;
  readonly headOwner?: string;
  readonly promptForAuth?: boolean;
}

export interface GitHubPullRequestRequest extends GitHubRepositoryRequest {
  readonly ref: string;
  readonly headOwner?: string;
}

export interface GitHubPullRequestCommentsRequest extends GitHubRepositoryRequest {
  readonly prNumber: number;
}

export interface GitHubPullRequestReviewsRequest extends GitHubPullRequestCommentsRequest {
}

export interface GitHubUpdatePullRequestCommentRequest extends GitHubPullRequestCommentsRequest {
  readonly commentId: number;
  readonly body: string;
}

export interface GitHubCreatePullRequestCommentRequest extends GitHubPullRequestCommentsRequest {
  readonly commitId: string;
  readonly path: string;
  readonly line: number;
  readonly body: string;
}

export interface GitHubCreatePullRequestCommentReplyRequest extends GitHubPullRequestCommentsRequest {
  readonly commentId: number;
  readonly body: string;
}

export interface GitHubDeletePullRequestCommentRequest extends GitHubPullRequestCommentsRequest {
  readonly commentId: number;
}

export interface GitHubDraftPullRequestComment {
  readonly path: string;
  readonly line: number;
  readonly body: string;
}

export interface GitHubSubmitPullRequestReviewRequest extends GitHubPullRequestCommentsRequest {
  readonly commitId: string;
  readonly event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  readonly body?: string;
  readonly comments: readonly GitHubDraftPullRequestComment[];
}

export interface GitHubClient {
  resolveDocument(uri: vscode.Uri): GitHubDocumentRef | undefined;
  getPullRequest(request: GitHubPullRequestRequest): Promise<GitHubPullRequest | undefined>;
  getPullRequestComments(request: GitHubPullRequestCommentsRequest): Promise<readonly GitHubPullRequestComment[] | undefined>;
  getPullRequestReviews(request: GitHubPullRequestReviewsRequest): Promise<readonly GitHubPullRequestReview[] | undefined>;
  createPullRequestComment(request: GitHubCreatePullRequestCommentRequest): Promise<GitHubPullRequestComment | undefined>;
  createPullRequestCommentReply(request: GitHubCreatePullRequestCommentReplyRequest): Promise<GitHubPullRequestComment | undefined>;
  updatePullRequestComment(request: GitHubUpdatePullRequestCommentRequest): Promise<GitHubPullRequestComment | undefined>;
  deletePullRequestComment(request: GitHubDeletePullRequestCommentRequest): Promise<boolean>;
  submitPullRequestReview(request: GitHubSubmitPullRequestReviewRequest): Promise<void>;
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

  public resolveDocument(uri: vscode.Uri): GitHubDocumentRef | undefined {
    return parseGitHubDocument(uri.toString(true));
  }

  public async getPullRequest(request: GitHubPullRequestRequest): Promise<GitHubPullRequest | undefined> {
    const explicitPullRequestNumber = parsePullRequestNumber(request.ref);
    if (explicitPullRequestNumber !== undefined) {
      return this.loadRest(
        request,
        `pull:${repositoryCacheKey(request.repository)}:${explicitPullRequestNumber}`,
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        { pull_number: explicitPullRequestNumber },
        normalizeRestPullRequest,
      );
    }

    const associatedPullRequest = await this.loadRest(
      request,
      `pull-by-ref:${repositoryCacheKey(request.repository)}:${request.headOwner ?? request.repository.owner}:${request.ref}`,
      'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls',
      { commit_sha: request.ref, per_page: maxPullRequestSearchResults },
      payload => normalizeAssociatedPullRequest(payload, request.ref, request.headOwner),
    );
    if (associatedPullRequest || looksLikeCommitSha(request.ref)) {
      return associatedPullRequest;
    }

    return this.loadRest(
      request,
      `pull-by-branch:${repositoryCacheKey(request.repository)}:${request.headOwner ?? request.repository.owner}:${request.ref}`,
      'GET /repos/{owner}/{repo}/pulls',
      {
        state: 'open',
        head: `${request.headOwner ?? request.repository.owner}:${request.ref}`,
        per_page: maxPullRequestSearchResults,
      },
      payload => normalizeAssociatedPullRequest(payload, request.ref, request.headOwner),
    );
  }

  public async getPullRequestComments(
    request: GitHubPullRequestCommentsRequest,
  ): Promise<readonly GitHubPullRequestComment[] | undefined> {
    const reviews = await this.getPullRequestReviews(request);
    const reviewsById = new Map((reviews ?? []).map(review => [review.id, review] as const));

    return this.loadRest(
      request,
      pullRequestCommentsCacheKey(request.repository, request.prNumber),
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/comments',
      {
        pull_number: request.prNumber,
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
      },
      payload => normalizePullRequestComments(payload, reviewsById),
    );
  }

  public async getPullRequestReviews(
    request: GitHubPullRequestReviewsRequest,
  ): Promise<readonly GitHubPullRequestReview[] | undefined> {
    return this.loadRest(
      request,
      pullRequestReviewsCacheKey(request.repository, request.prNumber),
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      {
        pull_number: request.prNumber,
        per_page: 100,
      },
      normalizePullRequestReviews,
    );
  }

  public async createPullRequestComment(
    request: GitHubCreatePullRequestCommentRequest,
  ): Promise<GitHubPullRequestComment | undefined> {
    const session = await this.authProvider.getSession(request.promptForAuth === true);
    if (!session) {
      return undefined;
    }

    const response = await this.transportFactory(session.accessToken).request<unknown>(
      'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments',
      {
        owner: request.repository.owner,
        repo: request.repository.repo,
        pull_number: request.prNumber,
        commit_id: request.commitId,
        path: request.path,
        line: request.line,
        side: 'RIGHT',
        body: request.body,
        headers: createRestHeaders(),
      },
    );
    this.cache.delete(accountCacheKey(session.accountId, pullRequestCommentsCacheKey(request.repository, request.prNumber)));
    this.cache.delete(accountCacheKey(session.accountId, pullRequestReviewsCacheKey(request.repository, request.prNumber)));
    return normalizePullRequestComment(response.data);
  }

  public async createPullRequestCommentReply(
    request: GitHubCreatePullRequestCommentReplyRequest,
  ): Promise<GitHubPullRequestComment | undefined> {
    const session = await this.authProvider.getSession(request.promptForAuth === true);
    if (!session) {
      return undefined;
    }

    const response = await this.transportFactory(session.accessToken).request<unknown>(
      'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies',
      {
        owner: request.repository.owner,
        repo: request.repository.repo,
        pull_number: request.prNumber,
        comment_id: request.commentId,
        body: request.body,
        headers: createRestHeaders(),
      },
    );
    this.cache.delete(accountCacheKey(session.accountId, pullRequestCommentsCacheKey(request.repository, request.prNumber)));
    this.cache.delete(accountCacheKey(session.accountId, pullRequestReviewsCacheKey(request.repository, request.prNumber)));
    return normalizePullRequestComment(response.data);
  }

  public async updatePullRequestComment(
    request: GitHubUpdatePullRequestCommentRequest,
  ): Promise<GitHubPullRequestComment | undefined> {
    const session = await this.authProvider.getSession(request.promptForAuth === true);
    if (!session) {
      return undefined;
    }

    const response = await this.transportFactory(session.accessToken).request<unknown>(
      'PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}',
      {
        owner: request.repository.owner,
        repo: request.repository.repo,
        comment_id: request.commentId,
        body: request.body,
        headers: createRestHeaders(),
      },
    );
    this.cache.delete(accountCacheKey(session.accountId, pullRequestCommentsCacheKey(request.repository, request.prNumber)));
    return normalizePullRequestComment(response.data);
  }

  public async deletePullRequestComment(
    request: GitHubDeletePullRequestCommentRequest,
  ): Promise<boolean> {
    const session = await this.authProvider.getSession(request.promptForAuth === true);
    if (!session) {
      return false;
    }

    const response = await this.transportFactory(session.accessToken).request<unknown>(
      'DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}',
      {
        owner: request.repository.owner,
        repo: request.repository.repo,
        comment_id: request.commentId,
        headers: createRestHeaders(),
      },
    );
    this.cache.delete(accountCacheKey(session.accountId, pullRequestCommentsCacheKey(request.repository, request.prNumber)));
    return response.status === 204;
  }

  public async submitPullRequestReview(request: GitHubSubmitPullRequestReviewRequest): Promise<void> {
    const session = await this.authProvider.getSession(request.promptForAuth === true);
    if (!session) {
      return;
    }

    await this.transportFactory(session.accessToken).request<unknown>('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
      owner: request.repository.owner,
      repo: request.repository.repo,
      pull_number: request.prNumber,
      commit_id: request.commitId,
      body: request.body,
      event: request.event,
      comments: request.comments.map(comment => ({
        path: comment.path,
        line: comment.line,
        side: 'RIGHT',
        body: comment.body,
      })),
      headers: createRestHeaders(),
    });
    this.cache.delete(accountCacheKey(session.accountId, pullRequestCommentsCacheKey(request.repository, request.prNumber)));
    this.cache.delete(accountCacheKey(session.accountId, pullRequestReviewsCacheKey(request.repository, request.prNumber)));
  }

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

    const scopedCacheKey = accountCacheKey(session.accountId, cacheKey);
    const cached = this.cache.get<T>(scopedCacheKey);
    const headers = createRestHeaders(
      isRecord(parameters.headers) ? parameters.headers as Record<string, string> : undefined,
      cached?.etag,
    );

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
        this.cache.delete(scopedCacheKey);
        return undefined;
      }

      this.cache.set(scopedCacheKey, {
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

function normalizeRestPullRequest(payload: unknown): GitHubPullRequest | undefined {
  if (!isRecord(payload)
    || typeof payload.number !== 'number'
    || typeof payload.title !== 'string'
    || typeof payload.state !== 'string'
    || !isRecord(payload.base)
    || !isRecord(payload.head)
    || typeof payload.base.ref !== 'string'
    || typeof payload.base.sha !== 'string'
    || typeof payload.head.ref !== 'string'
    || typeof payload.head.sha !== 'string') {
    return undefined;
  }

  const state = payload.state.toLowerCase();
  if (state !== 'open' && state !== 'closed') {
    return undefined;
  }

  return {
    number: payload.number,
    title: payload.title,
    state,
    baseRef: payload.base.ref,
    baseSha: payload.base.sha,
    headRef: payload.head.ref,
    headSha: payload.head.sha,
    headOwner: isRecord(payload.head.repo) && isRecord(payload.head.repo.owner) && typeof payload.head.repo.owner.login === 'string'
      ? payload.head.repo.owner.login
      : undefined,
  };
}

function normalizePullRequestComments(
  payload: unknown,
  reviewsById?: ReadonlyMap<number, GitHubPullRequestReview>,
): readonly GitHubPullRequestComment[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }

  return payload
    .map(value => normalizePullRequestComment(value, reviewsById))
    .filter((value): value is GitHubPullRequestComment => value !== undefined);
}

function normalizePullRequestReviews(payload: unknown): readonly GitHubPullRequestReview[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }

  return payload
    .map(value => normalizePullRequestReview(value))
    .filter((value): value is GitHubPullRequestReview => value !== undefined);
}

function normalizePullRequestComment(
  payload: unknown,
  reviewsById?: ReadonlyMap<number, GitHubPullRequestReview>,
): GitHubPullRequestComment | undefined {
  if (!isRecord(payload)
    || typeof payload.id !== 'number'
    || typeof payload.body !== 'string'
    || typeof payload.path !== 'string'
    || typeof payload.line !== 'number'
    || typeof payload.commit_id !== 'string') {
    return undefined;
  }

  const reviewId = typeof payload.pull_request_review_id === 'number' ? payload.pull_request_review_id : undefined;
  const inReplyToId = typeof payload.in_reply_to_id === 'number' ? payload.in_reply_to_id : undefined;
  const review = reviewId !== undefined ? reviewsById?.get(reviewId) : undefined;
  return {
    id: payload.id,
    body: payload.body,
    path: payload.path,
    line: payload.line,
    commitId: payload.commit_id,
    kind: classifyPullRequestComment(reviewId, review, inReplyToId),
    reviewId,
    inReplyToId,
    originalPostId: inReplyToId ?? payload.id,
    author: isRecord(payload.user) && typeof payload.user.login === 'string' ? payload.user.login : undefined,
    createdAt: typeof payload.created_at === 'string' ? payload.created_at : undefined,
    updatedAt: typeof payload.updated_at === 'string' ? payload.updated_at : undefined,
  };
}

function normalizePullRequestReview(payload: unknown): GitHubPullRequestReview | undefined {
  if (!isRecord(payload)
    || typeof payload.id !== 'number'
    || typeof payload.state !== 'string') {
    return undefined;
  }

  switch (payload.state) {
    case 'APPROVED':
    case 'CHANGES_REQUESTED':
    case 'COMMENTED':
    case 'PENDING':
    case 'DISMISSED':
      return {
        id: payload.id,
        state: payload.state,
        body: typeof payload.body === 'string' ? payload.body : undefined,
        commitId: typeof payload.commit_id === 'string' ? payload.commit_id : undefined,
        author: isRecord(payload.user) && typeof payload.user.login === 'string' ? payload.user.login : undefined,
        submittedAt: typeof payload.submitted_at === 'string' ? payload.submitted_at : undefined,
      };

    default:
      return undefined;
  }
}

function classifyPullRequestComment(
  reviewId: number | undefined,
  review: GitHubPullRequestReview | undefined,
  inReplyToId: number | undefined,
): GitHubPullRequestCommentKind {
  if (inReplyToId !== undefined) {
    return 'reply';
  }

  if (reviewId === undefined) {
    return 'individual';
  }

  if (!review) {
    return 'review';
  }

  return review.body?.trim().length ? 'review' : 'individual';
}

export function normalizePullRequestCommentsPayload(
  payload: unknown,
  reviewsById?: ReadonlyMap<number, GitHubPullRequestReview>,
): readonly GitHubPullRequestComment[] | undefined {
  return normalizePullRequestComments(payload, reviewsById);
}

export function normalizePullRequestCommentPayload(
  payload: unknown,
  reviewsById?: ReadonlyMap<number, GitHubPullRequestReview>,
): GitHubPullRequestComment | undefined {
  return normalizePullRequestComment(payload, reviewsById);
}

export function normalizePullRequestReviewsPayload(payload: unknown): readonly GitHubPullRequestReview[] | undefined {
  return normalizePullRequestReviews(payload);
}

function normalizeAssociatedPullRequest(
  payload: unknown,
  ref: string,
  headOwner: string | undefined,
): GitHubPullRequest | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }

  const normalized = payload
    .map(value => normalizeRestPullRequest(value))
    .filter((value): value is GitHubPullRequest => value !== undefined);
  if (normalized.length === 0) {
    return undefined;
  }

  const explicitPullRequestNumber = parsePullRequestNumber(ref);
  if (explicitPullRequestNumber !== undefined) {
    return normalized.find(value => value.number === explicitPullRequestNumber) ?? normalized[0];
  }

  const openPullRequests = normalized.filter(value => value.state === 'open');
  const candidates = openPullRequests.length > 0 ? openPullRequests : normalized;
  return candidates
    .slice()
    .sort((left, right) => scorePullRequest(right, ref, headOwner) - scorePullRequest(left, ref, headOwner))[0];
}

function scorePullRequest(pullRequest: GitHubPullRequest, ref: string, headOwner: string | undefined): number {
  let score = 0;
  if (pullRequest.state === 'open') {
    score += 4;
  }
  if (sameIgnoreCase(pullRequest.headSha, ref)) {
    score += 3;
  }
  if (pullRequest.headRef === ref) {
    score += 2;
  }
  if (headOwner && pullRequest.headOwner && sameIgnoreCase(pullRequest.headOwner, headOwner)) {
    score += 1;
  }
  return score;
}

function parsePullRequestNumber(ref: string): number | undefined {
  const match = ref.match(/^(?:refs\/)?pull\/(\d+)\/(?:head|merge)$/u);
  if (!match) {
    return undefined;
  }

  const pullRequestNumber = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(pullRequestNumber) ? pullRequestNumber : undefined;
}

function looksLikeCommitSha(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/iu.test(ref);
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

function pullRequestCommentsCacheKey(repository: GitHubRepositoryRef, prNumber: number): string {
  return `pull-comments:${repositoryCacheKey(repository)}:${prNumber}`;
}

function pullRequestReviewsCacheKey(repository: GitHubRepositoryRef, prNumber: number): string {
  return `pull-reviews:${repositoryCacheKey(repository)}:${prNumber}`;
}

function accountCacheKey(accountId: string, key: string): string {
  return `${accountId}:${key}`;
}

function createRestHeaders(headers?: Record<string, string>, etag?: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...headers,
    ...(etag ? { 'if-none-match': etag } : {}),
  };
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
