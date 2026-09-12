---
name: update-changelog
description: >-
  Use when asked to generate or regenerate CHANGELOG.md from the repository
  history. Runs the repo's changelog generation command.
---

# Update changelog

## Steps

1. Run `pnpm run generate:changelog` from the repository root.
2. Review the generated [CHANGELOG.md](../../CHANGELOG.md).
3. If the user asked for additional changelog edits beyond regeneration,
   apply those after the command finishes.

## Validation

- Confirm the command completed successfully.
- Confirm `CHANGELOG.md` was regenerated with the expected release heading.
