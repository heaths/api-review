import { GitClient } from './gitClient';

export function createGitClient(): GitClient {
  return {
    async getRepository() {
      return undefined;
    },
  };
}
