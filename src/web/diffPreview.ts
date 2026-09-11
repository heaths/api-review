import { diffLines } from 'diff';
import MarkdownIt = require('markdown-it');
import hljs, { normalizeHighlightLanguage } from './highlight';
import { PreviewLineMetadata } from './lineMetadata';

interface ParsedLine {
  readonly text: string;
  readonly kind: 'markdown' | 'code' | 'fenceOpen' | 'fenceClose';
  readonly language?: string;
  readonly targetLine?: number;
}

interface DiffChunk {
  readonly kind: 'unchanged' | 'added' | 'removed';
  readonly lines: readonly ParsedLine[];
}

interface DiffRenderedLine {
  readonly text: string;
  readonly targetLine?: number;
  readonly kind: DiffChunk['kind'];
  readonly hunkIndex?: number;
}

interface ParsedFence {
  readonly markerCharacter: string;
  readonly markerLength: number;
  readonly language: string;
}

export interface RenderedDiffPreview {
  readonly html: string;
  readonly hunkCount: number;
}

interface PreviewLineRenderMetadata {
  readonly sourceLine?: number;
  readonly hasDocumentation?: true;
  readonly hasSource?: true;
  readonly hasPullRequestComment?: true;
  readonly hasPullRequestDiscussion?: true;
  readonly pullRequestCommentCount?: number;
  readonly documentation?: readonly string[];
  readonly documentationGroupId?: string;
  readonly documentationLine?: true;
  readonly ariaLabel?: string;
}

const markdownRenderer = new MarkdownIt({
  html: true,
  linkify: true,
});

export function renderDiffPreview(
  baselineMarkdown: string,
  targetMarkdown: string,
  lineMetadata: readonly PreviewLineMetadata[],
  baselineLabel: string,
): RenderedDiffPreview {
  const metadata = createRenderMetadata(lineMetadata);
  const targetLines = parseMarkdownLines(targetMarkdown, true);
  const baselineLines = parseMarkdownLines(baselineMarkdown, false);
  const chunks = createDiffChunks(baselineMarkdown, targetMarkdown, baselineLines, targetLines);
  const body = renderDiffBody(chunks, metadata);

  return {
    html: [
      `<section class="preview-diff-summary" aria-label="Diff baseline">Comparing against <strong>${escapeHtml(baselineLabel)}</strong></section>`,
      `<section class="preview-diff-body">${body.html}</section>`,
    ].join('\n'),
    hunkCount: body.hunkCount,
  };
}

function createDiffChunks(
  baselineMarkdown: string,
  targetMarkdown: string,
  baselineLines: readonly ParsedLine[],
  targetLines: readonly ParsedLine[],
): readonly DiffChunk[] {
  const chunks: DiffChunk[] = [];
  let baselineIndex = 0;
  let targetIndex = 0;

  for (const change of diffLines(baselineMarkdown, targetMarkdown)) {
    const lineCount = splitChunkLines(change.value).length;
    if (change.added) {
      chunks.push({
        kind: 'added',
        lines: targetLines.slice(targetIndex, targetIndex + lineCount),
      });
      targetIndex += lineCount;
      continue;
    }
    if (change.removed) {
      chunks.push({
        kind: 'removed',
        lines: baselineLines.slice(baselineIndex, baselineIndex + lineCount),
      });
      baselineIndex += lineCount;
      continue;
    }

    chunks.push({
      kind: 'unchanged',
      lines: targetLines.slice(targetIndex, targetIndex + lineCount),
    });
    baselineIndex += lineCount;
    targetIndex += lineCount;
  }

  return mergeAdjacentChunks(chunks);
}

function mergeAdjacentChunks(chunks: readonly DiffChunk[]): readonly DiffChunk[] {
  const merged: DiffChunk[] = [];

  for (const chunk of chunks) {
    const previous = merged.length > 0 ? merged[merged.length - 1] : undefined;
    if (previous?.kind === chunk.kind) {
      merged[merged.length - 1] = {
        kind: chunk.kind,
        lines: [...previous.lines, ...chunk.lines],
      };
      continue;
    }

    merged.push(chunk);
  }

  return merged;
}

function renderDiffBody(
  chunks: readonly DiffChunk[],
  metadata: ReadonlyMap<number, PreviewLineRenderMetadata>,
): { html: string; hunkCount: number } {
  const rendered: string[] = [];
  let markdownLines: string[] = [];
  let markdownKind: DiffChunk['kind'] | undefined;
  let markdownHunkIndex: number | undefined;
  let listLines: DiffRenderedLine[] = [];
  let codeLines: DiffRenderedLine[] = [];
  let codeLanguage = '';
  let hunkCount = 0;
  let activeChangedHunkIndex: number | undefined;

  const flushMarkdown = (): void => {
    if (markdownKind === undefined || markdownLines.length === 0) {
      return;
    }

    rendered.push(
      `<div class="preview-diff-block preview-diff-${markdownKind} preview-diff-markdown"${markdownHunkIndex === undefined ? '' : ` data-diff-hunk="${markdownHunkIndex}"`}>${markdownRenderer.render(markdownLines.join('\n'))}</div>`,
    );
    markdownLines = [];
    markdownKind = undefined;
    markdownHunkIndex = undefined;
  };

  const flushList = (): void => {
    if (listLines.length === 0) {
      return;
    }

    rendered.push(
      `<div class="preview-diff-block preview-diff-list">${renderListLines(listLines)}</div>`,
    );
    listLines = [];
  };

  const flushCode = (): void => {
    if (codeLines.length === 0) {
      return;
    }

    rendered.push(
      `<pre class="preview-diff-block preview-diff-code"><code>${renderCodeLines(
        codeLines,
        codeLanguage,
        metadata,
      )}</code></pre>`,
    );
    codeLines = [];
    codeLanguage = '';
  };

  const startNewHunk = (): number => {
    const hunkIndex = hunkCount;
    hunkCount++;
    return hunkIndex;
  };

  for (const chunk of chunks) {
    const chunkHunkIndex = chunk.kind === 'unchanged'
      ? undefined
      : (activeChangedHunkIndex ?? startNewHunk());
    if (chunk.kind === 'unchanged') {
      activeChangedHunkIndex = undefined;
    } else {
      activeChangedHunkIndex = chunkHunkIndex;
    }

    let pendingRenderedHunkIndex = chunkHunkIndex;

    for (const line of chunk.lines) {
      if (line.kind === 'fenceOpen') {
        flushList();
        flushMarkdown();
        codeLanguage = line.language ?? '';
        continue;
      }

      if (line.kind === 'fenceClose') {
        flushCode();
        continue;
      }

      if (line.kind === 'code') {
        flushList();
        flushMarkdown();
        if (!codeLanguage && line.language) {
          codeLanguage = line.language;
        }
        codeLines.push({
          text: line.text,
          targetLine: line.targetLine,
          kind: chunk.kind,
          hunkIndex: chunkHunkIndex,
        });
        pendingRenderedHunkIndex = undefined;
        continue;
      }

      flushCode();
      if (isListMarkdownLine(line.text)) {
        flushMarkdown();
        listLines.push({
          text: line.text,
          targetLine: line.targetLine,
          kind: chunk.kind,
          hunkIndex: chunkHunkIndex,
        });
        pendingRenderedHunkIndex = undefined;
        continue;
      }

      flushList();
      if (markdownKind !== chunk.kind) {
        flushMarkdown();
        markdownKind = chunk.kind;
      }
      markdownLines.push(line.text);
      if (markdownHunkIndex === undefined) {
        markdownHunkIndex = pendingRenderedHunkIndex;
      }
      pendingRenderedHunkIndex = undefined;
    }
  }

  flushList();
  flushMarkdown();
  flushCode();
  return {
    html: rendered.join('\n'),
    hunkCount,
  };
}

function parseMarkdownLines(markdown: string, includeTargetLines: boolean): readonly ParsedLine[] {
  const lines = splitLines(markdown);
  const parsed: ParsedLine[] = [];
  let codeLanguage = '';
  let fenceMarkerCharacter = '';
  let fenceMarkerLength = 0;

  for (let index = 0; index < lines.length; index++) {
    const text = lines[index];
    const fence = parseFence(text);
    if (!fenceMarkerCharacter && fence) {
      fenceMarkerCharacter = fence.markerCharacter;
      fenceMarkerLength = fence.markerLength;
      codeLanguage = fence.language;
      parsed.push({ text, kind: 'fenceOpen', language: codeLanguage, targetLine: includeTargetLines ? index : undefined });
      continue;
    }

    if (fenceMarkerCharacter && isClosingFence(text, fenceMarkerCharacter, fenceMarkerLength)) {
      parsed.push({ text, kind: 'fenceClose', language: codeLanguage, targetLine: includeTargetLines ? index : undefined });
      fenceMarkerCharacter = '';
      fenceMarkerLength = 0;
      codeLanguage = '';
      continue;
    }

    if (fenceMarkerCharacter) {
      parsed.push({ text, kind: 'code', language: codeLanguage, targetLine: includeTargetLines ? index : undefined });
      continue;
    }

    parsed.push({ text, kind: 'markdown', targetLine: includeTargetLines ? index : undefined });
  }

  return parsed;
}

function parseFence(line: string): ParsedFence | undefined {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
  if (!match) {
    return undefined;
  }

  return {
    markerCharacter: match[1][0],
    markerLength: match[1].length,
    language: match[2].trim().split(/\s+/u, 1)[0] ?? '',
  };
}

function isClosingFence(line: string, markerCharacter: string, markerLength: number): boolean {
  return new RegExp(`^ {0,3}${escapeForRegExp(markerCharacter)}{${markerLength},}\\s*$`, 'u').test(line);
}

function createRenderMetadata(
  lineMetadata: readonly PreviewLineMetadata[],
): ReadonlyMap<number, PreviewLineRenderMetadata> {
  const renderedLineMetadata = new Map<number, PreviewLineRenderMetadata>();

  for (const line of lineMetadata) {
    renderedLineMetadata.set(line.previewLine, {
      sourceLine: line.sourceLine,
      hasDocumentation: line.hasDocumentation ? true : undefined,
      hasSource: line.hasSource ? true : undefined,
      hasPullRequestComment: line.pullRequestComments && line.pullRequestComments.length > 0 ? true : undefined,
      hasPullRequestDiscussion: line.hasPullRequestDiscussion ? true : undefined,
      pullRequestCommentCount: line.pullRequestComments?.length,
      documentation: line.documentation,
      documentationGroupId: line.documentationGroupId,
      ariaLabel: line.ariaLabel,
    });

    if (!line.documentationGroupId) {
      continue;
    }

    for (const documentationPreviewLine of line.documentationPreviewLines) {
      renderedLineMetadata.set(documentationPreviewLine, {
        ...renderedLineMetadata.get(documentationPreviewLine),
        documentationGroupId: line.documentationGroupId,
        documentationLine: true,
      });
    }
  }

  return renderedLineMetadata;
}

function renderCodeLines(
  codeLines: readonly DiffRenderedLine[],
  language: string,
  lineMetadata: ReadonlyMap<number, PreviewLineRenderMetadata>,
): string {
  const code = codeLines.map(line => line.text).join('\n');
  const normalized = normalizeHighlightLanguage(language);
  const highlighted = normalized && hljs.getLanguage(normalized)
    ? hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value
    : escapeHtml(code);

  return wrapHighlightedLines(highlighted, codeLines, lineMetadata);
}

function wrapHighlightedLines(
  highlighted: string,
  codeLines: readonly DiffRenderedLine[],
  lineMetadata: ReadonlyMap<number, PreviewLineRenderMetadata>,
): string {
  const parts = highlighted.split(/(<span\b[^>]*>|<\/span>)/);
  const openTags: { tag: string; comment: boolean }[] = [];
  const lines: string[] = [];
  let line = '';
  let hasContent = false;
  let hasNonCommentContent = false;
  let currentLineIndex = 0;

  const getCurrentLine = (): DiffRenderedLine | undefined => codeLines[currentLineIndex];

  const finishLine = (): void => {
    const closingTags = openTags.map(() => '</span>').reverse().join('');
    const currentLine = getCurrentLine();
    const metadata = currentLine?.targetLine === undefined ? undefined : lineMetadata.get(currentLine.targetLine);
    const classes = ['preview-diff-line'];
    if (hasContent && !hasNonCommentContent) {
      classes.push('comment-line');
    }
    if (metadata?.documentationLine) {
      classes.push('preview-documentation-line');
    }
    if (metadata?.sourceLine !== undefined) {
      classes.push('preview-action-line');
    }
    if (metadata?.hasPullRequestComment) {
      classes.push('preview-has-pr-comment');
    }
    if (currentLine) {
      classes.push(`preview-diff-line-${currentLine.kind}`);
    }

    const attributes = currentLine?.targetLine === undefined ? [] : [`data-line="${currentLine.targetLine}"`];
    if (currentLine?.hunkIndex !== undefined) {
      attributes.push(`data-diff-hunk="${currentLine.hunkIndex}"`);
    }
    if (metadata?.sourceLine !== undefined) {
      attributes.push(`data-source-line="${metadata.sourceLine}"`);
      attributes.push('tabindex="0"');
      attributes.push('aria-haspopup="true"');
      attributes.push('aria-controls="preview-hover-actions"');
      if (metadata.ariaLabel) {
        attributes.push(`aria-label="${escapeAttribute(metadata.ariaLabel)}"`);
      }
    }
    if (metadata?.hasDocumentation) {
      attributes.push('data-has-documentation');
    }
    if (metadata?.hasSource) {
      attributes.push('data-has-source');
    }
    if (metadata?.hasPullRequestComment) {
      attributes.push('data-has-pr-comment');
    }
    if (metadata?.hasPullRequestDiscussion) {
      attributes.push('data-has-pr-discussion');
    }
    if (metadata?.pullRequestCommentCount !== undefined) {
      attributes.push(`data-pr-comment-count="${metadata.pullRequestCommentCount}"`);
    }
    if (metadata?.documentationGroupId) {
      attributes.push(`data-documentation-group="${escapeAttribute(metadata.documentationGroupId)}"`);
    }

    const attributeText = attributes.length > 0 ? ` ${attributes.join(' ')}` : '';
    if (metadata?.documentation?.length) {
      lines.push(...metadata.documentation.map(line => renderDocumentationLine(line, metadata.documentationGroupId)));
    }
    lines.push(`<span class="${classes.join(' ')}"${attributeText}>${line}${closingTags}</span>`);
    line = openTags.map(value => value.tag).join('');
    hasContent = false;
    hasNonCommentContent = false;
    currentLineIndex++;
  };

  for (const part of parts) {
    if (part.startsWith('<span')) {
      openTags.push({ tag: part, comment: /\bhljs-comment\b/.test(part) });
      line += part;
      continue;
    }
    if (part === '</span>') {
      openTags.pop();
      line += part;
      continue;
    }

    const textLines = part.split('\n');
    for (let index = 0; index < textLines.length; index++) {
      const text = textLines[index];
      line += text;
      if (/\S/.test(text)) {
        hasContent = true;
        if (!openTags.some(value => value.comment)) {
          hasNonCommentContent = true;
        }
      }
      if (index < textLines.length - 1) {
        finishLine();
      }
    }
  }

  if (line.length > 0 || !highlighted.endsWith('\n')) {
    finishLine();
  }

  return lines.join('');
}

function renderDocumentationLine(line: string, groupId: string | undefined): string {
  const attributeText = groupId ? ` data-documentation-group="${escapeAttribute(groupId)}"` : '';
  return `<span class="preview-diff-line comment-line preview-documentation-line"${attributeText}><span class="hljs-comment">${escapeHtml(line)}</span></span>`;
}

function renderListLines(lines: readonly DiffRenderedLine[]): string {
  return lines.map(line => renderListLine(line)).join('');
}

function renderListLine(line: DiffRenderedLine): string {
  if (line.text.length === 0) {
    return renderDiffLine('', line);
  }

  const parsed = parseListLine(line.text);
  if (!parsed) {
    return renderDiffLine(escapeHtml(line.text), line);
  }

  const indent = parsed.indent.replace(/ /gu, '&nbsp;');
  const bullet = escapeHtml(parsed.marker);
  const content = markdownRenderer.renderInline(parsed.content);
  return renderDiffLine(
    `${indent}<span class="preview-diff-list-marker">${bullet}</span> ${content}`,
    line,
  );
}

function renderDiffLine(content: string, line: DiffRenderedLine): string {
  const classes = ['preview-diff-line', `preview-diff-line-${line.kind}`];
  const attributes: string[] = [];
  if (line.targetLine !== undefined) {
    attributes.push(`data-line="${line.targetLine}"`);
  }
  if (line.hunkIndex !== undefined) {
    attributes.push(`data-diff-hunk="${line.hunkIndex}"`);
  }

  return `<span class="${classes.join(' ')}"${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}>${content}</span>`;
}

function isListMarkdownLine(text: string): boolean {
  return parseListLine(text) !== undefined;
}

function parseListLine(text: string): { indent: string; marker: string; content: string } | undefined {
  const match = text.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/u);
  if (!match) {
    return undefined;
  }

  return {
    indent: match[1],
    marker: match[2],
    content: match[3],
  };
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/u);
}

function splitChunkLines(text: string): string[] {
  const lines = splitLines(text);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
