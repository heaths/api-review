import * as assert from 'assert';
import * as vscode from 'vscode';
import { expandIncludePattern, expandRelatedPattern } from '../../variables';

suite('Path variables', () => {
  const folder: vscode.WorkspaceFolder = {
    index: 0,
    name: 'crate',
    uri: vscode.Uri.parse('memfs:/workspace/crate'),
  };

  test('expands workspace include patterns', () => {
    assert.deepStrictEqual(expandIncludePattern('${workspaceFolder}/api/*.md', folder, [folder]), {
      folder,
      pattern: 'api/*.md',
    });
  });

  test('expands API-file variables in related patterns', () => {
    const expanded = expandRelatedPattern(
      '${fileBasenameNoExtension}.documentation.patch',
      { file: vscode.Uri.parse('memfs:/workspace/crate/api/api.md'), workspaceFolder: folder },
    );
    assert.strictEqual(expanded, 'api.documentation.patch');
  });

  test('rejects unsupported variables', () => {
    assert.strictEqual(expandRelatedPattern('${env:HOME}/api.md.map', {
      file: vscode.Uri.parse('memfs:/workspace/crate/api/api.md'),
      workspaceFolder: folder,
    }), undefined);
  });
});
