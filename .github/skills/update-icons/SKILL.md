---
name: update-icons
description: Use when asked to update or regenerate the extension's custom documentation icons from VS Code codicons.
---

# Update icons

## Steps

1. Run `pnpm run update-icons` from the repository root.
2. Review the generated SVGs under `assets/codicons/`.
3. Keep built-in codicons for unmodified icons where the VS Code surface
   supports them. CodeLens titles only support built-in codicon IDs, so use
   `$(file-text)` for Documentation and `$(go-to-file)` for Go to source.
4. Keep the custom documentation icon family consistent:
   - `expand-docs` is the built-in `file-text` path.
   - `collapse-docs` adds the close path from `clear-all` in the lower-right.
   - `expand-all-docs` adds a smaller `expand-all` in the lower-right.
   - `collapse-all-docs` adds a smaller `collapse-all` in the lower-right.
   - `close-diff` adds the same close overlay to the built-in `diff` path.
5. Recompose the overlays if upstream codicon paths change. Reuse the built-in
   paths whenever possible, and keep the close, expand-all, and collapse-all
   overlays in the lower-right quadrant (8x8 of the 16x16 view box). Preserve
   the transparent rectangular mask cutout behind the entire quadrant, with
   padding, so no document path shows through or touches the overlay.
6. Keep all icon surfaces synchronized:
   - The preview popup toggles between `expand-docs` and `collapse-docs`.
   - The editor toolbar uses `expand-all-docs` and `collapse-all-docs`.
   - Closing an active diff uses `close-diff`.
   - Go to source uses the unmodified built-in `go-to-file` path.
7. Generate `currentColor` SVGs only for the popup, where CSS masks apply the
   active theme foreground. VS Code renders contributed toolbar file icons as
   CSS background images, so those icons require separate light and dark files
   with explicit colors; do not generate unused unthemed copies of them.

## Validation

- Confirm the update command completed successfully.
- Confirm the generated SVGs contain the expected source paths and overlays.
- Run the extension tests that cover command contributions and preview actions.
