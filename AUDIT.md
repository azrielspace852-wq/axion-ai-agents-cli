# AXION AI Agents CLI — Audit and Validation Report

## Scope

The supplied project archive was reviewed across its installer, package metadata, TypeScript source, command handlers, providers, tools, configuration, persistence, and documentation. The project was updated to version `1.0.2` in this working copy.

## Issues identified and addressed

- The README was empty and the GPL license text was incomplete. A GitHub-ready README and the complete GPL-3.0-or-later license text are now included; the README begins with the license badge.
- The old installer removed the active application directory before the replacement had been built. The updated installer stages the source, installs dependencies, runs the project test suite and CLI smoke test, then activates the new directory while retaining the previous installation as a backup.
- Installer path handling did not sufficiently guard dangerous targets and did not consistently report the application and user-data locations. The updated installer validates the target and reports the separate paths.
- Configuration and storage writes could leave incomplete JSON after interruption. Configuration, conversation, and memory writes now use temporary files and atomic rename; local data directories/files use restrictive permissions where supported.
- Corrupt configuration files could prevent reliable startup. The loader now preserves a damaged copy and falls back to safe defaults.
- Conversation and memory identifiers were not sufficiently constrained. Storage now validates IDs and document structures before reading, deleting, or writing.
- API-key prompts could echo secrets into the terminal. Secret prompts now suppress typed input; stored keys remain plaintext on disk, protected by local filesystem permissions rather than encryption.
- Google model reasoning settings were not aligned with the current API fields. Gemini 3 now uses `thinkingLevel`, Gemini 2.5 uses `thinkingBudget`, Gemma 4 uses its documented binary `MINIMAL`/`HIGH` switch, and Gemini 3 sampling overrides are omitted. The CLI explains when a model cannot fully disable thinking.
- Gemini tool-calling history discarded opaque thought-signature parts and provider call IDs. These are now preserved in active and saved conversation history. Parallel function responses are grouped and kept in call order.
- Web fetching did not sufficiently restrict local/private destinations. The scraper now limits requests to HTTP(S), rejects local and reserved destinations, validates every redirect, pins validated DNS answers to the connection, disables implicit proxy routing for the fetch, and limits response size and redirects.
- Shell execution and search input handling needed stronger validation. Shell execution remains disabled by default, validates the working directory, and has bounded execution/output. Search result counts are capped and HTTP error responses are checked.
- There was no automated regression suite. Core storage, configuration, tool registry, network validation, Gemini request construction, CLI startup, and installer upgrade safety tests were added.

## Validation performed

| Check | Result |
|---|---|
| TypeScript compile (`tsc -p tsconfig.json`) | Passed with TypeScript 5.8.3 and temporary declarations for unavailable external modules; the pinned TypeScript 5.4.5 install could not be fetched |
| Automated tests (`npm test`) | 11 passed, 0 failed in the offline validation harness |
| Installer shell syntax (`bash -n install.sh`) | Passed |
| Installer staging/upgrade simulation | Passed using temporary fake `npm`/`node` commands |
| Failed-build protection simulation | Passed; existing application directory remained untouched |
| CLI version smoke test | Passed (`1.0.2`) |
| Exact remote `curl | bash` command | Not verified; DNS resolution to `raw.githubusercontent.com` failed from this environment |
| Real dependency installation from npm | Not verified; npm registry access was unavailable |
| Live Google AI Studio / OpenAI-compatible calls | Not verified; no API credentials were supplied |
| Live Google/DuckDuckGo search and website scraping | Not verified; external network access was unavailable |
| Physical Termux-device installation | Not verified; validation used a Unix-like container simulation |

### Offline-test limitation

The container could not reach the GitHub raw host or npm registry. To compile and run the local regression suite without fetching dependencies, temporary compile/runtime shims for external modules were used in the working environment. Those shims and generated `node_modules`/`dist` directories are excluded from the ZIP. The test suite mocks HTTP-provider responses; it does not establish that real third-party services accept credentials or return successful responses.

No `package-lock.json` was generated because the npm registry was unreachable. Direct dependency versions are pinned exactly in `package.json`, but transitive dependency resolution is not yet locked. Generate and commit a lockfile in an environment with npm registry access before treating the dependency graph as fully reproducible.

## Remaining product limitations

- General-purpose file read/write tools are not implemented in this release. They are not presented as active permission toggles.
- The web-search tool parses public search-engine HTML rather than using an official Google Search API; search engines can rate-limit requests or change markup.
- API credentials are stored as plaintext in the local configuration file. Filesystem permissions reduce casual local exposure but are not encryption.
- Enabling `shellExec` permits the agent to execute commands with the current operating-system user's privileges. It remains disabled by default.
- The `/thinking off` choice cannot disable reasoning on every provider/model. In particular, Gemini 3 and Gemini 2.5 Pro use the provider default because the API does not expose a full off mode for those models.

## GitHub deployment requirement

This ZIP updates only the supplied local project copy. It does not push changes to the GitHub repository. The one-line installer URL points to the repository's `main` branch; the updated source, especially `install.sh`, must be committed/published to that branch before the exact `curl -fsSL .../main/install.sh | bash` command can install this repaired version. The remote script could not be updated or executed from this environment.


## Follow-up build fix (1.0.2)

The subsequent Termux install log exposed a compiler failure in four files importing `uuid@9.0.1`. The package release metadata does not declare a TypeScript declaration entry, so the compiler reported TS7016. The project now uses `randomUUID` from `node:crypto` in `GoogleAIProvider`, `OpenAICompatProvider`, `ConversationStore`, and `MemoryStore`; the `uuid` dependency was removed from `package.json`. Regression checks assert that generated provider tool-call IDs, conversation IDs, and memory IDs remain valid UUID v4 values. The updated offline harness passed 11 tests. This update does not depend on adding a stub declaration or an external `@types/uuid` package.
