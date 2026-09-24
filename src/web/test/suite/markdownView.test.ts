import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitHubDocumentRef, GitHubPullRequest } from '../../githubClient';
import { createMarkdownViewLineMetadata } from '../../lineMetadata';
import { PullRequestLineComment } from '../../pullRequestService';
import {
  createDiffQuickPickCandidate,
  createDiffQuickPickItems,
  createLoadingDiffQuickPickItems,
  createPullRequestBaseQuickPickItem,
  getContributedMarkdownViewStyles,
  getPathLabel,
  getMarkdownViewHtml,
  renderCommentMarkdown,
  renderMarkdown,
  renderMarkdownView,
  MarkdownViewProvider,
} from '../../markdownView';

function createLogger(calls?: { info: string[] }): vscode.LogOutputChannel {
  return {
    logLevel: vscode.LogLevel.Debug,
    onDidChangeLogLevel: () => ({ dispose() { } }),
    trace() { },
    debug() { },
    info(message: string | Error) {
      calls?.info.push(String(message));
    },
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

suite('Markdown view', () => {
  test('renders standard Markdown content', () => {
    const html = renderMarkdown('# API\n\n[Documentation](https://example.com)');

    assert.ok(html.includes('<h1>API</h1>'));
    assert.ok(html.includes('<a href="https://example.com">Documentation</a>'));
  });

  test('syntax highlights comments in fenced code', () => {
    const html = renderMarkdown(['```rust', '/// Documentation.', 'pub fn hello();', '```'].join('\n'));

    assert.ok(html.includes('hljs-comment'));
    assert.ok(html.includes('<span class="code-line comment-line" data-line="1"><span class="hljs-comment">/// Documentation.</span></span>'));
    assert.ok(html.includes('<span class="code-line" data-line="2"><span class="hljs-keyword">pub</span>'));
    assert.ok(html.includes('pub'));
  });

  test('marks every line of a multiline comment as collapsible', () => {
    const html = renderMarkdown(['```typescript', '/* First line', ' * second line', ' */', 'const value = 1;', '```'].join('\n'));

    assert.strictEqual((html.match(/code-line comment-line/g) ?? []).length, 3);
    assert.ok(html.includes('<span class="code-line" data-line="4"><span class="hljs-keyword">const</span> value = <span class="hljs-number">1</span>;'));
  });

  test('escapes code in unknown fenced languages', () => {
    const html = renderMarkdown(['```unknown-language', '<script>alert(1)</script>', '```'].join('\n'));

    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
  });

  test('highlights supported json aliases in fenced code', () => {
    const html = renderMarkdown(['```jsonc', '{"answer": 42}', '```'].join('\n'));

    assert.match(html, /hljs-(attr|string|number)/u);
    assert.ok(html.includes('answer'));
  });

  test('highlights supported shell aliases in fenced code', () => {
    const html = renderMarkdown(['```shell', 'echo "$HOME"', '```'].join('\n'));

    assert.match(html, /hljs-(built_in|string|variable)/u);
    assert.ok(html.includes('$HOME'));
  });

  test('renders comment markdown with raw html disabled', () => {
    const html = renderCommentMarkdown('Line with **markdown** and <script>alert(1)</script>.');

    assert.ok(html.includes('<strong>markdown</strong>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
  });

  test('extracts labels from file paths and versioned file specs', () => {
    assert.strictEqual(getPathLabel('/sdk/keyvault/api.md'), 'api.md');
    assert.strictEqual(getPathLabel('my_crate@1.2.3:/sdk/keyvault/api.md'), 'api.md');
    assert.strictEqual(getPathLabel('file:///sdk/keyvault/api.md'), 'api.md');
  });

  test('shows only choose file and cancel while diff history loads', () => {
    const items = createLoadingDiffQuickPickItems();

    assert.deepStrictEqual(items, [
      {
        action: 'chooseFile',
        label: '$(folder-opened) Choose file...',
        description: 'Compare against another api.md file',
      },
      {
        action: 'hide',
        label: '$(close) Cancel',
        description: 'Return to the normal preview',
      },
    ]);
  });

  test('groups loaded diff items with separators only between populated sections', () => {
    const items = createDiffQuickPickItems({
      candidates: [
        {
          baseline: { kind: 'tag', ref: 'crate@1.2.0' },
          label: '1.2.0',
          description: '2026-09-10',
          detail: 'latest stable release',
        },
        {
          baseline: { kind: 'commit', ref: '1234567890abcdef' },
          label: '12345678',
          description: '2026-09-09',
          detail: 'previous api change',
        },
      ],
      defaultBaseline: { kind: 'tag', ref: 'crate@1.2.0' },
      canPickFile: true,
    });

    assert.deepStrictEqual(items.map(item => ({
      kind: item.kind,
      label: item.label,
      description: item.description,
      detail: item.detail,
      action: 'action' in item ? item.action : undefined,
    })), [
      {
        kind: undefined,
        label: '$(tag) 1.2.0',
        description: '2026-09-10',
        detail: 'latest stable release',
        action: 'baseline',
      },
      {
        kind: vscode.QuickPickItemKind.Separator,
        label: '',
        description: undefined,
        detail: undefined,
        action: undefined,
      },
      {
        kind: undefined,
        label: '$(git-commit) 12345678',
        description: '2026-09-09',
        detail: 'previous api change',
        action: 'baseline',
      },
      {
        kind: vscode.QuickPickItemKind.Separator,
        label: '',
        description: undefined,
        detail: undefined,
        action: undefined,
      },
      {
        kind: undefined,
        label: '$(folder-opened) Choose file...',
        description: 'Compare against another api.md file',
        detail: undefined,
        action: 'chooseFile',
      },
      {
        kind: undefined,
        label: '$(close) Cancel',
        description: 'Return to the normal preview',
        detail: undefined,
        action: 'hide',
      },
    ]);
  });

  test('puts the pull request base first and keeps separators singular', () => {
    const items = createDiffQuickPickItems({
      pullRequestBase: {
        baseline: { kind: 'commit', ref: '1234567890abcdef' },
        label: '12345678',
        description: '2026-09-11',
        detail: 'merge latest baseline',
      },
      candidates: [
        {
          baseline: { kind: 'tag', ref: 'crate@1.2.0' },
          label: '1.2.0',
          description: '2026-09-10',
          detail: 'latest stable release',
        },
      ],
      defaultBaseline: { kind: 'commit', ref: '1234567890abcdef' },
      canPickFile: true,
    });

    assert.deepStrictEqual(items.map(item => ({
      kind: item.kind,
      label: item.label,
      description: item.description,
      detail: item.detail,
      action: 'action' in item ? item.action : undefined,
      source: 'source' in item ? item.source : undefined,
    })), [
      {
        kind: undefined,
        label: '$(git-pull-request) 12345678',
        description: '2026-09-11',
        detail: 'merge latest baseline',
        action: 'baseline',
        source: 'pullRequestBase',
      },
      {
        kind: vscode.QuickPickItemKind.Separator,
        label: '',
        description: undefined,
        detail: undefined,
        action: undefined,
        source: undefined,
      },
      {
        kind: undefined,
        label: '$(tag) 1.2.0',
        description: '2026-09-10',
        detail: 'latest stable release',
        action: 'baseline',
        source: 'history',
      },
      {
        kind: vscode.QuickPickItemKind.Separator,
        label: '',
        description: undefined,
        detail: undefined,
        action: undefined,
        source: undefined,
      },
      {
        kind: undefined,
        label: '$(folder-opened) Choose file...',
        description: 'Compare against another api.md file',
        detail: undefined,
        action: 'chooseFile',
        source: undefined,
      },
      {
        kind: undefined,
        label: '$(close) Cancel',
        description: 'Return to the normal preview',
        detail: undefined,
        action: 'hide',
        source: undefined,
      },
    ]);
  });

  test('omits separators when only quick-pick actions remain', () => {
    const items = createDiffQuickPickItems({
      candidates: [],
      defaultBaseline: undefined,
      canPickFile: true,
    });

    assert.deepStrictEqual(items.map(item => item.label), [
      '$(folder-opened) Choose file...',
      '$(close) Cancel',
    ]);
    assert.ok(items.every(item => item.kind !== vscode.QuickPickItemKind.Separator));
  });

  test('truncates long quick-pick details and preserves duplicate tag refs', () => {
    const item = createDiffQuickPickCandidate({
      baseline: { kind: 'tag', ref: 'crate@1.0.0' },
      label: '1.0.0',
      detail: 'a'.repeat(140),
    }, new Set(['1.0.0']));

    assert.strictEqual(item.label, '$(tag) 1.0.0');
    assert.ok(item.detail?.startsWith('crate@1.0.0 — '));
    assert.ok(item.detail?.endsWith('...'));
    assert.ok((item.detail?.length ?? 0) <= 65);
  });

  test('keeps short first-line commit titles unchanged', () => {
    const item = createDiffQuickPickCandidate({
      baseline: { kind: 'commit', ref: '1234567890abcdef' },
      label: '12345678',
      description: '2026-09-09',
      detail: 'Update MSRV to 1.95',
    });

    assert.deepStrictEqual(item, {
      label: '$(git-commit) 12345678',
      description: '2026-09-09',
      detail: 'Update MSRV to 1.95',
    });
  });

  test('renders pull request base entries with the pull request icon', () => {
    const item = createPullRequestBaseQuickPickItem({
      baseline: { kind: 'tag', ref: 'crate@1.2.0' },
      label: '1.2.0',
      description: '2026-09-10',
      detail: 'latest stable release',
    });

    assert.deepStrictEqual(item, {
      action: 'baseline',
      baseline: { kind: 'tag', ref: 'crate@1.2.0' },
      source: 'pullRequestBase',
      label: '$(git-pull-request) 1.2.0',
      description: '2026-09-10',
      detail: 'latest stable release',
    });
  });

  test('maps actionable preview lines to patched markdown lines', () => {
    const source = [
      '# Mock API',
      '',
      '```rust',
      'pub fn hello();',
      '```',
    ].join('\n');
    const lineMetadata = createMarkdownViewLineMetadata(source, {
      markdown: [
        '# Mock API',
        '',
        '```rust',
        '/// Prints a greeting.',
        'pub fn hello();',
        '```',
      ].join('\n'),
      hasCommentsPatch: true,
      commentsPatch: [
        '--- a/api.md',
        '+++ b/api.md',
        '@@ -4,1 +4,2 @@',
        '+/// Prints a greeting.',
        ' pub fn hello();',
      ].join('\n'),
    }, [{
      line: 3,
      language: 'rust',
      documentation: ['/// Prints a greeting.'],
      source: new vscode.Location(vscode.Uri.parse('test:/src/lib.rs'), new vscode.Range(0, 0, 0, 1)),
    }]);

    assert.deepStrictEqual(lineMetadata, [{
      line: 3,
      language: 'rust',
      documentation: ['/// Prints a greeting.'],
      source: new vscode.Location(vscode.Uri.parse('test:/src/lib.rs'), new vscode.Range(0, 0, 0, 1)),
      sourceLine: 3,
      viewLine: 4,
      hasDocumentation: true,
      hasSource: true,
      documentationGroupId: 'line-3',
      documentationViewLines: [3],
      pullRequestComments: undefined,
      hasPullRequestDiscussion: false,
      ariaLabel: 'Review actions available: documentation and go to source',
    }]);
  });

  test('preserves per-line action availability for mixed popup states', () => {
    const source = [
      '# Mock API',
      '',
      '```rust',
      'pub fn docs_only();',
      'pub fn source_only();',
      '```',
    ].join('\n');
    const lineMetadata = createMarkdownViewLineMetadata(source, {
      markdown: [
        '# Mock API',
        '',
        '```rust',
        '/// Documentation only.',
        'pub fn docs_only();',
        'pub fn source_only();',
        '```',
      ].join('\n'),
      hasCommentsPatch: true,
      commentsPatch: [
        '--- a/api.md',
        '+++ b/api.md',
        '@@ -4,2 +4,3 @@',
        '+/// Documentation only.',
        ' pub fn docs_only();',
        ' pub fn source_only();',
      ].join('\n'),
    }, [
      {
        line: 3,
        language: 'rust',
        documentation: ['/// Documentation only.'],
      },
      {
        line: 4,
        language: 'rust',
        source: new vscode.Location(vscode.Uri.parse('test:/src/lib.rs'), new vscode.Range(1, 0, 1, 1)),
      },
    ]);

    assert.deepStrictEqual(lineMetadata, [
      {
        sourceLine: 3,
        viewLine: 4,
        line: 3,
        language: 'rust',
        documentation: ['/// Documentation only.'],
        hasDocumentation: true,
        hasSource: false,
        documentationGroupId: 'line-3',
        documentationViewLines: [3],
        pullRequestComments: undefined,
        hasPullRequestDiscussion: false,
        ariaLabel: 'Review actions available: documentation',
      },
      {
        sourceLine: 4,
        viewLine: 5,
        line: 4,
        language: 'rust',
        source: new vscode.Location(vscode.Uri.parse('test:/src/lib.rs'), new vscode.Range(1, 0, 1, 1)),
        hasDocumentation: false,
        hasSource: true,
        documentationGroupId: undefined,
        documentationViewLines: [],
        pullRequestComments: undefined,
        hasPullRequestDiscussion: false,
        ariaLabel: 'Review actions available: go to source',
      },
    ]);
  });

  test('adds one documentation group action to every line in a declaration hunk', () => {
    const source = [
      '```rust',
      '#[derive(Clone, Debug)]',
      'pub struct ClientOptions {',
      '```',
    ].join('\n');
    const documentation = ['/// Options used when creating a client.'];
    const lineMetadata = createMarkdownViewLineMetadata(source, {
      markdown: [
        '```rust',
        ...documentation,
        '#[derive(Clone, Debug)]',
        'pub struct ClientOptions {',
        '```',
      ].join('\n'),
      hasCommentsPatch: true,
      commentsPatch: [
        '@@ -2,2 +2,3 @@',
        `+${documentation[0]}`,
        ' #[derive(Clone, Debug)]',
        ' pub struct ClientOptions {',
      ].join('\n'),
    }, [{
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

    assert.deepStrictEqual(lineMetadata.map(entry => ({
      line: entry.line,
      viewLine: entry.viewLine,
      documentationGroupId: entry.documentationGroupId,
      documentationViewLines: entry.documentationViewLines,
      hasDocumentation: entry.hasDocumentation,
    })), [{
      line: 1,
      viewLine: 2,
      documentationGroupId: 'line-1',
      documentationViewLines: [1],
      hasDocumentation: true,
    }, {
      line: 2,
      viewLine: 3,
      documentationGroupId: 'line-1',
      documentationViewLines: [1],
      hasDocumentation: true,
    }]);

    const html = renderMarkdownView([
      '```rust',
      ...documentation,
      '#[derive(Clone, Debug)]',
      'pub struct ClientOptions {',
      '```',
    ].join('\n'), lineMetadata);
    assert.strictEqual((html.match(/data-has-documentation/gu) ?? []).length, 2);
    assert.strictEqual((html.match(/data-documentation-group="line-1"/gu) ?? []).length, 3);
  });

  test('marks lines with multiple comments as discussions', () => {
    const source = [
      '# Mock API',
      '',
      '```rust',
      'pub fn docs_only();',
      '```',
    ].join('\n');
    const pullRequestComments = new Map<number, readonly PullRequestLineComment[]>([[3, [{
      id: 7,
      body: 'First comment.',
      sourceLine: 3,
      kind: 'individual',
      originalPostId: 7,
      author: 'heaths',
      updatedAt: '2026-09-11T12:00:00Z',
      isDraft: false,
    }, {
      id: 8,
      body: 'Second comment.',
      sourceLine: 3,
      kind: 'reply',
      originalPostId: 7,
      inReplyToId: 7,
      author: 'octocat',
      updatedAt: '2026-09-11T12:05:00Z',
      isDraft: false,
    }]]]);

    const lineMetadata = createMarkdownViewLineMetadata(source, {
      markdown: source,
      hasCommentsPatch: false,
    }, [{
      line: 3,
      language: 'rust',
    }], pullRequestComments);
    const html = renderMarkdownView(source, lineMetadata);

    assert.deepStrictEqual(lineMetadata, [{
      sourceLine: 3,
      viewLine: 3,
      line: 3,
      language: 'rust',
      hasDocumentation: false,
      hasSource: false,
      documentationGroupId: undefined,
      documentationViewLines: [],
      pullRequestComments: [{
        id: 7,
        body: 'First comment.',
        sourceLine: 3,
        kind: 'individual',
        originalPostId: 7,
        author: 'heaths',
        updatedAt: '2026-09-11T12:00:00Z',
        isDraft: false,
      }, {
        id: 8,
        body: 'Second comment.',
        sourceLine: 3,
        kind: 'reply',
        originalPostId: 7,
        inReplyToId: 7,
        author: 'octocat',
        updatedAt: '2026-09-11T12:05:00Z',
        isDraft: false,
      }],
      hasPullRequestDiscussion: true,
      ariaLabel: 'Review actions available: pull request discussion',
    }]);
    assert.ok(html.includes('data-has-pr-discussion'));
    assert.ok(html.includes('data-pr-comment-count="2"'));
  });

  test('adds pull request comment metadata to actionable preview lines', () => {
    const source = [
      '# Mock API',
      '',
      '```rust',
      'pub fn docs_only();',
      '```',
    ].join('\n');
    const pullRequestComments = new Map<number, readonly PullRequestLineComment[]>([[3, [{
      id: 7,
      body: 'Please rename this.',
      sourceLine: 3,
      kind: 'individual',
      originalPostId: 7,
      author: 'heaths',
      updatedAt: '2026-09-11T12:00:00Z',
      isDraft: false,
    }]]]);

    const lineMetadata = createMarkdownViewLineMetadata(source, {
      markdown: source,
      hasCommentsPatch: false,
    }, [{
      line: 3,
      language: 'rust',
    }], pullRequestComments);

    assert.deepStrictEqual(lineMetadata, [{
      sourceLine: 3,
      viewLine: 3,
      line: 3,
      language: 'rust',
      hasDocumentation: false,
      hasSource: false,
      documentationGroupId: undefined,
      documentationViewLines: [],
      pullRequestComments: [{
        id: 7,
        body: 'Please rename this.',
        sourceLine: 3,
        kind: 'individual',
        originalPostId: 7,
        author: 'heaths',
        updatedAt: '2026-09-11T12:00:00Z',
        isDraft: false,
      }],
      hasPullRequestDiscussion: false,
      ariaLabel: 'Review actions available: pull request comment',
    }]);
  });

  test('adds pull request comment metadata for comment-only lines', () => {
    const source = [
      '# Mock API',
      '',
      '```rust',
      'pub fn docs_only();',
      '```',
    ].join('\n');
    const pullRequestComments = new Map<number, readonly PullRequestLineComment[]>([[3, [{
      id: 8,
      body: 'Comment only.',
      sourceLine: 3,
      kind: 'review',
      reviewId: 12,
      originalPostId: 8,
      author: 'heaths',
      updatedAt: '2026-09-11T12:00:00Z',
      isDraft: false,
    }]]]);

    const lineMetadata = createMarkdownViewLineMetadata(source, {
      markdown: source,
      hasCommentsPatch: false,
    }, [], pullRequestComments);

    assert.deepStrictEqual(lineMetadata, [{
      line: 3,
      language: 'rust',
      sourceLine: 3,
      viewLine: 3,
      hasDocumentation: false,
      hasSource: false,
      documentationGroupId: undefined,
      documentationViewLines: [],
      pullRequestComments: [{
        id: 8,
        body: 'Comment only.',
        sourceLine: 3,
        kind: 'review',
        reviewId: 12,
        originalPostId: 8,
        author: 'heaths',
        updatedAt: '2026-09-11T12:00:00Z',
        isDraft: false,
      }],
      hasPullRequestDiscussion: false,
      ariaLabel: 'Review actions available: pull request comment',
    }]);
  });

  test('renders preview metadata into DOM attributes', () => {
    const source = [
      '# Mock API',
      '',
      '```rust',
      'pub fn docs_only();',
      'pub fn source_only();',
      '```',
    ].join('\n');
    const markdown = [
      '# Mock API',
      '',
      '```rust',
      '/// Documentation only.',
      'pub fn docs_only();',
      'pub fn source_only();',
      '```',
    ].join('\n');
    const lineMetadata = createMarkdownViewLineMetadata(source, {
      markdown,
      hasCommentsPatch: true,
      commentsPatch: [
        '--- a/api.md',
        '+++ b/api.md',
        '@@ -4,2 +4,3 @@',
        '+/// Documentation only.',
        ' pub fn docs_only();',
        ' pub fn source_only();',
      ].join('\n'),
    }, [
      {
        line: 3,
        language: 'rust',
        documentation: ['/// Documentation only.'],
      },
      {
        line: 4,
        language: 'rust',
        source: new vscode.Location(vscode.Uri.parse('test:/src/lib.rs'), new vscode.Range(1, 0, 1, 1)),
      },
    ]);

    const html = renderMarkdownView(markdown, lineMetadata);

    assert.ok(html.includes('class="code-line comment-line preview-documentation-line" data-line="3" data-documentation-group="line-3"'));
    assert.ok(html.includes('class="code-line preview-action-line" data-line="4" data-source-line="3" tabindex="0" aria-haspopup="true" aria-controls="preview-hover-actions" aria-label="Review actions available: documentation" data-has-documentation data-documentation-group="line-3"'));
    assert.ok(html.includes('class="code-line preview-action-line" data-line="5" data-source-line="4" tabindex="0" aria-haspopup="true" aria-controls="preview-hover-actions" aria-label="Review actions available: go to source" data-has-source'));
  });

  test('wires the shared documentation icons and toggle tooltips into the popup', () => {
    const root = vscode.Uri.parse('test-extension:/extension');
    const webview = {
      cspSource: 'test-webview:',
      asWebviewUri: (uri: vscode.Uri) => uri.with({ scheme: 'test-webview' }),
    } as vscode.Webview;

    const html = getMarkdownViewHtml(
      webview,
      root,
      vscode.Uri.parse('test-workspace:/api.md'),
      '<p>API</p>',
      true,
      false,
      false,
      true,
      true,
      [],
    );

    assert.ok(html.includes('--preview-expand-docs-icon: url("test-webview:/extension/assets/codicons/expand-docs.svg")'));
    assert.ok(html.includes('--preview-collapse-docs-icon: url("test-webview:/extension/assets/codicons/collapse-docs.svg")'));
    assert.ok(html.includes('--preview-go-to-file-icon: url("test-webview:/extension/assets/codicons/go-to-file.svg")'));
    assert.ok(html.includes('--preview-comment-icon: url("test-webview:/extension/assets/codicons/comment.svg")'));
    assert.ok(html.includes('--preview-comment-discussion-icon: url("test-webview:/extension/assets/codicons/comment-discussion.svg")'));
    assert.ok(html.includes('--preview-edit-icon: url("test-webview:/extension/assets/codicons/edit.svg")'));
    assert.ok(!html.includes('--preview-reply-icon'));
    assert.ok(html.includes('data-show-tooltip="Show documentation"'));
    assert.ok(html.includes('data-hide-tooltip="Hide documentation"'));
    assert.ok(html.includes('data-action="comment" data-icon="comment"'));
    assert.ok(html.includes('data-action="source" data-icon="go-to-file"'));
    assert.ok(html.includes('<body class="has-comments-patch web-host">'));
    assert.ok(!html.includes('preview-initial-state'));
    assert.ok(!html.includes('Please rename this.'));
  });

  test('ships the generated edit icon asset for preview actions', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const editIconUri = vscode.Uri.joinPath(folder.uri, 'assets/codicons/edit.svg');
    const iconStat = await vscode.workspace.fs.stat(editIconUri);

    assert.strictEqual(iconStat.type, vscode.FileType.File);
  });

  test('resolves contributed preview styles in declaration order', () => {
    const firstRoot = vscode.Uri.parse('test-extension:/first');
    const secondRoot = vscode.Uri.parse('test-extension:/second');
    const styles = getContributedMarkdownViewStyles([
      {
        extensionUri: firstRoot,
        packageJSON: {
          contributes: {
            'markdown.previewStyles': ['./styles/theme.css', 'styles/print.css'],
          },
        },
      },
      {
        extensionUri: secondRoot,
        packageJSON: {
          contributes: {
            'markdown.previewStyles': ['preview.css'],
          },
        },
      },
    ]);

    assert.deepStrictEqual(styles.stylesheets.map(uri => uri.toString()), [
      'test-extension:/first/styles/theme.css',
      'test-extension:/first/styles/print.css',
      'test-extension:/second/preview.css',
    ]);
    assert.deepStrictEqual(styles.roots.map(uri => uri.toString()), [
      firstRoot.toString(),
      secondRoot.toString(),
    ]);
  });

  test('ignores malformed and unsafe preview style contributions', () => {
    const root = vscode.Uri.parse('test-extension:/styles');
    const styles = getContributedMarkdownViewStyles([
      {
        extensionUri: root,
        packageJSON: {
          contributes: {
            'markdown.previewStyles': [
              '../outside.css',
              '/absolute.css',
              'https://example.com/theme.css',
              'styles\\theme.css',
              '',
              42,
              'valid.css',
            ],
          },
        },
      },
      {
        extensionUri: root,
        packageJSON: {
          contributes: {
            'markdown.previewStyles': ['second.css'],
          },
        },
      },
      {
        extensionUri: vscode.Uri.parse('test-extension:/invalid'),
        packageJSON: {
          contributes: {
            'markdown.previewStyles': 'not-an-array',
          },
        },
      },
    ]);

    assert.deepStrictEqual(styles.stylesheets.map(uri => uri.toString()), [
      'test-extension:/styles/valid.css',
      'test-extension:/styles/second.css',
    ]);
    assert.deepStrictEqual(styles.roots.map(uri => uri.toString()), [root.toString()]);
  });

  test('defines separate light and dark preview palettes', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const cssUri = vscode.Uri.joinPath(folder.uri, 'assets/markdownPreview.css');
    const css = new TextDecoder().decode(await vscode.workspace.fs.readFile(cssUri));

    assert.ok(css.includes('.vscode-dark,\n.vscode-high-contrast {'));
    assert.ok(css.includes('.vscode-light,\n.vscode-high-contrast-light {'));
    assert.ok(css.includes('--preview-body-color: var(--vscode-editor-foreground);'));
    assert.ok(css.includes('--preview-code-block-background: var(--vscode-textCodeBlock-background);'));
    assert.ok(css.includes('--comment-icon-margin: 4px;'));
    assert.ok(css.includes('--preview-comment-badge-hit-size: calc(var(--preview-comment-badge-size) + (2 * var(--comment-icon-margin)));'));
    assert.ok(css.includes('--preview-code-line-gutter-width: var(--preview-comment-badge-hit-size);'));
    assert.ok(css.includes('body.web-host {\n  --comment-icon-margin: 8px;\n  --preview-code-line-gutter-width: 32px;\n}'));
    assert.ok(css.includes('.markdown-body pre {\n  overflow: auto;\n  padding: var(--preview-code-block-padding);\n  padding-inline-start: 0;'));
    assert.ok(!css.includes('.preview-diff-markdown > * {\n  margin: 0;\n}'));
    assert.ok(!css.includes('.preview-diff-markdown > :first-child'));
    assert.ok(!css.includes('.preview-diff-markdown > :last-child'));
    assert.ok(!css.includes('.preview-diff-markdown > :only-child'));
    assert.ok(!css.includes('.preview-diff-spacer'));
    assert.ok(css.includes('.preview-diff-list-item-added {\n  background: var(--preview-diff-added-background);\n}'));
    assert.ok(css.includes('.preview-diff-list-item-removed {\n  background: var(--preview-diff-removed-background);\n}'));
    assert.ok(!css.includes('.preview-diff-code {\n  margin: 0;'));
    assert.ok(css.includes('left: var(--comment-icon-margin);'));
    assert.ok(css.includes('--preview-comment-history-gap: 8px;'));
    assert.ok(css.includes('--preview-comment-history-background: color-mix(in srgb, var(--preview-hover-background) 84%, transparent);'));
    assert.ok(css.includes('.markdown-body .preview-action-line[data-has-pr-discussion] {\n  --preview-line-comment-icon: var(--preview-comment-discussion-icon);\n}'));
    assert.ok(css.includes(':is(#preview-hover-actions button, .preview-icon-button) {'));
    assert.ok(css.includes('.preview-comment-thread-edit {\n  min-inline-size: 0;\n  color: var(--preview-comment-history-meta);\n  background: transparent;'));
    assert.ok(css.includes('.preview-comment-thread-edit[data-icon="edit"] {\n  --preview-action-icon: var(--preview-edit-icon);\n}'));
    assert.ok(css.includes('#preview-comment-window-footer button {'));
    assert.ok(!css.includes('#preview-comment-window button {'));
    assert.ok(!css.includes('.preview-comment-thread-reply'));
    assert.ok(!css.includes('left: calc(-1 * var(--preview-comment-badge-hit-size));'));
    assert.ok(css.includes('--preview-hljs-title: #795e26;'));
    assert.ok(css.includes('--preview-hljs-attr: #001080;'));
    assert.ok(css.includes('--preview-hljs-property: #001080;'));
    assert.ok(css.includes('.hljs-title {\n  color: var(--preview-hljs-title);\n}'));
    assert.ok(css.includes('.hljs-attr {\n  color: var(--preview-hljs-attr);\n}'));
    assert.ok(css.includes('.hljs-property {\n  color: var(--preview-hljs-property);\n}'));
  });

  test('uses the full preview width with built-in style padding', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const cssUri = vscode.Uri.joinPath(folder.uri, 'assets/markdownPreview.css');
    const css = new TextDecoder().decode(await vscode.workspace.fs.readFile(cssUri));

    assert.ok(!css.includes('--preview-max-width'));
    assert.ok(css.includes('body {\n  box-sizing: border-box;\n  margin: 0;\n  padding: 0 var(--preview-padding-inline) var(--preview-padding-bottom);'));
    assert.ok(!css.includes('max-width: var(--preview-max-width);'));
    assert.ok(css.includes('resize: both;'));
    assert.ok(!css.includes('--preview-comment-window-min-height'));
  });

  test('uses secondary styling for non-default dialog buttons', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const scriptUri = vscode.Uri.joinPath(folder.uri, 'assets/markdownPreview.js');
    const script = new TextDecoder().decode(await vscode.workspace.fs.readFile(scriptUri));

    assert.ok(script.includes('class="preview-secondary" data-action="delete-comment"'));
    assert.ok(script.includes('class="preview-secondary" data-action="cancel-comment"'));
    assert.ok(script.includes('data-action="submit-comment">Comment</button>'));
    assert.ok(script.includes('data-action="reply-comment" hidden>Reply</button>'));
    assert.ok(script.includes("editButton.className = 'preview-icon-button preview-comment-thread-edit'"));
    assert.ok(script.includes("editButton.dataset.action = 'edit-comment'"));
    assert.ok(script.includes("editButton.title = 'Edit comment'"));
    assert.ok(script.includes("editButton.setAttribute('aria-label', 'Edit comment')"));
    assert.ok(script.includes([
      "      '  <button type=\"button\" data-action=\"submit-comment\">Comment</button>',",
      "      '  <button type=\"button\" data-action=\"reply-comment\" hidden>Reply</button>',",
    ].join('\n')));
    assert.ok(script.includes('id="preview-comment-history"'));
    assert.ok(script.includes("submitLabel: hasPendingReview ? 'Add comment' : 'Start review'"));
    assert.ok(script.includes('showReply: !hasPendingReview && originalPostId !== undefined'));
    assert.ok(script.includes("submitLabel: 'Update'"));
    assert.ok(script.includes('placeholder: `Edit this pending comment. Press ${submitShortcut} to update.`'));
    assert.ok(script.includes('const commentAvatarRequestSize = 48;'));
    assert.ok(script.includes('const commentAvatarDisplaySize = 24;'));
    assert.ok(script.includes("author.className = 'preview-comment-thread-author'"));
    assert.ok(script.includes("meta.className = 'preview-comment-thread-meta'"));
    assert.ok(script.includes("submitCommentButton.classList.toggle('preview-secondary', options.showReply)"));
    assert.ok(script.includes('if (!replyCommentButton.hidden) {'));
    assert.ok(script.includes('hasPendingReview = event.data.hasPendingReview === true'));
    assert.ok(script.includes("body: ''"));
    assert.ok(!script.includes('draftComment?.localId'));
    assert.ok(!script.includes('preview-comment-thread-reply'));
    assert.ok(!script.includes('comment.canReply'));
    assert.ok(script.includes("anchorMode: 'toolbar'"));
    assert.ok(script.includes("type: 'submitPullRequestReview'"));
    assert.ok(script.includes("type: 'createPullRequestCommentReply'"));
    assert.ok(script.includes("data-has-pr-discussion"));
    assert.ok(script.includes("case 'openPullRequestReviewDialog':"));
    assert.ok(script.includes('navigator.userAgentData?.platform'));
    assert.ok(script.includes("? 'Cmd+Enter' : 'Ctrl+Enter'"));
  });

  test('refreshes pull request comment state after review submission without changing pull request context', async () => {
    const pullRequest = {
      number: 42,
      title: 'Review comments',
      state: 'open',
      baseRef: 'main',
      baseSha: 'base-sha',
      headRef: 'feature/comments',
      headSha: 'head-sha',
      headOwner: 'heaths',
    } as const;
    const documentRef = {
      repository: { owner: 'heaths', repo: 'api-review' },
      ref: 'head-sha',
      path: 'sdk/keyvault/api/api.md',
    };
    const pullRequestContext = {
      document: documentRef,
      pullRequest,
    };

    let hasPendingReview = true;
    const messages: unknown[] = [];
    const previewProvider = new MarkdownViewProvider(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {} as never,
      {
        isGitHubDocument() {
          return false;
        },
        async getContext() {
          return pullRequestContext;
        },
        async submitReview() {
          hasPendingReview = false;
          return 1;
        },
        hasPendingReview() {
          return hasPendingReview;
        },
        async getLineComments() {
          return new Map([[9, [{
            id: 5,
            body: 'Submitted comment',
            sourceLine: 9,
            kind: 'review',
            reviewId: 12,
            originalPostId: 5,
            author: 'heaths',
            avatarUrl: 'https://avatars.githubusercontent.com/u/1532486?v=4',
            updatedAt: '2026-09-11T12:00:00Z',
            isDraft: hasPendingReview,
          }]]]);
        },
      } as never,
      createLogger(),
      {
        formatCommentTimestamp() {
          return '1w ago';
        },
      },
    );

    const preview = {
      document: {
        uri: vscode.Uri.parse('test-workspace:/api.md'),
        getText() {
          return '';
        },
      },
      panel: {
        webview: {
          async postMessage(message: unknown) {
            messages.push(message);
            return true;
          },
        },
      },
      contributedStyles: { stylesheets: [], roots: [] },
      commentsVisible: false,
      hasCommentsPatch: false,
      diffAvailable: false,
      canNavigatePreviousDiff: false,
      canNavigateNextDiff: false,
      diffRefreshGeneration: 0,
      pullRequestContext,
      pullRequestRefreshGeneration: 0,
      generation: 0,
    };

    (previewProvider as unknown as { previews: Set<unknown>; activePreview?: unknown }).previews.add(preview);
    (previewProvider as unknown as { activePreview?: unknown }).activePreview = preview;

    await (previewProvider as unknown as {
      submitPullRequestReview(event: 'APPROVE' | 'REQUEST_CHANGES', body?: string): Promise<void>;
    }).submitPullRequestReview('APPROVE', 'Looks good');

    assert.deepStrictEqual(messages, [{
      type: 'pullRequestCommentState',
      hasPendingReview: false,
      comments: [{
        line: 9,
        comments: [{
          id: 5,
          body: 'Submitted comment',
          renderedBody: '<p>Submitted comment</p>\n',
          kind: 'review',
          isDraft: false,
          author: 'heaths',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1532486?v=4',
          metaLabel: '1w ago',
          createdAt: undefined,
          updatedAt: '2026-09-11T12:00:00Z',
          originalPostId: 5,
          localId: undefined,
        }],
      }],
    }]);
  });

  test('logs diff open and close for versioned file baselines', async () => {
    const loggerCalls = { info: [] as string[] };
    const previewProvider = new MarkdownViewProvider(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {} as never,
      {
        isGitHubDocument() {
          return false;
        },
      } as never,
      createLogger(loggerCalls),
    );

    const preview = {
      document: {
        uri: vscode.Uri.parse('test-workspace:/api.md'),
        getText() {
          return '';
        },
      },
      panel: { webview: { async postMessage() { return true; } } },
      contributedStyles: { stylesheets: [], roots: [] },
      commentsVisible: false,
      hasCommentsPatch: false,
      diffAvailable: false,
      canNavigatePreviousDiff: false,
      canNavigateNextDiff: false,
      diffRefreshGeneration: 0,
      pullRequestRefreshGeneration: 0,
      generation: 0,
    };

    (previewProvider as unknown as { ensurePreview(uri: vscode.Uri): Promise<unknown> }).ensurePreview = async () => preview;
    (previewProvider as unknown as { render(preview: unknown): Promise<void> }).render = async () => {};
    (previewProvider as unknown as { refreshDiffAvailability(preview: unknown): Promise<void> }).refreshDiffAvailability = async () => {};
    (previewProvider as unknown as { activePreview?: unknown }).activePreview = preview;

    await previewProvider.showDiff('test-workspace:/api.md', {
      kind: 'file',
      uri: 'my_crate@1.2.3:/sdk/keyvault/api.md',
    });
    await previewProvider.hideDiff('test-workspace:/api.md');

    assert.deepStrictEqual(loggerCalls.info, [
      'Opening diff for test-workspace:/api.md against file "my_crate@1.2.3:/sdk/keyvault/api.md"',
      'Closed diff for test-workspace:/api.md against file "my_crate@1.2.3:/sdk/keyvault/api.md"',
    ]);
  });

  test('requests pull request context on preview load without fetching diff history', async () => {
    const requests: string[] = [];
    let diffAvailabilityRequests = 0;
    const previewProvider = new MarkdownViewProvider(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {
        async getAvailability() {
          diffAvailabilityRequests++;
          return { candidates: [], canPickFile: true };
        },
      } as never,
      {
        isGitHubDocument() {
          return false;
        },
        async getContext(document: vscode.TextDocument) {
          requests.push(document.uri.toString());
          return undefined;
        },
      } as never,
      createLogger(),
    );
    const document = {
      uri: vscode.Uri.parse('file:///workspace/sdk/keyvault/api.md'),
      getText() {
        return '# API';
      },
    } as vscode.TextDocument;
    const webviewPanel = {
      active: true,
      webview: {
        options: undefined,
        html: '',
        async postMessage() {
          return true;
        },
        onDidReceiveMessage() {
          return { dispose() { } };
        },
      },
      onDidChangeViewState() {
        return { dispose() { } };
      },
      onDidDispose() {
        return { dispose() { } };
      },
    } as unknown as vscode.WebviewPanel;

    (previewProvider as unknown as { render(preview: unknown): Promise<void> }).render = async () => {};

    await previewProvider.resolveCustomTextEditor(document, webviewPanel);
    await Promise.resolve();

    assert.deepStrictEqual(requests, ['file:///workspace/sdk/keyvault/api.md']);
    assert.strictEqual(diffAvailabilityRequests, 0);
    assert.strictEqual((previewProvider as unknown as {
      activePreview?: { diffAvailable: boolean };
    }).activePreview?.diffAvailable, true);
  });

  test('auto-opens the tagged pull request base diff on preview load', async () => {
    let diffAvailabilityRequests = 0;
    const previewProvider = new MarkdownViewProvider(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {
        async getAvailability() {
          diffAvailabilityRequests++;
          return {
            pullRequestBase: {
              baseline: { kind: 'tag', ref: 'crate@1.0.0' },
              label: 'crate@1.0.0',
              description: '2026-09-11',
              detail: 'merge latest baseline',
            },
            candidates: [],
            defaultBaseline: { kind: 'tag', ref: 'crate@1.0.0' },
            canPickFile: true,
          };
        },
      } as never,
      {
        isGitHubDocument() {
          return false;
        },
        async getContext() {
          return {
            document: {
              repository: { owner: 'heaths', repo: 'api-review' },
              ref: 'feature/history',
              path: 'sdk/keyvault/api.md',
            } satisfies GitHubDocumentRef,
            pullRequest: {
              number: 26,
              title: 'Active PR',
              state: 'open',
              baseRef: 'main',
              baseSha: '1234567890abcdef',
              headRef: 'feature/history',
              headSha: 'fedcba0987654321',
              headOwner: 'heaths',
            } satisfies GitHubPullRequest,
          };
        },
      } as never,
      createLogger(),
    );
    (previewProvider as unknown as { render(preview: unknown): Promise<void> }).render = async () => {};
    const activePreview = {
      document: {
        uri: vscode.Uri.parse('file:///workspace/sdk/keyvault/api.md'),
        getText() {
          return '# API';
        },
      },
      panel: { webview: { async postMessage() { return true; } } },
      contributedStyles: { stylesheets: [], roots: [] },
      commentsVisible: false,
      hasCommentsPatch: false,
      diffAvailable: true,
      canNavigatePreviousDiff: false,
      canNavigateNextDiff: false,
      diffRefreshGeneration: 0,
      pullRequestRefreshGeneration: 0,
      generation: 0,
    };
    (previewProvider as unknown as { previews: Set<unknown>; activePreview?: unknown }).previews.add(activePreview);
    (previewProvider as unknown as { activePreview?: unknown }).activePreview = activePreview;

    await (previewProvider as unknown as {
      refreshPullRequestContext(preview: unknown): Promise<void>;
    }).refreshPullRequestContext(activePreview);

    assert.strictEqual(diffAvailabilityRequests, 1);
    assert.deepStrictEqual((activePreview as { diffBaseline?: unknown }).diffBaseline, { kind: 'tag', ref: 'crate@1.0.0' });
  });

  test('preserves an active diff when lazy history loading fails', async () => {
    const previewProvider = new MarkdownViewProvider(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {
        async getAvailability() {
          throw new Error('history unavailable');
        },
      } as never,
      {
        isGitHubDocument() {
          return false;
        },
      } as never,
      createLogger(),
    );
    const preview = {
      document: {
        uri: vscode.Uri.parse('test-workspace:/api.md'),
        getText() {
          return '# API';
        },
      },
      panel: { webview: { async postMessage() { return true; } } },
      contributedStyles: { stylesheets: [], roots: [] },
      commentsVisible: false,
      hasCommentsPatch: false,
      diffAvailable: true,
      diffBaseline: { kind: 'file', uri: 'file:///baseline/api.md' },
      canNavigatePreviousDiff: true,
      canNavigateNextDiff: true,
      diffRefreshGeneration: 0,
      pullRequestRefreshGeneration: 0,
      generation: 0,
    };

    (previewProvider as unknown as { previews: Set<unknown>; activePreview?: unknown }).previews.add(preview);
    (previewProvider as unknown as { activePreview?: unknown }).activePreview = preview;

    const availability = await (previewProvider as unknown as {
      refreshDiffAvailability(preview: unknown): Promise<unknown>;
    }).refreshDiffAvailability(preview);

    assert.strictEqual(availability, undefined);
    assert.deepStrictEqual(preview.diffBaseline, { kind: 'file', uri: 'file:///baseline/api.md' });
    assert.strictEqual(preview.diffAvailable, true);
  });

  test('does not reopen an auto-opened pull request diff after the user closes it', async () => {
    let diffAvailabilityRequests = 0;
    const pullRequestContext = {
      document: {
        repository: { owner: 'heaths', repo: 'api-review' },
        ref: 'feature/history',
        path: 'sdk/keyvault/api.md',
      } satisfies GitHubDocumentRef,
      pullRequest: {
        number: 26,
        title: 'Active PR',
        state: 'open',
        baseRef: 'main',
        baseSha: '1234567890abcdef',
        headRef: 'feature/history',
        headSha: 'fedcba0987654321',
        headOwner: 'heaths',
      } satisfies GitHubPullRequest,
    };
    const previewProvider = new MarkdownViewProvider(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {
        async getAvailability() {
          diffAvailabilityRequests++;
          return {
            pullRequestBase: {
              baseline: { kind: 'tag', ref: 'crate@1.0.0' },
              label: 'crate@1.0.0',
              description: '2026-09-11',
              detail: 'merge latest baseline',
            },
            candidates: [],
            defaultBaseline: { kind: 'tag', ref: 'crate@1.0.0' },
            canPickFile: true,
          };
        },
      } as never,
      {
        isGitHubDocument() {
          return false;
        },
        async getContext() {
          return pullRequestContext;
        },
      } as never,
      createLogger(),
    );
    (previewProvider as unknown as { render(preview: unknown): Promise<void> }).render = async () => {};
    const preview = {
      document: {
        uri: vscode.Uri.parse('file:///workspace/sdk/keyvault/api.md'),
        getText() {
          return '# API';
        },
      } as vscode.TextDocument,
      panel: { webview: { async postMessage() { return true; } } },
      contributedStyles: { stylesheets: [], roots: [] },
      commentsVisible: false,
      hasCommentsPatch: false,
      diffAvailable: true,
      diffBaseline: { kind: 'tag', ref: 'crate@1.0.0' },
      canNavigatePreviousDiff: false,
      canNavigateNextDiff: false,
      diffRefreshGeneration: 0,
      pullRequestContext,
      suppressedPullRequestDiffKey: undefined,
      pullRequestRefreshGeneration: 0,
      generation: 0,
    } as {
      document: vscode.TextDocument;
      panel: { webview: { postMessage(message: unknown): Promise<boolean> } };
      contributedStyles: { stylesheets: readonly vscode.Uri[]; roots: readonly vscode.Uri[] };
      commentsVisible: boolean;
      hasCommentsPatch: boolean;
      diffAvailable: boolean;
      diffBaseline?: { kind: 'tag'; ref: string };
      canNavigatePreviousDiff: boolean;
      canNavigateNextDiff: boolean;
      diffRefreshGeneration: number;
      pullRequestContext?: typeof pullRequestContext;
      suppressedPullRequestDiffKey?: string;
      pullRequestRefreshGeneration: number;
      generation: number;
    };
    (previewProvider as unknown as { previews: Set<unknown>; activePreview?: unknown }).previews.add(preview);
    (previewProvider as unknown as { activePreview?: unknown }).activePreview = preview;

    await (previewProvider as unknown as {
      closeDiff(preview: unknown): Promise<void>;
      refreshPullRequestContext(preview: unknown): Promise<void>;
    }).closeDiff(preview);
    preview.pullRequestContext = undefined;
    await (previewProvider as unknown as {
      refreshPullRequestContext(preview: unknown): Promise<void>;
    }).refreshPullRequestContext(preview);

    assert.strictEqual(diffAvailabilityRequests, 0);
    assert.strictEqual(preview.diffBaseline, undefined);
  });

  test('logs review start and completion actions', async () => {
    const loggerCalls = { info: [] as string[] };
    const pullRequest = {
      number: 42,
      title: 'Review comments',
      state: 'open',
      baseRef: 'main',
      baseSha: 'base-sha',
      headRef: 'feature/comments',
      headSha: 'head-sha',
      headOwner: 'heaths',
    } as const;
    const documentRef = {
      repository: { owner: 'heaths', repo: 'api-review' },
      ref: 'head-sha',
      path: 'sdk/keyvault/api/api.md',
    };
    const pullRequestContext = {
      document: documentRef,
      pullRequest,
    };

    const messages: unknown[] = [];
    const previewProvider = new MarkdownViewProvider(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {} as never,
      {
        isGitHubDocument() {
          return false;
        },
        async getContext() {
          return pullRequestContext;
        },
        async submitReview() {
          return 0;
        },
        hasPendingReview() {
          return false;
        },
        async getLineComments() {
          return new Map();
        },
      } as never,
      createLogger(loggerCalls),
    );

    const preview = {
      document: {
        uri: vscode.Uri.parse('test-workspace:/api.md'),
        getText() {
          return '';
        },
      },
      panel: {
        webview: {
          async postMessage(message: unknown) {
            messages.push(message);
            return true;
          },
        },
      },
      contributedStyles: { stylesheets: [], roots: [] },
      commentsVisible: false,
      hasCommentsPatch: false,
      diffAvailable: false,
      canNavigatePreviousDiff: false,
      canNavigateNextDiff: false,
      diffRefreshGeneration: 0,
      pullRequestContext,
      pullRequestRefreshGeneration: 0,
      generation: 0,
    };

    (previewProvider as unknown as { previews: Set<unknown>; activePreview?: unknown }).previews.add(preview);
    (previewProvider as unknown as { activePreview?: unknown }).activePreview = preview;

    await (previewProvider as unknown as {
      promptPullRequestReview(event: 'APPROVE' | 'REQUEST_CHANGES'): Promise<void>;
    }).promptPullRequestReview('REQUEST_CHANGES');
    await (previewProvider as unknown as {
      submitPullRequestReview(event: 'APPROVE' | 'REQUEST_CHANGES', body?: string): Promise<void>;
    }).submitPullRequestReview('REQUEST_CHANGES', 'Needs work');

    assert.deepStrictEqual(loggerCalls.info, [
      'Started reject review for pull request #42',
      'Submitting reject review for pull request #42',
      'Completed reject review for pull request #42',
    ]);
    assert.ok(messages.some(message => {
      return typeof message === 'object'
        && message !== null
        && 'type' in message
        && message.type === 'openPullRequestReviewDialog';
    }));
  });

  test('adds a new pending comment unless a draft localId is explicitly selected for update', async () => {
    const pullRequest = {
      number: 42,
      title: 'Review comments',
      state: 'open',
      baseRef: 'main',
      baseSha: 'base-sha',
      headRef: 'feature/comments',
      headSha: 'head-sha',
      headOwner: 'heaths',
    } as const;
    const documentRef = {
      repository: { owner: 'heaths', repo: 'api-review' },
      ref: 'head-sha',
      path: 'sdk/keyvault/api/api.md',
    };
    const pullRequestContext = {
      document: documentRef,
      pullRequest,
    };

    const existingCalls: unknown[] = [];
    const previewProvider = new MarkdownViewProvider(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {} as never,
      {
        isGitHubDocument() {
          return false;
        },
        async upsertComment(
          _document: GitHubDocumentRef,
          _pullRequest: GitHubPullRequest,
          _line: number,
          _body: string,
          existing?: PullRequestLineComment,
        ) {
          existingCalls.push(existing);
          return {
            id: 5,
            localId: typeof existing?.localId === 'string' ? existing.localId : undefined,
            body: 'Updated comment',
            sourceLine: 9,
            kind: 'review',
            originalPostId: 5,
            isDraft: true,
          };
        },
        async getLineComments() {
          return new Map([[9, [{
            id: 5,
            localId: 'draft-1',
            body: 'Pending comment',
            sourceLine: 9,
            kind: 'review',
            reviewId: 12,
            originalPostId: 5,
            author: 'heaths',
            avatarUrl: 'https://avatars.githubusercontent.com/u/1532486?v=4',
            updatedAt: '2026-09-11T12:00:00Z',
            isDraft: true,
          }]]]);
        },
      } as never,
      createLogger(),
    );

    const preview = {
      document: {
        uri: vscode.Uri.parse('test-workspace:/api.md'),
        getText() {
          return '';
        },
      },
      panel: { webview: { async postMessage() { return true; } } },
      contributedStyles: { stylesheets: [], roots: [] },
      commentsVisible: false,
      hasCommentsPatch: false,
      diffAvailable: false,
      canNavigatePreviousDiff: false,
      canNavigateNextDiff: false,
      diffRefreshGeneration: 0,
      pullRequestContext,
      pullRequestRefreshGeneration: 0,
      generation: 0,
    };

    (previewProvider as unknown as { render(preview: unknown): Promise<void> }).render = async () => {};

    await (previewProvider as unknown as {
      upsertPullRequestComment(preview: unknown, line: number, body: string, localId?: string): Promise<void>;
    }).upsertPullRequestComment(preview, 9, 'Another pending comment');
    await (previewProvider as unknown as {
      upsertPullRequestComment(preview: unknown, line: number, body: string, localId?: string): Promise<void>;
    }).upsertPullRequestComment(preview, 9, 'Edit pending comment', 'draft-1');

    assert.deepStrictEqual(existingCalls, [undefined, {
      id: 5,
      localId: 'draft-1',
      body: 'Pending comment',
      sourceLine: 9,
      kind: 'review',
      reviewId: 12,
      originalPostId: 5,
      author: 'heaths',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1532486?v=4',
      updatedAt: '2026-09-11T12:00:00Z',
      isDraft: true,
    }]);
  });
});
