import { type FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { providerRegistry } from '../providers/registry.js';
import { loadEnv } from '../config/env.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // GET /health — Railway health check endpoint
  app.get('/health', async (_request, reply) => {
    const env = loadEnv();
    const dbConfigured = Boolean(env.DATABASE_URL);
    const dbOk = dbConfigured ? await checkDbHealth() : true;
    return reply.status(dbOk ? 200 : 503).send({
      status: dbOk ? 'ok' : 'degraded',
      database: !dbConfigured ? 'not_configured' : dbOk ? 'connected' : 'disconnected',
      providers: providerRegistry.getAllAdapters().length,
      timestamp: new Date().toISOString(),
    });
  });

  // GET /health/debug-model?model=X&key=Y — diagnose why a model fails for a given API key
  app.get('/health/debug-model', async (request, reply) => {
    const url = new URL(request.url, 'http://localhost');
    const model = url.searchParams.get('model') ?? '';
    const keyHash = url.searchParams.get('hash') ?? '';

    if (!model || !keyHash) {
      return reply.status(400).send({ error: 'model and hash params required' });
    }

    const result: Record<string, unknown> = { model, key_hash_prefix: keyHash.slice(0, 12) + '...' };

    // 1. Look up the API key
    try {
      const keyRows = await query<Record<string, unknown>>(
        'SELECT id, name, key_prefix, is_active, provider_ids, allowed_models, backup_provider_id FROM api_keys WHERE key_hash = $1',
        [keyHash]
      );
      const keyInfo = keyRows[0];
      if (!keyInfo) {
        result.error = 'API key not found in database';
        return reply.send(result);
      }
      result.api_key = keyInfo;

      // 2. Check allowed_models
      const allowedModels = keyInfo.allowed_models as string[] ?? [];
      result.allowed_models = allowedModels;
      result.model_in_allowed_models = allowedModels.length === 0 || allowedModels.includes('*') || allowedModels.includes(model);

      // 3. Find providers for this key
      const providerIds = keyInfo.provider_ids as string[] ?? [];
      result.provider_ids = providerIds;

      if (providerIds.length > 0) {
        const providers = await query<Record<string, unknown>>(
          'SELECT id, name, provider_type, base_url, is_active, models FROM providers WHERE id = ANY($1)',
          [providerIds]
        );
        result.providers = providers.map(p => ({
          id: p.id,
          name: p.name,
          provider_type: p.provider_type,
          base_url: p.base_url,
          is_active: p.is_active,
          models: p.models,
          has_model: (p.models as string[] ?? []).includes('*') || (p.models as string[] ?? []).includes(model),
        }));
      } else {
        // Legacy group-based lookup
        const groupRows = await query<{ provider_group_id: string }>(
          `SELECT pgm.provider_group_id FROM api_key_groups akg
           JOIN provider_group_members pgm ON pgm.provider_group_id = akg.provider_group_id
           WHERE akg.api_key_id = $1`, [keyInfo.id]
        );
        const groupIds = [...new Set(groupRows.map(r => r.provider_group_id))];
        if (groupIds.length === 0) {
          result.providers = [];
          result.error = 'No provider groups assigned to this key';
        } else {
          const memberRows = await query<{ provider_id: string }>(
            'SELECT DISTINCT provider_id FROM provider_group_members WHERE provider_group_id = ANY($1)',
            [groupIds]
          );
          const pIds = memberRows.map(r => r.provider_id);
          const providers = await query<Record<string, unknown>>(
            'SELECT id, name, provider_type, base_url, is_active, models FROM providers WHERE id = ANY($1)',
            [pIds]
          );
          result.providers = providers.map(p => ({
            id: p.id,
            name: p.name,
            provider_type: p.provider_type,
            base_url: p.base_url,
            is_active: p.is_active,
            models: p.models,
            has_model: (p.models as string[] ?? []).includes('*') || (p.models as string[] ?? []).includes(model),
          }));
        }
      }

      // 4. Check which adapters are loaded in the registry
      result.registry_adapters = providerRegistry.getAllAdapters().map(a => ({
        id: a.config.id,
        name: a.config.name,
        provider_type: a.config.provider_type,
        is_active: a.config.is_active !== false,
        models: a.config.models,
        has_model: a.config.models.includes('*') || a.config.models.includes(model),
      }));

      // 5. Diagnosis
      const eligibleProviders = (result.providers as Array<Record<string, unknown>>)
        ?.filter(p => p.is_active !== false && p.has_model === true) ?? [];
      result.eligible_provider_count = eligibleProviders.length;
      result.diagnosis = eligibleProviders.length === 0
        ? 'No active provider has this model in its models list'
        : 'Model is available — issue may be upstream';

    } catch (err) {
      result.db_error = String(err);
    }

    return reply.send(result);
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
