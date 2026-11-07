# Changelog

This file records the release package prepared for the first public npmjs publication. The archive itself does not mean that npm publication has already succeeded.

## 1.0.0 — Final npmjs Release (prepared for publication)

- Package identity prepared for publication: `@axion-neuralis/axion-ai-cli`.
- CLI command: `axion-ai-cli`; `axion-cli` and `axn-cli` remain compatibility aliases.
- Set the intended public package version and runtime version to `1.0.0`.
- Set package author metadata to `axion` and configure scoped package publication as public.
- Added npmjs registry metadata and package installation instructions.
- Updated the automatic version checker to read the latest package metadata from `https://registry.npmjs.org/@axion%2Faxion-ai-cli/latest`.
- Replaced the GitHub shell-script updater with `npm install --global @axion-neuralis/axion-ai-cli@latest`.
- Reworked `install.sh` as an npmjs bootstrapper; it no longer downloads source archives or runs a source-build installer.
- Synchronized `package.json`, `package-lock.json`, `version.json`, `version-info.json`, `update-info.json`, TypeScript source, generated `dist/`, tests, and documentation.
- Includes interactive chat, Google AI Studio and OpenAI-compatible providers, tool calling, web search and page extraction, conversation history, summarized long-term memory, configurable permissions, and persistent custom providers.

## Previous development history

The feature set was developed and tested iteratively before the first public npm release. The intended public npm version sequence starts at `1.0.0`; pre-publication iteration numbers are intentionally not represented as published package versions.
