import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitHubDocumentRef, GitHubPullRequest } from '../../githubClient';
import { createPreviewLineMetadata } from '../../lineMetadata';
import { PullRequestLineComment } from '../../pullRequestReview';
import {
  getContributedMarkdownPreviewStyles,
  getPathLabel,
  getPreviewHtml,
  renderCommentMarkdown,
  renderMarkdown,
  renderPreviewMarkdown,
  ReviewMarkdownPreview,
} from '../../markdownPreview';

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

suite('Markdown preview', () => {
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
    assert.strictEqual(getPathLabel('/sdk/keyvault/API.md'), 'API.md');
    assert.strictEqual(getPathLabel('my_crate@1.2.3:/sdk/keyvault/API.md'), 'API.md');
    assert.strictEqual(getPathLabel('file:///sdk/keyvault/API.md'), 'API.md');
  });

  test('maps actionable preview lines to patched markdown lines', () => {
    const source = [
      '# Mock API',
      '',
      '```rust',
      'pub fn hello();',
      '```',
    ].join('\n');
    const lineMetadata = createPreviewLineMetadata(source, {
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
        '--- a/API.md',
        '+++ b/API.md',
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
      previewLine: 4,
      hasDocumentation: true,
      hasSource: true,
      documentationGroupId: 'line-3',
      documentationPreviewLines: [3],
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
    const lineMetadata = createPreviewLineMetadata(source, {
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
        '--- a/API.md',
        '+++ b/API.md',
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
        previewLine: 4,
        line: 3,
        language: 'rust',
        documentation: ['/// Documentation only.'],
        hasDocumentation: true,
        hasSource: false,
        documentationGroupId: 'line-3',
        documentationPreviewLines: [3],
        pullRequestComments: undefined,
        hasPullRequestDiscussion: false,
        ariaLabel: 'Review actions available: documentation',
      },
      {
        sourceLine: 4,
        previewLine: 5,
        line: 4,
        language: 'rust',
        source: new vscode.Location(vscode.Uri.parse('test:/src/lib.rs'), new vscode.Range(1, 0, 1, 1)),
        hasDocumentation: false,
        hasSource: true,
        documentationGroupId: undefined,
        documentationPreviewLines: [],
        pullRequestComments: undefined,
        hasPullRequestDiscussion: false,
        ariaLabel: 'Review actions available: go to source',
      },
    ]);
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

    const lineMetadata = createPreviewLineMetadata(source, {
      markdown: source,
      hasCommentsPatch: false,
    }, [{
      line: 3,
      language: 'rust',
    }], pullRequestComments);
    const html = renderPreviewMarkdown(source, lineMetadata);

    assert.deepStrictEqual(lineMetadata, [{
      sourceLine: 3,
      previewLine: 3,
      line: 3,
      language: 'rust',
      hasDocumentation: false,
      hasSource: false,
      documentationGroupId: undefined,
      documentationPreviewLines: [],
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

    const lineMetadata = createPreviewLineMetadata(source, {
      markdown: source,
      hasCommentsPatch: false,
    }, [{
      line: 3,
      language: 'rust',
    }], pullRequestComments);

    assert.deepStrictEqual(lineMetadata, [{
      sourceLine: 3,
      previewLine: 3,
      line: 3,
      language: 'rust',
      hasDocumentation: false,
      hasSource: false,
      documentationGroupId: undefined,
      documentationPreviewLines: [],
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

    const lineMetadata = createPreviewLineMetadata(source, {
      markdown: source,
      hasCommentsPatch: false,
    }, [], pullRequestComments);

    assert.deepStrictEqual(lineMetadata, [{
      line: 3,
      language: 'rust',
      sourceLine: 3,
      previewLine: 3,
      hasDocumentation: false,
      hasSource: false,
      documentationGroupId: undefined,
      documentationPreviewLines: [],
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
    const lineMetadata = createPreviewLineMetadata(source, {
      markdown,
      hasCommentsPatch: true,
      commentsPatch: [
        '--- a/API.md',
        '+++ b/API.md',
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

    const html = renderPreviewMarkdown(markdown, lineMetadata);

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

    const html = getPreviewHtml(
      webview,
      root,
      vscode.Uri.parse('test-workspace:/API.md'),
      '<p>API</p>',
      true,
      false,
      false,
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
    const styles = getContributedMarkdownPreviewStyles([
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
    const styles = getContributedMarkdownPreviewStyles([
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
    assert.ok(css.includes('.markdown-body pre {\n  overflow: auto;\n  padding: var(--preview-code-block-padding);\n  padding-inline-start: 0;'));
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
      path: 'sdk/keyvault/api/API.md',
    };
    const pullRequestContext = {
      document: documentRef,
      pullRequest,
    };

    let hasPendingReview = true;
    const messages: unknown[] = [];
    const previewProvider = new ReviewMarkdownPreview(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {} as never,
      {
        async getPullRequestContext() {
          return pullRequestContext;
        },
      } as never,
      {
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
            updatedAt: '2026-09-11T12:00:00Z',
            isDraft: hasPendingReview,
          }]]]);
        },
      } as never,
      createLogger(),
    );

    const preview = {
      document: {
        uri: vscode.Uri.parse('test-workspace:/API.md'),
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
    const previewProvider = new ReviewMarkdownPreview(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {} as never,
      {} as never,
      {} as never,
      createLogger(loggerCalls),
    );

    const preview = {
      document: {
        uri: vscode.Uri.parse('test-workspace:/API.md'),
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

    await previewProvider.showDiff('test-workspace:/API.md', {
      kind: 'file',
      uri: 'my_crate@1.2.3:/sdk/keyvault/API.md',
    });
    await previewProvider.hideDiff('test-workspace:/API.md');

    assert.deepStrictEqual(loggerCalls.info, [
      'Opening diff for test-workspace:/API.md against file "my_crate@1.2.3:/sdk/keyvault/API.md"',
      'Closed diff for test-workspace:/API.md against file "my_crate@1.2.3:/sdk/keyvault/API.md"',
    ]);
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
      path: 'sdk/keyvault/api/API.md',
    };
    const pullRequestContext = {
      document: documentRef,
      pullRequest,
    };

    const messages: unknown[] = [];
    const previewProvider = new ReviewMarkdownPreview(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {} as never,
      {
        async getPullRequestContext() {
          return pullRequestContext;
        },
      } as never,
      {
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
        uri: vscode.Uri.parse('test-workspace:/API.md'),
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
      path: 'sdk/keyvault/api/API.md',
    };
    const pullRequestContext = {
      document: documentRef,
      pullRequest,
    };

    const existingCalls: unknown[] = [];
    const previewProvider = new ReviewMarkdownPreview(
      {} as never,
      vscode.Uri.parse('test-extension:/extension'),
      {} as never,
      {} as never,
      {
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
            updatedAt: '2026-09-11T12:00:00Z',
            isDraft: true,
          }]]]);
        },
      } as never,
      createLogger(),
    );

    const preview = {
      document: {
        uri: vscode.Uri.parse('test-workspace:/API.md'),
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
      updatedAt: '2026-09-11T12:00:00Z',
      isDraft: true,
    }]);
  });
});
