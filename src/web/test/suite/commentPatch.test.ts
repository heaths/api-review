import * as assert from 'assert';
import { extractDocumentationAnchors } from '../../commentPatch';

suite('Comment patch', () => {
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
      line: 0,
      declaration: 'pub fn hello(target: Option<String>);',
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
      line: 10,
      declaration: 'last();',
      documentation: ['/// Documents last.'],
    }]);
  });
});
