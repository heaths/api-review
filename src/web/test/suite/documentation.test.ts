import * as assert from 'assert';
import * as vscode from 'vscode';
import { createDocumentationUri, documentationScheme, getLanguageExtension, parseDocumentationUri } from '../../documentation';

suite('Documentation peek', function () {
  this.timeout(20_000);

  test('round-trips the declaration location through the virtual document URI', () => {
    const uri = vscode.Uri.from({ scheme: 'vscode-test-web', authority: 'mount', path: '/src/API.md' });
    const target = createDocumentationUri(uri, 42, 'rust');

    assert.strictEqual(target.scheme, documentationScheme);
    assert.strictEqual(target.path, `/Documentation${getLanguageExtension('rust')}`);
    const parsed = parseDocumentationUri(target);
    assert.strictEqual(parsed?.uri.toString(), uri.toString());
    assert.strictEqual(parsed.line, 42);
  });

  test('rejects malformed documentation URIs', () => {
    assert.strictEqual(parseDocumentationUri(vscode.Uri.from({ scheme: documentationScheme, path: '/Documentation.txt' })), undefined);
    assert.strictEqual(parseDocumentationUri(vscode.Uri.parse(`${documentationScheme}:/Documentation.txt?uri=x`)), undefined);
    assert.strictEqual(parseDocumentationUri(vscode.Uri.parse(`${documentationScheme}:/Documentation.txt?line=1`)), undefined);
    assert.strictEqual(parseDocumentationUri(vscode.Uri.parse(`${documentationScheme}:/Documentation.txt?uri=x&line=-1`)), undefined);
  });

  test('falls back to plain text for unknown languages', () => {
    assert.strictEqual(getLanguageExtension('not-a-language'), '.txt');
  });

  test('shows documentation in a peek widget without a hover on the code line', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'Test workspace was not mounted');

    const uri = vscode.Uri.joinPath(folder.uri, 'src/web/test/examples/API.md');
    assert.notStrictEqual(uri.scheme, 'file', 'Test workspace should use a virtual URI scheme');

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'azure-api-review');
    assert.ok(extension, 'Development extension was not found');
    await extension.activate();

    const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
    );
    const lens = codeLenses.find(candidate => candidate.command?.command === 'heaths.azureApiReview.showDocumentation');
    assert.ok(lens?.command?.arguments, 'Documentation CodeLens was not provided');
    assert.strictEqual(lens.command.tooltip, 'Click to show documentation');

    const source = codeLenses.find(candidate => candidate.command?.command === 'heaths.azureApiReview.goToSource');
    assert.strictEqual(source?.command?.tooltip, 'Navigate to declaration');

    const line = lens.range.start.line;
    const target = createDocumentationUri(uri, line, 'rust');
    const peeked = await vscode.workspace.openTextDocument(target);
    const documentation = peeked.getText().trim();
    assert.ok(documentation, 'The peeked document should contain the extracted doc comments');

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

    // The command opens the peek widget and leaves the declaration selected.
    await vscode.commands.executeCommand('heaths.azureApiReview.showDocumentation', ...lens.command.arguments);
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString());
    assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, line);
  });
});
