import * as vscode from 'vscode';
import { createDocumentationUri } from './documentation';
import { ReviewModel } from './reviewModel';

export const showDocumentationCommand = 'heaths.azureApiReview.showDocumentation';
export const goToSourceCommand = 'heaths.azureApiReview.goToSource';

export class ReviewCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.changed.event;

  public constructor(private readonly model: ReviewModel) { }

  public refresh(): void {
    this.changed.fire();
  }

  public async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    for (const entry of await this.model.getEntries(document)) {
      const range = document.lineAt(entry.line).range;
      const argument = { uri: document.uri.toString(), line: entry.line };
      if (entry.documentation) {
        codeLenses.push(new vscode.CodeLens(range, {
          command: showDocumentationCommand,
          title: '$(eye) Documentation',
          tooltip: 'Click to show documentation',
          arguments: [argument],
        }));
      }
      if (entry.source) {
        codeLenses.push(new vscode.CodeLens(range, {
          command: goToSourceCommand,
          title: '$(go-to-file) Go to source',
          tooltip: 'Navigate to declaration',
          arguments: [argument],
        }));
      }
    }
    return codeLenses;
  }

  public async showDocumentation(argument: { uri: string; line: number }): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(argument.uri));
    const entry = (await this.model.getEntries(document))
      .find(candidate => candidate.line === argument.line && candidate.documentation);
    if (!entry) {
      void vscode.window.showWarningMessage('The documentation is no longer available.');
      return;
    }

    // VS Code renders the peek widget below the declaration, so it never obscures the CodeLens
    // and behaves like the built-in peek actions.
    const position = document.lineAt(entry.line).range.start;
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(position, position);

    const target = createDocumentationUri(document.uri, entry.line, entry.language);
    const location = new vscode.Location(target, new vscode.Position(0, 0));
    await vscode.commands.executeCommand(
      'editor.action.peekLocations',
      document.uri,
      position,
      [location],
      'peek',
    );
  }
}

export async function goToSource(
  model: ReviewModel,
  argument: { uri: string; line: number },
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(argument.uri));
  const entry = (await model.getEntries(document)).find(candidate => candidate.line === argument.line);
  if (!entry?.source) {
    void vscode.window.showWarningMessage('The source location is no longer available.');
    return;
  }

  await vscode.window.showTextDocument(entry.source.uri, { selection: entry.source.range });
}
