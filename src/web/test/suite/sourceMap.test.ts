import * as assert from 'assert';
import { SourceMapGenerator } from 'source-map-js';
import * as vscode from 'vscode';
import { resolveOriginalLocation } from '../../sourceMap';

suite('Source map', () => {
  test('resolves an exact generated line to source', () => {
    const generator = new SourceMapGenerator({ file: 'API.md' });
    generator.addMapping({
      generated: { line: 4, column: 0 },
      original: { line: 4, column: 0 },
      source: '../src/lib.rs',
    });

    const location = resolveOriginalLocation(
      generator.toString(),
      vscode.Uri.parse('memfs:/crate/api/API.md.map'),
      4,
      0,
    );

    assert.strictEqual(location?.uri.toString(), 'memfs:/crate/src/lib.rs');
    assert.deepStrictEqual(location?.range.start, new vscode.Position(3, 0));
  });

  test('does not leak a mapping from a previous generated line', () => {
    const generator = new SourceMapGenerator();
    generator.addMapping({
      generated: { line: 3, column: 0 },
      original: { line: 1, column: 0 },
      source: '../src/lib.rs',
    });

    assert.strictEqual(resolveOriginalLocation(
      generator.toString(),
      vscode.Uri.parse('memfs:/crate/api/API.md.map'),
      4,
      0,
    ), undefined);
  });
});
