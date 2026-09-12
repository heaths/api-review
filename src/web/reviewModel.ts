import * as vscode from 'vscode';
import { applyCommentsPatch, extractDocumentationAnchors } from './commentPatch';
import { ApiDocumentDescriptor, discoverApiDocuments } from './fileDiscovery';
import { getFencedCodeLines, mapDocumentation } from './markdown';
import { resolveOriginalLocation } from './sourceMap';

export interface ReviewEntry {
  readonly line: number;
  readonly language: string;
  readonly documentation?: readonly string[];
  readonly source?: vscode.Location;
}

export interface PreviewContent {
  readonly markdown: string;
  readonly hasCommentsPatch: boolean;
  readonly commentsPatch?: string;
}

export interface PreviewSnapshot {
  readonly entries: readonly ReviewEntry[];
  readonly content: PreviewContent;
}

export class ReviewModel {
  private readonly descriptors = new Map<string, ApiDocumentDescriptor>();
  private readonly cache = new Map<string, Promise<readonly ReviewEntry[]>>();

  public constructor(private readonly logger: vscode.LogOutputChannel) { }

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

  public async getEntries(document: vscode.TextDocument): Promise<readonly ReviewEntry[]> {
    const key = document.uri.toString();
    const descriptor = await this.getDescriptor(document.uri);
    if (!descriptor) {
      return [];
    }

    let entries = this.cache.get(key);
    if (!entries) {
      entries = this.loadEntries(document, descriptor);
      this.cache.set(key, entries);
    }
    return entries;
  }

  public async getPreviewContent(document: vscode.TextDocument): Promise<PreviewContent> {
    const markdown = document.getText();
    const descriptor = await this.getDescriptor(document.uri);
    if (!descriptor?.comments) {
      return { markdown, hasCommentsPatch: false };
    }

    try {
      const patch = await readText(descriptor.comments);
      const patched = applyCommentsPatch(markdown, patch);
      if (patched === undefined) {
        throw new Error(`patch ${descriptor.comments.toString()} does not apply`);
      }
      return { markdown: patched, hasCommentsPatch: true, commentsPatch: patch };
    } catch (error) {
      this.logger.warn(`Unable to prepare preview for ${document.uri.toString()}: ${formatError(error)}`);
      return { markdown, hasCommentsPatch: false };
    }
  }

  public async getPreviewSnapshot(document: vscode.TextDocument): Promise<PreviewSnapshot> {
    const markdown = document.getText();
    const descriptor = await this.getDescriptor(document.uri);
    if (!descriptor) {
      return { entries: [], content: { markdown, hasCommentsPatch: false } };
    }

    const entries = new Map<number, ReviewEntry>();
    let content: PreviewContent = { markdown, hasCommentsPatch: false };

    if (descriptor.comments) {
      try {
        const patch = await readText(descriptor.comments);
        for (const documentation of mapDocumentation(markdown, extractDocumentationAnchors(patch))) {
          entries.set(documentation.line, documentation);
        }

        const patched = applyCommentsPatch(markdown, patch);
        if (patched === undefined) {
          throw new Error(`patch ${descriptor.comments.toString()} does not apply`);
        }

        content = { markdown: patched, hasCommentsPatch: true, commentsPatch: patch };
      } catch (error) {
        this.logger.warn(`Unable to prepare preview for ${document.uri.toString()}: ${formatError(error)}`);
      }
    }

    if (descriptor.sourceMap) {
      try {
        const sourceMap = await readText(descriptor.sourceMap);
        for (const codeLine of getFencedCodeLines(markdown)) {
          const column = codeLine.text.search(/\S|$/);
          const source = resolveOriginalLocation(sourceMap, descriptor.workspaceFolder.uri, codeLine.line + 1, column);
          if (source) {
            entries.set(codeLine.line, { ...entries.get(codeLine.line), line: codeLine.line, language: codeLine.language, source });
          }
        }
      } catch (error) {
        this.logger.warn(`Unable to load review metadata for ${document.uri.toString()}: ${formatError(error)}`);
      }
    }

    return {
      entries: [...entries.values()].sort((left, right) => left.line - right.line),
      content,
    };
  }

  private async getDescriptor(uri: vscode.Uri): Promise<ApiDocumentDescriptor | undefined> {
    const key = uri.toString();
    let descriptor = this.descriptors.get(key);
    if (!descriptor) {
      await this.refresh();
      descriptor = this.descriptors.get(key);
    }
    return descriptor;
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
          const source = resolveOriginalLocation(sourceMap, descriptor.workspaceFolder.uri, codeLine.line + 1, column);
          if (source) {
            entries.set(codeLine.line, { ...entries.get(codeLine.line), line: codeLine.line, language: codeLine.language, source });
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Unable to load review metadata for ${document.uri.toString()}: ${formatError(error)}`);
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
