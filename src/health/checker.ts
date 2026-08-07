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
        'SELECT id, name, key_prefix, is_active, provider_ids, allowed_models FROM api_keys WHERE key_hash = $1',
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

      // 6. If test=true, actually send a request to the upstream provider
      if (url.searchParams.get('test') === 'true' && eligibleProviders.length > 0) {
        const provider = eligibleProviders[0] as Record<string, unknown>;
        const providerId = provider.id as string;
        const adapter = providerRegistry.getAdapter(providerId);
        if (adapter && !adapter.execute) {
          const baseUrl = (provider.base_url as string).replace(/\/$/, '');
          const upstreamUrl = baseUrl + '/chat/completions';
          result.upstream_url = upstreamUrl;

          // Test 1: simple request, no tools
          try {
            const res = await fetch(upstreamUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + adapter.config.api_key,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'say hi' }],
                max_tokens: 5,
              }),
              signal: AbortSignal.timeout(15_000),
            });
            const text = await res.text();
            result.upstream_test_simple = { status: res.status, body: text.slice(0, 2000) };
          } catch (e) {
            result.upstream_test_simple = { error: String(e) };
          }

          // Test 2: request with tools (what Codex app sends)
          try {
            const res = await fetch(upstreamUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + adapter.config.api_key,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: 'You are a helpful assistant.' },
                  { role: 'user', content: 'say hi' },
                ],
                max_tokens: 5,
                tools: [{
                  type: 'function',
                  function: {
                    name: 'apply_patch',
                    description: 'Apply a patch',
                    parameters: {
                      type: 'object',
                      properties: { input: { type: 'string' } },
                      required: ['input'],
                    },
                  },
                }],
                tool_choice: 'auto',
                parallel_tool_calls: true,
                stream: false,
              }),
              signal: AbortSignal.timeout(15_000),
            });
            const text = await res.text();
            result.upstream_test_with_tools = { status: res.status, body: text.slice(0, 2000) };
          } catch (e) {
            result.upstream_test_with_tools = { error: String(e) };
          }
        }
      }

      // 7. Test through the router's own Responses API (what Codex app uses)
      if (url.searchParams.get('test') === 'true' && eligibleProviders.length > 0) {
        const keyInfo2 = keyRows[0] as Record<string, unknown>;
        const keyId = keyInfo2.id as string;
        // Reconstruct a minimal API key to call /v1/responses — we can't, so
        // instead test the raw upstream streaming path the router would use.
        const provider = eligibleProviders[0] as Record<string, unknown>;
        const providerId = provider.id as string;
        const adapter2 = providerRegistry.getAdapter(providerId);
        if (adapter2 && !adapter2.execute) {
          const baseUrl = (provider.base_url as string).replace(/\/$/, '');
          const upstreamUrl = baseUrl + '/chat/completions';

          // Test 3: streaming request with tools (exactly what Codex sends)
          try {
            const res = await fetch(upstreamUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + adapter2.config.api_key,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: 'You are a helpful assistant.' },
                  { role: 'user', content: 'say hi' },
                ],
                max_tokens: 50,
                tools: [{
                  type: 'function',
                  function: {
                    name: 'apply_patch',
                    description: 'Apply a patch',
                    parameters: {
                      type: 'object',
                      properties: { input: { type: 'string' } },
                      required: ['input'],
                    },
                  },
                }],
                tool_choice: 'auto',
                parallel_tool_calls: true,
                stream: true,
                stream_options: { include_usage: true },
              }),
              signal: AbortSignal.timeout(15_000),
            });
            const text = await res.text();
            result.upstream_test_stream = { status: res.status, body: text.slice(0, 3000) };
          } catch (e) {
            result.upstream_test_stream = { error: String(e) };
          }

          // Test 4: same test with deepseek-v4-pro for comparison
          try {
            const res = await fetch(upstreamUrl, {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + adapter2.config.api_key,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'deepseek-v4-pro',
                messages: [
                  { role: 'system', content: 'You are a helpful assistant.' },
                  { role: 'user', content: 'say hi' },
                ],
                max_tokens: 50,
                tools: [{
                  type: 'function',
                  function: {
                    name: 'apply_patch',
                    description: 'Apply a patch',
                    parameters: {
                      type: 'object',
                      properties: { input: { type: 'string' } },
                      required: ['input'],
                    },
                  },
                }],
                tool_choice: 'auto',
                parallel_tool_calls: true,
                stream: true,
                stream_options: { include_usage: true },
              }),
              signal: AbortSignal.timeout(15_000),
            });
            const text = await res.text();
            result.upstream_test_stream_pro = { status: res.status, body: text.slice(0, 3000) };
          } catch (e) {
            result.upstream_test_stream_pro = { error: String(e) };
          }
        }
      }

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
