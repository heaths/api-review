# Custom preview plan

## Status

Implemented. This plan records the final design for the custom Markdown preview
view, including inline documentation, source navigation, and hover actions.

## Goals

1. Render API review Markdown in a custom preview that can project review
   metadata into rendered code blocks.
2. Support inline documentation visibility and source navigation for actionable
   code lines.
3. Keep preview behavior aligned with the text-editor CodeLens actions while
   preserving a preview-native interaction model.
4. Keep the preview maintainable by pushing static per-line facts into the DOM
   and keeping only mutable UI state in script.

## Non-goals

1. Do not add a separate desktop-only implementation or Node-only workspace I/O
   path.
2. Do not make the preview DOM the source of truth for the extension's review
   metadata.
3. Do not bundle heavyweight icon-font assets when a few SVG-based icons are
   enough.

## Constraints

1. Keep the implementation inside the existing custom editor and webview stack.
2. Use VS Code theme variables and custom CSS properties for popup styling.
3. Keep the preview safe for physical, remote, and virtual workspace roots.
4. Preserve the existing highlighted per-line code rendering structure.

## Final architecture

### 1. One coherent render snapshot

- `ReviewModel.getPreviewSnapshot()` returns:
  - `entries`
  - patched or unpatched preview Markdown
  - comments-patch metadata
- The preview render path computes line metadata once per render from that
  snapshot.

### 2. Shared extension-side metadata, DOM-first preview projection

- `lineMetadata.ts` is the shared helper layer between preview and CodeLens
  semantics.
- `createPreviewLineMetadata()` maps review entries into preview-rendered line
  metadata, including:
  - source line
  - preview line
  - documentation group id
  - documentation preview lines
  - action availability
  - accessibility label
- `markdownPreview.ts` projects those immutable facts into rendered
  `data-*` attributes.

### 3. Inline documentation groups

- `commentPatch.mapPreviewLines()` maps original Markdown lines to preview lines
  when injected documentation comment lines shift rendering.
- Declaration lines and injected documentation lines share a stable
  documentation group id.
- The preview uses the same `preview-documentation-visible` class for both
  per-line and global comment visibility changes.

### 4. Narrow webview runtime

- `assets/markdownPreview.js` reads action availability and grouping from the
  DOM.
- The script keeps only mutable interaction state:
  - hovered line
  - focused line
  - active line
  - popup timers
  - pointer anchor
  - locked horizontal popup position
- The only webview-to-extension action is `goToSource`.

## Final UI behavior

### Hover actions

1. Show the hover popup after `0.2s`.
2. Fade it in and out over `0.1s`.
3. Place it above the hovered line when there is room; otherwise place it
   below with a simple viewport check.
4. Center it over the pointer when opening, but do not keep following pointer
   movement.
5. Keep it open while the line or the popup remains hovered or focused.
6. Close it on `Escape` or after hover/focus leaves both surfaces.

### Buttons

1. Use icon-only Documentation and Go to source buttons.
2. Use the same tooltip text as the text-editor CodeLens actions.
3. Disable each button independently when the active line lacks that action.
4. Toggle the Documentation icon between chevron-down and chevron-up based on
   visibility state.

### Documentation visibility

1. Global Show Comments / Hide Comments controls still affect all documentation
   lines.
2. Per-line documentation toggling uses the same visibility class as the global
   controls.
3. Toggling one documentation group preserves the declaration line's apparent
   position by compensating scroll with the before/after top delta.

## Final styling and asset decisions

1. Use CSS custom properties for popup timing, spacing, border, radius, focus
   styling, and shadow.
2. Keep the popup theme-aware through VS Code color variables.
3. Use SVG-based Codicon-equivalent shapes for:
   - chevron-down
   - chevron-up
   - go-to-file
4. Prefer these local SVG assets over bundling the full Codicon font.

## File-level implementation plan

### `src/web/markdownPreview.ts`

- Render Markdown with per-line preview metadata attributes.
- Emit the popup toolbar in the generated HTML.
- Keep contributed Markdown preview styles loading from each extension's
  `extensionUri`.
- Forward only source-navigation messages back to the extension host.

### `assets/markdownPreview.js`

- Discover actionable lines from `.preview-action-line`.
- Discover documentation groups from DOM attributes.
- Manage hover timing, popup placement, button state, focus behavior, and
  source-navigation messaging.
- Keep documentation visibility logic unified for single-line and global
  toggles.

### `assets/markdownPreview.css`

- Define popup styling and timing variables.
- Hide injected documentation lines by default when a comments patch exists.
- Reveal them through `preview-documentation-visible`.

### `src/web/commentPatch.ts`

- Map patched preview lines back to declaration lines.
- Track documentation groups for inline toggling.

### `src/web/lineMetadata.ts`

- Centralize review-line and preview-line metadata derivation.
- Keep preview and CodeLens action availability semantics aligned.

## Performance and maintainability decisions

1. Compute preview mapping once per render.
2. Keep one shared extension-side metadata model and project it into the DOM
   for the webview.
3. Avoid reconstructing a second full static action model in script.
4. Keep wrapper markup minimal by grouping documentation lines with shared ids
   instead of larger structural rewrites.
5. Avoid font bloat by using a few local SVG icon shapes.

## Validation commands

1. `pnpm run lint`
2. `pnpm run package:vsix`
3. `pnpm test`

## Final acceptance criteria

1. Actionable preview lines expose Documentation and/or Go to source behavior.
2. The popup timing, positioning, and theme behavior match the final design.
3. The popup remains clickable and does not recenter while open.
4. Per-line and global documentation visibility stay consistent in both
   directions.
5. Preview source navigation goes through the same extension command semantics
   as the text-editor CodeLens flow.
6. Static line facts live in the rendered DOM rather than a duplicated preview
   action payload.

## Session metrics

- Input tokens: 20,124,071
- Output tokens: 146,560
- Turns: 27
- Model: GPT-5.4 (`gpt-5.4`), GPT-5.6 Sol (`gpt-5.6-sol`)
- AIC: 1,092.33

These are best-effort totals for custom-preview-related work in this
repository. They include the shared hover-menu session and the preview test
stabilization session, so they overlap with the code-lens plan where the same
work intentionally reused CodeLens semantics.
