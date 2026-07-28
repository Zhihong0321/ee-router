import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AgyDiagnosticOperation = 'chat' | 'models' | 'health' | 'version' | 'oauth-verify' | 'oauth-login';
export type AgyDiagnosticStatus = 'success' | 'error' | 'timeout';

export interface AgyDiagnosticRecord {
  version: 1;
  trace_id: string;
  operation: AgyDiagnosticOperation;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  status: AgyDiagnosticStatus;
  request: {
    model?: string;
    prompt_chars?: number;
    prompt_sha256?: string;
  };
  process: {
    binary: string;
    args: string[];
    cwd_label: string;
    home: string | null;
    uid: number | null;
    gid: number | null;
    timeout_ms: number;
    exit_code: number | null;
    signal: string | null;
    timed_out: boolean;
    stdout_bytes: number;
    stderr_bytes: number;
  };
  output: {
    stdout_preview: string;
    stderr_preview: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface AgyDiagnosticInput {
  traceId?: string;
  operation: AgyDiagnosticOperation;
  startedAt: number;
  finishedAt: number;
  status: AgyDiagnosticStatus;
  binary: string;
  args: string[];
  cwdLabel: string;
  home?: string;
  timeoutMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  stdout: string;
  stderr: string;
  model?: string;
  prompt?: string;
  errorCode?: string;
  errorMessage?: string;
}

const SAFE_ID_RE = /^[a-zA-Z0-9-]{8,128}$/;
const MAX_PREVIEW_CHARS = 32_768;

export function hashDiagnosticValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sanitizeDiagnosticText(input: string, maxChars = MAX_PREVIEW_CHARS): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/("?(?:access_token|refresh_token|id_token|client_secret|authorization)"?\s*[:=]\s*")([^"]+)(")/gi, '$1[REDACTED]$3')
    .replace(/([?&](?:code|token|access_token|refresh_token|id_token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]')
    .slice(0, maxChars);
}

export function sanitizeAgyArgs(args: string[], prompt?: string): string[] {
  const sanitized: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!;
    if (value === '-p' && index + 1 < args.length) {
      const actualPrompt = prompt ?? args[index + 1] ?? '';
      sanitized.push('-p', `<redacted prompt chars=${actualPrompt.length} sha256=${hashDiagnosticValue(actualPrompt)}>`);
      index++;
      continue;
    }
    if (value === '--log-file' && index + 1 < args.length) {
      sanitized.push('--log-file', '<request-scratch>/agy.log');
      index++;
      continue;
    }
    sanitized.push(sanitizeDiagnosticText(value, 2_048));
  }
  return sanitized;
}

export class AgyDiagnosticStore {
  readonly root: string;
  readonly maxRecords: number;

  constructor(root: string, maxRecords = 500) {
    this.root = root;
    this.maxRecords = Math.max(10, Math.min(maxRecords, 5_000));
  }

  async record(input: AgyDiagnosticInput): Promise<AgyDiagnosticRecord> {
    const traceId = input.traceId && SAFE_ID_RE.test(input.traceId) ? input.traceId : randomUUID();
    const record: AgyDiagnosticRecord = {
      version: 1,
      trace_id: traceId,
      operation: input.operation,
      started_at: new Date(input.startedAt).toISOString(),
      finished_at: new Date(input.finishedAt).toISOString(),
      duration_ms: Math.max(0, input.finishedAt - input.startedAt),
      status: input.status,
      request: {
        ...(input.model ? { model: input.model } : {}),
        ...(input.prompt ? {
          prompt_chars: input.prompt.length,
          prompt_sha256: hashDiagnosticValue(input.prompt),
        } : {}),
      },
      process: {
        binary: input.binary,
        args: sanitizeAgyArgs(input.args, input.prompt),
        cwd_label: input.cwdLabel,
        home: input.home ?? null,
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
        gid: typeof process.getgid === 'function' ? process.getgid() : null,
        timeout_ms: input.timeoutMs,
        exit_code: input.exitCode,
        signal: input.signal,
        timed_out: input.timedOut,
        stdout_bytes: input.stdoutBytes,
        stderr_bytes: input.stderrBytes,
      },
      output: {
        stdout_preview: sanitizeDiagnosticText(input.stdout),
        stderr_preview: sanitizeDiagnosticText(input.stderr),
      },
      ...(input.errorCode || input.errorMessage ? {
        error: {
          code: input.errorCode ?? 'unknown_error',
          message: sanitizeDiagnosticText(input.errorMessage ?? 'Unknown AGY error', 4_096),
        },
      } : {}),
    };

    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stamp = String(input.startedAt).padStart(13, '0');
    const filename = `${stamp}-${traceId}.json`;
    const destination = join(this.root, filename);
    const temporary = join(this.root, `.${filename}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, destination);
    await this.prune();
    return record;
  }

  async list(limit = 50): Promise<AgyDiagnosticRecord[]> {
    const capped = Math.max(1, Math.min(limit, 200));
    let names: string[];
    try {
      names = (await readdir(this.root))
        .filter(name => /^\d{13}-[a-zA-Z0-9-]{8,128}\.json$/.test(name))
        .sort()
        .reverse()
        .slice(0, capped);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const records = await Promise.all(names.map(async name => {
      try {
        return JSON.parse(await readFile(join(this.root, name), 'utf8')) as AgyDiagnosticRecord;
      } catch {
        return null;
      }
    }));
    return records.filter((record): record is AgyDiagnosticRecord => record !== null);
  }

  async get(traceId: string): Promise<AgyDiagnosticRecord | null> {
    if (!SAFE_ID_RE.test(traceId)) return null;
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const filename = names.find(name => name.endsWith(`-${traceId}.json`));
    if (!filename) return null;
    try {
      return JSON.parse(await readFile(join(this.root, filename), 'utf8')) as AgyDiagnosticRecord;
    } catch {
      return null;
    }
  }

  private async prune(): Promise<void> {
    const names = (await readdir(this.root))
      .filter(name => /^\d{13}-[a-zA-Z0-9-]{8,128}\.json$/.test(name))
      .sort()
      .reverse();
    const stale = names.slice(this.maxRecords);
    await Promise.all(stale.map(name => rm(join(this.root, name), { force: true })));
  }
}

let defaultStore: AgyDiagnosticStore | null | undefined;

export function getDefaultAgyDiagnosticStore(): AgyDiagnosticStore | null {
  if (defaultStore !== undefined) return defaultStore;
  const root = process.env.AGY_DIAGNOSTICS_ROOT;
  defaultStore = root ? new AgyDiagnosticStore(root) : null;
  return defaultStore;
}

export function resetDefaultAgyDiagnosticStore(): void {
  defaultStore = undefined;
}
