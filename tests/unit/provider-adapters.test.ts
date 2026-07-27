import { describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from '../../src/providers/anthropic-adapter.js';
import { OpenAIAdapter } from '../../src/providers/openai-adapter.js';
import type { NormalizedRequest, ProviderConfig } from '../../src/providers/interface.js';

function makeConfig(provider_type: ProviderConfig['provider_type'], models = ['test-model']): ProviderConfig {
  return {
    id: provider_type,
    name: provider_type,
    provider_type,
    base_url: 'https://example.test/',
    api_key: 'secret-key',
    models,
    timeout_ms: 1_000,
    max_retries: 0,
  };
}

function makeRequest(overrides: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    model: 'test-model',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ],
    stream: true,
    temperature: 0.2,
    max_tokens: 64,
    tools: [{ type: 'function' }],
    ...overrides,
  };
}

describe('OpenAIAdapter', () => {
  const adapter = new OpenAIAdapter(makeConfig('openai-compatible'));

  it('translates normalized requests to OpenAI format', () => {
    const translated = adapter.translateRequest(makeRequest());

    expect(translated.body).toEqual({
      model: 'test-model',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
      stream: true,
      temperature: 0.2,
      max_tokens: 64,
      tools: [{ type: 'function' }],
    });
    expect(translated.headers).toEqual({
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json',
    });
  });

  it('parses valid SSE chunks, ignores DONE, and skips malformed lines', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);
    const raw = Buffer.from([
      'data: {"id":"chunk-1","model":"test-model","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
      'data: not-json',
      'data: [DONE]',
      '',
    ].join('\n'));

    expect(adapter.translateStreamChunk(raw)).toEqual([{
      id: 'chunk-1',
      model: 'test-model',
      created: 123,
      choices: [{
        index: 0,
        delta: { role: undefined, content: 'Hi', tool_calls: undefined },
        finish_reason: null,
      }],
      usage: undefined,
    }]);
    vi.restoreAllMocks();
  });

  it('normalizes a non-streaming response', () => {
    vi.spyOn(Date, 'now').mockReturnValue(456);
    expect(adapter.translateResponse({
      id: 'response-1',
      model: 'test-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Done' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    })).toEqual({
      id: 'response-1',
      model: 'test-model',
      created: 456,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Done', tool_calls: undefined },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    vi.restoreAllMocks();
  });
});

describe('AnthropicAdapter', () => {
  const adapter = new AnthropicAdapter(makeConfig('anthropic'));

  it('translates normalized requests and uses Anthropic headers', () => {
    const translated = adapter.translateRequest(makeRequest());

    expect(translated.body).toEqual({
      model: 'test-model',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
      stream: true,
      max_tokens: 64,
      temperature: 0.2,
      tools: [{ type: 'function' }],
    });
    expect(translated.headers).toEqual({
      'x-api-key': 'secret-key',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    });
  });

  it('parses Anthropic message start, text delta, and stop-reason events', () => {
    const raw = Buffer.from([
      'event: message_start',
      'data: {"message":{"id":"msg-1","model":"claude","usage":{"prompt_tokens":2,"completion_tokens":0}}}',
      '',
      'event: content_block_delta',
      'data: {"index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: message_delta',
      'data: {"delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":3}}',
      '',
      'event: message_stop',
      'data: {}',
      '',
    ].join('\n'));

    expect(adapter.translateStreamChunk(raw)).toEqual([
      {
        id: 'msg-1',
        model: 'claude',
        created: expect.any(Number),
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        usage: { prompt_tokens: 2, completion_tokens: 0 },
      },
      {
        id: '',
        model: '',
        created: expect.any(Number),
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
      },
      {
        id: '',
        model: '',
        created: expect.any(Number),
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 3 },
      },
    ]);
  });

  it('joins text response blocks and maps end_turn to stop', () => {
    expect(adapter.translateResponse({
      id: 'msg-2',
      model: 'claude',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'tool_use', id: 'tool-1' },
        { type: 'text', text: 'world' },
      ],
      stop_reason: 'end_turn',
      usage: { prompt_tokens: 4, completion_tokens: 5 },
    })).toMatchObject({
      id: 'msg-2',
      model: 'claude',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello world' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 4, completion_tokens: 5 },
    });
  });
});
