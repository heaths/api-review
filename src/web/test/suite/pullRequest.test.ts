import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitClient } from '../../gitClient';
import { GitHubClient, parseGitHubDocument } from '../../githubClient';
import { PullRequestService } from '../../pullRequest';

function createGitHubClient(overrides: Partial<GitHubClient>): GitHubClient {
  return {
    isGitHubDocument(uri) {
      return overrides.resolveDocument?.(uri) !== undefined;
    },
    resolveDocument() {
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
    async getPullRequest() {
      return undefined;
    },
    async getPullRequestComments() {
      return undefined;
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
      return false;
    },
    async submitPullRequestReview() {
    },
    async getPullRequestBase() {
      return undefined;
    },
    ...overrides,
  };
}

function createGitClient(overrides: Partial<GitClient>): GitClient {
  return {
    async getRepository() {
      return undefined;
    },
    async watchState() {
      return new vscode.Disposable(() => { });
    },
    ...overrides,
  };
}

suite('Pull request service', () => {
  test('replaces a cached miss when retrying pull request detection for a GitHub virtual document', async () => {
    const documentRef = {
      repository: { owner: 'heaths', repo: 'api-review' },
      ref: 'api-review',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
    };
    const document = {
      uri: vscode.Uri.parse(
        'vscode-vfs://github/heaths/api-review/api-review/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      ),
    } as vscode.TextDocument;
    const promptValues: boolean[] = [];
    const githubClient = createGitHubClient({
      resolveDocument(uri) {
        return uri.scheme === 'vscode-vfs' ? documentRef : undefined;
      },
      async getPullRequest(request) {
        promptValues.push(request.promptForAuth === true);
        return request.promptForAuth ? {
          number: 26,
          title: 'azure_security_keyvault_keys@1.1.0-beta.1',
          state: 'open',
          baseRef: 'azure_security_keyvault_keys@base',
          baseSha: 'base-sha',
          headRef: 'api-review',
          headSha: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
          headOwner: 'heaths',
        } : undefined;
      },
    });
    const service = new PullRequestService(githubClient, createGitClient({}));

    assert.strictEqual(githubClient.isGitHubDocument(document.uri), true);
    assert.strictEqual(githubClient.isGitHubDocument(vscode.Uri.parse('test-workspace:/API.md')), false);
    assert.strictEqual(await service.getContext(document), undefined);

    const context = await service.getContext(document, { promptForGitHubAuth: true });
    const cached = await service.getContext(document);

    assert.strictEqual(context?.pullRequest.number, 26);
    assert.strictEqual(cached?.pullRequest.number, 26);
    assert.deepStrictEqual(context?.document, documentRef);
    assert.deepStrictEqual(promptValues, [false, true]);
  });

  test('does not infer pull request context from a commit permalink', async () => {
    const document = {
      uri: vscode.Uri.parse(
        'vscode-vfs://github/heaths/api-review/e951fe014e6f88027561db809aba0e3e6054a3c6/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      ),
    } as vscode.TextDocument;
    let pullRequestLookups = 0;
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
          path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
        };
      },
      async getPullRequest() {
        pullRequestLookups++;
        return undefined;
      },
    });
    const service = new PullRequestService(githubClient, createGitClient({}));

    assert.strictEqual(await service.getContext(document), undefined);
    assert.strictEqual(pullRequestLookups, 0);
  });

  test('continues pull request detection for a hex-only branch name', async () => {
    const document = {
      uri: vscode.Uri.parse('vscode-vfs://github/heaths/api-review/deadbeef/api/API.md'),
    } as vscode.TextDocument;
    const pullRequestRefs: string[] = [];
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'deadbeef',
          path: 'api/API.md',
        };
      },
      async getPullRequest(request) {
        pullRequestRefs.push(request.ref);
        return undefined;
      },
    });
    const service = new PullRequestService(githubClient, createGitClient({}));

    assert.strictEqual(await service.getContext(document), undefined);
    assert.deepStrictEqual(pullRequestRefs, ['deadbeef']);
  });

  test('uses the upstream branch name before the local branch name for local repository detection', async () => {
    const document = {
      uri: vscode.Uri.parse('file:///workspace/sdk/keyvault/azure_security_keyvault_keys/api/API.md'),
    } as vscode.TextDocument;
    const pullRequestRefs: string[] = [];
    const githubClient = createGitHubClient({
      async getPullRequest(request) {
        pullRequestRefs.push(request.ref);
        if (request.ref !== 'feature/history') {
          return undefined;
        }

        return {
          number: 26,
          title: 'Active PR',
          state: 'open',
          baseRef: 'main',
          baseSha: 'base-sha',
          headRef: 'feature/history',
          headSha: 'head-sha',
          headOwner: 'heaths',
        };
      },
    });
    const gitClient = createGitClient({
      async getRepository() {
        return {
          rootUri: vscode.Uri.parse('file:///workspace'),
          state: {
            HEAD: {
              name: 'pr/26',
              upstream: {
                remote: 'origin',
                name: 'refs/heads/feature/history',
              },
              commit: 'e951fe014e6f88027561db809aba0e3e6054a3c6',
            },
            remotes: [{
              name: 'origin',
              fetchUrl: 'https://github.com/heaths/api-review.git',
            }],
          },
          async getRefs() {
            return [];
          },
          async log() {
            return [];
          },
          async show() {
            return '';
          },
        };
      },
    });
    const service = new PullRequestService(githubClient, gitClient);

    const context = await service.getContext(document);

    assert.strictEqual(context?.pullRequest.number, 26);
    assert.deepStrictEqual(pullRequestRefs, ['feature/history']);
    assert.deepStrictEqual(context?.document, {
      repository: { owner: 'heaths', repo: 'api-review' },
      ref: 'feature/history',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
    });
  });

  test('parses current encoded PR-backed GitHub documents into pull request context', async () => {
    const uri = vscode.Uri.parse(
      'vscode-vfs://github%2B7b2276223a312c22726566223a7b2274797065223a332c226964223a223236227d7d/heaths/api-review/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
    );
    const document = { uri } as vscode.TextDocument;
    const githubClient = createGitHubClient({
      resolveDocument(parsedUri) {
        return parseGitHubDocument(parsedUri.toString(true));
      },
      async getPullRequest(request) {
        assert.strictEqual(request.ref, 'refs/pull/26/head');
        return {
          number: 26,
          title: 'Active PR',
          state: 'open',
          baseRef: 'main',
          baseSha: 'base-sha',
          headRef: 'feature/history',
          headSha: 'head-sha',
          headOwner: 'heaths',
        };
      },
    });
    const service = new PullRequestService(githubClient, createGitClient({}));

    const context = await service.getContext(document);

    assert.deepStrictEqual(context?.document, {
      repository: { owner: 'heaths', repo: 'api-review' },
      ref: 'refs/pull/26/head',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      pullRequestNumber: 26,
    });
    assert.strictEqual(context?.pullRequest.number, 26);
  });
});
