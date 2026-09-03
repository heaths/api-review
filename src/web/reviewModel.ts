import * as vscode from 'vscode';
import { extractDocumentationAnchors } from './commentPatch';
import { ApiDocumentDescriptor, discoverApiDocuments } from './fileDiscovery';
import { getFencedCodeLines, mapDocumentation } from './markdown';
import { resolveOriginalLocation } from './sourceMap';

export interface ReviewEntry {
  readonly line: number;
  readonly language: string;
  readonly documentation?: readonly string[];
  readonly source?: vscode.Location;
}

export class ReviewModel {
  private readonly descriptors = new Map<string, ApiDocumentDescriptor>();
  private readonly cache = new Map<string, Promise<readonly ReviewEntry[]>>();

  public constructor(private readonly output: vscode.OutputChannel) { }

  public async refresh(): Promise<void> {
    const descriptors = await discoverApiDocuments();
    this.descriptors.clear();
    this.cache.clear();
    for (const descriptor of descriptors) {
      this.descriptors.set(descriptor.uri.toString(), descriptor);
    }
  }

  public invalidate(uri?: vscode.Uri): void {
    if (uri) {
      this.cache.delete(uri.toString());
    } else {
      this.cache.clear();
    }
  }

  public getEntries(document: vscode.TextDocument): Promise<readonly ReviewEntry[]> {
    const key = document.uri.toString();
    const descriptor = this.descriptors.get(key);
    if (!descriptor) {
      return Promise.resolve([]);
    }

    let entries = this.cache.get(key);
    if (!entries) {
      entries = this.loadEntries(document, descriptor);
      this.cache.set(key, entries);
    }
    return entries;
  }

  private async loadEntries(
    document: vscode.TextDocument,
    descriptor: ApiDocumentDescriptor,
  ): Promise<readonly ReviewEntry[]> {
    const entries = new Map<number, ReviewEntry>();

    try {
      if (descriptor.comments) {
        const patch = await readText(descriptor.comments);
        for (const documentation of mapDocumentation(document.getText(), extractDocumentationAnchors(patch))) {
          entries.set(documentation.line, documentation);
        }
      }

      if (descriptor.sourceMap) {
        const sourceMap = await readText(descriptor.sourceMap);
        for (const codeLine of getFencedCodeLines(document.getText())) {
          const column = codeLine.text.search(/\S|$/);
          const source = resolveOriginalLocation(sourceMap, descriptor.sourceMap, codeLine.line + 1, column);
          if (source) {
            entries.set(codeLine.line, { ...entries.get(codeLine.line), line: codeLine.line, language: codeLine.language, source });
          }
        }
      }
    } catch (error) {
      this.output.appendLine(`Unable to load review metadata for ${document.uri.toString()}: ${formatError(error)}`);
    }

    return [...entries.values()].sort((left, right) => left.line - right.line);
  }
}

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
