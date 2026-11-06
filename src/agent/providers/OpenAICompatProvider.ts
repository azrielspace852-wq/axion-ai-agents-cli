import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { BaseProvider } from './BaseProvider';
import { consumeResponseStream } from './streamHelper';
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
      stream: true,
    };
    if (opts.maxOutputTokens !== undefined) body.max_tokens = opts.maxOutputTokens;
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools.map((definition) => ({
        type: 'function',
        function: { name: definition.name, description: definition.description, parameters: definition.parameters },
      }));
    }
    // No flat total timeout: streaming + idle watchdog in consumeResponseStream.
    const res = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'text/event-stream',
      },
      responseType: 'stream',
      validateStatus: () => true, // error body is read from the stream itself
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    // Accumulators for the streamed deltas.
    let content = '';
    let finishReason: string | undefined;
    const toolCallParts: Array<{ id?: string; name?: string; arguments: string }> = [];
    const onChunk = opts.onChunk;
    const result = await consumeResponseStream(
      res,
      opts.signal,
      (parsed) => {
        const ev = parsed as { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; 'function'?: { name?: string; arguments?: string } }> }; finish_reason?: string }> };
        const choice = ev.choices?.[0];
        if (!choice) return;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta;
        if (!delta) return;
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          onChunk?.({ type: 'delta', text: delta.content });
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === 'number' ? tc.index : 0;
            if (!toolCallParts[idx]) toolCallParts[idx] = { arguments: '' };
            if (typeof tc.id === 'string') toolCallParts[idx].id = tc.id;
            if (typeof tc.function?.name === 'string') {
              toolCallParts[idx].name = tc.function.name;
              onChunk?.({ type: 'tool_call', toolName: tc.function.name });
            }
            if (typeof tc.function?.arguments === 'string') toolCallParts[idx].arguments += tc.function.arguments;
          }
        }
      },
      () => { /* heartbeat resets the watchdog inside consumeResponseStream */ },
    );
    onChunk?.({ type: 'done' });
    if (result.mode === 'object' || result.mode === 'json') {
      // Non-stream fallback: the provider ignored stream:true and returned one JSON document.
      const data = result.data as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; 'function'?: { name?: string; arguments?: string } }> }; finish_reason?: string }> };
      const choice = data?.choices?.[0];
      if (!choice?.message) throw new Error('OpenAI-compatible provider returned no assistant message.');
      const responseMessage = choice.message;
      content = typeof responseMessage.content === 'string' ? responseMessage.content : '';
      finishReason = choice.finish_reason;
      toolCallParts.length = 0;
      if (Array.isArray(responseMessage.tool_calls)) {
        for (const call of responseMessage.tool_calls) {
          toolCallParts.push({
            id: call.id,
            name: call.function?.name,
            arguments: typeof call.function?.arguments === 'string' ? call.function.arguments : '{}',
          });
        }
      }
    }
    const toolCalls: ToolCall[] = [];
    for (const part of toolCallParts) {
      if (!part.name) continue;
      let args: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(part.arguments || '{}');
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Tool arguments must be a JSON object.');
        }
        args = parsed as Record<string, unknown>;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid arguments returned for tool ${part.name}: ${message}`);
      }
      toolCalls.push({ id: part.id || randomUUID(), name: part.name, arguments: args });
    }
    return { content, toolCalls, finishReason };
  }
}
