import * as vscode from 'vscode';

export interface ApiReviewConfiguration {
  readonly include: readonly string[];
  readonly comments: readonly string[];
  readonly sourceMaps: readonly string[];
}

const defaults: ApiReviewConfiguration = {
  include: ['**/api/API.md'],
  comments: ['API.comments.diff', 'API.comments.patch'],
  sourceMaps: ['API.md.map'],
};

export function getConfiguration(scope?: vscode.Uri): ApiReviewConfiguration {
  const configuration = vscode.workspace.getConfiguration('heaths.apiReview.files', scope);
  return {
    include: readArray(configuration, 'include', defaults.include),
    comments: readArray(configuration, 'comments', defaults.comments),
    sourceMaps: readArray(configuration, 'sourceMaps', defaults.sourceMaps),
  };
}

function readArray(
  configuration: vscode.WorkspaceConfiguration,
  key: keyof ApiReviewConfiguration,
  fallback: readonly string[],
): readonly string[] {
  const values = configuration.get<unknown>(key);
  if (!Array.isArray(values)) {
    return fallback;
  }

  const strings = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return strings.length > 0 ? strings : fallback;
}
