import { BaseProvider } from './providers/BaseProvider';
import { ToolRegistry } from './tools/ToolRegistry';
import { GoogleAIProvider } from './providers/GoogleAIProvider';
import { OpenAICompatProvider } from './providers/OpenAICompatProvider';
import { WebScraperTool } from './tools/WebScraperTool';
import { GoogleSearchTool } from './tools/GoogleSearchTool';
import { ShellTool } from './tools/ShellTool';
import {
  AxionConfig,
  ChatMessage,
  ToolExecutionContext,
} from '../types';

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

  private provider(): BaseProvider {
    const cfg = this.getConfig();
    if (cfg.activeProvider === 'openai-compatible') {
      return new OpenAICompatProvider(cfg.openaiCompatible.baseUrl, cfg.openaiCompatible.apiKey);
    }
    return new GoogleAIProvider(cfg.google.apiKey);
  }

  hasApiKey(cfg: AxionConfig = this.getConfig()): boolean {
    if (cfg.activeProvider === 'openai-compatible') {
      return !!cfg.openaiCompatible.apiKey && !!cfg.openaiCompatible.baseUrl;
    }
    return !!cfg.google.apiKey;
  }

  buildSystemPrompt(memoryText: string): string {
    const cfg = this.getConfig();
    const parts: string[] = [
      'You are AXION, an autonomous AI assistant running inside a CLI terminal.',
      'You can call tools when needed to fetch up-to-date information or perform actions.',
      'Decide autonomously when to use tools based on the user intent.',
      'Answer clearly and concisely.',
    ];
    if (cfg.instructions) parts.push(`\n# Custom Instructions\n${cfg.instructions}`);
    if (memoryText) {
      parts.push(`\n# Long-term Memory (summarized facts about the user)\n${memoryText}`);
    }
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
      notice: this.notice,
    };

    let messages: ChatMessage[] = [...history];
    const MAX_ITER = 6;

    for (let i = 0; i < MAX_ITER; i++) {
      const res = await provider.chat({
        model: cfg.model,
        messages,
        systemPrompt,
        tools: this.tools.definitions(),
        thinkingLevel: cfg.thinkingLevel,
      });

      if (res.toolCalls && res.toolCalls.length) {
        messages.push({ role: 'assistant', content: res.content || '', toolCalls: res.toolCalls });
        for (const tc of res.toolCalls) {
          this.notice(`🔧 tool: ${tc.name}`);
          const result = await this.tools.execute(tc.name, tc.arguments, ctx);
          messages.push({
            role: 'tool',
            name: tc.name,
            toolCallId: tc.id,
            content: result.success ? result.output : `[tool error] ${result.output}`,
          });
        }
        continue;
      }
      return res.content || '(empty response)';
    }
    return '(stopped: tool loop limit reached)';
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