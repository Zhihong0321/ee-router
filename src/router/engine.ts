import { type ProviderAdapter } from '../providers/interface.js';
import { providerRegistry } from '../providers/registry.js';
import { selectFastestProvider } from './selector.js';
import { query } from '../db/pool.js';

export interface SelectedProvider {
  adapter: ProviderAdapter;
  failed: boolean;
}

export interface RouterOptions {
  maxRetries: number;
}

/**
 * Core routing engine.
 * Resolves providers for a given API key + model, picks the fastest,
 * and supports failover retry.
 */
export class RouterEngine {
  private options: RouterOptions;

  constructor(options: Partial<RouterOptions> = {}) {
    this.options = { maxRetries: 2, ...options };
  }

  /**
   * Resolve all providers available for a given API key ID and model.
   */
  async resolveProviders(apiKeyId: string, model: string): Promise<ProviderAdapter[]> {
    // Get all provider_group_ids for this key
    const groupRows = await query<{ provider_group_id: string }>(
      `SELECT pgm.provider_group_id
       FROM api_key_groups akg
       JOIN provider_group_members pgm ON pgm.provider_group_id = akg.provider_group_id
       WHERE akg.api_key_id = $1`,
      [apiKeyId]
    );

    const groupIds = [...new Set(groupRows.map(r => r.provider_group_id))];
    if (groupIds.length === 0) return [];

    // Get all provider IDs in these groups
    const memberRows = await query<{ provider_id: string }>(
      `SELECT DISTINCT provider_id FROM provider_group_members
       WHERE provider_group_id = ANY($1)`,
      [groupIds]
    );

    // Filter to active adapters that support the requested model
    return memberRows
      .map(r => providerRegistry.getAdapter(r.provider_id))
      .filter((a): a is ProviderAdapter =>
        a !== undefined &&
        a.config.is_active !== false &&
        (!a.config.api_key_expires_at || new Date(a.config.api_key_expires_at).getTime() > Date.now()) &&
        (model === '*' || a.config.models.includes('*') || a.config.models.includes(model))
      );
  }

  /**
   * Select the best provider from a list of candidates.
   */
  selectProvider(adapters: ProviderAdapter[]): ProviderAdapter | null {
    if (adapters.length === 0) return null;
    const scored = selectFastestProvider(adapters);
    return scored[0]?.adapter ?? null;
  }

  /**
   * Get the next best provider (for failover), excluding already-failed ones.
   */
  getNextBestProvider(adapters: ProviderAdapter[], failedIds: Set<string>): ProviderAdapter | null {
    const remaining = adapters.filter(a => !failedIds.has(a.config.id));
    return this.selectProvider(remaining);
  }
}

export const routerEngine = new RouterEngine();