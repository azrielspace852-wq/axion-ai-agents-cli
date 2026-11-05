# AXION AI Agents CLI — Version 1.1.0 Audit & Validation

## Scope

This release adds the requested command set, terminal UX, access policy, memory editing, system-prompt behavior, automatic task-planning guidance, custom-model management, and per-request tool-call ceilings.

## Implemented changes

1. **`/feedback`** prints `axionneuralis@gmail.com`, `azrielspace852@gmail.com`, and the repository Issues URL.
2. **Terminal chat UX** enters the ANSI alternate full-screen buffer and clears it on startup, restores the terminal on exit, shows an animated thinking spinner, and draws a rounded input frame at the bottom terminal rows. Tool names/arguments are shown before execution; likely credential-bearing fields and command tokens are redacted in the display.
3. **`/acces` / `/access`** selects workspace-policy or global scope. Shell working directories are checked against the workspace's real path in workspace mode, including symlink resolution.
4. **Arrow navigation** uses ArrowUp/ArrowDown and Enter in TTY selection menus. Non-TTY environments retain numeric selection fallback.
5. **First-run help** is shown once for a newly created configuration and then persisted as completed.
6. **Shell permission** defaults to enabled for fresh configurations. Existing configurations with an explicit `shellExec: false` retain that opt-out.
7. **Memory** can be added, edited, renamed, deleted by entry/topic, or cleared. Edited content and topic names persist atomically through the memory store.
8. **System prompt** is now stored as `systemPrompt`; legacy `instructions` configuration is migrated on load and `/instructions` remains a compatibility command alias. The base prompt adds a workspace inventory, evidence and anti-hallucination rules, action verification, execution transparency, and complex-task checklist guidance.
9. **Complex task planning** is explicitly instructed in the system prompt: create a Markdown checklist for long or multi-step requests and maintain completion state as the work progresses.
10. **Custom models** support edit/delete operations for custom entries only, including display name, provider model basename/ID, provider, and optional model-specific OpenAI-compatible base URL. Built-in models are never offered for deletion.
11. **Tool call limit** is persisted as `maxToolCallsPerRequest`, defaults to 30, is configurable through `/tool-limit`, is clamped to 1–100, and is enforced across all tool calls in one user request.

## Local validation

- TypeScript compile: **passed** with the available global TypeScript compiler and temporary offline declaration shims.
- Core regression suite: **21 passed, 0 failed**.
- `bash -n install.sh`: **passed**.
- Package metadata and CLI version consistency: **passed** (`1.1.0`).
- Installer staging/rollback regression: **passed** within the existing installer test harness.
- Pseudo-TTY integration checks: **passed** for first-launch help, ArrowUp/ArrowDown/Enter menu selection, feedback output, rounded bottom input frame, alternate-screen entry/restore, and animated spinner frames.
- Tool-call ceiling integration: **passed**; with a test limit of 2, exactly two shell commands ran and the third received a tool-limit error result.
- Workspace working-directory guard: **passed**, including a symlink that resolves outside the workspace.

## Verification limits

- `npm install --no-audit --no-fund` timed out because the package registry was unreachable from this environment. The environment did not contain the declared project dependencies. To perform local validation, temporary `axios`, `chalk`, and `cheerio` shims plus an available Node type package were used only in the working directory. These test shims are excluded from the release ZIP. As a result, this is not a clean install using the exact pinned dependency versions (`axios@1.7.2`, `chalk@4.1.2`, `cheerio@1.0.0`, TypeScript 5.4.5, and `@types/node@20.14.0`).
- No live Google AI Studio or OpenAI-compatible API request was possible. Provider behavior remains dependent on valid credentials, model access, and service availability.
- Pseudo-TTY checks ran on a Linux terminal emulation, not a physical Android/Termux device. The input frame anchors to the terminal's last rows on every prompt, which is the correct terminal-level placement above Termux's available keyboard area when the terminal viewport reflects the keyboard. Exact device-specific keyboard/window behavior still requires a Termux device test.
- **Workspace scope is not an OS sandbox.** It restricts the shell tool's requested working directory and guides the agent not to operate outside the workspace, but arbitrary shell commands still execute with the current OS user's permissions and can address external paths. Enforcing a hard filesystem boundary requires an OS/container sandbox (for example, a supported sandbox runtime), which is not bundled or assumed here.
- Shell execution is enabled by default for fresh configurations as requested. It executes with the current user's OS privileges; users who do not accept that risk should disable `shellExec` using `/permissions`.

## Release contents

The archive contains source, tests, documentation, installer, GPL license, and compiled `dist` output. It excludes `node_modules`, temporary test shims, and npm cache data.
