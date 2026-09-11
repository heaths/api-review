# Azure API Review

Azure API Review is a VS Code extension for Azure SDK API reviewers. It adds
review actions to generated API Markdown files while keeping the standard
Markdown text editor unchanged.

The extension runs in VS Code for the Web, local desktop windows, and remote
workspaces using VS Code's virtual workspace file system.

## Review APIs

Open a configured API Markdown file. For declarations with review metadata,
CodeLens actions appear above the declaration:

- **Documentation** opens the extracted doc comments in a peek widget, like the
  built-in peek actions. VS Code renders the widget inline below the declaration,
  so it never obscures the CodeLens, and provides scrolling for long content.
  Press `Escape` to close it.
- **Go to source** opens the original source file and selects the mapped
  location.

Actions are omitted when the corresponding comment patch or source mapping is
missing or does not map unambiguously to the declaration.

[![Watch the Azure API Review demo](https://img.youtube.com/vi/U9ZKXLJRsUY/hqdefault.jpg)](https://youtu.be/4nPBg77Goyg)

### Custom Markdown Preview

Use **Reopen Editor With** > **Azure API Review** to render an API Markdown file
with its configured comments patch applied in memory. Comments are hidden by
default; use the expand-all and collapse-all actions in the editor title to show
or hide all comments. The preview can also show a diff against a Git tag,
commit, pull request base, or another selected Markdown file, and while a diff
is active the title bar adds next/previous hunk navigation plus a close action.
The source Markdown file is never modified.

In Node.js extension hosts, tags, commits, and baseline content come from the
built-in Git extension so local and unpublished history remains available. In
web hosts, GitHub-backed documents use GitHub APIs for published tags, commits,
pull request bases, and baseline content. Other documents can still be compared
against another selected Markdown file.

The custom preview applies CSS contributed by installed extensions through
`markdown.previewStyles`. It does not load contributed preview scripts,
Markdown-it plugins, or styles from the `markdown.styles` setting.

Syntax highlighting in the extension is intentionally limited to C#, C++, Go,
Java, JavaScript, Python, Rust, and TypeScript, as well as Bash/Shell and JSON.
Other fenced-code languages render as plain code without language-specific highlighting.

The standard Markdown editor remains available and continues to provide the
Documentation and Go to source CodeLens actions described above.

## Configure Repositories

The defaults support repositories that generate `api/API.md` together with
adjacent patch and source-map files:

```json
{
  "heaths.azureApiReview.files.include": [
    "**/api/API.md"
  ],
  "heaths.azureApiReview.files.comments": [
    "API.comments.diff",
    "API.comments.patch"
  ],
  "heaths.azureApiReview.files.sourceMaps": [
    "API.md.map"
  ],
  "heaths.azureApiReview.git.tags": [
    "^[\\w-]+@(?<version>.+)$"
  ]
}
```

Configure these settings at workspace or workspace-folder scope:

- `heaths.azureApiReview.files.include` contains workspace-relative API Markdown
  glob patterns. It supports `${workspaceFolder}` and
  `${workspaceFolder:<name>}`.
- `heaths.azureApiReview.files.comments` contains ordered glob candidates relative
  to each matched API file. The first existing file is used.
- `heaths.azureApiReview.files.sourceMaps` follows the same ordered, relative lookup
  rules for source maps.
- `heaths.azureApiReview.git.tags` contains ordered regular expressions used to
  extract a version from tag names for diff history. Use named capture
  `version` or capture group 1. For example,
  `^[\\w-]+@(?<version>.+)$` maps `azure_security_keyvault_keys@1.1.0-beta.1`
  to `1.1.0-beta.1`.

Related-file patterns support file-context variables such as `${file}`,
`${relativeFile}`, `${fileBasename}`, `${fileBasenameNoExtension}`,
`${fileDirname}`, and `${workspaceFolder}`. Environment, command, input,
selection, and configuration variables are intentionally unsupported so path
resolution remains deterministic in web and virtual workspaces.

To open configured API files in the custom preview by default, add a matching
editor association to the repository's `.vscode/settings.json`. Keep the glob in
sync with `heaths.azureApiReview.files.include`:

```json
{
  "heaths.azureApiReview.files.include": [
    "**/api/API.md"
  ],
  "workbench.editorAssociations": {
    "**/api/API.md": "heaths.azureApiReview.preview"
  }
}
```

Repositories can replace both occurrences with their own API Markdown pattern.

### Additional Configuration

Edits to API review files like `API.md` can disable code lenses.
To mitigate possible changes to review files, you should consider configuring
your workspace's `.vscode/settings.json` to treat default or custom review files
as read-only:

```json
{
  "files.readonlyInclude": {
    "**/API.md": true,
    "**/API.comments.diff": true,
    "**/API.comments.patch": true,
    "**/API.md.map": true
  }
}
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and
debugging instructions.
