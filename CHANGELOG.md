# Change Log

## 0.4.0 (2026-09-11)

### Added

- *(preview)* Unify review action icons (#27)
- *(githubClient)* Implement GitHub client for repository interactions
- *(github-proxy)* Implement GitHub proxy server for repository access
- *(pullRequestReview)* Implement pull request review controller (#31)
- *(pullRequest)* Enhance pull request comment handling and metadata (#32)
- *(highlight)* Implement syntax highlighting for supported languages (#34)
- *(pullRequest)* Adjust command group priorities for navigation (#33)
- *(logging)* Replace output channel with logger for improved logging (#35)

### Changed

- *(scripts)* Launch vscode-test-web with node (#24)

### Fixed

- *(markdownPreview)* Keep preview popup horizontally fixed (#22)
- *(tests)* Make test fixtures more realistic (#25)

## 0.3.0 (2026-09-09)

### Added

- *(icons)* Add script to update icons from external source
- *(codeLens)* Enhance code lens provider with tooltips
- *(commentPatch)* Implement preview line mapping
- *(lineMetadata)* Create metadata for review lines
- *(markdownPreview)* Render preview metadata in HTML
- *(changelog)* Add automated changelog update script and configuration
- Add API preview diff baselines and navigation (#20)

### Changed

- *(markdownPreview)* Match preview theme and layout (#19)
- *(plans)* Record implemented feature plans (#18)

### Fixed

- *(reviewModel)* Return comments patch in preview snapshot
- *(markdownPreview)* Match preview theme and layout (#19)

### Other

- Update dependencies (#17)

## 0.2.0 (2026-09-06)

### Added

- *(markdownPreview)* Implement custom Markdown preview with comments support (#10)

### Changed

- *(codeLens)* Update documentation command icon to file-text (#11)

## 0.1.0 (2026-09-04)

### Added

- Enhance file discovery and review model (#1)
- Enhance file discovery and review model
- Add playwright as a dependency in package.json and pnpm-lock.yaml
- *(package)* Rename extension to azure-api-review and update metadata (#6)

### Changed

- *(copilot)* Add conventional commit instructions (#5)
- *(copilot)* Add conventional commit instructions
- *(copilot)* Rename commit instructions and fix link

### Fixed

- Correct YAML syntax for branch specification in CI workflow
- Update CI timeout and modify test script to run headless
- *(sourceMap)* Override source root with repository URI (#8)

### Other

- Add copilot-setup-steps workflow sharing CI caches (#4)
