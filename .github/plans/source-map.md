# Source map plan

## Status

Implemented. This plan records the final source-map design and follow-up test
stabilization decisions from the source-map-related sessions I found for this
repository.

## Goals

1. Resolve generated Markdown code locations back to original source files
   through source maps.
2. Ignore any embedded `sourceRoot` in the map and always resolve sources
   relative to the repository root for the current API document.
3. Support both physical and virtual workspace roots.
4. Keep tests stable by using dedicated fixtures rather than mutable example
   artifacts.

## Non-goals

1. Do not trust external or generated `sourceRoot` values.
2. Do not resolve source-map results outside the repository root scheme.
3. Do not make tests depend on full generated example trees when focused mock
   fixtures are enough.

## Constraints

1. Keep source-map resolution browser-safe and VS Code host-safe.
2. Use repository/workspace URIs rather than Node path helpers.
3. Preserve support for multi-root and virtual file systems.
4. Require a mapping on the exact generated line rather than leaking from a
   previous generated line.

## Final architecture

### 1. Discovery and ownership

- `fileDiscovery.ts` discovers API documents and their related source-map
  artifacts through configured/default related-file patterns.
- `ReviewModel` reads the related source-map artifact for a given API document
  and uses it only when building review entries for fenced code lines.

### 2. Resolver semantics

- `src/web/sourceMap.ts` owns source-map resolution.
- `resolveOriginalLocation(sourceMapText, repositoryRootUri, generatedLine,
  generatedColumn)` is the canonical resolver.
- The resolver parses the raw source map, then immediately overrides
  `rawSourceMap.sourceRoot` with `repositoryRootUri.toString()`.
- A `SourceMapConsumer` is created only after that override, so URI joining is
  delegated consistently through the source-map library.

### 3. Safety and correctness rules

1. Only return a location when there is a mapping on the exact generated line.
2. Do not reuse a prior line's mapping for a later unmapped generated line.
3. Return `undefined` when `originalPositionFor()` does not yield a full
   source/line/column triple.
4. Parse the resulting source as a URI and require its scheme to match the
   repository root scheme.
5. Convert source-map lines from 1-based values to VS Code's 0-based
   `Position`.

### 4. Integration with review metadata

- `ReviewModel` walks fenced code lines from the Markdown source.
- For each code line, it computes the first non-whitespace column and resolves
  that generated position through the source map.
- When a location exists, the review entry for that Markdown line gets a
  `source` location used by CodeLens and preview navigation.

## Final testing strategy

### Core resolver coverage

1. Resolve an exact generated line to a source location.
2. Override an incorrect embedded `sourceRoot` with a virtual repository root.
3. Override an incorrect embedded `sourceRoot` with a physical repository root.
4. Reject lookups that would otherwise leak a mapping from a previous generated
   line.

### Fixture and integration stability

1. Do not rely on mutable example files for source-map-related tests.
2. Use dedicated fixtures under `src/web/test/fixtures/` with only the minimal
   API Markdown, comments patch, and source-map content required by the tests.
3. Keep source-navigation and documentation scenarios covered without importing
   large generated example trees.

## File-level implementation plan

### `src/web/sourceMap.ts`

- Parse the raw source map.
- Override `sourceRoot` with the repository URI string before constructing the
  consumer.
- Check that the requested generated line has at least one mapping on that same
  line.
- Resolve the original source location and return a VS Code `Location` only
  when the source URI is valid and uses the same scheme as the repository root.

### `src/web/reviewModel.ts`

- Read the discovered source-map artifact.
- Walk fenced code lines from the Markdown source.
- Resolve each generated line/column pair into a `source` location and attach
  it to the review entry for that Markdown line.

### `src/web/fileDiscovery.ts`

- Discover related source-map artifacts alongside API documents using the
  configured/default related-file patterns.
- Keep all artifact resolution workspace-rooted and URI-based.

### `src/web/test/suite/sourceMap.test.ts`

- Cover exact-line resolution.
- Cover virtual and physical repository roots.
- Cover embedded `sourceRoot` override.
- Cover the no-leak behavior for unmapped later lines.

### `src/web/test/fixtures/`

- Keep focused mock artifacts for integration tests that need source-map-backed
  source navigation, separate from mutable example content.

## Performance and maintainability decisions

1. Keep the resolver small and deterministic.
2. Reuse the source-map library for URI joining after overriding `sourceRoot`
   instead of reimplementing path resolution logic.
3. Keep source-map tests narrow and fixture-based so unrelated example churn
   does not break them.
4. Preserve virtual-file-system support by using URIs end to end rather than
   assuming local file paths.

## Validation commands

1. `pnpm run lint`
2. `pnpm run package:vsix`
3. `pnpm test`

## Final acceptance criteria

1. Embedded `sourceRoot` values never control final source resolution.
2. Source locations resolve under the repository root for both `memfs:` and
   `file:` workspaces.
3. Unmapped generated lines do not inherit a prior line's mapping.
4. Review entries expose source navigation only when the source map resolves a
   valid location.
5. Source-map-related tests remain stable when example artifacts change.

## Session metrics

- Input tokens: 1,257,552
- Output tokens: 11,483
- Turns: 4
- Model: GPT-5.6 Sol (`gpt-5.6-sol`)
- AIC: 34

These totals cover the source-map-related repo sessions listed above. They may
still include a small amount of adjacent validation or test-stabilization work
that was done to keep source-map behavior consistent.
