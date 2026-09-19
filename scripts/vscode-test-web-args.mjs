import { env, platform } from 'process';

export function createVsCodeTestWebArgs({
  extensionTestsPath,
  headless,
  folderPath = '.',
  additionalArgs = [],
}) {
  const args = [
    '--browserType=chromium',
    `--headless=${headless ? 'true' : 'false'}`,
    '--extensionDevelopmentPath=.',
  ];

  if (extensionTestsPath) {
    args.push(`--extensionTestsPath=${extensionTestsPath}`);
  }

  args.push(folderPath, ...additionalArgs);
  return args;
}

export function assertDisplayAvailable(environment = env, currentPlatform = platform) {
  if (currentPlatform !== 'linux') {
    return;
  }

  if (hasDisplay(environment)) {
    return;
  }

  throw new Error(
    'UI browser tests require a display. Re-run under Xvfb '
    + '(for example: xvfb-run -a pnpm run test:ui) or from a desktop session.',
  );
}

function hasDisplay(environment) {
  return isPresent(environment.DISPLAY) || isPresent(environment.WAYLAND_DISPLAY);
}

function isPresent(value) {
  return typeof value === 'string' && value.length > 0;
}
