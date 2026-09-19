import { createVsCodeTestWebArgs, assertDisplayAvailable } from './vscode-test-web-args.mjs';
import { runVsCodeTestWeb } from './vscode-test-web.mjs';

try {
  assertDisplayAvailable();
  runVsCodeTestWeb(createVsCodeTestWebArgs({
    extensionTestsPath: 'dist/web/test/suite/ui.js',
    headless: false,
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
