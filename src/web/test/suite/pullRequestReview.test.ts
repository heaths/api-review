import * as assert from 'assert';
import { PullRequestReviewController } from '../../pullRequestReview';
import {
  GitHubClient,
  GitHubPullRequest,
  GitHubPullRequestComment,
} from '../../githubClient';

suite('Pull request review controller', () => {
  const document = {
    repository: { owner: 'heaths', repo: 'api-review' },
    ref: 'commit-sha',
    path: 'sdk/keyvault/api/API.md',
  };
  const pullRequest: GitHubPullRequest = {
    number: 42,
    title: 'Add preview review actions',
    state: 'open',
    baseRef: 'main',
    baseSha: 'base-sha',
    headRef: 'feature/history',
    headSha: 'commit-sha',
    headOwner: 'heaths',
  };

  test('merges submitted comments with in-memory drafts', async () => {
    let persistedComments: GitHubPullRequestComment[] = [{
      id: 5,
      body: 'Existing comment',
      path: document.path,
      line: 10,
      commitId: 'commit-sha',
      kind: 'individual',
      reviewId: undefined,
      inReplyToId: undefined,
      originalPostId: 5,
      author: 'heaths',
      createdAt: '2026-09-11T09:00:00Z',
      updatedAt: '2026-09-11T10:00:00Z',
    }];
    const client: GitHubClient = {
      isGitHubDocument() {
        return false;
      },
      resolveDocument() {
        return undefined;
      },
      async getPullRequest() {
        return undefined;
      },
      async getPullRequestComments() {
        return persistedComments;
      },
      async getPullRequestReviews() {
        return undefined;
      },
      async createPullRequestComment() {
        return undefined;
      },
      async createPullRequestCommentReply() {
        return undefined;
      },
      async updatePullRequestComment(request) {
        persistedComments = persistedComments.map(comment => comment.id === request.commentId
          ? { ...comment, body: request.body, updatedAt: '2026-09-11T11:00:00Z' }
          : comment);
        return persistedComments[0];
      },
      async deletePullRequestComment(request) {
        persistedComments = persistedComments.filter(comment => comment.id !== request.commentId);
        return true;
      },
      async submitPullRequestReview() {
      },
      async getPullRequestBase() {
        return undefined;
      },
      async getTags() {
        return undefined;
      },
      async getCommits() {
        return undefined;
      },
      async getFileContent() {
        return undefined;
      },
    };
    const controller = new PullRequestReviewController(client);

    assert.strictEqual(controller.hasPendingReview(document, pullRequest), false);
    await controller.upsertComment(document, pullRequest, 12, 'Draft comment');
    assert.strictEqual(controller.hasPendingReview(document, pullRequest), true);
    const commentsWithDraft = await controller.getLineComments(document, pullRequest);
    await controller.upsertComment(document, pullRequest, 9, 'Edited existing', commentsWithDraft.get(9)?.[0]);
    await controller.deleteComment(document, pullRequest, 12, commentsWithDraft.get(12)?.[0]);
    assert.strictEqual(controller.hasPendingReview(document, pullRequest), false);
    const comments = await controller.getLineComments(document, pullRequest);

    assert.deepStrictEqual([...comments.entries()], [[9, [{
      id: 5,
      body: 'Edited existing',
      sourceLine: 9,
      kind: 'individual',
      reviewId: undefined,
      inReplyToId: undefined,
      originalPostId: 5,
      author: 'heaths',
      createdAt: '2026-09-11T09:00:00Z',
      updatedAt: '2026-09-11T11:00:00Z',
      isDraft: false,
    }]]]);
  });

  test('creates immediate replies and submits pending draft comments', async () => {
    const replies: unknown[] = [];
    const submissions: unknown[] = [];
    const client: GitHubClient = {
      isGitHubDocument() {
        return false;
      },
      resolveDocument() {
        return undefined;
      },
      async getPullRequest() {
        return undefined;
      },
      async getPullRequestComments() {
        return [{
          id: 5,
          body: 'Existing comment',
          path: document.path,
          line: 10,
          commitId: 'commit-sha',
          kind: 'review',
          reviewId: 12,
          inReplyToId: undefined,
          originalPostId: 5,
          author: 'heaths',
          createdAt: '2026-09-11T09:00:00Z',
          updatedAt: '2026-09-11T10:00:00Z',
        }];
      },
      async getPullRequestReviews() {
        return undefined;
      },
      async createPullRequestComment() {
        return undefined;
      },
      async createPullRequestCommentReply(request) {
        replies.push(request);
        return {
          id: 6,
          body: request.body,
          path: document.path,
          line: 10,
          commitId: 'commit-sha',
          kind: 'reply',
          reviewId: 12,
          inReplyToId: 5,
          originalPostId: 5,
          author: 'local',
          createdAt: '2026-09-11T11:30:00Z',
          updatedAt: '2026-09-11T11:30:00Z',
        };
      },
      async updatePullRequestComment() {
        return undefined;
      },
      async deletePullRequestComment() {
        return true;
      },
      async submitPullRequestReview(request) {
        submissions.push(request);
      },
      async getPullRequestBase() {
        return undefined;
      },
      async getTags() {
        return undefined;
      },
      async getCommits() {
        return undefined;
      },
      async getFileContent() {
        return undefined;
      },
    };
    const controller = new PullRequestReviewController(client);

    await controller.upsertComment(document, pullRequest, 11, 'Pending review comment');
    assert.strictEqual(controller.hasPendingReview(document, pullRequest), true);
    const reply = await controller.replyToComment(document, pullRequest, 9, 5, 'Reply immediately');
    const submittedCount = await controller.submitReview(document, pullRequest, 'REQUEST_CHANGES', 'Needs work');
    assert.strictEqual(controller.hasPendingReview(document, pullRequest), false);

    assert.deepStrictEqual(reply, {
      id: 6,
      body: 'Reply immediately',
      sourceLine: 9,
      kind: 'reply',
      reviewId: 12,
      inReplyToId: 5,
      originalPostId: 5,
      author: 'local',
      createdAt: '2026-09-11T11:30:00Z',
      updatedAt: '2026-09-11T11:30:00Z',
      isDraft: false,
    });
    assert.strictEqual(submittedCount, 1);
    assert.deepStrictEqual(replies, [{
      repository: document.repository,
      prNumber: 42,
      commentId: 5,
      body: 'Reply immediately',
      promptForAuth: true,
    }]);
    assert.deepStrictEqual(submissions, [{
      repository: document.repository,
      prNumber: 42,
      commitId: 'commit-sha',
      event: 'REQUEST_CHANGES',
      body: 'Needs work',
      comments: [{
        path: document.path,
        line: 12,
        body: 'Pending review comment',
      }],
      promptForAuth: true,
    }]);
  });

  test('forwards an overall review body on submission', async () => {
    const submissions: unknown[] = [];
    const client: GitHubClient = {
      isGitHubDocument() {
        return false;
      },
      resolveDocument() {
        return undefined;
      },
      async getPullRequest() {
        return undefined;
      },
      async getPullRequestComments() {
        return [];
      },
      async getPullRequestReviews() {
        return undefined;
      },
      async createPullRequestComment() {
        return undefined;
      },
      async createPullRequestCommentReply() {
        return undefined;
      },
      async updatePullRequestComment() {
        return undefined;
      },
      async deletePullRequestComment() {
        return true;
      },
      async submitPullRequestReview(request) {
        submissions.push(request);
      },
      async getPullRequestBase() {
        return undefined;
      },
      async getTags() {
        return undefined;
      },
      async getCommits() {
        return undefined;
      },
      async getFileContent() {
        return undefined;
      },
    };
    const controller = new PullRequestReviewController(client);

    await controller.submitReview(document, pullRequest, 'APPROVE', '  Looks good overall.  ');

    assert.deepStrictEqual(submissions, [{
      repository: document.repository,
      prNumber: 42,
      commitId: 'commit-sha',
      event: 'APPROVE',
      body: 'Looks good overall.',
      comments: [],
      promptForAuth: true,
    }]);
  });
});
