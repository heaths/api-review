import * as vscode from 'vscode';
import { GitClient, GitRepository } from './gitClient';

const gitApiVersion = 1;

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

interface GitApi {
  getRepository(uri: vscode.Uri): GitRepository | null;
}

export function createGitClient(): GitClient {
  return new VsCodeGitClient();
}

class VsCodeGitClient implements GitClient {
  public async getRepository(uri: vscode.Uri): Promise<GitRepository | undefined> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      return undefined;
    }

    if (!extension.isActive) {
      await extension.activate();
    }

    const exports = extension.exports;
    if (!exports?.enabled) {
      return undefined;
    }

    return exports.getAPI(gitApiVersion).getRepository(uri) ?? undefined;
  }
}
