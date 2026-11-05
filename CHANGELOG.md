# Changelog

## 1.1.0

- Added `/feedback` with both AXION support email addresses and the GitHub issue tracker.
- Added `/acces` (`/access` alias) for workspace-only or global agent access policy. Workspace scope also checks explicitly requested shell working directories; it is documented as an agent policy, not an OS sandbox.
- Added full-screen terminal mode, startup screen clearing, a rounded bottom input panel, and an animated thinking indicator in interactive TTY sessions. Non-TTY sessions retain plain prompt behavior.
- Added tool execution transparency: tool names and arguments are printed before execution, including the exact shell command.
- Added ArrowUp/ArrowDown/Enter selection menus, with numeric fallback for non-interactive terminals.
- Added automatic command help on the first launch of a fresh configuration.
- Enabled shell execution by default for fresh configurations while preserving an explicitly saved `shellExec: false` value from existing configurations.
- Expanded memory management with entry editing, topic renaming, entry deletion, topic deletion, and clear-all confirmation.
- Reworked `/system` as the system-prompt editor (`/instructions` remains a compatibility alias). Added workspace inventory context, anti-hallucination and verification rules, transparent-execution rules, and automatic checklist guidance for complex tasks.
- Added editable and deletable custom models, including display name, model basename, provider, and optional model-specific OpenAI-compatible base URL. Built-in models remain protected from deletion.
- Added a configurable tool-call ceiling through `/tool-limit`, defaulting to 30 calls per user request and bounded to 1–100.
- Added regression tests for configuration migration, memory editing, feedback output, system prompt context, workspace policy checks, and per-request tool-call enforcement.

## 1.0.2

- Fixed the Termux TypeScript build failure (`TS7016`) caused by importing `uuid@9.0.1`, which does not provide a TypeScript declaration entry for the compiler to resolve.
- Replaced UUID generation in both model providers and both storage modules with Node.js' built-in `crypto.randomUUID()` API. This produces UUID v4 identifiers and removes the external `uuid` dependency entirely.
- Added regression assertions that conversation and memory IDs retain the UUID v4 format.
- Bumped the CLI version to `1.0.2`.

## 1.0.1

- Reworked the installer to build and run regression tests in a staging directory, validate the CLI, refuse dangerous targets, and preserve the previous installation as a backup.
- Added a GitHub-ready README and included the complete GPL-3.0 license text.
- Added configuration normalization, corruption backup, atomic writes, and restrictive local file/directory permissions.
- Added safe ID validation and schema checks for conversation and memory storage.
- Added hidden terminal input for provider API keys.
- Preserved Gemini thought-signature parts and function-call IDs across saved conversations, and grouped parallel function responses according to the API protocol.
- Removed Gemini 3 sampling overrides and corrected Gemma 4, Gemini 3, and Gemini 2.5 model-specific thinking behavior.
- Aligned Gemini 3 reasoning configuration with `thinkingLevel`, kept Gemini 2.5 on `thinkingBudget`, and refreshed the built-in Gemini model list.
- Restricted page fetching to public HTTP(S) hosts, pinned validated DNS results to mitigate DNS rebinding, and revalidated redirects to block local/private network destinations.
- Bounded web search results, validated local shell working directories, and added core regression tests.
