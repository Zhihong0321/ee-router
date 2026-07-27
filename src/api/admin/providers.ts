import { type FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import { providerRegistry } from '../../providers/registry.js';
import { encryptProviderKey, decryptProviderKey } from '../../security/provider-key.js';
import { discoverModels } from '../../providers/model-discovery.js';
import { type ProviderConfig } from '../../providers/interface.js';

const providerTypes: ProviderConfig['provider_type'][] = ['openai-compatible', 'anthropic', 'gemini', 'custom'];

function parseModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(model => String(model).trim()).filter(Boolean))];
}

function validateExpiry(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error('api_key_expires_at must be a valid ISO date');
  }
  return date.toISOString();
}

function validateBaseUrl(value: unknown): string {
  if (!value) throw new Error('base_url is required');
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('base_url must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

function validateProviderType(value: unknown): ProviderConfig['provider_type'] {
  const providerType = String(value || 'openai-compatible') as ProviderConfig['provider_type'];
  if (!providerTypes.includes(providerType)) {
    throw new Error('invalid provider_type');
  }
  return providerType;
}

function errorStatus(message: string): 400 | 500 {
  return message.includes('required') || message.includes('invalid') || message.includes('must ') ? 400 : 500;
}

export async function registerAdminProviderRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/providers
  app.get('/api/admin/providers', async (_request, reply) => {
    try {
      const rows = await query<Record<string, unknown>>(
        'SELECT id, name, provider_type, base_url, models, is_active, api_key_expires_at, timeout_ms, max_retries, extra_headers, key_prefix, created_at FROM providers ORDER BY created_at DESC'
      );
      return reply.send(rows);
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });

  // POST /api/admin/providers/discover — verify credentials and fetch model IDs without saving.
  app.post('/api/admin/providers/discover', async (request, reply) => {
    try {
      const body = request.body as { provider_type?: string; base_url?: string; api_key?: string };
      if (!body.api_key) return reply.status(400).send({ error: 'api_key is required' });
      const providerType = validateProviderType(body.provider_type);
      const baseUrl = validateBaseUrl(body.base_url);
      const models = await discoverModels({ provider_type: providerType, base_url: baseUrl, api_key: body.api_key });
      return reply.send({ models });
    } catch (error) {
      const message = String(error).replace(/^Error: /, '');
      return reply.status(errorStatus(message)).send({ error: message });
    }
  });

  // POST /api/admin/providers/:id/discover — discover models using the saved key unless a replacement key is supplied.
  app.post('/api/admin/providers/:id/discover', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { provider_type?: string; base_url?: string; api_key?: string };
      const rows = await query<{
        provider_type: string;
        base_url: string;
        api_key_enc: string;
        api_key_iv: string;
      }>(
        'SELECT provider_type, base_url, api_key_enc, api_key_iv FROM providers WHERE id = $1',
        [id],
      );
      const existing = rows[0];
      if (!existing) return reply.status(404).send({ error: 'provider not found' });

      const providerType = validateProviderType(body.provider_type ?? existing.provider_type);
      const baseUrl = validateBaseUrl(body.base_url ?? existing.base_url);
      const apiKey = body.api_key?.trim() || decryptProviderKey(existing.api_key_enc, existing.api_key_iv);
      const models = await discoverModels({ provider_type: providerType, base_url: baseUrl, api_key: apiKey });
      return reply.send({ models });
    } catch (error) {
      const message = String(error).replace(/^Error: /, '');
      return reply.status(errorStatus(message)).send({ error: message });
    }
  });

  // POST /api/admin/providers
  app.post('/api/admin/providers', async (request, reply) => {
    try {
      const body = request.body as {
        name: string;
        provider_type?: string;
        base_url: string;
        api_key: string;
        models?: unknown;
        api_key_expires_at?: string | null;
        timeout_ms?: number;
        max_retries?: number;
        extra_headers?: Record<string, string>;
      };

      if (!body.name || !body.api_key) {
        return reply.status(400).send({ error: 'name and api_key are required' });
      }

      const providerType = validateProviderType(body.provider_type);
      const baseUrl = validateBaseUrl(body.base_url);
      const models = parseModels(body.models);
      const expiresAt = validateExpiry(body.api_key_expires_at);
      const credential = encryptProviderKey(body.api_key);
      const timeoutMs = body.timeout_ms ?? 60_000;
      const maxRetries = body.max_retries ?? 2;

      const rows = await query<{ id: string }>(
        `INSERT INTO providers (name, provider_type, base_url, api_key_enc, api_key_iv, models, api_key_expires_at, timeout_ms, max_retries, extra_headers, key_prefix)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          body.name,
          providerType,
          baseUrl,
          credential.encrypted,
          credential.iv,
          models,
          expiresAt,
          timeoutMs,
          maxRetries,
          JSON.stringify(body.extra_headers ?? {}),
          `key-${body.api_key.slice(0, 4)}…`,
        ]
      );

      providerRegistry.register({
        id: rows[0]!.id,
        name: body.name,
        provider_type: providerType,
        base_url: baseUrl,
        api_key: body.api_key,
        models,
        api_key_expires_at: expiresAt,
        timeout_ms: timeoutMs,
        max_retries: maxRetries,
        extra_headers: body.extra_headers,
      });

      return reply.status(201).send({ id: rows[0]!.id, models });
    } catch (error) {
      const message = String(error).replace(/^Error: /, '');
      return reply.status(errorStatus(message)).send({ error: message });
    }
  });

  // PATCH /api/admin/providers/:id — update provider settings; omit api_key to keep the saved key.
  app.patch('/api/admin/providers/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        provider_type?: string;
        base_url?: string;
        api_key?: string;
        models?: unknown;
        api_key_expires_at?: string | null;
        timeout_ms?: number;
        max_retries?: number;
        extra_headers?: Record<string, string>;
      };

      const rows = await query<{
        id: string;
        name: string;
        provider_type: string;
        base_url: string;
        api_key_enc: string;
        api_key_iv: string;
        models: string[];
        api_key_expires_at: Date | string | null;
        is_active: boolean;
        timeout_ms: number;
        max_retries: number;
        extra_headers: Record<string, string>;
        key_prefix: string | null;
      }>(
        'SELECT id, name, provider_type, base_url, api_key_enc, api_key_iv, models, api_key_expires_at, is_active, timeout_ms, max_retries, extra_headers, key_prefix FROM providers WHERE id = $1',
        [id],
      );
      const existing = rows[0];
      if (!existing) return reply.status(404).send({ error: 'provider not found' });

      const name = body.name?.trim() || existing.name;
      if (!name) return reply.status(400).send({ error: 'name is required' });

      const providerType = validateProviderType(body.provider_type ?? existing.provider_type);
      const baseUrl = validateBaseUrl(body.base_url ?? existing.base_url);
      const models = body.models === undefined ? existing.models : parseModels(body.models);
      const expiresAt = body.api_key_expires_at === undefined
        ? validateExpiry(existing.api_key_expires_at)
        : validateExpiry(body.api_key_expires_at);
      const newApiKey = body.api_key?.trim() || '';
      const apiKey = newApiKey || decryptProviderKey(existing.api_key_enc, existing.api_key_iv);
      const credential = newApiKey ? encryptProviderKey(newApiKey) : {
        encrypted: existing.api_key_enc,
        iv: existing.api_key_iv,
      };
      const keyPrefix = newApiKey ? `key-${newApiKey.slice(0, 4)}…` : existing.key_prefix;
      const timeoutMs = body.timeout_ms ?? existing.timeout_ms;
      const maxRetries = body.max_retries ?? existing.max_retries;
      const extraHeaders = body.extra_headers ?? existing.extra_headers ?? {};

      await query(
        `UPDATE providers
         SET name = $1, provider_type = $2, base_url = $3, api_key_enc = $4, api_key_iv = $5,
             models = $6, api_key_expires_at = $7, timeout_ms = $8, max_retries = $9,
             extra_headers = $10, key_prefix = $11, updated_at = NOW()
         WHERE id = $12`,
        [name, providerType, baseUrl, credential.encrypted, credential.iv, models, expiresAt, timeoutMs, maxRetries, JSON.stringify(extraHeaders), keyPrefix, id],
      );

      providerRegistry.register({
        id,
        name,
        provider_type: providerType,
        base_url: baseUrl,
        api_key: apiKey,
        models,
        is_active: existing.is_active,
        api_key_expires_at: expiresAt,
        timeout_ms: timeoutMs,
        max_retries: maxRetries,
        extra_headers: extraHeaders,
      });

      return reply.send({ id, models });
    } catch (error) {
      const message = String(error).replace(/^Error: /, '');
      return reply.status(errorStatus(message)).send({ error: message });
    }
  });

  // DELETE /api/admin/providers/:id
  app.delete('/api/admin/providers/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await query('DELETE FROM providers WHERE id = $1', [id]);
      providerRegistry.unregister(id);
      return reply.status(204).send();
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });
}
