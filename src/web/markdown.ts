import type { DocumentationAnchor } from './commentPatch';

export interface DeclarationDocumentation {
  readonly line: number;
  readonly language: string;
  readonly documentation: readonly string[];
}

export interface FencedLine {
  readonly line: number;
  readonly language: string;
  readonly text: string;
}

export function mapDocumentation(markdown: string, anchors: readonly DocumentationAnchor[]): DeclarationDocumentation[] {
  const fencedLines = getFencedCodeLines(markdown);
  const results: DeclarationDocumentation[] = [];

  for (const anchor of anchors) {
    const candidate = fencedLines.find(line => line.line === anchor.line);

    if (candidate && normalize(candidate.text) === normalize(anchor.declaration)) {
      results.push({
        line: candidate.line,
        language: candidate.language,
        documentation: anchor.documentation,
      });
    }
  }

  return results;
}

export function getFencedCodeLines(markdown: string): FencedLine[] {
  const lines = markdown.split(/\r?\n/);
  const result: FencedLine[] = [];
  let fenceCharacter = '';
  let fenceLength = 0;
  let language = '';

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    if (fenceLength === 0) {
      const opening = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(text);
      if (opening) {
        fenceCharacter = opening[1][0];
        fenceLength = opening[1].length;
        language = opening[2];
      }
      continue;
    }

    const closing = new RegExp(`^\\s*${escapeRegExp(fenceCharacter)}{${fenceLength},}\\s*$`);
    if (closing.test(text)) {
      fenceCharacter = '';
      fenceLength = 0;
      language = '';
    } else {
      result.push({ line, language, text });
    }
  }

  return result;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
