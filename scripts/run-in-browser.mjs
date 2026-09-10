import { runVsCodeTestWeb } from './vscode-test-web.mjs';

const [firstArg, ...remainingArgs] = process.argv.slice(2);
const browserPath = firstArg && !firstArg.startsWith('-') ? firstArg : '.';
const forwardedArgs = browserPath === '.' ? process.argv.slice(2) : remainingArgs;

runVsCodeTestWeb([
  '--browserType=chromium',
  '--extensionDevelopmentPath=.',
  browserPath,
  ...forwardedArgs,
]);
