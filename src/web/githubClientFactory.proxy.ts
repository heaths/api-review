import * as vscode from 'vscode';
import {
  GitHubClient,
  GitHubClientOptions,
  GitHubCommit,
  GitHubDocumentRef,
  GitHubFileContentRequest,
  GitHubHistoryRequest,
  GitHubPullRequestBaseRequest,
  GitHubRepositoryRequest,
  GitHubTag,
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

  public async getPullRequestBase(_request: GitHubPullRequestBaseRequest): Promise<undefined> {
    return undefined;
  }

  private async getJson<T>(path: string, query?: Record<string, string>): Promise<T> {
    const response = await this.fetch(path, query);
    if (!response) {
      throw new Error('GitHub proxy request returned no response.');
    }
    return response.json() as Promise<T>;
  }

  private async getText(path: string, query?: Record<string, string>, allowNotFound = false): Promise<string | undefined> {
    const response = await this.fetch(path, query, allowNotFound);
    return response ? response.text() : undefined;
  }

  private async fetch(path: string, query?: Record<string, string>, allowNotFound = false): Promise<Response | undefined> {
    const url = new URL(path, this.url);
    for (const [name, value] of Object.entries(query ?? {})) {
      url.searchParams.set(name, value);
    }
    const response = await fetch(url, {
      headers: { 'X-GitHub-Proxy-Token': this.token },
    });
    if (allowNotFound && response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`GitHub proxy request failed (${response.status} ${response.statusText}).`);
    }
    return response;
  }
}
