# Repository Guide

## Architecture

- The extension has one browser-safe source entry point, `src/web/extension.ts`,
  bundled for both Node.js and `webworker` extension hosts. Do not add Node-only
  APIs or a separate desktop source entry point.
- Local repository access belongs in `gitClient.ts`. Keep `displayDiff.ts` and
  other feature code unaware of `vscode.git` activation details, and keep the
  real Git adapter behind `gitClientFactory.ts` for Node.js hosts plus the noop
  adapter behind `gitClientFactory.web.ts` for web hosts.
- GitHub network access belongs in `githubClient.ts`. When a change needs GitHub
  auth, Octokit, GitHub REST endpoints, GraphQL queries, PR metadata, GitHub
  tags or commits, or GitHub blob content, update `githubClient.ts` rather than
  adding GitHub transport code elsewhere or depending on another GitHub
  extension API.
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
- Native Markdown CodeLens behavior lives in `codeLensProvider.ts`. CodeLens
  tooltips are short plain text describing the action. `documentation.ts` serves
  doc comments as read-only virtual documents that the `Documentation` CodeLens
  opens through a transient definition provider and `editor.action.peekDefinition`,
  so editor associations cannot replace the source text editor. Dispose the
  provider after each peek. Do not introduce a webview or a hover for this workflow.
- The custom Markdown editor loads CSS declared by installed extensions through
  `markdown.previewStyles`, after its own base stylesheet. Resolve contributions
  from each extension's `extensionUri` so desktop, remote, and web hosts work.
- Preview extensibility is CSS-only. Do not load `markdown.styles`, execute
  `markdown.previewScripts`, or activate `markdown.markdownItPlugins` in the
  custom editor.
- Prefer local-first diff behavior: use `gitClient.ts` when a local repository is
  available, and fall back to `githubClient.ts` only for GitHub-backed documents
  or operations that require published GitHub state.
- Keep the custom editor selector broad enough for all Markdown files. Repository
  `workbench.editorAssociations` settings choose which configured API files open
  in it by default; the manifest selector cannot follow resource-scoped include
  settings.

## Conventions

- Command arguments must be serializable URI strings and generated positions;
  re-resolve metadata when commands execute to avoid stale navigation.
- Treat malformed optional artifacts as per-document failures and log them to
  the `Azure API Review` output channel.
- Keep parser tests pure where possible. Web integration tests belong under
  `src/web/test/suite` and are discovered by the existing webpack context.
- Test virtual URI schemes and multi-root behavior, not only local file paths.
- Keep caching policy inside `githubClient.ts`. Namespace cached GitHub results
  by authenticated account and request shape, use REST conditional requests with
  `ETag` and `If-None-Match` when the endpoint supports them, and do not push
  cache ownership into feature code.
- Prefer Octokit GraphQL when the query can return a small, exact GitHub model
  and the operation does not depend on HTTP conditional caching. Prefer Octokit
  REST when the endpoint offers cleaner filtering, raw content responses,
  pagination behavior, or `ETag`-based revalidation that should back the cache.
- When adding or changing diff history behavior, update `gitClient.ts` if the
  source of truth is the local repository, update `githubClient.ts` if the
  source of truth is GitHub, and update `displayDiff.ts` only for orchestration,
  baseline selection, and fallback order.
- Write commit messages and pull request titles and descriptions as described in
  `.github/instructions/commits.instructions.md`.
- Keep dependency and Playwright caching in sync across workflows, including
  `.github/workflows/ci.yml` and `.github/workflows/copilot-setup-steps.yml`,
  so they use the same cache paths and keys and can reuse the same caches.

## Validation

Run `pnpm run lint`, `pnpm run package:vsix`, and `pnpm test`. Browser tests
require Chromium system dependencies.

## License

Licensed under the [MIT](LICENSE.txt) license.
