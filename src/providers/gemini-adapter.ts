import { type ProviderAdapter, type ProviderConfig, type NormalizedRequest, type NormalizedResponse, type NormalizedChunk } from './interface.js';
import { discoverModels } from './model-discovery.js';

function toGeminiRole(role: string): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user';
}

function textFromContent(content: NormalizedRequest['messages'][number]['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('');
}

function normalizeCandidate(candidate: Record<string, unknown>, index = 0): NormalizedChunk {
  const content = candidate.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const text = parts
    .filter((part): part is Record<string, unknown> => Boolean(part && typeof part === 'object'))
    .map(part => String(part.text ?? ''))
    .join('');

  return {
    id: '',
    model: '',
    created: Date.now(),
    choices: [{
      index,
      delta: { content: text || undefined },
      finish_reason: candidate.finishReason ? String(candidate.finishReason).toLowerCase() : null,
    }],
  };
}

export class GeminiAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  translateRequest(req: NormalizedRequest): { body: unknown; headers: Record<string, string> } {
    const body: Record<string, unknown> = {
      contents: req.messages.map(message => ({
        role: toGeminiRole(message.role),
        parts: [{ text: textFromContent(message.content) }],
      })),
    };

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.max_tokens !== undefined) generationConfig.maxOutputTokens = req.max_tokens;
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    return {
      body,
      headers: { 'Content-Type': 'application/json' },
    };
  }

  translateStreamChunk(raw: Buffer): NormalizedChunk[] {
    return raw.toString('utf8')
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .flatMap(line => {
        try {
          const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
          const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
          return candidates.map((candidate, index) =>
            normalizeCandidate(candidate as Record<string, unknown>, index)
          );
        } catch {
          return [];
        }
      });
  }

  translateResponse(raw: unknown): NormalizedResponse {
    const data = raw as Record<string, unknown>;
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const first = (candidates[0] ?? {}) as Record<string, unknown>;
    const normalized = normalizeCandidate(first);
    const usage = data.usageMetadata as Record<string, unknown> | undefined;
    const text = normalized.choices[0]?.delta.content ?? null;

    return {
      id: `gemini-${Date.now()}`,
      model: this.config.models[0] ?? '',
      created: Date.now(),
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: normalized.choices[0]?.finish_reason ?? null,
      }],
      usage: usage ? {
        prompt_tokens: Number(usage.promptTokenCount ?? 0),
        completion_tokens: Number(usage.candidatesTokenCount ?? 0),
        total_tokens: Number(usage.totalTokenCount ?? 0),
      } : undefined,
    };
  }

  async checkHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      const models = await this.listModels();
      return {
        status: models.length > 0 ? 'healthy' : 'unhealthy',
        latency_ms: Date.now() - start,
        ...(models.length > 0 ? {} : { error: 'No Gemini models returned' }),
      };
    } catch (error) {
      return { status: 'unhealthy', latency_ms: Date.now() - start, error: String(error) };
    }
  }

  async listModels(): Promise<string[]> {
    return discoverModels({
      provider_type: 'gemini',
      base_url: this.config.base_url,
      api_key: this.config.api_key,
    });
  }
}
