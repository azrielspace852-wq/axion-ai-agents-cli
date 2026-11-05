import axios from 'axios';
import { randomUUID } from 'node:crypto';
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

function buildThinkingConfig(model: string, level: ProviderChatOptions['thinkingLevel']): Record<string, unknown> | undefined {
  if (!level) return undefined;
  if (/^gemma-4-/i.test(model)) {
    // Gemma 4 exposes a binary thinking switch: MINIMAL does NOT disable thinking.
    // When the user selects 'off', omit thinkingConfig entirely so the provider uses its non-thinking default.
    if (level === 'off') return undefined;
    return { thinkingLevel: 'HIGH' };
  }
  if (/^gemini-3(?:\.|-)/i.test(model)) {
    if (level === 'off') return undefined;
    const thinkingLevel = level === 'max' ? 'HIGH' : level.toUpperCase();
    return { thinkingLevel };
  }
  if (/^gemini-2\.5-/i.test(model)) {
    if (level === 'off') {
      // Gemini 2.5 Flash families accept 0; Gemini 2.5 Pro does not support disabling thinking.
      return /^gemini-2\.5-(?:flash|flash-lite)/i.test(model) ? { thinkingBudget: 0 } : undefined;
    }
    const thinkingBudget = level === 'max' ? -1 : THINKING_BUDGET[level];
    return { thinkingBudget };
  }
  // Do not send Gemini-specific thinking parameters to other providers/models.
  return undefined;
}

export class GoogleAIProvider implements BaseProvider {
  constructor(private apiKey: string) {}

  async chat(opts: ProviderChatOptions): Promise<ProviderChatResult> {
    const thinkingConfig = buildThinkingConfig(opts.model, opts.thinkingLevel);
    try {
      return await this.request(opts, thinkingConfig);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Retry only when the provider explicitly rejects a thinking parameter.
      if (thinkingConfig && /thinkingConfig|thinkingBudget|thinkingLevel/i.test(msg)) {
        return this.request(opts, undefined);
      }
      throw new Error(msg);
    }
  }

  private async request(
    opts: ProviderChatOptions,
    thinkingConfig?: Record<string, unknown>,
  ): Promise<ProviderChatResult> {
    const isGemini3 = /^gemini-3(?:\.|-)/i.test(opts.model);
    const generationConfig: Record<string, unknown> = {};
    // Gemini 3 guidance recommends omitting sampling parameters and using provider defaults.
    if (!isGemini3) generationConfig.temperature = opts.temperature ?? 0.7;
    if (opts.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = opts.maxOutputTokens;
    if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;

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
          functionDeclarations: opts.tools.map((definition) => ({
            name: definition.name,
            description: definition.description,
            parameters: definition.parameters,
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
      validateStatus: (status) => status < 500,
    });

    if (res.status >= 400) {
      const message = res.data?.error?.message || `Google AI API returned HTTP ${res.status}`;
      throw new Error(message);
    }

    const candidate = res.data?.candidates?.[0];
    if (!candidate) {
      const blockReason = res.data?.promptFeedback?.blockReason;
      throw new Error(blockReason
        ? `Google AI request was blocked: ${blockReason}`
        : 'Google AI API returned no candidate response.');
    }

    const parts = candidate.content?.parts || [];
    let content = '';
    const toolCalls: ToolCall[] = [];
    for (const part of parts) {
      if (typeof part.text === 'string') content += part.text;
      if (part.functionCall && typeof part.functionCall.name === 'string') {
        toolCalls.push({
          id: randomUUID(),
          name: part.functionCall.name,
          arguments: part.functionCall.args && typeof part.functionCall.args === 'object' && !Array.isArray(part.functionCall.args)
            ? part.functionCall.args as Record<string, unknown>
            : {},
          providerCallId: typeof part.functionCall.id === 'string' ? part.functionCall.id : undefined,
          thoughtSignature: typeof part.thoughtSignature === 'string' ? part.thoughtSignature : undefined,
        });
      }
    }
    return { content, toolCalls, finishReason: candidate.finishReason, providerParts: parts };
  }

  private buildContents(messages: ChatMessage[]): unknown[] {
    const contents: unknown[] = [];
    const pendingFunctionResponses: unknown[] = [];
    const flushFunctionResponses = (): void => {
      if (pendingFunctionResponses.length) {
        // Gemini expects parallel function responses together in one user Content,
        // preserving the order of the corresponding functionCall parts.
        contents.push({ role: 'user', parts: [...pendingFunctionResponses] });
        pendingFunctionResponses.length = 0;
      }
    };

    for (const message of messages) {
      if (message.role === 'system') continue; // system prompt is sent as systemInstruction
      if (message.role === 'tool') {
        pendingFunctionResponses.push({
          functionResponse: {
            name: message.name || 'tool',
            response: { result: message.content },
            ...(message.providerCallId ? { id: message.providerCallId } : {}),
          },
        });
        continue;
      }

      flushFunctionResponses();
      if (message.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: message.content }] });
      } else if (message.role === 'assistant') {
        if (message.providerParts && message.providerParts.length) {
          // Return raw model parts verbatim: Gemini thought signatures are position-sensitive.
          contents.push({ role: 'model', parts: message.providerParts });
          continue;
        }
        const parts: unknown[] = [];
        if (message.content) parts.push({ text: message.content });
        if (message.toolCalls) {
          for (const toolCall of message.toolCalls) {
            parts.push({
              functionCall: {
                name: toolCall.name,
                args: toolCall.arguments,
                ...(toolCall.providerCallId ? { id: toolCall.providerCallId } : {}),
              },
              ...(toolCall.thoughtSignature ? { thoughtSignature: toolCall.thoughtSignature } : {}),
            });
          }
        }
        if (parts.length) contents.push({ role: 'model', parts });
      }
    }
    flushFunctionResponses();
    return contents;
  }
}
