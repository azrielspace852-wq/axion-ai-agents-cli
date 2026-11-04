// Shared types & constants for AXION AI Agents CLI

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;          // function/tool name for tool results
  toolCallId?: string;    // internal correlation ID for tool results
  providerCallId?: string; // provider-issued function call ID (Google functionResponse.id)
  toolCalls?: ToolCall[]; // assistant message requesting tools
  providerParts?: unknown[]; // raw provider parts; needed to preserve Gemini thought signatures
  timestamp?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  providerCallId?: string;
  thoughtSignature?: string;
}

export interface ToolParamSchema {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParamSchema>;
  required?: string[];
  items?: ToolParamSchema;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParamSchema>;
    required?: string[];
  };
}

export interface ToolExecutionContext {
  permissions: PermissionSettings;
  cwd: string;
  notice?: (msg: string) => void;
}

export interface ToolResult {
  success: boolean;
  output: string;
}

export interface AgentTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>;
}

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export interface PermissionSettings {
  webAccess: boolean;
  searchAccess: boolean;
  shellExec: boolean;
  fileRead: boolean;
  fileWrite: boolean;
}

export type ProviderType = 'google-ai-studio' | 'openai-compatible';

export interface CustomModel {
  id: string;      // model id sent to the provider
  label: string;   // display label
  provider: ProviderType;
}

export interface AxionConfig {
  version: 1;
  language: 'en' | 'id';
  activeProvider: ProviderType;
  google: { apiKey: string };
  openaiCompatible: { baseUrl: string; apiKey: string };
  model: string;                 // currently selected model id
  customModels: CustomModel[];
  thinkingLevel: ThinkingLevel;
  instructions: string;          // custom system prompt
  permissions: PermissionSettings;
}

export interface ProviderChatOptions {
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ProviderChatResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  providerParts?: unknown[];
}

// Owner-specified default models (from project spec).
export const DEFAULT_MODELS: CustomModel[] = [
  { id: 'gemma-4-31b-it',        label: 'Gemma 4 31B IT',        provider: 'google-ai-studio' },
  { id: 'gemma-4-26b-a4b-it',    label: 'Gemma 4 26B A4B IT',    provider: 'google-ai-studio' },
  { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash',      provider: 'google-ai-studio' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', provider: 'google-ai-studio' },
  { id: 'gemini-3.8-flash',      label: 'Gemini 3.8 Flash',      provider: 'google-ai-studio' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', provider: 'google-ai-studio' },
];

export const DEFAULT_MODEL_ID = 'gemini-3.5-flash';

export const DEFAULT_PERMISSIONS: PermissionSettings = {
  webAccess: true,
  searchAccess: true,
  shellExec: false, // default-deny for safety
  fileRead: true,
  fileWrite: false,
};

export const THINKING_BUDGET: Record<Exclude<ThinkingLevel, 'off'>, number> = {
  low: 1024,
  medium: 4096,
  high: 10240,
  max: -1, // dynamic
};

export const USER_AGENT =
  'Mozilla/5.0 (compatible; AxionCLI/1.0; +https://github.com/azrielspace852-wq/axion-ai-agents-cli)';

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';