---
description: Required rules for writing commit messages and pull request titles and descriptions in this repository. Apply whenever generating, editing, or reviewing a commit message, a pull request title, or a pull request description.
---

# Commit and pull request instructions

Write commit messages and pull request titles as [Conventional Commits](https://git-cliff.org/docs/configuration/git#conventional_commits):

```text
<type>(<optional scope>): <description>

<optional body>

<optional footer>
```

## Subject line

- Use one of these types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`,
  `build`, `ci`, `chore`, `style`, or `revert`.
- Add a scope in parentheses when one area clearly dominates the change, for
  example `feat(codeLens)`, `fix(sourceMap)`, or `ci(workflows)`. Omit the scope
  when the change spans several areas. Never invent a scope.
- Prefer a scope that matches the changed source module, extension setting, or
  workflow directory.
- Write the description in lowercase imperative mood: "add", not "adds" or
  "added". No trailing period. Keep the whole line at or under 72 characters.
- Mark a breaking change with `!` before the colon, for example `feat(api)!:`,
  and add a `BREAKING CHANGE: <what breaks and how to migrate>` footer.

## Body and pull request description

- Explain what changed and why. Do not restate the diff line by line.
- Wrap body text at 72 characters and separate paragraphs with a blank line.
- Use `-` bullets for multiple independent changes.
- Reference issues in a footer, for example `Fixes #123`, when the change
  resolves one. Do not fabricate issue numbers.
- Omit the body when the subject line fully describes the change.

## Pull requests

- The pull request title is the commit subject line and must follow the same
  format, because pull requests are squash-merged into a single commit.
- The pull request description is the commit body: a short summary paragraph,
  optional bullets for notable changes, and any footers.
- Note user-visible behavior changes, new or renamed settings, and required
  follow-up work.
