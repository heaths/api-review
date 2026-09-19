import { createVsCodeTestWebArgs } from './vscode-test-web-args.mjs';
import { runVsCodeTestWeb } from './vscode-test-web.mjs';

runVsCodeTestWeb(createVsCodeTestWebArgs({
  extensionTestsPath: 'dist/web/test/suite/index.js',
  headless: true,
}));
