import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type FastifyInstance } from 'fastify';
import {
  AGY_MODELS,
  AgyCliAdapter,
  type AgyRuntimeInfo,
} from '../../providers/agy-cli-adapter.js';
import {
  AgyDiagnosticStore,
  getDefaultAgyDiagnosticStore,
} from '../../providers/agy-diagnostics.js';
import { providerRegistry } from '../../providers/registry.js';
import {
  AgyOAuthSessionManager,
  type AgyOAuthController,
} from '../../providers/agy-oauth-session.js';
import { type NormalizedResponse, type ProviderConfig } from '../../providers/interface.js';

interface ProfileFileStatus {
  present: boolean;
  size_bytes?: number;
  modified_at?: string;
  mode?: string;
  uid?: number;
  gid?: number;
}

interface AgyProfileStatus {
  home: string;
  profile_root: string;
  ready: boolean;
  files: Record<string, ProfileFileStatus>;
}

interface AgyOperationsAdapter {
  readonly config: ProviderConfig;
  getRuntimeInfo(): AgyRuntimeInfo;
  getVersion(): Promise<string>;
  listModels(): Promise<string[]>;
  translateRequest(request: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    stream: boolean;
  }): { body: unknown; headers: Record<string, string> };
  execute(requestBody: unknown): Promise<NormalizedResponse>;
}

export interface AgyAdminDependencies {
  getAdapter?: () => AgyOperationsAdapter;
  diagnosticStore?: AgyDiagnosticStore | null;
  home?: string;
  importKey?: () => string | undefined;
  oauthController?: AgyOAuthController;
}

const PROFILE_FILES = ['oauth_creds.json', 'google_accounts.json', 'settings.json'] as const;
const MAX_PROMPT_CHARS = 20_000;

function fallbackConfig(): ProviderConfig {
  return {
    id: 'agy-local-operations',
    name: 'Antigravity CLI local operations',
    provider_type: 'agy-cli',
    base_url: 'local://agy',
    api_key: 'local-agy',
    models: [...AGY_MODELS],
    timeout_ms: Number(process.env.AGY_TIMEOUT_MS) || 300_000,
    max_retries: 0,
  };
}

function defaultAdapter(): AgyOperationsAdapter {
  const registered = providerRegistry.getAllAdapters().find(
    adapter => adapter.config.provider_type === 'agy-cli',
  );
  return registered instanceof AgyCliAdapter ? registered : new AgyCliAdapter(fallbackConfig());
}

function secureEqual(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

async function fileStatus(path: string): Promise<ProfileFileStatus> {
  try {
    const details = await stat(path);
    return {
      present: details.isFile(),
      size_bytes: details.size,
      modified_at: details.mtime.toISOString(),
      mode: `0${(details.mode & 0o777).toString(8)}`,
      uid: details.uid,
      gid: details.gid,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { present: false };
    throw error;
  }
}

async function inspectProfile(home: string): Promise<AgyProfileStatus> {
  const profileRoot = join(home, '.gemini');
  const entries = await Promise.all(PROFILE_FILES.map(async name => [
    name,
    await fileStatus(join(profileRoot, name)),
  ] as const));
  const files = Object.fromEntries(entries);
  return {
    home,
    profile_root: profileRoot,
    ready: PROFILE_FILES.every(name => files[name]?.present === true),
    files,
  };
}

function validateProfileBundle(body: unknown): Record<(typeof PROFILE_FILES)[number], unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Profile import body must be a JSON object');
  }
  const payload = body as Record<string, unknown>;
  const files = payload.files as Record<string, unknown> | undefined;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('Profile import requires a files object');
  }
  for (const name of PROFILE_FILES) {
    const value = files[name];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Profile import requires ${name}`);
    }
  }
  const credentials = files['oauth_creds.json'] as Record<string, unknown>;
  if (typeof credentials.refresh_token !== 'string' || credentials.refresh_token.length < 10) {
    throw new Error('oauth_creds.json is missing a refresh token');
  }
  const accounts = files['google_accounts.json'] as Record<string, unknown>;
  if (typeof accounts.active !== 'string' || !accounts.active.includes('@')) {
    throw new Error('google_accounts.json is missing the active account');
  }
  return files as Record<(typeof PROFILE_FILES)[number], unknown>;
}

async function importProfile(home: string, body: unknown): Promise<AgyProfileStatus> {
  const current = await inspectProfile(home);
  if (current.files['oauth_creds.json']?.present) {
    throw Object.assign(new Error('An AGY OAuth profile already exists; replacement is disabled'), { status: 409 });
  }

  const files = validateProfileBundle(body);
  const profileRoot = join(home, '.gemini');
  await mkdir(profileRoot, { recursive: true, mode: 0o700 });
  await chmod(profileRoot, 0o700).catch(() => undefined);
  const temporary: Array<{ path: string; destination: string }> = [];

  try {
    for (const name of PROFILE_FILES) {
      const destination = join(profileRoot, name);
      const path = join(profileRoot, `.${name}.${randomUUID()}.tmp`);
      await writeFile(path, JSON.stringify(files[name], null, 2), { encoding: 'utf8', mode: 0o600 });
      await chmod(path, 0o600).catch(() => undefined);
      temporary.push({ path, destination });
    }
    for (const file of temporary) await rename(file.path, file.destination);
  } finally {
    await Promise.all(temporary.map(file => rm(file.path, { force: true })));
  }

  return inspectProfile(home);
}

function errorResponse(error: unknown): { status: number; payload: Record<string, unknown> } {
  const status = Number((error as { status?: number }).status) || 500;
  const code = String((error as { code?: string }).code ?? 'agy_operation_failed');
  const message = error instanceof Error ? error.message : String(error);
  return {
    status,
    payload: { error: { type: 'agy_operation_error', code, message } },
  };
}

export async function registerAdminAgyRoutes(
  app: FastifyInstance,
  dependencies: AgyAdminDependencies = {},
): Promise<void> {
  const getAdapter = dependencies.getAdapter ?? defaultAdapter;
  const diagnostics = dependencies.diagnosticStore === undefined
    ? getDefaultAgyDiagnosticStore()
    : dependencies.diagnosticStore;
  const home = dependencies.home ?? process.env.AGY_HOME ?? process.env.HOME ?? '/storage';
  const getImportKey = dependencies.importKey ?? (() => process.env.AGY_PROFILE_IMPORT_KEY);
  const oauth = dependencies.oauthController ?? new AgyOAuthSessionManager({
    home,
    diagnosticStore: diagnostics,
  });

  app.get('/api/admin/agy', async (_request, reply) => reply.send({
    service_boundary: 'ee-router-local-process',
    authentication: 'Authorization: Bearer <ADMIN_API_KEY>',
    oauth_import_authentication: 'X-AGY-Import-Key plus admin bearer token',
    arbitrary_shell_access: false,
    endpoints: [
      'GET /api/admin/agy',
      'GET /api/admin/agy/status',
      'GET /api/admin/agy/version',
      'POST /api/admin/agy/models',
      'POST /api/admin/agy/run',
      'GET /api/admin/agy/logs?limit=50',
      'GET /api/admin/agy/logs/:traceId',
      'GET /api/admin/agy/oauth/status',
      'POST /api/admin/agy/oauth/start',
      'GET /api/admin/agy/oauth/session?session_id=<id>',
      'POST /api/admin/agy/oauth/code',
      'POST /api/admin/agy/oauth/cancel',
      'GET /api/admin/agy/oauth/import',
      'POST /api/admin/agy/oauth/import',
      'POST /api/admin/agy/oauth/verify',
    ],
  }));

  app.get('/api/admin/agy/status', async (_request, reply) => {
    try {
      const adapter = getAdapter();
      const [profile, recent] = await Promise.all([
        inspectProfile(home),
        diagnostics?.list(1) ?? Promise.resolve([]),
      ]);
      return reply.send({
        service_boundary: 'ee-router-local-process',
        provider: {
          id: adapter.config.id,
          name: adapter.config.name,
          type: adapter.config.provider_type,
          location: adapter.config.base_url,
          timeout_ms: adapter.config.timeout_ms,
          models: adapter.config.models,
        },
        runtime: adapter.getRuntimeInfo(),
        profile,
        diagnostics: {
          enabled: Boolean(diagnostics),
          root: diagnostics?.root ?? null,
          last_trace: recent[0] ?? null,
        },
      });
    } catch (error) {
      const failure = errorResponse(error);
      return reply.status(failure.status).send(failure.payload);
    }
  });

  app.get('/api/admin/agy/version', async (_request, reply) => {
    try {
      const version = await getAdapter().getVersion();
      return reply.send({ version });
    } catch (error) {
      const failure = errorResponse(error);
      return reply.status(failure.status).send(failure.payload);
    }
  });

  app.post('/api/admin/agy/models', async (_request, reply) => {
    try {
      const models = await getAdapter().listModels();
      return reply.send({ models, command: 'agy models', runtime: 'local' });
    } catch (error) {
      const failure = errorResponse(error);
      return reply.status(failure.status).send(failure.payload);
    }
  });

  app.post('/api/admin/agy/run', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
        return reply.status(400).send({
          error: { type: 'invalid_request_error', message: `prompt must contain 1-${MAX_PROMPT_CHARS} characters` },
        });
      }
      const adapter = getAdapter();
      const model = typeof body.model === 'string'
        ? body.model
        : adapter.config.models[0] ?? 'gemini-3.6-flash-low';
      const translated = adapter.translateRequest({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      });
      const response = await adapter.execute(translated.body);
      return reply.send({
        runtime: 'local',
        trace_id: response.id.replace(/^chatcmpl-/, ''),
        response,
      });
    } catch (error) {
      const failure = errorResponse(error);
      return reply.status(failure.status).send(failure.payload);
    }
  });

  app.get('/api/admin/agy/logs', async (request, reply) => {
    if (!diagnostics) return reply.send({ enabled: false, records: [] });
    const rawLimit = Number((request.query as { limit?: string }).limit ?? 50);
    const records = await diagnostics.list(Number.isFinite(rawLimit) ? rawLimit : 50);
    return reply.send({ enabled: true, records });
  });

  app.get('/api/admin/agy/logs/:traceId', async (request, reply) => {
    if (!diagnostics) return reply.status(404).send({ error: { message: 'AGY diagnostics are disabled' } });
    const { traceId } = request.params as { traceId: string };
    const record = await diagnostics.get(traceId);
    if (!record) return reply.status(404).send({ error: { message: 'AGY trace not found' } });
    return reply.send(record);
  });

  app.get('/api/admin/agy/oauth/status', async (_request, reply) => reply.send(await inspectProfile(home)));

  app.post('/api/admin/agy/oauth/start', async (_request, reply) => {
    try {
      return reply.status(201).send(await oauth.start());
    } catch (error) {
      return reply.status(409).send({
        error: { type: 'agy_oauth_error', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.get('/api/admin/agy/oauth/session', async (request, reply) => {
    const query = request.query as { session_id?: string };
    const session = oauth.status(query.session_id);
    if (!session) return reply.status(404).send({ error: { type: 'agy_oauth_error', message: 'Antigravity OAuth session not found' } });
    return reply.send(session);
  });

  app.post('/api/admin/agy/oauth/code', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (typeof body.session_id !== 'string' || typeof body.code !== 'string') {
        return reply.status(400).send({ error: { type: 'invalid_request_error', message: 'session_id and code are required' } });
      }
      return reply.send(oauth.submitCode(body.session_id, body.code));
    } catch (error) {
      return reply.status(409).send({
        error: { type: 'agy_oauth_error', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.post('/api/admin/agy/oauth/cancel', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (typeof body.session_id !== 'string') {
        return reply.status(400).send({ error: { type: 'invalid_request_error', message: 'session_id is required' } });
      }
      return reply.send(oauth.cancel(body.session_id));
    } catch (error) {
      return reply.status(409).send({
        error: { type: 'agy_oauth_error', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  app.get('/api/admin/agy/oauth/import', async (_request, reply) => {
    const key = getImportKey();
    const profile = await inspectProfile(home);
    return reply.send({
      ready: Boolean(key && key.length >= 32 && !profile.files['oauth_creds.json']?.present),
      import_key_configured: Boolean(key && key.length >= 32),
      existing_profile: profile.files['oauth_creds.json']?.present === true,
      transport: 'HTTPS JSON body; token contents are never logged or returned',
    });
  });

  app.post('/api/admin/agy/oauth/import', async (request, reply) => {
    const expected = getImportKey() ?? '';
    const actualHeader = request.headers['x-agy-import-key'];
    const actual = Array.isArray(actualHeader) ? actualHeader[0] ?? '' : actualHeader ?? '';
    if (expected.length < 32 || !actual || !secureEqual(actual, expected)) {
      return reply.status(401).send({
        error: { type: 'authentication_error', message: 'Invalid AGY profile import credentials' },
      });
    }
    try {
      const profile = await importProfile(home, request.body);
      return reply.status(201).send({
        imported: true,
        profile,
        secret_values_returned: false,
      });
    } catch (error) {
      const failure = errorResponse(error);
      return reply.status(failure.status).send(failure.payload);
    }
  });

  app.post('/api/admin/agy/oauth/verify', async (request, reply) => {
    try {
      const adapter = getAdapter();
      const profile = await inspectProfile(home);
      if (!profile.ready) {
        return reply.status(409).send({
          error: { type: 'agy_profile_error', message: 'AGY OAuth profile is incomplete' },
          profile,
        });
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const marker = typeof body.marker === 'string' && body.marker.trim()
        ? body.marker.trim().slice(0, 120)
        : `AGY_OAUTH_VERIFY_${Date.now()}`;
      const model = typeof body.model === 'string' ? body.model : 'gemini-3.6-flash-low';
      const models = await adapter.listModels();
      const translated = adapter.translateRequest({
        model,
        messages: [{ role: 'user', content: `Reply with exactly this marker: ${marker}` }],
        stream: false,
      });
      const response = await adapter.execute(translated.body);
      const content = response.choices[0]?.message.content ?? '';
      return reply.send({
        verified: content.includes(marker),
        marker,
        model,
        models_command_succeeded: models.length > 0,
        trace_id: response.id.replace(/^chatcmpl-/, ''),
        response,
      });
    } catch (error) {
      const failure = errorResponse(error);
      return reply.status(failure.status).send(failure.payload);
    }
  });
}
