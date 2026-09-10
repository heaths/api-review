import { runVsCodeTestWeb } from './vscode-test-web.mjs';

const baseArgs = [
  '--browserType=chromium',
  '--extensionDevelopmentPath=.',
  '--extensionTestsPath=dist/web/test/suite/index.js',
  '.',
];

if (shouldRunHeadless(process.env)) {
  baseArgs.splice(3, 0, '--headless');
}

runVsCodeTestWeb(baseArgs);

function shouldRunHeadless(environment) {
  return isTruthy(environment.CI) || isPresent(environment.COPILOT_GITHUB_TOKEN);
}

function isTruthy(value) {
  return typeof value === 'string' && /^(1|true|yes)$/iu.test(value);
}

function isPresent(value) {
  return typeof value === 'string' && value.length > 0;
}
