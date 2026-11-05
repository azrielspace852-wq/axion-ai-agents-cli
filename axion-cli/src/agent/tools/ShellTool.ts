import { exec, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentTool, ToolResult, DangerousActionPolicy } from '../../types';

// Heuristic detection of high-risk shell commands. Returns a human-readable
// reason string when the command looks dangerous, or null otherwise.
export function dangerousCommandReason(command: string): string | null {
  const c = command.toLowerCase();
  if (/\bgit\s+push\b/.test(c)) return /--force|--force-with-lease|-f\b/.test(c) ? 'git push --force (rewrites remote history)' : 'git push (publishes to remote)';
  if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\b|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b/.test(c) || /\brm\s+-rf?\b/.test(c)) return 'rm -rf (recursive force delete)';
  if (/\brm\s+/.test(c) && /~|\$home|\/etc|\/usr|\/var|\/bin|\/boot|\/sbin/.test(c)) return 'rm targeting a system/personal directory';
  if (/\bdd\b/.test(c) && /of=\/dev\//.test(c)) return 'dd writing to a block device';
  if (/\bmkfs\b|\bmkswap\b/.test(c)) return 'filesystem format (mkfs)';
  if (/\bchmod\s+-R\s+777\b|\bchmod\s+777/.test(c)) return 'chmod 777 (world-writable)';
  if (/\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/.test(c)) return 'system shutdown/reboot';
  if (/>[^>]*\/etc\/|>\s*\/etc\/passwd|>\s*\/etc\/shadow/.test(c)) return 'overwrite of a system file';
  if (/\bcurl\s+[^|]*\|\s*(sudo\s+)?(ba)?sh\b|\bwget\s+[^|]*\|\s*(sudo\s+)?(ba)?sh\b/.test(c)) return 'pipe remote script to shell';
  if (/\bsudo\b/.test(c)) return 'sudo (privilege escalation)';
  return null;
}

async function applyDangerousPolicy(
  reason: string,
  policy: DangerousActionPolicy,
  confirm?: (q: string) => Promise<boolean>,
): Promise<{ allow: boolean; reason?: string }> {
  if (policy === 'always-allow') return { allow: true };
  if (policy === 'always-deny') return { allow: false, reason: `[blocked by policy: always-deny] ${reason}` };
  // always-ask (default)
  if (!confirm) return { allow: false, reason: `[blocked] ${reason} — no confirmation channel available.` };
  const ok = await confirm(`Dangerous action detected: ${reason}. Allow execution?`);
  if (!ok) return { allow: false, reason: `[blocked by user] ${reason}` };
  return { allow: true };
}

export const ShellTool: AgentTool = {
  definition: {
    name: 'run_shell',
    description:
      'Execute a shell command on the local machine and return stdout/stderr. Requires the shellExec permission (enabled by default on fresh configurations). Dangerous commands (rm -rf, git push, sudo, etc.) are gated by the dangerous-action policy (default: ask for confirmation). In workspace scope, use the workspace as the working directory and avoid paths outside it; this is an agent policy, not an OS sandbox.',
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
    const dangerous = dangerousCommandReason(command);
    if (dangerous) {
      const decision = await applyDangerousPolicy(dangerous, ctx.dangerousActionPolicy || 'always-ask', ctx.confirm);
      if (!decision.allow) return { success: false, output: decision.reason || `[blocked] ${dangerous}` };
      ctx.notice?.(`⚠️  Allowed dangerous action: ${dangerous}`);
    }
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
      const child: ChildProcess = exec(command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        let out = '';
        if (stdout) out += stdout;
        if (stderr) out += (out ? '\n' : '') + stderr;
        if (err) out += (out ? '\n' : '') + `[exit error] ${err.message}`;
        out = out.trim() || '(no output)';
        if (out.length > 8000) out = `${out.slice(0, 8000)}\n...[truncated]`;
        resolve({ success: !err, output: out });
      });
      if (ctx.abortSignal) {
        ctx.abortSignal.addEventListener('abort', () => {
          try { child.kill('SIGTERM'); } catch { /* already exited */ }
        }, { once: true });
      }
    });
  },
};
