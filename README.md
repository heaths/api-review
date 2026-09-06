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

[![Watch the Azure API Review demo](https://img.youtube.com/vi/U9ZKXLJRsUY/hqdefault.jpg)](https://youtu.be/U9ZKXLJRsUY)

### Custom Markdown Preview

Use **Reopen Editor With** > **Azure API Review** to render an API Markdown file
with its configured comments patch applied in memory. Comments are hidden by
default; use the expand-all and collapse-all actions in the editor title to show
or hide all comments. The preview is available for any Markdown file, and the
source Markdown file is never modified.

The custom preview applies CSS contributed by installed extensions through
`markdown.previewStyles`. It does not load contributed preview scripts,
Markdown-it plugins, or styles from the `markdown.styles` setting.

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
