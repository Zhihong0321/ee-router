import { type ProviderAdapter, type ProviderConfig, type NormalizedRequest, type NormalizedResponse, type NormalizedChunk } from './interface.js';

export class AnthropicAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  translateRequest(req: NormalizedRequest): { body: unknown; headers: Record<string, string> } {
    const messages = req.messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : m.content,
    }));

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: req.stream,
    };
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools !== undefined) body.tools = req.tools;

    return {
      body,
      headers: {
        'x-api-key': this.config.api_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    };
  }

  translateStreamChunk(raw: Buffer): NormalizedChunk[] {
    const text = raw.toString('utf8');
    const chunks: NormalizedChunk[] = [];

    // Anthropic SSE format: event: ...\ndata: {...}\n\n
    const lines = text.split('\n');
    let currentEvent = '';
    let currentData = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6).trim();
      }

      if (currentEvent && currentData) {
        try {
          const parsed = JSON.parse(currentData);
          const chunk = this._parseAnthropicEvent(currentEvent, parsed);
          if (chunk) chunks.push(chunk);
        } catch {
          // skip malformed chunks
        }
        currentEvent = '';
        currentData = '';
      }
    }

    return chunks;
  }

  private _parseAnthropicEvent(event: string, data: Record<string, unknown>): NormalizedChunk | null {
    switch (event) {
      case 'message_start': {
        const msg = data.message as Record<string, unknown> ?? {};
        return {
          id: msg.id as string ?? '',
          model: msg.model as string ?? '',
          created: Date.now(),
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null,
          }],
          usage: msg.usage as { prompt_tokens: number; completion_tokens: number } | undefined,
        };
      }
      case 'content_block_delta': {
        const delta = data.delta as Record<string, unknown> ?? {};
        if (delta.type === 'text_delta') {
          return {
            id: '',
            model: '',
            created: Date.now(),
            choices: [{
              index: data.index as number ?? 0,
              delta: { content: delta.text as string },
              finish_reason: null,
            }],
          };
        }
        return null;
      }
      case 'message_delta': {
        const delta = data.delta as Record<string, unknown> ?? {};
        const usage = data.usage as { output_tokens: number } | undefined;
        const stopReason = delta.stop_reason as string | null;
        return {
          id: '',
          model: '',
          created: Date.now(),
          choices: [{
            index: 0,
            delta: {},
            finish_reason: stopReason === 'end_turn' ? 'stop' : stopReason ?? null,
          }],
          usage: usage ? { prompt_tokens: 0, completion_tokens: usage.output_tokens ?? 0 } : undefined,
        };
      }
      case 'message_stop':
        return null;
      default:
        return null;
    }
  }

  translateResponse(raw: unknown): NormalizedResponse {
    const data = raw as Record<string, unknown>;
    const content = (data.content as Array<Record<string, unknown>>) ?? [];
    const textBlocks = content
      .filter((c: Record<string, unknown>) => c.type === 'text')
      .map((c: Record<string, unknown>) => c.text as string)
      .join('');

    return {
      id: data.id as string ?? '',
      model: data.model as string ?? '',
      created: Date.now(),
      choices: [{
        index: 0,
        message: { role: 'assistant', content: textBlocks || '' },
        finish_reason: (data.stop_reason as string) === 'end_turn' ? 'stop' : (data.stop_reason as string ?? null),
      }],
      usage: data.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined,
    };
  }

  async checkHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.config.base_url.replace(/\/$/, '')}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.api_key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(10_000),
      });
      const latency_ms = Date.now() - start;
      if (res.ok) {
        return { status: 'healthy', latency_ms };
      }
      return { status: 'unhealthy', latency_ms, error: `HTTP ${res.status}` };
    } catch (error) {
      return { status: 'unhealthy', latency_ms: Date.now() - start, error: String(error) };
    }
  }

  async listModels(): Promise<string[]> {
    return this.config.models;
  }
}