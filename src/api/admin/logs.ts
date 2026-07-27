import { type FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';

export async function registerAdminLogRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/logs
  app.get('/api/admin/logs', async (request, reply) => {
    try {
      const { limit, offset, api_key_id, status, provider_id } = request.query as Record<string, string | undefined>;
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (api_key_id) {
        conditions.push(`api_key_id = $${paramIndex++}`);
        params.push(api_key_id);
      }
      if (status) {
        conditions.push(`status = $${paramIndex++}`);
        params.push(status);
      }
      if (provider_id) {
        conditions.push(`provider_id = $${paramIndex++}`);
        params.push(provider_id);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const rows = await query<Record<string, unknown>>(
        `SELECT id, api_key_prefix, provider_name, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, ttfb_ms, status, error_message, created_at
         FROM request_logs ${where}
         ORDER BY created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...params, parseInt(limit ?? '50'), parseInt(offset ?? '0')]
      );

      return reply.send(rows);
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });
}

export async function registerAdminStatsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/stats
  app.get('/api/admin/stats', async (_request, reply) => {
    try {
      const [totals, todayCounts, healthSummary] = await Promise.all([
        query<Record<string, unknown>>(
          `SELECT
            COUNT(*)::int AS total_requests,
            COALESCE(AVG(latency_ms), 0)::int AS avg_latency_ms,
            COALESCE(AVG(ttfb_ms), 0)::int AS avg_ttfb_ms,
            COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens
          FROM request_logs`
        ),
        query<Record<string, unknown>>(
          `SELECT
            COUNT(*)::int AS count,
            COALESCE(
              (SELECT COUNT(*)::int FROM request_logs WHERE created_at > NOW() - INTERVAL '1 day' AND status = 'success') * 100.0 /
              NULLIF(COUNT(*)::int, 0), 0
            )::int AS success_rate
          FROM request_logs
          WHERE created_at > NOW() - INTERVAL '1 day'`
        ),
        query<Record<string, unknown>>(
          `SELECT
            COUNT(*)::int AS total_providers,
            COALESCE(SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END), 0)::int AS healthy_count
          FROM (
            SELECT DISTINCT ON (provider_id) provider_id, status
            FROM health_check_logs
            ORDER BY provider_id, checked_at DESC
          ) latest`
        ),
      ]);

      return reply.send({
        total_requests: totals[0]?.total_requests ?? 0,
        avg_latency_ms: totals[0]?.avg_latency_ms ?? 0,
        avg_ttfb_ms: totals[0]?.avg_ttfb_ms ?? 0,
        total_tokens: totals[0]?.total_tokens ?? 0,
        today_count: todayCounts[0]?.count ?? 0,
        today_success_rate: todayCounts[0]?.success_rate ?? 100,
        total_providers: healthSummary[0]?.total_providers ?? 0,
        healthy_providers: healthSummary[0]?.healthy_count ?? 0,
      });
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });
}