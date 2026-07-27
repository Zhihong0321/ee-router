import { type ProviderAdapter } from '../providers/interface.js';
import { type FastifyReply } from 'fastify';

export type ApiFormat = 'openai' | 'anthropic';

/**
 * Proxy a streaming request to the upstream provider, translating SSE chunks
 * to the caller's expected format.
 */
export async function handleStreamingProxy(
  adapter: ProviderAdapter,
  requestBody: unknown,
  requestHeaders: Record<string, string>,
  callFormat: ApiFormat,
  reply: FastifyReply
): Promise<{ ttfbMs: number; status: 'success' | 'error' | 'timeout'; errorMessage?: string }> {
  const baseUrl = adapter.config.base_url.replace(/\/$/, '');
  const endpoint = adapter.config.provider_type === 'anthropic' ? '/messages' : '/chat/completions';
  const url = `${baseUrl}${endpoint}`;

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
        errorMessage: `Upstream ${response.status}: ${errorBody}`,
      };
    }

    // Non-streaming — return as JSON
    if (!response.body) {
      const data = await response.json() as Record<string, unknown>;
      await reply.headers({ 'Content-Type': 'application/json' }).send(data);
      return { ttfbMs, status: 'success' };
    }

    // Streaming — pipe through SSE
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

        // Process complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (callFormat === 'anthropic' && adapter.config.provider_type === 'openai-compatible') {
            // Upstream is OpenAI, caller is Anthropic — translate
            const translated = await translateStreamToAnthropic(line, adapter, reply);
            if (translated) {
              reply.raw.write(translated);
            }
          } else if (callFormat === 'openai' && adapter.config.provider_type === 'anthropic') {
            // Upstream is Anthropic, caller is OpenAI — translate
            const translated = await translateStreamToOpenAI(line, adapter, reply);
            if (translated) {
              reply.raw.write(translated);
            }
          } else {
            // Same format — pass through
            reply.raw.write(line + '\n');
          }
        }
      }
    } catch (streamError) {
      reply.raw.write(`${callFormat === 'openai' ? 'data: [DONE]\n' : 'event: error\ndata: {}\n'}\n`);
      return { ttfbMs, status: 'error', errorMessage: String(streamError) };
    }

    // Write end marker
    if (callFormat === 'openai') {
      reply.raw.write('data: [DONE]\n\n');
    }
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

/**
 * Proxy a non-streaming request.
 */
export async function handleNonStreamingProxy(
  adapter: ProviderAdapter,
  requestBody: unknown,
  requestHeaders: Record<string, string>,
  reply: FastifyReply
): Promise<{ ttfbMs: number; status: 'success' | 'error' | 'timeout'; errorMessage?: string }> {
  const baseUrl = adapter.config.base_url.replace(/\/$/, '');
  const endpoint = adapter.config.provider_type === 'anthropic' ? '/messages' : '/chat/completions';
  const url = `${baseUrl}${endpoint}`;

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
        errorMessage: `Upstream ${response.status}: ${errorBody}`,
      };
    }

    const data = await response.json() as Record<string, unknown>;
    await reply.send(data);
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

// Placeholder translators — more sophisticated translation will be added in Stage 2
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
    return `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(content)}}}\n\n`;
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
          return `data: {"choices":[{"index":0,"delta":{"content":${JSON.stringify(text)}},"finish_reason":null}]}\n\n`;
        }
      }
      if (type === 'message_stop') {
        return null;
      }
      if (parsed.type === 'message_delta') {
        const stopReason = parsed.delta?.stop_reason;
        if (stopReason) {
          const mappedReason = stopReason === 'end_turn' ? 'stop' : stopReason;
          return `data: {"choices":[{"index":0,"delta":{},"finish_reason":"${mappedReason}"}]}\n\n`;
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}