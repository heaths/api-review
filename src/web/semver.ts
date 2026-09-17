export interface Version {
  readonly raw: string;
  readonly normalized: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (string | number)[];
}

export function parseVersion(value: string): Version | undefined {
  const normalized = value.trim().replace(/^v/i, '');
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/u);
  if (!match) {
    return undefined;
  }

  return {
    raw: value,
    normalized,
    major: Number(match[1]),
    minor: Number(match[2] ?? '0'),
    patch: Number(match[3] ?? '0'),
    prerelease: parsePrerelease(match[4]),
  };
}

export function compareVersions(left: Version, right: Version): number {
  const release = compareRelease(left, right);
  if (release !== 0) {
    return release;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }
  if (left.prerelease.length === 0) {
    return 1;
  }
  if (right.prerelease.length === 0) {
    return -1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      if (leftPart !== rightPart) {
        return leftPart - rightPart;
      }
      continue;
    }
    if (typeof leftPart === 'number') {
      return -1;
    }
    if (typeof rightPart === 'number') {
      return 1;
    }
    const comparison = leftPart.localeCompare(rightPart);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export function sortByVersionDescending<T extends { readonly version: Version }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => compareVersions(right.version, left.version));
}

function parsePrerelease(value: string | undefined): readonly (string | number)[] {
  if (!value) {
    return [];
  }

  return value.split('.').map(part => /^\d+$/u.test(part) ? Number(part) : part.toLowerCase());
}

function compareRelease(left: Version, right: Version): number {
  return left.major - right.major
    || left.minor - right.minor
    || left.patch - right.patch;
}
