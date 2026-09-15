import * as vscode from 'vscode';
import {
  GitClient,
  GitRemote,
  GitRepository,
  GitRepositoryState,
  getRepositoryRelativePath,
} from './gitClient';
import {
  GitHubClient,
  GitHubDocumentRef,
  GitHubPullRequest,
  parseGitHubRepository,
} from './githubClient';

export interface PullRequestContext {
  readonly document: GitHubDocumentRef;
  readonly pullRequest: GitHubPullRequest;
}

export class PullRequestService {
  private readonly pullRequestCache = new Map<string, Promise<PullRequestContext | undefined>>();

  public constructor(
    private readonly githubClient: GitHubClient,
    private readonly gitClient: GitClient,
  ) { }

  public invalidate(uri?: vscode.Uri): void {
    if (uri) {
      this.pullRequestCache.delete(uri.toString());
      return;
    }

    this.pullRequestCache.clear();
  }

  public async getContext(
    document: vscode.TextDocument,
    options?: { readonly promptForGitHubAuth?: boolean },
  ): Promise<PullRequestContext | undefined> {
    const key = document.uri.toString();
    const shouldPrompt = options?.promptForGitHubAuth === true;

    if (shouldPrompt) {
      const prompted = this.loadContext(document, true);
      this.pullRequestCache.set(key, prompted);

      const resolved = await prompted;
      if (!resolved && this.pullRequestCache.get(key) === prompted) {
        this.pullRequestCache.delete(key);
      }
      return resolved;
    }

    let cached = this.pullRequestCache.get(key);
    if (!cached) {
      cached = this.loadContext(document, false);
      this.pullRequestCache.set(key, cached);
    }
    return cached;
  }

  private async loadContext(
    document: vscode.TextDocument,
    promptForGitHubAuth: boolean,
  ): Promise<PullRequestContext | undefined> {
    const repository = await this.gitClient.getRepository(document.uri);
    if (repository) {
      const resolved = await this.getRepositoryPullRequestContext(repository, document.uri, promptForGitHubAuth);
      if (resolved) {
        return resolved;
      }
    }

    const githubDocument = this.githubClient.resolveDocument(document.uri);
    if (!githubDocument || isExplicitCommitDocument(githubDocument)) {
      return undefined;
    }

    const pullRequest = await this.githubClient.getPullRequest({
      repository: githubDocument.repository,
      ref: githubDocument.ref,
      headOwner: githubDocument.repository.owner,
      promptForAuth: promptForGitHubAuth,
    });
    return pullRequest ? { document: githubDocument, pullRequest } : undefined;
  }

  private async getRepositoryPullRequestContext(
    repository: GitRepository,
    documentUri: vscode.Uri,
    promptForGitHubAuth: boolean,
  ): Promise<PullRequestContext | undefined> {
    const remote = getPreferredGitHubRemote(repository.state);
    const relativePath = getRepositoryRelativePath(documentUri, repository.rootUri);
    if (!remote || !relativePath) {
      return undefined;
    }

    const githubRepository = parseGitHubRepository(remote.fetchUrl ?? remote.pushUrl);
    if (!githubRepository) {
      return undefined;
    }

    const head = repository.state.HEAD;
    const refs = getPullRequestRefCandidates(head);
    for (const ref of refs) {
      const pullRequest = await this.githubClient.getPullRequest({
        repository: githubRepository,
        ref,
        headOwner: githubRepository.owner,
        promptForAuth: promptForGitHubAuth,
      });
      if (!pullRequest) {
        continue;
      }

      return {
        document: {
          repository: githubRepository,
          ref,
          path: relativePath,
        },
        pullRequest,
      };
    }

    return undefined;
  }
}

export async function getPullRequestBaseBaseline(
  repository: GitRepository,
  relativePath: string,
  pullRequestContext: PullRequestContext | undefined,
  tagCandidates: readonly { readonly candidate: { readonly baseline: { readonly kind: string; readonly ref?: string } }; readonly commit?: string }[],
): Promise<{ readonly kind: 'tag' | 'commit'; readonly ref: string } | undefined> {
  if (!pullRequestContext) {
    return undefined;
  }

  const taggedBase = tagCandidates.find(candidate => candidate.commit === pullRequestContext.pullRequest.baseSha);
  if (taggedBase) {
    const baseline = taggedBase.candidate.baseline;
    if (baseline.kind === 'tag' || baseline.kind === 'commit') {
      return { kind: baseline.kind, ref: baseline.ref ?? pullRequestContext.pullRequest.baseSha };
    }
  }

  await repository.show(pullRequestContext.pullRequest.baseSha, relativePath);
  return { kind: 'commit', ref: pullRequestContext.pullRequest.baseSha };
}

export function getPreferredGitHubRemote(state: GitRepositoryState): GitRemote | undefined {
  const upstreamRemote = state.HEAD?.upstream?.remote;
  if (upstreamRemote) {
    const match = state.remotes.find(remote => remote.name === upstreamRemote);
    if (match) {
      return match;
    }
  }

  return state.remotes.find(remote => parseGitHubRepository(remote.fetchUrl ?? remote.pushUrl) !== undefined);
}

function getPullRequestRefCandidates(
  head: GitRepositoryState['HEAD'],
): readonly string[] {
  const values = [
    normalizeBranchRef(head?.upstream?.name),
    head?.name,
  ];
  const refs: string[] = [];
  for (const value of values) {
    if (!value || refs.includes(value)) {
      continue;
    }
    refs.push(value);
  }
  return refs;
}

function normalizeBranchRef(ref: string | undefined): string | undefined {
  return ref?.replace(/^refs\/heads\//u, '');
}

function isExplicitCommitDocument(document: GitHubDocumentRef): boolean {
  return document.pullRequestNumber === undefined && /^[0-9a-f]{40}$/iu.test(document.ref);
}
