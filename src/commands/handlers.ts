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

async function choose(ctx: CommandContext, prompt: string, options: string[]): Promise<number | null> {
  return ctx.repl.select(prompt, options);
}

function promptValue(ctx: CommandContext, prompt: string, current: string): Promise<string> {
  return ctx.repl.question(`${prompt} [${current}]: `);
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function handleModels(ctx: CommandContext): Promise<HandlerResult | void> {
  const actions = await choose(ctx, 'Custom model management', [
    'Select a model', 'Add custom model', 'Edit custom model', 'Delete custom model', 'Cancel',
  ]);
  if (actions === null || actions === 4) return;
  if (actions === 1) return addCustomModel(ctx);
  if (actions === 2) return editCustomModel(ctx);
  if (actions === 3) return deleteCustomModel(ctx);

  const all: CustomModel[] = [...DEFAULT_MODELS, ...ctx.config.customModels];
  const selected = await choose(ctx, 'Select model', [
    ...all.map((model) => `${model.label} (${model.id}) — ${model.provider}${model.id === ctx.config.model ? ' [active]' : ''}`),
    'Cancel',
  ]);
  if (selected === null || selected >= all.length) return;
  const model = all[selected];
  ctx.config.model = model.id;
  ctx.config.activeProvider = model.provider;
  ctx.saveConfig();
  ctx.repl.print(`Model set to ${model.label}.`);
}

async function addCustomModel(ctx: CommandContext): Promise<void> {
  const id = (await ctx.repl.question('Model basename / provider model ID: ')).trim();
  if (!id) return ctx.repl.print('Cancelled.');
  if (ctx.config.customModels.some((model) => model.id === id) || DEFAULT_MODELS.some((model) => model.id === id)) {
    return ctx.repl.print('A model with that basename already exists.');
  }
  const label = (await ctx.repl.question('Model name: ')).trim() || id;
  const providerIndex = await choose(ctx, 'Provider', ['Google AI Studio', 'OpenAI-compatible', 'Cancel']);
  if (providerIndex === null || providerIndex === 2) return;
  const provider: ProviderType = providerIndex === 1 ? 'openai-compatible' : 'google-ai-studio';
  let baseUrl = '';
  if (provider === 'openai-compatible') {
    baseUrl = (await ctx.repl.question('Optional model-specific base URL (blank uses provider default): ')).trim();
    if (baseUrl && !validHttpUrl(baseUrl)) return ctx.repl.print('Invalid base URL; expected absolute HTTP/HTTPS URL without credentials.');
  }
  ctx.config.customModels.push({ id, label, provider, ...(baseUrl ? { baseUrl: baseUrl.replace(/\/$/, '') } : {}) });
  ctx.config.model = id;
  ctx.config.activeProvider = provider;
  ctx.saveConfig();
  ctx.repl.print(`Added and selected custom model "${label}".`);
}

async function editCustomModel(ctx: CommandContext): Promise<void> {
  const models = ctx.config.customModels;
  if (!models.length) return ctx.repl.print('No custom models to edit. Built-in models cannot be edited.');
  const index = await choose(ctx, 'Select a custom model to edit', [...models.map((model) => `${model.label} (${model.id})`), 'Cancel']);
  if (index === null || index >= models.length) return;
  const model = models[index];
  const name = (await promptValue(ctx, 'Model name', model.label)).trim();
  const basename = (await promptValue(ctx, 'Model basename / provider model ID', model.id)).trim();
  if (basename && basename !== model.id && (models.some((item, i) => i !== index && item.id === basename) || DEFAULT_MODELS.some((item) => item.id === basename))) {
    return ctx.repl.print('That model basename is already in use. No changes were saved.');
  }
  const providerOptions = ['Google AI Studio', 'OpenAI-compatible'];
  const providerIndex = await choose(ctx, `Provider (current: ${model.provider})`, providerOptions);
  if (providerIndex === null) return;
  const nextProvider = providerIndex === 1 ? 'openai-compatible' : 'google-ai-studio';
  let baseUrl = model.baseUrl || '';
  if (nextProvider === 'openai-compatible') {
    const nextUrl = (await promptValue(ctx, 'Model-specific base URL (blank clears override)', baseUrl || 'provider default')).trim();
    if (nextUrl) {
      if (!validHttpUrl(nextUrl)) return ctx.repl.print('Invalid base URL. No changes were saved.');
      baseUrl = nextUrl.replace(/\/$/, '');
    } else {
      baseUrl = '';
    }
  } else {
    baseUrl = '';
  }
  const oldId = model.id;
  model.label = name || model.label;
  model.id = basename || model.id;
  model.provider = nextProvider;
  if (baseUrl) model.baseUrl = baseUrl;
  else delete model.baseUrl;
  if (ctx.config.model === oldId) {
    ctx.config.model = model.id;
    ctx.config.activeProvider = model.provider;
  }
  ctx.saveConfig();
  ctx.repl.print(`Updated custom model "${model.label}".`);
}

async function deleteCustomModel(ctx: CommandContext): Promise<void> {
  const models = ctx.config.customModels;
  if (!models.length) return ctx.repl.print('No custom models to delete. Built-in models are protected.');
  const index = await choose(ctx, 'Select a custom model to delete', [...models.map((model) => `${model.label} (${model.id})`), 'Cancel']);
  if (index === null || index >= models.length) return;
  const model = models[index];
  const confirm = await choose(ctx, `Delete custom model "${model.label}"?`, ['Delete', 'Keep']);
  if (confirm !== 0) return;
  ctx.config.customModels.splice(index, 1);
  if (ctx.config.model === model.id) {
    ctx.config.model = DEFAULT_MODELS[0].id;
    ctx.config.activeProvider = DEFAULT_MODELS[0].provider;
  }
  ctx.saveConfig();
  ctx.repl.print(`Deleted custom model "${model.label}". Built-in models were not affected.`);
}

export async function handleThinking(ctx: CommandContext): Promise<HandlerResult | void> {
  const levels: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];
  const selected = await choose(ctx, `Thinking level (current: ${ctx.config.thinkingLevel})`, [...levels, 'Cancel']);
  if (selected === null || selected >= levels.length) return;
  ctx.config.thinkingLevel = levels[selected];
  ctx.saveConfig();
  ctx.repl.print(`Thinking set to ${levels[selected]}.`);
}

export async function handleSystemPrompt(ctx: CommandContext): Promise<HandlerResult | void> {
  ctx.repl.print(chalk.bold('Current system prompt addition:'));
  ctx.repl.print(ctx.config.systemPrompt || chalk.dim('(none)'));
  ctx.repl.print(chalk.dim('The AXION base system prompt remains active; this text is appended to it.'));
  const answer = (await ctx.repl.question('New system prompt ("clear" to remove, Enter to keep): ')).trim();
  if (!answer) return;
  ctx.config.systemPrompt = answer.toLowerCase() === 'clear' ? '' : answer;
  ctx.saveConfig();
  ctx.repl.print('System prompt updated.');
}

export async function handleMemory(ctx: CommandContext): Promise<HandlerResult | void> {
  const memories = ctx.memories.list();
  ctx.repl.print(chalk.bold('Long-term memory'));
  if (!memories.length) ctx.repl.print(chalk.dim('(empty)'));
  memories.forEach((topic) => {
    ctx.repl.print(`• ${topic.about} [${topic['memory-id']}]`);
    topic.memories.forEach((entry) => ctx.repl.print(chalk.dim(`  ${entry['memory-number']}. ${entry.content}`)));
  });
  const action = await choose(ctx, 'Memory actions', [
    'Add memory', 'Edit memory entry', 'Delete memory entry', 'Rename topic', 'Delete topic', 'Clear all memory', 'Cancel',
  ]);
  if (action === null || action === 6) return;
  if (action === 5) {
    const confirm = await choose(ctx, 'Delete every saved memory?', ['Delete all', 'Cancel']);
    if (confirm === 0) { ctx.memories.clear(); ctx.repl.print('All memory cleared.'); }
    return;
  }
  if (action === 0) {
    const about = (await ctx.repl.question('Topic / about: ')).trim();
    const content = (await ctx.repl.question('Memory content: ')).trim();
    if (!about || !content) return ctx.repl.print('Topic and content are required.');
    const summarized = await ctx.agent.summarizeForMemory(content);
    ctx.memories.add(about, summarized);
    return ctx.repl.print('Memory saved.');
  }
  if (!memories.length) return;
  const topicIndex = await choose(ctx, 'Select memory topic', [...memories.map((item) => item.about), 'Cancel']);
  if (topicIndex === null || topicIndex >= memories.length) return;
  const topic = memories[topicIndex];
  if (action === 3) {
    const newName = (await promptValue(ctx, 'New topic name', topic.about)).trim();
    if (!newName) return;
    if (!ctx.memories.renameTopic(topic['memory-id'], newName)) return ctx.repl.print('Unable to rename topic.');
    return ctx.repl.print('Memory topic renamed.');
  }
  if (action === 4) {
    const confirm = await choose(ctx, `Delete memory topic "${topic.about}"?`, ['Delete topic', 'Cancel']);
    if (confirm === 0) { ctx.memories.delete(topic['memory-id']); ctx.repl.print('Memory topic deleted.'); }
    return;
  }
  if (!topic.memories.length) return ctx.repl.print('This topic has no memory entries.');
  const entryIndex = await choose(ctx, `Select an entry in "${topic.about}"`, [
    ...topic.memories.map((item) => `${item['memory-number']}. ${item.content}`), 'Cancel',
  ]);
  if (entryIndex === null || entryIndex >= topic.memories.length) return;
  const entry = topic.memories[entryIndex];
  if (action === 1) {
    const next = (await promptValue(ctx, 'Updated memory content', entry.content)).trim();
    if (!next) return ctx.repl.print('Empty content is not saved.');
    ctx.memories.updateEntry(topic['memory-id'], entry['memory-number'], next);
    return ctx.repl.print('Memory entry updated.');
  }
  if (action === 2) {
    const confirm = await choose(ctx, 'Delete this memory entry?', ['Delete entry', 'Cancel']);
    if (confirm === 0) { ctx.memories.deleteEntry(topic['memory-id'], entry['memory-number']); ctx.repl.print('Memory entry deleted.'); }
  }
}

export async function handleApiKey(ctx: CommandContext): Promise<HandlerResult | void> {
  const key = (await ctx.repl.questionSecret(`Enter API key for ${ctx.config.activeProvider}: `)).trim();
  if (!key) return ctx.repl.print('Cancelled.');
  if (ctx.config.activeProvider === 'openai-compatible') ctx.config.openaiCompatible.apiKey = key;
  else ctx.config.google.apiKey = key;
  ctx.saveConfig();
  ctx.repl.print('API key saved.');
}

export async function handlePermissions(ctx: CommandContext): Promise<HandlerResult | void> {
  const keys: (keyof PermissionSettings)[] = ['webAccess', 'searchAccess', 'shellExec'];
  for (;;) {
    const options = keys.map((key) => `${key}: ${ctx.config.permissions[key] ? 'ON' : 'OFF'}`);
    const selected = await choose(ctx, 'Toggle permission (Enter/Escape to finish)', [...options, 'Save and exit']);
    if (selected === null || selected === keys.length) break;
    const key = keys[selected];
    ctx.config.permissions[key] = !ctx.config.permissions[key];
  }
  ctx.saveConfig();
}

export async function handleAccess(ctx: CommandContext): Promise<HandlerResult | void> {
  const selected = await choose(ctx, `Access scope (current: ${ctx.config.accessScope})`, [
    'Workspace only — current directory policy', 'Global — broader filesystem access', 'Cancel',
  ]);
  if (selected === null || selected === 2) return;
  ctx.config.accessScope = selected === 0 ? 'workspace' : 'global';
  ctx.saveConfig();
  ctx.repl.print(`Access scope set to ${ctx.config.accessScope}.`);
  if (ctx.config.accessScope === 'workspace') {
    ctx.repl.print(chalk.yellow('Note: workspace scope is an agent policy and working-directory restriction, not an OS-level sandbox for arbitrary shell commands.'));
  }
}

export async function handleToolLimit(ctx: CommandContext): Promise<HandlerResult | void> {
  const current = ctx.config.maxToolCallsPerRequest;
  const options = ['5', '10', '20', '30 (default)', '50', '100', 'Enter custom value', 'Cancel'];
  const selected = await choose(ctx, `Maximum tool calls per request (current: ${current})`, options);
  if (selected === null || selected === 7) return;
  let value = [5, 10, 20, 30, 50, 100][selected];
  if (selected === 6) value = Number((await ctx.repl.question('Enter a limit from 1 to 100: ')).trim());
  if (!Number.isInteger(value) || value < 1 || value > 100) return ctx.repl.print('Invalid limit. Choose an integer from 1 to 100.');
  ctx.config.maxToolCallsPerRequest = value;
  ctx.saveConfig();
  ctx.repl.print(`Tool call limit set to ${value} per request.`);
}

export async function handleProvider(ctx: CommandContext): Promise<HandlerResult | void> {
  const selected = await choose(ctx, `Active provider: ${ctx.config.activeProvider}`, ['Google AI Studio', 'OpenAI-compatible', 'Cancel']);
  if (selected === null || selected === 2) return;
  if (selected === 0) {
    ctx.config.activeProvider = 'google-ai-studio';
    ctx.saveConfig();
    return ctx.repl.print('Provider set to Google AI Studio.');
  }
  const baseUrl = (await ctx.repl.question('Base URL (e.g. https://api.openai.com/v1): ')).trim();
  if (!validHttpUrl(baseUrl)) return ctx.repl.print('Invalid base URL. Use an absolute HTTP/HTTPS URL without credentials.');
  const apiKey = (await ctx.repl.questionSecret('API Key: ')).trim();
  if (!apiKey) return ctx.repl.print('Provider switch cancelled because the API key was empty.');
  ctx.config.openaiCompatible = { baseUrl: baseUrl.replace(/\/$/, ''), apiKey };
  ctx.config.activeProvider = 'openai-compatible';
  ctx.saveConfig();
  ctx.repl.print('Provider set to OpenAI-compatible.');
}

export async function handleClear(ctx: CommandContext): Promise<HandlerResult | void> {
  ctx.repl.clearScreen();
  ctx.repl.resetContext();
  ctx.repl.print(chalk.dim('Screen and current context cleared. History file kept.'));
}

export async function handleConversation(ctx: CommandContext): Promise<HandlerResult | void> {
  const list = ctx.conversations.list();
  if (!list.length) return ctx.repl.print('No saved conversations.');
  const actions = await choose(ctx, 'Conversation actions', ['Open conversation', 'New conversation', 'Delete conversation', 'Backup conversation', 'Cancel']);
  if (actions === null || actions === 4) return;
  if (actions === 1) { ctx.repl.newConversation(); return ctx.repl.print('Started a new conversation.'); }
  const selected = await choose(ctx, 'Select conversation', [...list.map((item) => `${item['conversation-name']} (${item.messages.length} messages)`), 'Cancel']);
  if (selected === null || selected >= list.length) return;
  const conversation = list[selected];
  if (actions === 0) {
    if (ctx.repl.openConversation(conversation['conversation-id'])) ctx.repl.print(`Opened "${conversation['conversation-name']}".`);
    else ctx.repl.print('Failed to open conversation.');
  } else if (actions === 2) {
    const confirm = await choose(ctx, `Delete "${conversation['conversation-name']}"?`, ['Delete', 'Cancel']);
    if (confirm === 0) { ctx.conversations.delete(conversation['conversation-id']); ctx.repl.print('Conversation deleted.'); }
  } else {
    const destination = ctx.conversations.backup(conversation['conversation-id']);
    ctx.repl.print(destination ? `Backed up to ${destination}` : 'Backup failed.');
  }
}

export async function handleLanguage(ctx: CommandContext): Promise<HandlerResult | void> {
  const selected = await choose(ctx, 'Interface language', ['English', 'Bahasa Indonesia', 'Cancel']);
  if (selected === null || selected === 2) return;
  ctx.config.language = selected === 1 ? 'id' : 'en';
  setLanguage(ctx.config.language);
  ctx.saveConfig();
  ctx.repl.print(selected === 1 ? 'Bahasa diatur ke Indonesia.' : 'Language set to English.');
}

export async function handleFeedback(ctx: CommandContext): Promise<HandlerResult | void> {
  ctx.repl.print(chalk.bold('AXION AI Agents CLI — Feedback & Support'));
  ctx.repl.print('Email: axionneuralis@gmail.com');
  ctx.repl.print('Email: azrielspace852@gmail.com');
  ctx.repl.print('GitHub Issues: https://github.com/azrielspace852-wq/axion-ai-agents-cli/issues');
  ctx.repl.print(chalk.dim('Use GitHub Issues to report reproducible bugs and feature requests. Do not include API keys or secrets.'));
}

export async function handleHelp(ctx: CommandContext): Promise<HandlerResult | void> {
  const cmds: Array<[string, string]> = [
    ['/feedback', 'Show support email addresses and GitHub issue tracker'],
    ['/acces', 'Choose workspace-only or global access scope'],
    ['/models', 'Select, add, edit, or delete custom models'],
    ['/thinking', t('help.thinking')],
    ['/system', 'View or edit the additional system prompt'],
    ['/memory', t('help.memory')],
    ['/api-key', t('help.apikey')],
    ['/permissions', t('help.permissions')],
    ['/tool-limit', 'Set the maximum tool calls allowed per request (default: 30)'],
    ['/provider', t('help.provider')],
    ['/clear', t('help.clear')],
    ['/conversation', t('help.conversation')],
    ['/language', t('help.language')],
    ['/help', t('help.help')],
    ['/exit', t('help.exit')],
  ];
  ctx.repl.print(chalk.bold(t('help.title')) + ':');
  for (const [command, description] of cmds) ctx.repl.print(`  ${chalk.cyan(command.padEnd(16))} ${description}`);
}

export async function handleExit(): Promise<HandlerResult> {
  return { exit: true };
}
