import { exec } from 'child_process';
import { AgentTool, ToolResult } from '../../types';

export const ShellTool: AgentTool = {
  definition: {
    name: 'run_shell',
    description:
      'Execute a shell command on the local machine and return stdout/stderr. Requires the shellExec permission (disabled by default).',
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
    const command = String(args.command || '');
    if (!command) return { success: false, output: 'Empty command.' };
    const cwd = String(args.cwd || ctx.cwd);

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