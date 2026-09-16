import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function checkWebBundle(directory = 'dist/web') {
  const entries = await readdir(directory, { withFileTypes: true });
  const unexpectedScripts = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'extension.js')
    .map(entry => entry.name)
    .sort();

  if (unexpectedScripts.length > 0) {
    throw new Error(
      `Web extension must be a single JavaScript bundle; found: ${unexpectedScripts.join(', ')}`,
    );
  }
}

if (typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkWebBundle();
}
