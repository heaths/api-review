import * as assert from 'assert';
import * as vscode from 'vscode';
import { createDocumentationUri, documentationScheme } from '../../documentation';

suite('Documentation peek UI', function () {
  this.timeout(20_000);

  test('shows documentation in a peek widget without a hover on the code line', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, 'src/web/test/fixtures/v2/api.md');
    assert.notStrictEqual(uri.scheme, 'file', 'Test workspace should use a virtual URI scheme');

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    assert.ok(
      vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText,
      'API fixture should start in the default text editor',
    );
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'azure-api-review');
    assert.ok(extension, 'Development extension was not found');
    await extension.activate();

    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
    );
    const documentationLenses = codeLenses.filter(
      candidate => candidate.command?.command === 'heaths.azureApiReview.showDocumentation',
    );
    assert.deepStrictEqual(
      documentationLenses.map(lens => lens.range.start.line),
      [13, 14],
      'Documentation CodeLens should be provided for each documented declaration',
    );
    const [lens, secondLens] = documentationLenses;
    assert.ok(lens.command?.arguments, 'Documentation CodeLens was not provided');
    assert.ok(secondLens.command?.arguments, 'Second Documentation CodeLens was not provided');
    assert.strictEqual(lens.command.title, '$(file-text) Documentation');
    assert.strictEqual(lens.command.tooltip, 'Show documentation');
    assert.strictEqual(secondLens.command.title, '$(file-text) Documentation');
    assert.strictEqual(secondLens.command.tooltip, 'Show documentation');

    const source = codeLenses.find(candidate => candidate.command?.command === 'heaths.azureApiReview.goToSource');
    assert.strictEqual(source?.command?.tooltip, 'Navigate to declaration');

    const line = lens.range.start.line;
    const firstTarget = createDocumentationUri(uri, line, 'rust');
    const documentation = (await vscode.workspace.openTextDocument(firstTarget)).getText().trim();
    assert.ok(documentation, 'The peeked document should contain the extracted doc comments');
    const target = createDocumentationUri(uri, secondLens.range.start.line, 'rust');
    const secondDocumentation = (await vscode.workspace.openTextDocument(target)).getText().trim();
    assert.notStrictEqual(secondDocumentation, documentation);

    // The command opens the peek widget without allowing the editor association to reopen the
    // declaration in the Azure API Review custom editor.
    await vscode.commands.executeCommand('heaths.azureApiReview.showDocumentation', ...lens.command.arguments);

    // Documentation is never rendered as a hover, so it can no longer obscure the CodeLens.
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      uri,
      lens.range.start,
    );
    assert.ok(
      !hovers.some(hover => hover.contents.some(content =>
        (typeof content === 'string' ? content : content.value).includes(documentation))),
      'Documentation should not be shown as a hover',
    );

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(
      input instanceof vscode.TabInputText,
      `Documentation should remain in the text editor; active input was ${describeTabInput(input)}`,
    );
    assert.strictEqual(input.uri.toString(), uri.toString());
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString());
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, lens.range.start.line);

    const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      uri,
      lens.range.start,
    );
    assert.ok(
      !definitions?.some(definition =>
        (definition instanceof vscode.Location ? definition.uri : definition.targetUri).scheme === documentationScheme),
      'Documentation definition provider should be disposed after the peek opens',
    );
  });
});

function describeTabInput(input: unknown): string {
  if (input instanceof vscode.TabInputCustom) {
    return `custom editor ${input.viewType} for ${input.uri.toString()}`;
  }
  if (input instanceof vscode.TabInputText) {
    return `text editor for ${input.uri.toString()}`;
  }
  return input?.constructor.name ?? String(input);
}
