# Contributing to Azure API Review

This extension is intended for Azure SDK API review workflows. Contributions
should preserve support for VS Code for the Web, local desktop windows, and
remote workspaces.

## Prerequisites

Install the following tools:

- [Visual Studio Code](https://code.visualstudio.com/Download) 1.136 or newer.
- [Node.js](https://nodejs.org/en/download) 22.
- [pnpm](https://pnpm.io/installation) 11.20.0.
- [Git](https://git-scm.com/downloads).

You can install the repository's pnpm version through Corepack instead of a
global pnpm installation:

```sh
corepack enable
corepack prepare pnpm@11.20.0 --activate
```

## Install Dependencies

Clone the repository, open it in VS Code, and install packages from the
repository root:

```sh
pnpm install --frozen-lockfile
code .
```

The committed `pnpm-workspace.yaml` allows the Playwright Chromium package's
install script and defines repository-wide dependency policy. Do not replace it
with user-specific settings.

## Install Chromium Requirements

The web extension tests run in Chromium. Install the browser and its required
Linux system libraries with:

```sh
pnpm exec playwright install --with-deps chromium
```

The `--with-deps` option uses the operating system package manager and may
prompt for administrator privileges. If you cannot elevate privileges, ask an
administrator to install the listed packages, then run:

```sh
pnpm exec playwright install chromium
```

On macOS and Windows, the browser installation normally requires only:

```sh
pnpm exec playwright install chromium
```

See the [Playwright browser installation documentation](https://playwright.dev/docs/browsers#install-browsers)
for platform-specific details.

## Build and Test

Run the same checks used by continuous integration:

```sh
pnpm run lint
pnpm run package-vsix
pnpm test
```

`pnpm test` compiles the extension before launching the VS Code web extension
tests in Chromium. Tests are under `src/web/test/suite` and are discovered by
the webpack test entry.

For a faster browser development loop, run the **watch-web** build task or:

```sh
pnpm run watch-web
```

To open the extension in a browser-hosted VS Code instance:

```sh
pnpm run run-in-browser
```

## Build a VSIX

Build an installable VSIX package for local testing:

```sh
pnpm run package-vsix
```

The command runs the standard `vscode:prepublish` lifecycle, builds the Node.js
and web-worker extension bundles, and creates `api-review-<version>.vsix` in
the repository root. VSIX files are ignored by Git.

Install the generated package from the command line:

```sh
code --install-extension api-review-0.0.1.vsix
```

Alternatively, run **Extensions: Install from VSIX...** from the VS Code
Command Palette and select the generated file. Reload VS Code after installing
or replacing the extension.

## Debug in VS Code

Open the Run and Debug view and select one of the checked-in launch
configurations:

- **Run Extension** builds and launches the extension in the desktop Node.js
  extension host.
- **Run Web Extension** builds and launches the extension in a web extension
  host.
- **Extension Tests** builds and runs the browser test suite under the debugger.

Set breakpoints in `src/web` before starting the selected configuration. Both
hosts run bundles built from the same browser-safe source entry point.

## Implementation Constraints

- Keep a single browser-safe source entry point with Node.js and web-worker
  bundles.
- Use VS Code workspace APIs for file access. Do not use Node.js file-system or
  path APIs.
- Test URI-based behavior with virtual schemes and multi-root workspaces where
  practical.
- Keep rich documentation in VS Code's native Markdown hover. Do not introduce
  a webview for the existing CodeLens workflow.

See [AGENTS.md](AGENTS.md) for the concise architecture and repository
conventions reference.

## Submit Changes

Before opening a pull request, ensure all build and test commands above pass.
Describe user-visible behavior changes and include focused tests for parser,
discovery, or navigation changes.
