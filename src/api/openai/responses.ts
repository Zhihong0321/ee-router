import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../auth/api-key.js';
import type { NormalizedRequest, ProviderAdapter, TokenUsage } from '../../providers/interface.js';
import { latencyTracker } from '../../router/latency-tracker.js';
import { routerEngine } from '../../router/engine.js';
import { writeRequestLog } from '../../router/request-logger.js';
import { handleNonStreamingProxy, handleStreamingProxy } from '../../streaming/stream-handler.js';
import {
  ResponsesCompatibilityError,
  responsesRequestToNormalized,
} from './responses-compat.js';

type AttemptResult = {
  ttfbMs: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  usage?: TokenUsage;
};

export async function registerOpenAIResponsesRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/responses', async (request, reply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return;

    const body = request.body as Record<string, unknown>;
    let normalized: NormalizedRequest;
    try {
      normalized = responsesRequestToNormalized(body);
    } catch (error) {
      const message = error instanceof ResponsesCompatibilityError
        ? error.message
        : 'Invalid Responses API request';
      return reply.status(400).send({
        error: { type: 'invalid_request_error', message },
      });
    }

    const { model, stream } = normalized;
    const adapters = await routerEngine.resolveProviders(auth.keyInfo.id, model);
    if (adapters.length === 0) {
      const errorMessage = `No provider available for model: ${model}`;
      void writeRequestLog({
        apiKeyId: auth.keyInfo.id,
        apiKeyPrefix: auth.keyInfo.key_prefix,
        providerId: null,
        providerName: 'router',
        model,
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

    const selected = routerEngine.selectProvider(adapters);
    if (!selected) {
      const errorMessage = 'No suitable provider available';
      void writeRequestLog({
        apiKeyId: auth.keyInfo.id,
        apiKeyPrefix: auth.keyInfo.key_prefix,
        providerId: null,
        providerName: 'router',
        model,
        latencyMs: 0,
        ttfbMs: 0,
        status: 'error',
        errorMessage,
        isStreaming: stream,
      });
      return reply.status(503).send({
        error: { type: 'server_error', message: errorMessage },
      });
    }

    const failedIds = new Set<string>();
    let lastResult: AttemptResult | null = null;
    let currentAdapter: ProviderAdapter | null = selected;
    let attempt = 0;

    while (currentAdapter && attempt <= currentAdapter.config.max_retries) {
      const translated = currentAdapter.translateRequest({
        ...normalized,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      });
      lastResult = stream
        ? await handleStreamingProxy(
            currentAdapter,
            translated.body,
            translated.headers,
            'responses',
            reply,
            model,
          )
        : await handleNonStreamingProxy(
            currentAdapter,
            translated.body,
            translated.headers,
            'responses',
            reply,
            model,
          );

      void writeRequestLog({
        apiKeyId: auth.keyInfo.id,
        apiKeyPrefix: auth.keyInfo.key_prefix,
        providerId: currentAdapter.config.id,
        providerName: currentAdapter.config.name,
        model,
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
        lastResult.status === 'success',
      );

      if (lastResult.status === 'success') return;
      if (lastResult.status === 'error' && lastResult.errorMessage?.startsWith('Upstream 4')) break;

      failedIds.add(currentAdapter.config.id);
      currentAdapter = routerEngine.getNextBestProvider(adapters, failedIds);
      attempt += 1;
    }

    if (!reply.sent) {
      return reply.status(503).send({
        error: {
          type: 'server_error',
          message: lastResult?.errorMessage ?? 'All providers failed',
          attempted: Array.from(failedIds),
        },
      });
    }
  });
}
