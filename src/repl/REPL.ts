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
import * as H from '../commands/handlers';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class REPL implements ReplLike {
  private rl!: readline.Interface;
  private router = new CommandRouter();
  private conversation!: ConversationFile;
  private history: ChatMessage[] = [];
  private running = true;
  private suppressInputEcho = false;
  private fullScreen = false;
  private spinnerTimer?: NodeJS.Timeout;
  private spinnerIndex = 0;

  constructor(
    private cfgMgr: ConfigManager,
    private conversations: ConversationStore,
    private memories: MemoryStore,
    private agent: Agent,
  ) {
    setLanguage(cfgMgr.get().language);
    this.agent.setNotice((message) => this.notice(message));
  }

  async start(): Promise<void> {
    this.enterFullScreen();
    printBanner();
    readline.emitKeypressEvents(process.stdin);
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
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
    if (this.cfgMgr.needsOnboarding()) {
      this.print(chalk.cyan('First launch — quick command reference:'));
      await H.handleHelp(this.commandContext());
      this.cfgMgr.get().hasCompletedOnboarding = true;
      this.cfgMgr.save();
    }
    this.ask();
  }

  private enterFullScreen(): void {
    if (process.stdin.isTTY && process.stdout.isTTY && process.env.AXION_NO_ALT_SCREEN !== '1') {
      process.stdout.write('\x1b[?1049h\x1b[?25h\x1b[2J\x1b[H');
      this.fullScreen = true;
    } else {
      // Non-interactive environments retain normal stdout behavior for scripts and tests.
      this.fullScreen = false;
    }
  }

  private commandContext(): CommandContext {
    return {
      args: '',
      config: this.cfgMgr.get(),
      saveConfig: () => this.cfgMgr.save(),
      repl: this,
      conversations: this.conversations,
      memories: this.memories,
      agent: this.agent,
    };
  }

  private ask(): void {
    if (!this.running) return;
    this.question(t('prompt')).then((line) => this.handle(line))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log.error(message);
      })
      .finally(() => this.ask());
  }

  private async handle(line: string): Promise<void> {
    const text = line.trim();
    if (!text) return;
    if (text.startsWith('/')) {
      const result = await this.router.route(text, this.commandContext());
      if (result.exit) this.exit(0);
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
    const generatedStart = this.history.length;
    this.startThinking();
    try {
      const reply = await this.agent.chat(this.history, systemPrompt);
      this.stopThinking();
      this.print('\n' + chalk.green('AXION ❯ ') + reply + '\n');
    } catch (error: unknown) {
      this.stopThinking();
      const message = error instanceof Error ? error.message : String(error);
      this.print(chalk.red('Error: ') + message);
    } finally {
      this.stopThinking();
      for (const message of this.history.slice(generatedStart)) {
        this.conversations.appendMessage(this.conversation, message.role, message.content, message);
      }
    }
  }

  private startThinking(): void {
    if (!process.stdout.isTTY) {
      this.print(chalk.dim(t('agent.thinking')));
      return;
    }
    this.spinnerIndex = 0;
    process.stdout.write(chalk.cyan(`${SPINNER_FRAMES[0]} ${t('agent.thinking')}`));
    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
      process.stdout.write(`\r\x1b[2K${chalk.cyan(`${SPINNER_FRAMES[this.spinnerIndex]} ${t('agent.thinking')}`)}`);
    }, 90);
  }

  private stopThinking(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
      process.stdout.write('\r\x1b[2K');
    }
  }

  notice(message: string): void {
    this.stopThinking();
    this.print(chalk.yellow(message));
  }

  private drawInputFrame(prompt: string): string | null {
    if (!process.stdout.isTTY || !process.stdin.isTTY) return null;
    const columns = Math.max(30, process.stdout.columns || 80);
    const rows = Math.max(8, process.stdout.rows || 24);
    const topRow = rows - 2;
    const middleRow = rows - 1;
    const innerWidth = columns - 2;
    const title = ' AXION INPUT ';
    const topFill = Math.max(0, innerWidth - title.length);
    const top = `╭${title}${'─'.repeat(topFill)}╮`;
    const bottom = `╰${'─'.repeat(innerWidth)}╯`;
    const label = `│ ${prompt.replace(/\s+/g, ' ').trim()} `;
    const filler = Math.max(0, columns - label.length - 1);
    process.stdout.write(`\x1b[${topRow};1H\x1b[2K${top}\x1b[${middleRow};1H\x1b[2K${label}${' '.repeat(filler)}│\x1b[${rows};1H\x1b[2K${bottom}\x1b[${middleRow};${Math.min(columns - 2, label.length + 1)}H`);
    return '';
  }

  // ---- ReplLike ----
  print(message: string): void {
    process.stdout.write(`${message}\n`);
  }

  question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const terminalPrompt = this.drawInputFrame(prompt);
      this.rl.question(terminalPrompt === null ? prompt : '', (answer) => resolve(answer));
    });
  }

  questionSecret(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const terminalPrompt = this.drawInputFrame(prompt);
      if (terminalPrompt === null) process.stdout.write(prompt);
      this.suppressInputEcho = true;
      this.rl.question('', (answer) => {
        this.suppressInputEcho = false;
        process.stdout.write('\n');
        resolve(answer);
      });
    });
  }

  select(prompt: string, options: string[]): Promise<number | null> {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function' || !process.stdout.isTTY) {
      this.print(chalk.bold(prompt));
      options.forEach((option, index) => this.print(` ${index + 1}. ${option}`));
      return this.question('Select number (Enter to cancel): ').then((value) => {
        if (!value.trim()) return null;
        const number = Number(value.trim());
        return Number.isInteger(number) && number >= 1 && number <= options.length ? number - 1 : null;
      });
    }

    return new Promise((resolve) => {
      let selected = 0;
      let finished = false;
      const previousRawMode = process.stdin.isRaw;
      const topRow = Math.max(1, (process.stdout.rows || 24) - options.length - 2);
      const helpRow = topRow + options.length + 1;
      const render = (): void => {
        process.stdout.write(`\x1b[${topRow};1H\x1b[2K${chalk.bold(prompt)}`);
        options.forEach((option, index) => {
          const marker = index === selected ? chalk.cyan('❯') : ' ';
          const label = index === selected ? chalk.inverse(` ${option} `) : ` ${option}`;
          process.stdout.write(`\x1b[${topRow + index + 1};1H\x1b[2K${marker}${label}\x1b[0m`);
        });
        process.stdout.write(`\x1b[${helpRow};1H\x1b[2K${chalk.dim('Use ↑/↓ and Enter; Esc cancels.')}`);
      };
      const finish = (value: number | null): void => {
        if (finished) return;
        finished = true;
        process.stdin.removeListener('keypress', onKeypress);
        process.stdin.setRawMode(Boolean(previousRawMode));
        process.stdout.write(`\x1b[${Math.min((process.stdout.rows || 24), helpRow + 1)};1H\n`);
        resolve(value);
      };
      const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }): void => {
        if (key.ctrl && key.name === 'c') return finish(null);
        if (key.name === 'escape') return finish(null);
        if (key.name === 'up') selected = (selected - 1 + options.length) % options.length;
        else if (key.name === 'down') selected = (selected + 1) % options.length;
        else if (key.name === 'return' || key.name === 'enter') return finish(selected);
        else return;
        render();
      };
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('keypress', onKeypress);
      render();
    });
  }

  clearScreen(): void {
    process.stdout.write(this.fullScreen ? '\x1b[2J\x1b[H' : '\x1bc');
  }

  exit(code = 0): void {
    if (!this.running) return;
    this.running = false;
    this.stopThinking();
    try { this.cfgMgr.save(); } catch { /* best effort */ }
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      try { process.stdin.setRawMode(false); } catch { /* stream may already be closed */ }
    }
    if (this.fullScreen) process.stdout.write('\x1b[?25h\x1b[?1049l');
    console.log(chalk.dim(t('bye')));
    this.rl?.close();
    process.exit(code);
  }

  resetContext(): void {
    this.history = [];
  }

  openConversation(id: string): boolean {
    const document = this.conversations.load(id);
    if (!document) return false;
    this.conversation = document;
    this.history = document.messages.map((message) => ({
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
