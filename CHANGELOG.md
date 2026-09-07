# Change Log

## Unreleased

### Added

- *(icons)* Add script to update icons from external source
- *(codeLens)* Enhance code lens provider with tooltips
- *(commentPatch)* Implement preview line mapping
- *(lineMetadata)* Create metadata for review lines
- *(markdownPreview)* Render preview metadata in HTML

### Fixed

- *(reviewModel)* Return comments patch in preview snapshot

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
