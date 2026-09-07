import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const changelogPath = new URL('../CHANGELOG.md', import.meta.url);
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const rootCommit = runGit(['rev-list', '--max-parents=0', 'HEAD']);
const tags = runGit(['tag', '--list', 'v*'])
  .split(/\r?\n/)
  .filter(tag => /^v\d+\.\d+\.\d+$/.test(tag))
  .sort(compareSemver);

const sections = [runCliff(['--unreleased'])];
for (let index = tags.length - 1; index >= 0; index--) {
  const tag = tags[index];
  const previousTag = tags[index - 1];
  const range = previousTag ? `${previousTag}..${tag}` : `${rootCommit}..${tag}`;
  sections.push(runCliff(['--strip', 'header', '--tag', tag, range]));
}

await writeFile(changelogPath, formatChangelog(sections.join('\n')), 'utf8');

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function runCliff(args) {
  return execFileSync(
    pnpmCommand,
    ['exec', 'git-cliff', '--config', 'cliff.toml', ...args],
    { encoding: 'utf8' },
  ).trim();
}

function compareSemver(left, right) {
  const leftVersion = left.slice(1).split('.').map(Number);
  const rightVersion = right.slice(1).split('.').map(Number);

  for (let index = 0; index < Math.max(leftVersion.length, rightVersion.length); index++) {
    const difference = (leftVersion[index] ?? 0) - (rightVersion[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function formatChangelog(markdown) {
  const releases = [];
  let currentRelease;
  let currentGroup;

  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line === '# Change Log') {
      continue;
    }

    if (line.startsWith('## ')) {
      currentRelease = { heading: line, groups: [] };
      releases.push(currentRelease);
      currentGroup = undefined;
      continue;
    }

    if (line.startsWith('### ')) {
      currentGroup = { heading: line, bullets: [] };
      currentRelease?.groups.push(currentGroup);
      continue;
    }

    if (line.startsWith('- ')) {
      currentGroup?.bullets.push(line);
    }
  }

  const lines = ['# Change Log', ''];
  for (const release of releases) {
    lines.push(release.heading, '');

    for (const group of release.groups) {
      lines.push(group.heading, '', ...group.bullets, '');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
