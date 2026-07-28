import { type ProviderAdapter, type ProviderConfig, type NormalizedRequest, type NormalizedResponse, type NormalizedChunk } from './interface.js';

export class OpenAIAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  translateRequest(req: NormalizedRequest): { body: unknown; headers: Record<string, string> } {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content,
      })),
      stream: req.stream,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
    if (req.tools !== undefined) body.tools = req.tools;
    if (req.stream_options !== undefined) body.stream_options = req.stream_options;

    return {
      body,
      headers: {
        Authorization: `Bearer ${this.config.api_key}`,
        'Content-Type': 'application/json',
      },
    };
  }

  translateStreamChunk(raw: Buffer): NormalizedChunk[] {
    const lines = raw.toString('utf8').split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]');
    const chunks: NormalizedChunk[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.slice(6));
        chunks.push({
          id: parsed.id ?? '',
          model: parsed.model ?? this.config.models[0] ?? '',
          created: parsed.created ?? Date.now(),
          choices: (parsed.choices ?? []).map((c: { index?: number; delta?: { role?: string; content?: string; tool_calls?: unknown[] }; finish_reason?: string | null }) => ({
            index: c.index ?? 0,
            delta: {
              role: c.delta?.role,
              content: c.delta?.content,
              tool_calls: c.delta?.tool_calls as NormalizedChunk['choices'][0]['delta']['tool_calls'],
            },
            finish_reason: c.finish_reason ?? null,
          })),
          usage: parsed.usage as NormalizedChunk['usage'] | undefined,
        });
      } catch {
        // Ignore malformed SSE lines.
      }
    }
    return chunks;
  }

  translateResponse(raw: unknown): NormalizedResponse {
    const data = raw as Record<string, unknown>;
    const choices = (data.choices as Array<Record<string, unknown>>) ?? [];
    return {
      id: data.id as string ?? '',
      model: data.model as string ?? '',
      created: data.created as number ?? Date.now(),
      choices: choices.map(c => ({
        index: c.index as number ?? 0,
        message: {
          role: ((c.message as Record<string, unknown>)?.role as string) ?? 'assistant',
          content: ((c.message as Record<string, unknown>)?.content as string | null) ?? null,
          tool_calls: (c.message as Record<string, unknown>)?.tool_calls as NormalizedChunk['choices'][0]['delta']['tool_calls'],
        },
        finish_reason: c.finish_reason as string | null ?? null,
      })),
      usage: data.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined,
    };
  }

  async checkHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.config.base_url.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${this.config.api_key}` },
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
    try {
      const res = await fetch(`${this.config.base_url.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${this.config.api_key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data: Array<{ id: string }> };
      return data.data?.map(m => m.id) ?? [];
    } catch {
      return [];
    }
  }
}
