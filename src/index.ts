#!/usr/bin/env node
import chalk from 'chalk';
import { ConfigManager } from './config/ConfigManager';
import { ConversationStore } from './storage/ConversationStore';
import { MemoryStore } from './storage/MemoryStore';
import { Agent } from './agent/Agent';
import { REPL } from './repl/REPL';
import { VERSION } from './banner';

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === '--version' || arg === '-v') {
    console.log(VERSION);
    return;
  }
  if (arg === '--help' || arg === '-h') {
    console.log('Usage: axion-cli [--version|-v] [--help|-h]');
    return;
  }

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