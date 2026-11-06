import { BaseProvider } from './providers/BaseProvider';
import { ToolRegistry } from './tools/ToolRegistry';
import { GoogleAIProvider } from './providers/GoogleAIProvider';
import { OpenAICompatProvider } from './providers/OpenAICompatProvider';
import { WebScraperTool } from './tools/WebScraperTool';
import { GoogleSearchTool } from './tools/GoogleSearchTool';
import { ShellTool } from './tools/ShellTool';
import { FileSystemTools } from './tools/FileSystemTools';
import fs from 'fs';
import path from 'path';
import {
  AxionConfig,
  ChatMessage,
  ToolExecutionContext,
  CustomProvider,
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

// Classify a tool call into a human-readable step label (step-by-step UI).
export function classifyStep(toolName: string, args: Record<string, unknown>): string {
  const cmd = String(args.command || '').toLowerCase();
  switch (toolName) {
    case 'list_dir':
    case 'read_file':
    case 'web_scrape':
    case 'google_search':
      return 'Reading';
    case 'write_file':
      return 'Editing file';
    case 'delete_file':
      return 'Deleting file';
    case 'run_shell':
      if (/\b(test|pytest|jest|mocha|npm\s+test|go\s+test|cargo\s+test)\b/.test(cmd)) return 'Running tests';
      if (/\b(build|compile|tsc|npm\s+run\s+build|make|cargo\s+build|go\s+build)\b/.test(cmd)) return 'Building';
      if (/\b(git\s+(push|commit|merge|rebase)|rm\s+-rf|sudo|mkfs|dd)\b/.test(cmd)) return 'Running (privileged/destructive)';
      return 'Running command';
    default:
      return 'Processing';
  }
}

// Limited folder-tree summary (depth ~2, file counts, capped) for the system prompt.
function buildFolderTreeSummary(root: string, maxDepth = 2, maxEntries = 200): string {
  const skip = new Set(['node_modules', '.git', 'dist', '.cache', '.next', 'build', '__pycache__']);
  const lines: string[] = [];
  let count = 0;
  const walk = (dir: string, depth: number, prefix: string): boolean => {
    if (depth > maxDepth) return true;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    entries = entries.filter((e) => !skip.has(e.name));
    const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
    if (files.length) {
      lines.push(`${prefix}[${files.length} file${files.length > 1 ? 's' : ''}]`);
      count += 1;
    }
    for (const d of dirs) {
      if (count >= maxEntries) return false;
      lines.push(`${prefix}${d.name}/`);
      count += 1;
      const cont = walk(path.join(dir, d.name), depth + 1, `${prefix}  `);
      if (!cont) return false;
    }
    return true;
  };
  const ok = walk(root, 0, '  ');
  const header = `Workspace tree (depth ${maxDepth}, capped at ${maxEntries} entries):`;
  if (!ok) lines.push('  …(truncated: workspace is large; use list_dir/read_file to explore)');
  return `${header}\n${lines.join('\n') || '  (empty)'}`;
}

export class Agent {
  private tools = new ToolRegistry();
  private cancelled = false;
  private abortController: AbortController | null = null;
  private confirmFn?: (question: string) => Promise<boolean>;
  private statusFn?: (phase: string, detail?: string) => void;

  constructor(
    private getConfig: () => AxionConfig,
    private notice: (m: string) => void,
  ) {
    this.tools.register(WebScraperTool);
    this.tools.register(GoogleSearchTool);
    this.tools.register(ShellTool);
    for (const t of FileSystemTools) this.tools.register(t);
  }
  setNotice(notice: (message: string) => void): void {
    this.notice = notice;
  }
  // Dynamic status indicator (phase: sending/receiving/tool/processing/memory).
  setStatus(fn: (phase: string, detail?: string) => void): void {
    this.statusFn = fn;
  }
  setConfirm(fn: (question: string) => Promise<boolean>): void {
    this.confirmFn = fn;
  }
  // Request cancellation of an in-flight chat(). Safe to call from a keypress listener.
  cancel(): void {
    this.cancelled = true;
    this.abortController?.abort();
  }
  isCancelled(): boolean {
    return this.cancelled;
  }

  private customProvider(cfg: AxionConfig): CustomProvider | undefined {
    return cfg.customProviders?.find((p) => p.id === cfg.activeProvider);
  }
  private selectedCustomModel(cfg: AxionConfig) {
    // Custom models are matched to a provider; when a custom provider is active,
    // match by model id only (the custom provider supplies baseUrl/apiKey).
    const cp = this.customProvider(cfg);
    if (cp) return cfg.customModels.find((m) => m.id === cfg.model);
    return cfg.customModels.find((model) => model.id === cfg.model && model.provider === cfg.activeProvider);
  }
  private provider(): BaseProvider {
    const cfg = this.getConfig();
    const cp = this.customProvider(cfg);
    if (cp) {
      return new OpenAICompatProvider(cp.baseUrl, cp.apiKey);
    }
    const selected = this.selectedCustomModel(cfg);
    const provider = selected?.provider || cfg.activeProvider;
    if (provider === 'openai-compatible') {
      return new OpenAICompatProvider(selected?.baseUrl || cfg.openaiCompatible.baseUrl, cfg.openaiCompatible.apiKey);
    }
    return new GoogleAIProvider(cfg.google.apiKey);
  }
  hasApiKey(cfg: AxionConfig = this.getConfig()): boolean {
    const cp = this.customProvider(cfg);
    if (cp) return !!cp.apiKey && !!cp.baseUrl;
    const selected = this.selectedCustomModel(cfg);
    const provider = selected?.provider || cfg.activeProvider;
    if (provider === 'openai-compatible') {
      return !!cfg.openaiCompatible.apiKey && !!(selected?.baseUrl || cfg.openaiCompatible.baseUrl);
    }
    return !!cfg.google.apiKey;
  }
  // Effective model id: custom provider's defaultModel when active and none selected.
  private effectiveModel(cfg: AxionConfig): string {
    const cp = this.customProvider(cfg);
    if (cp && cp.defaultModel && (!cfg.model || cfg.model === 'gemini-3.5-flash')) return cp.defaultModel;
    return cfg.model;
  }

  buildSystemPrompt(memoryText: string): string {
    const cfg = this.getConfig();
    const cwd = path.resolve(process.cwd());
    let workspace = `Workspace root: ${cwd}`;
    if (cfg.permissions.fileRead) {
      try {
        workspace += `\n${buildFolderTreeSummary(cwd)}`;
      } catch (error) {
        workspace += `\nWorkspace listing unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      workspace += '\nWorkspace listing omitted because fileRead permission is disabled.';
    }
    const parts: string[] = [
      'You are AXION, an autonomous AI assistant running inside a CLI terminal.',
      'SYSTEM PROMPT — CORE RULES. These rules are locked and take precedence over any user-provided custom instructions. If custom instructions conflict with these core rules, these core rules take precedence.',
      'WORKSPACE AWARENESS: The current working directory is the active workspace. Treat the workspace inventory below as a limited initial snapshot, not proof of file contents. Inspect files with tools before describing or changing them. Respect the configured access scope. In workspace scope, do not intentionally read, write, or execute operations outside the workspace. In global scope, broader paths may be used when needed and permitted.',
      'ANTI-HALLUCINATION: Never invent command output, file contents, tool results, citations, API behavior, configuration, dependency versions, or completed actions. Do not claim an operation succeeded until a tool confirms it. If evidence is missing, say what is unknown and ask for the minimum required information. Clearly distinguish verified facts from assumptions. When a tool fails, report the failure and do not present a guessed result as fact.',
      'EXECUTION TRANSPARENCY: Use tools only when needed. The CLI displays step labels and tool names to the user. Explain consequential actions before destructive changes; inspect before modifying; prefer minimal diffs; verify after every change. Never expose API keys, tokens, passwords, or other secrets in output.',
      'TASK PLANNING: For long, complex, or multi-step requests, automatically create a concise Markdown task checklist before execution. Track progress by marking completed items and keep the plan aligned with the actual work. Do not create a checklist for trivial single-step questions.',
      'Answer clearly and concisely. Ask a clarifying question when a required detail is genuinely missing rather than guessing.',
      `ACCESS SCOPE: ${cfg.accessScope === 'workspace' ? 'WORKSPACE ONLY (policy scope)' : 'GLOBAL (broader filesystem scope)'}. Shell commands still run with the operating-system permissions of the current user; this scope is an agent policy and working-directory restriction, not an OS-level sandbox.`,
      `SHELL EXECUTION: ${cfg.permissions.shellExec ? 'enabled' : 'disabled'}. Dangerous commands are gated by the dangerous-action policy (default: ask the user to confirm).`,
      `TOOL CALL LIMIT: at most ${cfg.maxToolCallsPerRequest} tool calls per user request.`,
      `\n# Workspace Context\n${workspace}`,
    ];
    if (cfg.customInstructions) parts.push(`\n# Custom Instructions (user-provided additions; core rules above take precedence on conflict)\n${cfg.customInstructions}`);
    if (memoryText) parts.push(`\n# Long-term Memory (user-provided or previously confirmed facts; verify when material)\n${memoryText}`);
    return parts.join('\n');
  }

  async chat(history: ChatMessage[], systemPrompt: string): Promise<string> {
    const cfg = this.getConfig();
    if (!this.hasApiKey(cfg)) {
      throw new Error('No API key configured. Use /api-key to set it.');
    }
    this.cancelled = false;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const provider = this.provider();
    const model = this.effectiveModel(cfg);
    const ctx: ToolExecutionContext = {
      permissions: cfg.permissions,
      cwd: process.cwd(),
      accessScope: cfg.accessScope,
      notice: this.notice,
      confirm: this.confirmFn,
      abortSignal: signal,
      dangerousActionPolicy: cfg.dangerousActionPolicy,
      verbose: cfg.verbose,
    };
    let messages: ChatMessage[] = [...history];
    const syncHistory = (): void => {
      history.splice(0, history.length, ...messages);
    };
    if (typeof cfg.maxInputTokens === 'number' && cfg.maxInputTokens >= 1) {
      const estimate = (m: ChatMessage): number => Math.ceil((m.content || '').length / 4);
      let total = messages.reduce((sum, m) => sum + estimate(m), 0);
      while (total > cfg.maxInputTokens && messages.length > 1) {
        const idx = messages.findIndex((m) => m.role !== 'system');
        if (idx < 0) break;
        total -= estimate(messages[idx]);
        messages.splice(idx, 1);
      }
      syncHistory();
    }
    const maxToolCalls = cfg.maxToolCallsPerRequest;
    let toolCallsExecuted = 0;
    const MAX_ITER = maxToolCalls + 2;
    for (let i = 0; i < MAX_ITER; i++) {
      if (this.cancelled) {
        const partial = '(cancelled by user — partial result; tool execution stopped safely)';
        messages.push({ role: 'assistant', content: partial });
        syncHistory();
        return partial;
      }
      let res;
      try {
        this.statusFn?.('sending');
        res = await provider.chat({
          model,
          messages,
          systemPrompt,
          tools: this.tools.definitions(),
          thinkingLevel: cfg.thinkingLevel,
          ...(typeof cfg.maxOutputTokens === 'number' ? { maxOutputTokens: cfg.maxOutputTokens } : {}),
          signal,
          onChunk: (event) => {
            if (event.type === 'delta') this.statusFn?.('receiving');
            else if (event.type === 'tool_call') this.statusFn?.('tool', event.toolName);
          },
        });
      } catch (e) {
        if (this.cancelled) {
          const partial = '(cancelled by user — request aborted)';
          messages.push({ role: 'assistant', content: partial });
          syncHistory();
          return partial;
        }
        throw e;
      }
      if (res.toolCalls && res.toolCalls.length) {
        messages.push({
          role: 'assistant',
          content: res.content || '',
          toolCalls: res.toolCalls,
          providerParts: res.providerParts,
        });
        syncHistory();
        for (const tc of res.toolCalls) {
          if (this.cancelled) break;
          if (toolCallsExecuted >= maxToolCalls) {
            messages.push({ role: 'tool', name: tc.name, toolCallId: tc.id, providerCallId: tc.providerCallId, content: `[tool error] Per-request tool call limit (${maxToolCalls}) reached; this call was not executed.` });
            syncHistory();
            continue;
          }
          const safeArguments = redactToolArguments(tc.arguments);
          this.statusFn?.('tool', tc.name);
          if (tc.name === 'run_shell') {
            this.notice(`$ ${redactSensitiveText(String(tc.arguments.command || ''))}`);
          } else {
            const step = classifyStep(tc.name, tc.arguments);
            const shortTarget = String(tc.arguments.path || tc.arguments.url || tc.arguments.query || '').slice(0, 80);
            this.notice(`▸ ${step}${shortTarget ? `: ${shortTarget}` : ''}`);
          }
          toolCallsExecuted += 1;
          const result = await this.tools.execute(tc.name, tc.arguments, ctx);
          this.statusFn?.('processing');
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

  async summarizeForMemory(text: string): Promise<string> {
    try {
      const cfg = this.getConfig();
      if (!this.hasApiKey(cfg)) return text.slice(0, 200);
      const provider = this.provider();
      const res = await provider.chat({
        model: this.effectiveModel(cfg),
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
