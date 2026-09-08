# Hover popup plan

## Status

Implemented. This plan records the final design and decisions for the custom
Markdown preview hover popup and related metadata flow.

## Goals

1. Show a small, theme-aware hover popup in the custom preview when the pointer
   or keyboard focus lands on a rendered code line that has documentation,
   source navigation, or both.
2. Keep preview behavior aligned with the text-editor CodeLens behavior by
   deriving both from the same extension-side review metadata.
3. Keep the implementation small and maintainable by avoiding duplicate static
   state and avoiding heavyweight icon/font bundling for three icons.

## Non-goals

1. Do not introduce a new webview, hover provider, or desktop-only entry point.
2. Do not move CodeLens logic into the webview or make the preview DOM a source
   of truth for the text editor.
3. Do not bundle the full Codicon font when checked-in SVGs are sufficient.

## Constraints

1. Keep the extension browser-safe and compatible with the existing
   `src/web/extension.ts` entry point.
2. Reuse existing review metadata, commands, and tooltips instead of inventing
   preview-only behavior where avoidable.
3. Preserve the existing custom preview structure and keep documentation
   grouping compatible with the current per-line span rendering.

## Final architecture

### 1. Canonical metadata stays in the extension

- `ReviewModel` remains the source of truth for review entries.
- `ReviewModel.getPreviewSnapshot()` provides one coherent render snapshot with:
  - `entries`
  - `content.markdown`
  - `content.hasCommentsPatch`
  - `content.commentsPatch`
- Source navigation and documentation availability are still computed from the
  extension-side review model, not from the webview.

### 2. Shared line metadata normalizes preview and CodeLens behavior

- `src/web/lineMetadata.ts` is the shared helper layer.
- `createReviewLineMetadata()` derives action availability for CodeLens.
- `createPreviewLineMetadata()` projects the same facts into preview-specific
  line metadata, including:
  - source line
  - preview line
  - documentation group id
  - documentation preview lines
  - accessibility label
- `commentPatch.mapPreviewLines()` is used to map original Markdown lines to
  rendered preview lines when injected documentation shifts the display.

### 3. The preview uses a DOM-first projection for static line facts

- `src/web/markdownPreview.ts` renders immutable per-line facts into HTML
  `data-*` attributes rather than serializing a separate per-line action model.
- Rendered action lines carry the final metadata needed by the webview:
  - `data-line`
  - `data-source-line`
  - `data-has-documentation`
  - `data-has-source`
  - `data-documentation-group`
  - `aria-*` attributes for popup ownership and labels
- Rendered documentation lines also carry `data-documentation-group` so they
  can be toggled as a group without wrapper containers.
- The popup toolbar markup is emitted directly by `getPreviewHtml()`.

### 4. The webview keeps only mutable interaction state

- `assets/markdownPreview.js` reads static state from the DOM.
- Runtime state is intentionally limited to interaction concerns:
  - hovered line
  - focused line
  - active line
  - popup timers
  - pointer anchor
  - locked horizontal position while open
  - pointer-activated button tracking
- The preview does not maintain a second extension-like action model in memory.

### 5. Command ownership is split cleanly

- **Documentation** is handled inline in the preview by expanding and collapsing
  injected documentation lines.
- **Go to source** is handled by the existing extension command path:
  `heaths.azureApiReview.goToSource`.
- The webview sends a narrow `goToSource` message with the source line, and the
  extension resolves and executes the command against fresh model data.
- Errors on the go-to-source path are surfaced rather than silently ignored.

## Final UI and interaction behavior

### Popup behavior

1. Show the popup after `0.2s`.
2. Fade the popup in and out over `0.1s`.
3. Open the popup above the hovered line when there is room.
4. If there is not enough room above, place it below using a simple viewport
   check.
5. Center the popup over the pointer when opening.
6. Do not keep following the pointer after the popup is open.
7. Keep the popup open while the active line or the popup itself is hovered or
   focused.
8. Close on `Escape`, or after hover/focus leaves both the line and the popup.

### Buttons

1. Use icon-only buttons.
2. Use the same tooltip text as the CodeLens actions:
   - `Click to show documentation`
   - `Navigate to declaration`
3. Disable each button independently when that action is unavailable for the
   active line.
4. Keep normal keyboard activation semantics for buttons.

### Documentation toggle behavior

1. Documentation is a per-line inline toggle in the preview.
2. The preview-wide Show Comments / Hide Comments commands remain the global
   control for all injected documentation lines.
3. Single-line and global visibility use the same CSS class:
   `preview-documentation-visible`.
4. Global expand/collapse applies or removes that class on all documentation
   lines.
5. Per-line expand/collapse applies or removes that same class on one
   documentation group.
6. When toggling a single group, preserve the declaration line's apparent
   position by adjusting scroll with the before/after top offset delta.

## Final styling decisions

1. The popup is theme-aware and built from VS Code theme variables with local
   CSS custom properties layered on top.
2. Popup sizing, spacing, timing, border, radius, focus outline, and shadow are
   configurable through CSS variables.
3. The popup includes a slight themeable drop shadow via
   `--preview-hover-shadow`.
4. The implementation uses checked-in SVG assets based on upstream Codicon
   shapes instead of the Codicon font.
5. The documentation button uses:
   - chevron-down when documentation is collapsed
   - chevron-up when documentation is expanded
6. The source button uses the go-to-file icon.

## Final icon strategy

1. Use the upstream Codicon SVG geometry for:
   - `chevron-down`
   - `chevron-up`
   - `go-to-file`
2. Keep those icons as local assets / inline SVG output rather than bundling the
   full `codicon.ttf`.
3. Treat full Codicon font bundling or subsetting as unnecessary for this
   feature unless a later change needs broader icon coverage.

## File-level implementation plan

### `src/web/reviewModel.ts`

- Add `PreviewSnapshot`.
- Return one coherent preview snapshot through `getPreviewSnapshot()`.
- Include comments-patch-aware preview content alongside review entries.

### `src/web/commentPatch.ts`

- Keep `mapPreviewLines()` as the render-time mapping helper.
- Track documentation groups so declaration lines can toggle the injected
  documentation lines that belong to them.

### `src/web/lineMetadata.ts`

- Centralize shared review-line and preview-line metadata creation.
- Ensure CodeLens and preview action availability come from the same normalized
  facts.

### `src/web/codeLensProvider.ts`

- Reuse shared review-line metadata.
- Keep the canonical tooltip constants for Documentation and Go to source.
- Keep source navigation behavior in the extension command path.

### `src/web/markdownPreview.ts`

- Render preview line metadata into DOM attributes.
- Emit the popup toolbar in the generated HTML.
- Keep webview message handling narrow and limited to source navigation.
- Continue loading contributed Markdown preview CSS through `extensionUri`.

### `assets/markdownPreview.js`

- Discover actionable lines from `.preview-action-line`.
- Discover documentation groups from DOM attributes.
- Manage popup timing, placement, enablement, focus behavior, and message
  dispatch.
- Keep global and per-line documentation visibility in sync through a single
  DOM class.

### `assets/markdownPreview.css`

- Define the popup styling and timing variables.
- Hide documentation lines by default when a comments patch exists.
- Reveal documentation lines when `preview-documentation-visible` is present.

## Performance and maintainability decisions

1. Compute preview mapping once per render from a coherent snapshot.
2. Keep one shared extension-side metadata pipeline for CodeLens and preview.
3. Push immutable per-line state into the DOM so the webview does not have to
   reconstruct or maintain a second static action model.
4. Keep only mutable UI state in JavaScript.
5. Avoid wrapper-container restructuring for documentation blocks; shared group
   ids are enough and keep the markup smaller.
6. Avoid bundling the full Codicon font to reduce extension size and load cost.

## Testing and validation plan

### Unit and integration coverage

1. Cover preview line mapping when documentation comment lines are injected.
2. Cover mixed action availability across lines.
3. Cover DOM attribute rendering for actionable lines and documentation lines.
4. Cover multiline comment rendering behavior.
5. Keep browser-facing logic thin and cover deterministic behavior in the
   existing TypeScript and web extension test surfaces.

### Validation commands

1. `pnpm run lint`
2. `pnpm run package:vsix`
3. `pnpm test`

## Final acceptance criteria

1. Hovering or focusing an actionable code line shows a popup after `0.2s`.
2. The popup is positioned above the line when possible, otherwise below.
3. The popup does not track the pointer after opening.
4. Documentation and Go to source buttons use the expected tooltips and enable
   state.
5. Go to source navigates through the existing extension command.
6. Documentation expands and collapses consistently for both per-line and
   global actions.
7. The preview and CodeLens derive action availability from the same shared
   metadata.
8. The implementation remains theme-aware, browser-safe, and low-bloat.

## Session metrics

- Input tokens: 19,808,824
- Output tokens: 142,988
- Turns: 26
- Model: GPT-5.4 (`gpt-5.4`), GPT-5.6 Sol (`gpt-5.6-sol`)
- AIC: 1,083.33

These are best-effort hover-popup-focused estimates from local per-turn usage,
excluding the changelog turn range as cleanly as possible. They may still
include some unrelated work to update the changelog more consistently.
