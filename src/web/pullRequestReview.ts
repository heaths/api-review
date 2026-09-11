import {
  GitHubClient,
  GitHubCreatePullRequestCommentRequest,
  GitHubDocumentRef,
  GitHubPullRequest,
  GitHubPullRequestComment,
} from './githubClient';

export type PullRequestLineCommentKind = 'individual' | 'review' | 'reply';

export interface PullRequestLineComment {
  readonly id?: number;
  readonly localId?: string;
  readonly body: string;
  readonly sourceLine: number;
  readonly kind: PullRequestLineCommentKind;
  readonly reviewId?: number;
  readonly inReplyToId?: number;
  /**
   * The top-level review comment id for this discussion. GitHub reply APIs must
   * target this original comment id, and replies to replies are not supported.
   */
  readonly originalPostId?: number;
  readonly author?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly isDraft: boolean;
}

export class PullRequestReviewController {
  private readonly drafts = new Map<string, Map<number, PullRequestLineComment[]>>();
  private nextLocalDraftId = 1;

  public constructor(private readonly githubClient: GitHubClient) { }

  public hasPendingReview(document: GitHubDocumentRef, pullRequest: GitHubPullRequest): boolean {
    const drafts = this.drafts.get(createDraftKey(document, pullRequest));
    return drafts !== undefined && [...drafts.values()].some(comments => comments.length > 0);
  }

  public async getLineComments(
    document: GitHubDocumentRef,
    pullRequest: GitHubPullRequest,
    promptForAuth = false,
  ): Promise<ReadonlyMap<number, readonly PullRequestLineComment[]>> {
    const comments = await this.githubClient.getPullRequestComments({
      repository: document.repository,
      prNumber: pullRequest.number,
      promptForAuth,
    }) ?? [];
    const commentsByLine = new Map<number, PullRequestLineComment[]>();

    for (const comment of comments) {
      if (comment.path !== document.path) {
        continue;
      }

      const sourceLine = comment.line - 1;
      const lineComments = commentsByLine.get(sourceLine) ?? [];
      lineComments.push(toLineComment(comment));
      commentsByLine.set(sourceLine, lineComments);
    }

    const drafts = this.drafts.get(createDraftKey(document, pullRequest));
    if (drafts) {
      for (const [line, draftComments] of drafts) {
        const lineComments = commentsByLine.get(line) ?? [];
        lineComments.push(...draftComments);
        commentsByLine.set(line, lineComments);
      }
    }

    return new Map([...commentsByLine.entries()].map(([line, lineComments]) => [
      line,
      lineComments.slice().sort(compareLineComments),
    ]));
  }

  public async upsertComment(
    document: GitHubDocumentRef,
    pullRequest: GitHubPullRequest,
    sourceLine: number,
    body: string,
    existing?: PullRequestLineComment,
  ): Promise<PullRequestLineComment> {
    if (existing?.isDraft || existing?.id === undefined) {
      const comment = this.createDraftComment(sourceLine, body, existing);
      const drafts = this.getDrafts(document, pullRequest);
      const lineDrafts = drafts.get(sourceLine) ?? [];
      const nextDrafts = existing?.localId
        ? lineDrafts.map(current => current.localId === existing.localId ? comment : current)
        : [...lineDrafts, comment];
      drafts.set(sourceLine, nextDrafts);
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

  public async createComment(
    document: GitHubDocumentRef,
    pullRequest: GitHubPullRequest,
    sourceLine: number,
    body: string,
  ): Promise<PullRequestLineComment | undefined> {
    const created = await this.githubClient.createPullRequestComment(createCreateCommentRequest(
      document,
      pullRequest,
      sourceLine,
      body,
    ));
    return created ? toLineComment(created) : undefined;
  }

  public async replyToComment(
    document: GitHubDocumentRef,
    pullRequest: GitHubPullRequest,
    sourceLine: number,
    originalPostId: number,
    body: string,
  ): Promise<PullRequestLineComment | undefined> {
    const created = await this.githubClient.createPullRequestCommentReply({
      repository: document.repository,
      prNumber: pullRequest.number,
      commentId: originalPostId,
      body,
      promptForAuth: true,
    });
    return created ? toLineComment(created, sourceLine) : undefined;
  }

  public async deleteComment(
    document: GitHubDocumentRef,
    pullRequest: GitHubPullRequest,
    sourceLine: number,
    existing?: PullRequestLineComment,
  ): Promise<void> {
    if (existing?.isDraft || existing?.id === undefined) {
      const drafts = this.getDrafts(document, pullRequest);
      if (!existing?.localId) {
        drafts.delete(sourceLine);
        return;
      }

      const lineDrafts = drafts.get(sourceLine) ?? [];
      const nextDrafts = lineDrafts.filter(comment => comment.localId !== existing.localId);
      if (nextDrafts.length > 0) {
        drafts.set(sourceLine, nextDrafts);
      } else {
        drafts.delete(sourceLine);
      }
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
      .flatMap(lineDrafts => lineDrafts)
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

  private getDrafts(document: GitHubDocumentRef, pullRequest: GitHubPullRequest): Map<number, PullRequestLineComment[]> {
    const key = createDraftKey(document, pullRequest);
    let drafts = this.drafts.get(key);
    if (!drafts) {
      drafts = new Map<number, PullRequestLineComment[]>();
      this.drafts.set(key, drafts);
    }
    return drafts;
  }

  private createDraftComment(
    sourceLine: number,
    body: string,
    existing?: PullRequestLineComment,
  ): PullRequestLineComment {
    return {
      id: existing?.id,
      localId: existing?.localId ?? `draft-${this.nextLocalDraftId++}`,
      body,
      sourceLine,
      kind: existing?.kind ?? 'review',
      reviewId: existing?.reviewId,
      inReplyToId: existing?.inReplyToId,
      originalPostId: existing?.originalPostId,
      author: existing?.author,
      createdAt: existing?.createdAt,
      updatedAt: new Date().toISOString(),
      isDraft: true,
    };
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

function createCreateCommentRequest(
  document: GitHubDocumentRef,
  pullRequest: GitHubPullRequest,
  sourceLine: number,
  body: string,
): GitHubCreatePullRequestCommentRequest {
  return {
    repository: document.repository,
    prNumber: pullRequest.number,
    commitId: pullRequest.headSha,
    path: document.path,
    line: sourceLine + 1,
    body,
    promptForAuth: true,
  };
}

function toLineComment(comment: GitHubPullRequestComment, sourceLine = comment.line - 1): PullRequestLineComment {
  return {
    id: comment.id,
    body: comment.body,
    sourceLine,
    kind: comment.kind,
    reviewId: comment.reviewId,
    inReplyToId: comment.inReplyToId,
    originalPostId: comment.originalPostId,
    author: comment.author,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    isDraft: false,
  };
}

function compareLineComments(left: PullRequestLineComment, right: PullRequestLineComment): number {
  return compareOptionalTimestamps(left.createdAt ?? left.updatedAt, right.createdAt ?? right.updatedAt)
    || compareOptionalTimestamps(left.updatedAt, right.updatedAt)
    || compareOptionalNumbers(left.id, right.id)
    || compareOptionalStrings(left.localId, right.localId);
}

function compareOptionalTimestamps(left: string | undefined, right: string | undefined): number {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return left.localeCompare(right);
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return left - right;
}

function compareOptionalStrings(left: string | undefined, right: string | undefined): number {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return left.localeCompare(right);
}
