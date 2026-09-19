import * as vscode from 'vscode';
import { ReviewModel } from './reviewModel';

export interface ReviewLineCommandArgument {
  readonly uri: string;
  readonly line: number;
  readonly view?: 'text' | 'custom';
}

export const goToSourceCommand = 'heaths.azureApiReview.goToSource';
export const goToSourceTooltip = 'Navigate to declaration';

export class NavigationService {
  public constructor(private readonly model: ReviewModel) { }

  public async goToSource(argument: ReviewLineCommandArgument): Promise<void> {
    const source = await this.resolveSourceLocation(argument);
    if (!source) {
      void vscode.window.showWarningMessage('The source location is no longer available.');
      return;
    }

    const { document, position, location } = source;
    if (argument.view === 'custom') {
      await vscode.commands.executeCommand('workbench.action.keepEditor');
      await vscode.window.showTextDocument(location.uri, {
        preview: true,
        selection: location.range,
      });
      return;
    }

    const registration = vscode.languages.registerDefinitionProvider(
      { scheme: document.uri.scheme, language: document.languageId },
      {
        provideDefinition(candidate, requestedPosition) {
          return candidate.uri.toString() === document.uri.toString() && requestedPosition.isEqual(position)
            ? location
            : undefined;
        },
      },
    );

    try {
      await vscode.window.showTextDocument(document, {
        preview: true,
        selection: new vscode.Range(position, position),
      });
      await vscode.commands.executeCommand('editor.action.revealDefinition');
    } finally {
      registration.dispose();
    }
  }

  private async resolveSourceLocation(argument: ReviewLineCommandArgument): Promise<{
    document: vscode.TextDocument;
    position: vscode.Position;
    location: vscode.Location;
  } | undefined> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(argument.uri));
    const entry = (await this.model.getEntries(document)).find(candidate => candidate.line === argument.line);
    if (!entry?.source) {
      return undefined;
    }

    return {
      document,
      position: document.lineAt(entry.line).range.start,
      location: entry.source,
    };
  }
}
