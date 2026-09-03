import * as vscode from 'vscode';
import {
  goToSource,
  goToSourceCommand,
  ReviewCodeLensProvider,
  showDocumentationCommand,
} from './codeLensProvider';
import { DocumentationProvider, documentationScheme } from './documentation';
import { ReviewModel } from './reviewModel';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Azure API Review');
  const model = new ReviewModel(output);
  const provider = new ReviewCodeLensProvider(model);
  const documentation = new DocumentationProvider(model, output);
  const selector: vscode.DocumentSelector = { language: 'markdown' };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');

  const refreshDiscovery = async (): Promise<void> => {
    try {
      await model.refresh();
      provider.refresh();
      documentation.refresh();
    } catch (error) {
      output.appendLine(`Unable to discover API review files: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  context.subscriptions.push(
    output,
    watcher,
    vscode.languages.registerCodeLensProvider(selector, provider),
    vscode.workspace.registerTextDocumentContentProvider(documentationScheme, documentation),
    vscode.commands.registerCommand(showDocumentationCommand, argument => provider.showDocumentation(argument)),
    vscode.commands.registerCommand(goToSourceCommand, argument => goToSource(model, argument)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('heaths.azureApiReview.files')) {
        void refreshDiscovery();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshDiscovery()),
    vscode.workspace.onDidChangeTextDocument(event => {
      model.invalidate(event.document.uri);
      provider.refresh();
      documentation.refresh(event.document.uri);
    }),
    watcher.onDidCreate(() => void refreshDiscovery()),
    watcher.onDidChange(() => void refreshDiscovery()),
    watcher.onDidDelete(() => void refreshDiscovery()),
  );

  await refreshDiscovery();
}

export function deactivate() { }
