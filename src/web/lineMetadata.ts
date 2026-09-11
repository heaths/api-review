import { mapPreviewLines, PreviewLineMap } from './commentPatch';
import { getFencedCodeLines } from './markdown';
import { PullRequestLineComment } from './pullRequestReview';
import { PreviewContent, ReviewEntry } from './reviewModel';

export interface ReviewLineMetadata extends ReviewEntry {
  readonly hasDocumentation: boolean;
  readonly hasSource: boolean;
}

export interface PreviewLineMetadata extends ReviewLineMetadata {
  readonly sourceLine: number;
  readonly previewLine: number;
  readonly documentationGroupId?: string;
  readonly documentationPreviewLines: readonly number[];
  readonly pullRequestComment?: PullRequestLineComment;
  readonly ariaLabel: string;
}

export function createReviewLineMetadata(entries: readonly ReviewEntry[]): readonly ReviewLineMetadata[] {
  return entries.map(entry => ({
    ...entry,
    hasDocumentation: entry.documentation !== undefined,
    hasSource: entry.source !== undefined,
  }));
}

export function createPreviewLineMetadata(
  sourceMarkdown: string,
  content: PreviewContent,
  entries: readonly ReviewEntry[],
  pullRequestComments?: ReadonlyMap<number, PullRequestLineComment>,
): readonly PreviewLineMetadata[] {
  const previewLineMap = getPreviewLineMap(sourceMarkdown, content);
  const documentationGroups = new Map(
    previewLineMap.documentationGroups.map(group => [group.line, group] as const),
  );
  const fencedCodeLanguages = new Map(
    getFencedCodeLines(sourceMarkdown).map(line => [line.line, line.language] as const),
  );

  return createReviewLineMetadata(getEntriesWithPullRequestComments(entries, pullRequestComments, fencedCodeLanguages))
    .map(entry => {
      const documentationGroup = documentationGroups.get(entry.line);
      const hasDocumentation = entry.hasDocumentation && documentationGroup !== undefined;
      return {
        ...entry,
        sourceLine: entry.line,
        previewLine: previewLineMap.sourceToPreview[entry.line] ?? entry.line,
        hasDocumentation,
        documentationGroupId: hasDocumentation ? getDocumentationGroupId(entry.line) : undefined,
        documentationPreviewLines: hasDocumentation ? documentationGroup.documentationPreviewLines : [],
        pullRequestComment: pullRequestComments?.get(entry.line),
        ariaLabel: describeActionLine(hasDocumentation, entry.hasSource, pullRequestComments?.has(entry.line) === true),
      };
    })
    .filter(entry => entry.hasDocumentation || entry.hasSource || entry.pullRequestComment !== undefined)
    .sort((left, right) => left.previewLine - right.previewLine);
}

export function createDiffLineMetadata(
  entries: readonly ReviewEntry[],
  pullRequestComments?: ReadonlyMap<number, PullRequestLineComment>,
  sourceMarkdown?: string,
): readonly PreviewLineMetadata[] {
  const fencedCodeLanguages = sourceMarkdown
    ? new Map(getFencedCodeLines(sourceMarkdown).map(line => [line.line, line.language] as const))
    : undefined;

  return createReviewLineMetadata(getEntriesWithPullRequestComments(entries, pullRequestComments, fencedCodeLanguages))
    .map(entry => ({
      ...entry,
      sourceLine: entry.line,
      previewLine: entry.line,
      hasDocumentation: entry.hasDocumentation,
      hasSource: entry.hasSource,
      documentationGroupId: entry.hasDocumentation ? getDocumentationGroupId(entry.line) : undefined,
      documentationPreviewLines: [],
      pullRequestComment: pullRequestComments?.get(entry.line),
      ariaLabel: describeActionLine(entry.hasDocumentation, entry.hasSource, pullRequestComments?.has(entry.line) === true),
    }))
    .filter(entry => entry.hasDocumentation || entry.hasSource || entry.pullRequestComment !== undefined)
    .sort((left, right) => left.previewLine - right.previewLine);
}

export function getDocumentationGroupId(sourceLine: number): string {
  return `line-${sourceLine}`;
}

function getPreviewLineMap(sourceMarkdown: string, content: PreviewContent): PreviewLineMap {
  if (!content.commentsPatch) {
    return {
      sourceToPreview: sourceMarkdown.split(/\r?\n/).map((_, line) => line),
      documentationGroups: [],
    };
  }

  return mapPreviewLines(sourceMarkdown, content.commentsPatch);
}

function describeActionLine(hasDocumentation: boolean, hasSource: boolean, hasPullRequestComment: boolean): string {
  const actions: string[] = [];
  if (hasPullRequestComment) {
    actions.push('pull request comment');
  }
  if (hasDocumentation) {
    actions.push('documentation');
  }
  if (hasSource) {
    actions.push('go to source');
  }
  return actions.length > 0
    ? `Review actions available: ${actions.join(' and ')}`
    : 'Review actions available';
}

function getEntriesWithPullRequestComments(
  entries: readonly ReviewEntry[],
  pullRequestComments: ReadonlyMap<number, PullRequestLineComment> | undefined,
  fencedCodeLanguages?: ReadonlyMap<number, string>,
): readonly ReviewEntry[] {
  if (!pullRequestComments || pullRequestComments.size === 0) {
    return entries;
  }

  const merged = new Map(entries.map(entry => [entry.line, entry] as const));
  for (const [line] of pullRequestComments) {
    if (merged.has(line)) {
      continue;
    }

    merged.set(line, {
      line,
      language: fencedCodeLanguages?.get(line) ?? '',
    });
  }

  return [...merged.values()].sort((left, right) => left.line - right.line);
}
