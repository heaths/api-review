import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);

export function runVsCodeTestWeb(args) {
  const child = spawn(process.execPath, [resolveVsCodeTestWebEntry(), ...args], {
    stdio: 'inherit',
  });

  child.on('exit', code => {
    process.exitCode = code ?? 1;
  });

  child.on('error', error => {
    console.error(error);
    process.exitCode = 1;
  });
}

function resolveVsCodeTestWebEntry() {
  return require.resolve('@vscode/test-web');
}
