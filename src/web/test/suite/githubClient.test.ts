import * as assert from 'assert';
import { MemoryCache } from '../../cache';
import {
  createGitHubClient,
  GitHubAuthProvider,
  GitHubTransport,
  GitHubTransportResponse,
  parseGitHubDocument,
  parseGitHubRepository,
} from '../../githubClient';

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
