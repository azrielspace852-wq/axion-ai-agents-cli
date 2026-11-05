import readline from 'readline';
import chalk from 'chalk';
import { ChatMessage } from '../types';
import { ConfigManager } from '../config/ConfigManager';
import { ConversationStore, ConversationFile, ConversationMessage } from '../storage/ConversationStore';
import { MemoryStore } from '../storage/MemoryStore';
import { Agent } from '../agent/Agent';
import { CommandRouter, COMMAND_LIST } from '../commands/CommandRouter';
import { CommandContext, ReplLike } from '../commands/CommandContext';
import { printBanner } from '../banner';
import { t, setLanguage } from '../i18n';
import { log } from '../utils/logger';
import * as H from '../commands/handlers';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const MAX_SUGGESTIONS = 8;

export class REPL implements ReplLike {
  private rl!: readline.Interface;
  private router = new CommandRouter();
  private conversation!: ConversationFile;
  private history: ChatMessage[] = [];
  private running = true;
  private suppressInputEcho = false;
  private spinnerTimer?: NodeJS.Timeout;
  private spinnerIndex = 0;
  private handling = false;
  private onLineBound!: (line: string) => void;
  private onKeypressBound!: (str: string, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }) => void;
  private basePrompt = '';
  // Command-suggestion takeover state
  private takeover = false;
  private takeoverLine = '';
  private takeoverCursor = 0;
  private takeoverIndex = 0;
  private takeoverMatches: string[] = [];
  private takeoverPrevPopup = 0;
  private storedKeypressListeners: Array<(str: string, key: unknown) => void> = [];
  private takeoverKeypressBound!: (str: string, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }) => void;

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
    // Normal terminal mode: no alt-screen, no absolute positioning. Replies
    // scroll naturally above a persistent input prompt.
    printBanner();
    this.basePrompt = chalk.cyan(t('prompt'));
    readline.emitKeypressEvents(process.stdin);
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    this.rl.setPrompt(this.basePrompt);

    // Suppress echo hook (used by secret input and during select menus).
    const internalRl = this.rl as unknown as { _writeToOutput?: (text: string) => void };
    if (typeof internalRl._writeToOutput === 'function') {
      const originalWriter = internalRl._writeToOutput.bind(this.rl);
      internalRl._writeToOutput = (text: string): void => {
        if (!this.suppressInputEcho) originalWriter(text);
      };
    }

    this.onLineBound = (line) => void this.handleLine(line);
    this.rl.on('line', this.onLineBound);

    this.rl.on('SIGINT', () => {
      this.print('');
      this.exit(0);
    });
    this.rl.on('close', () => {
      if (this.running) this.exit(0);
    });

    // Trigger for the command-suggestion popup: runs AFTER readline has updated
    // rl.line. Only active in TTY mode and when not explicitly disabled (scripting).
    if (process.stdin.isTTY && process.stdout.isTTY && process.env.AXION_NO_AUTOCOMPLETE !== '1') {
      this.onKeypressBound = (_str, _key) => this.maybeEnterTakeover();
      process.stdin.on('keypress', this.onKeypressBound);
    }

    this.newConversation();
    this.print(chalk.dim(t('greeting')) + '\n');
    if (this.cfgMgr.needsOnboarding()) {
      this.print(chalk.cyan('First launch — quick command reference:'));
      await H.handleHelp(this.commandContext());
      this.cfgMgr.get().hasCompletedOnboarding = true;
      this.cfgMgr.save();
    }
    this.rl.prompt();
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

  private async handleLine(line: string): Promise<void> {
    if (this.handling || !this.running) return;
    this.handling = true;
    try {
      const text = line.trim();
      if (!text) return;
      if (text.startsWith('/')) {
        const result = await this.router.route(text, this.commandContext());
        if (result.exit) this.exit(0);
        return;
      }
      await this.sendToAgent(text);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(message);
      this.print(chalk.red('Error: ') + message);
    } finally {
      this.handling = false;
      if (this.running) this.rl.prompt();
    }
  }

  private async sendToAgent(text: string): Promise<void> {
    if (!this.agent.hasApiKey()) {
      this.print(chalk.red(t('err.noApiKey')));
      return;
    }
    // Buffer in memory; flushed at session boundaries only.
    this.bufferMessage('user', text);
    this.history.push({ role: 'user', content: text });
    const memoryText = this.memories.toPromptText();
    const systemPrompt = this.agent.buildSystemPrompt(memoryText);
    const generatedStart = this.history.length;
    this.startThinking();
    try {
      const reply = await this.agent.chat(this.history, systemPrompt);
      this.stopThinking();
      this.print(chalk.green('AXION ❯ ') + reply);
    } catch (error: unknown) {
      this.stopThinking();
      const message = error instanceof Error ? error.message : String(error);
      this.print(chalk.red('Error: ') + message);
    } finally {
      this.stopThinking();
      for (const message of this.history.slice(generatedStart)) {
        this.bufferMessage(message.role, message.content, message);
      }
    }
  }

  // ---- Conversation buffering (in-memory; flushed at session boundaries) ----
  private bufferMessage(role: ConversationMessage['role'], content: string, metadata: Partial<ChatMessage> = {}): void {
    const nextNumber = this.conversation.messages.reduce((max, item) => Math.max(max, item['message-number']), 0) + 1;
    this.conversation.messages.push({
      'message-number': nextNumber,
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(metadata.name ? { name: metadata.name } : {}),
      ...(metadata.toolCallId ? { toolCallId: metadata.toolCallId } : {}),
      ...(metadata.providerCallId ? { providerCallId: metadata.providerCallId } : {}),
      ...(metadata.toolCalls ? { toolCalls: metadata.toolCalls } : {}),
      ...(metadata.providerParts ? { providerParts: metadata.providerParts } : {}),
    });
  }

  flushConversation(): void {
    try {
      if (this.conversation) this.conversations.write(this.conversation);
    } catch (error: unknown) {
      log.error(`flushConversation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---- Spinner ----
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

  // ---- ReplLike ----
  print(message: string): void {
    process.stdout.write(`${message}\n`);
  }

  question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.removeListener('line', this.onLineBound);
      this.rl.question(prompt, (answer) => {
        this.rl.setPrompt(this.basePrompt);
        this.rl.addListener('line', this.onLineBound);
        this.clearInputBuffer();
        resolve(answer);
      });
    });
  }

  questionSecret(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.removeListener('line', this.onLineBound);
      process.stdout.write(prompt);
      this.suppressInputEcho = true;
      this.rl.question('', (answer) => {
        this.suppressInputEcho = false;
        process.stdout.write('\n');
        this.rl.setPrompt(this.basePrompt);
        this.rl.addListener('line', this.onLineBound);
        this.clearInputBuffer();
        resolve(answer);
      });
    });
  }

  private clearInputBuffer(): void {
    // Discard anything typed while a menu/secret prompt was active.
    (this.rl as unknown as { line: string }).line = '';
    (this.rl as unknown as { cursor: number }).cursor = 0;
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
      const lineCount = options.length + 2; // prompt + options + help line
      let firstRender = true;

      const render = (): void => {
        if (!firstRender) process.stdout.write(`\x1b[${lineCount}A`); // back to the prompt line
        firstRender = false;
        process.stdout.write(`\r\x1b[2K${chalk.bold(prompt)}\n`);
        options.forEach((option, index) => {
          const marker = index === selected ? chalk.cyan('❯') : ' ';
          const label = index === selected ? chalk.inverse(` ${option} `) : ` ${option}`;
          process.stdout.write(`\r\x1b[2K${marker}${label}\x1b[0m\n`);
        });
        process.stdout.write(`\r\x1b[2K${chalk.dim('Use ↑/↓ and Enter; Esc cancels.')}\n`);
      };

      const finish = (value: number | null): void => {
        if (finished) return;
        finished = true;
        process.stdin.removeListener('keypress', onKeypress);
        if (typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(Boolean(previousRawMode));
        this.suppressInputEcho = false;
        // Clear the whole menu block: move up lineCount rows, then erase to bottom.
        process.stdout.write(`\x1b[${lineCount}A\x1b[J`);
        this.clearInputBuffer();
        this.rl.addListener('line', this.onLineBound);
        resolve(value);
      };

      const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }): void => {
        if (key.ctrl && key.name === 'c') return finish(null);
        if (key.name === 'escape') return finish(null);
        if (key.name === 'up') { selected = (selected - 1 + options.length) % options.length; render(); return; }
        if (key.name === 'down') { selected = (selected + 1) % options.length; render(); return; }
        if (key.name === 'return' || key.name === 'enter') return finish(selected);
        // Ignore printable input while the menu is open (echo is suppressed and the buffer is cleared on finish).
      };

      this.rl.removeListener('line', this.onLineBound);
      this.suppressInputEcho = true;
      readline.emitKeypressEvents(process.stdin);
      if (typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('keypress', onKeypress);
      render();
    });
  }

  clearScreen(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  exit(code = 0): void {
    if (!this.running) return;
    this.running = false;
    this.stopThinking();
    this.flushConversation();
    try { this.cfgMgr.save(); } catch { /* best effort */ }
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      try { process.stdin.setRawMode(false); } catch { /* stream may already be closed */ }
    }
    this.print(chalk.dim(t('bye')));
    try { this.rl?.close(); } catch { /* already closed */ }
    process.exit(code);
  }

  resetContext(): void {
    this.history = [];
  }

  openConversation(id: string): boolean {
    const document = this.conversations.load(id);
    if (!document) return false;
    this.flushConversation();
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
    if (this.conversation) this.flushConversation();
    this.conversation = this.conversations.create();
    this.history = [];
  }

  currentConversationId(): string {
    return this.conversation['conversation-id'];
  }

  // ---- Command suggestion popup (TTY only) ----
  private maybeEnterTakeover(): void {
    if (this.takeover || this.handling) return;
    const rlAny = this.rl as unknown as { line?: string; cursor?: number };
    const line = rlAny.line ?? '';
    if (line.startsWith('/') && !line.startsWith(' /')) {
      this.enterTakeover(line, rlAny.cursor ?? line.length);
    }
  }

  private computeMatches(prefix: string): string[] {
    const lower = prefix.toLowerCase();
    return COMMAND_LIST.filter((cmd) => cmd.toLowerCase().startsWith(lower)).slice(0, MAX_SUGGESTIONS);
  }

  private enterTakeover(line: string, cursor: number): void {
    this.takeover = true;
    this.takeoverLine = line;
    this.takeoverCursor = cursor;
    this.takeoverMatches = this.computeMatches(line);
    this.takeoverIndex = 0;
    this.takeoverPrevPopup = 0;
    // Snapshot and remove ALL existing keypress listeners (readline's _ttyWrite
    // and our trigger) so we own input while the popup is open.
    this.storedKeypressListeners = (process.stdin.listeners('keypress') as Array<(str: string, key: unknown) => void>).slice();
    for (const l of this.storedKeypressListeners) process.stdin.removeListener('keypress', l);
    this.takeoverKeypressBound = (str, key) => this.handleTakeoverKeypress(str, key);
    process.stdin.on('keypress', this.takeoverKeypressBound);
    if (typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(true);
    process.stdin.resume();
    this.renderTakeover();
  }

  private exitTakeover(submitLine: string | null): void {
    if (!this.takeover) return;
    this.takeover = false;
    // Clear any open popup.
    process.stdout.write(`\r\x1b[2K${this.basePrompt}${this.takeoverLine}\x1b[J`);
    process.stdin.removeListener('keypress', this.takeoverKeypressBound);
    for (const l of this.storedKeypressListeners) process.stdin.on('keypress', l);
    this.storedKeypressListeners = [];
    const rlAny = this.rl as unknown as { line: string; cursor: number };
    if (submitLine === null) {
      // Return to normal readline editing with the current line intact.
      rlAny.line = this.takeoverLine;
      rlAny.cursor = this.takeoverCursor;
      this.rl.prompt();
      return;
    }
    // Submit: hand the line to the normal handler.
    rlAny.line = '';
    rlAny.cursor = 0;
    void this.handleLine(submitLine);
  }

  private renderTakeover(): void {
    const popupOpen = this.takeoverMatches.length > 0;
    if (this.takeoverPrevPopup > 0) process.stdout.write(`\x1b[${this.takeoverPrevPopup}A`);
    process.stdout.write(`\r\x1b[2K${this.basePrompt}${this.takeoverLine}`);
    // Position cursor.
    const left = this.takeoverLine.length - this.takeoverCursor;
    if (left > 0) process.stdout.write(`\x1b[${left}D`);
    process.stdout.write('\x1b[J'); // clear below (erases previous popup)
    if (popupOpen) {
      for (let i = 0; i < this.takeoverMatches.length; i++) {
        const marker = i === this.takeoverIndex ? chalk.cyan('❯ ') : '  ';
        const label = i === this.takeoverIndex ? chalk.inverse(` ${this.takeoverMatches[i]} `) : ` ${this.takeoverMatches[i]}`;
        process.stdout.write(`\n\r\x1b[2K${marker}${label}\x1b[0m`);
      }
    }
    this.takeoverPrevPopup = popupOpen ? this.takeoverMatches.length : 0;
  }

  private handleTakeoverKeypress(str: string, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }): void {
    if (key.ctrl && key.name === 'c') {
      this.exitTakeover(null);
      this.print('');
      this.exit(0);
      return;
    }
    if (key.name === 'escape') { this.exitTakeover(null); return; }
    if (key.name === 'up') {
      if (this.takeoverMatches.length) { this.takeoverIndex = (this.takeoverIndex - 1 + this.takeoverMatches.length) % this.takeoverMatches.length; this.renderTakeover(); }
      return;
    }
    if (key.name === 'down') {
      if (this.takeoverMatches.length) { this.takeoverIndex = (this.takeoverIndex + 1) % this.takeoverMatches.length; this.renderTakeover(); }
      return;
    }
    if (key.name === 'return' || key.name === 'enter') {
      if (this.takeoverMatches.length > 0) {
        // First Enter confirms the highlighted suggestion: fill it into the line.
        const chosen = this.takeoverMatches[this.takeoverIndex] + ' ';
        this.takeoverLine = chosen;
        this.takeoverCursor = chosen.length;
        this.takeoverMatches = [];
        this.takeoverIndex = 0;
        this.renderTakeover();
        return;
      }
      // No popup open (or no matches): submit the line.
      const finalLine = this.takeoverLine;
      this.exitTakeover(finalLine);
      return;
    }
    if (key.name === 'backspace') {
      if (this.takeoverCursor > 0) {
        this.takeoverLine = this.takeoverLine.slice(0, this.takeoverCursor - 1) + this.takeoverLine.slice(this.takeoverCursor);
        this.takeoverCursor -= 1;
      }
    } else if (str && !key.ctrl && !key.meta) {
      this.takeoverLine = this.takeoverLine.slice(0, this.takeoverCursor) + str + this.takeoverLine.slice(this.takeoverCursor);
      this.takeoverCursor += str.length;
    } else if (key.name === 'left') {
      if (this.takeoverCursor > 0) this.takeoverCursor -= 1;
    } else if (key.name === 'right') {
      if (this.takeoverCursor < this.takeoverLine.length) this.takeoverCursor += 1;
    } else {
      return; // ignore other keys
    }
    // If the line no longer starts with '/', hand control back to readline.
    if (!this.takeoverLine.startsWith('/')) { this.exitTakeover(null); return; }
    this.takeoverMatches = this.computeMatches(this.takeoverLine);
    if (this.takeoverIndex >= this.takeoverMatches.length) this.takeoverIndex = 0;
    this.renderTakeover();
  }
}
