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
      author: 'heaths',
      updatedAt: '2026-09-11T10:00:00Z',
    }];
    const client: GitHubClient = {
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

    await controller.upsertComment(document, pullRequest, 12, 'Draft comment');
    const commentsWithDraft = await controller.getLineComments(document, pullRequest);
    await controller.upsertComment(document, pullRequest, 9, 'Edited existing', commentsWithDraft.get(9));
    await controller.deleteComment(document, pullRequest, 12, commentsWithDraft.get(12));
    const comments = await controller.getLineComments(document, pullRequest);

    assert.deepStrictEqual([...comments.entries()], [[9, {
      id: 5,
      body: 'Edited existing',
      sourceLine: 9,
      author: 'heaths',
      updatedAt: '2026-09-11T11:00:00Z',
      isDraft: false,
    }]]);
  });

  test('forwards an overall review body on submission', async () => {
    const submissions: unknown[] = [];
    const client: GitHubClient = {
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
