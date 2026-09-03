import * as assert from 'assert';
import { mapDocumentation } from '../../markdown';

suite('Markdown mapping', () => {
  test('maps a unique declaration inside a fenced code block', () => {
    const markdown = '# example\n\n```rust\npub fn hello(target: Option<String>);\n```';
    const matches = mapDocumentation(markdown, [{
      line: 3,
      declaration: 'pub fn hello(target: Option<String>);',
      documentation: ['/// Prints hello.'],
    }]);

    assert.deepStrictEqual(matches, [{
      line: 3,
      language: 'rust',
      documentation: ['/// Prints hello.'],
    }]);
  });

  test('maps duplicate declarations by old-side line number', () => {
    const markdown = '```rust\npub fn hello();\npub fn hello();\n```';
    assert.deepStrictEqual(mapDocumentation(markdown, [{
      line: 2,
      declaration: 'pub fn hello();',
      documentation: ['/// Hello.'],
    }]), [{
      line: 2,
      language: 'rust',
      documentation: ['/// Hello.'],
    }]);
  });

  test('rejects stale hunk context at the expected line', () => {
    const markdown = '```rust\npub fn current();\n```';
    assert.deepStrictEqual(mapDocumentation(markdown, [{
      line: 1,
      declaration: 'pub fn stale();',
      documentation: ['/// Stale.'],
    }]), []);
  });
});
