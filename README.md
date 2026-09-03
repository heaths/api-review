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
