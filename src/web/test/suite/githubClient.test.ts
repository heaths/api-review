import * as assert from 'assert';
import { MemoryCache } from '../../cache';
import {
  createGitHubClient,
  GitHubAuthProvider,
  GitHubPullRequest,
  GitHubTransport,
  GitHubTransportResponse,
  parseGitHubDocument,
  parseGitHubRepository,
} from '../../githubClient';
import * as vscode from 'vscode';

suite('GitHub client', () => {
  test('parses GitHub repository remotes', () => {
    assert.deepStrictEqual(parseGitHubRepository('https://github.com/heaths/api-review.git'), {
      owner: 'heaths',
      repo: 'api-review',
    });
    assert.deepStrictEqual(parseGitHubRepository('git@github.com:heaths/api-review.git'), {
      owner: 'heaths',
      repo: 'api-review',
    });
    assert.deepStrictEqual(parseGitHubRepository('https://github.com/heaths/api.review.git'), {
      owner: 'heaths',
      repo: 'api.review',
    });
    assert.strictEqual(parseGitHubRepository('https://example.com/heaths/api-review.git'), undefined);
  });

  test('parses GitHub web and virtual documents', () => {
    const expected = {
      repository: { owner: 'heaths', repo: 'api-review' },
      ref: 'api-review',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
    };
    assert.deepStrictEqual(parseGitHubDocument(
      'https://github.com/heaths/api-review/blob/api-review/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
    ), expected);
    assert.deepStrictEqual(parseGitHubDocument(
      'https://github.dev/heaths/api-review/blob/api-review/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
    ), expected);
    assert.deepStrictEqual(parseGitHubDocument(
      'vscode-vfs://github/heaths/api-review/api-review/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
    ), expected);
    assert.deepStrictEqual(parseGitHubDocument(
      'vscode-vfs://github/heaths/api-review/e951fe014e6f88027561db809aba0e3e6054a3c6/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
    ), {
      ...expected,
      ref: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
    });
    assert.deepStrictEqual(parseGitHubDocument(
      'https://vscode.dev/heaths/api-review/blob/feature%2Fhistory/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
    ), {
      ...expected,
      ref: 'feature/history',
    });
    assert.strictEqual(parseGitHubDocument('https://example.com/heaths/api-review/blob/main/API.md'), undefined);
  });

  test('loads and caches GitHub tags, commits, and file content', async () => {
    const routes: string[] = [];
    const client = createGitHubClient({
      cache: new MemoryCache(),
      authProvider: createAuthProvider(),
      transportFactory() {
        return {
          async graphql<T>() {
            throw new Error('GraphQL should not be used for repository history');
          },
          async request<T>(
            route: string,
            parameters: Record<string, unknown>,
          ): Promise<GitHubTransportResponse<T>> {
            routes.push(route);
            switch (route) {
              case 'GET /repos/{owner}/{repo}/tags':
                assert.strictEqual(parameters.per_page, 100);
                return createResponse([
                  { name: 'crate@1.0.0', commit: { sha: 'tag-sha' } },
                ]) as unknown as GitHubTransportResponse<T>;
              case 'GET /repos/{owner}/{repo}/commits':
                assert.strictEqual(parameters.sha, 'main');
                assert.strictEqual(parameters.path, 'api/API.md');
                assert.strictEqual(parameters.per_page, 64);
                return createResponse([{
                  sha: 'commit-sha',
                  commit: { message: 'Update API', committer: { date: '2026-09-10T12:00:00Z' } },
                }]) as unknown as GitHubTransportResponse<T>;
              case 'GET /repos/{owner}/{repo}/contents/{path}':
                assert.strictEqual(parameters.ref, 'crate@1.0.0');
                assert.strictEqual(parameters.path, 'api/API.md');
                return createResponse('# API') as unknown as GitHubTransportResponse<T>;
              default:
                throw new Error(`Unexpected route: ${route}`);
            }
          },
        } satisfies GitHubTransport;
      },
    });
    const repository = { owner: 'heaths', repo: 'api-review' };

    assert.deepStrictEqual(await client.getTags({ repository }), [{ name: 'crate@1.0.0', commit: 'tag-sha' }]);
    assert.deepStrictEqual(await client.getTags({ repository }), [{ name: 'crate@1.0.0', commit: 'tag-sha' }]);
    assert.deepStrictEqual(await client.getCommits({
      repository,
      ref: 'main',
      path: 'api/API.md',
      maxEntries: 64,
    }), [{ hash: 'commit-sha', message: 'Update API', committedAt: '2026-09-10T12:00:00Z' }]);
    assert.strictEqual(await client.getFileContent({
      repository,
      ref: 'crate@1.0.0',
      path: 'api/API.md',
    }), '# API');
    assert.deepStrictEqual(routes, [
      'GET /repos/{owner}/{repo}/tags',
      'GET /repos/{owner}/{repo}/tags',
      'GET /repos/{owner}/{repo}/commits',
      'GET /repos/{owner}/{repo}/contents/{path}',
    ]);
  });

  test('resolves the open pull request associated with a commit ref', async () => {
    const routes: string[] = [];
    const client = createGitHubClient({
      cache: new MemoryCache(),
      authProvider: createAuthProvider(),
      transportFactory() {
        return {
          async graphql<T>() {
            throw new Error('GraphQL should not be used for commit PR lookup');
          },
          async request<T>(route: string, parameters: Record<string, unknown>): Promise<GitHubTransportResponse<T>> {
            routes.push(route);
            assert.strictEqual(parameters.commit_sha, 'e951fe014e6f88027561db809aba0e3e6054a3c6');
            return createResponse([
              createPullRequest({
                number: 28,
                state: 'closed',
                title: 'Merged PR',
                headRef: 'feature/history',
                headSha: '1111111111111111111111111111111111111111',
              }),
              createPullRequest({
                number: 42,
                state: 'open',
                title: 'Active PR',
                headRef: 'feature/history',
                headSha: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
              }),
            ]) as unknown as GitHubTransportResponse<T>;
          },
        } satisfies GitHubTransport;
      },
    });

    const pullRequest = await client.getPullRequest({
      repository: { owner: 'heaths', repo: 'api-review' },
      ref: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
    });

    assert.deepStrictEqual(
      pullRequest,
      createExpectedPullRequest(42, 'Active PR', 'open', 'feature/history', 'e951fe014e6f88027561db809aba0e3e6054a3c6'),
    );
    assert.deepStrictEqual(routes, ['GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls']);
  });

  test('falls back to branch lookup when ref is not a commit sha', async () => {
    const routes: string[] = [];
    const client = createGitHubClient({
      cache: new MemoryCache(),
      authProvider: createAuthProvider(),
      transportFactory() {
        return {
          async graphql<T>() {
            throw new Error('GraphQL should not be used for branch PR lookup');
          },
          async request<T>(route: string, parameters: Record<string, unknown>): Promise<GitHubTransportResponse<T>> {
            routes.push(route);
            if (route === 'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls') {
              assert.strictEqual(parameters.commit_sha, 'feature/history');
              return createResponse([]) as unknown as GitHubTransportResponse<T>;
            }

            assert.strictEqual(route, 'GET /repos/{owner}/{repo}/pulls');
            assert.strictEqual(parameters.head, 'heaths:feature/history');
            return createResponse([
              createPullRequest({
                number: 43,
                state: 'open',
                title: 'Branch PR',
                headRef: 'feature/history',
                headSha: '2222222222222222222222222222222222222222',
              }),
            ]) as unknown as GitHubTransportResponse<T>;
          },
        } satisfies GitHubTransport;
      },
    });

    const pullRequest = await client.getPullRequest({
      repository: { owner: 'heaths', repo: 'api-review' },
      ref: 'feature/history',
    });

    assert.deepStrictEqual(
      pullRequest,
      createExpectedPullRequest(43, 'Branch PR', 'open', 'feature/history', '2222222222222222222222222222222222222222'),
    );
    assert.deepStrictEqual(routes, [
      'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls',
      'GET /repos/{owner}/{repo}/pulls',
    ]);
  });

  test('classifies inline pull request comments using associated review metadata', async () => {
    const routes: string[] = [];
    const client = createGitHubClient({
      cache: new MemoryCache(),
      authProvider: createAuthProvider(),
      transportFactory() {
        return {
          async graphql<T>() {
            throw new Error('GraphQL should not be used for review comments');
          },
          async request<T>(route: string, parameters: Record<string, unknown>): Promise<GitHubTransportResponse<T>> {
            routes.push(route);
            switch (route) {
              case 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews':
                assert.strictEqual(parameters.pull_number, 26);
                return createResponse([{
                  id: 5183174172,
                  state: 'COMMENTED',
                  body: 'This is the first review with 1 comment.',
                  commit_id: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
                  user: { login: 'heaths' },
                  submitted_at: '2026-09-11T20:32:06Z',
                }, {
                  id: 5183181104,
                  state: 'COMMENTED',
                  body: '',
                  commit_id: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
                  user: { login: 'heaths' },
                  submitted_at: '2026-09-11T20:32:23Z',
                }, {
                  id: 5183184124,
                  state: 'COMMENTED',
                  body: '',
                  commit_id: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
                  user: { login: 'heaths' },
                  submitted_at: '2026-09-11T20:32:51Z',
                }, {
                  id: 5183188404,
                  state: 'COMMENTED',
                  body: 'This is the second review with 1 reply.',
                  commit_id: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
                  user: { login: 'heaths' },
                  submitted_at: '2026-09-11T20:33:47Z',
                }]) as unknown as GitHubTransportResponse<T>;
              case 'GET /repos/{owner}/{repo}/pulls/{pull_number}/comments':
                assert.strictEqual(parameters.pull_number, 26);
                return createResponse([{
                  id: 3993158275,
                  body: 'This is a review comment.',
                  path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
                  line: 65,
                  commit_id: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
                  pull_request_review_id: 5183174172,
                  user: { login: 'heaths' },
                  created_at: '2026-09-11T20:31:25Z',
                  updated_at: '2026-09-11T20:32:06Z',
                }, {
                  id: 3993164859,
                  body: 'This is an immediate review comment.',
                  path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
                  line: 66,
                  commit_id: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
                  pull_request_review_id: 5183181104,
                  user: { login: 'heaths' },
                  created_at: '2026-09-11T20:32:23Z',
                  updated_at: '2026-09-11T20:32:23Z',
                }, {
                  id: 3993167721,
                  body: 'This is an immediately review comment reply.',
                  path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
                  line: 65,
                  commit_id: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
                  pull_request_review_id: 5183184124,
                  in_reply_to_id: 3993158275,
                  user: { login: 'heaths' },
                  created_at: '2026-09-11T20:32:51Z',
                  updated_at: '2026-09-11T20:32:51Z',
                }, {
                  id: 3993171853,
                  body: 'This is a review comment reply in a separate review.',
                  path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
                  line: 65,
                  commit_id: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
                  pull_request_review_id: 5183188404,
                  in_reply_to_id: 3993158275,
                  user: { login: 'heaths' },
                  created_at: '2026-09-11T20:33:26Z',
                  updated_at: '2026-09-11T20:33:47Z',
                }]) as unknown as GitHubTransportResponse<T>;
              default:
                throw new Error(`Unexpected route: ${route}`);
            }
          },
        } satisfies GitHubTransport;
      },
    });

    const comments = await client.getPullRequestComments({
      repository: { owner: 'heaths', repo: 'api-review' },
      prNumber: 26,
    });

    assert.deepStrictEqual(comments, [{
      id: 3993158275,
      body: 'This is a review comment.',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      line: 65,
      commitId: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
      kind: 'review',
      reviewId: 5183174172,
      inReplyToId: undefined,
      originalPostId: 3993158275,
      author: 'heaths',
      createdAt: '2026-09-11T20:31:25Z',
      updatedAt: '2026-09-11T20:32:06Z',
    }, {
      id: 3993164859,
      body: 'This is an immediate review comment.',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      line: 66,
      commitId: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
      kind: 'individual',
      reviewId: 5183181104,
      inReplyToId: undefined,
      originalPostId: 3993164859,
      author: 'heaths',
      createdAt: '2026-09-11T20:32:23Z',
      updatedAt: '2026-09-11T20:32:23Z',
    }, {
      id: 3993167721,
      body: 'This is an immediately review comment reply.',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      line: 65,
      commitId: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
      kind: 'reply',
      reviewId: 5183184124,
      inReplyToId: 3993158275,
      originalPostId: 3993158275,
      author: 'heaths',
      createdAt: '2026-09-11T20:32:51Z',
      updatedAt: '2026-09-11T20:32:51Z',
    }, {
      id: 3993171853,
      body: 'This is a review comment reply in a separate review.',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      line: 65,
      commitId: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
      kind: 'reply',
      reviewId: 5183188404,
      inReplyToId: 3993158275,
      originalPostId: 3993158275,
      author: 'heaths',
      createdAt: '2026-09-11T20:33:26Z',
      updatedAt: '2026-09-11T20:33:47Z',
    }]);
    assert.deepStrictEqual(routes, [
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/comments',
    ]);
  });

  test('creates, replies to, and updates pull request comments', async () => {
    const routes: string[] = [];
    const client = createGitHubClient({
      cache: new MemoryCache(),
      authProvider: createAuthProvider(),
      transportFactory() {
        return {
          async graphql<T>() {
            throw new Error('GraphQL should not be used for review comments');
          },
          async request<T>(route: string, parameters: Record<string, unknown>): Promise<GitHubTransportResponse<T>> {
            routes.push(route);
            switch (route) {
              case 'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments':
                assert.strictEqual(parameters.pull_number, 42);
                assert.strictEqual(parameters.commit_id, 'commit-sha');
                assert.strictEqual(parameters.path, 'sdk/keyvault/api/API.md');
                assert.strictEqual(parameters.line, 18);
                assert.strictEqual(parameters.side, 'RIGHT');
                assert.strictEqual(parameters.body, 'Immediate comment');
                return createResponse({
                  id: 9,
                  body: 'Immediate comment',
                  path: 'sdk/keyvault/api/API.md',
                  line: 18,
                  commit_id: 'commit-sha',
                  user: { login: 'heaths' },
                  created_at: '2026-09-11T12:45:00Z',
                  updated_at: '2026-09-11T12:45:00Z',
                }) as unknown as GitHubTransportResponse<T>;
              case 'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies':
                assert.strictEqual(parameters.pull_number, 42);
                assert.strictEqual(parameters.comment_id, 7);
                assert.strictEqual(parameters.body, 'Immediate reply');
                return createResponse({
                  id: 10,
                  body: 'Immediate reply',
                  path: 'sdk/keyvault/api/API.md',
                  line: 18,
                  commit_id: 'commit-sha',
                  pull_request_review_id: 12,
                  in_reply_to_id: 7,
                  user: { login: 'heaths' },
                  created_at: '2026-09-11T12:50:00Z',
                  updated_at: '2026-09-11T12:50:00Z',
                }) as unknown as GitHubTransportResponse<T>;
              case 'PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}':
                assert.strictEqual(parameters.comment_id, 7);
                assert.strictEqual(parameters.body, 'Updated docs.');
                return createResponse({
                  id: 7,
                  body: 'Updated docs.',
                  path: 'sdk/keyvault/api/API.md',
                  line: 18,
                  commit_id: 'commit-sha',
                  pull_request_review_id: 12,
                  user: { login: 'heaths' },
                  created_at: '2026-09-11T11:00:00Z',
                  updated_at: '2026-09-11T13:00:00Z',
                }) as unknown as GitHubTransportResponse<T>;
              default:
                throw new Error(`Unexpected route: ${route}`);
            }
          },
        } satisfies GitHubTransport;
      },
    });

    const created = await client.createPullRequestComment({
      repository: { owner: 'heaths', repo: 'api-review' },
      prNumber: 42,
      commitId: 'commit-sha',
      path: 'sdk/keyvault/api/API.md',
      line: 18,
      body: 'Immediate comment',
    });
    const reply = await client.createPullRequestCommentReply({
      repository: { owner: 'heaths', repo: 'api-review' },
      prNumber: 42,
      commentId: 7,
      body: 'Immediate reply',
    });
    const updated = await client.updatePullRequestComment({
      repository: { owner: 'heaths', repo: 'api-review' },
      prNumber: 42,
      commentId: 7,
      body: 'Updated docs.',
    });

    assert.deepStrictEqual(created, {
      id: 9,
      body: 'Immediate comment',
      path: 'sdk/keyvault/api/API.md',
      line: 18,
      commitId: 'commit-sha',
      kind: 'individual',
      reviewId: undefined,
      inReplyToId: undefined,
      originalPostId: 9,
      author: 'heaths',
      createdAt: '2026-09-11T12:45:00Z',
      updatedAt: '2026-09-11T12:45:00Z',
    });
    assert.deepStrictEqual(reply, {
      id: 10,
      body: 'Immediate reply',
      path: 'sdk/keyvault/api/API.md',
      line: 18,
      commitId: 'commit-sha',
      kind: 'reply',
      reviewId: 12,
      inReplyToId: 7,
      originalPostId: 7,
      author: 'heaths',
      createdAt: '2026-09-11T12:50:00Z',
      updatedAt: '2026-09-11T12:50:00Z',
    });
    assert.deepStrictEqual(updated, {
      id: 7,
      body: 'Updated docs.',
      path: 'sdk/keyvault/api/API.md',
      line: 18,
      commitId: 'commit-sha',
      kind: 'review',
      reviewId: 12,
      inReplyToId: undefined,
      originalPostId: 7,
      author: 'heaths',
      createdAt: '2026-09-11T11:00:00Z',
      updatedAt: '2026-09-11T13:00:00Z',
    });
    assert.deepStrictEqual(routes, [
      'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments',
      'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies',
      'PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}',
    ]);
  });

  test('loads pull request reviews', async () => {
    const routes: string[] = [];
    const client = createGitHubClient({
      cache: new MemoryCache(),
      authProvider: createAuthProvider(),
      transportFactory() {
        return {
          async graphql<T>() {
            throw new Error('GraphQL should not be used for pull request reviews');
          },
          async request<T>(route: string, parameters: Record<string, unknown>): Promise<GitHubTransportResponse<T>> {
            routes.push(route);
            assert.strictEqual(route, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews');
            assert.strictEqual(parameters.pull_number, 42);
            return createResponse([{
              id: 12,
              state: 'APPROVED',
              body: 'Ship it.',
              commit_id: 'commit-sha',
              user: { login: 'heaths' },
              submitted_at: '2026-09-11T14:00:00Z',
            }]) as unknown as GitHubTransportResponse<T>;
          },
        } satisfies GitHubTransport;
      },
    });

    const reviews = await client.getPullRequestReviews({
      repository: { owner: 'heaths', repo: 'api-review' },
      prNumber: 42,
    });

    assert.deepStrictEqual(reviews, [{
      id: 12,
      state: 'APPROVED',
      body: 'Ship it.',
      commitId: 'commit-sha',
      author: 'heaths',
      submittedAt: '2026-09-11T14:00:00Z',
    }]);
    assert.deepStrictEqual(routes, ['GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews']);
  });

  test('submits a pull request review with draft comments', async () => {
    const routes: string[] = [];
    const client = createGitHubClient({
      cache: new MemoryCache(),
      authProvider: createAuthProvider(),
      transportFactory() {
        return {
          async graphql<T>() {
            throw new Error('GraphQL should not be used for review submission');
          },
          async request<T>(route: string, parameters: Record<string, unknown>): Promise<GitHubTransportResponse<T>> {
            routes.push(route);
            assert.strictEqual(route, 'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews');
            assert.strictEqual(parameters.pull_number, 42);
            assert.strictEqual(parameters.commit_id, 'commit-sha');
            assert.strictEqual(parameters.event, 'APPROVE');
            assert.deepStrictEqual(parameters.comments, [{
              path: 'sdk/keyvault/api/API.md',
              line: 18,
              side: 'RIGHT',
              body: 'Looks good.',
            }]);
            return createResponse({}) as unknown as GitHubTransportResponse<T>;
          },
        } satisfies GitHubTransport;
      },
    });

    await client.submitPullRequestReview({
      repository: { owner: 'heaths', repo: 'api-review' },
      prNumber: 42,
      commitId: 'commit-sha',
      event: 'APPROVE',
      comments: [{
        path: 'sdk/keyvault/api/API.md',
        line: 18,
        body: 'Looks good.',
      }],
    });

    assert.deepStrictEqual(routes, ['POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews']);
  });

  test('returns undefined when GitHub auth is unavailable', async () => {
    let transportCreations = 0;
    const client = createGitHubClient({
      cache: new MemoryCache(),
      authProvider: {
        async getSession() {
          return undefined;
        },
      } satisfies GitHubAuthProvider,
      transportFactory() {
        transportCreations++;
        throw new Error('transport should not be created');
      },
    });

    const result = await client.getPullRequestBase({
      repository: { owner: 'heaths', repo: 'api-review' },
      branch: 'feature/refactor',
    });

    assert.strictEqual(result, undefined);
    assert.strictEqual(transportCreations, 0);
  });

  test('uses GraphQL results and serves cached data on repeated lookups', async () => {
    let graphqlCalls = 0;
    let restCalls = 0;
    let transportCreations = 0;
    const client = createGitHubClient({
      cache: new MemoryCache(),
      authProvider: createAuthProvider(),
      transportFactory() {
        transportCreations++;
        const graphQlResponse = {
          search: {
            nodes: [{
              title: 'Update API review docs',
              headRefName: 'feature/refactor',
              headRepositoryOwner: { login: 'heaths' },
              baseRefName: 'main',
              baseRefOid: 'abc123',
            }],
          },
        };
        return {
          async graphql<T>() {
            graphqlCalls++;
            return graphQlResponse as T;
          },
          async request<T>() {
            restCalls++;
            throw new Error('REST should not be used when GraphQL succeeds');
          },
        } satisfies GitHubTransport;
      },
      now: () => 100,
    });

    const first = await client.getPullRequestBase({
      repository: { owner: 'heaths', repo: 'api-review' },
      branch: 'feature/refactor',
    });
    const second = await client.getPullRequestBase({
      repository: { owner: 'heaths', repo: 'api-review' },
      branch: 'feature/refactor',
    });

    assert.deepStrictEqual(first, {
      baseSha: 'abc123',
      baseRef: 'main',
      title: 'Update API review docs',
    });
    assert.deepStrictEqual(second, first);
    assert.strictEqual(graphqlCalls, 1);
    assert.strictEqual(restCalls, 0);
    assert.strictEqual(transportCreations, 1);
  });

  test('falls back to REST and reuses cached data on 304 responses', async () => {
    let graphqlCalls = 0;
    let restCalls = 0;
    const client = createGitHubClient({
      cache: new MemoryCache(),
      authProvider: createAuthProvider(),
      transportFactory() {
        const graphQlResponse = { search: { nodes: [] } };
        const restResponse = {
          data: [{ title: 'Open PR', base: { sha: 'def456', ref: 'main' } }],
          headers: { etag: 'W/"pr-base"' },
          status: 200,
        } satisfies GitHubTransportResponse<unknown>;
        return {
          async graphql<T>() {
            graphqlCalls++;
            return graphQlResponse as T;
          },
          async request<T>() {
            restCalls++;
            if (restCalls === 1) {
              return restResponse as unknown as GitHubTransportResponse<T>;
            }

            const error = new Error('Not Modified') as Error & { status?: number };
            error.status = 304;
            throw error;
          },
        } satisfies GitHubTransport;
      },
      now: () => 200,
    });

    const first = await client.getPullRequestBase({
      repository: { owner: 'heaths', repo: 'api-review' },
      branch: 'feature/refactor',
    });
    const second = await client.getPullRequestBase({
      repository: { owner: 'heaths', repo: 'api-review' },
      branch: 'feature/refactor',
    });

    assert.deepStrictEqual(first, {
      baseSha: 'def456',
      baseRef: 'main',
      title: 'Open PR',
    });
    assert.deepStrictEqual(second, first);
    assert.strictEqual(graphqlCalls, 2);
    assert.strictEqual(restCalls, 2);
  });

  test('logs when cached GitHub data is reused after a refresh failure', async () => {
    const warnings: string[] = [];
    let loggerPassedToTransport = false;
    let requestCalls = 0;
    const logger = {
      logLevel: vscode.LogLevel.Debug,
      onDidChangeLogLevel: () => ({ dispose() { } }),
      trace() { },
      debug() { },
      info() { },
      warn(...args: unknown[]) {
        warnings.push(args.map(value => value instanceof Error ? value.message : String(value)).join(' '));
      },
      error() { },
      append() { },
      appendLine() { },
      replace() { },
      clear() { },
      show() { },
      hide() { },
      dispose() { },
      name: 'test',
    } as unknown as vscode.LogOutputChannel;
    const client = createGitHubClient({
      cache: new MemoryCache(),
      logger,
      authProvider: createAuthProvider(),
      transportFactory(_accessToken, receivedLogger) {
        loggerPassedToTransport = receivedLogger === logger;
        return {
          async graphql<T>() {
            throw new Error('GraphQL should not be used for repository history');
          },
          async request<T>(route: string): Promise<GitHubTransportResponse<T>> {
            requestCalls++;
            assert.strictEqual(route, 'GET /repos/{owner}/{repo}/tags');
            if (requestCalls === 1) {
              return createResponse([
                { name: 'crate@1.0.0', commit: { sha: 'tag-sha' } },
              ]) as unknown as GitHubTransportResponse<T>;
            }

            throw new Error('offline');
          },
        } satisfies GitHubTransport;
      },
    });
    const repository = { owner: 'heaths', repo: 'api-review' };

    assert.deepStrictEqual(await client.getTags({ repository }), [{ name: 'crate@1.0.0', commit: 'tag-sha' }]);
    assert.deepStrictEqual(await client.getTags({ repository }), [{ name: 'crate@1.0.0', commit: 'tag-sha' }]);
    assert.strictEqual(loggerPassedToTransport, true);
    assert.deepStrictEqual(warnings, ['Unable to refresh GitHub data; using cached data: offline']);
  });
});

function createAuthProvider(): GitHubAuthProvider {
  return {
    async getSession() {
      return {
        accessToken: 'token',
        accountId: 'account-id',
      };
    },
  };
}

function createResponse<T>(data: T): GitHubTransportResponse<T> {
  return { data, headers: {}, status: 200 };
}

function createPullRequest(overrides: {
  number: number;
  state: 'open' | 'closed';
  title: string;
  headRef: string;
  headSha: string;
}): Record<string, unknown> {
  return {
    number: overrides.number,
    state: overrides.state,
    title: overrides.title,
    base: { ref: 'main', sha: 'base-sha' },
    head: {
      ref: overrides.headRef,
      sha: overrides.headSha,
      repo: { owner: { login: 'heaths' } },
    },
  };
}

function createExpectedPullRequest(
  number: number,
  title: string,
  state: 'open' | 'closed',
  headRef: string,
  headSha: string,
): GitHubPullRequest {
  return {
    number,
    title,
    state,
    baseRef: 'main',
    baseSha: 'base-sha',
    headRef,
    headSha,
    headOwner: 'heaths',
  };
}
