import {
  GitHubClient,
  GitHubDocumentRef,
  GitHubPullRequest,
  GitHubPullRequestComment,
} from './githubClient';

export interface PullRequestLineComment {
  readonly id?: number;
  readonly body: string;
  readonly sourceLine: number;
  readonly author?: string;
  readonly updatedAt?: string;
  readonly isDraft: boolean;
}

export class PullRequestReviewController {
  private readonly drafts = new Map<string, Map<number, PullRequestLineComment>>();

  public constructor(private readonly githubClient: GitHubClient) { }

  public async getLineComments(
    document: GitHubDocumentRef,
    pullRequest: GitHubPullRequest,
    promptForAuth = false,
  ): Promise<ReadonlyMap<number, PullRequestLineComment>> {
    const comments = await this.githubClient.getPullRequestComments({
      repository: document.repository,
      prNumber: pullRequest.number,
      promptForAuth,
    }) ?? [];
    const commentsByLine = new Map<number, PullRequestLineComment>();

    for (const comment of comments) {
      if (comment.path !== document.path) {
        continue;
      }

      const sourceLine = comment.line - 1;
      const current = commentsByLine.get(sourceLine);
      if (!current || isNewerComment(comment, current)) {
        commentsByLine.set(sourceLine, toLineComment(comment));
      }
    }

    const drafts = this.drafts.get(createDraftKey(document, pullRequest));
    if (drafts) {
      for (const [line, comment] of drafts) {
        commentsByLine.set(line, comment);
      }
    }

    return commentsByLine;
  }

  public async upsertComment(
    document: GitHubDocumentRef,
    pullRequest: GitHubPullRequest,
    sourceLine: number,
    body: string,
    existing?: PullRequestLineComment,
  ): Promise<PullRequestLineComment> {
    if (existing?.isDraft || existing?.id === undefined) {
      const comment: PullRequestLineComment = {
        id: existing?.id,
        body,
        sourceLine,
        isDraft: true,
        author: existing?.author,
        updatedAt: new Date().toISOString(),
      };
      this.getDrafts(document, pullRequest).set(sourceLine, comment);
      return comment;
    }

    const updated = await this.githubClient.updatePullRequestComment({
      repository: document.repository,
      prNumber: pullRequest.number,
      commentId: existing.id,
      body,
      promptForAuth: true,
    });
    return updated ? toLineComment(updated) : existing;
  }

  public async deleteComment(
    document: GitHubDocumentRef,
    pullRequest: GitHubPullRequest,
    sourceLine: number,
    existing?: PullRequestLineComment,
  ): Promise<void> {
    if (existing?.isDraft || existing?.id === undefined) {
      this.getDrafts(document, pullRequest).delete(sourceLine);
      return;
    }

    await this.githubClient.deletePullRequestComment({
      repository: document.repository,
      prNumber: pullRequest.number,
      commentId: existing.id,
      promptForAuth: true,
    });
  }

  public async submitReview(
    document: GitHubDocumentRef,
    pullRequest: GitHubPullRequest,
    event: 'APPROVE' | 'REQUEST_CHANGES',
    body?: string,
  ): Promise<number> {
    const drafts = [...this.getDrafts(document, pullRequest).values()]
      .filter(comment => comment.isDraft)
      .map(comment => ({
        path: document.path,
        line: comment.sourceLine + 1,
        body: comment.body,
      }));

    await this.githubClient.submitPullRequestReview({
      repository: document.repository,
      prNumber: pullRequest.number,
      commitId: pullRequest.headSha,
      event,
      body: body?.trim().length ? body.trim() : undefined,
      comments: drafts,
      promptForAuth: true,
    });

    this.getDrafts(document, pullRequest).clear();
    return drafts.length;
  }

  private getDrafts(document: GitHubDocumentRef, pullRequest: GitHubPullRequest): Map<number, PullRequestLineComment> {
    const key = createDraftKey(document, pullRequest);
    let drafts = this.drafts.get(key);
    if (!drafts) {
      drafts = new Map<number, PullRequestLineComment>();
      this.drafts.set(key, drafts);
    }
    return drafts;
  }
}

function createDraftKey(document: GitHubDocumentRef, pullRequest: GitHubPullRequest): string {
  return [
    document.repository.owner.toLowerCase(),
    document.repository.repo.toLowerCase(),
    String(pullRequest.number),
    document.path,
  ].join(':');
}

function toLineComment(comment: GitHubPullRequestComment): PullRequestLineComment {
  return {
    id: comment.id,
    body: comment.body,
    sourceLine: comment.line - 1,
    author: comment.author,
    updatedAt: comment.updatedAt,
    isDraft: false,
  };
}

function isNewerComment(comment: GitHubPullRequestComment, current: PullRequestLineComment): boolean {
  if (!current.updatedAt) {
    return true;
  }
  if (!comment.updatedAt) {
    return false;
  }
  return comment.updatedAt >= current.updatedAt;
}
