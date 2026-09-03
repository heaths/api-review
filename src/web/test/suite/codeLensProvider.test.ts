import * as assert from 'assert';
import * as vscode from 'vscode';
import { getHoverPosition } from '../../codeLensProvider';

suite('Documentation hover placement', function () {
  this.timeout(20_000);

  test('anchors documentation to the CodeLens row above the declaration', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# API\n\n```rust\npub fn hello();\n```',
    });

    assert.deepStrictEqual(getHoverPosition(document, 3), new vscode.Position(2, '```rust'.length));
    assert.strictEqual(getHoverPosition(document, 0), undefined);
    assert.strictEqual(getHoverPosition(document, document.lineCount), undefined);
  });

  test('shows documentation only for the CodeLens anchor and not the code line', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, 'src/web/test/examples/API.md');
    assert.notStrictEqual(uri.scheme, 'file', 'Test workspace should use a virtual URI scheme');

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
    );
    const lens = codeLenses.find(candidate => candidate.command?.command === 'heaths.apiReview.showDocumentation');
    assert.ok(lens?.command?.arguments, 'Documentation CodeLens was not provided');
    assert.ok(lens.command.tooltip, 'Documentation CodeLens should show documentation as a plain text tooltip');

    const line = lens.range.start.line;
    assert.deepStrictEqual(
      await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, lens.range.start),
      [],
      'Documentation should not be shown when hovering the code line',
    );

    await vscode.commands.executeCommand('heaths.apiReview.showDocumentation', ...lens.command.arguments);

    const position = getHoverPosition(document, line);
    assert.ok(position, 'Documentation should be anchored above the declaration');

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      uri,
      position,
    );
    assert.strictEqual(hovers.length, 1, 'Documentation should be shown for the CodeLens anchor');
    assert.ok(hovers[0].range?.isEmpty, 'Documentation should be anchored to a zero-width range');

    assert.deepStrictEqual(
      await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, lens.range.start),
      [],
      'Documentation should not be shown when hovering the code line after showing documentation',
    );
  });
});
