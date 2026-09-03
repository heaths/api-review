import * as vscode from 'vscode';

export interface FileVariableContext {
  readonly file: vscode.Uri;
  readonly workspaceFolder: vscode.WorkspaceFolder;
}

export function expandIncludePattern(
  pattern: string,
  defaultFolder: vscode.WorkspaceFolder,
  folders: readonly vscode.WorkspaceFolder[],
): { folder: vscode.WorkspaceFolder; pattern: string } | undefined {
  let folder = defaultFolder;
  const named = /^\$\{workspaceFolder:([^}]+)\}(?:\/|$)/.exec(pattern);
  if (named) {
    const match = folders.find(candidate => candidate.name === named[1]);
    if (!match) {
      return undefined;
    }
    folder = match;
    pattern = pattern.slice(named[0].length);
  } else if (pattern.startsWith('${workspaceFolder}')) {
    pattern = pattern.slice('${workspaceFolder}'.length).replace(/^\//, '');
  }

  return hasVariable(pattern) ? undefined : { folder, pattern };
}

export function expandRelatedPattern(pattern: string, context: FileVariableContext): string | undefined {
  const filePath = context.file.path;
  const directory = filePath.slice(0, filePath.lastIndexOf('/'));
  const basename = filePath.slice(filePath.lastIndexOf('/') + 1);
  const extensionIndex = basename.lastIndexOf('.');
  const extension = extensionIndex < 0 ? '' : basename.slice(extensionIndex);
  const relativeFile = relativePath(context.workspaceFolder.uri.path, filePath);
  const values: Readonly<Record<string, string>> = {
    file: filePath,
    fileWorkspaceFolder: context.workspaceFolder.uri.path,
    relativeFile,
    relativeFileDirname: relativeFile.includes('/') ? relativeFile.slice(0, relativeFile.lastIndexOf('/')) : '',
    fileBasename: basename,
    fileBasenameNoExtension: extensionIndex < 0 ? basename : basename.slice(0, extensionIndex),
    fileExtname: extension,
    fileDirname: directory,
    fileDirnameBasename: directory.slice(directory.lastIndexOf('/') + 1),
    workspaceFolder: context.workspaceFolder.uri.path,
    workspaceFolderBasename: context.workspaceFolder.uri.path.slice(context.workspaceFolder.uri.path.lastIndexOf('/') + 1),
    pathSeparator: '/',
    '/': '/',
  };

  const expanded = pattern.replace(/\$\{([^}]+)\}/g, (match, name: string) => values[name] ?? match);
  return hasVariable(expanded) ? undefined : expanded;
}

function hasVariable(value: string): boolean {
  return /\$\{[^}]+\}/.test(value);
}

function relativePath(parent: string, child: string): string {
  return child.startsWith(`${parent}/`) ? child.slice(parent.length + 1) : child;
}
