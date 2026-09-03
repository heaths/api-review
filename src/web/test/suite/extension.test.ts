import * as assert from 'assert';
import * as vscode from 'vscode';
import { discoverApiDocuments } from '../../fileDiscovery';

suite('Web Extension Test Suite', function () {
  this.timeout(20_000);

  test('activates for Markdown and registers review commands', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# API' });
    await vscode.window.showTextDocument(document);
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'azure-api-review');

    assert.ok(extension, 'Development extension was not found');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('heaths.azureApiReview.showDocumentation'));
    assert.ok(commands.includes('heaths.azureApiReview.goToSource'));
  });

  test('provides review CodeLens for the API fixture', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, 'src/web/test/examples/API.md');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const include = vscode.workspace.getConfiguration('heaths.azureApiReview.files', uri).get<string[]>('include');
    assert.deepStrictEqual(include, ['**/API.md']);

    const descriptor = (await discoverApiDocuments()).find(candidate => candidate.uri.toString() === uri.toString());
    assert.ok(descriptor, 'API fixture was not discovered');
    assert.ok(descriptor.comments, 'API comments patch was not discovered');
    assert.ok(descriptor.sourceMap, 'API source map was not discovered');

    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
    );

    assert.ok(codeLenses.some(lens => lens.command?.command === 'heaths.azureApiReview.showDocumentation'),
      `Documentation CodeLens missing from ${codeLenses.length} results`);
    assert.ok(codeLenses.some(lens => lens.command?.command === 'heaths.azureApiReview.goToSource'),
      `Source CodeLens missing from ${codeLenses.length} results`);
  });
});
