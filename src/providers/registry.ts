import { type ModelCost, type ProviderAdapter, type ProviderConfig } from './interface.js';
import { OpenAIAdapter } from './openai-adapter.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { CustomProviderAdapter } from './custom-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { AgyCliAdapter } from './agy-cli-adapter.js';
import { CodexCliAdapter } from './codex-cli-adapter.js';
import { decryptProviderKey } from '../security/provider-key.js';

export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  register(config: ProviderConfig): ProviderAdapter {
    let adapter: ProviderAdapter;
    switch (config.provider_type) {
      case 'openai-compatible':
        adapter = new OpenAIAdapter(config);
        break;
      case 'anthropic':
        adapter = new AnthropicAdapter(config);
        break;
      case 'gemini':
        adapter = new GeminiAdapter(config);
        break;
      case 'agy-cli':
        adapter = new AgyCliAdapter(config);
        break;
      case 'codex-cli':
        adapter = new CodexCliAdapter(config);
        break;
      case 'custom':
        adapter = new CustomProviderAdapter(config);
        break;
      default:
        throw new Error(`Unknown provider type: ${config.provider_type}`);
    }
    this.adapters.set(config.id, adapter);
    return adapter;
  }

  unregister(providerId: string): void {
    this.adapters.delete(providerId);
  }

  getAdapter(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  getAllAdapters(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  setModelCosts(providerId: string, modelCosts: Record<string, ModelCost>): void {
    const adapter = this.adapters.get(providerId);
    if (adapter) adapter.config.model_costs = modelCosts;
  }

  /** Load providers from DB rows */
  loadFromDb(rows: Array<Record<string, unknown>>): void {
    for (const row of rows) {
      this.register({
        id: row.id as string,
        name: row.name as string,
        provider_type: row.provider_type as ProviderConfig['provider_type'],
        base_url: row.base_url as string,
        api_key: decryptProviderKey(
          (row.api_key_enc ?? row.api_key) as string,
          (row.api_key_iv as string | undefined) ?? '0',
        ),
        models: row.models as string[],
        api_key_expires_at: row.api_key_expires_at as string | null | undefined,
        timeout_ms: (row.timeout_ms as number) ?? 60_000,
        max_retries: (row.max_retries as number) ?? 2,
        extra_headers: row.extra_headers as Record<string, string> | undefined,
        strip_tools_models: row.strip_tools_models as string[] | undefined,
      });
    }
  }

  clear(): void {
    this.adapters.clear();
  }
}

// Singleton
export const providerRegistry = new ProviderRegistry();
