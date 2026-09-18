import * as assert from 'assert';
import { mapDocumentation } from '../../markdown';

suite('Markdown mapping', () => {
  test('maps a unique declaration inside a fenced code block', () => {
    const markdown = '# example\n\n```rust\npub fn hello(target: Option<String>);\n```';
    const matches = mapDocumentation(markdown, [{
      lines: [{
        line: 3,
        declaration: 'pub fn hello(target: Option<String>);',
      }],
      documentation: ['/// Prints hello.'],
    }]);

    assert.deepStrictEqual(matches, [{
      line: 3,
      documentationGroupLine: 3,
      language: 'rust',
      documentation: ['/// Prints hello.'],
    }]);
  });

  test('maps duplicate declarations by old-side line number', () => {
    const markdown = '```rust\npub fn hello();\npub fn hello();\n```';
    assert.deepStrictEqual(mapDocumentation(markdown, [{
      lines: [{
        line: 2,
        declaration: 'pub fn hello();',
      }],
      documentation: ['/// Hello.'],
    }]), [{
      line: 2,
      documentationGroupLine: 2,
      language: 'rust',
      documentation: ['/// Hello.'],
    }]);
  });

  test('rejects stale hunk context at the expected line', () => {
    const markdown = '```rust\npub fn current();\n```';
    assert.deepStrictEqual(mapDocumentation(markdown, [{
      lines: [{
        line: 1,
        declaration: 'pub fn stale();',
      }],
      documentation: ['/// Stale.'],
    }]), []);
  });

  test('maps one documentation block to every line in its declaration hunk', () => {
    const markdown = [
      '```rust',
      '#[derive(Clone, Debug)]',
      'pub struct ClientOptions {',
      '```',
    ].join('\n');

    assert.deepStrictEqual(mapDocumentation(markdown, [{
      lines: [{
        line: 1,
        declaration: '#[derive(Clone, Debug)]',
      }, {
        line: 2,
        declaration: 'pub struct ClientOptions {',
      }],
      documentation: ['/// Options used when creating a client.'],
    }]), [{
      line: 1,
      documentationGroupLine: 1,
      language: 'rust',
      documentation: ['/// Options used when creating a client.'],
    }, {
      line: 2,
      documentationGroupLine: 1,
      language: 'rust',
      documentation: ['/// Options used when creating a client.'],
    }]);
  });

  test('rejects the whole documentation hunk when one declaration line is stale', () => {
    const markdown = [
      '```rust',
      '#[derive(Clone, Debug)]',
      'pub struct CurrentOptions {',
      '```',
    ].join('\n');

    assert.deepStrictEqual(mapDocumentation(markdown, [{
      lines: [{
        line: 1,
        declaration: '#[derive(Clone, Debug)]',
      }, {
        line: 2,
        declaration: 'pub struct StaleOptions {',
      }],
      documentation: ['/// Stale.'],
    }]), []);
  });
});
