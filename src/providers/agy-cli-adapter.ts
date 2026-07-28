import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ContentBlock,
  type NormalizedChunk,
  type NormalizedRequest,
  type NormalizedResponse,
  type ProviderAdapter,
  type ProviderConfig,
} from './interface.js';
import {
  getDefaultAgyDiagnosticStore,
  type AgyDiagnosticOperation,
  type AgyDiagnosticStore,
} from './agy-diagnostics.js';

export const AGY_RESPONSE_START = '<<<AGY_RESPONSE_START>>>';
export const AGY_RESPONSE_END = '<<<AGY_RESPONSE_END>>>';

export const AGY_MODELS = Object.freeze([
  'gemini-3.6-flash-high',
  'gemini-3.6-flash-medium',
  'gemini-3.6-flash-low',
  'gemini-3.5-pro-high',
  'gemini-3.5-pro-low',
  'gemini-3.5-flash-high',
  'gemini-3.5-flash-low',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
] as const);

const AGY_MODEL_SET = new Set<string>(AGY_MODELS);
const AGY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  default: 'gemini-3.1-pro-high',
  reasoning: 'gemini-3.1-pro-high',
  fast: 'gemini-3.6-flash-high',
});
const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const MAX_STDOUT_BYTES = 4 * 1_048_576;
const MAX_STDERR_BYTES = 1_048_576;

export interface AgyExecutionRequest {
  model: string;
  prompt: string;
  stream: boolean;
}

interface AgyProcessResult {
  stdout: string;
  requestId: string;
  prompt: string;
  model: string;
}

interface AgyRunMetadata {
  operation: AgyDiagnosticOperation;
  traceId?: string;
  model?: string;
  prompt?: string;
}

export interface AgyRuntimeInfo {
  binary: string;
  scratch_root: string;
  diagnostics_root: string | null;
  home: string | null;
  uid: number | null;
  gid: number | null;
}

type SpawnAgy = (
  command: string,
  args: readonly string[],
  options: SpawnOptions & { stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

export interface AgyCliAdapterOptions {
  spawnProcess?: SpawnAgy;
  binary?: string;
  scratchRoot?: string;
  environment?: NodeJS.ProcessEnv;
  killGraceMs?: number;
  timeoutGraceMs?: number;
  diagnosticStore?: AgyDiagnosticStore | null;
}

export class AgyCliError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'AgyCliError';
    this.code = code;
    this.status = status;
  }
}

export function resolveAgyModel(input: string): string {
  const resolved = AGY_ALIASES[input] ?? input;
  if (!AGY_MODEL_SET.has(resolved)) {
    throw new AgyCliError(`Unknown Antigravity model: ${input}`, 'model_not_found', 400);
  }
  return resolved;
}

function textFromContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content.map(block => {
    if (block.type === 'text') return block.text ?? '';
    if (block.type === 'tool_result') {
      if (typeof block.content === 'string') return block.content;
      return (block.content ?? []).map(item => item.text ?? '').join('');
    }
    return '';
  }).join('');
}

export function flattenAgyMessages(messages: NormalizedRequest['messages']): string {
  const normalized = messages.map(message => ({
    role: message.role,
    content: textFromContent(message.content).trim(),
  }));
  const systems = normalized.filter(message => message.role === 'system' && message.content);
  const turns = normalized.filter(message => message.role !== 'system' && message.content);
  const sections: string[] = [];

  if (systems.length > 0) {
    sections.push('SYSTEM INSTRUCTIONS:\n' + systems.map(message => message.content).join('\n\n'));
  }

  sections.push(
    'RESPONSE CONTRACT:\n' +
    'Answer directly. Do not read files, run commands, browse, or use tools.\n' +
    'Return only the answer between these exact markers:\n' +
    `${AGY_RESPONSE_START}\n<answer>\n${AGY_RESPONSE_END}`,
  );

  if (turns.length > 0) {
    sections.push(
      'CONVERSATION:\n' +
      turns.map(message => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n'),
    );
  }

  sections.push('ASSISTANT:\n');
  return sections.join('\n\n');
}

export function extractAgyResponse(stdout: string): { content: string; sentinelHit: boolean } {
  const clean = stdout.replace(ANSI_RE, '').trim();
  const start = clean.indexOf(AGY_RESPONSE_START);
  const end = clean.indexOf(AGY_RESPONSE_END, start + AGY_RESPONSE_START.length);
  if (start !== -1 && end !== -1) {
    return {
      content: clean.slice(start + AGY_RESPONSE_START.length, end).trim(),
      sentinelHit: true,
    };
  }
  return { content: clean, sentinelHit: false };
}

function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

function minimalAgyEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ['HOME', 'PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'TMPDIR'];
  const environment: NodeJS.ProcessEnv = { NO_COLOR: '1' };
  for (const name of allowed) {
    if (source[name]) environment[name] = source[name];
  }
  return environment;
}

function classifyAgyFailure(exitCode: number | null, stderr: string): AgyCliError {
  if (/auth|oauth|credential|token.*expir|login required/i.test(stderr)) {
    return new AgyCliError('Antigravity authentication is unavailable', 'upstream_auth', 503);
  }
  if (/quota|rate.?limit|resource exhausted|too many requests/i.test(stderr)) {
    return new AgyCliError('Antigravity quota is currently unavailable', 'upstream_quota', 429);
  }
  return new AgyCliError(
    `Antigravity process failed with exit code ${exitCode ?? 'unknown'}`,
    'upstream_error',
    502,
  );
}

export class AgyCliAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;
  private readonly spawnProcess: SpawnAgy;
  private readonly binary: string;
  private readonly scratchRoot: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly killGraceMs: number;
  private readonly timeoutGraceMs: number;
  private readonly diagnosticStore: AgyDiagnosticStore | null;

  constructor(config: ProviderConfig, options: AgyCliAdapterOptions = {}) {
    this.config = config;
    this.spawnProcess = options.spawnProcess ?? (spawn as SpawnAgy);
    this.binary = options.binary ?? process.env.AGY_BIN ?? 'agy';
    this.scratchRoot = options.scratchRoot ?? process.env.AGY_SCRATCH_ROOT ?? join(tmpdir(), 'agyproxy');
    this.environment = options.environment ?? process.env;
    this.killGraceMs = options.killGraceMs ?? 5_000;
    this.timeoutGraceMs = options.timeoutGraceMs ?? 15_000;
    this.diagnosticStore = options.diagnosticStore === undefined
      ? getDefaultAgyDiagnosticStore()
      : options.diagnosticStore;
  }

  getRuntimeInfo(): AgyRuntimeInfo {
    return {
      binary: this.binary,
      scratch_root: this.scratchRoot,
      diagnostics_root: this.diagnosticStore?.root ?? null,
      home: this.environment.HOME ?? null,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      gid: typeof process.getgid === 'function' ? process.getgid() : null,
    };
  }

  async getVersion(): Promise<string> {
    return (await this.runProcess(
      ['--version'],
      Math.min(this.config.timeout_ms, 15_000),
      'version-',
      false,
      { operation: 'version' },
    )).trim();
  }

  translateRequest(req: NormalizedRequest): { body: AgyExecutionRequest; headers: Record<string, string> } {
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
      throw new AgyCliError('messages must be a non-empty array', 'invalid_request', 400);
    }
    if (req.tools && req.tools.length > 0) {
      throw new AgyCliError('Antigravity CLI does not support tool calls', 'unsupported_tools', 400);
    }

    return {
      body: {
        model: resolveAgyModel(req.model || this.config.models[0] || 'default'),
        prompt: flattenAgyMessages(req.messages),
        stream: req.stream,
      },
      headers: {},
    };
  }

  async execute(requestBody: unknown): Promise<NormalizedResponse> {
    const request = requestBody as Partial<AgyExecutionRequest>;
    if (typeof request.prompt !== 'string' || !request.prompt) {
      throw new AgyCliError('Invalid local Antigravity request', 'invalid_request', 400);
    }
    const model = resolveAgyModel(String(request.model ?? this.config.models[0] ?? 'default'));
    const requestId = randomUUID();
    const result = await this.runAgy(request.prompt, model, requestId);
    return this.translateResponse(result);
  }

  translateStreamChunk(raw: Buffer): NormalizedChunk[] {
    const extracted = extractAgyResponse(raw.toString('utf8'));
    if (!extracted.content) return [];
    return [{
      id: `chatcmpl-${randomUUID()}`,
      model: this.config.models[0] ?? '',
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: extracted.content },
        finish_reason: 'stop',
      }],
    }];
  }

  translateResponse(raw: unknown): NormalizedResponse {
    const result = raw as Partial<AgyProcessResult>;
    const stdout = typeof result.stdout === 'string' ? result.stdout : String(raw ?? '');
    const extracted = extractAgyResponse(stdout);
    if (!extracted.content) {
      throw new AgyCliError('Antigravity returned an empty response', 'empty_upstream_response', 502);
    }
    const prompt = result.prompt ?? '';
    const model = result.model ?? this.config.models[0] ?? '';
    const promptTokens = estimateTokens(prompt);
    const completionTokens = estimateTokens(extracted.content);

    return {
      id: `chatcmpl-${result.requestId ?? randomUUID()}`,
      model,
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        message: { role: 'assistant', content: extracted.content },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }

  async checkHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      await this.runProcess(
        ['models'],
        Math.min(this.config.timeout_ms, 30_000),
        'health-',
        false,
        { operation: 'health' },
      );
      return { status: 'healthy', latency_ms: Date.now() - start };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency_ms: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listModels(): Promise<string[]> {
    await this.runProcess(
      ['models'],
      Math.min(this.config.timeout_ms, 30_000),
      'models-',
      false,
      { operation: 'models' },
    );
    return this.config.models.length > 0 ? [...this.config.models] : [...AGY_MODELS];
  }

  private async runAgy(prompt: string, model: string, requestId: string): Promise<AgyProcessResult> {
    const args = [
      '-p', prompt,
      '--model', model,
      '--sandbox',
      '--dangerously-skip-permissions',
      '--print-timeout', `${this.config.timeout_ms}ms`,
    ];
    const stdout = await this.runProcess(
      args,
      this.config.timeout_ms + this.timeoutGraceMs,
      'request-',
      true,
      { operation: 'chat', traceId: requestId, model, prompt },
    );
    return { stdout, requestId, prompt, model };
  }

  private async runProcess(
    args: string[],
    hardTimeoutMs: number,
    scratchPrefix: string,
    includeLogFile = false,
    metadata: AgyRunMetadata = { operation: 'chat' },
  ): Promise<string> {
    await mkdir(this.scratchRoot, { recursive: true, mode: 0o700 });
    const scratch = await mkdtemp(join(this.scratchRoot, scratchPrefix));
    const finalArgs = includeLogFile ? [...args, '--log-file', join(scratch, 'agy.log')] : args;
    const startedAt = Date.now();
    let stdoutText = '';
    let stderrText = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    try {
      stdoutText = await new Promise<string>((resolve, reject) => {
        const child = this.spawnProcess(this.binary, finalArgs, {
          cwd: scratch,
          env: minimalAgyEnv(this.environment),
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let settled = false;
        let killTimer: NodeJS.Timeout | undefined;

        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          if (killTimer) clearTimeout(killTimer);
          stdoutText = Buffer.concat(stdout).toString('utf8');
          stderrText = Buffer.concat(stderr).toString('utf8');
          callback();
        };

        const hardTimer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), this.killGraceMs);
          killTimer.unref();
        }, hardTimeoutMs);
        hardTimer.unref();

        child.stdout.on('data', (chunk: Buffer | string) => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          stdoutBytes += data.length;
          if (stdoutBytes <= MAX_STDOUT_BYTES) stdout.push(data);
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          stderrBytes += data.length;
          if (stderrBytes <= MAX_STDERR_BYTES) stderr.push(data);
        });
        child.once('error', error => {
          finish(() => reject(new AgyCliError(
            `Could not start Antigravity: ${error.message}`,
            'spawn_failed',
            502,
          )));
        });
        child.once('close', (code, signal) => {
          exitCode = code;
          exitSignal = signal;
          finish(() => {
            if (timedOut) {
              reject(new AgyCliError('Antigravity request timed out', 'upstream_timeout', 504));
            } else if (stdoutBytes > MAX_STDOUT_BYTES || stderrBytes > MAX_STDERR_BYTES) {
              reject(new AgyCliError(
                'Antigravity output exceeded the safety limit',
                'output_too_large',
                502,
              ));
            } else if (code !== 0) {
              reject(classifyAgyFailure(code, stderrText));
            } else {
              resolve(stdoutText);
            }
          });
        });
      });

      await this.recordDiagnostic({
        metadata,
        startedAt,
        hardTimeoutMs,
        finalArgs,
        scratchPrefix,
        status: 'success',
        exitCode,
        exitSignal,
        timedOut,
        stdoutBytes,
        stderrBytes,
        stdoutText,
        stderrText,
      });
      return stdoutText;
    } catch (error) {
      const agyError = error as { code?: string; message?: string };
      await this.recordDiagnostic({
        metadata,
        startedAt,
        hardTimeoutMs,
        finalArgs,
        scratchPrefix,
        status: timedOut ? 'timeout' : 'error',
        exitCode,
        exitSignal,
        timedOut,
        stdoutBytes,
        stderrBytes,
        stdoutText,
        stderrText,
        errorCode: agyError.code,
        errorMessage: agyError.message,
      });
      throw error;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  private async recordDiagnostic(input: {
    metadata: AgyRunMetadata;
    startedAt: number;
    hardTimeoutMs: number;
    finalArgs: string[];
    scratchPrefix: string;
    status: 'success' | 'error' | 'timeout';
    exitCode: number | null;
    exitSignal: NodeJS.Signals | null;
    timedOut: boolean;
    stdoutBytes: number;
    stderrBytes: number;
    stdoutText: string;
    stderrText: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    if (!this.diagnosticStore) return;
    try {
      await this.diagnosticStore.record({
        traceId: input.metadata.traceId,
        operation: input.metadata.operation,
        startedAt: input.startedAt,
        finishedAt: Date.now(),
        status: input.status,
        binary: this.binary,
        args: input.finalArgs,
        cwdLabel: input.scratchPrefix,
        home: this.environment.HOME,
        timeoutMs: input.hardTimeoutMs,
        exitCode: input.exitCode,
        signal: input.exitSignal,
        timedOut: input.timedOut,
        stdoutBytes: input.stdoutBytes,
        stderrBytes: input.stderrBytes,
        stdout: input.stdoutText,
        stderr: input.stderrText,
        model: input.metadata.model,
        prompt: input.metadata.prompt,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      });
    } catch {
      // Diagnostics must never break an AGY request.
    }
  }
}
