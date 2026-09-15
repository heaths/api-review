import { GitClient } from './gitClient';
import * as vscode from 'vscode';

export function createGitClient(): GitClient {
  return {
    async getRepository() {
      return undefined;
    },
    async watchState() {
      return new vscode.Disposable(() => { });
    },
  };
}
