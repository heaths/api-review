import * as assert from 'assert';
import * as vscode from 'vscode';
import { getHoverPosition } from '../../codeLensProvider';

suite('Documentation hover placement', function () {
  this.timeout(20_000);

  test('aligns documentation with the Documentation CodeLens column', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# API\n\n```rust\npub fn first(argument: Option<String>) -> Result<()>;\n    pub fn second();\n```',
    });

    // The anchor is never the end of the preceding line, however long that line is.
    assert.deepStrictEqual(getHoverPosition(document, 3), new vscode.Position(2, 0));
    assert.deepStrictEqual(getHoverPosition(document, 4), new vscode.Position(3, 4));
    assert.strictEqual(getHoverPosition(document, 0), undefined);
    assert.strictEqual(getHoverPosition(document, document.lineCount), undefined);
  });

  test('clamps the anchor when the preceding line is shorter than the declaration indent', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '```rust\n\n        pub fn indented();\n```',
    });

    assert.deepStrictEqual(getHoverPosition(document, 2), new vscode.Position(1, 0));
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
    assert.strictEqual(lens.command.tooltip, 'Click to show documentation');

    const source = codeLenses.find(candidate => candidate.command?.command === 'heaths.apiReview.goToSource');
    assert.strictEqual(source?.command?.tooltip, 'Navigate to declaration');

    const line = lens.range.start.line;

    assert.strictEqual(
      await findDocumentation(uri, lens.range.start),
      undefined,
      'Documentation should not be shown when hovering the code line',
    );

    await vscode.commands.executeCommand('heaths.apiReview.showDocumentation', ...lens.command.arguments);

    const position = getHoverPosition(document, line);
    assert.ok(position, 'Documentation should be anchored above the declaration');
    assert.strictEqual(position.line, line - 1, 'Documentation should be anchored above the CodeLens row');
    assert.strictEqual(
      position.character,
      document.lineAt(line).firstNonWhitespaceCharacterIndex,
      'Documentation should be aligned with the Documentation CodeLens column',
    );

    const hover = await findDocumentation(uri, position);
    assert.ok(hover, 'Documentation should be shown for the CodeLens anchor');
    assert.ok(hover.range?.isEmpty, 'Documentation should be anchored to a zero-width range');

    assert.strictEqual(
      await findDocumentation(uri, lens.range.start),
      undefined,
      'Documentation should not be shown when hovering the code line after showing documentation',
    );
  });
});

async function findDocumentation(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<vscode.Hover | undefined> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    uri,
    position,
  );

  return hovers.find(hover => hover.contents.some(content => {
    const value = typeof content === 'string' ? content : content.value;
    return value.includes('///');
  }));
}
