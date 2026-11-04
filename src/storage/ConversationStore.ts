import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CONVERSATIONS_DIR } from '../config/paths';
import { ensurePrivateDir, writeJsonAtomically } from '../utils/jsonFile';
import type { ChatMessage } from '../types';

export interface ConversationMessage {
  'message-number': number;
  role: ChatMessage['role'];
  content: string;
  timestamp: string;
  name?: string;
  toolCallId?: string;
  providerCallId?: string;
  toolCalls?: ChatMessage['toolCalls'];
  providerParts?: unknown[];
}

export interface ConversationFile {
  'conversation-id': string;
  'conversation-name': string;
  messages: ConversationMessage[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isConversationFile(value: unknown): value is ConversationFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const doc = value as Record<string, unknown>;
  if (typeof doc['conversation-id'] !== 'string' || !UUID_PATTERN.test(doc['conversation-id'])) return false;
  if (typeof doc['conversation-name'] !== 'string' || !Array.isArray(doc.messages)) return false;
  return doc.messages.every((message: unknown) => {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return false;
    const item = message as Record<string, unknown>;
    return Number.isInteger(item['message-number']) &&
      (item.role === 'user' || item.role === 'assistant' || item.role === 'system' || item.role === 'tool') &&
      typeof item.content === 'string' && typeof item.timestamp === 'string' &&
      (item.name === undefined || typeof item.name === 'string') &&
      (item.toolCallId === undefined || typeof item.toolCallId === 'string') &&
      (item.providerCallId === undefined || typeof item.providerCallId === 'string') &&
      (item.toolCalls === undefined || Array.isArray(item.toolCalls)) &&
      (item.providerParts === undefined || Array.isArray(item.providerParts));
  });
}

export class ConversationStore {
  private ensure(): void {
    ensurePrivateDir(CONVERSATIONS_DIR);
  }

  private fileFor(id: string): string {
    if (!UUID_PATTERN.test(id)) throw new Error('Invalid conversation ID.');
    return path.join(CONVERSATIONS_DIR, `${id}.json`);
  }

  create(name?: string): ConversationFile {
    this.ensure();
    const doc: ConversationFile = {
      'conversation-id': uuidv4(),
      'conversation-name': name?.trim() || `Chat ${new Date().toISOString()}`,
      messages: [],
    };
    this.write(doc);
    return doc;
  }

  write(doc: ConversationFile): void {
    this.ensure();
    if (!isConversationFile(doc)) throw new Error('Invalid conversation data.');
    writeJsonAtomically(this.fileFor(doc['conversation-id']), doc);
  }

  load(id: string): ConversationFile | null {
    try {
      const raw = fs.readFileSync(this.fileFor(id), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return isConversationFile(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  list(): ConversationFile[] {
    this.ensure();
    const docs = fs.readdirSync(CONVERSATIONS_DIR)
      .filter((file) => file.endsWith('.json') && UUID_PATTERN.test(file.slice(0, -5)))
      .map((file) => {
        try {
          const parsed: unknown = JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, file), 'utf8'));
          return isConversationFile(parsed) ? parsed : null;
        } catch {
          return null;
        }
      })
      .filter((doc): doc is ConversationFile => doc !== null);

    return docs.sort((a, b) => {
      const lastA = a.messages[a.messages.length - 1]?.timestamp || '';
      const lastB = b.messages[b.messages.length - 1]?.timestamp || '';
      return lastB.localeCompare(lastA);
    });
  }

  delete(id: string): void {
    try {
      const filePath = this.fileFor(id);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Invalid IDs are ignored; callers cannot use this method to escape the data directory.
    }
  }

  backup(id: string): string | null {
    const doc = this.load(id);
    if (!doc) return null;
    const dir = path.join(CONVERSATIONS_DIR, 'backups');
    ensurePrivateDir(dir);
    const dest = path.join(dir, `${id}.backup.json`);
    writeJsonAtomically(dest, doc);
    return dest;
  }

  appendMessage(
    doc: ConversationFile,
    role: ConversationMessage['role'],
    content: string,
    metadata: Partial<ChatMessage> = {},
  ): void {
    const nextNumber = doc.messages.reduce((max, item) => Math.max(max, item['message-number']), 0) + 1;
    doc.messages.push({
      'message-number': nextNumber,
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(metadata.name ? { name: metadata.name } : {}),
      ...(metadata.toolCallId ? { toolCallId: metadata.toolCallId } : {}),
      ...(metadata.providerCallId ? { providerCallId: metadata.providerCallId } : {}),
      ...(metadata.toolCalls ? { toolCalls: metadata.toolCalls } : {}),
      ...(metadata.providerParts ? { providerParts: metadata.providerParts } : {}),
    });
    this.write(doc);
  }
}
