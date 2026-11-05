import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

/** Create a private directory when the platform supports POSIX permissions. */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Permission bits are not supported by every filesystem/operating system.
  }
}

/** Write JSON atomically so an interrupted process cannot leave a half-written file. */
export function writeJsonAtomically(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  ensurePrivateDir(dir);
  const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Permission bits are not supported by every filesystem/operating system.
    }
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup only.
    }
  }
}
