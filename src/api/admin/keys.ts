import { type FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import { lookupApiKey, clearKeyCache } from '../../auth/api-key.js';
import { createHash, randomBytes } from 'node:crypto';

export async function registerAdminKeyRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/keys
  app.get('/api/admin/keys', async (_request, reply) => {
    try {
      const rows = await query<Record<string, unknown>>(
        'SELECT id, key_prefix, name, description, is_active, rate_limit, allowed_ips, created_at FROM api_keys ORDER BY created_at DESC'
      );
      return reply.send(rows);
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });

  // POST /api/admin/keys
  app.post('/api/admin/keys', async (request, reply) => {
    try {
      const { name, description } = request.body as { name: string; description?: string };
      if (!name) {
        return reply.status(400).send({ error: 'name is required' });
      }

      // Generate a new API key
      const rawKey = `sk-${randomBytes(48).toString('hex')}`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(0, 8) + '...';

      await query(
        'INSERT INTO api_keys (key_hash, key_prefix, name, description) VALUES ($1, $2, $3, $4)',
        [keyHash, keyPrefix, name, description ?? '']
      );

      // Return the raw key only once
      return reply.status(201).send({
        key: rawKey,
        key_prefix: keyPrefix,
        name,
        description: description ?? '',
      });
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
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