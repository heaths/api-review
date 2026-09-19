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

});
