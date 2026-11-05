import type { AxionConfig } from '../types';
import type { ConversationStore } from '../storage/ConversationStore';
import type { MemoryStore } from '../storage/MemoryStore';
import type { Agent } from '../agent/Agent';

export interface ReplLike {
  print(msg: string): void;
  question(q: string): Promise<string>;
  questionSecret(q: string): Promise<string>;
  select(prompt: string, options: string[]): Promise<number | null>;
  clearScreen(): void;
  exit(code?: number): void;
  resetContext(): void;
  openConversation(id: string): boolean;
  newConversation(): void;
  currentConversationId(): string;
}

export interface CommandContext {
  args: string;
  config: AxionConfig;
  saveConfig(): void;
  repl: ReplLike;
  conversations: ConversationStore;
  memories: MemoryStore;
  agent: Agent;
}

export interface HandlerResult {
  exit?: boolean;
}