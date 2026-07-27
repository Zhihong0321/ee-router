import { type FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { providerRegistry } from '../providers/registry.js';
import { loadEnv } from '../config/env.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // GET /health — Railway health check endpoint
  app.get('/health', async (_request, reply) => {
    const env = loadEnv();
    const dbOk = env.DATABASE_URL ? await checkDbHealth() : true;
    return reply.status(dbOk ? 200 : 503).send({
      status: dbOk ? 'ok' : 'degraded',
      database: dbOk ? 'connected' : 'disconnected',
      providers: providerRegistry.getAllAdapters().length,
      timestamp: new Date().toISOString(),
    });
  });
}

async function checkDbHealth(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}