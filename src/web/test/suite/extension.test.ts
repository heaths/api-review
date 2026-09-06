import * as assert from 'assert';
import * as vscode from 'vscode';
import { discoverApiDocuments } from '../../fileDiscovery';
import { reopenPreviewAsTextCommand, reviewMarkdownPreviewViewType } from '../../markdownPreview';
import { ReviewModel } from '../../reviewModel';

suite('Web Extension Test Suite', function () {
  this.timeout(20_000);

  test('activates for Markdown and registers review commands', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# API' });
    await vscode.window.showTextDocument(document);
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'azure-api-review');

    assert.ok(extension, 'Development extension was not found');
    assert.strictEqual(
      extension.packageJSON.contributes.customEditors[0].selector[0].filenamePattern,
      '*.md',
    );
    const sourceCommand = extension.packageJSON.contributes.commands.find(
      (command: { command: string }) => command.command === reopenPreviewAsTextCommand,
    );
    assert.strictEqual(sourceCommand?.icon, '$(file-code)');
    const sourceMenu = extension.packageJSON.contributes.menus['editor/title'].find(
      (menu: { command: string }) => menu.command === reopenPreviewAsTextCommand,
    );
    assert.strictEqual(sourceMenu?.group, 'navigation@2');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('heaths.azureApiReview.showDocumentation'));
    assert.ok(commands.includes('heaths.azureApiReview.goToSource'));
    assert.ok(commands.includes('heaths.azureApiReview.preview.showComments'));
    assert.ok(commands.includes('heaths.azureApiReview.preview.hideComments'));
    assert.ok(commands.includes(reopenPreviewAsTextCommand));
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

  test('applies the configured comments patch for preview only', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, 'src/web/test/examples/API.md');
    const document = await vscode.workspace.openTextDocument(uri);
    const output = vscode.window.createOutputChannel('Azure API Review Test');
    const model = new ReviewModel(output);

    try {
      await model.refresh();
      const preview = await model.getPreviewContent(document);

      assert.strictEqual(preview.hasCommentsPatch, true);
      assert.ok(preview.markdown.includes('//! # Azure Core shared client library for Rust'));
      assert.ok(!document.getText().includes('//! # Azure Core shared client library for Rust'));
    } finally {
      output.dispose();
    }
  });

  test('opens a Markdown file in the custom preview', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, 'src/web/test/examples/API.md');
    await vscode.commands.executeCommand('vscode.openWith', uri, reviewMarkdownPreviewViewType);

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom, 'Active tab is not a custom editor');
    assert.strictEqual(input.viewType, reviewMarkdownPreviewViewType);
  });

  test('reopens the custom preview in the default text editor', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, 'src/web/test/examples/API.md');
    await vscode.commands.executeCommand('vscode.openWith', uri, reviewMarkdownPreviewViewType);
    await vscode.commands.executeCommand(reopenPreviewAsTextCommand);

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputText, 'Active tab is not the default text editor');
    assert.strictEqual(input.uri.toString(), uri.toString());
  });
});
