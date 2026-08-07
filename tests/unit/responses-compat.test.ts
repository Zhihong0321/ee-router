import { describe, expect, it } from 'vitest';
import type { NormalizedChunk, NormalizedResponse } from '../../src/providers/interface.js';
import {
  normalizedResponseToResponses,
  ResponsesCompatibilityError,
  responsesRequestToNormalized,
  ResponsesStreamTranslator,
} from '../../src/api/openai/responses-compat.js';

describe('Responses API request compatibility', () => {
  it('translates instructions, input, functions, and output limits to Chat Completions', () => {
    const normalized = responsesRequestToNormalized({
      model: 'minimax:m2.7@0',
      instructions: 'Be concise.',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
      max_output_tokens: 128,
      stream: true,
      tools: [{
        type: 'function',
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
        strict: true,
      }],
      tool_choice: { type: 'function', name: 'get_weather' },
      text: {
        format: {
          type: 'json_schema',
          name: 'answer',
          schema: { type: 'object', properties: { answer: { type: 'string' } } },
          strict: true,
        },
      },
    });

    expect(normalized).toMatchObject({
      model: 'minimax:m2.7@0',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ],
      stream: true,
      max_completion_tokens: 128,
      tools: [{
        type: 'function',
        function: expect.objectContaining({ name: 'get_weather', strict: true }),
      }],
      tool_choice: { type: 'function', function: { name: 'get_weather' } },
      response_format: {
        type: 'json_schema',
        json_schema: expect.objectContaining({ name: 'answer', strict: true }),
      },
    });
  });

  it('translates function results into tool messages', () => {
    expect(responsesRequestToNormalized({
      model: 'model',
      input: [{ type: 'function_call_output', call_id: 'call_1', output: { temp: 22 } }],
    }).messages).toEqual([{
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"temp":22}',
    }]);
  });

  it('rejects Responses-only state and hosted tools', () => {
    expect(() => responsesRequestToNormalized({
      model: 'model',
      input: 'Hello',
      previous_response_id: 'resp_previous',
    })).toThrow(ResponsesCompatibilityError);

    expect(() => responsesRequestToNormalized({
      model: 'model',
      input: 'Hello',
      tools: [{ type: 'web_search' }],
    })).toThrow('Only function tools');
  });
});

describe('Responses API output compatibility', () => {
  it('wraps a Chat Completions text response in a Responses object', () => {
    const normalized: NormalizedResponse = {
      id: 'chatcmpl_1',
      model: 'model',
      created: 123,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello back' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    };

    expect(normalizedResponseToResponses(normalized, 'model')).toMatchObject({
      object: 'response',
      created_at: 123,
      status: 'completed',
      model: 'model',
      output: [{
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello back' }],
      }],
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    });
  });

  it('emits typed text and function-call SSE events', () => {
    const translator = new ResponsesStreamTranslator('model');
    const textChunk: NormalizedChunk = {
      id: 'chunk_1',
      model: 'model',
      created: 1,
      choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
    };
    const functionChunk: NormalizedChunk = {
      id: 'chunk_2',
      model: 'model',
      created: 1,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'weather', arguments: '{"city":"Paris"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    };

    const stream = translator.start()
      + translator.consume(textChunk)
      + translator.consume(functionChunk)
      + translator.finish({ prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 });

    expect(stream).toContain('event: response.created');
    expect(stream).toContain('event: response.output_text.delta');
    expect(stream).toContain('"delta":"Hi"');
    expect(stream).toContain('event: response.function_call_arguments.delta');
    expect(stream).toContain('event: response.function_call_arguments.done');
    expect(stream).toContain('event: response.completed');
    expect(stream).toContain('"total_tokens":7');
    expect(stream).not.toContain('data: [DONE]');
  });
});
