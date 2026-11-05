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

function runUpdate(): void {
  const curlCheck = spawnSync('curl', ['--version'], { stdio: 'ignore' });
  if (curlCheck.error || curlCheck.status !== 0) {
    console.error(chalk.red('curl is required to run the fast updater. Install curl, or install manually from: ' + UPDATE_URL));
    process.exit(1);
  }
  const cmd = `curl -fsSL ${UPDATE_URL} | bash`;
  if (process.env.AXION_UPDATE_DRY_RUN === '1') {
    // Dry-run mode for verification: print the exact command instead of executing it.
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
      // Remote fetch failed (offline, repo not published, etc.) — fall back to the bundled file.
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
  const arg = process.argv[2];
  if (arg === '--version' || arg === '-v') {
    console.log(readVersion());
    return;
  }
  if (arg === 'update') {
    runUpdate();
    return;
  }
  if (arg === '--help' || arg === '-h') {
    console.log('Usage: axion-cli [--version|-v] [--help|-h] [update]');
    console.log('  --version   Print the current version');
    console.log('  update      Fast update via curl | bash from the project repository');
    return;
  }
  const currentVersion = readVersion();
  void checkForUpdate(currentVersion);
  const cfgMgr = new ConfigManager();
  const conversations = new ConversationStore();
  const memories = new MemoryStore();
  const notice = (m: string) => console.log(chalk.dim(m));
  const agent = new Agent(() => cfgMgr.get(), notice);
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
