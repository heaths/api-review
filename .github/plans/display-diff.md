# Display diff plan

## Status

Implemented. This plan records the shipped display-diff design for the custom
Markdown preview.

## Goals

1. Show added and removed API Markdown lines against a selected baseline in the
   existing custom preview.
2. Keep Documentation and Go to source behavior bound to the target document,
   even when diff rendering inserts or removes visible lines.
3. Support repository-derived baselines and explicit file baselines without
   adding a second preview implementation.

## Non-goals

1. Do not add a separate desktop-only source entry point.
2. Do not move source navigation or documentation resolution into the webview.
3. Do not rely solely on `vscode.git` history when a file baseline can still
   be chosen directly.

## Constraints

1. Keep the extension browser-safe and compatible with the existing
   `src/web/extension.ts` entry point.
2. Use the built-in Git extension only where it is available, and degrade
   clearly when Git history is unavailable.
3. Keep command arguments and exported API inputs serializable.

## Final behavior

### Toolbar and picker flow

1. The preview title bar shows the inactive diff button with the built-in
   `diff` icon in the far-left custom title slot.
2. When diff is inactive, invoking the command applies the best default
   baseline immediately and then opens a picker.
3. When diff is already active, the title bar shows built-in `arrow-down`,
   `arrow-up`, and `close` actions before the comments toggle and Reopen as
   source file action.
4. The arrow buttons navigate between diff hunks without changing their title
   bar positions when navigation is unavailable.
5. The picker orders items as:
   - semver-parsed tags in descending order
   - remaining commits in descending commit-date order
   - `Choose file...` as the final item
6. Tag rows show the captured version text from the matching tag regex, while
   commit rows use an 8-character SHA label with commit date inline and the
   commit title in the detail row.
7. `Choose file...` opens a normal VS Code file picker and supports explicit
   file baselines through serializable URI strings.

### Baseline selection

1. Git-backed history comes from the built-in `vscode.git` API when the
   current document belongs to a repository and the file exists at the
   candidate revision.
2. Tag versions are extracted with ordered resource-scoped regexes from
   `heaths.azureApiReview.git.tags`. The implementation prefers a named
   capture called `version`, then falls back to capture group 1.
3. The default tag regex is `^[\\w-]+@(?<version>.+)$`, which maps tags like
   `azure_security_keyvault_keys@1.1.0-beta.1` to `1.1.0-beta.1`.
4. The default baseline is chosen from tags using the nearest `Cargo.toml`
   package version when one can be resolved:
   - beta versions prefer the previous beta for the same release
   - otherwise stable versions prefer the previous stable release
   - unstable `0.x` versions fall back to the latest unstable tag
   - if no matching tag exists, fall back to the latest file commit
5. PR-aware base selection runs before plain history selection when:
   - the repository has a GitHub remote
   - a checked-out branch is available
   - GitHub authentication succeeds
   - a matching open pull request can be resolved
6. PR base resolution uses the built-in GitHub authentication provider and
   prefers an exact tag on the PR base commit when one exists; otherwise it
   uses the base commit SHA directly.
7. When Git history is unavailable, the explicit file baseline path still keeps
   diffing available.

### Rendering and metadata

1. The existing preview snapshot remains the target-side source of truth.
2. Diff rendering compares baseline and target API Markdown only; injected
   review comments do not participate in diff matching, hunk generation,
   coloring, or navigation.
3. Target-side line metadata is projected onto the diff output so actionable
   lines retain:
   - `data-source-line`
   - documentation grouping
   - accessibility labels
   - popup action availability
4. When a target API line has extracted review comments, diff mode renders
   those comments as neutral informational lines that can still be revealed
   with the existing comments toggle, but they are never styled as additions
   or counted as hunks.
5. Added and removed Markdown outside code fences is rendered with normal
   Markdown block semantics, using compact diff-specific block styling for
   headings, metadata rows, and feature lists.
6. Added and removed code lines are rendered inside themed code blocks with the
   same syntax-highlighting path used by the preview, plus diff-specific
   line classes and no extra block chrome.
7. Diff wrappers remain layout-neutral so hunks can anchor navigation without
   adding visible padding, margins, borders, or left-shift chrome.

### Exported API

1. `activate()` returns extension API version `1`.
2. The exported API exposes:
   - `showDiff(documentUri, baseline)`
   - `hideDiff(documentUri)`
3. Baselines use explicit typed objects rather than magic strings:
   - `{ kind: 'tag', ref: string }`
   - `{ kind: 'commit', ref: string }`
   - `{ kind: 'file', uri: string }`

## File-level implementation

### `package.json`

- Added diff commands, editor-title menu entries for far-left inactive diff
  and active next/previous/close navigation, the
  `vscode.github-authentication` extension dependency, the configurable
  `heaths.azureApiReview.git.tags` setting, and an agent-friendly `pnpm test`
  wrapper that runs headless in CI or when `COPILOT_GITHUB_TOKEN` is set.

### `src/web/displayDiff.ts`

- Added baseline selection types.
- Added Git history discovery, configurable tag-version extraction, tag
  ordering, version-based default selection, PR-base lookup, and baseline
  loading.

### `src/web/diffPreview.ts`

- Added diff-aware preview rendering for Markdown and fenced code blocks.
- Preserved target-side line metadata on actionable diff lines.
- Rendered informational review comments in diff mode as neutral, toggleable
  lines outside diff hunk accounting.

### `src/web/extension.ts`

- Registered diff commands.
- Invalidated diff state alongside the existing preview/model refresh flow.
- Exported the extension API.

### `src/web/markdownPreview.ts`

- Added per-preview diff state and availability tracking.
- Added picker flow, file-baseline selection, active diff hunk navigation, and
  diff rendering integration.
- Extended preview contexts so the toolbar can reflect diff availability and
  active diff state, including previous and next hunk availability.
- Switched diff-mode comparisons to API-only Markdown so injected comments do
  not affect diff output or navigation.

### `src/web/lineMetadata.ts`

- Added diff-specific line metadata projection so documentation and source
  actions stay available on API lines even when diff mode excludes injected
  preview-comment lines from comparison.

### `assets/markdownPreview.js`

- Added unique logical-hunk navigation so previous/next operate on actual diff
  anchors instead of every rendered diff line carrying the same hunk id.
- Limited navigation targets to visible API hunks so informational comments do
  not become scroll destinations.

### `assets/markdownPreview.css`

- Added minimal diff summary styling and line-oriented diff styling using VS
  Code diff colors without extra hunk spacing or indentation.

### `src/web/test/suite/*`

- Added unit coverage for version parsing, tag ordering, default baseline
  selection, and diff metadata projection.
- Extended extension activation tests for the new commands, exported API, and
  explicit file-to-file diffs between versioned fixtures.
- Added regression coverage for partially changed fenced blocks, nested feature
  rendering, file-baseline source navigation, and comment exclusion in diff
  mode.

### `src/web/test/fixtures/*`

- Replaced the simple single-file fixture with versioned `v1/` and `v2/`
  fixtures that model crate metadata, nested feature trees, and added/removed
  API surface, with matching comments patches and source maps.

## Limitations and notes

1. PR detection currently matches open pull requests against the current GitHub
   remote owner and checked-out branch.
2. Git-backed revision history depends on the built-in Git extension being
   available for the current host. In a pure web host, diffing currently falls
   back to explicit file comparison because that Git API path is unavailable.
3. Tag discovery depends on the configured regexes extracting a version through
   a named `version` group or capture group 1.
4. The diff renderer currently emphasizes line-level additions and removals,
   not token-level intra-line changes.

## Validation commands

1. `pnpm run lint`
2. `pnpm run package:vsix`
3. `pnpm test`

## Final acceptance criteria

1. The preview can diff the active API against tag, commit, or explicit file
   baselines without opening a second viewer.
2. Next/previous/close toolbar actions operate on visible API diff hunks and
   keep their positions stable while diff mode is active.
3. Target-side Documentation and Go to source behavior remains bound to the
   current API lines during diff view.
4. Injected review comments stay informational in diff mode: they can be
   revealed, but they do not appear as added green hunks or navigation
   targets.
5. Diff rendering stays compact for both Markdown sections and fenced code,
   with no extra hunk chrome or spacing.
6. Git history unavailability still leaves explicit file-to-file diffing
   available in web hosts.

## Validation outcome

- `pnpm run lint`
- `COPILOT_GITHUB_TOKEN=dummy pnpm test`
- `pnpm run package:vsix`
- Result: 54 passing tests and successful VSIX packaging

## Session metrics

- Input tokens: 45,358,352
- Output tokens: 308,123
- Turns: 18
- Model: GPT-5.4 (`gpt-5.4`)
- AIC: 476

These are best-effort totals from the current display-diff implementation
session in the repository session store.
