import type { Readable } from 'node:stream';
// Idle watchdog: if no chunk/heartbeat arrives for this long, the request is
// aborted with a "model not responding" error. A model that keeps streaming
// (or sending SSE heartbeats) is NEVER cut off by a total request timeout.
export const IDLE_TIMEOUT_MS = Number(process.env.AXION_IDLE_TIMEOUT) || 60_000;
const WATCHDOG_INTERVAL_MS = 1_000;
function isStream(value: unknown): value is Readable {
  return typeof value === 'object' && value !== null && typeof (value as Readable).on === 'function' && typeof (value as Readable).read === 'function';
}
function readStreamFully(stream: Readable, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let finished = false;
    const cleanup = (): void => {
      finished = true;
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onData = (chunk: Buffer): void => { chunks.push(chunk); };
    const onEnd = (): void => { if (!finished) { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); } };
    const onError = (err: Error): void => { if (!finished) { cleanup(); reject(err); } };
    const onAbort = (): void => { if (!finished) { cleanup(); stream.destroy(); reject(new Error('Request aborted.')); } };
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}
export interface StreamConsumeResult {
  mode: 'sse' | 'json' | 'object';
  data?: unknown; // parsed full JSON payload when mode === 'json' | 'object'
}
/**
 * Consume an axios response. Handles three shapes:
 *  - 'object': res.data is already a parsed object (test mock / non-stream path).
 *  - 'sse':    the body is an SSE stream; onSseEvent(parsed) is called per `data:` line.
 *  - 'json':   the body is a single JSON document buffered to the end (non-SSE fallback).
 * An idle watchdog aborts the stream if no chunk arrives within IDLE_TIMEOUT_MS.
 * The flat total timeout is intentionally removed: active streaming never times out.
 */
export async function consumeResponseStream(
  res: { status: number; statusText: string; data: unknown },
  signal: AbortSignal | undefined,
  onSseEvent: (parsed: unknown) => void,
  onHeartbeat: () => void,
): Promise<StreamConsumeResult> {
  if (!isStream(res.data)) {
    // Non-stream path (unit-test mocks or a provider that ignored stream:true).
    return { mode: 'object', data: res.data };
  }
  const stream = res.data as Readable;
  if (res.status >= 400) {
    const body = await readStreamFully(stream, signal);
    let message = `Provider returned HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
      message = parsed?.error?.message || parsed?.message || message;
    } catch { /* use raw status message */ }
    throw new Error(message);
  }
  return new Promise((resolve, reject) => {
    let buffer = '';
    let mode: 'undecided' | 'sse' | 'json' = 'undecided';
    let jsonBuffer = '';
    let lastChunkAt = Date.now();
    let done = false;
    const watchdog = setInterval(() => {
      if (done) return;
      if (Date.now() - lastChunkAt > IDLE_TIMEOUT_MS) {
        finishWithError(new Error(`Model tidak merespons: tidak ada data selama ${Math.round(IDLE_TIMEOUT_MS / 1000)}s (idle timeout).`));
      }
    }, WATCHDOG_INTERVAL_MS);
    const cleanup = (): void => {
      done = true;
      clearInterval(watchdog);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const finishWithError = (err: Error): void => {
      if (done) return;
      cleanup();
      try { stream.destroy(); } catch { /* best effort */ }
      reject(err);
    };
    const onAbort = (): void => finishWithError(new Error('Request aborted.'));
    const processSseLine = (line: string): boolean => {
      // returns true when the stream is finished ([DONE])
      const trimmed = line.trimEnd();
      if (trimmed.startsWith('data:')) {
        const payload = trimmed.slice(5).trim();
        lastChunkAt = Date.now();
        onHeartbeat();
        if (payload === '[DONE]') return true;
        if (!payload) return false;
        try {
          onSseEvent(JSON.parse(payload));
        } catch { /* ignore malformed event lines */ }
        return false;
      }
      if (trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith(':')) {
        lastChunkAt = Date.now();
        onHeartbeat();
        return false;
      }
      if (trimmed === '') return false;
      // Not an SSE line — treat the whole body as a single JSON document.
      mode = 'json';
      jsonBuffer += line + '\n';
      return false;
    };
    const onData = (chunk: Buffer): void => {
      if (done) return;
      lastChunkAt = Date.now();
      const text = chunk.toString('utf8');
      if (mode === 'json') { jsonBuffer += text; return; }
      buffer += text;
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);
        if (mode === 'undecided') {
          const t = line.trimStart();
          if (t.startsWith('data:') || t.startsWith('event:') || t.startsWith('id:') || t.startsWith(':')) {
            mode = 'sse';
          } else if (t.startsWith('{') || t.startsWith('[')) {
            mode = 'json';
            jsonBuffer += line + '\n';
            continue;
          } else if (t === '') {
            continue; // blank line before first event — keep buffering
          } else {
            mode = 'sse'; // default to SSE for unknown leading lines
          }
        }
        if (mode === 'sse') {
          if (processSseLine(line)) {
            cleanup();
            try { stream.destroy(); } catch { /* best effort */ }
            resolve({ mode: 'sse' });
            return;
          }
        }
      }
    };
    const onEnd = (): void => {
      if (done) return;
      // Flush any trailing partial line.
      if (buffer.trim() && mode !== 'json') {
        if (mode === 'undecided') mode = 'sse';
        if (mode === 'sse') processSseLine(buffer);
      }
      cleanup();
      if (mode === 'json') {
        const raw = (jsonBuffer + buffer).trim();
        if (!raw) return resolve({ mode: 'json', data: undefined });
        try {
          resolve({ mode: 'json', data: JSON.parse(raw) });
        } catch (e) {
          reject(new Error(`Provider returned a non-JSON response: ${e instanceof Error ? e.message : String(e)}`));
        }
        return;
      }
      resolve({ mode: 'sse' });
    };
    const onError = (err: Error): void => finishWithError(err);
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}
