import * as vscode from 'vscode';

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  getRefs(query: { pattern?: string | string[]; sort?: 'alphabetically' | 'committerdate' | 'creatordate' }): Promise<GitRef[]>;
  log(options?: { readonly maxEntries?: number; readonly path?: string }): Promise<GitCommit[]>;
  show(ref: string, path: string): Promise<string>;
}

export interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  readonly remotes: readonly GitRemote[];
}

export interface GitBranch {
  readonly commit?: string;
  readonly name?: string;
  readonly upstream?: GitUpstreamRef;
}

export interface GitUpstreamRef {
  readonly remote: string;
  readonly name: string;
}

export interface GitRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface GitRef {
  readonly type: number;
  readonly name?: string;
  readonly commit?: string;
}

export interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly commitDate?: Date;
}

export interface GitClient {
  getRepository(uri: vscode.Uri): Promise<GitRepository | undefined>;
}

export function getRepositoryRelativePath(uri: vscode.Uri, rootUri: vscode.Uri): string | undefined {
  const rootPath = rootUri.path.replace(/\/$/, '');
  if (!uri.path.startsWith(`${rootPath}/`)) {
    return undefined;
  }

  return uri.path.slice(rootPath.length + 1);
}
