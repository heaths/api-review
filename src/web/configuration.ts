import * as vscode from 'vscode';

export interface AzureApiReviewConfiguration {
  readonly include: readonly string[];
  readonly comments: readonly string[];
  readonly sourceMaps: readonly string[];
}

const defaults: AzureApiReviewConfiguration = {
  include: ['**/api/API.md'],
  comments: ['API.comments.diff', 'API.comments.patch'],
  sourceMaps: ['API.md.map'],
};

export function getConfiguration(scope?: vscode.Uri): AzureApiReviewConfiguration {
  const configuration = vscode.workspace.getConfiguration('heaths.azureApiReview.files', scope);
  return {
    include: readArray(configuration, 'include', defaults.include),
    comments: readArray(configuration, 'comments', defaults.comments),
    sourceMaps: readArray(configuration, 'sourceMaps', defaults.sourceMaps),
  };
}

function readArray(
  configuration: vscode.WorkspaceConfiguration,
  key: keyof AzureApiReviewConfiguration,
  fallback: readonly string[],
): readonly string[] {
  const values = configuration.get<unknown>(key);
  if (!Array.isArray(values)) {
    return fallback;
  }

  const strings = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return strings.length > 0 ? strings : fallback;
}
