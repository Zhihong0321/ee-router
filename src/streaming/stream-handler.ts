import { type ProviderAdapter } from '../providers/interface.js';
import { type FastifyReply } from 'fastify';

export type ApiFormat = 'openai' | 'anthropic';

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
): Promise<{ ttfbMs: number; status: 'success' | 'error' | 'timeout'; errorMessage?: string }> {
  const requestedModel = model ?? adapter.config.models[0] ?? '';
  const url = upstreamUrl(adapter, requestedModel, true);
  const start = Date.now();

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
      await reply.headers({ 'Content-Type': 'application/json' }).send(
        adapter.config.provider_type === 'gemini' ? geminiResponse(data, adapter, requestedModel, callFormat) : data,
      );
      return { ttfbMs, status: 'success' };
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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (adapter.config.provider_type === 'gemini') {
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
      reply.raw.write(callFormat === 'openai' ? 'data: [DONE]\n\n' : 'event: error\ndata: {}\n\n');
      return { ttfbMs, status: 'error', errorMessage: String(streamError) };
    }

    if (callFormat === 'openai') reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
    return { ttfbMs, status: 'success' };
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
): Promise<{ ttfbMs: number; status: 'success' | 'error' | 'timeout'; errorMessage?: string }> {
  const requestedModel = model ?? adapter.config.models[0] ?? '';
  const url = upstreamUrl(adapter, requestedModel, false);
  const start = Date.now();

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
    await reply.send(
      adapter.config.provider_type === 'gemini' ? geminiResponse(data, adapter, requestedModel, callFormat) : data,
    );
    return { ttfbMs, status: 'success' };
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
