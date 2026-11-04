import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { BaseProvider } from './BaseProvider';
import {
  ProviderChatOptions,
  ProviderChatResult,
  ChatMessage,
  ToolCall,
  THINKING_BUDGET,
  USER_AGENT,
} from '../../types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GoogleAIProvider implements BaseProvider {
  constructor(private apiKey: string) {}

  async chat(opts: ProviderChatOptions): Promise<ProviderChatResult> {
    const wantsThinking = !!opts.thinkingLevel && opts.thinkingLevel !== 'off';
    try {
      return await this.request(opts, wantsThinking);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // If the model/config rejects thinkingConfig, retry without it.
      if (wantsThinking && /thinking|INVALID_ARGUMENT/i.test(msg)) {
        return this.request(opts, false);
      }
      throw new Error(msg);
    }
  }

  private async request(
    opts: ProviderChatOptions,
    includeThinking: boolean,
  ): Promise<ProviderChatResult> {
    const generationConfig: Record<string, unknown> = {
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.maxOutputTokens) generationConfig.maxOutputTokens = opts.maxOutputTokens;
    if (includeThinking && opts.thinkingLevel && opts.thinkingLevel !== 'off') {
      generationConfig.thinkingConfig = {
        thinkingBudget: THINKING_BUDGET[opts.thinkingLevel],
      };
    }

    const body: Record<string, unknown> = {
      contents: this.buildContents(opts.messages),
      generationConfig,
    };
    if (opts.systemPrompt) {
      body.systemInstruction = { parts: [{ text: opts.systemPrompt }] };
    }
    if (opts.tools && opts.tools.length) {
      body.tools = [
        {
          functionDeclarations: opts.tools.map((td) => ({
            name: td.name,
            description: td.description,
            parameters: td.parameters,
          })),
        },
      ];
    }

    const url = `${BASE}/models/${encodeURIComponent(opts.model)}:generateContent`;
    const res = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
        'User-Agent': USER_AGENT,
      },
      timeout: 120000,
      validateStatus: (s) => s < 500,
    });

    if (res.status >= 400) {
      const m = res.data?.error?.message || `HTTP ${res.status}`;
      throw new Error(m);
    }

    const cand = res.data?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    let content = '';
    const toolCalls: ToolCall[] = [];
    for (const p of parts) {
      if (typeof p.text === 'string') content += p.text;
      if (p.functionCall) {
        toolCalls.push({
          id: uuidv4(),
          name: p.functionCall.name,
          arguments: p.functionCall.args || {},
        });
      }
    }
    return { content, toolCalls, finishReason: cand?.finishReason };
  }

  private buildContents(messages: ChatMessage[]): unknown[] {
    const contents: unknown[] = [];
    for (const m of messages) {
      if (m.role === 'system') continue; // handled via systemInstruction
      if (m.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: m.content }] });
      } else if (m.role === 'assistant') {
        const parts: unknown[] = [];
        if (m.content) parts.push({ text: m.content });
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          }
        }
        if (parts.length) contents.push({ role: 'model', parts });
      } else if (m.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            { functionResponse: { name: m.name || 'tool', response: { result: m.content } } },
          ],
        });
      }
    }
    return contents;
  }
}