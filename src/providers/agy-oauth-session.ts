import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgyDiagnosticStore, getDefaultAgyDiagnosticStore } from './agy-diagnostics.js';

const AUTH_URL_RE = /https:\/\/accounts\.google\.com\/[^\s]+/;
const MAX_CAPTURE_BYTES = 128 * 1024;
const START_TIMEOUT_MS = 10_000;
const SESSION_TIMEOUT_MS = 5 * 60_000;
const CODE_RE = /^[A-Za-z0-9._~+/=-]{8,4096}$/;

export type AgyOAuthSessionState =
  | 'starting'
  | 'waiting'
  | 'completing'
  | 'authenticated'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface AgyOAuthSessionSnapshot {
  session_id: string;
  state: AgyOAuthSessionState;
  auth_url?: string;
  started_at: string;
  expires_at: string;
  finished_at?: string;
  message: string;
  code_required: boolean;
  secret_values_returned: false;
}

export interface AgyOAuthController {
  start(): Promise<AgyOAuthSessionSnapshot>;
  status(sessionId?: string): AgyOAuthSessionSnapshot | null;
  submitCode(sessionId: string, code: string): AgyOAuthSessionSnapshot;
  cancel(sessionId: string): AgyOAuthSessionSnapshot;
}

type SpawnOAuth = (
  command: string,
  args: readonly string[],
  options: SpawnOptions & { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

export interface AgyOAuthSessionManagerOptions {
  binary?: string;
  home?: string;
  scratchRoot?: string;
  environment?: NodeJS.ProcessEnv;
  spawnProcess?: SpawnOAuth;
  diagnosticStore?: AgyDiagnosticStore | null;
}

interface ActiveSession {
  id: string;
  state: AgyOAuthSessionState;
  authUrl?: string;
  startedAt: number;
  expiresAt: number;
  finishedAt?: number;
  message: string;
  child: ChildProcessWithoutNullStreams;
  args: string[];
  scratch: string;
  stdout: Buffer[];
  stderr: Buffer[];
  stdoutBytes: number;
  stderrBytes: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timer: NodeJS.Timeout;
  credentialTimer: NodeJS.Timeout;
  suppressOutput: boolean;
}

function minimalEnvironment(source: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { HOME: home, NO_COLOR: '1' };
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'TMPDIR']) {
    if (source[name]) result[name] = source[name];
  }
  return result;
}

function safeFailureMessage(output: string): string {
  if (/timed out/i.test(output)) return 'Antigravity OAuth session expired';
  if (/denied|access_denied|cancel/i.test(output)) return 'Google authorization was not approved';
  if (/authentication failed/i.test(output)) return 'Antigravity rejected the authorization result';
  return 'Antigravity OAuth process exited before authentication completed';
}

export class AgyOAuthSessionManager implements AgyOAuthController {
  private readonly binary: string;
  private readonly home: string;
  private readonly scratchRoot: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly spawnProcess: SpawnOAuth;
  private readonly diagnosticStore: AgyDiagnosticStore | null;
  private current: ActiveSession | null = null;

  constructor(options: AgyOAuthSessionManagerOptions = {}) {
    this.binary = options.binary ?? process.env.AGY_BIN ?? 'agy';
    this.home = options.home ?? process.env.AGY_HOME ?? process.env.HOME ?? '/storage';
    this.scratchRoot = options.scratchRoot ?? process.env.AGY_SCRATCH_ROOT ?? join(tmpdir(), 'agyproxy');
    this.environment = options.environment ?? process.env;
    this.spawnProcess = options.spawnProcess ?? (spawn as SpawnOAuth);
    this.diagnosticStore = options.diagnosticStore === undefined
      ? getDefaultAgyDiagnosticStore()
      : options.diagnosticStore;
  }

  async start(): Promise<AgyOAuthSessionSnapshot> {
    if (this.current && ['starting', 'waiting', 'completing'].includes(this.current.state)) {
      throw new Error('An Antigravity OAuth session is already active');
    }

    await mkdir(this.scratchRoot, { recursive: true, mode: 0o700 });
    const scratch = await mkdtemp(join(this.scratchRoot, 'oauth-'));
    const id = randomUUID();
    const startedAt = Date.now();
    const profileRoot = join(this.home, '.gemini');
    await mkdir(profileRoot, { recursive: true, mode: 0o700 });
    const configRoot = join(profileRoot, 'config');
    try {
      await rename(configRoot, join(profileRoot, `config.oauth-backup-${id}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const args = [
      '-p',
      'Reply exactly: EE_ROUTER_AGY_OAUTH_READY',
      '--model',
      'gemini-3.6-flash-low',
      '--sandbox',
      '--dangerously-skip-permissions',
      '--print-timeout',
      '180000ms',
      '--log-file',
      join(scratch, 'agy-oauth.log'),
    ];
    const child = this.spawnProcess(this.binary, args, {
      cwd: scratch,
      env: minimalEnvironment(this.environment, this.home),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const session: ActiveSession = {
      id,
      state: 'starting',
      startedAt,
      expiresAt: startedAt + SESSION_TIMEOUT_MS,
      message: 'Starting Antigravity OAuth',
      child,
      args,
      scratch,
      stdout: [],
      stderr: [],
      stdoutBytes: 0,
      stderrBytes: 0,
      exitCode: null,
      signal: null,
      timer: setTimeout(() => {
        if (['starting', 'waiting', 'completing'].includes(session.state)) {
          session.state = 'expired';
          session.message = 'Antigravity OAuth session expired';
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 3_000).unref();
        }
      }, SESSION_TIMEOUT_MS),
      credentialTimer: setInterval(() => undefined, SESSION_TIMEOUT_MS),
      suppressOutput: false,
    };
    clearInterval(session.credentialTimer);
    session.credentialTimer = setInterval(() => {
      const credentialPath = join(this.home, '.gemini', 'oauth_creds.json');
      if (!existsSync(credentialPath)) return;
      try {
        if (statSync(credentialPath).size < 100) return;
      } catch {
        return;
      }
      if (['starting', 'waiting', 'completing'].includes(session.state)) {
        session.state = 'authenticated';
        session.message = 'Antigravity OAuth completed successfully';
        session.finishedAt = Date.now();
        clearTimeout(session.timer);
        clearInterval(session.credentialTimer);
        child.kill('SIGTERM');
      }
    }, 500);
    session.credentialTimer.unref();
    session.timer.unref();
    this.current = session;

    const capture = (target: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const byteKey = target === 'stdout' ? 'stdoutBytes' : 'stderrBytes';
      session[byteKey] += data.length;
      if (!session.suppressOutput && session[byteKey] <= MAX_CAPTURE_BYTES) session[target].push(data);
      const combined = Buffer.concat([...session.stdout, ...session.stderr]).toString('utf8');
      const match = combined.match(AUTH_URL_RE);
      if (match && !session.authUrl) {
        session.authUrl = match[0];
        session.state = 'waiting';
        session.message = 'Open the Google consent URL; submit a displayed code only if requested';
      }
    };

    child.stdout.on('data', chunk => capture('stdout', chunk));
    child.stderr.on('data', chunk => capture('stderr', chunk));
    child.once('error', error => {
      session.state = 'failed';
      session.message = `Could not start Antigravity OAuth: ${error.message}`;
      session.finishedAt = Date.now();
      clearTimeout(session.timer);
      clearInterval(session.credentialTimer);
    });
    child.once('close', (code, signal) => {
      session.exitCode = code;
      session.signal = signal;
      session.finishedAt = Date.now();
      clearTimeout(session.timer);
      clearInterval(session.credentialTimer);
      const output = Buffer.concat([...session.stdout, ...session.stderr]).toString('utf8');
      if (!['expired', 'cancelled', 'authenticated'].includes(session.state)) {
        if (code === 0) {
          session.state = 'authenticated';
          session.message = 'Antigravity OAuth completed successfully';
        } else {
          session.state = /timed out/i.test(output) ? 'expired' : 'failed';
          session.message = safeFailureMessage(output);
        }
      }
      void this.recordAndCleanup(session);
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (!session.authUrl && session.state === 'starting' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!session.authUrl && session.state === 'starting') {
      session.state = 'failed';
      session.message = 'Antigravity did not provide an OAuth URL';
      child.kill('SIGTERM');
    }
    return this.snapshot(session);
  }

  status(sessionId?: string): AgyOAuthSessionSnapshot | null {
    if (!this.current) return null;
    if (sessionId && sessionId !== this.current.id) return null;
    return this.snapshot(this.current);
  }

  submitCode(sessionId: string, code: string): AgyOAuthSessionSnapshot {
    const session = this.requireActive(sessionId);
    const normalized = code.trim();
    if (!CODE_RE.test(normalized)) throw new Error('Invalid OAuth authorization code format');
    if (!session.child.stdin.writable) throw new Error('Antigravity OAuth input is no longer available');
    session.suppressOutput = true;
    session.child.stdin.write(normalized + '\n');
    session.state = 'completing';
    session.message = 'Authorization code submitted; waiting for Antigravity verification';
    return this.snapshot(session);
  }

  cancel(sessionId: string): AgyOAuthSessionSnapshot {
    const session = this.requireActive(sessionId);
    session.state = 'cancelled';
    session.message = 'Antigravity OAuth session cancelled';
    session.finishedAt = Date.now();
    clearTimeout(session.timer);
    clearInterval(session.credentialTimer);
    session.child.kill('SIGTERM');
    return this.snapshot(session);
  }

  private requireActive(sessionId: string): ActiveSession {
    const session = this.current;
    if (!session || session.id !== sessionId) throw new Error('Antigravity OAuth session not found');
    if (!['starting', 'waiting', 'completing'].includes(session.state)) {
      throw new Error('Antigravity OAuth session is no longer active');
    }
    return session;
  }

  private snapshot(session: ActiveSession): AgyOAuthSessionSnapshot {
    return {
      session_id: session.id,
      state: session.state,
      ...(session.authUrl ? { auth_url: session.authUrl } : {}),
      started_at: new Date(session.startedAt).toISOString(),
      expires_at: new Date(session.expiresAt).toISOString(),
      ...(session.finishedAt ? { finished_at: new Date(session.finishedAt).toISOString() } : {}),
      message: session.message,
      code_required: session.state === 'waiting',
      secret_values_returned: false,
    };
  }

  private async recordAndCleanup(session: ActiveSession): Promise<void> {
    const finishedAt = session.finishedAt ?? Date.now();
    const stdout = Buffer.concat(session.stdout).toString('utf8');
    const stderr = Buffer.concat(session.stderr).toString('utf8');
    try {
      await this.diagnosticStore?.record({
        traceId: session.id,
        operation: 'oauth-login',
        startedAt: session.startedAt,
        finishedAt,
        status: session.state === 'authenticated' ? 'success' : session.state === 'expired' ? 'timeout' : 'error',
        binary: this.binary,
        args: session.args,
        cwdLabel: 'oauth-',
        home: this.home,
        timeoutMs: SESSION_TIMEOUT_MS,
        exitCode: session.exitCode,
        signal: session.signal,
        timedOut: session.state === 'expired',
        stdoutBytes: session.stdoutBytes,
        stderrBytes: session.stderrBytes,
        stdout,
        stderr,
        errorCode: session.state === 'authenticated' ? undefined : 'oauth_login_failed',
        errorMessage: session.state === 'authenticated' ? undefined : session.message,
      });
    } finally {
      await rm(session.scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
