import axios from 'axios';
import { randomUUID } from 'node:crypto';
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
    let base: URL;
    try {
      base = new URL(this.baseUrl);
    } catch {
      throw new Error('Invalid OpenAI-compatible base URL. Use an absolute HTTP or HTTPS URL.');
    }
    if ((base.protocol !== 'https:' && base.protocol !== 'http:') || base.username || base.password) {
      throw new Error('OpenAI-compatible base URL must use HTTP/HTTPS and must not contain credentials.');
    }
    const url = `${base.toString().replace(/\/$/, '')}/chat/completions`;

    const messages: Record<string, unknown>[] = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });

    for (const message of opts.messages) {
      if (message.role === 'system') continue;
      if (message.role === 'user') {
        messages.push({ role: 'user', content: message.content });
      } else if (message.role === 'assistant') {
        if (message.toolCalls && message.toolCalls.length) {
          messages.push({
            role: 'assistant',
            content: message.content || null,
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'function',
              function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
            })),
          });
        } else {
          messages.push({ role: 'assistant', content: message.content });
        }
      } else if (message.role === 'tool') {
        if (!message.toolCallId) throw new Error('Tool result is missing its tool_call_id.');
        messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
      }
    }

    const body: Record<string, unknown> = {
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.maxOutputTokens !== undefined) body.max_tokens = opts.maxOutputTokens;
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools.map((definition) => ({
        type: 'function',
        function: { name: definition.name, description: definition.description, parameters: definition.parameters },
      }));
    }

    const res = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: 120000,
      validateStatus: (status) => status < 500,
    });

    if (res.status >= 400) {
      throw new Error(res.data?.error?.message || `OpenAI-compatible provider returned HTTP ${res.status}`);
    }

    const choice = res.data?.choices?.[0];
    if (!choice?.message) throw new Error('OpenAI-compatible provider returned no assistant message.');
    const responseMessage = choice.message;
    const content = typeof responseMessage.content === 'string' ? responseMessage.content : '';
    const toolCalls: ToolCall[] = [];
    if (Array.isArray(responseMessage.tool_calls)) {
      for (const call of responseMessage.tool_calls) {
        const name = call.function?.name;
        if (typeof name !== 'string' || !name) continue;
        let args: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(call.function?.arguments || '{}');
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Tool arguments must be a JSON object.');
          }
          args = parsed as Record<string, unknown>;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Invalid arguments returned for tool ${name}: ${message}`);
        }
        toolCalls.push({ id: call.id || randomUUID(), name, arguments: args });
      }
    }
    return { content, toolCalls, finishReason: choice.finish_reason };
  }
}
