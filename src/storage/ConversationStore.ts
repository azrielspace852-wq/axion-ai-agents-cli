import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CONVERSATIONS_DIR } from '../config/paths';

export interface ConversationMessage {
  'message-number': number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ConversationFile {
  'conversation-id': string;
  'conversation-name': string;
  messages: ConversationMessage[];
}

export class ConversationStore {
  private ensure(): void {
    fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  }

  private fileFor(id: string): string {
    return path.join(CONVERSATIONS_DIR, `${id}.json`);
  }

  create(name?: string): ConversationFile {
    this.ensure();
    const doc: ConversationFile = {
      'conversation-id': uuidv4(),
      'conversation-name': name || `Chat ${new Date().toISOString()}`,
      messages: [],
    };
    this.write(doc);
    return doc;
  }

  write(doc: ConversationFile): void {
    this.ensure();
    fs.writeFileSync(this.fileFor(doc['conversation-id']), JSON.stringify(doc, null, 2), 'utf8');
  }

  load(id: string): ConversationFile | null {
    try {
      const p = this.fileFor(id);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8')) as ConversationFile;
    } catch {
      return null;
    }
  }

  list(): ConversationFile[] {
    this.ensure();
    const files = fs.readdirSync(CONVERSATIONS_DIR).filter((f) => f.endsWith('.json'));
    const docs = files
      .map((f) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(CONVERSATIONS_DIR, f), 'utf8'),
          ) as ConversationFile;
        } catch {
          return null;
        }
      })
      .filter((d): d is ConversationFile => !!d);
    return docs.sort((a, b) => {
      const la = a.messages[a.messages.length - 1]?.timestamp || '';
      const lb = b.messages[b.messages.length - 1]?.timestamp || '';
      return lb.localeCompare(la);
    });
  }

  delete(id: string): void {
    const p = this.fileFor(id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  backup(id: string): string | null {
    const doc = this.load(id);
    if (!doc) return null;
    const dir = path.join(CONVERSATIONS_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${id}.backup.json`);
    fs.writeFileSync(dest, JSON.stringify(doc, null, 2), 'utf8');
    return dest;
  }

  appendMessage(
    doc: ConversationFile,
    role: ConversationMessage['role'],
    content: string,
  ): void {
    const n = doc.messages.length + 1;
    doc.messages.push({
      'message-number': n,
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    this.write(doc);
  }
}