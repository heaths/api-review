import * as assert from 'assert';
import * as vscode from 'vscode';
import { createPreviewLineMetadata } from '../../lineMetadata';
import { getContributedMarkdownPreviewStyles, renderMarkdown, renderPreviewMarkdown } from '../../markdownPreview';

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
    const html = renderMarkdown(['```css', '/* First line', ' * second line', ' */', '.selector {}', '```'].join('\n'));

    assert.strictEqual((html.match(/code-line comment-line/g) ?? []).length, 3);
    assert.ok(html.includes('<span class="code-line" data-line="4"><span class="hljs-selector-class">.selector</span>'));
  });

  test('escapes code in unknown fenced languages', () => {
    const html = renderMarkdown(['```unknown-language', '<script>alert(1)</script>', '```'].join('\n'));

    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
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
        ariaLabel: 'Review actions available: go to source',
      },
    ]);
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
});
