import { applyPatch, parsePatch } from 'diff';

export interface DocumentationAnchor {
  readonly lines: readonly DocumentationAnchorLine[];
  readonly documentation: readonly string[];
}

export interface DocumentationAnchorLine {
  readonly line: number;
  readonly declaration: string;
}

export interface ViewDocumentationGroup {
  readonly line: number;
  readonly groupLine: number;
  readonly viewLine: number;
  readonly documentationViewLines: readonly number[];
}

export interface ViewLineMap {
  readonly sourceToView: readonly number[];
  readonly documentationGroups: readonly ViewDocumentationGroup[];
}

const documentationLine = /^\s*(?:\/\/[!/]|\/\*\*?|\*\/?|#!?\[doc\s*=|#|--)/;

export function applyCommentsPatch(source: string, patch: string): string | undefined {
  const result = applyPatch(source, patch, { fuzzFactor: 0 });
  return result === false ? undefined : result;
}

export function extractDocumentationAnchors(patch: string): DocumentationAnchor[] {
  const anchors: DocumentationAnchor[] = [];

  for (const file of parsePatch(patch)) {
    for (const hunk of file.hunks) {
      let pendingDocumentation: string[] = [];
      let anchor: { lines: DocumentationAnchorLine[]; documentation: readonly string[] } | undefined;
      let oldLine = hunk.oldStart;
      const finishAnchor = (): void => {
        if (anchor?.lines.length) {
          anchors.push(anchor);
        }
        anchor = undefined;
      };

      for (const line of hunk.lines) {
        const marker = line[0];
        const content = line.slice(1);

        if (marker === '+') {
          if (documentationLine.test(content)) {
            finishAnchor();
            pendingDocumentation.push(content);
          } else if (content.trim().length > 0) {
            finishAnchor();
            pendingDocumentation = [];
          }
          continue;
        }

        if (marker === ' ' && content.trim().length > 0) {
          if (pendingDocumentation.length > 0) {
            finishAnchor();
            anchor = { lines: [], documentation: pendingDocumentation };
            pendingDocumentation = [];
          }
          anchor?.lines.push({ line: oldLine - 1, declaration: content });
        } else if (marker !== '\\') {
          finishAnchor();
          pendingDocumentation = [];
        }

        if (marker === ' ' || marker === '-') {
          oldLine++;
        }
      }

      finishAnchor();
    }
  }

  return anchors;
}

export function mapViewLines(source: string, patch: string): ViewLineMap {
  const sourceToView: number[] = [];
  const documentationGroups: ViewDocumentationGroup[] = [];
  const sourceLines = source.split(/\r?\n/);
  let oldLine = 0;
  let newLine = 0;

  for (const file of parsePatch(patch)) {
    for (const hunk of file.hunks) {
      const hunkOldStart = hunk.oldStart - 1;
      while (oldLine < hunkOldStart && oldLine < sourceLines.length) {
        sourceToView[oldLine] = newLine;
        oldLine++;
        newLine++;
      }

      let pendingDocumentationViewLines: number[] = [];
      let documentationGroup:
        { groupLine: number; documentationViewLines: readonly number[] }
        | undefined;
      for (const line of hunk.lines) {
        const marker = line[0];
        const content = line.slice(1);

        switch (marker) {
          case '+':
            if (documentationLine.test(content)) {
              documentationGroup = undefined;
              pendingDocumentationViewLines.push(newLine);
            } else if (content.trim().length > 0) {
              documentationGroup = undefined;
              pendingDocumentationViewLines = [];
            }
            newLine++;
            break;

          case ' ':
            if (content.trim().length > 0 && pendingDocumentationViewLines.length > 0) {
              documentationGroup = {
                groupLine: oldLine,
                documentationViewLines: pendingDocumentationViewLines,
              };
              pendingDocumentationViewLines = [];
            }
            if (content.trim().length > 0 && documentationGroup) {
              documentationGroups.push({
                line: oldLine,
                groupLine: documentationGroup.groupLine,
                viewLine: newLine,
                documentationViewLines: documentationGroup.documentationViewLines,
              });
            } else {
              documentationGroup = undefined;
              pendingDocumentationViewLines = [];
            }
            sourceToView[oldLine] = newLine;
            oldLine++;
            newLine++;
            break;

          case '-':
            documentationGroup = undefined;
            pendingDocumentationViewLines = [];
            oldLine++;
            break;

          default:
            break;
        }
      }
    }
  }

  while (oldLine < sourceLines.length) {
    sourceToView[oldLine] = newLine;
    oldLine++;
    newLine++;
  }

  return { sourceToView, documentationGroups };
}
