import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentTool, ToolResult } from '../../types';

export const ShellTool: AgentTool = {
  definition: {
    name: 'run_shell',
    description:
      'Execute a shell command on the local machine and return stdout/stderr. Requires the shellExec permission (enabled by default on fresh configurations). In workspace scope, use the workspace as the working directory and avoid paths outside it; this is an agent policy, not an OS sandbox.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        cwd: { type: 'string', description: 'Optional working directory' },
      },
      required: ['command'],
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.permissions.shellExec) {
      return {
        success: false,
        output:
          'Permission denied: shellExec is disabled. Enable it via /permissions if you trust this operation.',
      };
    }
    const command = String(args.command || '').trim();
    if (!command) return { success: false, output: 'Empty command.' };
    const workspaceRoot = path.resolve(ctx.cwd);
    const requestedCwd = path.resolve(String(args.cwd || workspaceRoot));
    let cwd: string;
    let realWorkspaceRoot: string;
    try {
      realWorkspaceRoot = fs.realpathSync(workspaceRoot);
      cwd = fs.realpathSync(requestedCwd);
      if (!fs.statSync(cwd).isDirectory()) {
        return { success: false, output: `Working directory is not a directory: ${cwd}` };
      }
    } catch {
      return { success: false, output: `Working directory does not exist or is inaccessible: ${requestedCwd}` };
    }
    if (ctx.accessScope === 'workspace' && cwd !== realWorkspaceRoot && !cwd.startsWith(`${realWorkspaceRoot}${path.sep}`)) {
      return { success: false, output: `Workspace access scope blocks working directory outside the workspace: ${cwd}` };
    }

    return new Promise((resolve) => {
      exec(command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        let out = '';
        if (stdout) out += stdout;
        if (stderr) out += (out ? '\n' : '') + stderr;
        if (err) out += (out ? '\n' : '') + `[exit error] ${err.message}`;
        out = out.trim() || '(no output)';
        if (out.length > 8000) out = `${out.slice(0, 8000)}\n...[truncated]`;
        resolve({ success: !err, output: out });
      });
    });
  },
};