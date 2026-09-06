import { applyPatch, parsePatch } from 'diff';

export interface DocumentationAnchor {
  readonly line: number;
  readonly declaration: string;
  readonly documentation: readonly string[];
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
