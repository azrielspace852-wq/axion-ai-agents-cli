import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { MEMORY_DIR } from '../config/paths';
import { ensurePrivateDir, writeJsonAtomically } from '../utils/jsonFile';

export interface MemoryEntry {
  'memory-number': number;
  content: string;
  timestamp: string;
}

export interface MemoryFile {
  'memory-id': string;
  about: string;
  memories: MemoryEntry[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMemoryFile(value: unknown): value is MemoryFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const doc = value as Record<string, unknown>;
  if (typeof doc['memory-id'] !== 'string' || !UUID_PATTERN.test(doc['memory-id'])) return false;
  if (typeof doc.about !== 'string' || !Array.isArray(doc.memories)) return false;
  return doc.memories.every((memory: unknown) => {
    if (typeof memory !== 'object' || memory === null || Array.isArray(memory)) return false;
    const item = memory as Record<string, unknown>;
    return Number.isInteger(item['memory-number']) &&
      typeof item.content === 'string' && typeof item.timestamp === 'string';
  });
}

export class MemoryStore {
  private ensure(): void {
    ensurePrivateDir(MEMORY_DIR);
  }

  private fileFor(id: string): string {
    if (!UUID_PATTERN.test(id)) throw new Error('Invalid memory ID.');
    return path.join(MEMORY_DIR, `${id}.json`);
  }

  list(): MemoryFile[] {
    this.ensure();
    return fs.readdirSync(MEMORY_DIR)
      .filter((file) => file.endsWith('.json') && UUID_PATTERN.test(file.slice(0, -5)))
      .map((file) => {
        try {
          const parsed: unknown = JSON.parse(fs.readFileSync(path.join(MEMORY_DIR, file), 'utf8'));
          return isMemoryFile(parsed) ? parsed : null;
        } catch {
          return null;
        }
      })
      .filter((memory): memory is MemoryFile => memory !== null);
  }

  load(id: string): MemoryFile | null {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.fileFor(id), 'utf8'));
      return isMemoryFile(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  write(doc: MemoryFile): void {
    this.ensure();
    if (!isMemoryFile(doc)) throw new Error('Invalid memory data.');
    writeJsonAtomically(this.fileFor(doc['memory-id']), doc);
  }

  findOrCreate(about: string): MemoryFile {
    const topic = about.trim();
    if (!topic) throw new Error('Memory topic cannot be empty.');
    const found = this.list().find((memory) => memory.about.toLowerCase() === topic.toLowerCase());
    if (found) return found;
    const doc: MemoryFile = { 'memory-id': uuidv4(), about: topic, memories: [] };
    this.write(doc);
    return doc;
  }

  add(about: string, content: string): MemoryFile {
    const text = content.trim();
    if (!text) throw new Error('Memory content cannot be empty.');
    const doc = this.findOrCreate(about);
    const nextNumber = doc.memories.reduce((max, item) => Math.max(max, item['memory-number']), 0) + 1;
    doc.memories.push({ 'memory-number': nextNumber, content: text, timestamp: new Date().toISOString() });
    this.write(doc);
    return doc;
  }

  delete(id: string): void {
    try {
      const filePath = this.fileFor(id);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Ignore invalid IDs to prevent path traversal.
    }
  }

  deleteEntry(id: string, num: number): MemoryFile | null {
    const doc = this.load(id);
    if (!doc || !Number.isInteger(num) || num < 1) return null;
    doc.memories = doc.memories
      .filter((memory) => memory['memory-number'] !== num)
      .map((memory, index) => ({ ...memory, 'memory-number': index + 1 }));
    this.write(doc);
    return doc;
  }

  clear(): void {
    this.ensure();
    for (const file of fs.readdirSync(MEMORY_DIR).filter((name) => name.endsWith('.json'))) {
      fs.unlinkSync(path.join(MEMORY_DIR, file));
    }
  }

  toPromptText(): string {
    return this.list()
      .filter((memory) => memory.memories.length > 0)
      .map((memory) => `## ${memory.about}\n${memory.memories.map((item) => `- ${item.content}`).join('\n')}`)
      .join('\n\n');
  }
}
