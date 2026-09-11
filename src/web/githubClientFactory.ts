import { GitHubClient, GitHubClientOptions, createGitHubClient as createOctokitGitHubClient } from './githubClient';

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  return createOctokitGitHubClient(options);
}
