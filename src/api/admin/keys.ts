import { type FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import { clearKeyCache } from '../../auth/api-key.js';
import { createHash, randomBytes } from 'node:crypto';

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
}

function parsePriority(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const priority = Number(value);
  if (!Number.isFinite(priority)) throw new Error('priority must be a number');
  return Math.max(0, Math.trunc(priority));
}

function isBadInput(message: string): boolean {
  return message.includes('required') || message.includes('must be');
}

export async function registerAdminKeyRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/keys
  app.get('/api/admin/keys', async (_request, reply) => {
    try {
      const rows = await query<Record<string, unknown>>(
        'SELECT id, key_prefix, name, description, is_active, rate_limit, allowed_ips, ' +
        'priority, provider_ids, allowed_models, created_at, updated_at ' +
        'FROM api_keys ORDER BY priority DESC, created_at DESC'
      );
      return reply.send(rows);
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });

  // POST /api/admin/keys
  app.post('/api/admin/keys', async (request, reply) => {
    try {
      const body = request.body as {
        name: string;
        description?: string;
        priority?: number;
        is_active?: boolean;
        provider_ids?: unknown;
        allowed_models?: unknown;
      };
      if (!body.name?.trim()) {
        return reply.status(400).send({ error: 'name is required' });
      }

      const rawKey = 'sk-' + randomBytes(48).toString('hex');
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 8) + '...';
      const priority = parsePriority(body.priority);
      const providerIds = parseStringArray(body.provider_ids);
      const allowedModels = parseStringArray(body.allowed_models);

      await query(
        'INSERT INTO api_keys ' +
        '(key_hash, key_prefix, name, description, is_active, priority, provider_ids, allowed_models) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          keyHash,
          keyPrefix,
          body.name.trim(),
          body.description?.trim() ?? '',
          body.is_active ?? true,
          priority,
          providerIds,
          allowedModels,
        ]
      );

      return reply.status(201).send({
        key: rawKey,
        key_prefix: keyPrefix,
        name: body.name.trim(),
        description: body.description?.trim() ?? '',
        is_active: body.is_active ?? true,
        priority,
        provider_ids: providerIds,
        allowed_models: allowedModels,
      });
    } catch (error) {
      const message = String(error).replace(/^Error: /, '');
      return reply.status(isBadInput(message) ? 400 : 500).send({ error: message });
    }
  });

  // PATCH /api/admin/keys/:id
  app.patch('/api/admin/keys/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        description?: string;
        priority?: number;
        is_active?: boolean;
        provider_ids?: unknown;
        allowed_models?: unknown;
      };
      const rows = await query<{
        id: string;
        name: string;
        description: string;
        is_active: boolean;
        priority: number;
        provider_ids: string[];
        allowed_models: string[];
      }>(
        'SELECT id, name, description, is_active, priority, provider_ids, allowed_models ' +
        'FROM api_keys WHERE id = $1',
        [id],
      );
      const existing = rows[0];
      if (!existing) return reply.status(404).send({ error: 'API key not found' });

      const name = body.name === undefined ? existing.name : body.name.trim();
      if (!name) return reply.status(400).send({ error: 'name is required' });

      const priority = body.priority === undefined ? existing.priority : parsePriority(body.priority);
      const providerIds = body.provider_ids === undefined
        ? (existing.provider_ids ?? [])
        : parseStringArray(body.provider_ids);
      const allowedModels = body.allowed_models === undefined
        ? (existing.allowed_models ?? [])
        : parseStringArray(body.allowed_models);
      const isActive = body.is_active === undefined ? existing.is_active : Boolean(body.is_active);
      const description = body.description === undefined ? existing.description : body.description.trim();

      await query(
        'UPDATE api_keys SET name = $1, description = $2, is_active = $3, priority = $4, ' +
        'provider_ids = $5, allowed_models = $6, updated_at = NOW() WHERE id = $7',
        [name, description, isActive, priority, providerIds, allowedModels, id],
      );
      clearKeyCache();

      return reply.send({
        id,
        name,
        description,
        is_active: isActive,
        priority,
        provider_ids: providerIds,
        allowed_models: allowedModels,
      });
    } catch (error) {
      const message = String(error).replace(/^Error: /, '');
      return reply.status(isBadInput(message) ? 400 : 500).send({ error: message });
    }
  });

  // DELETE /api/admin/keys/:id
  app.delete('/api/admin/keys/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await query('DELETE FROM api_keys WHERE id = $1', [id]);
      clearKeyCache();
      return reply.status(204).send();
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });
}
