import { spawn } from 'node:child_process';

const baseArgs = [
  'exec',
  'vscode-test-web',
  '--browserType=chromium',
  '--extensionDevelopmentPath=.',
  '--extensionTestsPath=dist/web/test/suite/index.js',
  '.',
];

if (shouldRunHeadless(process.env)) {
  baseArgs.splice(3, 0, '--headless');
}

const child = spawn('pnpm', baseArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', code => {
  process.exitCode = code ?? 1;
});

child.on('error', error => {
  console.error(error);
  process.exitCode = 1;
});

function shouldRunHeadless(environment) {
  return isTruthy(environment.CI) || isPresent(environment.COPILOT_GITHUB_TOKEN);
}

function isTruthy(value) {
  return typeof value === 'string' && /^(1|true|yes)$/iu.test(value);
}

function isPresent(value) {
  return typeof value === 'string' && value.length > 0;
}
