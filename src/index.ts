import cors, { type FastifyCorsOptions } from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { loadEnv } from './config/env.js';
import { pool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { providerRegistry } from './providers/registry.js';
import { latencyTracker } from './router/latency-tracker.js';
import { registerHealthRoutes } from './health/checker.js';
import { registerOpenAIRoutes } from './api/openai/chat.js';
import { registerAnthropicRoutes } from './api/anthropic/messages.js';
import { registerAdminKeyRoutes } from './api/admin/keys.js';
import { registerAdminProviderRoutes } from './api/admin/providers.js';
import { registerAdminGroupRoutes } from './api/admin/groups.js';
import { registerAdminLogRoutes, registerAdminStatsRoutes } from './api/admin/logs.js';
import { query } from './db/pool.js';
import { authenticateAdmin } from './auth/admin.js';

async function main(): Promise<void> {
  const env = loadEnv();

  // Run database migrations
  console.log('[bootstrap] Running database migrations...');
  await migrate();
  console.log('[bootstrap] Migrations complete.');

  // Load providers from DB into in-memory registry
  if (pool) {
    try {
      const rows = await query<Record<string, unknown>>(
        'SELECT id, name, provider_type, base_url, api_key_enc, api_key_iv, models, timeout_ms, max_retries, extra_headers FROM providers WHERE is_active = true'
      );
      if (rows.length > 0) {
        providerRegistry.loadFromDb(rows);
        console.log(`[bootstrap] Loaded ${rows.length} provider(s) into registry.`);
      } else {
        console.log('[bootstrap] No active providers found in DB.');
      }
    } catch (err) {
      console.warn('[bootstrap] Failed to load providers from DB:', err);
    }

    // Load latency history from DB
    try {
      await latencyTracker.loadFromDb();
      console.log('[bootstrap] Latency history loaded.');
    } catch (err) {
      console.warn('[bootstrap] Failed to load latency history:', err);
    }
  }

  // Start latency tracker periodic flush
  latencyTracker.start();
  console.log('[bootstrap] Latency tracker started.');

  // Create Fastify instance
  const app = Fastify({
    trustProxy: env.NODE_ENV === 'production',
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'production'
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
            },
          }),
    },
  });

  // Register public API middleware.
  const allowedOrigins = env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean);
  await app.register(cors, {
    origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  } satisfies FastifyCorsOptions);
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    allowList: request => request.url === '/health',
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/admin/')) {
      await authenticateAdmin(request, reply);
    }
  });

  // Register routes
  await registerHealthRoutes(app);
  await registerOpenAIRoutes(app);
  await registerAnthropicRoutes(app);
  await registerAdminKeyRoutes(app);
  await registerAdminProviderRoutes(app);
  await registerAdminGroupRoutes(app);
  await registerAdminLogRoutes(app);
  await registerAdminStatsRoutes(app);

  // Start server
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`[bootstrap] Server listening on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] Received ${signal}, shutting down gracefully...`);
    latencyTracker.stop();
    try {
      await app.close();
      if (pool) await pool.end();
    } catch (error) {
      app.log.error(error, 'Graceful shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[fatal] Failed to start server:', err);
  process.exit(1);
});