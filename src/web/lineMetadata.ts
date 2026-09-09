import { mapPreviewLines, PreviewLineMap } from './commentPatch';
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
): readonly PreviewLineMetadata[] {
  const previewLineMap = getPreviewLineMap(sourceMarkdown, content);
  const documentationGroups = new Map(
    previewLineMap.documentationGroups.map(group => [group.line, group] as const),
  );

  return createReviewLineMetadata(entries)
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
        ariaLabel: describeActionLine(hasDocumentation, entry.hasSource),
      };
    })
    .filter(entry => entry.hasDocumentation || entry.hasSource)
    .sort((left, right) => left.previewLine - right.previewLine);
}

export function createDiffLineMetadata(entries: readonly ReviewEntry[]): readonly PreviewLineMetadata[] {
  return createReviewLineMetadata(entries)
    .map(entry => ({
      ...entry,
      sourceLine: entry.line,
      previewLine: entry.line,
      hasDocumentation: entry.hasDocumentation,
      hasSource: entry.hasSource,
      documentationGroupId: entry.hasDocumentation ? getDocumentationGroupId(entry.line) : undefined,
      documentationPreviewLines: [],
      ariaLabel: describeActionLine(entry.hasDocumentation, entry.hasSource),
    }))
    .filter(entry => entry.hasDocumentation || entry.hasSource)
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

function describeActionLine(hasDocumentation: boolean, hasSource: boolean): string {
  const actions: string[] = [];
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
