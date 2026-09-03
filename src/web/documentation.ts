import * as vscode from 'vscode';
import { ReviewModel } from './reviewModel';

/** Scheme of the read-only virtual documents rendered in the documentation peek widget. */
export const documentationScheme = 'azure-api-review';

/**
 * Builds the read-only virtual document URI containing the documentation for `line` of `uri`.
 *
 * The generated position is carried in the query so the documentation is re-resolved from the
 * model whenever the virtual document is opened, and the file extension gives the peek widget
 * the same syntax highlighting as the declaration.
 */
export function createDocumentationUri(uri: vscode.Uri, line: number, language: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: documentationScheme,
    path: `/Documentation${getLanguageExtension(language)}`,
    query: new URLSearchParams({ uri: uri.toString(), line: String(line) }).toString(),
  });
}

/** Parses a documentation URI created by {@link createDocumentationUri}. */
export function parseDocumentationUri(uri: vscode.Uri): { uri: vscode.Uri; line: number } | undefined {
  const query = new URLSearchParams(uri.query);
  const source = query.get('uri');
  const value = query.get('line');
  if (!source || !value) {
    return undefined;
  }

  const line = Number(value);
  if (!Number.isInteger(line) || line < 0) {
    return undefined;
  }

  return { uri: vscode.Uri.parse(source), line };
}

/** Serves extracted doc comments as read-only virtual documents for the peek widget. */
export class DocumentationProvider implements vscode.TextDocumentContentProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.changed.event;

  public constructor(
    private readonly model: ReviewModel,
    private readonly output: vscode.OutputChannel,
  ) { }

  /** Re-resolves documentation shown in any open peek widget after the model changes. */
  public refresh(uri?: vscode.Uri): void {
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== documentationScheme) {
        continue;
      }

      const argument = parseDocumentationUri(document.uri);
      if (argument && (!uri || argument.uri.toString() === uri.toString())) {
        this.changed.fire(document.uri);
      }
    }
  }

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string | undefined> {
    const argument = parseDocumentationUri(uri);
    if (!argument) {
      this.output.appendLine(`Unable to show documentation for ${uri.toString()}: the location is malformed.`);
      return undefined;
    }

    try {
      const document = await vscode.workspace.openTextDocument(argument.uri);
      const entry = (await this.model.getEntries(document)).find(candidate => candidate.line === argument.line);
      if (!entry?.documentation) {
        return undefined;
      }

      return entry.documentation.join('\n');
    } catch (error) {
      this.output.appendLine(
        `Unable to show documentation for ${argument.uri.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}

/**
 * Gets the file extension contributed for `language` so the peek widget highlights documentation
 * the same way as the declaration, or `.txt` when the language contributes no extension.
 */
export function getLanguageExtension(language: string): string {
  for (const extension of vscode.extensions.all) {
    const languages: unknown = extension.packageJSON?.contributes?.languages;
    if (!Array.isArray(languages)) {
      continue;
    }

    for (const candidate of languages as { id?: unknown; extensions?: unknown }[]) {
      if (candidate?.id !== language || !Array.isArray(candidate.extensions)) {
        continue;
      }

      const extensions = candidate.extensions.filter((value): value is string => typeof value === 'string');
      if (extensions.length) {
        return extensions[0];
      }
    }
  }

  return '.txt';
}
