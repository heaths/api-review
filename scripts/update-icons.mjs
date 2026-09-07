import { mkdir, writeFile } from 'node:fs/promises';

const icons = [
  {
    name: 'chevron-down',
    url: 'https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/icons/chevron-down.svg',
  },
  {
    name: 'chevron-up',
    url: 'https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/icons/chevron-up.svg',
  },
  {
    name: 'go-to-file',
    url: 'https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/icons/go-to-file.svg',
  },
];

const outputDirectory = new URL('../assets/codicons/', import.meta.url);

await mkdir(outputDirectory, { recursive: true });

await Promise.all(icons.map(async icon => {
  const response = await fetch(icon.url);
  if (!response.ok) {
    throw new Error(`Unable to download ${icon.name}.svg: ${response.status} ${response.statusText}`);
  }

  const svg = await response.text();
  await writeFile(new URL(`${icon.name}.svg`, outputDirectory), svg, 'utf8');
}));
