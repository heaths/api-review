import * as assert from 'assert';
import * as vscode from 'vscode';
import { discoverApiDocuments } from '../../fileDiscovery';
import {
  closePreviewDiffCommand,
  reopenPreviewAsTextCommand,
  reviewMarkdownPreviewViewType,
  nextPreviewDiffHunkCommand,
  previousPreviewDiffHunkCommand,
  showPreviewDiffCommand,
} from '../../markdownPreview';
import { ReviewModel } from '../../reviewModel';

suite('Web Extension Test Suite', function () {
  this.timeout(20_000);

  const fixturePath = 'src/web/test/fixtures/v2/API.md';
  const baselineFixturePath = 'src/web/test/fixtures/v1/API.md';

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
    const diffCommand = extension.packageJSON.contributes.commands.find(
      (command: { command: string }) => command.command === showPreviewDiffCommand,
    );
    assert.strictEqual(diffCommand?.icon, '$(diff)');
    const activeDiffCommand = extension.packageJSON.contributes.commands.find(
      (command: { command: string }) => command.command === closePreviewDiffCommand,
    );
    assert.strictEqual(activeDiffCommand?.icon, '$(close)');
    const nextDiffCommand = extension.packageJSON.contributes.commands.find(
      (command: { command: string }) => command.command === nextPreviewDiffHunkCommand,
    );
    assert.strictEqual(nextDiffCommand?.icon, '$(arrow-down)');
    const previousDiffCommand = extension.packageJSON.contributes.commands.find(
      (command: { command: string }) => command.command === previousPreviewDiffHunkCommand,
    );
    assert.strictEqual(previousDiffCommand?.icon, '$(arrow-up)');
    const sourceMenu = extension.packageJSON.contributes.menus['editor/title'].find(
      (menu: { command: string }) => menu.command === reopenPreviewAsTextCommand,
    );
    assert.strictEqual(sourceMenu?.group, 'navigation@5');
    const diffMenu = extension.packageJSON.contributes.menus['editor/title'].find(
      (menu: { command: string }) => menu.command === showPreviewDiffCommand,
    );
    assert.strictEqual(diffMenu?.group, 'navigation@1');
    const nextDiffMenu = extension.packageJSON.contributes.menus['editor/title'].find(
      (menu: { command: string }) => menu.command === nextPreviewDiffHunkCommand,
    );
    assert.strictEqual(nextDiffMenu?.group, 'navigation@1');
    const previousDiffMenu = extension.packageJSON.contributes.menus['editor/title'].find(
      (menu: { command: string }) => menu.command === previousPreviewDiffHunkCommand,
    );
    assert.strictEqual(previousDiffMenu?.group, 'navigation@2');
    const closeDiffMenu = extension.packageJSON.contributes.menus['editor/title'].find(
      (menu: { command: string }) => menu.command === closePreviewDiffCommand,
    );
    assert.strictEqual(closeDiffMenu?.group, 'navigation@3');
    const api = await extension.activate();
    assert.ok(api);
    assert.strictEqual(api.version, 1);
    assert.strictEqual(typeof api.showDiff, 'function');
    assert.strictEqual(typeof api.hideDiff, 'function');

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(showPreviewDiffCommand));
    assert.ok(commands.includes(nextPreviewDiffHunkCommand));
    assert.ok(commands.includes(previousPreviewDiffHunkCommand));
    assert.ok(commands.includes(closePreviewDiffCommand));
    assert.ok(commands.includes('heaths.azureApiReview.showDocumentation'));
    assert.ok(commands.includes('heaths.azureApiReview.goToSource'));
    assert.ok(commands.includes('heaths.azureApiReview.preview.showComments'));
    assert.ok(commands.includes('heaths.azureApiReview.preview.hideComments'));
    assert.ok(commands.includes(reopenPreviewAsTextCommand));
  });

  test('provides review CodeLens for the API fixture', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, fixturePath);
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

  test('navigates from the API fixture to the mapped source file', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, fixturePath);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
    );
    const source = codeLenses.find(candidate => candidate.command?.command === 'heaths.azureApiReview.goToSource');
    assert.ok(source?.command?.arguments, 'Source CodeLens was not provided');

    await vscode.commands.executeCommand('heaths.azureApiReview.goToSource', ...source.command.arguments);

    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, 'Expected the source file to open');
    assert.strictEqual(editor.document.uri.path, '/src/web/test/fixtures/src/lib.rs');
    assert.strictEqual(editor.selection.active.line, 1);
  });

  test('maps both v2 declarations to source lines in the current fixture', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, fixturePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const output = vscode.window.createOutputChannel('Azure API Review Test');
    const model = new ReviewModel(output);

    try {
      await model.refresh();
      const sourceLines = (await model.getEntries(document))
        .filter(entry => entry.source)
        .map(entry => entry.source?.range.start.line);

      assert.deepStrictEqual(sourceLines, [1, 3]);
    } finally {
      output.dispose();
    }
  });

  test('applies the configured comments patch for preview only', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, fixturePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const output = vscode.window.createOutputChannel('Azure API Review Test');
    const model = new ReviewModel(output);

    try {
      await model.refresh();
      const preview = await model.getPreviewContent(document);

      assert.strictEqual(preview.hasCommentsPatch, true);
      assert.ok(preview.markdown.includes('/// Greets the caller.'));
      assert.ok(preview.markdown.includes('/// Greets the gamma audience.'));
      assert.ok(!document.getText().includes('/// Greets the caller.'));
      assert.ok(!document.getText().includes('/// Greets the gamma audience.'));
    } finally {
      output.dispose();
    }
  });

  test('opens a Markdown file in the custom preview', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, fixturePath);
    await vscode.commands.executeCommand('vscode.openWith', uri, reviewMarkdownPreviewViewType);

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom, 'Active tab is not a custom editor');
    assert.strictEqual(input.viewType, reviewMarkdownPreviewViewType);
  });

  test('reopens the custom preview in the default text editor', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, fixturePath);
    await vscode.commands.executeCommand('vscode.openWith', uri, reviewMarkdownPreviewViewType);
    await vscode.commands.executeCommand(reopenPreviewAsTextCommand);

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputText, 'Active tab is not the default text editor');
    assert.strictEqual(input.uri.toString(), uri.toString());
  });

  test('shows and hides a file diff between versioned fixtures', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, fixturePath);
    const baseline = vscode.Uri.joinPath(folder.uri, baselineFixturePath);
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'azure-api-review');

    assert.ok(extension, 'Development extension was not found');
    const api = await extension.activate();
    await api.showDiff(uri.toString(), { kind: 'file', uri: baseline.toString() });
    await api.hideDiff(uri.toString());
  });
});
