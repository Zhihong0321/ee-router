import { type NormalizedResponse, type ProviderAdapter, type TokenUsage } from '../providers/interface.js';
import { type FastifyReply } from 'fastify';
import { normalizedResponseToResponses, ResponsesStreamTranslator } from '../api/openai/responses-compat.js';

export type ApiFormat = 'openai' | 'anthropic' | 'responses';

type ProxyResult = {
  ttfbMs: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  usage?: TokenUsage;
};

function normalizedResponsePayload(
  normalized: NormalizedResponse,
  model: string,
  format: ApiFormat,
  requestKey?: object,
): Record<string, unknown> {
  const choice = normalized.choices[0] ?? {
    index: 0,
    message: { role: 'assistant', content: '' },
    finish_reason: null,
  };

  if (format === 'responses') return normalizedResponseToResponses(normalized, model, requestKey);

  if (format === 'anthropic') {
    return {
      id: normalized.id,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: choice.message.content ?? '' }],
      stop_reason: choice.finish_reason,
      stop_sequence: null,
      usage: normalized.usage ? {
        input_tokens: normalized.usage.prompt_tokens,
        output_tokens: normalized.usage.completion_tokens,
      } : undefined,
    };
  }

  return {
    id: normalized.id,
    object: 'chat.completion',
    created: normalized.created,
    model,
    choices: [{
      index: choice.index,
      message: choice.message,
      finish_reason: choice.finish_reason,
    }],
    usage: normalized.usage,
  };
}

function localExecutionError(error: unknown, startedAt: number): ProxyResult {
  const code = (error as { code?: string }).code;
  const statusCode = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  return {
    ttfbMs: Date.now() - startedAt,
    status: code === 'upstream_timeout' ? 'timeout' : 'error',
    errorMessage: statusCode && statusCode >= 400 && statusCode < 500
      ? `Upstream ${statusCode}: ${message}`
      : message,
  };
}

async function handleLocalStreaming(
  adapter: ProviderAdapter,
  requestBody: unknown,
  callFormat: ApiFormat,
  reply: FastifyReply,
  model: string,
  startedAt: number,
): Promise<ProxyResult> {
  try {
    const normalized = await adapter.execute!(requestBody);
    const choice = normalized.choices[0];
    const content = choice?.message.content ?? '';
    const finishReason = choice?.finish_reason ?? 'stop';
    const ttfbMs = Date.now() - startedAt;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    if (callFormat === 'responses') {
      const translator = new ResponsesStreamTranslator(model, reply);
      reply.raw.write(translator.start());
      reply.raw.write(translator.consume({
        id: normalized.id,
        model,
        created: normalized.created,
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: content || undefined,
            tool_calls: choice?.message.tool_calls,
          },
          finish_reason: finishReason,
        }],
        usage: normalized.usage,
      }));
      reply.raw.write(translator.finish(normalized.usage));
    } else if (callFormat === 'anthropic') {
      reply.raw.write('event: message_start\ndata: ' + JSON.stringify({
        type: 'message_start',
        message: {
          id: normalized.id,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: normalized.usage?.prompt_tokens ?? 0, output_tokens: 0 },
        },
      }) + '\n\n');
      reply.raw.write('event: content_block_start\ndata: ' + JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }) + '\n\n');
      if (content) {
        reply.raw.write('event: content_block_delta\ndata: ' + JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: content },
        }) + '\n\n');
      }
      reply.raw.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
      reply.raw.write('event: message_delta\ndata: ' + JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: finishReason, stop_sequence: null },
        usage: { output_tokens: normalized.usage?.completion_tokens ?? 0 },
      }) + '\n\n');
      reply.raw.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    } else {
      reply.raw.write('data: ' + JSON.stringify({
        id: normalized.id,
        object: 'chat.completion.chunk',
        created: normalized.created,
        model,
        choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
      }) + '\n\n');
      reply.raw.write('data: ' + JSON.stringify({
        id: normalized.id,
        object: 'chat.completion.chunk',
        created: normalized.created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      }) + '\n\n');
      reply.raw.write('data: [DONE]\n\n');
    }

    reply.raw.end();
    return { ttfbMs, status: 'success', usage: normalized.usage };
  } catch (error) {
    return localExecutionError(error, startedAt);
  }
}

function upstreamUrl(adapter: ProviderAdapter, model: string, stream: boolean): string {
  const baseUrl = adapter.config.base_url.replace(/\/$/, '');
  if (adapter.config.provider_type === 'gemini') {
    const cleanModel = model.replace(/^models\//, '');
    const action = stream ? ':streamGenerateContent' : ':generateContent';
    const url = new URL(baseUrl + '/models/' + encodeURIComponent(cleanModel) + action);
    if (stream) url.searchParams.set('alt', 'sse');
    url.searchParams.set('key', adapter.config.api_key);
    return url.toString();
  }

  const endpoint = adapter.config.provider_type === 'anthropic' ? '/messages' : '/chat/completions';
  return baseUrl + endpoint;
}

function mergeTokenUsage(current: TokenUsage | undefined, next: Partial<TokenUsage> | undefined): TokenUsage | undefined {
  if (!next) return current;
  const promptTokens = Math.max(current?.prompt_tokens ?? 0, Number(next.prompt_tokens ?? 0));
  const completionTokens = Math.max(current?.completion_tokens ?? 0, Number(next.completion_tokens ?? 0));
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: Math.max(Number(next.total_tokens ?? 0), promptTokens + completionTokens),
  };
}

function usageFromStreamLine(line: string): Partial<TokenUsage> | undefined {
  if (!line.startsWith('data: ') || line === 'data: [DONE]') return undefined;
  try {
    const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
    const usage = (data.usage ?? (data.message as Record<string, unknown> | undefined)?.usage) as Record<string, unknown> | undefined;
    const metadata = data.usageMetadata as Record<string, unknown> | undefined;
    if (metadata) {
      return {
        prompt_tokens: Number(metadata.promptTokenCount ?? 0),
        completion_tokens: Number(metadata.candidatesTokenCount ?? 0),
        total_tokens: Number(metadata.totalTokenCount ?? 0),
      };
    }
    if (!usage) return undefined;
    const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
    const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: Number(usage.total_tokens ?? (promptTokens + completionTokens)),
    };
  } catch {
    return undefined;
  }
}

function geminiResponse(raw: unknown, adapter: ProviderAdapter, model: string, format: ApiFormat): Record<string, unknown> {
  const normalized = adapter.translateResponse(raw);
  const choice = normalized.choices[0] ?? {
    index: 0,
    message: { role: 'assistant', content: '' },
    finish_reason: null,
  };
  const content = choice.message.content ?? '';

  if (format === 'anthropic') {
    return {
      id: normalized.id,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: content }],
      stop_reason: choice.finish_reason,
      stop_sequence: null,
      usage: normalized.usage ? {
        input_tokens: normalized.usage.prompt_tokens,
        output_tokens: normalized.usage.completion_tokens,
      } : undefined,
    };
  }

  return {
    id: normalized.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: choice.index,
      message: choice.message,
      finish_reason: choice.finish_reason,
    }],
    usage: normalized.usage,
  };
}

export async function handleStreamingProxy(
  adapter: ProviderAdapter,
  requestBody: unknown,
  requestHeaders: Record<string, string>,
  callFormat: ApiFormat,
  reply: FastifyReply,
  model?: string,
): Promise<ProxyResult> {
  const requestedModel = model ?? adapter.config.models[0] ?? '';
  const start = Date.now();

  if (adapter.execute) {
    return handleLocalStreaming(adapter, requestBody, callFormat, reply, requestedModel, start);
  }

  const url = upstreamUrl(adapter, requestedModel, true);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(adapter.config.timeout_ms),
    });

    const ttfbMs = Date.now() - start;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ttfbMs,
        status: 'error',
        errorMessage: 'Upstream ' + response.status + ': ' + errorBody,
      };
    }

    if (!response.body) {
      const data = await response.json() as Record<string, unknown>;
      const normalized = adapter.translateResponse(data);
      await reply.headers({ 'Content-Type': 'application/json' }).send(
        callFormat === 'responses'
          ? normalizedResponseToResponses(normalized, requestedModel, reply)
          : adapter.config.provider_type === 'gemini'
            ? geminiResponse(data, adapter, requestedModel, callFormat)
            : data,
      );
      return { ttfbMs, status: 'success', usage: normalized.usage };
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: TokenUsage | undefined;
    const responsesTranslator = callFormat === 'responses'
      ? new ResponsesStreamTranslator(requestedModel, reply)
      : null;
    if (responsesTranslator) reply.raw.write(responsesTranslator.start());

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          usage = mergeTokenUsage(usage, usageFromStreamLine(line));
          if (responsesTranslator) {
            const chunks = adapter.translateStreamChunk(Buffer.from(line + '\n'));
            for (const chunk of chunks) reply.raw.write(responsesTranslator.consume(chunk));
          } else if (adapter.config.provider_type === 'gemini') {
            const translated = translateGeminiStreamLine(line, callFormat, requestedModel, adapter);
            if (translated) reply.raw.write(translated);
          } else if (callFormat === 'anthropic' && adapter.config.provider_type === 'openai-compatible') {
            const translated = await translateStreamToAnthropic(line, adapter, reply);
            if (translated) reply.raw.write(translated);
          } else if (callFormat === 'openai' && adapter.config.provider_type === 'anthropic') {
            const translated = await translateStreamToOpenAI(line, adapter, reply);
            if (translated) reply.raw.write(translated);
          } else {
            reply.raw.write(line + '\n');
          }
        }
      }
    } catch (streamError) {
      reply.raw.write(callFormat === 'openai'
        ? 'data: [DONE]\n\n'
        : 'event: error\ndata: ' + JSON.stringify({ type: 'error', message: String(streamError) }) + '\n\n');
      return { ttfbMs, status: 'error', errorMessage: String(streamError), usage };
    }

    usage = mergeTokenUsage(usage, usageFromStreamLine(buffer));
    if (responsesTranslator) reply.raw.write(responsesTranslator.finish(usage));
    else if (callFormat === 'openai') reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
    return { ttfbMs, status: 'success', usage };
  } catch (error) {
    const elapsed = Date.now() - start;
    const isTimeout = error instanceof DOMException && error.name === 'AbortError';
    return {
      ttfbMs: elapsed,
      status: isTimeout ? 'timeout' : 'error',
      errorMessage: String(error),
    };
  }
}

export async function handleNonStreamingProxy(
  adapter: ProviderAdapter,
  requestBody: unknown,
  requestHeaders: Record<string, string>,
  callFormat: ApiFormat,
  reply: FastifyReply,
  model?: string,
): Promise<ProxyResult> {
  const requestedModel = model ?? adapter.config.models[0] ?? '';
  const start = Date.now();

  if (adapter.execute) {
    try {
      const normalized = await adapter.execute(requestBody);
      const ttfbMs = Date.now() - start;
      await reply.send(normalizedResponsePayload(normalized, requestedModel, callFormat, reply));
      return { ttfbMs, status: 'success', usage: normalized.usage };
    } catch (error) {
      return localExecutionError(error, start);
    }
  }

  const url = upstreamUrl(adapter, requestedModel, false);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(adapter.config.timeout_ms),
    });

    const ttfbMs = Date.now() - start;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ttfbMs,
        status: 'error',
        errorMessage: 'Upstream ' + response.status + ': ' + errorBody,
      };
    }

    const data = await response.json() as Record<string, unknown>;
    const normalized = adapter.translateResponse(data);
    await reply.send(
      callFormat === 'responses'
        ? normalizedResponseToResponses(normalized, requestedModel, reply)
        : adapter.config.provider_type === 'gemini'
          ? geminiResponse(data, adapter, requestedModel, callFormat)
          : data,
    );
    return { ttfbMs, status: 'success', usage: normalized.usage };
  } catch (error) {
    const elapsed = Date.now() - start;
    const isTimeout = error instanceof DOMException && error.name === 'AbortError';
    return {
      ttfbMs: elapsed,
      status: isTimeout ? 'timeout' : 'error',
      errorMessage: String(error),
    };
  }
}

function translateGeminiStreamLine(
  line: string,
  format: ApiFormat,
  model: string,
  adapter: ProviderAdapter,
): string | null {
  if (!line.startsWith('data: ')) return null;

  try {
    const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
    const chunks = adapter.translateStreamChunk(Buffer.from(line + '\n'));
    const chunk = chunks[0];
    const choice = chunk?.choices[0];
    if (!choice) return null;
    const text = choice.delta.content ?? '';
    const finishReason = choice.finish_reason;

    if (format === 'anthropic') {
      if (text) {
        return 'event: content_block_delta\ndata: ' + JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        }) + '\n\n';
      }
      if (finishReason) {
        return 'event: message_delta\ndata: ' + JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: finishReason },
          usage: {},
        }) + '\n\n';
      }
      return null;
    }

    return 'data: ' + JSON.stringify({
      id: 'gemini-' + Date.now(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: choice.index,
        delta: text ? { content: text } : {},
        finish_reason: finishReason,
      }],
    }) + '\n\n';
  } catch {
    return null;
  }
}

async function translateStreamToAnthropic(
  line: string,
  _adapter: ProviderAdapter,
  _reply: FastifyReply
): Promise<string | null> {
  if (!line.startsWith('data: ') || line === 'data: [DONE]') return null;
  try {
    const parsed = JSON.parse(line.slice(6));
    const content = parsed?.choices?.[0]?.delta?.content;
    if (!content) return null;
    return 'event: content_block_delta\ndata: ' + JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: content },
    }) + '\n\n';
  } catch {
    return null;
  }
}

async function translateStreamToOpenAI(
  line: string,
  _adapter: ProviderAdapter,
  _reply: FastifyReply
): Promise<string | null> {
  if (line.startsWith('event: ')) return null;
  if (line.startsWith('data: ')) {
    try {
      const parsed = JSON.parse(line.slice(6));
      const type = parsed.type;
      if (type === 'content_block_delta') {
        const text = parsed.delta?.text;
        if (text) {
          return 'data: ' + JSON.stringify({
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          }) + '\n\n';
        }
      }
      if (parsed.type === 'message_delta') {
        const stopReason = parsed.delta?.stop_reason;
        if (stopReason) {
          return 'data: ' + JSON.stringify({
            choices: [{ index: 0, delta: {}, finish_reason: stopReason === 'end_turn' ? 'stop' : stopReason }],
          }) + '\n\n';
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}
