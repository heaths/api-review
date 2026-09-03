import * as vscode from 'vscode';
import { ReviewModel } from './reviewModel';

export const showDocumentationCommand = 'heaths.apiReview.showDocumentation';
export const goToSourceCommand = 'heaths.apiReview.goToSource';

interface DocumentationRequest {
  readonly uri: string;
  readonly version: number;
  readonly line: number;
  readonly character: number;
}

export class ReviewCodeLensProvider implements vscode.CodeLensProvider, vscode.HoverProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.changed.event;
  private request: DocumentationRequest | undefined;

  public constructor(private readonly model: ReviewModel) { }

  public refresh(): void {
    this.request = undefined;
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
          tooltip: entry.documentation.join('\n'),
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
    // Documentation is shown only for the `Documentation` CodeLens and never for the code line itself.
    const request = this.request;
    if (request?.uri !== document.uri.toString()
      || request.version !== document.version
      || request.line !== position.line
      || request.character !== position.character
      || !isRequested(document, position)) {
      return undefined;
    }

    const entry = (await this.model.getEntries(document)).find(candidate => candidate.line === request.line + 1);
    if (!entry?.documentation) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = false;
    markdown.appendCodeblock(entry.documentation.join('\n'), entry.language);
    return new vscode.Hover(markdown, new vscode.Range(position, position));
  }

  public async showDocumentation(argument: { uri: string; line: number }): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(argument.uri));
    const entries = await this.model.getEntries(document);
    if (!entries.some(entry => entry.line === argument.line && entry.documentation)) {
      return;
    }

    const position = getHoverPosition(document, argument.line);
    if (!position) {
      return;
    }

    this.request = {
      uri: document.uri.toString(),
      version: document.version,
      line: position.line,
      character: position.character,
    };

    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, document.lineAt(argument.line).range.end));
    await vscode.commands.executeCommand('editor.action.showHover');
  }
}

/**
 * Gets the zero-width position anchoring documentation for `line` to the row where its
 * `Documentation` CodeLens is rendered, or `undefined` if there is no such row.
 *
 * VS Code renders CodeLenses on a virtual row directly above the declaration, so anchoring
 * documentation to the end of the preceding line lets VS Code render it above or below that
 * line - wherever there is space - without obscuring the `Documentation` CodeLens.
 */
export function getHoverPosition(document: vscode.TextDocument, line: number): vscode.Position | undefined {
  if (line <= 0 || line >= document.lineCount) {
    return undefined;
  }

  return document.lineAt(line - 1).range.end;
}

function isRequested(document: vscode.TextDocument, position: vscode.Position): boolean {
  // The request remains valid only while the cursor stays where the command placed it,
  // so moving or clicking elsewhere dismisses the documentation.
  const editor = vscode.window.activeTextEditor;
  return editor?.document.uri.toString() === document.uri.toString()
    && editor.selection.active.isEqual(position);
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
