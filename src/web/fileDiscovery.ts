import * as vscode from 'vscode';
import { getConfiguration } from './configuration';
import { expandIncludePattern, expandRelatedPattern } from './variables';

export interface ApiDocumentDescriptor {
  readonly uri: vscode.Uri;
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly comments?: vscode.Uri;
  readonly sourceMap?: vscode.Uri;
}

export async function discoverApiDocuments(): Promise<readonly ApiDocumentDescriptor[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const documents = new Map<string, { uri: vscode.Uri; folder: vscode.WorkspaceFolder }>();

  for (const defaultFolder of folders) {
    for (const configuredPattern of getConfiguration(defaultFolder.uri).include) {
      const expanded = expandIncludePattern(configuredPattern, defaultFolder, folders);
      if (!expanded || expanded.pattern.length === 0) {
        continue;
      }
      const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(expanded.folder, expanded.pattern));
      for (const uri of matches) {
        documents.set(uri.toString(), { uri, folder: expanded.folder });
      }
    }
  }

  return Promise.all([...documents.values()].map(async document => {
    const configuration = getConfiguration(document.uri);
    return {
      uri: document.uri,
      workspaceFolder: document.folder,
      comments: await findRelated(document.uri, document.folder, configuration.comments),
      sourceMap: await findRelated(document.uri, document.folder, configuration.sourceMaps),
    };
  }));
}

async function findRelated(
  apiUri: vscode.Uri,
  folder: vscode.WorkspaceFolder,
  patterns: readonly string[],
): Promise<vscode.Uri | undefined> {
  const apiDirectory = apiUri.path.slice(0, apiUri.path.lastIndexOf('/'));
  const workspacePrefix = `${folder.uri.path.replace(/\/$/, '')}/`;

  for (const pattern of patterns) {
    const expanded = expandRelatedPattern(pattern, { file: apiUri, workspaceFolder: folder });
    if (!expanded) {
      continue;
    }
    const absolutePath = normalizeAbsolutePath(expanded.startsWith('/') ? expanded : `${apiDirectory}/${expanded}`);
    if (!absolutePath) {
      continue;
    }
    if (!absolutePath.startsWith(workspacePrefix)) {
      continue;
    }
    if (!hasGlobPattern(expanded)) {
      const candidate = folder.uri.with({ path: absolutePath });
      if (await exists(candidate)) {
        return candidate;
      }
      continue;
    }
    const relativePattern = absolutePath.slice(workspacePrefix.length);
    const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, relativePattern), undefined, 1);
    if (matches.length > 0) {
      return matches[0];
    }
  }

  return undefined;
}

function hasGlobPattern(path: string): boolean {
  return /[*?[\]{}]/.test(path);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function normalizeAbsolutePath(path: string): string | undefined {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return `/${segments.join('/')}`;
}
