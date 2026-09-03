import * as vscode from 'vscode';
import { ReviewEntry, ReviewModel } from './reviewModel';

export const showDocumentationCommand = 'heaths.apiReview.showDocumentation';
export const goToSourceCommand = 'heaths.apiReview.goToSource';

export class ReviewCodeLensProvider implements vscode.CodeLensProvider, vscode.HoverProvider {
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
          tooltip: 'Show documentation',
          arguments: [argument],
        }));
      }
      if (entry.source) {
        codeLenses.push(new vscode.CodeLens(range, {
          command: goToSourceCommand,
          title: '$(go-to-file) Go to source',
          tooltip: 'Go to source',
          arguments: [argument],
        }));
      }
    }
    return codeLenses;
  }

  public async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const entry = (await this.model.getEntries(document)).find(candidate => candidate.line === position.line);
    if (!entry?.documentation) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = false;
    markdown.appendCodeblock(entry.documentation.join('\n'), entry.language);
    return new vscode.Hover(markdown, document.lineAt(entry.line).range);
  }
}

export async function showDocumentation(
  model: ReviewModel,
  argument: { uri: string; line: number },
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(argument.uri));
  const entries = await model.getEntries(document);
  if (!entries.some(entry => entry.line === argument.line && entry.documentation)) {
    return;
  }

  const position = document.lineAt(argument.line).range.start;
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
  await vscode.commands.executeCommand('editor.action.showHover');
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
