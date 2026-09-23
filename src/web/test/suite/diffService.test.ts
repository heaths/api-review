import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  DiffCandidate,
  DiffService,
  getFileBaselineLabel,
  parseConfiguredTagVersion,
  selectDefaultBaseline,
  TagCandidate,
} from '../../diffService';
import { GitClient } from '../../gitClient';
import { GitHubClient } from '../../githubClient';
import { PullRequestService } from '../../pullRequestService';
import { renderDiffView } from '../../diffView';
import { createDiffLineMetadata, createMarkdownViewLineMetadata } from '../../lineMetadata';
import { createDiffQuickPickCandidate, renderMarkdown } from '../../markdownView';
import { compareVersions, parseVersion } from '../../semver';

function createLogger(): vscode.LogOutputChannel {
  return {
    logLevel: vscode.LogLevel.Debug,
    onDidChangeLogLevel: () => ({ dispose() { } }),
    trace() { },
    debug() { },
    info() { },
    warn() { },
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
}

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
    async getCommit() {
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

function createGitClient(overrides: Partial<GitClient> = {}): GitClient {
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

function createPullRequestService(
  overrides: Partial<PullRequestService> = {},
): PullRequestService {
  return {
    invalidate() { },
    async getContext() {
      return undefined;
    },
    ...overrides,
  } as PullRequestService;
}

suite('Diff service', () => {
  test('uses pull request context from the dedicated service for PR-backed GitHub history', async () => {
    const githubDocument = {
      repository: { owner: 'heaths', repo: 'api-review' },
      ref: 'refs/pull/26/head',
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      pullRequestNumber: 26,
    };
    const document = {
      uri: vscode.Uri.parse(
        'vscode-vfs://github%2B7b2276223a312c22726566223a7b2274797065223a332c226964223a223236227d7d/heaths/api-review/sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      ),
    } as vscode.TextDocument;
    const headSha = 'e951fe014e6f88027561db809aba0e3e6054a3c6';
    const commitRefs: string[] = [];
    const githubClient = createGitHubClient({
      resolveDocument() {
        return githubDocument;
      },
      async getTags() {
        return [{ name: 'azure_security_keyvault_keys@1.0.0', commit: 'tagged-commit' }];
      },
      async getCommits(request) {
        commitRefs.push(request.ref);
        return [{ hash: headSha, message: 'Update API', committedAt: '2026-09-10T12:00:00Z' }];
      },
      async getCommit() {
        return { hash: headSha, message: 'Update API', committedAt: '2026-09-10T12:00:00Z' };
      },
      async getFileContent() {
        return '# Baseline';
      },
      async getPullRequestBase() {
        throw new Error('Explicit pull request metadata should provide the base.');
      },
    });
    const service = new DiffService(
      createLogger(),
      githubClient,
      createGitClient(),
      createPullRequestService({
        async getContext() {
          return {
            document: githubDocument,
            pullRequest: {
              number: 26,
              title: 'azure_security_keyvault_keys@1.1.0-beta.1',
              state: 'open',
              baseRef: 'main',
              baseSha: 'tagged-commit',
              headRef: 'feature/history',
              headSha,
              headOwner: 'heaths',
            },
          };
        },
      }),
    );

    const availability = await service.getAvailability(document);

    assert.deepStrictEqual(commitRefs, [headSha]);
    assert.deepStrictEqual(availability.candidates.map(candidate => candidate.baseline), [
      { kind: 'tag', ref: 'azure_security_keyvault_keys@1.0.0' },
    ]);
    assert.deepStrictEqual(availability.pullRequestBase, {
      baseline: { kind: 'tag', ref: 'azure_security_keyvault_keys@1.0.0' },
      label: 'azure_security_keyvault_keys@1.0.0',
      description: '2026-09-10',
      detail: 'Update API',
    });
    assert.deepStrictEqual(availability.defaultBaseline, {
      kind: 'tag',
      ref: 'azure_security_keyvault_keys@1.0.0',
    });
  });

  test('uses GitHub history when local Git is unavailable', async () => {
    const document = {
      uri: vscode.Uri.parse(
        'https://github.dev/heaths/api-review/blob/main/sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      ),
    } as vscode.TextDocument;
    const gitClient = createGitClient();
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'main',
          path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
        };
      },
      async getTags() {
        return [{ name: 'azure_security_keyvault_keys@1.0.0', commit: 'tagged-commit' }];
      },
      async getCommits() {
        return [
          { hash: 'head-commit', message: 'Update API', committedAt: '2026-09-10T12:00:00Z' },
          { hash: 'newer-commit', message: 'Earlier API update', committedAt: '2026-09-09T12:00:00Z' },
        ];
      },
      async getCommit() {
        return { hash: 'head-commit', message: 'Update API', committedAt: '2026-09-10T12:00:00Z' };
      },
      async getFileContent() {
        return '# Baseline';
      },
      async getPullRequest() {
        return undefined;
      },
      async getPullRequestBase() {
        return undefined;
      },
    });
    const service = new DiffService(createLogger(), githubClient, gitClient, createPullRequestService());

    const availability = await service.getAvailability(document);
    const resolved = await service.resolveBaseline(document, { kind: 'tag', ref: 'azure_security_keyvault_keys@1.0.0' });

    assert.deepStrictEqual(availability.candidates.map(candidate => candidate.baseline), [
      { kind: 'tag', ref: 'azure_security_keyvault_keys@1.0.0' },
      { kind: 'commit', ref: 'newer-commit' },
    ]);
    assert.deepStrictEqual(availability.defaultBaseline, {
      kind: 'tag',
      ref: 'azure_security_keyvault_keys@1.0.0',
    });
    assert.strictEqual(resolved.markdown, '# Baseline');
  });

  test('keeps commit history when GitHub tags fail', async () => {
    const document = {
      uri: vscode.Uri.parse(
        'https://github.dev/heaths/api-review/blob/main/sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      ),
    } as vscode.TextDocument;
    const gitClient = createGitClient();
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'main',
          path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
        };
      },
      async getTags() {
        throw new Error('tags failed');
      },
      async getCommits() {
        return [
          { hash: 'head-commit', message: 'Update API', committedAt: '2026-09-10T12:00:00Z' },
          { hash: 'newer-commit', message: 'Earlier API update', committedAt: '2026-09-09T12:00:00Z' },
        ];
      },
      async getCommit() {
        return { hash: 'head-commit', message: 'Update API', committedAt: '2026-09-10T12:00:00Z' };
      },
      async getFileContent() {
        return '# Baseline';
      },
      async getPullRequest() {
        return undefined;
      },
      async getPullRequestBase() {
        return undefined;
      },
    });
    const service = new DiffService(createLogger(), githubClient, gitClient, createPullRequestService());

    const availability = await service.getAvailability(document);

    assert.deepStrictEqual(availability.candidates.map(candidate => candidate.baseline), [
      { kind: 'commit', ref: 'newer-commit' },
    ]);
    assert.deepStrictEqual(availability.defaultBaseline, {
      kind: 'commit',
      ref: 'newer-commit',
    });
  });

  test('keeps tag history when GitHub commits fail', async () => {
    const document = {
      uri: vscode.Uri.parse(
        'https://github.dev/heaths/api-review/blob/main/sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      ),
    } as vscode.TextDocument;
    const gitClient = createGitClient();
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'main',
          path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
        };
      },
      async getTags() {
        return [{ name: 'azure_security_keyvault_keys@1.0.0', commit: 'tagged-commit' }];
      },
      async getCommit() {
        return { hash: 'tagged-commit', message: 'Tagged API', committedAt: '2026-09-10T12:00:00Z' };
      },
      async getCommits() {
        throw new Error('commits failed');
      },
      async getFileContent() {
        return '# Baseline';
      },
      async getPullRequest() {
        return undefined;
      },
      async getPullRequestBase() {
        return undefined;
      },
    });
    const service = new DiffService(createLogger(), githubClient, gitClient, createPullRequestService());

    const availability = await service.getAvailability(document);

    assert.deepStrictEqual(availability.candidates.map(candidate => candidate.baseline), [
      { kind: 'tag', ref: 'azure_security_keyvault_keys@1.0.0' },
    ]);
    assert.deepStrictEqual(availability.defaultBaseline, {
      kind: 'tag',
      ref: 'azure_security_keyvault_keys@1.0.0',
    });
  });

  test('skips GitHub tags that do not contain the current API file', async () => {
    const document = {
      uri: vscode.Uri.parse(
        'https://github.dev/heaths/api-review/blob/main/src/web/test/fixtures/v2/api.md',
      ),
    } as vscode.TextDocument;
    const gitClient = createGitClient();
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'main',
          path: 'src/web/test/fixtures/v2/api.md',
        };
      },
      async getTags() {
        return [{ name: '0.1.0', commit: 'tagged-commit' }];
      },
      async getCommit() {
        return { hash: 'head-commit', message: 'Add fixture API', committedAt: '2026-09-10T12:00:00Z' };
      },
      async getCommits() {
        return [
          { hash: 'head-commit', message: 'Add fixture API', committedAt: '2026-09-10T12:00:00Z' },
          { hash: 'newer-commit', message: 'Earlier fixture API', committedAt: '2026-09-09T12:00:00Z' },
        ];
      },
      async getFileContent(request) {
        return request.ref === '0.1.0' ? undefined : '# Baseline';
      },
      async getPullRequest() {
        return undefined;
      },
      async getPullRequestBase() {
        return undefined;
      },
    });
    const service = new DiffService(createLogger(), githubClient, gitClient, createPullRequestService());

    const availability = await service.getAvailability(document);

    assert.deepStrictEqual(availability.candidates.map(candidate => candidate.baseline), [
      { kind: 'commit', ref: 'newer-commit' },
    ]);
    assert.deepStrictEqual(availability.defaultBaseline, {
      kind: 'commit',
      ref: 'newer-commit',
    });
  });

  test('uses safe first-line details for tags and commits', async () => {
    const document = {
      uri: vscode.Uri.parse(
        'https://github.dev/heaths/api-review/blob/main/sdk/keyvault/azure_security_keyvault_keys/api/api.md',
      ),
    } as vscode.TextDocument;
    const gitClient = createGitClient();
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'main',
          path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
        };
      },
      async getTags() {
        return [{ name: 'azure_security_keyvault_keys@1.0.0', commit: 'tagged-commit' }];
      },
      async getCommit(request) {
        if (request.ref === 'main') {
          return { hash: 'head-commit', message: 'Update API', committedAt: '2026-09-10T12:00:00Z' };
        }
        return {
          hash: 'tagged-commit',
          message: 'Release API\n\n----- BEGIN PGP SIGNATURE-----',
          committedAt: '2026-09-09T12:00:00Z',
        };
      },
      async getCommits() {
        return [
          { hash: 'head-commit', message: 'Update API', committedAt: '2026-09-10T12:00:00Z' },
          { hash: 'older-commit', message: '----- BEGIN PGP SIGNATURE-----', committedAt: '2026-09-08T12:00:00Z' },
        ];
      },
      async getFileContent() {
        return '# Baseline';
      },
      async getPullRequest() {
        return undefined;
      },
      async getPullRequestBase() {
        return undefined;
      },
    });
    const service = new DiffService(createLogger(), githubClient, gitClient, createPullRequestService());

    const availability = await service.getAvailability(document);

    assert.deepStrictEqual(availability.candidates, [
      {
        baseline: { kind: 'tag', ref: 'azure_security_keyvault_keys@1.0.0' },
        label: '1.0.0',
        description: '2026-09-09',
        detail: 'Release API',
      },
      {
        baseline: { kind: 'commit', ref: 'older-commit' },
        label: 'older-co',
        description: '2026-09-08',
        detail: undefined,
      },
    ]);
  });

  test('uses the dedicated pull request context for local repository baselines', async () => {
    const document = {
      uri: vscode.Uri.parse('file:///workspace/sdk/keyvault/azure_security_keyvault_keys/api/api.md'),
    } as vscode.TextDocument;
    const baseSha = 'base-sha';
    const service = new DiffService(
      createLogger(),
      createGitHubClient({}),
      createGitClient({
        async getRepository() {
          return {
            rootUri: vscode.Uri.parse('file:///workspace'),
            state: {
              HEAD: {
                name: 'pr/26',
              },
              remotes: [],
            },
            async getRefs() {
              return [{ type: 2, name: 'azure_security_keyvault_keys@1.0.0', commit: baseSha }];
            },
            async log() {
              return [{ hash: 'head-sha', message: 'Update API', commitDate: new Date('2026-09-10T12:00:00Z') }];
            },
            async show(ref) {
              if (ref !== baseSha && ref !== 'azure_security_keyvault_keys@1.0.0') {
                throw new Error(`Unexpected ref ${ref}`);
              }
              return '# Baseline';
            },
          };
        },
      }),
      createPullRequestService({
        async getContext() {
          return {
            document: {
              repository: { owner: 'heaths', repo: 'api-review' },
              ref: 'feature/history',
              path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
            },
            pullRequest: {
              number: 26,
              title: 'Active PR',
              state: 'open',
              baseRef: 'main',
              baseSha,
              headRef: 'feature/history',
              headSha: 'head-sha',
              headOwner: 'heaths',
            },
          };
        },
      }),
    );

    const availability = await service.getAvailability(document);

    assert.deepStrictEqual(availability.pullRequestBase, {
      baseline: { kind: 'tag', ref: 'azure_security_keyvault_keys@1.0.0' },
      label: 'azure_security_keyvault_keys@1.0.0',
      description: undefined,
      detail: undefined,
    });
    assert.deepStrictEqual(availability.defaultBaseline, {
      kind: 'tag',
      ref: 'azure_security_keyvault_keys@1.0.0',
    });
  });

  test('exposes a pull request base commit candidate when the base is not tagged', async () => {
    const document = {
      uri: vscode.Uri.parse('file:///workspace/sdk/keyvault/azure_security_keyvault_keys/api/api.md'),
    } as vscode.TextDocument;
    const baseSha = '0123456789abcdef0123456789abcdef01234567';
    const service = new DiffService(
      createLogger(),
      createGitHubClient({}),
      createGitClient({
        async getRepository() {
          return {
            rootUri: vscode.Uri.parse('file:///workspace'),
            state: {
              HEAD: {
                name: 'pr/26',
                commit: 'head-sha',
              },
              remotes: [],
            },
            async getRefs() {
              return [];
            },
            async log(options) {
              if (options?.path) {
                return [{ hash: 'head-sha', message: 'Update API', commitDate: new Date('2026-09-10T12:00:00Z') }];
              }

              return [{
                hash: baseSha,
                message: 'Create API baseline',
                commitDate: new Date('2026-09-08T12:00:00Z'),
              }];
            },
            async show(ref) {
              if (ref !== baseSha) {
                throw new Error(`Unexpected ref ${ref}`);
              }
              return '# Baseline';
            },
          };
        },
      }),
      createPullRequestService({
        async getContext() {
          return {
            document: {
              repository: { owner: 'heaths', repo: 'api-review' },
              ref: 'feature/history',
              path: 'sdk/keyvault/azure_security_keyvault_keys/api/api.md',
            },
            pullRequest: {
              number: 26,
              title: 'Active PR',
              state: 'open',
              baseRef: 'main',
              baseSha,
              headRef: 'feature/history',
              headSha: 'head-sha',
              headOwner: 'heaths',
            },
          };
        },
      }),
    );

    const availability = await service.getAvailability(document);

    assert.deepStrictEqual(availability.pullRequestBase, {
      baseline: { kind: 'commit', ref: baseSha },
      label: baseSha,
      description: '2026-09-08',
      detail: 'Create API baseline',
    });
    assert.deepStrictEqual(availability.defaultBaseline, {
      kind: 'commit',
      ref: baseSha,
    });
  });

  test('orders semver tags in descending order', () => {
    const versions = ['0.9', '1.1.0-beta.2', '1.1.0', '1.0.0']
      .map(value => parseVersion(value))
      .filter((value): value is NonNullable<typeof value> => value !== undefined)
      .sort((left, right) => compareVersions(right, left))
      .map(value => value.raw);

    assert.deepStrictEqual(versions, ['1.1.0', '1.1.0-beta.2', '1.0.0', '0.9']);
  });

  test('orders numeric prerelease identifiers numerically', () => {
    const versions = ['1.1.0-beta.2', '1.1.0-beta.12']
      .map(value => parseVersion(value))
      .filter((value): value is NonNullable<typeof value> => value !== undefined)
      .sort((left, right) => compareVersions(right, left))
      .map(value => value.raw);

    assert.deepStrictEqual(versions, ['1.1.0-beta.12', '1.1.0-beta.2']);
  });

  test('extracts versions from capture group 1 tag patterns', () => {
    const version = parseConfiguredTagVersion('azure_security_keyvault_keys@1.1.0-beta.1', [
      { expression: /^[\w-]+@(.*)$/u },
    ]);

    assert.strictEqual(version?.normalized, '1.1.0-beta.1');
  });

  test('extracts versions from named capture tag patterns', () => {
    const version = parseConfiguredTagVersion('azure_security_keyvault_keys@1.0.0', [
      { expression: /^[\w-]+@(?<version>.+)$/u },
    ]);

    assert.strictEqual(version?.normalized, '1.0.0');
  });

  test('selects the newest tag when tags are available', () => {
    const baseline = selectDefaultBaseline(
      [
        createTag('1.2.0'),
        createTag('1.2.0-beta.2'),
        createTag('1.1.0'),
      ],
      [createCommit('abc1234')],
      undefined,
    );

    assert.deepStrictEqual(baseline, { kind: 'tag', ref: '1.2.0' });
  });

  test('falls back to the newest commit when no tags are available', () => {
    const baseline = selectDefaultBaseline(
      [],
      [createCommit('abc1234')],
      undefined,
    );

    assert.deepStrictEqual(baseline, { kind: 'commit', ref: 'abc1234' });
  });

  test('formats tag picker rows with the captured version only', () => {
    const item = createDiffQuickPickCandidate({
      baseline: { kind: 'tag', ref: 'azure_security_keyvault_keys@1.1.0-beta.1' },
      label: '1.1.0-beta.1',
    });

    assert.deepStrictEqual(item, {
      label: '$(tag) 1.1.0-beta.1',
      description: undefined,
      detail: undefined,
    });
  });

  test('formats commit picker rows with short SHA, date, and title', () => {
    const item = createDiffQuickPickCandidate({
      baseline: { kind: 'commit', ref: '1234567890abcdef' },
      label: '12345678',
      description: '2026-09-08',
      detail: 'update generated api',
    } satisfies DiffCandidate);

    assert.deepStrictEqual(item, {
      label: '$(git-commit) 12345678',
      description: '2026-09-08',
      detail: 'update generated api',
    });
  });

  test('formats versioned file baselines with their parent folder', () => {
    const label = getFileBaselineLabel(vscode.Uri.parse('vscode-test-web://mount/src/web/test/fixtures/v1/api.md'));

    assert.strictEqual(label, 'v1/api.md');
  });

  test('disambiguates duplicate captured tag labels with the original ref', () => {
    const item = createDiffQuickPickCandidate({
      baseline: { kind: 'tag', ref: 'foo@1.0.0' },
      label: '1.0.0',
    }, new Set(['1.0.0']));

    assert.deepStrictEqual(item, {
      label: '$(tag) 1.0.0',
      description: undefined,
      detail: 'foo@1.0.0',
    });
  });

  test('renders diff lines with target-side action metadata', () => {
    const target = [
      '# Mock API',
      '',
      '```rust',
      'pub fn hello(name: &str);',
      '```',
    ].join('\n');
    const baseline = [
      '# Mock API',
      '',
      '```rust',
      'pub fn hello();',
      '```',
    ].join('\n');
    const lineMetadata = createMarkdownViewLineMetadata(target, {
      markdown: target,
      hasCommentsPatch: false,
    }, [{
      line: 3,
      language: 'rust',
      source: new vscode.Location(vscode.Uri.parse('test:/src/lib.rs'), new vscode.Range(0, 0, 0, 1)),
    }]);

    const rendered = renderDiffView(baseline, target, lineMetadata, 'v1.0.0');

    assert.strictEqual(rendered.hunkCount, 1);
    assert.ok(rendered.html.includes('Comparing against <strong>v1.0.0</strong>'));
    assert.ok(rendered.html.includes('data-diff-hunk="0"'));
    assert.ok(rendered.html.includes('preview-diff-line-added'));
    assert.ok(rendered.html.includes('preview-diff-line-removed'));
    assert.ok(rendered.html.includes('data-source-line="3"'));
    assert.ok(rendered.html.includes('data-has-source'));
    assert.ok(rendered.html.includes('<pre class="preview-diff-block preview-diff-code"><code>'));
  });

  test('ignores informational comments when computing diff hunks', () => {
    const target = [
      '# Mock API',
      '',
      '```rust',
      'pub fn hello();',
      '```',
    ].join('\n');
    const lineMetadata = createDiffLineMetadata([{
      line: 3,
      language: 'rust',
      documentation: ['/// Prints a greeting.'],
    }]);

    const rendered = renderDiffView(target, target, lineMetadata, 'v1.0.0');

    assert.strictEqual(rendered.hunkCount, 0);
    assert.ok(rendered.html.includes('preview-documentation-line'));
    assert.ok(rendered.html.includes('<span class="hljs-comment">/// Prints a greeting.</span>'));
    assert.ok(!rendered.html.includes('preview-diff-line-added"><span class="hljs-comment">/// Prints a greeting.</span>'));
    assert.ok(!rendered.html.includes('data-diff-hunk="0"><span class="hljs-comment">/// Prints a greeting.</span>'));
  });

  test('renders multi-line documentation once with actions on every hunk line', () => {
    const target = [
      '```rust',
      '#[derive(Clone, Debug)]',
      'pub struct ClientOptions {',
      '```',
    ].join('\n');
    const documentation = ['/// Options used when creating a client.'];
    const lineMetadata = createDiffLineMetadata([{
      line: 1,
      documentationGroupLine: 1,
      language: 'rust',
      documentation,
    }, {
      line: 2,
      documentationGroupLine: 1,
      language: 'rust',
      documentation,
    }]);

    const rendered = renderDiffView(target, target, lineMetadata, 'v1.0.0');

    assert.strictEqual((rendered.html.match(/Options used when creating a client/gu) ?? []).length, 1);
    assert.strictEqual((rendered.html.match(/data-has-documentation/gu) ?? []).length, 2);
    assert.strictEqual((rendered.html.match(/data-documentation-group="line-1"/gu) ?? []).length, 3);
  });

  test('keeps partially changed fenced code in one compact code block', () => {
    const target = [
      '```rust',
      'pub fn a();',
      'pub fn b(name: &str);',
      'pub fn c();',
      '```',
    ].join('\n');
    const baseline = [
      '```rust',
      'pub fn a();',
      'pub fn b();',
      'pub fn c();',
      '```',
    ].join('\n');

    const rendered = renderDiffView(baseline, target, [], 'v1.0.0');
    const codeBlockCount = (rendered.html.match(/<pre class="preview-diff-block preview-diff-code">/gu) ?? []).length;

    assert.strictEqual(codeBlockCount, 1);
    assert.ok(rendered.html.includes('preview-diff-line-unchanged'));
    assert.ok(rendered.html.includes('preview-diff-line-added'));
    assert.ok(rendered.html.includes('preview-diff-line-removed'));
  });

  test('renders indented fenced code blocks as diff code lines', () => {
    const rendered = renderDiffView('', [
      '   ```rust',
      'pub fn hello();',
      '   ```',
    ].join('\n'), [], 'base');

    assert.ok(rendered.html.includes('hljs-keyword'));
    assert.ok(!rendered.html.includes('   ```rust'));
  });

  test('accepts longer closing fences in diff mode', () => {
    const rendered = renderDiffView('', [
      '```rust',
      'pub fn hello();',
      '````',
      '# Heading',
    ].join('\n'), [], 'base');

    assert.ok(rendered.html.includes('<h1>Heading</h1>'));
  });

  test('preserves blank spacing between a changed metadata list and the next header', () => {
    const baseline = [
      '# mock_crate',
      '',
      '- **Package**: mock_crate',
      '- **Rust version**: 1.94',
      '',
      '## Features',
      '',
      '- `default`',
    ].join('\n');
    const target = [
      '# mock_crate',
      '',
      '- **Package**: mock_crate',
      '- **Rust version**: 1.95',
      '',
      '## Features',
      '',
      '- `default`',
    ].join('\n');

    const rendered = renderDiffView(baseline, target, [], '1.0.0');

    assert.ok(!rendered.html.includes('preview-diff-spacer'));
    assert.match(
      rendered.html,
      /<div class="preview-diff-block preview-diff-list">[\s\S]*<\/div>\n<div class="preview-diff-block preview-diff-unchanged preview-diff-markdown"><h2>Features<\/h2>[\s\S]*<\/div>/u,
    );
  });

  test('renders unchanged lists with the same semantic markdown list HTML', () => {
    const markdown = [
      '# mock_crate',
      '',
      '- **Package**: mock_crate',
      '- **Rust version**: 1.95',
      '',
      '1. one',
      '2. two',
      '',
      '- `default`',
      '  - `foo`',
      '  - `bar`',
    ].join('\n');

    const rendered = renderDiffView(markdown, markdown, [], '1.0.0');
    const expectedListMarkup = renderMarkdown(markdown);

    assert.ok(expectedListMarkup.includes('<ul>\n<li><strong>Package</strong>: mock_crate</li>'));
    assert.match(
      rendered.html,
      /<div class="preview-diff-block preview-diff-list"><ul>\s*<li class="preview-diff-list-item preview-diff-list-item-unchanged" data-line="2"><strong>Package<\/strong>: mock_crate<\/li>\s*<li class="preview-diff-list-item preview-diff-list-item-unchanged" data-line="3"><strong>Rust version<\/strong>: 1\.95<\/li>\s*<\/ul>\s*<ol>\s*<li class="preview-diff-list-item preview-diff-list-item-unchanged" data-line="5">one<\/li>\s*<li class="preview-diff-list-item preview-diff-list-item-unchanged" data-line="6">two<\/li>\s*<\/ol>\s*<ul>\s*<li class="preview-diff-list-item preview-diff-list-item-unchanged" data-line="8"><code>default<\/code>\s*<ul>\s*<li class="preview-diff-list-item preview-diff-list-item-unchanged" data-line="9"><code>foo<\/code><\/li>\s*<li class="preview-diff-list-item preview-diff-list-item-unchanged" data-line="10"><code>bar<\/code><\/li>\s*<\/ul>\s*<\/li>\s*<\/ul>\s*<\/div>/u,
    );
  });

  test('preserves ordered list start values in diff mode', () => {
    const rendered = renderDiffView('', [
      '3. third',
      '4. fourth',
    ].join('\n'), [], 'base');

    assert.ok(rendered.html.includes('<ol start="3">'));
    assert.ok(rendered.html.includes('>third</li>'));
    assert.ok(rendered.html.includes('>fourth</li>'));
  });

  test('keeps lazy continuation lines inside list items in diff mode', () => {
    const rendered = renderDiffView('', [
      '- first line',
      'continued paragraph',
    ].join('\n'), [], 'base');

    assert.match(
      rendered.html,
      /<div class="preview-diff-block preview-diff-list"><ul>\s*<li class="preview-diff-list-item preview-diff-list-item-added" data-line="0" data-diff-hunk="0">first line\s+continued paragraph<\/li>\s*<\/ul>\s*<\/div>/u,
    );
  });

  test('renders versioned fixture diffs with markdown blocks and compact code blocks', async () => {
    const baseline = await readFixture('v1/api.md');
    const target = await readFixture('v2/api.md');
    const lineMetadata = createMarkdownViewLineMetadata(target, {
      markdown: target,
      hasCommentsPatch: false,
    }, [{
      line: 14,
      language: 'rust',
      source: new vscode.Location(vscode.Uri.parse('test:/src/lib.rs'), new vscode.Range(0, 0, 0, 1)),
    }]);

    const rendered = renderDiffView(baseline, target, lineMetadata, '0.1.0');
    const hunkIds = new Set(
      Array.from(rendered.html.matchAll(/data-diff-hunk="(\d+)"/gu), match => match[1]),
    );

    assert.ok(rendered.html.includes('<h1>mock_crate</h1>'));
    assert.match(
      rendered.html,
      /<div class="preview-diff-block preview-diff-list"><ul>\s*<li class="preview-diff-list-item preview-diff-list-item-unchanged" data-line="2"><strong>Package<\/strong>: mock_crate<\/li>\s*<li class="preview-diff-list-item preview-diff-list-item-removed" data-diff-hunk="0"><strong>Version<\/strong>: 0\.1\.0<\/li>\s*<li class="preview-diff-list-item preview-diff-list-item-removed" data-diff-hunk="0"><strong>Rust version<\/strong>: 1\.94<\/li>\s*<li class="preview-diff-list-item preview-diff-list-item-added" data-line="3" data-diff-hunk="0"><strong>Version<\/strong>: 0\.2\.0<\/li>\s*<li class="preview-diff-list-item preview-diff-list-item-added" data-line="4" data-diff-hunk="0"><strong>Rust version<\/strong>: 1\.95<\/li>\s*<\/ul><\/div>/u,
    );
    assert.match(
      rendered.html,
      /<div class="preview-diff-block preview-diff-list"><ul>\s*<li class="preview-diff-list-item preview-diff-list-item-unchanged" data-line="8"><code>default<\/code>\s*<ul>\s*<li class="preview-diff-list-item preview-diff-list-item-unchanged" data-line="9"><code>foo<\/code><\/li>\s*<li class="preview-diff-list-item preview-diff-list-item-added" data-line="10" data-diff-hunk="1"><code>bar<\/code><\/li>\s*<\/ul><\/li>\s*<\/ul><\/div>/u,
    );
    assert.ok(!rendered.html.includes('preview-diff-spacer'));
    assert.ok(rendered.html.includes('<pre class="preview-diff-block preview-diff-code">'));
    assert.ok(rendered.html.includes('preview-diff-line-added'));
    assert.ok(!rendered.html.includes('```rust'));
    assert.ok(hunkIds.size >= 2);
  });
});

function createTag(version: string): TagCandidate {
  const parsed = parseVersion(version);
  assert.ok(parsed, `Expected ${version} to parse as a version`);

  return {
    candidate: {
      baseline: { kind: 'tag', ref: version },
      label: version,
    },
    version: parsed,
    commit: `${version}-commit`,
  };
}

function createCommit(ref: string) {
  return {
    baseline: { kind: 'commit', ref } as const,
    label: ref,
  };
}

async function readFixture(path: string): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'Test workspace was not mounted');
  const uri = vscode.Uri.joinPath(folder.uri, 'src/web/test/fixtures', path);
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}
