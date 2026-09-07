import { applyPatch, parsePatch } from 'diff';

export interface DocumentationAnchor {
  readonly line: number;
  readonly declaration: string;
  readonly documentation: readonly string[];
}

export interface PreviewDocumentationGroup {
  readonly line: number;
  readonly previewLine: number;
  readonly documentationPreviewLines: readonly number[];
}

export interface PreviewLineMap {
  readonly sourceToPreview: readonly number[];
  readonly documentationGroups: readonly PreviewDocumentationGroup[];
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
      let documentation: string[] = [];
      let oldLine = hunk.oldStart;

      for (const line of hunk.lines) {
        const marker = line[0];
        const content = line.slice(1);

        if (marker === '+') {
          if (documentationLine.test(content)) {
            documentation.push(content);
          } else if (content.trim().length > 0) {
            documentation = [];
          }
          continue;
        }

        if (marker === ' ' && documentation.length > 0 && content.trim().length > 0) {
          anchors.push({ line: oldLine - 1, declaration: content, documentation });
          documentation = [];
        } else if (marker !== '\\') {
          documentation = [];
        }

        if (marker === ' ' || marker === '-') {
          oldLine++;
        }
      }
    }
  }

  return anchors;
}

export function mapPreviewLines(source: string, patch: string): PreviewLineMap {
  const sourceToPreview: number[] = [];
  const documentationGroups: PreviewDocumentationGroup[] = [];
  const sourceLines = source.split(/\r?\n/);
  let oldLine = 0;
  let newLine = 0;

  for (const file of parsePatch(patch)) {
    for (const hunk of file.hunks) {
      const hunkOldStart = hunk.oldStart - 1;
      while (oldLine < hunkOldStart && oldLine < sourceLines.length) {
        sourceToPreview[oldLine] = newLine;
        oldLine++;
        newLine++;
      }

      let documentationPreviewLines: number[] = [];
      for (const line of hunk.lines) {
        const marker = line[0];
        const content = line.slice(1);

        switch (marker) {
          case '+':
            if (documentationLine.test(content)) {
              documentationPreviewLines.push(newLine);
            } else if (content.trim().length > 0) {
              documentationPreviewLines = [];
            }
            newLine++;
            break;

          case ' ':
            if (documentationPreviewLines.length > 0 && content.trim().length > 0) {
              documentationGroups.push({
                line: oldLine,
                previewLine: newLine,
                documentationPreviewLines,
              });
              documentationPreviewLines = [];
            } else {
              documentationPreviewLines = [];
            }
            sourceToPreview[oldLine] = newLine;
            oldLine++;
            newLine++;
            break;

          case '-':
            documentationPreviewLines = [];
            oldLine++;
            break;

          default:
            break;
        }
      }
    }
  }

  while (oldLine < sourceLines.length) {
    sourceToPreview[oldLine] = newLine;
    oldLine++;
    newLine++;
  }

  return { sourceToPreview, documentationGroups };
}
