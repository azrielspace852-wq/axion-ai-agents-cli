import chalk from 'chalk';
import { CommandContext, HandlerResult } from './CommandContext';
import {
  DEFAULT_MODELS,
  CustomModel,
  ProviderType,
  ThinkingLevel,
  PermissionSettings,
} from '../types';
import { t, setLanguage } from '../i18n';

export async function handleModels(ctx: CommandContext): Promise<HandlerResult | void> {
  const cfg = ctx.config;
  const all: CustomModel[] = [...DEFAULT_MODELS, ...cfg.customModels];
  ctx.repl.print(chalk.bold('Available models:'));
  all.forEach((m, i) => {
    const active = m.id === cfg.model ? '*' : ' ';
    ctx.repl.print(` ${active} ${i + 1}. ${m.label} (${m.id}) [${m.provider}]`);
  });
  ctx.repl.print('');
  const choice = (
    await ctx.repl.question('Select model number, "a" to add custom, or Enter to cancel: ')
  ).trim();
  if (!choice) return;
  if (choice.toLowerCase() === 'a') {
    await addCustomModel(ctx);
    return;
  }
  const idx = parseInt(choice, 10) - 1;
  if (idx >= 0 && idx < all.length) {
    cfg.model = all[idx].id;
    cfg.activeProvider = all[idx].provider;
    ctx.saveConfig();
    ctx.repl.print(`Model set to ${all[idx].label}.`);
  } else {
    ctx.repl.print('Invalid selection.');
  }
}

async function addCustomModel(ctx: CommandContext): Promise<void> {
  const id = (await ctx.repl.question('Model id (sent to provider): ')).trim();
  if (!id) {
    ctx.repl.print('Cancelled.');
    return;
  }
  const label = (await ctx.repl.question('Display label: ')).trim() || id;
  const prov = (
    await ctx.repl.question('Provider (google-ai-studio / openai-compatible): ')
  ).trim();
  const provider: ProviderType =
    prov === 'openai-compatible' ? 'openai-compatible' : 'google-ai-studio';
  ctx.config.customModels.push({ id, label, provider });
  ctx.saveConfig();
  ctx.repl.print(`Added custom model "${label}".`);
}

export async function handleThinking(ctx: CommandContext): Promise<HandlerResult | void> {
  const levels: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];
  ctx.repl.print(chalk.bold('Thinking / reasoning budget:'));
  levels.forEach((l, i) => {
    ctx.repl.print(` ${i + 1}. ${l}${ctx.config.thinkingLevel === l ? ' (active)' : ''}`);
  });
  const ans = (await ctx.repl.question('Select level (1-5) or Enter to cancel: ')).trim();
  const idx = parseInt(ans, 10) - 1;
  if (idx >= 0 && idx < levels.length) {
    ctx.config.thinkingLevel = levels[idx];
    ctx.saveConfig();
    ctx.repl.print(`Thinking set to ${levels[idx]}.`);
  }
}

export async function handleInstructions(ctx: CommandContext): Promise<HandlerResult | void> {
  ctx.repl.print(chalk.bold('Current custom instructions:'));
  ctx.repl.print(ctx.config.instructions ? ctx.config.instructions : chalk.dim('(none)'));
  const ans = (
    await ctx.repl.question('New instructions ("clear" to remove, Enter to keep): ')
  ).trim();
  if (!ans) return;
  ctx.config.instructions = ans.toLowerCase() === 'clear' ? '' : ans;
  ctx.saveConfig();
  ctx.repl.print('Instructions updated.');
}

export async function handleMemory(ctx: CommandContext): Promise<HandlerResult | void> {
  const mems = ctx.memories.list();
  ctx.repl.print(chalk.bold('Long-term Memory:'));
  if (!mems.length) ctx.repl.print(chalk.dim(' (empty)'));
  mems.forEach((m) => {
    ctx.repl.print(` • ${m.about}  [id:${m['memory-id']}]  (${m.memories.length})`);
    m.memories.forEach((x) =>
      ctx.repl.print(chalk.dim(`    ${x['memory-number']}. ${x.content}`)),
    );
  });
  const ans = (
    await ctx.repl.question('[a]dd  [d]elete topic  [c]lear all  or Enter to go back: ')
  )
    .trim()
    .toLowerCase();
  if (ans === 'a') {
    const about = (await ctx.repl.question('Topic / about: ')).trim();
    const content = (await ctx.repl.question('Content: ')).trim();
    if (about && content) {
      const summarized = await ctx.agent.summarizeForMemory(content);
      ctx.memories.add(about, summarized);
      ctx.repl.print('Memory saved.');
    }
    return;
  }
  if (ans === 'd') {
    const about = (await ctx.repl.question('Delete topic (about): ')).trim();
    const found = mems.find((m) => m.about.toLowerCase() === about.toLowerCase());
    if (found) {
      ctx.memories.delete(found['memory-id']);
      ctx.repl.print('Deleted.');
    } else {
      ctx.repl.print('Not found.');
    }
    return;
  }
  if (ans === 'c') {
    ctx.memories.clear();
    ctx.repl.print('All memory cleared.');
  }
}

export async function handleApiKey(ctx: CommandContext): Promise<HandlerResult | void> {
  const key = (
    await ctx.repl.question(`Enter API key for ${ctx.config.activeProvider}: `)
  ).trim();
  if (!key) {
    ctx.repl.print('Cancelled.');
    return;
  }
  if (ctx.config.activeProvider === 'openai-compatible') {
    ctx.config.openaiCompatible.apiKey = key;
  } else {
    ctx.config.google.apiKey = key;
  }
  ctx.saveConfig();
  ctx.repl.print('API key saved.');
}

export async function handlePermissions(ctx: CommandContext): Promise<HandlerResult | void> {
  const keys: (keyof PermissionSettings)[] = [
    'webAccess',
    'searchAccess',
    'shellExec',
    'fileRead',
    'fileWrite',
  ];
  for (;;) {
    ctx.repl.print(chalk.bold('Permissions:'));
    keys.forEach((k, i) => {
      const state = ctx.config.permissions[k] ? chalk.green('ON') : chalk.red('OFF');
      ctx.repl.print(` ${i + 1}. ${k}: ${state}`);
    });
    const ans = (await ctx.repl.question('Toggle number, or Enter to save & exit: ')).trim();
    if (!ans) {
      ctx.saveConfig();
      return;
    }
    const idx = parseInt(ans, 10) - 1;
    if (idx >= 0 && idx < keys.length) {
      const k = keys[idx];
      ctx.config.permissions[k] = !ctx.config.permissions[k];
    }
  }
}

export async function handleProvider(ctx: CommandContext): Promise<HandlerResult | void> {
  ctx.repl.print(chalk.bold('Providers:'));
  ctx.repl.print(
    ` 1. google-ai-studio${
      ctx.config.activeProvider === 'google-ai-studio' ? ' (active)' : ''
    }`,
  );
  ctx.repl.print(
    ` 2. openai-compatible${
      ctx.config.activeProvider === 'openai-compatible' ? ' (active)' : ''
    }`,
  );
  const ans = (await ctx.repl.question('Select provider (1/2) or Enter to cancel: ')).trim();
  if (ans === '1') {
    ctx.config.activeProvider = 'google-ai-studio';
    ctx.saveConfig();
    ctx.repl.print('Provider set to Google AI Studio.');
  } else if (ans === '2') {
    const baseUrl = (
      await ctx.repl.question('Base URL (e.g. https://api.openai.com/v1): ')
    ).trim();
    const apiKey = (await ctx.repl.question('API Key: ')).trim();
    ctx.config.openaiCompatible = { baseUrl, apiKey };
    ctx.config.activeProvider = 'openai-compatible';
    ctx.saveConfig();
    ctx.repl.print('Provider set to OpenAI-compatible.');
  }
}

export async function handleClear(ctx: CommandContext): Promise<HandlerResult | void> {
  ctx.repl.clearScreen();
  ctx.repl.resetContext();
  ctx.repl.print(chalk.dim('Screen and current context cleared. History file kept.'));
}

export async function handleConversation(ctx: CommandContext): Promise<HandlerResult | void> {
  const list = ctx.conversations.list();
  if (!list.length) {
    ctx.repl.print('No saved conversations.');
    return;
  }
  ctx.repl.print(chalk.bold('Conversations:'));
  list.forEach((c, i) => {
    const last = c.messages[c.messages.length - 1]?.timestamp || '';
    ctx.repl.print(
      ` ${i + 1}. ${c['conversation-name']}  (${c.messages.length} msgs, ${last})`,
    );
  });
  const ans = (
    await ctx.repl.question(
      'Enter number to open, "d <n>" delete, "b <n>" backup, "n" new, or Enter to cancel: ',
    )
  ).trim();
  if (!ans) return;
  if (ans.toLowerCase() === 'n') {
    ctx.repl.newConversation();
    ctx.repl.print('Started a new conversation.');
    return;
  }
  const parts = ans.split(/\s+/);
  if (parts[0].toLowerCase() === 'd') {
    const idx = parseInt(parts[1], 10) - 1;
    if (idx >= 0 && idx < list.length) {
      ctx.conversations.delete(list[idx]['conversation-id']);
      ctx.repl.print('Deleted.');
    } else ctx.repl.print('Invalid number.');
    return;
  }
  if (parts[0].toLowerCase() === 'b') {
    const idx = parseInt(parts[1], 10) - 1;
    if (idx >= 0 && idx < list.length) {
      const dest = ctx.conversations.backup(list[idx]['conversation-id']);
      ctx.repl.print(`Backed up to ${dest}`);
    } else ctx.repl.print('Invalid number.');
    return;
  }
  const idx = parseInt(ans, 10) - 1;
  if (idx >= 0 && idx < list.length) {
    if (ctx.repl.openConversation(list[idx]['conversation-id'])) {
      ctx.repl.print(`Opened "${list[idx]['conversation-name']}".`);
    } else ctx.repl.print('Failed to open.');
  } else ctx.repl.print('Invalid selection.');
}

export async function handleLanguage(ctx: CommandContext): Promise<HandlerResult | void> {
  ctx.repl.print(chalk.bold('Languages:'));
  ctx.repl.print(` 1. English${ctx.config.language === 'en' ? ' (active)' : ''}`);
  ctx.repl.print(` 2. Indonesian${ctx.config.language === 'id' ? ' (active)' : ''}`);
  const ans = (await ctx.repl.question('Select (1/2) or Enter to cancel: ')).trim();
  if (ans === '1') {
    ctx.config.language = 'en';
    setLanguage('en');
    ctx.saveConfig();
    ctx.repl.print('Language set to English.');
  } else if (ans === '2') {
    ctx.config.language = 'id';
    setLanguage('id');
    ctx.saveConfig();
    ctx.repl.print('Bahasa diatur ke Indonesia.');
  }
}

export async function handleHelp(ctx: CommandContext): Promise<HandlerResult | void> {
  const cmds: Array<[string, string]> = [
    ['/models', t('help.models')],
    ['/thinking', t('help.thinking')],
    ['/instructions', t('help.instructions')],
    ['/memory', t('help.memory')],
    ['/api-key', t('help.apikey')],
    ['/permissions', t('help.permissions')],
    ['/provider', t('help.provider')],
    ['/clear', t('help.clear')],
    ['/conversation', t('help.conversation')],
    ['/language', t('help.language')],
    ['/help', t('help.help')],
    ['/exit', t('help.exit')],
  ];
  ctx.repl.print(chalk.bold(t('help.title')) + ':');
  for (const [c, d] of cmds) {
    ctx.repl.print(`  ${chalk.cyan(c.padEnd(16))} ${d}`);
  }
}

export async function handleExit(): Promise<HandlerResult> {
  return { exit: true };
}