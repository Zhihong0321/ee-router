import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverModels } from '../../src/providers/model-discovery.js';

describe('discoverModels', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads OpenAI-compatible model IDs with bearer auth', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }] }), { status: 200 }),
    );

    await expect(discoverModels({
      provider_type: 'openai-compatible',
      base_url: 'https://api.openai.com/v1',
      api_key: 'secret',
    })).resolves.toEqual(['gpt-4.1', 'gpt-4.1-mini']);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.openai.com/v1/models'),
      expect.objectContaining({ headers: { Authorization: 'Bearer secret' } }),
    );
  });

  it('reads Gemini model names and sends the key as a query parameter', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        ],
      }), { status: 200 }),
    );

    await expect(discoverModels({
      provider_type: 'gemini',
      base_url: 'https://generativelanguage.googleapis.com/v1beta',
      api_key: 'gemini-secret',
    })).resolves.toEqual(['gemini-2.5-flash']);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(calledUrl.searchParams.get('key')).toBe('gemini-secret');
  });

  it('uses Anthropic headers for Anthropic model discovery', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4' }] }), { status: 200 }),
    );

    await expect(discoverModels({
      provider_type: 'anthropic',
      base_url: 'https://api.anthropic.com/v1',
      api_key: 'anthropic-secret',
    })).resolves.toEqual(['claude-sonnet-4']);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.anthropic.com/v1/models'),
      expect.objectContaining({
        headers: {
          'x-api-key': 'anthropic-secret',
          'anthropic-version': '2023-06-01',
        },
      }),
    );
  });
});
