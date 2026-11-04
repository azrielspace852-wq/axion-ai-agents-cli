import readline from 'readline';
import chalk from 'chalk';
import { ChatMessage } from '../types';
import { ConfigManager } from '../config/ConfigManager';
import { ConversationStore, ConversationFile } from '../storage/ConversationStore';
import { MemoryStore } from '../storage/MemoryStore';
import { Agent } from '../agent/Agent';
import { CommandRouter } from '../commands/CommandRouter';
import { CommandContext, ReplLike } from '../commands/CommandContext';
import { printBanner } from '../banner';
import { t, setLanguage } from '../i18n';
import { log } from '../utils/logger';

export class REPL implements ReplLike {
  private rl!: readline.Interface;
  private router = new CommandRouter();
  private conversation!: ConversationFile;
  private history: ChatMessage[] = [];
  private running = true;
  private suppressInputEcho = false;

  constructor(
    private cfgMgr: ConfigManager,
    private conversations: ConversationStore,
    private memories: MemoryStore,
    private agent: Agent,
  ) {
    setLanguage(cfgMgr.get().language);
  }

  async start(): Promise<void> {
    printBanner();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // Readline normally echoes typed input. Suppress that echo only while a secret is requested.
    const internalRl = this.rl as unknown as { _writeToOutput?: (text: string) => void };
    if (typeof internalRl._writeToOutput === 'function') {
      const originalWriter = internalRl._writeToOutput.bind(this.rl);
      internalRl._writeToOutput = (text: string): void => {
        if (!this.suppressInputEcho) originalWriter(text);
      };
    }
    this.rl.on('SIGINT', () => {
      this.print('');
      this.exit(0);
    });
    this.rl.on('close', () => {
      if (this.running) this.exit(0);
    });

    this.newConversation();
    this.print(chalk.dim(t('greeting')) + '\n');
    this.ask();
  }

  private ask(): void {
    if (!this.running) return;
    const promptStr = chalk.magenta(t('prompt'));
    this.rl.question(promptStr, (line) => {
      this.handle(line)
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          log.error(msg);
        })
        .finally(() => this.ask());
    });
  }

  private async handle(line: string): Promise<void> {
    const text = line.trim();
    if (!text) return;

    if (text.startsWith('/')) {
      const ctx: CommandContext = {
        args: '',
        config: this.cfgMgr.get(),
        saveConfig: () => this.cfgMgr.save(),
        repl: this,
        conversations: this.conversations,
        memories: this.memories,
        agent: this.agent,
      };
      const res = await this.router.route(text, ctx);
      if (res.exit) this.exit(0);
      return;
    }

    await this.sendToAgent(text);
  }

  private async sendToAgent(text: string): Promise<void> {
    if (!this.agent.hasApiKey()) {
      this.print(chalk.red(t('err.noApiKey')));
      return;
    }
    this.conversations.appendMessage(this.conversation, 'user', text);
    this.history.push({ role: 'user', content: text });

    const memoryText = this.memories.toPromptText();
    const systemPrompt = this.agent.buildSystemPrompt(memoryText);
    this.print(chalk.dim(t('agent.thinking')));

    const generatedStart = this.history.length;
    try {
      const reply = await this.agent.chat(this.history, systemPrompt);
      this.print('\n' + chalk.green('AXION ❯ ') + reply + '\n');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.print(chalk.red('Error: ') + msg);
    } finally {
      // Persist the complete provider exchange, including tool calls/results and opaque thought signatures.
      for (const message of this.history.slice(generatedStart)) {
        this.conversations.appendMessage(this.conversation, message.role, message.content, message);
      }
    }
  }

  // ---- ReplLike ----
  print(msg: string): void {
    console.log(msg);
  }

  question(q: string): Promise<string> {
    return new Promise((resolve) => this.rl.question(q, (ans) => resolve(ans)));
  }

  questionSecret(q: string): Promise<string> {
    process.stdout.write(q);
    this.suppressInputEcho = true;
    return new Promise((resolve) => {
      this.rl.question('', (answer) => {
        this.suppressInputEcho = false;
        process.stdout.write('\n');
        resolve(answer);
      });
    });
  }

  clearScreen(): void {
    process.stdout.write('\x1bc');
  }

  exit(code = 0): void {
    if (!this.running) return;
    this.running = false;
    try {
      this.cfgMgr.save();
    } catch {
      /* best effort */
    }
    console.log(chalk.dim(t('bye')));
    this.rl.close();
    process.exit(code);
  }

  resetContext(): void {
    this.history = [];
  }

  openConversation(id: string): boolean {
    const doc = this.conversations.load(id);
    if (!doc) return false;
    this.conversation = doc;
    this.history = doc.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(message.providerCallId ? { providerCallId: message.providerCallId } : {}),
      ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      ...(message.providerParts ? { providerParts: message.providerParts } : {}),
    }));
    return true;
  }

  newConversation(): void {
    this.conversation = this.conversations.create();
    this.history = [];
  }

  currentConversationId(): string {
    return this.conversation['conversation-id'];
  }
}