import { mapViewLines, ViewLineMap } from './commentPatch';
import { getFencedCodeLines } from './markdown';
import { PullRequestLineComment } from './pullRequestService';
import { ViewContent, ReviewEntry } from './reviewModel';

export interface ReviewLineMetadata extends ReviewEntry {
  readonly hasDocumentation: boolean;
  readonly hasSource: boolean;
}

export interface ViewLineMetadata extends ReviewLineMetadata {
  readonly sourceLine: number;
  readonly viewLine: number;
  readonly documentationGroupId?: string;
  readonly documentationViewLines: readonly number[];
  readonly pullRequestComments?: readonly PullRequestLineComment[];
  readonly hasPullRequestDiscussion: boolean;
  readonly ariaLabel: string;
}

export function createReviewLineMetadata(entries: readonly ReviewEntry[]): readonly ReviewLineMetadata[] {
  return entries.map(entry => ({
    ...entry,
    hasDocumentation: entry.documentation !== undefined,
    hasSource: entry.source !== undefined,
  }));
}

export function createMarkdownViewLineMetadata(
  sourceMarkdown: string,
  content: ViewContent,
  entries: readonly ReviewEntry[],
  pullRequestComments?: ReadonlyMap<number, readonly PullRequestLineComment[]>,
): readonly ViewLineMetadata[] {
  const viewLineMap = getViewLineMap(sourceMarkdown, content);
  const documentationGroups = new Map(
    viewLineMap.documentationGroups.map(group => [group.line, group] as const),
  );
  const fencedCodeLanguages = new Map(
    getFencedCodeLines(sourceMarkdown).map(line => [line.line, line.language] as const),
  );

  return createReviewLineMetadata(getEntriesWithPullRequestComments(entries, pullRequestComments, fencedCodeLanguages))
    .map(entry => {
      const documentationGroup = documentationGroups.get(entry.line);
      const hasDocumentation = entry.hasDocumentation && documentationGroup !== undefined;
      const lineComments = pullRequestComments?.get(entry.line);
      return {
        ...entry,
        sourceLine: entry.line,
        viewLine: viewLineMap.sourceToView[entry.line] ?? entry.line,
        hasDocumentation,
        documentationGroupId: hasDocumentation ? getDocumentationGroupId(entry.line) : undefined,
        documentationViewLines: hasDocumentation ? documentationGroup.documentationViewLines : [],
        pullRequestComments: lineComments,
        hasPullRequestDiscussion: (lineComments?.length ?? 0) > 1,
        ariaLabel: describeActionLine(hasDocumentation, entry.hasSource, lineComments?.length ?? 0),
      };
    })
    .filter(entry => entry.hasDocumentation || entry.hasSource || (entry.pullRequestComments?.length ?? 0) > 0)
    .sort((left, right) => left.viewLine - right.viewLine);
}

export function createDiffLineMetadata(
  entries: readonly ReviewEntry[],
  pullRequestComments?: ReadonlyMap<number, readonly PullRequestLineComment[]>,
  sourceMarkdown?: string,
): readonly ViewLineMetadata[] {
  const fencedCodeLanguages = sourceMarkdown
    ? new Map(getFencedCodeLines(sourceMarkdown).map(line => [line.line, line.language] as const))
    : undefined;

  return createReviewLineMetadata(getEntriesWithPullRequestComments(entries, pullRequestComments, fencedCodeLanguages))
    .map(entry => ({
      ...entry,
      sourceLine: entry.line,
      viewLine: entry.line,
      hasDocumentation: entry.hasDocumentation,
      hasSource: entry.hasSource,
      documentationGroupId: entry.hasDocumentation ? getDocumentationGroupId(entry.line) : undefined,
      documentationViewLines: [],
      pullRequestComments: pullRequestComments?.get(entry.line),
      hasPullRequestDiscussion: (pullRequestComments?.get(entry.line)?.length ?? 0) > 1,
      ariaLabel: describeActionLine(entry.hasDocumentation, entry.hasSource, pullRequestComments?.get(entry.line)?.length ?? 0),
    }))
    .filter(entry => entry.hasDocumentation || entry.hasSource || (entry.pullRequestComments?.length ?? 0) > 0)
    .sort((left, right) => left.viewLine - right.viewLine);
}

export function getDocumentationGroupId(sourceLine: number): string {
  return `line-${sourceLine}`;
}

function getViewLineMap(sourceMarkdown: string, content: ViewContent): ViewLineMap {
  if (!content.commentsPatch) {
    return {
      sourceToView: sourceMarkdown.split(/\r?\n/).map((_, line) => line),
      documentationGroups: [],
    };
  }

  return mapViewLines(sourceMarkdown, content.commentsPatch);
}

function describeActionLine(hasDocumentation: boolean, hasSource: boolean, pullRequestCommentCount: number): string {
  const actions: string[] = [];
  if (pullRequestCommentCount > 1) {
    actions.push('pull request discussion');
  } else if (pullRequestCommentCount === 1) {
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
  pullRequestComments: ReadonlyMap<number, readonly PullRequestLineComment[]> | undefined,
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
