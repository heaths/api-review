import { mkdir, rm, writeFile } from 'node:fs/promises';

const codiconBaseUrl = 'https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/icons';
const templateNames = ['file-text', 'clear-all', 'expand-all', 'collapse-all', 'diff', 'go-to-file', 'comment'];
const outputDirectory = new URL('../assets/codicons/', import.meta.url);
const cornerOverlayTransform = 'translate(6.769 6.769) scale(0.6154)';
const closeOverlayTransform = 'translate(8.571 6.857) scale(1.1429)';
const overlayCutout = '<rect x="7.5" y="7.5" width="8.5" height="8.5" fill="black"/>';

const templates = new Map(await Promise.all(templateNames.map(async name => {
  const response = await fetch(`${codiconBaseUrl}/${name}.svg`);
  if (!response.ok) {
    throw new Error(`Unable to download ${name}.svg: ${response.status} ${response.statusText}`);
  }

  return [name, await response.text()];
})));

const fileTextPaths = getPaths(getTemplate('file-text'));
const clearAllPaths = getPaths(getTemplate('clear-all'));
const expandAllPaths = getPaths(getTemplate('expand-all'));
const collapseAllPaths = getPaths(getTemplate('collapse-all'));
const diffPaths = getPaths(getTemplate('diff'));
const goToFilePaths = getPaths(getTemplate('go-to-file'));
const commentPaths = getPaths(getTemplate('comment'));

if (clearAllPaths.length !== 5) {
  throw new Error(`Expected clear-all.svg to contain 5 paths, but found ${clearAllPaths.length}`);
}

const icons = new Map([
  ['expand-docs', createSvg(fileTextPaths)],
  ['collapse-docs', createCompositeSvg(
    fileTextPaths,
    [transformPath(clearAllPaths[3], closeOverlayTransform)],
  )],
  ['expand-all-docs', createCompositeSvg(
    fileTextPaths,
    expandAllPaths.map(path => transformPath(path, cornerOverlayTransform)),
  )],
  ['collapse-all-docs', createCompositeSvg(
    fileTextPaths,
    collapseAllPaths.map(path => transformPath(path, cornerOverlayTransform)),
  )],
  ['close-diff', createCompositeSvg(
    diffPaths,
    [transformPath(clearAllPaths[3], closeOverlayTransform)],
  )],
  ['comment', createSvg(commentPaths)],
  ['go-to-file', createSvg(goToFilePaths)],
]);
const runtimeIconNames = ['expand-docs', 'collapse-docs', 'comment', 'go-to-file'];
const themedIconNames = ['expand-all-docs', 'collapse-all-docs', 'close-diff'];

await rm(outputDirectory, { recursive: true, force: true });
await Promise.all([
  mkdir(outputDirectory, { recursive: true }),
  mkdir(new URL('light/', outputDirectory), { recursive: true }),
  mkdir(new URL('dark/', outputDirectory), { recursive: true }),
]);

await Promise.all([
  ...runtimeIconNames.map(name => {
    const svg = icons.get(name);
    if (!svg) {
      throw new Error(`Missing generated icon: ${name}.svg`);
    }
    return writeFile(new URL(`${name}.svg`, outputDirectory), svg, 'utf8');
  }),
  ...themedIconNames.map(name => {
    const svg = icons.get(name);
    if (!svg) {
      throw new Error(`Missing generated icon: ${name}.svg`);
    }

    return Promise.all([
      writeFile(
        new URL(`light/${name}.svg`, outputDirectory),
        svg.replace('fill="currentColor"', 'fill="#424242"'),
        'utf8',
      ),
      writeFile(
        new URL(`dark/${name}.svg`, outputDirectory),
        svg.replace('fill="currentColor"', 'fill="#c5c5c5"'),
        'utf8',
      ),
    ]);
  }),
]);

function getTemplate(name) {
  const template = templates.get(name);
  if (!template) {
    throw new Error(`Missing downloaded template: ${name}.svg`);
  }
  return template;
}

function getPaths(svg) {
  const paths = svg.match(/<path\b[^>]*\/>/g);
  if (!paths?.length) {
    throw new Error('Downloaded SVG does not contain any self-closing paths');
  }
  return paths;
}

function transformPath(path, transform) {
  return path.replace('<path ', `<path transform="${transform}" `);
}

function createSvg(paths) {
  return [
    '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor">',
    ...paths,
    '</svg>',
    '',
  ].join('');
}

function createCompositeSvg(basePaths, overlayPaths) {
  return createSvg([
    `<defs><mask id="base-cutout"><rect width="16" height="16" fill="white"/>${overlayCutout}</mask></defs>`,
    `<g mask="url(#base-cutout)">${basePaths.join('')}</g>`,
    ...overlayPaths,
  ]);
}
