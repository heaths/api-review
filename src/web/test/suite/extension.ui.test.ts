import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  markdownViewType,
  reopenViewAsTextCommand,
} from '../../markdownView';

suite('Web Extension UI Test Suite', function () {
  this.timeout(20_000);

  const fixturePath = 'src/web/test/fixtures/v2/API.md';

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

  test('navigates from the custom preview to the mapped source file in a text editor', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, fixturePath);
    await vscode.commands.executeCommand('vscode.openWith', uri, markdownViewType);
    const previewTab = findTab(uri, markdownViewType);
    assert.ok(previewTab, 'Expected the API fixture to stay open in the custom preview');
    const reviewTextTabCountBefore = countTextTabs(uri);
    const sourceUri = vscode.Uri.joinPath(folder.uri, 'src/web/test/fixtures/src/lib.rs');
    const sourceTabBefore = findTab(sourceUri, 'default-text');

    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
    );
    const source = codeLenses.find(candidate => candidate.command?.command === 'heaths.azureApiReview.goToSource');
    assert.ok(source?.command?.arguments, 'Source CodeLens was not provided');

    await vscode.commands.executeCommand('heaths.azureApiReview.goToSource', {
      ...(source.command.arguments[0] as { uri: string; line: number }),
      view: 'custom',
    });

    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, 'Expected the source file to open from the custom preview');
    assert.strictEqual(editor.document.uri.path, sourceUri.path);
    assert.strictEqual(editor.selection.active.line, 1);

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputText, 'Active tab is not the default text editor');
    assert.strictEqual(input.uri.path, sourceUri.path);
    assert.ok(findTab(uri, markdownViewType), 'Expected the custom preview tab to remain open');
    assert.ok(findTab(sourceUri, 'default-text'), 'Expected the source file to be open in a text tab');
    assert.strictEqual(
      countTextTabs(uri),
      reviewTextTabCountBefore,
      'API fixture should not open an additional default text editor tab during custom-view navigation',
    );
    if (!sourceTabBefore) {
      assert.strictEqual(countTextTabs(sourceUri), 1, 'Expected custom-view navigation to open one source text tab');
    }
  });

  test('opens a Markdown file in the custom preview', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, fixturePath);
    await vscode.commands.executeCommand('vscode.openWith', uri, markdownViewType);

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom, 'Active tab is not a custom editor');
    assert.strictEqual(input.viewType, markdownViewType);
  });

  test('reopens the custom preview in the default text editor', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, fixturePath);
    await vscode.commands.executeCommand('vscode.openWith', uri, markdownViewType);
    await vscode.commands.executeCommand(reopenViewAsTextCommand);

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputText, 'Active tab is not the default text editor');
    assert.strictEqual(input.uri.toString(), uri.toString());
  });
});

function findTab(uri: vscode.Uri, viewType: string): vscode.Tab | undefined {
  return vscode.window.tabGroups.all
    .flatMap(group => group.tabs)
    .find(tab => {
      if (viewType === 'default-text') {
        return tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString();
      }

      return tab.input instanceof vscode.TabInputCustom
        && tab.input.uri.toString() === uri.toString()
        && tab.input.viewType === viewType;
    });
}

function countTextTabs(uri: vscode.Uri): number {
  return vscode.window.tabGroups.all
    .flatMap(group => group.tabs)
    .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString())
    .length;
}
