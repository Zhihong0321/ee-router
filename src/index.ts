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
import { registerAdminAgyRoutes } from './api/admin/agy.js';
import { query } from './db/pool.js';
import { authenticateAdmin } from './auth/admin.js';
import { denyUnauthenticated, hasValidSession } from './auth/session.js';
import { registerLoginRoutes } from './web/login-ui.js';
import { registerAdminUiRoutes } from './web/admin-ui.js';
import { registerAdminKeyUiRoutes } from './web/api-keys-ui.js';
import { registerAdminLogsUiRoutes } from './web/logs-ui.js';

async function main(): Promise<void> {
  const env = loadEnv();

  // Fail closed: the service refuses to expose anything without an access password.
  if (!env.ADMIN_PASSWORD) {
    console.error(
      '[fatal] ADMIN_PASSWORD is not set. Set it (minimum 8 characters) to protect this service before starting.'
    );
    process.exit(1);
  }

  // Run database migrations
  console.log('[bootstrap] Running database migrations...');
  await migrate();
  console.log('[bootstrap] Migrations complete.');

  // Load providers from DB into in-memory registry
  if (pool) {
    try {
      const rows = await query<Record<string, unknown>>(
        'SELECT id, name, provider_type, base_url, api_key_enc, api_key_iv, models, api_key_expires_at, timeout_ms, max_retries, extra_headers FROM providers WHERE is_active = true'
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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  } satisfies FastifyCorsOptions);
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    allowList: request => request.url === '/health',
  });
  // Password gate: one login unlocks the whole site for SESSION_TTL_HOURS.
  const openPaths = new Set(['/health', '/login', '/logout']);
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;

    const path = request.url.split('?')[0] ?? '/';
    if (openPaths.has(path)) return;

    // A valid password session unlocks everything, including /api/admin/*.
    if (hasValidSession(request)) return;

    // Machine traffic keeps using its own credentials: /v1/* is validated by the
    // per-client API key, /api/admin/* by ADMIN_API_KEY when one is configured.
    if (path.startsWith('/v1/')) {
      if (request.headers.authorization) return;
      await reply
        .status(401)
        .send({ error: { type: 'authentication_error', message: 'Missing or invalid Authorization header' } });
      return;
    }

    if (path.startsWith('/api/admin/')) {
      if (env.ADMIN_API_KEY) {
        await authenticateAdmin(request, reply);
        return;
      }
      await denyUnauthenticated(request, reply);
      return;
    }

    await denyUnauthenticated(request, reply);
  });

  // Register routes
  await registerLoginRoutes(app);
  await registerHealthRoutes(app);
  await registerOpenAIRoutes(app);
  await registerAnthropicRoutes(app);
  await registerAdminKeyRoutes(app);
  await registerAdminProviderRoutes(app);
  await registerAdminGroupRoutes(app);
  await registerAdminLogRoutes(app);
  await registerAdminStatsRoutes(app);
  await registerAdminAgyRoutes(app);
  await registerAdminUiRoutes(app);
  await registerAdminKeyUiRoutes(app);
  await registerAdminLogsUiRoutes(app);

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