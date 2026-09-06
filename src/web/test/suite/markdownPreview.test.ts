import * as assert from 'assert';
import * as vscode from 'vscode';
import { getContributedMarkdownPreviewStyles, renderMarkdown } from '../../markdownPreview';

suite('Markdown preview', () => {
  test('renders standard Markdown content', () => {
    const html = renderMarkdown('# API\n\n[Documentation](https://example.com)');

    assert.ok(html.includes('<h1>API</h1>'));
    assert.ok(html.includes('<a href="https://example.com">Documentation</a>'));
  });

  test('syntax highlights comments in fenced code', () => {
    const html = renderMarkdown(['```rust', '/// Documentation.', 'pub fn hello();', '```'].join('\n'));

    assert.ok(html.includes('hljs-comment'));
    assert.ok(html.includes('<span class="code-line comment-line"><span class="hljs-comment">/// Documentation.</span></span>'));
    assert.ok(html.includes('<span class="code-line"><span class="hljs-keyword">pub</span>'));
    assert.ok(html.includes('pub'));
  });

  test('marks every line of a multiline comment as collapsible', () => {
    const html = renderMarkdown(['```css', '/* First line', ' * second line', ' */', '.selector {}', '```'].join('\n'));

    assert.strictEqual((html.match(/code-line comment-line/g) ?? []).length, 3);
    assert.ok(html.includes('<span class="code-line"><span class="hljs-selector-class">.selector</span>'));
  });

  test('escapes code in unknown fenced languages', () => {
    const html = renderMarkdown(['```unknown-language', '<script>alert(1)</script>', '```'].join('\n'));

    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
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
