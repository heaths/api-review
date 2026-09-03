# Repository Guide

## Architecture

- The extension has one browser-safe source entry point, `src/web/extension.ts`,
  bundled for both Node.js and `webworker` extension hosts. Do not add Node-only
  APIs or a separate desktop source entry point.
- Use `vscode.workspace.fs`, `findFiles`, `RelativePattern`, and `Uri` for all
  workspace I/O. Never use Node `fs`, platform path helpers, or `Uri.file`.
- `configuration.ts`, `variables.ts`, and `fileDiscovery.ts` own resource-scoped
  settings and multi-root artifact discovery. Related artifact arrays are
  ordered; the first existing candidate wins.
- `commentPatch.ts` extracts contiguous doc-comment additions and stable
  declaration anchors. `markdown.ts` accepts only unique declaration matches
  inside fenced code blocks.
- `sourceMap.ts` converts 1-based source-map lines to 0-based VS Code positions
  and requires a mapping on the exact generated line.
- `reviewModel.ts` combines and caches metadata. Invalidate it on API edits and
  refresh discovery when configuration, workspace folders, or artifacts change.
- Native Markdown CodeLens and hover behavior lives in `codeLensProvider.ts`.
  CodeLens tooltips are plain text; rich docs use an untrusted `MarkdownString`
  in VS Code's native hover. Do not introduce a webview for this workflow.

## Conventions

- Command arguments must be serializable URI strings and generated positions;
  re-resolve metadata when commands execute to avoid stale navigation.
- Treat malformed optional artifacts as per-document failures and log them to
  the `Azure API Review` output channel.
- Keep parser tests pure where possible. Web integration tests belong under
  `src/web/test/suite` and are discovered by the existing webpack context.
- Test virtual URI schemes and multi-root behavior, not only local file paths.

## Validation

Run `pnpm run lint`, `pnpm run package-vsix`, and `pnpm test`. Browser tests
require Chromium system dependencies.

## License

Licensed under the [MIT](LICENSE.txt) license.
