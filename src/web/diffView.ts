import { diffLines } from 'diff';
import MarkdownIt = require('markdown-it');
import hljs, { normalizeHighlightLanguage } from './highlight';
import { ViewLineMetadata } from './lineMetadata';

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

interface ParsedListLine {
  readonly indent: number;
  readonly ordered: boolean;
  readonly start?: number;
  readonly content: string;
}

interface DiffRenderedList {
  readonly ordered: boolean;
  readonly start: number;
  readonly items: DiffRenderedListItem[];
}

interface DiffRenderedListItem {
  readonly line: DiffRenderedLine;
  readonly contentLines: string[];
  readonly children: DiffRenderedList[];
}

interface ParsedFence {
  readonly markerCharacter: string;
  readonly markerLength: number;
  readonly language: string;
}

export interface RenderedDiffView {
  readonly html: string;
  readonly hunkCount: number;
}

interface ViewLineRenderMetadata {
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

export function renderDiffView(
  baselineMarkdown: string,
  targetMarkdown: string,
  lineMetadata: readonly ViewLineMetadata[],
  baselineLabel: string,
): RenderedDiffView {
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
  metadata: ReadonlyMap<number, ViewLineRenderMetadata>,
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

    const contentLines = trimTrailingBlankLines(listLines);
    if (contentLines.length > 0) {
      rendered.push(`<div class="preview-diff-block preview-diff-list">${renderListLines(contentLines)}</div>`);
    }
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

      if (line.text.length === 0) {
        if (listLines.length > 0) {
          listLines.push({
            text: line.text,
            targetLine: line.targetLine,
            kind: chunk.kind,
            hunkIndex: chunkHunkIndex,
          });
        } else {
          flushCode();
          flushList();
          flushMarkdown();
        }
        pendingRenderedHunkIndex = undefined;
        continue;
      }

      flushCode();
      const parsedListLine = parseListLine(line.text);
      const continuationLine = parsedListLine === undefined && isListContinuationLine(line.text);
      if (listLines.length > 0) {
        if (parsedListLine || continuationLine) {
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
      }

      if (parsedListLine) {
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
  lineMetadata: readonly ViewLineMetadata[],
): ReadonlyMap<number, ViewLineRenderMetadata> {
  const renderedLineMetadata = new Map<number, ViewLineRenderMetadata>();

  for (const line of lineMetadata) {
    renderedLineMetadata.set(line.viewLine, {
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

    for (const documentationPreviewLine of line.documentationViewLines) {
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
  lineMetadata: ReadonlyMap<number, ViewLineRenderMetadata>,
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
  lineMetadata: ReadonlyMap<number, ViewLineRenderMetadata>,
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
  const lists: DiffRenderedList[] = [];
  const stack: { indent: number; list: DiffRenderedList; parentItem?: DiffRenderedListItem }[] = [];

  for (const line of lines) {
    const parsed = parseListLine(line.text);
    if (parsed) {
      while (stack.length > 0 && parsed.indent < stack[stack.length - 1].indent) {
        stack.pop();
      }

      let current = stack[stack.length - 1];
      if (!current || parsed.indent > current.indent || parsed.ordered !== current.list.ordered) {
        const parentItem = parsed.indent > (current?.indent ?? -1)
          ? current?.list.items[current.list.items.length - 1]
          : current?.parentItem;
        const list: DiffRenderedList = {
          ordered: parsed.ordered,
          start: parsed.start ?? 1,
          items: [],
        };
        if (parentItem) {
          parentItem.children.push(list);
        } else {
          lists.push(list);
        }
        current = { indent: parsed.indent, list, parentItem };
        stack.push(current);
      }

      current.list.items.push({
        line,
        contentLines: [parsed.content],
        children: [],
      });
      continue;
    }

    const current = stack[stack.length - 1];
    const item = current?.list.items[current.list.items.length - 1];
    if (item) {
      item.contentLines.push(line.text);
    }
  }

  return lists.map(renderList).join('\n');
}

function renderList(list: DiffRenderedList): string {
  const tag = list.ordered ? 'ol' : 'ul';
  const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : '';
  return `<${tag}${start}>\n${list.items.map(renderListItem).join('\n')}\n</${tag}>`;
}

function renderListItem(item: DiffRenderedListItem): string {
  const children = item.children.map(renderList).join('\n');
  const content = renderListItemContent(item.contentLines);
  return `<li${renderListItemAttributes(item.line)}>${content}${children ? `\n${children}` : ''}</li>`;
}

function renderListItemContent(contentLines: readonly string[]): string {
  const trimmedLines = [...contentLines];
  while (trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1].length === 0) {
    trimmedLines.pop();
  }

  const content = trimmedLines.join('\n');
  if (trimmedLines.some(line => line.length === 0)) {
    return markdownRenderer.render(content).trim();
  }
  return markdownRenderer.renderInline(content);
}

function renderListItemAttributes(line: DiffRenderedLine): string {
  const classes = ['preview-diff-list-item', `preview-diff-list-item-${line.kind}`];
  const attributes = [`class="${classes.join(' ')}"`];
  if (line.targetLine !== undefined) {
    attributes.push(`data-line="${line.targetLine}"`);
  }
  if (line.hunkIndex !== undefined) {
    attributes.push(`data-diff-hunk="${line.hunkIndex}"`);
  }
  return ` ${attributes.join(' ')}`;
}

function isListMarkdownLine(text: string): boolean {
  return parseListLine(text) !== undefined;
}

function parseListLine(text: string): ParsedListLine | undefined {
  const match = text.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/u);
  if (!match) {
    return undefined;
  }

  return {
    indent: match[1].replace(/\t/gu, '    ').length,
    ordered: /\d+\./u.test(match[2]),
    start: /^\d+\./u.test(match[2]) ? Number.parseInt(match[2], 10) : undefined,
    content: match[3],
  };
}

function isListContinuationLine(text: string): boolean {
  return !/^#{1,6}\s/u.test(text)
    && !/^>\s?/u.test(text)
    && !/^ {0,3}(?:`{3,}|~{3,})/u.test(text)
    && !/^[-*_]{3,}\s*$/u.test(text)
    && !/^\s*</u.test(text)
    && !isListMarkdownLine(text);
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

function trimTrailingBlankLines<T extends { text: string }>(lines: readonly T[]): readonly T[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].text.length === 0) {
    end--;
  }
  return end === lines.length ? lines : lines.slice(0, end);
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
