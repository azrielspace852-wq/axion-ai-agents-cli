import fs from 'fs';
import path from 'path';
import { AgentTool, ToolResult } from '../../types';

// Resolve a path against the workspace; enforce workspace scope when active.
function resolvePath(input: string, ctx: { cwd: string; accessScope: string }): { ok: true; abs: string } | { ok: false; error: string } {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'Empty path.' };
  let abs: string;
  try {
    abs = path.resolve(ctx.cwd, raw);
    abs = fs.realpathSync(path.dirname(abs)) + path.sep + path.basename(abs);
  } catch {
    try { abs = path.resolve(ctx.cwd, raw); } catch { return { ok: false, error: `Invalid path: ${raw}` }; }
  }
  if (ctx.accessScope === 'workspace') {
    const root = fs.realpathSync(ctx.cwd);
    if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) {
      return { ok: false, error: `Workspace scope blocks path outside the workspace: ${abs}` };
    }
  }
  return { ok: true, abs };
}

async function confirmDangerous(ctx: { confirm?: (q: string) => Promise<boolean>; dangerousActionPolicy?: string }, question: string): Promise<boolean> {
  const policy = ctx.dangerousActionPolicy || 'always-ask';
  if (policy === 'always-allow') return true;
  if (policy === 'always-deny') return false;
  // always-ask (default)
  if (!ctx.confirm) return false; // no confirmation channel available → refuse by default
  return ctx.confirm(question);
}

export const ListDirTool: AgentTool = {
  definition: {
    name: 'list_dir',
    description: 'List the contents of a directory. Requires fileRead permission. In workspace scope, paths outside the workspace are blocked.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path (relative or absolute)' },
      },
      required: ['path'],
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.permissions.fileRead) return { success: false, output: 'Permission denied: fileRead is disabled. Enable it via /permissions.' };
    const resolved = resolvePath(String(args.path || ''), ctx);
    if (!resolved.ok) return { success: false, output: resolved.error };
    try {
      const entries = fs.readdirSync(resolved.abs, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
      const files = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
      const lines = [
        `Directory: ${resolved.abs}`,
        `[${dirs.length} dirs] ${dirs.join('  ')}`,
        `[${files.length} files] ${files.slice(0, 200).join('  ')}${files.length > 200 ? ` …(+${files.length - 200} more)` : ''}`,
      ];
      return { success: true, output: lines.join('\n') };
    } catch (e) {
      return { success: false, output: `list_dir failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

export const ReadFileTool: AgentTool = {
  definition: {
    name: 'read_file',
    description: 'Read the contents of a text file. Requires fileRead permission. Large files are truncated with a note.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.permissions.fileRead) return { success: false, output: 'Permission denied: fileRead is disabled.' };
    const resolved = resolvePath(String(args.path || ''), ctx);
    if (!resolved.ok) return { success: false, output: resolved.error };
    try {
      const stat = fs.statSync(resolved.abs);
      if (!stat.isFile()) return { success: false, output: `Not a file: ${resolved.abs}` };
      let content = fs.readFileSync(resolved.abs, 'utf8');
      const truncated = content.length > 16000;
      if (truncated) content = content.slice(0, 16000) + '\n…[truncated, file is larger]';
      return { success: true, output: `File: ${resolved.abs} (${stat.size} bytes)${truncated ? ' — TRUNCATED' : ''}\n${content}` };
    } catch (e) {
      return { success: false, output: `read_file failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

export const WriteFileTool: AgentTool = {
  definition: {
    name: 'write_file',
    description: 'Create or overwrite a text file atomically (temp file + rename). Requires fileWrite permission. Overwriting an existing file is a dangerous action and may require confirmation. Returns a summary, not the full content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.permissions.fileWrite) return { success: false, output: 'Permission denied: fileWrite is disabled. Enable it via /permissions.' };
    const resolved = resolvePath(String(args.path || ''), ctx);
    if (!resolved.ok) return { success: false, output: resolved.error };
    const content = String(args.content ?? '');
    const existed = fs.existsSync(resolved.abs);
    if (existed) {
      const ok = await confirmDangerous(ctx as never, `Overwrite existing file ${resolved.abs}?`);
      if (!ok) return { success: false, output: `[blocked] Overwrite of ${resolved.abs} was not confirmed.` };
    }
    try {
      const dir = path.dirname(resolved.abs);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${resolved.abs}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, content, { mode: 0o600 });
      fs.renameSync(tmp, resolved.abs); // atomic on same filesystem
      return { success: true, output: `${existed ? 'Modified' : 'Created'}: ${resolved.abs} (${Buffer.byteLength(content, 'utf8')} bytes)` };
    } catch (e) {
      return { success: false, output: `write_file failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

export const DeleteFileTool: AgentTool = {
  definition: {
    name: 'delete_file',
    description: 'Delete a file. Requires fileWrite permission. Deletion is a dangerous action and requires confirmation unless policy allows. Returns a summary.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete' },
      },
      required: ['path'],
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.permissions.fileWrite) return { success: false, output: 'Permission denied: fileWrite is disabled.' };
    const resolved = resolvePath(String(args.path || ''), ctx);
    if (!resolved.ok) return { success: false, output: resolved.error };
    const ok = await confirmDangerous(ctx as never, `Delete file ${resolved.abs}? This cannot be undone.`);
    if (!ok) return { success: false, output: `[blocked] Deletion of ${resolved.abs} was not confirmed.` };
    try {
      if (!fs.existsSync(resolved.abs)) return { success: false, output: `File does not exist: ${resolved.abs}` };
      fs.unlinkSync(resolved.abs);
      return { success: true, output: `Deleted: ${resolved.abs}` };
    } catch (e) {
      return { success: false, output: `delete_file failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

export const FileSystemTools = [ListDirTool, ReadFileTool, WriteFileTool, DeleteFileTool];
