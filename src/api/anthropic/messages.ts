import { type FastifyInstance } from 'fastify';
import { authenticate } from '../../auth/api-key.js';
import { routerEngine } from '../../router/engine.js';
import { latencyTracker } from '../../router/latency-tracker.js';
import { writeRequestLog } from '../../router/request-logger.js';
import { handleStreamingProxy, handleNonStreamingProxy, type ApiFormat } from '../../streaming/stream-handler.js';
import { type ContentBlock, type ProviderAdapter } from '../../providers/interface.js';

export async function registerAnthropicRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/messages
  app.post('/v1/messages', async (request, reply) => {
    // Authenticate
    const auth = await authenticate(request, reply);
    if (!auth) return;

    const body = request.body as Record<string, unknown>;
    const model = typeof body.model === 'string' ? body.model : '';
    const stream = body.stream === true;

    // Resolve providers
    const adapters = await routerEngine.resolveProviders(auth.keyInfo.id, model);
    if (adapters.length === 0) {
      const errorMessage = `No provider available for model: ${model}`;
      void writeRequestLog({
        apiKeyId: auth.keyInfo.id,
        apiKeyPrefix: auth.keyInfo.key_prefix,
        providerId: null,
        providerName: 'router',
        model: model || '(missing)',
        latencyMs: 0,
        ttfbMs: 0,
        status: 'error',
        errorMessage,
        isStreaming: stream,
      });
      return reply.status(400).send({
        error: { type: 'invalid_request_error', message: errorMessage },
      });
    }

    // Select the fastest provider first, then fail over to the next fastest.
    let adapter = routerEngine.selectProvider(adapters);
    if (!adapter) {
      const errorMessage = 'No suitable provider available';
      void writeRequestLog({
        apiKeyId: auth.keyInfo.id,
        apiKeyPrefix: auth.keyInfo.key_prefix,
        providerId: null,
        providerName: 'router',
        model: model || '(missing)',
        latencyMs: 0,
        ttfbMs: 0,
        status: 'error',
        errorMessage,
        isStreaming: stream,
      });
      return reply.status(503).send({
        error: { type: 'service_unavailable', message: errorMessage },
      });
    }

    const failedIds = new Set<string>();
    let lastResult: { ttfbMs: number; status: 'success' | 'error' | 'timeout'; errorMessage?: string; usage?: import('../../providers/interface.js').TokenUsage } | null = null;
    let currentAdapter: ProviderAdapter | null = adapter;
    let attempt = 0;

    while (currentAdapter && attempt <= currentAdapter.config.max_retries) {
      const { body: translatedBody, headers: translatedHeaders } = currentAdapter.translateRequest({
        model,
        messages: body.messages as Array<{ role: string; content: string | ContentBlock[] }>,
        temperature: body.temperature as number | undefined,
        max_tokens: body.max_tokens as number | undefined,
        stream,
        tools: body.tools as unknown[] | undefined,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      });
      const callFormat: ApiFormat = 'anthropic';

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
          'anthropic',
          reply,
          model
        );
      }

      void writeRequestLog({
        apiKeyId: auth.keyInfo.id,
        apiKeyPrefix: auth.keyInfo.key_prefix,
        providerId: currentAdapter.config.id,
        providerName: currentAdapter.config.name,
        model: model || '(missing)',
        latencyMs: lastResult.ttfbMs,
        ttfbMs: lastResult.ttfbMs,
        status: lastResult.status,
        errorMessage: lastResult.errorMessage,
        isStreaming: stream,
        usage: lastResult.usage,
        inputCostPer1mTokens: currentAdapter.config.model_costs?.[model]?.input_cost_per_1m_tokens,
        outputCostPer1mTokens: currentAdapter.config.model_costs?.[model]?.output_cost_per_1m_tokens,
      });

      latencyTracker.record(
        currentAdapter.config.id,
        model,
        lastResult.ttfbMs,
        lastResult.ttfbMs,
        lastResult.status === 'success'
      );

      if (lastResult.status === 'success') {
        return;
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
}
