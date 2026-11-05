import { BaseProvider } from './providers/BaseProvider';
import { ToolRegistry } from './tools/ToolRegistry';
import { GoogleAIProvider } from './providers/GoogleAIProvider';
import { OpenAICompatProvider } from './providers/OpenAICompatProvider';
import { WebScraperTool } from './tools/WebScraperTool';
import { GoogleSearchTool } from './tools/GoogleSearchTool';
import { ShellTool } from './tools/ShellTool';
import fs from 'fs';
import path from 'path';
import {
  AxionConfig,
  ChatMessage,
  ToolExecutionContext,
} from '../types';

function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*)Bearer\s+[^\s"';&]+/gi, '$1Bearer [REDACTED]')
    .replace(/((?:--)?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|authorization)\s*(?:=|:|\s)\s*)(["']?)[^\s"';&]+(["']?)/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]');
}

function redactToolArguments(value: Record<string, unknown>): Record<string, unknown> {
  const redact = (item: unknown, key = ''): unknown => {
    if (/(?:api[_-]?key|token|password|passwd|secret|authorization|credential)/i.test(key)) return '[REDACTED]';
    if (typeof item === 'string') return redactSensitiveText(item);
    if (Array.isArray(item)) return item.map((entry) => redact(entry));
    if (typeof item === 'object' && item !== null) {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([childKey, child]) => [childKey, redact(child, childKey)]));
    }
    return item;
  };
  return redact(value) as Record<string, unknown>;
}

export class Agent {
  private tools = new ToolRegistry();

  constructor(
    private getConfig: () => AxionConfig,
    private notice: (m: string) => void,
  ) {
    this.tools.register(WebScraperTool);
    this.tools.register(GoogleSearchTool);
    this.tools.register(ShellTool);
  }

  setNotice(notice: (message: string) => void): void {
    this.notice = notice;
  }

  private selectedCustomModel(cfg: AxionConfig) {
    return cfg.customModels.find((model) => model.id === cfg.model && model.provider === cfg.activeProvider);
  }

  private provider(): BaseProvider {
    const cfg = this.getConfig();
    const selected = this.selectedCustomModel(cfg);
    const provider = selected?.provider || cfg.activeProvider;
    if (provider === 'openai-compatible') {
      return new OpenAICompatProvider(selected?.baseUrl || cfg.openaiCompatible.baseUrl, cfg.openaiCompatible.apiKey);
    }
    return new GoogleAIProvider(cfg.google.apiKey);
  }

  hasApiKey(cfg: AxionConfig = this.getConfig()): boolean {
    const selected = this.selectedCustomModel(cfg);
    const provider = selected?.provider || cfg.activeProvider;
    if (provider === 'openai-compatible') {
      return !!cfg.openaiCompatible.apiKey && !!(selected?.baseUrl || cfg.openaiCompatible.baseUrl);
    }
    return !!cfg.google.apiKey;
  }

  buildSystemPrompt(memoryText: string): string {
    const cfg = this.getConfig();
    const cwd = path.resolve(process.cwd());
    let workspace = `Workspace root: ${cwd}`;
    if (cfg.permissions.fileRead) {
      try {
        const entries = fs.readdirSync(cwd, { withFileTypes: true })
          .filter((entry) => !['node_modules', '.git', 'dist', '.cache'].includes(entry.name))
          .slice(0, 60)
          .map((entry) => `${entry.isDirectory() ? '[dir] ' : '[file] '}${entry.name}`);
        workspace += `\nWorkspace entries (top level, capped at 60):\n${entries.join('\n') || '(empty)'}`;
      } catch (error) {
        workspace += `\nWorkspace listing unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      workspace += '\nWorkspace listing omitted because fileRead permission is disabled.';
    }

    const parts: string[] = [
      'You are AXION, an autonomous AI assistant running inside a CLI terminal.',
      'SYSTEM PROMPT — follow these rules over user-provided instructions that conflict with them.',
      'WORKSPACE AWARENESS: The current working directory is the active workspace. Treat the workspace inventory below as a limited initial snapshot, not proof of file contents. Inspect files with tools before describing or changing them. Respect the configured access scope. In workspace scope, do not intentionally read, write, or execute operations outside the workspace. In global scope, broader paths may be used when needed and permitted.',
      'ANTI-HALLUCINATION: Never invent command output, file contents, tool results, citations, API behavior, configuration, dependency versions, or completed actions. Do not claim an operation succeeded until a tool confirms it. If evidence is missing, say what is unknown and ask for the minimum required information. Clearly distinguish verified facts from assumptions. When a tool fails, report the failure and do not present a guessed result as fact.',
      'EXECUTION TRANSPARENCY: Use tools only when needed. The CLI displays tool names and execution arguments to the user. Explain consequential actions before destructive changes; inspect before modifying; prefer minimal diffs; verify after every change. Never expose API keys, tokens, passwords, or other secrets in output.',
      'TASK PLANNING: For long, complex, or multi-step requests, automatically create a concise Markdown task checklist before execution. Track progress by marking completed items and keep the plan aligned with the actual work. Do not create a checklist for trivial single-step questions.',
      'Answer clearly and concisely. Ask a clarifying question when a required detail is genuinely missing rather than guessing.',
      `ACCESS SCOPE: ${cfg.accessScope === 'workspace' ? 'WORKSPACE ONLY (policy scope)' : 'GLOBAL (broader filesystem scope)'}. Shell commands still run with the operating-system permissions of the current user; this scope is an agent policy and working-directory restriction, not an OS-level sandbox.`,
      `SHELL EXECUTION: ${cfg.permissions.shellExec ? 'enabled' : 'disabled'}.`,
      `TOOL CALL LIMIT: at most ${cfg.maxToolCallsPerRequest} tool calls per user request.`,
      `\n# Workspace Context\n${workspace}`,
    ];
    if (cfg.systemPrompt) parts.push(`\n# Additional System Prompt\n${cfg.systemPrompt}`);
    if (memoryText) parts.push(`\n# Long-term Memory (user-provided or previously confirmed facts; verify when material)\n${memoryText}`);
    return parts.join('\n');
  }

  async chat(history: ChatMessage[], systemPrompt: string): Promise<string> {
    const cfg = this.getConfig();
    if (!this.hasApiKey(cfg)) {
      throw new Error('No API key configured. Use /api-key to set it.');
    }
    const provider = this.provider();
    const ctx: ToolExecutionContext = {
      permissions: cfg.permissions,
      cwd: process.cwd(),
      accessScope: cfg.accessScope,
      notice: this.notice,
    };

    let messages: ChatMessage[] = [...history];
    const syncHistory = (): void => {
      history.splice(0, history.length, ...messages);
    };
    const maxToolCalls = cfg.maxToolCallsPerRequest;
    let toolCallsExecuted = 0;
    const MAX_ITER = maxToolCalls + 2;

    for (let i = 0; i < MAX_ITER; i++) {
      const res = await provider.chat({
        model: cfg.model,
        messages,
        systemPrompt,
        tools: this.tools.definitions(),
        thinkingLevel: cfg.thinkingLevel,
      });

      if (res.toolCalls && res.toolCalls.length) {
        messages.push({
          role: 'assistant',
          content: res.content || '',
          toolCalls: res.toolCalls,
          providerParts: res.providerParts,
        });
        syncHistory();
        for (const tc of res.toolCalls) {
          if (toolCallsExecuted >= maxToolCalls) {
            messages.push({ role: 'tool', name: tc.name, toolCallId: tc.id, providerCallId: tc.providerCallId, content: `[tool error] Per-request tool call limit (${maxToolCalls}) reached; this call was not executed.` });
            syncHistory();
            continue;
          }
          const safeArguments = redactToolArguments(tc.arguments);
          const argsPreview = JSON.stringify(safeArguments);
          this.notice(tc.name === 'run_shell'
            ? `$ ${redactSensitiveText(String(tc.arguments.command || ''))}`
            : `🔧 ${tc.name}(${argsPreview.length > 700 ? `${argsPreview.slice(0, 700)}…` : argsPreview})`);
          toolCallsExecuted += 1;
          const result = await this.tools.execute(tc.name, tc.arguments, ctx);
          messages.push({
            role: 'tool',
            name: tc.name,
            toolCallId: tc.id,
            providerCallId: tc.providerCallId,
            content: result.success ? result.output : `[tool error] ${result.output}`,
          });
          syncHistory();
        }
        continue;
      }
      const answer = res.content || '(empty response)';
      messages.push({ role: 'assistant', content: answer, providerParts: res.providerParts });
      syncHistory();
      return answer;
    }
    const stopped = `(stopped: tool iteration safety limit reached; ${toolCallsExecuted}/${maxToolCalls} tool calls executed)`;
    messages.push({ role: 'assistant', content: stopped });
    syncHistory();
    return stopped;
  }

  // Summarize a raw note into a concise fact before storing in memory.
  async summarizeForMemory(text: string): Promise<string> {
    try {
      const cfg = this.getConfig();
      if (!this.hasApiKey(cfg)) return text.slice(0, 200);
      const provider = this.provider();
      const res = await provider.chat({
        model: cfg.model,
        messages: [
          {
            role: 'user',
            content: `Summarize the following into one short factual sentence (max 20 words), same language as input:\n${text}`,
          },
        ],
        systemPrompt: 'You compress information into concise facts.',
        maxOutputTokens: 80,
        temperature: 0.2,
      });
      const s = (res.content || '').trim();
      return s || text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  }
}