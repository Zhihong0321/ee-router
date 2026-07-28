import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAdminAgyRoutes } from '../../src/api/admin/agy.js';
import { AgyDiagnosticStore } from '../../src/providers/agy-diagnostics.js';
import type { NormalizedResponse, ProviderConfig } from '../../src/providers/interface.js';

const temporaryRoots: string[] = [];
const apps: Array<ReturnType<typeof Fastify>> = [];

const config: ProviderConfig = {
  id: 'agy-local',
  name: 'AGY local',
  provider_type: 'agy-cli',
  base_url: 'local://agy',
  api_key: 'local-agy',
  models: ['gemini-3.6-flash-low'],
  timeout_ms: 300_000,
  max_retries: 0,
};

function response(content = 'AGY_ADMIN_OK'): NormalizedResponse {
  return {
    id: 'chatcmpl-admin-trace',
    model: 'gemini-3.6-flash-low',
    created: 123,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  };
}

function fakeAdapter(content = 'AGY_ADMIN_OK') {
  return {
    config,
    getRuntimeInfo: vi.fn(() => ({
      binary: '/usr/local/bin/agy',
      scratch_root: '/tmp/agyproxy',
      diagnostics_root: '/storage/agy-diagnostics',
      home: '/storage',
      uid: 1000,
      gid: 1000,
    })),
    getVersion: vi.fn().mockResolvedValue('agy 1.2.3'),
    listModels: vi.fn().mockResolvedValue(['gemini-3.6-flash-low']),
    translateRequest: vi.fn(request => ({
      body: { model: request.model, prompt: request.messages[0]?.content, stream: false },
      headers: {},
    })),
    execute: vi.fn().mockResolvedValue(response(content)),
  };
}

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('AGY admin operations API', () => {
  it('exposes capabilities, status, controlled execution, and sanitized persistent logs', async () => {
    const home = await makeRoot('eter-agy-admin-home-');
    const diagnosticsRoot = await makeRoot('eter-agy-admin-logs-');
    const diagnostics = new AgyDiagnosticStore(diagnosticsRoot);
    await diagnostics.record({
      traceId: 'trace-redaction-test',
      operation: 'chat',
      startedAt: 100,
      finishedAt: 120,
      status: 'success',
      binary: '/usr/local/bin/agy',
      args: ['-p', 'secret prompt', '--model', 'gemini-3.6-flash-low'],
      cwdLabel: 'request-',
      home,
      timeoutMs: 1000,
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdoutBytes: 80,
      stderrBytes: 0,
      stdout: 'Bearer top-secret-token access_token="token-value"',
      stderr: '',
      model: 'gemini-3.6-flash-low',
      prompt: 'secret prompt',
    });
    const adapter = fakeAdapter();
    const app = Fastify();
    apps.push(app);
    await registerAdminAgyRoutes(app, {
      getAdapter: () => adapter,
      diagnosticStore: diagnostics,
      home,
      importKey: () => 'i'.repeat(32),
    });

    const capabilities = await app.inject({ method: 'GET', url: '/api/admin/agy' });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toMatchObject({
      service_boundary: 'ee-router-local-process',
      arbitrary_shell_access: false,
    });

    const status = await app.inject({ method: 'GET', url: '/api/admin/agy/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      provider: { type: 'agy-cli', location: 'local://agy' },
      profile: { ready: false },
      diagnostics: { enabled: true },
    });

    const run = await app.inject({
      method: 'POST',
      url: '/api/admin/agy/run',
      payload: { model: 'gemini-3.6-flash-low', prompt: 'Return a marker' },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({
      runtime: 'local',
      trace_id: 'admin-trace',
      response: { choices: [{ message: { content: 'AGY_ADMIN_OK' } }] },
    });
    expect(adapter.execute).toHaveBeenCalled();

    const logs = await app.inject({ method: 'GET', url: '/api/admin/agy/logs' });
    expect(logs.statusCode).toBe(200);
    const serialized = JSON.stringify(logs.json());
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('top-secret-token');
    expect(serialized).not.toContain('token-value');
    expect(serialized).not.toContain('secret prompt');
    expect(serialized).toContain('prompt_chars');
  });

  it('imports one OAuth profile with a separate key and never returns credential values', async () => {
    const home = await makeRoot('eter-agy-oauth-home-');
    const app = Fastify();
    apps.push(app);
    await registerAdminAgyRoutes(app, {
      getAdapter: () => fakeAdapter('OAUTH_MARKER'),
      diagnosticStore: null,
      home,
      importKey: () => 'k'.repeat(32),
    });
    const bundle = {
      files: {
        'oauth_creds.json': {
          access_token: 'access-secret',
          refresh_token: 'refresh-secret-value',
          id_token: 'id-secret',
          expiry_date: Date.now() + 3600_000,
          token_type: 'Bearer',
        },
        'google_accounts.json': { active: 'first@example.test', old: [] },
        'settings.json': { security: { auth: { selectedType: 'oauth-personal' } } },
      },
    };

    const preflight = await app.inject({ method: 'GET', url: '/api/admin/agy/oauth/import' });
    expect(preflight.json()).toMatchObject({ ready: true, import_key_configured: true, existing_profile: false });

    const denied = await app.inject({
      method: 'POST',
      url: '/api/admin/agy/oauth/import',
      headers: { 'x-agy-import-key': 'wrong' },
      payload: bundle,
    });
    expect(denied.statusCode).toBe(401);

    const imported = await app.inject({
      method: 'POST',
      url: '/api/admin/agy/oauth/import',
      headers: { 'x-agy-import-key': 'k'.repeat(32) },
      payload: bundle,
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({
      imported: true,
      secret_values_returned: false,
      profile: { ready: true },
    });
    const serialized = imported.body;
    expect(serialized).not.toContain('access-secret');
    expect(serialized).not.toContain('refresh-secret-value');
    expect(serialized).not.toContain('first@example.test');

    const secondImport = await app.inject({
      method: 'POST',
      url: '/api/admin/agy/oauth/import',
      headers: { 'x-agy-import-key': 'k'.repeat(32) },
      payload: bundle,
    });
    expect(secondImport.statusCode).toBe(409);
  });

  it('verifies the imported profile with agy models and a controlled marker prompt', async () => {
    const home = await makeRoot('eter-agy-verify-home-');
    const marker = 'AGY_VERIFY_TEST';
    const adapter = fakeAdapter(marker);
    const app = Fastify();
    apps.push(app);
    await registerAdminAgyRoutes(app, {
      getAdapter: () => adapter,
      diagnosticStore: null,
      home,
      importKey: () => 'v'.repeat(32),
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/agy/oauth/import',
      headers: { 'x-agy-import-key': 'v'.repeat(32) },
      payload: {
        files: {
          'oauth_creds.json': { refresh_token: 'refresh-token-value' },
          'google_accounts.json': { active: 'first@example.test', old: [] },
          'settings.json': { security: { auth: { selectedType: 'oauth-personal' } } },
        },
      },
    });

    const verified = await app.inject({
      method: 'POST',
      url: '/api/admin/agy/oauth/verify',
      payload: { marker, model: 'gemini-3.6-flash-low' },
    });

    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      verified: true,
      marker,
      model: 'gemini-3.6-flash-low',
      models_command_succeeded: true,
      trace_id: 'admin-trace',
    });
    expect(adapter.listModels).toHaveBeenCalled();
    expect(adapter.execute).toHaveBeenCalled();
  });

  it('operates a constrained OAuth process through start, status, code, and cancel endpoints', async () => {
    const home = await makeRoot('eter-agy-oauth-session-home-');
    const snapshot = {
      session_id: 'oauth-session-test',
      state: 'waiting' as const,
      auth_url: 'https://accounts.google.com/o/oauth2/auth?state=test',
      started_at: new Date(0).toISOString(),
      expires_at: new Date(60_000).toISOString(),
      message: 'Open the Google consent URL',
      code_required: true,
      secret_values_returned: false as const,
    };
    const oauthController = {
      start: vi.fn().mockResolvedValue(snapshot),
      status: vi.fn().mockReturnValue(snapshot),
      submitCode: vi.fn().mockReturnValue({ ...snapshot, state: 'completing', auth_url: undefined }),
      cancel: vi.fn().mockReturnValue({ ...snapshot, state: 'cancelled', auth_url: undefined }),
    };
    const app = Fastify();
    apps.push(app);
    await registerAdminAgyRoutes(app, {
      getAdapter: () => fakeAdapter(),
      diagnosticStore: null,
      home,
      oauthController,
    });

    const started = await app.inject({ method: 'POST', url: '/api/admin/agy/oauth/start' });
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({ session_id: 'oauth-session-test', state: 'waiting' });

    const status = await app.inject({
      method: 'GET',
      url: '/api/admin/agy/oauth/session?session_id=oauth-session-test',
    });
    expect(status.statusCode).toBe(200);

    const code = await app.inject({
      method: 'POST',
      url: '/api/admin/agy/oauth/code',
      payload: { session_id: 'oauth-session-test', code: '4/0-test-code' },
    });
    expect(code.statusCode).toBe(200);
    expect(oauthController.submitCode).toHaveBeenCalledWith('oauth-session-test', '4/0-test-code');
    expect(code.body).not.toContain('4/0-test-code');

    const cancelled = await app.inject({
      method: 'POST',
      url: '/api/admin/agy/oauth/cancel',
      payload: { session_id: 'oauth-session-test' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(oauthController.cancel).toHaveBeenCalledWith('oauth-session-test');
  });
});
