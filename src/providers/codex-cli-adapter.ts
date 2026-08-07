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

/**
 * Codex reasoning efforts per model slug, mirrored from the slugs the CLI itself
 * advertises. The router exposes `<slug>-<effort>` as one addressable model, the
 * same shape the Antigravity provider uses.
 */
const CODEX_MODEL_EFFORTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'gpt-5.6-sol': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-terra': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.5': ['low', 'medium', 'high', 'xhigh'],
  'gpt-5.4': ['low', 'medium', 'high', 'xhigh'],
  'gpt-5.4-mini': ['low', 'medium', 'high', 'xhigh'],
});

const DEFAULT_EFFORT = 'medium';

export const CODEX_MODELS: readonly string[] = Object.freeze(
  Object.entries(CODEX_MODEL_EFFORTS).flatMap(([slug, efforts]) =>
    efforts.map(effort => `${slug}-${effort}`),
  ),
);

const CODEX_MODEL_SET = new Set<string>(CODEX_MODELS);
const CODEX_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  default: 'gpt-5.6-sol-medium',
  reasoning: 'gpt-5.6-sol-high',
  fast: 'gpt-5.4-mini-low',
});

const MAX_STDOUT_BYTES = 4 * 1_048_576;
const MAX_STDERR_BYTES = 1_048_576;

export interface CodexExecutionRequest {
  slug: string;
  effort: string;
  prompt: string;
  stream: boolean;
}

interface CodexProcessResult {
  stdout: string;
  requestId: string;
  prompt: string;
  model: string;
}

export interface CodexRuntimeInfo {
  binary: string;
  scratch_root: string;
  codex_home: string | null;
  sandbox: string;
  uid: number | null;
  gid: number | null;
}

type SpawnCodex = (
  command: string,
  args: readonly string[],
  options: SpawnOptions & { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

export interface CodexCliAdapterOptions {
  spawnProcess?: SpawnCodex;
  binary?: string;
  scratchRoot?: string;
  sandbox?: string;
  environment?: NodeJS.ProcessEnv;
  killGraceMs?: number;
  timeoutGraceMs?: number;
}

export class CodexCliError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'CodexCliError';
    this.code = code;
    this.status = status;
  }
}

/** Split an exposed `<slug>-<effort>` model name back into its CLI arguments. */
export function resolveCodexModel(input: string): { slug: string; effort: string } {
  const resolved = CODEX_ALIASES[input] ?? input;

  if (CODEX_MODEL_SET.has(resolved)) {
    const cut = resolved.lastIndexOf('-');
    return { slug: resolved.slice(0, cut), effort: resolved.slice(cut + 1) };
  }
  // Bare slugs stay addressable and fall back to the model's default effort.
  if (Object.prototype.hasOwnProperty.call(CODEX_MODEL_EFFORTS, resolved)) {
    return { slug: resolved, effort: DEFAULT_EFFORT };
  }

  throw new CodexCliError(`Unknown Codex model: ${input}`, 'model_not_found', 400);
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

/**
 * Codex exec takes a single prompt, so the conversation is flattened. Unlike the
 * Antigravity provider there is no sentinel contract: `--json` already frames the
 * final message, so the prompt only has to suppress agentic behaviour.
 */
export function flattenCodexMessages(messages: NormalizedRequest['messages']): string {
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
    'Answer directly in your final message. Do not read files, run commands, ' +
    'browse, edit the workspace, or use tools.',
  );

  if (turns.length > 0) {
    sections.push(
      'CONVERSATION:\n' +
      turns.map(message => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n'),
    );
  }

  return sections.join('\n\n');
}

export interface CodexParsedOutput {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  failure?: string;
}

/**
 * Parse the JSONL event stream emitted by `codex exec --json`. Non-JSON lines are
 * ignored: the CLI interleaves human-readable notices on the same stream.
 */
export function parseCodexEvents(stdout: string): CodexParsedOutput {
  const messages: string[] = [];
  let usage: CodexParsedOutput['usage'];
  let failure: string | undefined;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = event.type;
    if (type === 'item.completed') {
      const item = event.item as { type?: string; text?: string } | undefined;
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        messages.push(item.text);
      }
    } else if (type === 'turn.completed') {
      const raw = event.usage as Record<string, number> | undefined;
      if (raw) {
        const promptTokens = (raw.input_tokens ?? 0) + (raw.cached_input_tokens ?? 0);
        const completionTokens = raw.output_tokens ?? 0;
        usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        };
      }
    } else if (type === 'turn.failed' || type === 'error') {
      const detail = (event.error ?? event.message) as { message?: string } | string | undefined;
      failure = typeof detail === 'string' ? detail : detail?.message ?? 'Codex turn failed';
    }
  }

  // Only the last assistant message is the answer; earlier ones are progress notes.
  return { content: messages.length > 0 ? messages[messages.length - 1]!.trim() : '', usage, failure };
}

function minimalCodexEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = [
    'CODEX_HOME',
    'HOME',
    'PATH',
    'LANG',
    'LC_ALL',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'TMPDIR',
  ];
  const environment: NodeJS.ProcessEnv = { NO_COLOR: '1' };
  for (const name of allowed) {
    if (source[name]) environment[name] = source[name];
  }
  return environment;
}

function classifyCodexFailure(exitCode: number | null, stderr: string): CodexCliError {
  if (/not logged in|unauthorized|401|auth.*(failed|required)|token.*expir|refresh.*failed/i.test(stderr)) {
    return new CodexCliError('Codex authentication is unavailable', 'upstream_auth', 503);
  }
  if (/usage limit|rate.?limit|quota|429|too many requests/i.test(stderr)) {
    return new CodexCliError('Codex usage limit reached', 'upstream_quota', 429);
  }
  return new CodexCliError(
    `Codex process failed with exit code ${exitCode ?? 'unknown'}`,
    'upstream_error',
    502,
  );
}

export class CodexCliAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;
  private readonly spawnProcess: SpawnCodex;
  private readonly binary: string;
  private readonly scratchRoot: string;
  private readonly sandbox: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly killGraceMs: number;
  private readonly timeoutGraceMs: number;

  constructor(config: ProviderConfig, options: CodexCliAdapterOptions = {}) {
    this.config = config;
    this.spawnProcess = options.spawnProcess ?? (spawn as SpawnCodex);
    this.binary = options.binary ?? process.env.CODEX_BIN ?? 'codex';
    this.scratchRoot = options.scratchRoot
      ?? process.env.CODEX_SCRATCH_ROOT
      ?? join(tmpdir(), 'codexproxy');
    this.sandbox = options.sandbox ?? process.env.CODEX_SANDBOX ?? 'read-only';
    this.environment = options.environment ?? process.env;
    this.killGraceMs = options.killGraceMs ?? 5_000;
    this.timeoutGraceMs = options.timeoutGraceMs ?? 15_000;
  }

  getRuntimeInfo(): CodexRuntimeInfo {
    return {
      binary: this.binary,
      scratch_root: this.scratchRoot,
      codex_home: this.environment.CODEX_HOME ?? null,
      sandbox: this.sandbox,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      gid: typeof process.getgid === 'function' ? process.getgid() : null,
    };
  }

  async getVersion(): Promise<string> {
    return (await this.runProcess(
      ['--version'],
      Math.min(this.config.timeout_ms, 15_000),
      'version-',
    )).stdout.trim();
  }

  translateRequest(req: NormalizedRequest): { body: CodexExecutionRequest; headers: Record<string, string> } {
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
      throw new CodexCliError('messages must be a non-empty array', 'invalid_request', 400);
    }
    if (req.tools && req.tools.length > 0) {
      throw new CodexCliError('Codex CLI does not support tool calls', 'unsupported_tools', 400);
    }

    const { slug, effort } = resolveCodexModel(req.model || this.config.models[0] || 'default');
    return {
      body: { slug, effort, prompt: flattenCodexMessages(req.messages), stream: req.stream },
      headers: {},
    };
  }

  async execute(requestBody: unknown): Promise<NormalizedResponse> {
    const request = requestBody as Partial<CodexExecutionRequest>;
    if (typeof request.prompt !== 'string' || !request.prompt) {
      throw new CodexCliError('Invalid local Codex request', 'invalid_request', 400);
    }

    const slug = request.slug
      ?? resolveCodexModel(String(this.config.models[0] ?? 'default')).slug;
    const effort = request.effort ?? DEFAULT_EFFORT;
    const requestId = randomUUID();
    const result = await this.runCodex(request.prompt, slug, effort, requestId);
    return this.translateResponse(result);
  }

  translateStreamChunk(raw: Buffer): NormalizedChunk[] {
    const parsed = parseCodexEvents(raw.toString('utf8'));
    if (!parsed.content) return [];
    return [{
      id: `chatcmpl-${randomUUID()}`,
      model: this.config.models[0] ?? '',
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: parsed.content },
        finish_reason: 'stop',
      }],
    }];
  }

  translateResponse(raw: unknown): NormalizedResponse {
    const result = raw as Partial<CodexProcessResult>;
    const stdout = typeof result.stdout === 'string' ? result.stdout : String(raw ?? '');
    const parsed = parseCodexEvents(stdout);

    if (parsed.failure && !parsed.content) {
      throw new CodexCliError(parsed.failure, 'upstream_error', 502);
    }
    if (!parsed.content) {
      throw new CodexCliError('Codex returned an empty response', 'empty_upstream_response', 502);
    }

    return {
      id: `chatcmpl-${result.requestId ?? randomUUID()}`,
      model: result.model ?? this.config.models[0] ?? '',
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        message: { role: 'assistant', content: parsed.content },
        finish_reason: 'stop',
      }],
      usage: parsed.usage,
    };
  }

  async checkHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      const result = await this.runProcess(
        ['login', 'status'],
        Math.min(this.config.timeout_ms, 30_000),
        'health-',
      );
      if (/not logged in/i.test(result.stdout)) {
        return {
          status: 'unhealthy',
          latency_ms: Date.now() - start,
          error: 'Codex is not logged in',
        };
      }
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
    return this.config.models.length > 0 ? [...this.config.models] : [...CODEX_MODELS];
  }

  private async runCodex(
    prompt: string,
    slug: string,
    effort: string,
    requestId: string,
  ): Promise<CodexProcessResult> {
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--sandbox', this.sandbox,
      '--model', slug,
      '-c', `model_reasoning_effort="${effort}"`,
    ];
    const { stdout } = await this.runProcess(
      args,
      this.config.timeout_ms + this.timeoutGraceMs,
      'request-',
      prompt,
    );
    return { stdout, requestId, prompt, model: `${slug}-${effort}` };
  }

  private async runProcess(
    args: string[],
    hardTimeoutMs: number,
    scratchPrefix: string,
    stdinPayload?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    await mkdir(this.scratchRoot, { recursive: true, mode: 0o700 });
    const scratch = await mkdtemp(join(this.scratchRoot, scratchPrefix));
    let timedOut = false;

    try {
      return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = this.spawnProcess(this.binary, args, {
          cwd: scratch,
          env: minimalCodexEnv(this.environment),
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        let killTimer: NodeJS.Timeout | undefined;

        const finish = (callback: (out: string, err: string) => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          if (killTimer) clearTimeout(killTimer);
          callback(Buffer.concat(stdout).toString('utf8'), Buffer.concat(stderr).toString('utf8'));
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
          finish(() => reject(new CodexCliError(
            `Could not start Codex: ${error.message}`,
            'spawn_failed',
            502,
          )));
        });
        child.once('close', code => {
          finish((out, err) => {
            if (timedOut) {
              reject(new CodexCliError('Codex request timed out', 'upstream_timeout', 504));
            } else if (stdoutBytes > MAX_STDOUT_BYTES || stderrBytes > MAX_STDERR_BYTES) {
              reject(new CodexCliError('Codex output exceeded the safety limit', 'output_too_large', 502));
            } else if (code !== 0) {
              reject(classifyCodexFailure(code, err));
            } else {
              resolve({ stdout: out, stderr: err });
            }
          });
        });

        // The prompt goes through stdin so it never lands in argv or a process listing.
        child.stdin.end(stdinPayload ?? '');
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
