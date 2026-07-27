import { type FastifyInstance } from 'fastify';
import { authenticate } from '../../auth/api-key.js';
import { routerEngine } from '../../router/engine.js';
import { latencyTracker } from '../../router/latency-tracker.js';
import { handleStreamingProxy, handleNonStreamingProxy, type ApiFormat } from '../../streaming/stream-handler.js';
import { type ProviderAdapter } from '../../providers/interface.js';

export async function registerOpenAIRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/chat/completions
  app.post('/v1/chat/completions', async (request, reply) => {
    // Authenticate
    const auth = await authenticate(request, reply);
    if (!auth) return;

    const body = request.body as Record<string, unknown>;
    const model = body.model as string;
    const stream = body.stream === true;

    // Resolve providers
    const adapters = await routerEngine.resolveProviders(auth.keyInfo.id, model);
    if (adapters.length === 0) {
      return reply.status(400).send({
        error: { type: 'invalid_request_error', message: `No provider available for model: ${model}` },
      });
    }

    // Select best provider
    let adapter = routerEngine.selectProvider(adapters);
    if (!adapter) {
      return reply.status(503).send({
        error: { type: 'service_unavailable', message: 'No suitable provider available' },
      });
    }

    // Try providers with failover. Translate for each provider because
    // Anthropic and OpenAI-compatible adapters use different wire formats.
    const failedIds = new Set<string>();
    let lastResult: { ttfbMs: number; status: 'success' | 'error' | 'timeout'; errorMessage?: string } | null = null;
    let currentAdapter: ProviderAdapter | null = adapter;
    let attempt = 0;

    while (currentAdapter && attempt <= currentAdapter.config.max_retries) {
      const { body: translatedBody, headers: translatedHeaders } = currentAdapter.translateRequest({
        model,
        messages: body.messages as Array<{ role: string; content: string | import('../../providers/interface.js').ContentBlock[] }>,
        temperature: body.temperature as number | undefined,
        max_tokens: body.max_tokens as number | undefined,
        stream,
        tools: body.tools as unknown[] | undefined,
      });
      const callFormat: ApiFormat = 'openai';

      if (stream) {
        lastResult = await handleStreamingProxy(
          currentAdapter,
          translatedBody,
          translatedHeaders,
          callFormat,
          reply,
          model
        );
      } else {
        lastResult = await handleNonStreamingProxy(
          currentAdapter,
          translatedBody,
          translatedHeaders,
          'openai',
          reply,
          model
        );
      }

      latencyTracker.record(
        currentAdapter.config.id,
        model,
        lastResult.ttfbMs,
        lastResult.ttfbMs,
        lastResult.status === 'success'
      );

      if (lastResult.status === 'success') {
        return; // Done
      }

      // Do not retry client errors; otherwise select the next provider.
      if (lastResult.status === 'error' && lastResult.errorMessage?.startsWith('Upstream 4')) {
        break;
      }

      failedIds.add(currentAdapter.config.id);
      currentAdapter = routerEngine.getNextBestProvider(adapters, failedIds);
      attempt++;
    }

    // All providers exhausted
    if (!reply.sent) {
      return reply.status(503).send({
        error: {
          type: 'service_unavailable',
          message: lastResult?.errorMessage ?? 'All providers failed',
          attempted: Array.from(failedIds),
        },
      });
    }
  });

  // GET /v1/models
  app.get('/v1/models', async (request, reply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return;

    const adapters = await routerEngine.resolveProviders(auth.keyInfo.id, '*');
    const allModels = new Set<string>();
    for (const adapter of adapters) {
      for (const model of adapter.config.models) {
        allModels.add(model);
      }
    }

    return reply.send({
      object: 'list',
      data: Array.from(allModels).map(id => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'eter-router',
      })),
    });
  });
}