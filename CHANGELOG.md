# Changelog

## 1.3.0
- Verified the terminal UI rendering path end-to-end under a pseudo-TTY (`script`) with a mocked OpenAI-compatible provider: a single persistent input prompt is reused, AI replies print above the next prompt, the thinking spinner appears and is cleared, `/thinking` select menu renders and is erased after selection, no stacked "AXION INPUT" frames, no leftover menu text.
- Added direct terminal commands: `--help` (full listing of terminal + in-chat commands), `--feedback` (show support contacts then enter chat), `update --info` (show installed vs latest version + release notes without updating). `update` and `--version` retained. `AXION_UPDATE_DRY_RUN=1` still prints the exact curl|bash command without executing.
- `install.sh` now explicitly preserves user data (`~/.axn-cli`: config incl. API keys, conversations, memory), refuses if the data dir is inside the app dir, uninstalls the old application directory after backing it up (user data never touched), and recreates both `axion-cli` and `axn-cli` symlinks.
- Added `AXION_NO_AUTOCOMPLETE=1` env switch to disable the inline `/` command-suggestion popup (for scripting/TTY tests).
- Refreshed documentation: README (terminal + in-chat command tables, update flow, removed alt-screen references), `/help` i18n (en + id) now covers `/max-tool-call`, `/max-token`, `/privacy-policy`.
- Added regression tests for terminal command routing (`--help`, `update --info`, `update` dry-run, `--feedback`). 25 tests total.
- Bumped version to 1.3.0 (package.json, banner.ts, version.json, update-info.json).

## 1.2.0
- Fixed Gemma 4 thinking loop: selecting thinking `off` now omits `thinkingConfig` entirely (previously sent `{thinkingLevel:'MINIMAL'}`, which does not disable thinking). Regression test updated accordingly.
- Reworked the terminal UI: dropped the full-screen alt-screen mode and absolute-positioned input frame so AI replies scroll naturally above a persistent input prompt (fixes replies being overwritten by the input box). A single persistent readline interface is reused (one `line` event), instead of recursive `question()` calls that created a new input box each turn.
- Fixed `select()` menus: after a choice, the whole menu block is erased (cursor up + `\x1b[J`), raw mode / keypress listeners are restored, and any input accumulated in the readline buffer while the menu was open is discarded. Echo is suppressed during menus. This restores model edit and delete flows end-to-end.
- Added inline command suggestions: typing `/` at the start of a line (TTY only) opens a popup of matching commands; ArrowUp/ArrowDown navigate, Enter fills the highlighted command into the line, deleting `/` or pressing Esc closes it. Non-TTY sessions are unaffected.
- Conversation writes are buffered in memory per session and flushed at session boundaries (exit, SIGINT, new conversation, open conversation, `/clear`, and before list/backup/delete in `/conversation`). The `appendMessage()` API is unchanged and still writes immediately (tests rely on it).
- Added `dist/version.json` (read by `--version` with fallback to the compiled-in constant) and `dist/update-info.json` (best-effort remote check with local fallback; never blocks startup).
- Added `axn-cli update` (and `axion-cli update`) fast-update: runs `curl -fsSL https://raw.githubusercontent.com/azrielspace852-wq/axion-ai-agents-cli/main/install.sh | bash` with stdio inherit. Clear error if curl is missing. `AXION_UPDATE_DRY_RUN=1` prints the command without executing.
- Added `/privacy-policy` with honest, complete security & privacy information (local storage in `~/.axn-cli` with 0600 files, what is sent to providers, no AXION telemetry, shell tool runs with user privileges, update runs a remote script, no end-to-end encryption, how to delete data).
- Added `/max-tool-call` as an alias for `/tool-limit` (default 30 per request, persisted).
- Added `/max-token` to set optional `maxInputTokens` (honest char/4 estimate, oldest non-system messages trimmed first, limitation printed) and `maxOutputTokens` (forwarded to the provider), both persisted in config.
- `/models` now lists only models belonging to the active provider.
- Added the `axn-cli` binary alias alongside `axion-cli` in `package.json` `bin` and as a symlink in `install.sh`.
- Bumped version to 1.2.0 in package.json, banner.ts, version.json, and update-info.json.

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
