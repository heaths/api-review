---
name: update-changelog
description: Use when asked to update or regenerate CHANGELOG.md from the repository history. Runs the repo's manual changelog updater command.
---

# Update changelog

## Steps

1. Run `pnpm run update-changelog` from the repository root.
2. Review the resulting diff in [CHANGELOG.md](../../CHANGELOG.md).
3. If the user asked for additional changelog edits beyond regeneration, apply those after the command finishes.

## Validation

- Confirm the command completed successfully.
- Confirm only the intended changelog changes were made.
