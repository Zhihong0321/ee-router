import { describe, expect, it } from 'vitest';
import { OpenAIAdapter } from '../../src/providers/openai-adapter.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import type { ProviderConfig } from '../../src/providers/interface.js';

function makeConfig(): ProviderConfig {
  return {
    id: 'agy',
    name: 'Antigravity CLI',
    provider_type: 'agy-cli',
    base_url: 'http://127.0.0.1:8787/v1',
    api_key: 'bridge-secret',
    models: ['gemini-3.1-pro-high'],
    timeout_ms: 300_000,
    max_retries: 1,
  };
}

describe('agy-cli provider', () => {
  it('registers as an OpenAI-compatible bridge adapter', () => {
    const adapter = new ProviderRegistry().register(makeConfig());

    expect(adapter).toBeInstanceOf(OpenAIAdapter);
    expect(adapter.translateRequest({
      model: 'gemini-3.1-pro-high',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
    })).toEqual({
      body: {
        model: 'gemini-3.1-pro-high',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      },
      headers: {
        Authorization: 'Bearer bridge-secret',
        'Content-Type': 'application/json',
      },
    });
  });
});
