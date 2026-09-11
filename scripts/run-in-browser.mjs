import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startGitHubProxy } from './github-proxy.mjs';
import { runVsCodeTestWeb } from './vscode-test-web.mjs';

export function parseRunInBrowserArgs(args) {
  let pullRequestMode = false;
  let browserPath = '.';
  let selectedBrowserPath = false;
  const forwardedArgs = [];

  for (const arg of args) {
    if (arg === '--pr') {
      pullRequestMode = true;
      continue;
    }

    if (!selectedBrowserPath && !arg.startsWith('-')) {
      browserPath = arg;
      selectedBrowserPath = true;
      continue;
    }

    forwardedArgs.push(arg);
  }

  return {
    pullRequestMode,
    browserPath,
    forwardedArgs,
  };
}

async function main() {
  const { pullRequestMode, browserPath, forwardedArgs } = parseRunInBrowserArgs(process.argv.slice(2));
  const repository = resolveRepository(browserPath);
  let proxy;

  if (pullRequestMode) {
    proxy = await startGitHubProxy(repository.root);
    Object.assign(process.env, {
      GITHUB_PROXY_URL: proxy.url,
      GITHUB_PROXY_TOKEN: proxy.token,
      GITHUB_PROXY_OWNER: repository.owner,
      GITHUB_PROXY_REPO: repository.repo,
      GITHUB_PROXY_REF: repository.ref,
    });

    console.log(`[run-in-browser] GitHub proxy ${proxy.url} for ${repository.root} (${repository.owner}/${repository.repo}@${repository.ref})`);
  } else {
    delete process.env.GITHUB_PROXY_URL;
    delete process.env.GITHUB_PROXY_TOKEN;
    delete process.env.GITHUB_PROXY_OWNER;
    delete process.env.GITHUB_PROXY_REPO;
    delete process.env.GITHUB_PROXY_REF;
  }

  run('pnpm', ['run', 'compile:web'], proxy);

  const child = runVsCodeTestWeb([
    '--browserType=chromium',
    '--extensionDevelopmentPath=.',
    browserPath,
    ...forwardedArgs,
  ]);

  child.once('exit', () => void proxy?.close());
  child.once('error', () => void proxy?.close());
}

function resolveRepository(browserPath) {
  const root = runGit(browserPath, ['rev-parse', '--show-toplevel']);
  const remoteUrl = runGit(root, ['config', '--get', 'remote.origin.url']);
  const repository = parseGitHubRepository(remoteUrl);
  const ref = getUpstreamRef(root) ?? runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    root,
    owner: repository?.owner ?? 'local',
    repo: repository?.repo ?? root.slice(root.lastIndexOf('/') + 1),
    ref,
  };
}

function getUpstreamRef(root) {
  const upstream = runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], false);
  if (!upstream) {
    return undefined;
  }
  const separator = upstream.indexOf('/');
  return separator >= 0 ? upstream.slice(separator + 1) : upstream;
}

function parseGitHubRepository(url) {
  const match = url.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/iu);
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

function runGit(cwd, args, required = true) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  if (!required) {
    return undefined;
  }
  throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
}

function run(command, args, proxy) {
  const result = spawnSync(command, args, { env: process.env, stdio: 'inherit' });
  if (result.status !== 0) {
    void proxy?.close();
    process.exit(result.status ?? 1);
  }
}

if (typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
