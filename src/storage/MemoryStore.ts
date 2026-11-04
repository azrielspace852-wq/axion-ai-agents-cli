import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { MEMORY_DIR } from '../config/paths';

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

export class MemoryStore {
  private ensure(): void {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }

  private fileFor(id: string): string {
    return path.join(MEMORY_DIR, `${id}.json`);
  }

  list(): MemoryFile[] {
    this.ensure();
    return fs
      .readdirSync(MEMORY_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(MEMORY_DIR, f), 'utf8')) as MemoryFile;
        } catch {
          return null;
        }
      })
      .filter((m): m is MemoryFile => !!m);
  }

  load(id: string): MemoryFile | null {
    try {
      const p = this.fileFor(id);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8')) as MemoryFile;
    } catch {
      return null;
    }
  }

  write(doc: MemoryFile): void {
    this.ensure();
    fs.writeFileSync(this.fileFor(doc['memory-id']), JSON.stringify(doc, null, 2), 'utf8');
  }

  findOrCreate(about: string): MemoryFile {
    const found = this.list().find((m) => m.about.toLowerCase() === about.toLowerCase());
    if (found) return found;
    const doc: MemoryFile = { 'memory-id': uuidv4(), about, memories: [] };
    this.write(doc);
    return doc;
  }

  add(about: string, content: string): MemoryFile {
    const doc = this.findOrCreate(about);
    const n = doc.memories.length + 1;
    doc.memories.push({ 'memory-number': n, content, timestamp: new Date().toISOString() });
    this.write(doc);
    return doc;
  }

  delete(id: string): void {
    const p = this.fileFor(id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  deleteEntry(id: string, num: number): MemoryFile | null {
    const doc = this.load(id);
    if (!doc) return null;
    doc.memories = doc.memories
      .filter((m) => m['memory-number'] !== num)
      .map((m, i) => ({ ...m, 'memory-number': i + 1 }));
    this.write(doc);
    return doc;
  }

  clear(): void {
    this.ensure();
    for (const f of fs.readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.json'))) {
      fs.unlinkSync(path.join(MEMORY_DIR, f));
    }
  }

  toPromptText(): string {
    const list = this.list();
    if (!list.length) return '';
    return list
      .map((m) => `## ${m.about}\n` + m.memories.map((x) => `- ${x.content}`).join('\n'))
      .join('\n\n');
  }
}