import { type ProviderConfig } from './interface.js';

export interface ModelDiscoveryInput {
  provider_type: ProviderConfig['provider_type'];
  base_url: string;
  api_key: string;
}

function modelsUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '') + '/models';
}

function parseModelIds(providerType: ProviderConfig['provider_type'], payload: unknown): string[] {
  const data = payload as Record<string, unknown>;
  if (providerType === 'gemini') {
    const models = Array.isArray(data.models) ? data.models : [];
    return models
      .filter((model): model is Record<string, unknown> => Boolean(model && typeof model === 'object'))
      .filter(model => {
        const methods = model.supportedGenerationMethods;
        return !Array.isArray(methods) || methods.includes('generateContent');
      })
      .map(model => String(model.name ?? '').replace(/^models\//, ''))
      .filter(Boolean);
  }

  const models = Array.isArray(data.data) ? data.data : [];
  return models
    .filter((model): model is Record<string, unknown> => Boolean(model && typeof model === 'object'))
    .map(model => String(model.id ?? ''))
    .filter(Boolean);
}

export async function discoverModels(input: ModelDiscoveryInput): Promise<string[]> {
  const url = new URL(modelsUrl(input.base_url));
  const headers: Record<string, string> = {};

  if (input.provider_type === 'gemini') {
    url.searchParams.set('key', input.api_key);
  } else if (input.provider_type === 'anthropic') {
    headers['x-api-key'] = input.api_key;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.Authorization = `Bearer ${input.api_key}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    return [];
  }

  return parseModelIds(input.provider_type, await response.json());
}
