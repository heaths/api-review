# Code lens plan

## Status

Implemented. This plan records the final design for the original CodeLens
providers and related documentation/source navigation behavior.

## Goals

1. Show Documentation and Go to source CodeLens actions only on declaration
   lines that have actionable review metadata.
2. Keep Documentation behavior consistent with native VS Code peek behavior so
   the rendered content does not obscure the CodeLens itself.
3. Keep source navigation accurate and re-resolved from current model data when
   a command executes.

## Non-goals

1. Do not render rich documentation in a hover or webview for the text editor
   CodeLens flow.
2. Do not cache stale command targets directly inside the lens beyond the
   serializable document URI and generated line number.
3. Do not offer actions for lines that no longer have documentation or source
   metadata.

## Constraints

1. Keep the implementation browser-safe and compatible with the web extension
   entry point.
2. Use serializable command arguments and re-resolve metadata when commands
   execute.
3. Keep documentation rendering in a read-only virtual document opened through
   native peek behavior.

## Final architecture

### 1. Review metadata drives action availability

- `ReviewModel` remains the source of truth for review entries.
- `createReviewLineMetadata()` derives `hasDocumentation` and `hasSource`
  flags from those entries.
- `ReviewCodeLensProvider.provideCodeLenses()` emits:
  - `$(file-text) Documentation`
  - `$(go-to-file) Go to source`
- Each lens argument contains only:
  - `uri`
  - `line`

### 2. Documentation uses a virtual document plus native peek

- `src/web/documentation.ts` creates virtual documentation URIs under the
  `azure-api-review` scheme.
- `DocumentationProvider` resolves the current documentation text from
  `ReviewModel` whenever the virtual document is opened or refreshed.
- `showDocumentation()` temporarily registers a definition provider and invokes
  `editor.action.peekDefinition`.
- This keeps the documentation display below the declaration, matching native
  peek ergonomics and avoiding CodeLens overlap.

### 3. Source navigation is resolved at command time

- `goToSource()` reopens the target document, re-reads the entry for the
  requested line, and navigates only when `entry.source` still exists.
- If metadata is stale or gone, the command shows the same warning path instead
  of silently failing.

## Final UI behavior

1. Documentation CodeLens tooltip: `Click to show documentation`
2. Go to source CodeLens tooltip: `Navigate to declaration`
3. Documentation opens through native peek behavior rather than a floating
   hover.
4. Go to source opens the original declaration selection in the source file.
5. Missing metadata produces explicit warnings rather than no-op behavior.

## File-level implementation plan

### `src/web/codeLensProvider.ts`

- Build CodeLens actions from normalized review-line metadata.
- Export the canonical command ids and tooltip strings.
- Keep command arguments to serializable URI + line pairs.
- Re-resolve entries on command execution.

### `src/web/documentation.ts`

- Build and parse virtual documentation URIs.
- Serve documentation through a `TextDocumentContentProvider`.
- Refresh open documentation virtual documents when the model changes.
- Preserve language-aware highlighting by using the declaration language's file
  extension where available.

### `src/web/reviewModel.ts`

- Expose review entries with optional `documentation` and `source` metadata.
- Invalidate and refresh entries when underlying review artifacts change.

## Performance and maintainability decisions

1. Keep CodeLens action availability derived from shared metadata helpers.
2. Pass minimal command arguments and resolve current state only when needed.
3. Reuse native VS Code peek behavior instead of maintaining a custom text
   editor popup for CodeLens documentation.

## Validation commands

1. `pnpm run lint`
2. `pnpm run package:vsix`
3. `pnpm test`

## Final acceptance criteria

1. Documentation and Go to source lenses appear only on actionable lines.
2. Documentation display does not cover the originating CodeLens.
3. Tooltips match the final wording exactly.
4. Source navigation and documentation lookup re-resolve current model state.
5. Missing or stale metadata produces explicit warnings.

## Session metrics

- Input tokens: 36,453,487
- Output tokens: 179,255
- Turns: 33
- Model: GPT-5.6 Sol (`gpt-5.6-sol`), GPT-5.4 (`gpt-5.4`)
- AIC: 1,230.33

These are best-effort totals for CodeLens-related work in this repository. They
include the shared hover-menu session because that work deliberately reused and
extended the original CodeLens semantics, so these totals overlap with the
custom-preview plan.
