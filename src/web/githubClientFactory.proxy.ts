import * as vscode from 'vscode';
import {
  GitHubClient,
  GitHubClientOptions,
  GitHubCommit,
  GitHubCreatePullRequestCommentReplyRequest,
  GitHubCreatePullRequestCommentRequest,
  GitHubDeletePullRequestCommentRequest,
  GitHubDocumentRef,
  GitHubFileContentRequest,
  GitHubHistoryRequest,
  GitHubPullRequest,
  GitHubPullRequestComment,
  GitHubPullRequestCommentsRequest,
  GitHubPullRequestReview,
  GitHubPullRequestReviewsRequest,
  GitHubPullRequestRequest,
  GitHubPullRequestBaseRequest,
  GitHubRepositoryRequest,
  GitHubSubmitPullRequestReviewRequest,
  GitHubTag,
  GitHubUpdatePullRequestCommentRequest,
  normalizePullRequestCommentPayload,
  normalizePullRequestCommentsPayload,
  normalizePullRequestReviewsPayload,
  parseGitHubDocument,
} from './githubClient';

const proxyUrl = process.env.GITHUB_PROXY_URL;
const proxyToken = process.env.GITHUB_PROXY_TOKEN;
const repositoryOwner = process.env.GITHUB_PROXY_OWNER;
const repositoryName = process.env.GITHUB_PROXY_REPO;
const repositoryRef = process.env.GITHUB_PROXY_REF;

export function createGitHubClient(_options: GitHubClientOptions): GitHubClient {
  if (!proxyUrl || !proxyToken || !repositoryOwner || !repositoryName || !repositoryRef) {
    throw new Error('GitHub proxy configuration is incomplete.');
  }
  return new GitHubProxyClient(proxyUrl, proxyToken, repositoryOwner, repositoryName, repositoryRef);
}

class GitHubProxyClient implements GitHubClient {
  public constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly owner: string,
    private readonly repo: string,
    private readonly ref: string,
  ) { }

  public resolveDocument(uri: vscode.Uri): GitHubDocumentRef | undefined {
    const githubDocument = parseGitHubDocument(uri.toString(true));
    if (githubDocument) {
      return githubDocument;
    }

    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return undefined;
    }
    const folderPath = folder.uri.path.replace(/\/$/, '');
    const path = uri.path.slice(folderPath.length).replace(/^\//, '');
    return path ? {
      repository: { owner: this.owner, repo: this.repo },
      ref: this.ref,
      path,
    } : undefined;
  }

  public getTags(_request: GitHubRepositoryRequest): Promise<readonly GitHubTag[]> {
    return this.getJson<readonly GitHubTag[]>('/tags');
  }

  public getCommits(request: GitHubHistoryRequest): Promise<readonly GitHubCommit[]> {
    return this.getJson<readonly GitHubCommit[]>('/commits', {
      ref: request.ref,
      path: request.path,
      maxEntries: String(request.maxEntries ?? 30),
    });
  }

  public async getFileContent(request: GitHubFileContentRequest): Promise<string | undefined> {
    return this.getText('/content', { ref: request.ref, path: request.path }, true);
  }

  public async getPullRequest(request: GitHubPullRequestRequest): Promise<GitHubPullRequest | undefined> {
    const resolved = await this.getJsonOrUndefined<GitHubPullRequest>('/pull-request', {
      ref: request.ref,
      headOwner: request.headOwner ?? '',
    });
    if (resolved) {
      return resolved;
    }

    if (request.repository.owner === this.owner && request.repository.repo === this.repo && request.ref === this.ref) {
      return {
        number: 1,
        title: `Pull request for ${shortRef(request.ref)}`,
        state: 'open',
        baseRef: 'main',
        baseSha: this.ref,
        headRef: this.ref,
        headSha: this.ref,
        headOwner: this.owner,
      };
    }

    return undefined;
  }

  public async getPullRequestComments(
    request: GitHubPullRequestCommentsRequest,
  ): Promise<readonly GitHubPullRequestComment[]> {
    const reviews = await this.getPullRequestReviews({
      repository: request.repository,
      prNumber: request.prNumber,
      promptForAuth: request.promptForAuth,
    });
    const reviewsById = new Map(reviews.map(review => [review.id, review] as const));
    const payload = await this.getJson<unknown>('/pull-request-comments', {
      prNumber: String(request.prNumber),
    });
    return normalizePullRequestCommentsPayload(payload, reviewsById) ?? [];
  }

  public async getPullRequestReviews(
    request: GitHubPullRequestReviewsRequest,
  ): Promise<readonly GitHubPullRequestReview[]> {
    const payload = await this.getJson<unknown>('/pull-request-reviews', {
      prNumber: String(request.prNumber),
    });
    return normalizePullRequestReviewsPayload(payload) ?? [];
  }

  public async createPullRequestComment(
    request: GitHubCreatePullRequestCommentRequest,
  ): Promise<GitHubPullRequestComment | undefined> {
    const payload = await this.sendJson<unknown>('POST', '/pull-request-comments', {
      prNumber: request.prNumber,
      commitId: request.commitId,
      path: request.path,
      line: request.line,
      body: request.body,
    });
    return this.normalizeCommentPayload(request, payload);
  }

  public async createPullRequestCommentReply(
    request: GitHubCreatePullRequestCommentReplyRequest,
  ): Promise<GitHubPullRequestComment | undefined> {
    const payload = await this.sendJson<unknown>('POST', `/pull-request-comments/${request.commentId}/replies`, {
      prNumber: request.prNumber,
      body: request.body,
    });
    return this.normalizeCommentPayload(request, payload);
  }

  public async updatePullRequestComment(
    request: GitHubUpdatePullRequestCommentRequest,
  ): Promise<GitHubPullRequestComment | undefined> {
    const payload = await this.sendJsonOrUndefined<unknown>(
      'PATCH',
      `/pull-request-comments/${request.commentId}`,
      {
        prNumber: request.prNumber,
        body: request.body,
      },
    );
    return payload ? this.normalizeCommentPayload(request, payload) : undefined;
  }

  public async deletePullRequestComment(request: GitHubDeletePullRequestCommentRequest): Promise<boolean> {
    return this.send('DELETE', `/pull-request-comments/${request.commentId}`, {
      query: { prNumber: String(request.prNumber) },
      allowNotFound: true,
    }) !== undefined;
  }

  public async submitPullRequestReview(request: GitHubSubmitPullRequestReviewRequest): Promise<void> {
    await this.sendJson('POST', '/pull-request-reviews', {
      prNumber: request.prNumber,
      commitId: request.commitId,
      event: request.event,
      body: request.body,
      comments: request.comments,
    });
  }

  public async getPullRequestBase(_request: GitHubPullRequestBaseRequest): Promise<undefined> {
    return undefined;
  }

  private async getJson<T>(path: string, query?: Record<string, string>): Promise<T> {
    const response = await this.send('GET', path, { query });
    if (!response) {
      throw new Error('GitHub proxy request returned no response.');
    }
    return response.json() as Promise<T>;
  }

  private async getJsonOrUndefined<T>(path: string, query?: Record<string, string>): Promise<T | undefined> {
    const response = await this.send('GET', path, { query, allowNotFound: true });
    return response ? response.json() as Promise<T> : undefined;
  }

  private async sendJson<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
    const response = await this.send(method, path, { body });
    if (!response) {
      throw new Error('GitHub proxy request returned no response.');
    }
    return response.json() as Promise<T>;
  }

  private async sendJsonOrUndefined<T>(method: 'PATCH', path: string, body: unknown): Promise<T | undefined> {
    const response = await this.send(method, path, { body, allowNotFound: true });
    return response ? response.json() as Promise<T> : undefined;
  }

  private async getText(path: string, query?: Record<string, string>, allowNotFound = false): Promise<string | undefined> {
    const response = await this.send('GET', path, { query, allowNotFound });
    return response ? response.text() : undefined;
  }

  private async normalizeCommentPayload(
    request: GitHubPullRequestCommentsRequest,
    payload: unknown,
  ): Promise<GitHubPullRequestComment | undefined> {
    const reviews = await this.getPullRequestReviews({
      repository: request.repository,
      prNumber: request.prNumber,
      promptForAuth: request.promptForAuth,
    });
    return normalizePullRequestCommentPayload(
      payload,
      new Map(reviews.map(review => [review.id, review] as const)),
    );
  }

  private async send(
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST',
    path: string,
    options: {
      readonly query?: Record<string, string>;
      readonly body?: unknown;
      readonly allowNotFound?: boolean;
    },
  ): Promise<Response | undefined> {
    const url = new URL(path, this.url);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(name, value);
    }

    const headers: Record<string, string> = {
      'X-GitHub-Proxy-Token': this.token,
    };
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body,
    });
    if (options.allowNotFound && response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`GitHub proxy request failed (${response.status} ${response.statusText}).`);
    }
    return response;
  }
}

function shortRef(ref: string): string {
  return ref.slice(0, 8);
}
