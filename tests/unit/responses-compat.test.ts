import { describe, expect, it } from 'vitest';
import type { NormalizedChunk, NormalizedResponse } from '../../src/providers/interface.js';
import {
  customToolNames,
  normalizedResponseToResponses,
  registerCustomTools,
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

  it('accepts a singleton structured content part from Codex clients', () => {
    expect(responsesRequestToNormalized({
      model: 'model',
      input: [{
        type: 'message',
        role: 'user',
        content: { type: 'input_text', text: 'Hello from Codex' },
      }],
    }).messages).toEqual([{
      role: 'user',
      content: [{ type: 'text', text: 'Hello from Codex' }],
    }]);
  });

  it('accepts Codex items with missing, empty, or plain-text content', () => {
    expect(responsesRequestToNormalized({
      model: 'model',
      input: [
        { type: 'message', role: 'assistant' },
        { type: 'message', role: 'user', content: [] },
        { type: 'message', role: 'developer', content: [{ type: 'text', text: 'Be terse.' }] },
      ],
    }).messages).toEqual([
      { role: 'assistant', content: '' },
      { role: 'user', content: '' },
      { role: 'system', content: [{ type: 'text', text: 'Be terse.' }] },
    ]);
  });

  it('drops Responses-only items that have no Chat Completions equivalent', () => {
    expect(responsesRequestToNormalized({
      model: 'model',
      input: [
        { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'xxx' },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
      ],
    }).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
    ]);
  });

  it('translates Codex custom tool calls and their outputs', () => {
    expect(responsesRequestToNormalized({
      model: 'model',
      input: [
        { type: 'custom_tool_call', call_id: 'call_2', name: 'apply_patch', input: '*** Begin Patch' },
        { type: 'custom_tool_call_output', call_id: 'call_2', output: 'done' },
      ],
    }).messages).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_2',
          type: 'function',
          function: { name: 'apply_patch', arguments: '{"input":"*** Begin Patch"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call_2', content: 'done' },
    ]);
  });

  it('reports the offending payload when content is not translatable', () => {
    expect(() => responsesRequestToNormalized({
      model: 'model',
      input: [{ type: 'message', role: 'user', content: 42 }],
    })).toThrow('received 42');
  });

  it('rejects Responses-only state', () => {
    expect(() => responsesRequestToNormalized({
      model: 'model',
      input: 'Hello',
      previous_response_id: 'resp_previous',
    })).toThrow(ResponsesCompatibilityError);
  });

  it('maps Codex freeform tools onto function tools and drops hosted tools', () => {
    expect(responsesRequestToNormalized({
      model: 'model',
      input: 'Hello',
      tools: [
        { type: 'custom', name: 'apply_patch', description: 'Edit files', format: { type: 'grammar' } },
        { type: 'web_search' },
        { type: 'local_shell' },
      ],
    }).tools).toEqual([{
      type: 'function',
      function: {
        name: 'apply_patch',
        description: 'Edit files',
        parameters: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
      },
    }]);
  });

  it('drops a tool list that has no Chat Completions equivalent', () => {
    expect(responsesRequestToNormalized({
      model: 'model',
      input: 'Hello',
      tools: [{ type: 'web_search' }],
    }).tools).toBeUndefined();
  });

  it('hoists Codex code-mode tools out of the additional_tools input item', () => {
    const normalized = responsesRequestToNormalized({
      model: 'model',
      tool_choice: 'auto',
      parallel_tool_calls: false,
      input: [
        {
          type: 'additional_tools',
          role: 'developer',
          tools: [{ type: 'custom', name: 'exec', description: 'Run JavaScript' }],
        },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ],
    });

    expect(normalized.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
    expect(normalized.tools).toEqual([{
      type: 'function',
      function: {
        name: 'exec',
        description: 'Run JavaScript',
        parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
      },
    }]);
    expect(normalized.tool_choice).toBe('auto');
    expect(normalized.parallel_tool_calls).toBe(false);
  });

  it('never sends tool settings without tools', () => {
    const normalized = responsesRequestToNormalized({
      model: 'model',
      input: 'Hello',
      tool_choice: 'auto',
      parallel_tool_calls: false,
    });

    expect(normalized.tools).toBeUndefined();
    expect(normalized.tool_choice).toBeUndefined();
    expect(normalized.parallel_tool_calls).toBeUndefined();
  });
});

describe('Responses API custom tool round trip', () => {
  it('returns freeform tool calls as custom_tool_call items', () => {
    const request = {
      model: 'model',
      input: [{
        type: 'additional_tools',
        role: 'developer',
        tools: [{ type: 'custom', name: 'exec' }],
      }],
    };
    const key = {};
    registerCustomTools(key, customToolNames(request));

    const normalized: NormalizedResponse = {
      id: 'chatcmpl_1',
      model: 'model',
      created: 1,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'exec', arguments: '{"input":"await tools.shell()"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    };

    expect(normalizedResponseToResponses(normalized, 'model', key).output).toEqual([{
      id: expect.stringMatching(/^ctc_/),
      type: 'custom_tool_call',
      status: 'completed',
      call_id: 'call_1',
      name: 'exec',
      input: 'await tools.shell()',
    }]);

    const translator = new ResponsesStreamTranslator('model', key);
    const stream = translator.start()
      + translator.consume({
        id: 'chunk_1',
        model: 'model',
        created: 1,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'exec', arguments: '{"input":"await tools.shell()"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      })
      + translator.finish();

    expect(stream).toContain('"type":"custom_tool_call"');
    expect(stream).toContain('event: response.custom_tool_call_input.done');
    expect(stream).toContain('"input":"await tools.shell()"');
    expect(stream).not.toContain('function_call_arguments');
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
