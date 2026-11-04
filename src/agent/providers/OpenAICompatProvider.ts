import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { BaseProvider } from './BaseProvider';
import {
  ProviderChatOptions,
  ProviderChatResult,
  ChatMessage,
  ToolCall,
} from '../../types';

export class OpenAICompatProvider implements BaseProvider {
  constructor(private baseUrl: string, private apiKey: string) {}

  async chat(opts: ProviderChatOptions): Promise<ProviderChatResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;

    const messages: Record<string, unknown>[] = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });

    for (const m of opts.messages) {
      if (m.role === 'system') continue;
      if (m.role === 'user') {
        messages.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        if (m.toolCalls && m.toolCalls.length) {
          messages.push({
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          });
        } else {
          messages.push({ role: 'assistant', content: m.content });
        }
      } else if (m.role === 'tool') {
        messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      }
    }

    const body: Record<string, unknown> = {
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.maxOutputTokens) body.max_tokens = opts.maxOutputTokens;
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools.map((td) => ({
        type: 'function',
        function: { name: td.name, description: td.description, parameters: td.parameters },
      }));
    }

    const res = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: 120000,
      validateStatus: (s) => s < 500,
    });

    if (res.status >= 400) {
      throw new Error(res.data?.error?.message || `HTTP ${res.status}`);
    }

    const msg = res.data?.choices?.[0]?.message;
    const content: string = msg?.content || '';
    const toolCalls: ToolCall[] = [];
    if (Array.isArray(msg?.tool_calls)) {
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          args = {};
        }
        toolCalls.push({
          id: tc.id || uuidv4(),
          name: tc.function?.name || '',
          arguments: args,
        });
      }
    }
    return { content, toolCalls, finishReason: res.data?.choices?.[0]?.finish_reason };
  }
}