import { type FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import { providerRegistry } from '../../providers/registry.js';
import { encryptProviderKey } from '../../security/provider-key.js';

export async function registerAdminProviderRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/providers
  app.get('/api/admin/providers', async (_request, reply) => {
    try {
      const rows = await query<Record<string, unknown>>(
        'SELECT id, name, provider_type, base_url, models, is_active, timeout_ms, max_retries, extra_headers, created_at FROM providers ORDER BY created_at DESC'
      );
      return reply.send(rows);
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });

  // POST /api/admin/providers
  app.post('/api/admin/providers', async (request, reply) => {
    try {
      const body = request.body as {
        name: string;
        provider_type: string;
        base_url: string;
        api_key: string;
        models: string[];
        timeout_ms?: number;
        max_retries?: number;
        extra_headers?: Record<string, string>;
      };

      if (!body.name || !body.base_url || !body.api_key) {
        return reply.status(400).send({ error: 'name, base_url, and api_key are required' });
      }

      const providerType = body.provider_type ?? 'openai-compatible';
      if (!['openai-compatible', 'anthropic', 'custom'].includes(providerType)) {
        return reply.status(400).send({ error: 'invalid provider_type' });
      }
      const credential = encryptProviderKey(body.api_key);
      const rows = await query<{ id: string }>(
        `INSERT INTO providers (name, provider_type, base_url, api_key_enc, api_key_iv, models, timeout_ms, max_retries, extra_headers)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          body.name,
          providerType,
          body.base_url,
          credential.encrypted,
          credential.iv,
          body.models ?? [],
          body.timeout_ms ?? 60_000,
          body.max_retries ?? 2,
          JSON.stringify(body.extra_headers ?? {}),
        ]
      );

      // Register in-memory
      providerRegistry.register({
        id: rows[0]!.id,
        name: body.name,
        provider_type: providerType as 'openai-compatible' | 'anthropic' | 'custom',
        base_url: body.base_url,
        api_key: body.api_key,
        models: body.models ?? [],
        timeout_ms: body.timeout_ms ?? 60_000,
        max_retries: body.max_retries ?? 2,
        extra_headers: body.extra_headers,
      });

      return reply.status(201).send({ id: rows[0]!.id });
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
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