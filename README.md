[![License: GPL v3 or later](https://img.shields.io/badge/License-GPLv3%2B-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.17-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Termux%20%7C%20Linux%20%7C%20macOS-informational)](#requirements)

# AXION AI Agents CLI

A terminal-based AI agent by **AXION Neuralis**. AXION provides an interactive command-line interface, model-provider integration, tool calling, web search, page extraction, conversation history, and local long-term memory.

> AXION is an API-backed CLI application. You must provide credentials for the selected model provider before chatting.

## Features

- **Interactive terminal REPL** with slash commands and English/Indonesian interface text.
- **Google AI Studio / Gemini API** provider using the Gemini `generateContent` endpoint.
- **OpenAI-compatible** chat-completions provider for compatible API services.
- **Tool calling** through a controlled registry: web search, page extraction, and optional local shell execution.
- **Conversation storage** with open, delete, and JSON backup operations.
- **Local long-term memory** that can be added, summarized, listed, and removed.
- **Permission controls**. Shell execution is disabled by default.
- Designed for **Termux and Unix-like environments** with Node.js 18.17 or newer.

## Requirements

- Node.js **18.17.0 or newer**.
- npm (normally bundled with Node.js).
- A Google AI Studio API key or credentials for an OpenAI-compatible provider.
- Internet access for package installation and remote model/search/page requests.

On Termux, install Node.js with:

```sh
pkg update
pkg install nodejs
```

## Installation

### One-line installer

```sh
curl -fsSL https://raw.githubusercontent.com/azrielspace852-wq/axion-ai-agents-cli/main/install.sh | bash
```

The installer downloads the `main` branch, installs dependencies in a staging directory, builds the TypeScript application, runs the regression suite and a CLI version smoke test, and only then activates the new application directory. When replacing an existing installation, the previous application directory is retained as a backup instead of being deleted automatically.

By default, the application is installed at `~/.axion/app`. The command is linked into a writable command directory (Termux `$PREFIX/bin` when available, otherwise `~/.local/bin` or `/usr/local/bin`). Add that directory to your `PATH` if the installer reports that it is missing.

To choose a different application directory:

```sh
AXION_INSTALL_DIR="$HOME/apps/axion-ai-agents-cli" \
  bash <(curl -fsSL https://raw.githubusercontent.com/azrielspace852-wq/axion-ai-agents-cli/main/install.sh)
```

### Manual installation

```sh
git clone https://github.com/azrielspace852-wq/axion-ai-agents-cli.git
cd axion-ai-agents-cli
npm install
npm run build
node dist/index.js
```

## First run

Start the application:

```sh
axion-cli
```

Set an API key from the interactive prompt:

```text
/api-key
```

The API key is requested without terminal echo and saved in the local configuration file. The configuration file is stored as a local plaintext file protected by restrictive filesystem permissions; it is not encrypted. Protect access to your operating-system account and backups.

To select another provider, use `/provider`. For an OpenAI-compatible provider, enter its base URL (for example, `https://api.openai.com/v1`) and API key. The provider must implement the OpenAI Chat Completions API and tool-calling format used by this CLI.

## Commands

| Command | Description |
|---|---|
| `/help` | Show available commands. |
| `/models` | List and select built-in models or add a custom model ID. |
| `/provider` | Switch between Google AI Studio and OpenAI-compatible providers. |
| `/api-key` | Set or update the active provider's API key. |
| `/thinking` | Configure the requested reasoning level. Actual support depends on the selected model. |
| `/instructions` | Set or clear custom system instructions. |
| `/memory` | List, add, delete, or clear long-term memory. |
| `/permissions` | Enable or disable agent tools and local access permissions. |
| `/conversation` | Open, delete, back up, or create a conversation. |
| `/language` | Switch the interface language between English and Indonesian. |
| `/clear` | Clear the screen and current in-memory chat context. Saved history remains on disk. |
| `/exit` | Exit the application. |

## Tools and permissions

| Tool | Purpose | Permission |
|---|---|---|
| `google_search` | Search the web using Google with DuckDuckGo fallback. | `searchAccess` |
| `web_scrape` | Retrieve readable text from an HTTP(S) web page. | `webAccess` |
| `run_shell` | Run a command in the local operating-system shell. | `shellExec` |

`run_shell` is **disabled by default**. Enabling it allows the agent to execute commands with the permissions of the current operating-system user. Only enable it when you understand and accept that risk. Web search and page retrieval also send requests to external services and websites.

General-purpose file read/write tools are not implemented in this release and are not exposed as active permission toggles.

## Model selection

The built-in Google model list includes the following model IDs:

- `gemma-4-31b-it`
- `gemma-4-26b-a4b-it`
- `gemini-3.8-flash`
- `gemini-3.5-flash`
- `gemini-3.5-flash-lite`
- `gemini-3.1-flash-lite`

Model availability and capabilities can vary by account, API access, lifecycle status, and provider. The model list is a convenience list, not a guarantee that every model is enabled for every API key. Custom model IDs can be added with `/models`.

For Gemini 3 models, AXION sends the documented `thinkingLevel` field when a reasoning level is selected and omits sampling parameters so the provider defaults are used. Gemma 4 has a binary thinking switch: `off` maps to `MINIMAL` and any enabled level maps to `HIGH`. Gemini 2.5 uses `thinkingBudget`. The `off` option sets a zero budget for Gemini 2.5 Flash / Flash-Lite; Gemini 2.5 Pro and Gemini 3 do not expose a full thinking-off setting through this API, so `off` leaves the provider default in effect for those models. OpenAI-compatible providers may ignore the thinking setting.

## Local data and configuration

By default, AXION stores settings, conversations, and memory under:

```text
~/.axn-cli/
├── config.json
├── conversations/
└── memory/
```

Set `AXION_DATA_DIR` before starting the CLI to use a different data directory. Application files and user data are stored separately. Updating or reinstalling the application does not intentionally remove the data directory.

The configuration file contains provider credentials and permission settings. It is stored locally as plaintext, with restrictive directory and file permissions where supported by the operating system. Do not share it publicly.

## Development and validation

```sh
npm install
npm run build
npm test
```

`npm test` builds the TypeScript project and runs the local Node.js test suite. The tests do not call model APIs or external search services. To validate an actual model request, configure a valid API key and test from an environment with network access.

## Troubleshooting

**`axion-cli: command not found`** — Add the installer's reported command directory to your `PATH`, then restart your shell or source the relevant profile.

**`No API key configured`** — Run `/api-key`, or switch provider with `/provider` and configure the matching key.

**HTTP 400 / model not found** — Check the model ID, account access, and whether that model supports the `generateContent` endpoint. Use `/models` to select another model or add a provider-supported custom ID.

**Search returns no results** — Search engines may rate-limit or change their HTML layout. Retry later; this feature does not use an official Google Search API.

**Build fails during installation** — Check that Node.js is 18.17 or newer, npm is available, and the package registry can be reached. The installer builds in a staging folder so an existing installation is not replaced when dependency installation or compilation fails.

## License

AXION AI Agents CLI is licensed under the **GNU General Public License v3.0 or later**. See [LICENSE](LICENSE) for the complete license text.

---

Developed by **AXION Neuralis**.
