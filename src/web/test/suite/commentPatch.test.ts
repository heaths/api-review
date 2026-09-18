import * as assert from 'assert';
import { applyCommentsPatch, extractDocumentationAnchors, mapViewLines } from '../../commentPatch';

suite('Comment patch', () => {
  test('applies inserted comments in memory', () => {
    const source = 'pub fn hello();\n';
    const patch = [
      '@@ -1,1 +1,2 @@',
      '+/// Prints a greeting.',
      ' pub fn hello();',
    ].join('\n');

    assert.strictEqual(applyCommentsPatch(source, patch), [
      '/// Prints a greeting.',
      'pub fn hello();',
      '',
    ].join('\n'));
  });

  test('rejects a patch whose context does not match', () => {
    const patch = [
      '@@ -1,1 +1,2 @@',
      ' missing();',
      '+/// Documentation.',
    ].join('\n');

    assert.strictEqual(applyCommentsPatch('actual();\n', patch), undefined);
  });

  test('anchors contiguous Rust documentation to the following declaration', () => {
    const patch = [
      '--- a/src/lib.rs',
      '+++ b/src/lib.rs',
      '@@ -1,1 +1,4 @@',
      '+/// Prints "Hello, world".',
      '+///',
      '+/// You can pass an optional target instead of "world".',
      ' pub fn hello(target: Option<String>);',
    ].join('\n');

    assert.deepStrictEqual(extractDocumentationAnchors(patch), [{
      lines: [{
        line: 0,
        declaration: 'pub fn hello(target: Option<String>);',
      }],
      documentation: [
        '/// Prints "Hello, world".',
        '///',
        '/// You can pass an optional target instead of "world".',
      ],
    }]);
  });

  test('ignores ordinary additions and documentation without a context anchor', () => {
    const patch = [
      '@@ -1,1 +1,3 @@',
      '+const value = 1;',
      ' pub fn first();',
      '+/// Orphaned documentation.',
    ].join('\n');

    assert.deepStrictEqual(extractDocumentationAnchors(patch), []);
  });

  test('tracks old-side line numbers across diff markers', () => {
    const patch = [
      '@@ -10,3 +10,4 @@',
      ' first();',
      '-removed();',
      '+/// Documents the replacement.',
      '+replacement();',
      ' last();',
    ].join('\n');

    assert.deepStrictEqual(extractDocumentationAnchors(patch), []);

    const documentationPatch = [
      '@@ -10,2 +10,3 @@',
      ' first();',
      '+/// Documents last.',
      ' last();',
    ].join('\n');

    assert.deepStrictEqual(extractDocumentationAnchors(documentationPatch), [{
      lines: [{
        line: 10,
        declaration: 'last();',
      }],
      documentation: ['/// Documents last.'],
    }]);
  });

  test('anchors documentation to every declaration line in the hunk', () => {
    const patch = [
      '@@ -74,2 +74,3 @@',
      '+/// Options used when creating a client.',
      ' #[derive(Clone, Debug)]',
      ' pub struct ClientOptions {',
    ].join('\n');

    assert.deepStrictEqual(extractDocumentationAnchors(patch), [{
      lines: [{
        line: 73,
        declaration: '#[derive(Clone, Debug)]',
      }, {
        line: 74,
        declaration: 'pub struct ClientOptions {',
      }],
      documentation: ['/// Options used when creating a client.'],
    }]);
  });

  test('maps original lines and inserted documentation to preview lines', () => {
    const source = [
      '# Mock API',
      '',
      '```rust',
      'pub fn hello();',
      '```',
    ].join('\n');
    const patch = [
      '--- a/API.md',
      '+++ b/API.md',
      '@@ -4,1 +4,2 @@',
      '+/// Prints a greeting.',
      ' pub fn hello();',
    ].join('\n');

    assert.deepStrictEqual(mapViewLines(source, patch), {
      sourceToView: [0, 1, 2, 4, 5],
      documentationGroups: [{
        line: 3,
        groupLine: 3,
        viewLine: 4,
        documentationViewLines: [3],
      }],
    });
  });

  test('maps every declaration line to one preview documentation group', () => {
    const source = [
      '```rust',
      '#[derive(Clone, Debug)]',
      'pub struct ClientOptions {',
      '```',
    ].join('\n');
    const patch = [
      '@@ -2,2 +2,3 @@',
      '+/// Options used when creating a client.',
      ' #[derive(Clone, Debug)]',
      ' pub struct ClientOptions {',
    ].join('\n');

    assert.deepStrictEqual(mapViewLines(source, patch), {
      sourceToView: [0, 2, 3, 4],
      documentationGroups: [{
        line: 1,
        groupLine: 1,
        viewLine: 2,
        documentationViewLines: [1],
      }, {
        line: 2,
        groupLine: 1,
        viewLine: 3,
        documentationViewLines: [1],
      }],
    });
  });
});
