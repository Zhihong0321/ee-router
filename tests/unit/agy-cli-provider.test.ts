import { EventEmitter } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGY_RESPONSE_END,
  AGY_RESPONSE_START,
  AgyCliAdapter,
  AgyCliError,
  extractAgyResponse,
  flattenAgyMessages,
  resolveAgyModel,
} from '../../src/providers/agy-cli-adapter.js';
import { AgyDiagnosticStore } from '../../src/providers/agy-diagnostics.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import type { ProviderAdapter, ProviderConfig } from '../../src/providers/interface.js';
import { handleNonStreamingProxy, handleStreamingProxy } from '../../src/streaming/stream-handler.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'agy',
    name: 'Antigravity CLI',
    provider_type: 'agy-cli',
    base_url: 'local://agy',
    api_key: 'local-agy',
    models: ['gemini-3.6-flash-low'],
    timeout_ms: 100,
    max_retries: 1,
    ...overrides,
  };
}

async function makeScratchRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eter-agy-test-'));
  temporaryRoots.push(root);
  return root;
}

function createFakeChild(options: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  closeOnStart?: boolean;
  closeOnTerminate?: boolean;
} = {}) {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kill = vi.fn((signal?: NodeJS.Signals | number) => {
    if (signal === 'SIGTERM' && options.closeOnTerminate) {
      queueMicrotask(() => emitter.emit('close', null));
    }
    return true;
  });
  const child = Object.assign(emitter, { stdout, stderr, kill });

  if (options.closeOnStart !== false) {
    setImmediate(() => {
      if (options.stdout) stdout.write(options.stdout);
      if (options.stderr) stderr.write(options.stderr);
      stdout.end();
      stderr.end();
      emitter.emit('close', options.exitCode ?? 0);
    });
  }

  return child;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('AgyCliAdapter', () => {
  it('registers agy-cli as a local adapter, not an HTTP adapter', () => {
    const adapter = new ProviderRegistry().register(makeConfig());

    expect(adapter).toBeInstanceOf(AgyCliAdapter);
    expect(adapter.execute).toBeTypeOf('function');
    expect(adapter.translateRequest({
      model: 'gemini-3.6-flash-low',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
    }).headers).toEqual({});
  });

  it('resolves aliases and rejects unknown models', () => {
    expect(resolveAgyModel('fast')).toBe('gemini-3.6-flash-high');
    expect(resolveAgyModel('default')).toBe('gemini-3.1-pro-high');
    expect(resolveAgyModel('gemini-3.6-flash-low')).toBe('gemini-3.6-flash-low');
    expect(() => resolveAgyModel('not-a-model')).toThrowError(AgyCliError);
  });

  it('flattens conversation roles and installs an exact response contract', () => {
    const prompt = flattenAgyMessages([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Say hello.' },
    ]);

    expect(prompt).toContain('SYSTEM INSTRUCTIONS:\nBe concise.');
    expect(prompt).toContain(`${AGY_RESPONSE_START}\n<answer>\n${AGY_RESPONSE_END}`);
    expect(prompt).toContain('USER:\nSay hello.');
  });

  it('constructs the local command, limits its environment, parses output, and removes scratch data', async () => {
    const scratchRoot = await makeScratchRoot();
    const diagnosticsRoot = await makeScratchRoot();
    const diagnosticStore = new AgyDiagnosticStore(diagnosticsRoot);
    const child = createFakeChild({ closeOnStart: false });
    const spawnProcess = vi.fn(() => {
      setImmediate(() => {
        child.stdout.write(`noise\n${AGY_RESPONSE_START}\nLOCAL_AGY_OK\n${AGY_RESPONSE_END}\n`);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', 0);
      });
      return child;
    }) as never;
    const adapter = new AgyCliAdapter(makeConfig(), {
      spawnProcess,
      binary: '/usr/local/bin/agy',
      scratchRoot,
      environment: {
        HOME: '/storage',
        PATH: '/usr/local/bin:/usr/bin',
        DATABASE_URL: 'must-not-leak',
      },
      timeoutGraceMs: 0,
      diagnosticStore,
    });
    const translated = adapter.translateRequest({
      model: 'gemini-3.6-flash-low',
      messages: [{ role: 'user', content: 'Return a marker.' }],
      stream: false,
    });

    const response = await adapter.execute(translated.body);
    const [command, args, spawnOptions] = (spawnProcess as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;

    expect(command).toBe('/usr/local/bin/agy');
    expect(args).toEqual(expect.arrayContaining([
      '-p', translated.body.prompt,
      '--model', 'gemini-3.6-flash-low',
      '--sandbox',
      '--dangerously-skip-permissions',
      '--print-timeout', '100ms',
      '--log-file', expect.stringMatching(/agy\.log$/),
    ]));
    expect(spawnOptions).toMatchObject({
      shell: false,
      windowsHide: true,
      env: { HOME: '/storage', PATH: '/usr/local/bin:/usr/bin', NO_COLOR: '1' },
    });
    expect(response.choices[0]?.message.content).toBe('LOCAL_AGY_OK');
    expect(response.model).toBe('gemini-3.6-flash-low');
    expect(await pathExists(spawnOptions.cwd)).toBe(false);
    const traces = await diagnosticStore.list();
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      trace_id: expect.any(String),
      operation: 'chat',
      status: 'success',
      request: { model: 'gemini-3.6-flash-low', prompt_chars: translated.body.prompt.length },
      process: { binary: '/usr/local/bin/agy', exit_code: 0, timed_out: false },
    });
    expect(JSON.stringify(traces[0])).not.toContain('Return a marker.');
  });

  it('terminates a timed-out process and removes its scratch directory', async () => {
    const scratchRoot = await makeScratchRoot();
    const child = createFakeChild({ closeOnStart: false, closeOnTerminate: true });
    const spawnProcess = vi.fn(() => child) as never;
    const adapter = new AgyCliAdapter(makeConfig({ timeout_ms: 5 }), {
      spawnProcess,
      scratchRoot,
      killGraceMs: 5,
      timeoutGraceMs: 0,
    });
    const translated = adapter.translateRequest({
      model: 'gemini-3.6-flash-low',
      messages: [{ role: 'user', content: 'Wait.' }],
      stream: false,
    });

    await expect(adapter.execute(translated.body)).rejects.toMatchObject({
      code: 'upstream_timeout',
      status: 504,
    });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    const spawnOptions = (spawnProcess as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![2];
    expect(await pathExists(spawnOptions.cwd)).toBe(false);
  });

  it('sends local non-streaming responses without contacting the configured Base URL', async () => {
    const fetchMock = vi.fn(() => { throw new Error('HTTP must not be used'); });
    vi.stubGlobal('fetch', fetchMock);
    const execute = vi.fn().mockResolvedValue({
      id: 'chatcmpl-local',
      model: 'gemini-3.6-flash-low',
      created: 123,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'same service' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const adapter = { config: makeConfig({ base_url: 'https://agy-bridge.invalid/v1' }), execute } as ProviderAdapter;
    const reply = { send: vi.fn().mockResolvedValue(undefined) };

    const result = await handleNonStreamingProxy(adapter, { prompt: 'x' }, {}, 'openai', reply as never, 'gemini-3.6-flash-low');

    expect(result.status).toBe('success');
    expect(execute).toHaveBeenCalledWith({ prompt: 'x' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      object: 'chat.completion',
      model: 'gemini-3.6-flash-low',
    }));
  });

  it('synthesizes OpenAI streaming events from the local AGY result without HTTP', async () => {
    const fetchMock = vi.fn(() => { throw new Error('HTTP must not be used'); });
    vi.stubGlobal('fetch', fetchMock);
    const execute = vi.fn().mockResolvedValue({
      id: 'chatcmpl-local-stream',
      model: 'gemini-3.6-flash-low',
      created: 123,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'streamed locally' },
        finish_reason: 'stop',
      }],
    });
    const adapter = { config: makeConfig({ base_url: 'https://agy-bridge.invalid/v1' }), execute } as ProviderAdapter;
    const raw = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };

    const result = await handleStreamingProxy(
      adapter,
      { prompt: 'x' },
      {},
      'openai',
      { raw } as never,
      'gemini-3.6-flash-low',
    );

    expect(result.status).toBe('success');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
    }));
    expect(raw.write).toHaveBeenCalledWith(expect.stringContaining('streamed locally'));
    expect(raw.write).toHaveBeenCalledWith('data: [DONE]\n\n');
    expect(raw.end).toHaveBeenCalled();
  });

  it('extracts marked responses and falls back to clean stdout', () => {
    expect(extractAgyResponse(`\u001b[32m${AGY_RESPONSE_START}\nhello\n${AGY_RESPONSE_END}\u001b[0m`)).toEqual({
      content: 'hello',
      sentinelHit: true,
    });
    expect(extractAgyResponse('plain output')).toEqual({
      content: 'plain output',
      sentinelHit: false,
    });
  });
});
