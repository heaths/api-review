import * as vscode from 'vscode';
import { GitClient, GitRepository } from './gitClient';

const gitApiVersion = 1;

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

interface GitApi {
  getRepository(uri: vscode.Uri): GitRepository | null;
  readonly repositories?: readonly GitRepositoryWithEvents[];
  readonly onDidOpenRepository?: vscode.Event<GitRepositoryWithEvents>;
  readonly onDidCloseRepository?: vscode.Event<GitRepositoryWithEvents>;
}

interface GitRepositoryWithEvents extends GitRepository {
  readonly state: GitRepository['state'] & {
    readonly onDidChange?: vscode.Event<void>;
  };
}

export function createGitClient(): GitClient {
  return new VsCodeGitClient();
}

class VsCodeGitClient implements GitClient {
  public async getRepository(uri: vscode.Uri): Promise<GitRepository | undefined> {
    const api = await this.getApi();
    if (!api) {
      return undefined;
    }

    return api.getRepository(uri) ?? undefined;
  }

  public async watchState(listener: () => void): Promise<vscode.Disposable> {
    const api = await this.getApi();
    if (!api) {
      return new vscode.Disposable(() => { });
    }

    const repositoryListeners = new Map<GitRepositoryWithEvents, vscode.Disposable>();
    const disposables: vscode.Disposable[] = [];
    const attach = (repository: GitRepositoryWithEvents) => {
      if (repositoryListeners.has(repository)) {
        return;
      }

      const onDidChange = repository.state.onDidChange;
      if (!onDidChange) {
        return;
      }

      repositoryListeners.set(repository, onDidChange(listener));
    };
    const detach = (repository: GitRepositoryWithEvents) => {
      repositoryListeners.get(repository)?.dispose();
      repositoryListeners.delete(repository);
    };

    for (const repository of api.repositories ?? []) {
      attach(repository);
    }

    if (api.onDidOpenRepository) {
      disposables.push(api.onDidOpenRepository(repository => {
        attach(repository);
        listener();
      }));
    }

    if (api.onDidCloseRepository) {
      disposables.push(api.onDidCloseRepository(repository => {
        detach(repository);
        listener();
      }));
    }

    return new vscode.Disposable(() => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      for (const disposable of repositoryListeners.values()) {
        disposable.dispose();
      }
      repositoryListeners.clear();
    });
  }

  private async getApi(): Promise<GitApi | undefined> {
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

    return exports.getAPI(gitApiVersion);
  }
}
