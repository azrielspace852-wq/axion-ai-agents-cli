# AXION AI CLI — Final npmjs Release Audit

## Release identity

This is a publication-ready project package; npm publication itself is pending an authorized npm publisher.

- npm package: `@axion-neuralis/axion-ai-cli`
- Public release version: `1.0.0`
- Author metadata: `axion`
- Canonical CLI command: `axion-ai-cli`
- Compatibility aliases: `axion-cli`, `axn-cli`
- Registry: `https://registry.npmjs.org/`
- npm publication access: `public` (configured in `publishConfig`)

## Publication and update flow

- Package installation resolves through npmjs using `npm install -g @axion-neuralis/axion-ai-cli`.
- Project-local installation is documented as `npm install @axion-neuralis/axion-ai-cli` and `npx axion-ai-cli`.
- The runtime update checker requests `https://registry.npmjs.org/@axion-neuralis%2Faxion-ai-cli/latest` and validates the returned package name before accepting its version.
- The `update` command installs `@latest` through npmjs; it no longer downloads or executes a remote shell script.
- `install.sh` is an optional npmjs bootstrapper and does not clone GitHub or rebuild source.
- Lockfile tarball URLs use `https://registry.npmjs.org/`.

## Version synchronization

The current release version is `1.0.0` in `package.json`, `package-lock.json`, `version.json`, `version-info.json`, `update-info.json`, `src/banner.ts`, and generated `dist/` files.

## Validation results

- [x] JSON metadata parses and `package.json` / `package-lock.json` identity and version match.
- [x] Active project metadata/runtime/docs no longer use the former internal release value; the release target is `1.0.0`.
- [x] Lockfile package tarball URLs use `https://registry.npmjs.org/` (GitHub links in the lockfile are funding metadata only).
- [x] `bash -n install.sh` succeeds.
- [x] TypeScript build succeeds and regenerates the `dist/` entry point and matching version manifests.
- [x] Core regression suite: **32 passed, 0 failed**.
- [x] CLI smoke tests: `--version`, `--help`, `update --info` fallback path, and `update` dry-run.
- [x] Installer integration test confirms delegation to the official npm registry.
- [x] `npm pack --dry-run --json --ignore-scripts` reports `@axion-neuralis/axion-ai-cli@1.0.0`, 32 package entries, and the expected runtime/docs files.

## Validation limitations

- A clean `npm ci --no-audit --no-fund --registry=https://registry.npmjs.org/` attempt timed out in this environment. Therefore the pinned dependency set was not installed from npmjs here.
- To complete local compilation and tests despite that registry timeout, validation-only type declarations and runtime shims were created in the temporary workspace for Axios, Chalk, Cheerio, and Node types. The shims were removed from the release archive; tests that exercise provider networking use mocked Axios responses. The test result is therefore a local regression result, not evidence of a clean install with every exact pinned dependency version.
- The registry lookup could not be confirmed live from this environment. `update --info` used its bundled metadata fallback during the smoke test. The code is configured to query npmjs at runtime when network access is available.
- No real model-provider request was made. Provider behavior still requires valid API credentials and network access.

## Publication limitation

Preparing this project does not publish it. Actual `npm publish --access public` must be run by an npm account authorized to publish under the `@axion-neuralis` scope, with any required npm authentication/2FA. The archive must not be described as published until npmjs confirms the release.
