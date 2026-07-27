import { type ProviderAdapter, type ProviderConfig, type NormalizedRequest, type NormalizedResponse, type NormalizedChunk } from './interface.js';
import { OpenAIAdapter } from './openai-adapter.js';

export class CustomProviderAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;
  private _delegate: OpenAIAdapter;

  constructor(config: ProviderConfig) {
    this.config = config;
    this._delegate = new OpenAIAdapter(config);
  }

  translateRequest(req: NormalizedRequest): { body: unknown; headers: Record<string, string> } {
    const result = this._delegate.translateRequest(req);
    // Merge extra headers
    if (this.config.extra_headers) {
      result.headers = { ...result.headers, ...this.config.extra_headers };
    }
    return result;
  }

  translateStreamChunk(raw: Buffer): NormalizedChunk[] {
    return this._delegate.translateStreamChunk(raw);
  }

  translateResponse(raw: unknown): NormalizedResponse {
    return this._delegate.translateResponse(raw);
  }

  async checkHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.config.base_url.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${this.config.api_key}`, ...this.config.extra_headers },
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