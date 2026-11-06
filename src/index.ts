#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { spawnSync } from 'child_process';
import axios from 'axios';
import { ConfigManager } from './config/ConfigManager';
import { ConversationStore } from './storage/ConversationStore';
import { MemoryStore } from './storage/MemoryStore';
import { Agent } from './agent/Agent';
import { REPL } from './repl/REPL';
import { VERSION } from './banner';
import { handleFeedback } from './commands/handlers';

const UPDATE_URL = 'https://raw.githubusercontent.com/azrielspace852-wq/axion-ai-agents-cli/main/install.sh';
const REMOTE_UPDATE_INFO = 'https://raw.githubusercontent.com/azrielspace852-wq/axion-ai-agents-cli/main/update-info.json';

function readVersion(): string {
  try {
    const file = path.join(__dirname, 'version.json');
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string };
      if (parsed && typeof parsed.version === 'string' && parsed.version) return parsed.version;
    }
  } catch {
    // fall through to the compiled-in constant
  }
  return VERSION;
}

function readUpdateInfo(): { latestVersion?: string; releaseNotes?: string; publishedAt?: string; installUrl?: string } {
  try {
    const local = JSON.parse(fs.readFileSync(path.join(__dirname, 'update-info.json'), 'utf8'));
    if (local && typeof local === 'object') return local as Record<string, unknown> as { latestVersion?: string };
  } catch { /* ignore */ }
  return {};
}

function printFullHelp(): void {
  const v = readVersion();
  console.log(chalk.cyan.bold(`AXION AI Agents CLI v${v}`));
  console.log(chalk.dim('Terminal AI agent with workspace-aware tools, memory, and model management.'));
  console.log('');
  console.log(chalk.bold('Usage:'));
  console.log('  axion-cli [command] [options]');
  console.log('  axn-cli   (alias)');
  console.log('');
  console.log(chalk.bold('Terminal commands (run without entering chat):'));
  const termCmds: Array<[string, string]> = [
    ['(no args)', 'Enter interactive chat mode'],
    ['--help, -h', 'Show this help'],
    ['--version, -v', 'Print the installed version'],
    ['--feedback', 'Show feedback/support contact info, then enter chat'],
    ['update --info', 'Show latest version, release notes, and update instructions (does NOT update)'],
    ['update', 'Fast update: download and run install.sh via curl | bash'],
  ];
  for (const [cmd, desc] of termCmds) console.log(`  ${chalk.cyan(cmd.padEnd(16))} ${desc}`);
  console.log('');
  console.log(chalk.bold('In-chat commands (type inside the REPL):'));
  const inApp: Array<[string, string]> = [
    ['/help', 'Show in-chat command list'],
    ['/models', 'Select/add/edit/delete models (filtered by active provider)'],
    ['/thinking', 'Set reasoning level: off/low/medium/high/max'],
    ['/system', 'View/edit the additional system prompt'],
    ['/memory', 'Manage long-term memory'],
    ['/api-key', 'Set/update the provider API key'],
    ['/permissions', 'Toggle web/search/shell permissions'],
    ['/provider', 'Switch LLM provider (Google AI Studio / OpenAI-compatible)'],
    ['/tool-limit', 'Max tool calls per request (default 30)'],
    ['/max-tool-call', 'Alias for /tool-limit'],
    ['/max-token', 'Set input-token soft cap and output-token limit'],
    ['/privacy-policy', 'Show security & privacy information'],
    ['/access', 'Workspace-only or global access scope'],
    ['/clear', 'Clear screen and current context'],
    ['/conversation', 'List/open/delete/backup saved conversations'],
    ['/rename', 'Rename the current conversation'],
    ['/language', 'Switch interface language (en/id)'],
    ['/feedback', 'Show support contacts'],
    ['/exit', 'Exit the CLI'],
  ];
  for (const [cmd, desc] of inApp) console.log(`  ${chalk.cyan(cmd.padEnd(16))} ${desc}`);
  console.log('');
  console.log(chalk.dim(`User data: ~/.axn-cli  |  Application: ~/.axion/app  |  License: GPL-3.0`));
}

async function printUpdateInfo(current: string): Promise<void> {
  let info = readUpdateInfo();
  try {
    const res = await axios.get(REMOTE_UPDATE_INFO, { timeout: 5000, responseType: 'json' });
    if (res.data && typeof res.data === 'object' && res.data.latestVersion) {
      info = res.data as Record<string, unknown> as typeof info;
    }
  } catch {
    console.log(chalk.dim('(Remote update check failed; showing bundled local update-info.json.)'));
  }
  const latest = info.latestVersion || current;
  console.log(chalk.bold('AXION CLI — Update Information'));
  console.log(`  Installed version: ${current}`);
  console.log(`  Latest available:  ${latest}${latest !== current ? chalk.green(' (update available)') : chalk.dim(' (up to date)')}`);
  if (info.publishedAt) console.log(`  Published:         ${info.publishedAt}`);
  if (info.releaseNotes) {
    console.log(chalk.bold('  Release notes:'));
    console.log(`    ${info.releaseNotes}`);
  }
  console.log('');
  if (latest !== current) {
    console.log(chalk.cyan('  To update, run:  axion-cli update'));
    console.log(chalk.dim(`  (curl -fsSL ${UPDATE_URL} | bash)`));
  } else {
    console.log(chalk.dim('  You are on the latest version. Run `axion-cli update` to reinstall/repair.'));
  }
}

function runUpdate(): void {
  const curlCheck = spawnSync('curl', ['--version'], { stdio: 'ignore' });
  if (curlCheck.error || curlCheck.status !== 0) {
    console.error(chalk.red('curl is required to run the fast updater. Install curl, or install manually from: ' + UPDATE_URL));
    process.exit(1);
  }
  const cmd = `curl -fsSL ${UPDATE_URL} | bash`;
  if (process.env.AXION_UPDATE_DRY_RUN === '1') {
    console.log(`[dry-run] would execute: ${cmd}`);
    console.log(`[dry-run] URL: ${UPDATE_URL}`);
    process.exit(0);
  }
  console.log(chalk.cyan('Running fast update: ') + cmd);
  const result = spawnSync('bash', ['-c', cmd], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

async function checkForUpdate(current: string): Promise<void> {
  // Best-effort, non-blocking update check. Never throws or blocks startup.
  try {
    let latest: string | undefined;
    let notes: string | undefined;
    try {
      const res = await axios.get(REMOTE_UPDATE_INFO, { timeout: 4000, responseType: 'json' });
      const data = res.data as { latestVersion?: string; releaseNotes?: string };
      latest = data?.latestVersion;
      notes = data?.releaseNotes;
    } catch {
      try {
        const local = JSON.parse(fs.readFileSync(path.join(__dirname, 'update-info.json'), 'utf8')) as { latestVersion?: string; releaseNotes?: string };
        latest = local?.latestVersion;
        notes = local?.releaseNotes;
      } catch { /* no local info either */ }
    }
    if (latest && latest !== current) {
      console.log(chalk.yellow(`A new version (${latest}) is available. Run: axn-cli update`));
      if (notes) console.log(chalk.dim(`  ${notes}`));
    }
  } catch {
    // Intentionally silent: update checks must never break the REPL.
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg0 = argv[0];
  const arg1 = argv[1];

  if (arg0 === '--version' || arg0 === '-v') {
    console.log(readVersion());
    return;
  }
  if (arg0 === '--help' || arg0 === '-h') {
    printFullHelp();
    return;
  }
  if (arg0 === 'update') {
    if (arg1 === '--info') {
      await printUpdateInfo(readVersion());
      return;
    }
    runUpdate();
    return;
  }
  const currentVersion = readVersion();
  void checkForUpdate(currentVersion);
  const cfgMgr = new ConfigManager();
  const conversations = new ConversationStore();
  const memories = new MemoryStore();
  const notice = (m: string) => console.log(chalk.dim(m));
  const agent = new Agent(() => cfgMgr.get(), notice);

  if (arg0 === '--feedback') {
    // --feedback: show the feedback/support info immediately, then proceed into chat.
    const fakeCtx = { repl: { print: (m: string) => console.log(m) } };
    await handleFeedback(fakeCtx as never);
    console.log('');
  }

  const repl = new REPL(cfgMgr, conversations, memories, agent);
  await repl.start();
}

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Unhandled error:'), reason);
});
process.on('uncaughtException', (err) => {
  console.error(chalk.red('Fatal:'), err.message);
  process.exit(1);
});
main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(chalk.red(msg));
  process.exit(1);
});
