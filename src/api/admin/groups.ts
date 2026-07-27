import { type FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import { providerRegistry } from '../../providers/registry.js';

export async function registerAdminGroupRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/groups
  app.get('/api/admin/groups', async (_request, reply) => {
    try {
      const rows = await query<Record<string, unknown>>(
        `SELECT g.id, g.name, g.description, g.routing_strategy, g.created_at,
                COALESCE(
                  json_agg(json_build_object('provider_id', m.provider_id, 'priority', m.priority))
                  FILTER (WHERE m.provider_id IS NOT NULL),
                  '[]'::json
                ) AS members
         FROM provider_groups g
         LEFT JOIN provider_group_members m ON m.provider_group_id = g.id
         GROUP BY g.id
         ORDER BY g.created_at DESC`
      );
      return reply.send(rows);
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });

  // POST /api/admin/groups
  app.post('/api/admin/groups', async (request, reply) => {
    try {
      const { name, description, routing_strategy, provider_ids } = request.body as {
        name: string;
        description?: string;
        routing_strategy?: string;
        provider_ids?: string[];
      };

      if (!name) {
        return reply.status(400).send({ error: 'name is required' });
      }

      const rows = await query<{ id: string }>(
        'INSERT INTO provider_groups (name, description, routing_strategy) VALUES ($1, $2, $3) RETURNING id',
        [name, description ?? '', routing_strategy ?? 'fastest-first']
      );

      const groupId = rows[0]!.id;

      // Attach providers
      if (provider_ids && provider_ids.length > 0) {
        for (let i = 0; i < provider_ids.length; i++) {
          await query(
            'INSERT INTO provider_group_members (provider_group_id, provider_id, priority) VALUES ($1, $2, $3)',
            [groupId, provider_ids[i], i]
          );
        }
      }

      return reply.status(201).send({ id: groupId });
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });

  // POST /api/admin/groups/:id/keys/:keyId
  app.post('/api/admin/groups/:id/keys/:keyId', async (request, reply) => {
    try {
      const { id: groupId, keyId } = request.params as { id: string; keyId: string };
      await query(
        'INSERT INTO api_key_groups (api_key_id, provider_group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [keyId, groupId]
      );
      return reply.status(201).send({ ok: true });
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });
}