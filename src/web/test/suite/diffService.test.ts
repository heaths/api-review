import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  DiffCandidate,
  DiffService,
  compareVersions,
  getFileBaselineLabel,
  parseConfiguredTagVersion,
  parseCargoVersion,
  parseVersion,
  selectDefaultBaseline,
  TagCandidate,
} from '../../diffService';
import { GitClient } from '../../gitClient';
import { GitHubClient } from '../../githubClient';
import { PullRequestService } from '../../pullRequestService';
import { renderDiffView } from '../../diffView';
import { createDiffLineMetadata, createMarkdownViewLineMetadata } from '../../lineMetadata';
import { createDiffQuickPickCandidate } from '../../markdownView';

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
      path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      pullRequestNumber: 26,
    };
    const document = {
      uri: vscode.Uri.parse(
        'vscode-vfs://github%2B7b2276223a312c22726566223a7b2274797065223a332c226964223a223236227d7d/heaths/api-review/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
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
      { kind: 'commit', ref: headSha },
    ]);
    assert.deepStrictEqual(availability.defaultBaseline, {
      kind: 'tag',
      ref: 'azure_security_keyvault_keys@1.0.0',
    });
  });

  test('uses GitHub history when local Git is unavailable', async () => {
    const document = {
      uri: vscode.Uri.parse(
        'https://github.dev/heaths/api-review/blob/main/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      ),
    } as vscode.TextDocument;
    const gitClient = createGitClient();
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'main',
          path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
        };
      },
      async getTags() {
        return [{ name: 'azure_security_keyvault_keys@1.0.0', commit: 'tagged-commit' }];
      },
      async getCommits() {
        return [{ hash: 'newer-commit', message: 'Update API', committedAt: '2026-09-10T12:00:00Z' }];
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
        'https://github.dev/heaths/api-review/blob/main/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      ),
    } as vscode.TextDocument;
    const gitClient = createGitClient();
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'main',
          path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
        };
      },
      async getTags() {
        throw new Error('tags failed');
      },
      async getCommits() {
        return [{ hash: 'newer-commit', message: 'Update API', committedAt: '2026-09-10T12:00:00Z' }];
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
        'https://github.dev/heaths/api-review/blob/main/sdk/keyvault/azure_security_keyvault_keys/api/API.md',
      ),
    } as vscode.TextDocument;
    const gitClient = createGitClient();
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'main',
          path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
        };
      },
      async getTags() {
        return [{ name: 'azure_security_keyvault_keys@1.0.0', commit: 'tagged-commit' }];
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
        'https://github.dev/heaths/api-review/blob/main/src/web/test/fixtures/v2/API.md',
      ),
    } as vscode.TextDocument;
    const gitClient = createGitClient();
    const githubClient = createGitHubClient({
      resolveDocument() {
        return {
          repository: { owner: 'heaths', repo: 'api-review' },
          ref: 'main',
          path: 'src/web/test/fixtures/v2/API.md',
        };
      },
      async getTags() {
        return [{ name: '0.1.0', commit: 'tagged-commit' }];
      },
      async getCommits() {
        return [{ hash: 'newer-commit', message: 'Add fixture API', committedAt: '2026-09-10T12:00:00Z' }];
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

  test('uses the dedicated pull request context for local repository baselines', async () => {
    const document = {
      uri: vscode.Uri.parse('file:///workspace/sdk/keyvault/azure_security_keyvault_keys/api/API.md'),
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
              path: 'sdk/keyvault/azure_security_keyvault_keys/api/API.md',
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

    assert.deepStrictEqual(availability.defaultBaseline, {
      kind: 'tag',
      ref: 'azure_security_keyvault_keys@1.0.0',
    });
  });

  test('parses Cargo package versions', () => {
    const version = parseCargoVersion([
      '[workspace]',
      'members = []',
      '',
      '[package]',
      'name = "crate"',
      'version = "1.2.3-beta.4"',
    ].join('\n'));

    assert.strictEqual(version, '1.2.3-beta.4');
  });

  test('orders semver tags in descending order', () => {
    const versions = ['0.9', '1.1.0-beta.2', '1.1.0', '1.0.0']
      .map(value => parseVersion(value))
      .filter((value): value is NonNullable<typeof value> => value !== undefined)
      .sort((left, right) => compareVersions(right, left))
      .map(value => value.raw);

    assert.deepStrictEqual(versions, ['1.1.0', '1.1.0-beta.2', '1.0.0', '0.9']);
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

  test('selects the previous beta for beta versions', () => {
    const baseline = selectDefaultBaseline(
      [
        createTag('1.2.0'),
        createTag('1.2.0-beta.2'),
        createTag('1.1.0'),
      ],
      [createCommit('abc1234')],
      parseVersion('1.2.0-beta.3'),
      undefined,
    );

    assert.deepStrictEqual(baseline, { kind: 'tag', ref: '1.2.0-beta.2' });
  });

  test('falls back to the previous stable version for stable releases', () => {
    const baseline = selectDefaultBaseline(
      [
        createTag('2.0.0'),
        createTag('1.9.0'),
        createTag('0.9.0'),
      ],
      [createCommit('abc1234')],
      parseVersion('2.0.0'),
      undefined,
    );

    assert.deepStrictEqual(baseline, { kind: 'tag', ref: '1.9.0' });
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
    const label = getFileBaselineLabel(vscode.Uri.parse('vscode-test-web://mount/src/web/test/fixtures/v1/API.md'));

    assert.strictEqual(label, 'v1/API.md');
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

  test('renders versioned fixture diffs with markdown blocks and compact code blocks', async () => {
    const baseline = await readFixture('v1/API.md');
    const target = await readFixture('v2/API.md');
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
    assert.ok(rendered.html.includes('<span class="preview-diff-list-marker">-</span> <strong>Package</strong>: mock_crate'));
    assert.ok(rendered.html.includes('<span class="preview-diff-list-marker">-</span> <strong>Rust version</strong>: 1.95'));
    assert.ok(rendered.html.includes('<span class="preview-diff-list-marker">-</span> <code>default</code>'));
    assert.ok(rendered.html.includes('&nbsp;&nbsp;<span class="preview-diff-list-marker">-</span> <code>foo</code>'));
    assert.ok(rendered.html.includes('&nbsp;&nbsp;<span class="preview-diff-list-marker">-</span> <code>bar</code>'));
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
