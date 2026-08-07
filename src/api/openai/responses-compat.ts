import { randomUUID } from 'node:crypto';
import type {
  NormalizedChunk,
  NormalizedMessage,
  NormalizedRequest,
  NormalizedResponse,
  TokenUsage,
  ToolCallDelta,
} from '../../providers/interface.js';

type JsonObject = Record<string, unknown>;

export class ResponsesCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponsesCompatibilityError';
  }
}

function id(prefix: 'resp' | 'msg' | 'fc'): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function preview(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > 200 ? `${text.slice(0, 200)}...` : text;
  } catch {
    return String(value);
  }
}

const TEXT_PART_TYPES = new Set(['input_text', 'output_text', 'text', 'summary_text']);

function contentToChat(content: unknown): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  const parts = Array.isArray(content)
    ? content
    : asObject(content)
      ? [content]
      : null;
  if (!parts) {
    throw new ResponsesCompatibilityError(
      `Message content must be a string, object, or array (received ${preview(content)})`,
    );
  }
  if (parts.length === 0) return '';

  return parts.map(partValue => {
    if (typeof partValue === 'string') return { type: 'text', text: partValue };
    const part = asObject(partValue);
    if (!part) {
      throw new ResponsesCompatibilityError(`Each message content part must be an object (received ${preview(partValue)})`);
    }
    if (TEXT_PART_TYPES.has(String(part.type))) {
      return { type: 'text', text: String(part.text ?? '') };
    }
    if (part.type === 'refusal') {
      return { type: 'text', text: String(part.refusal ?? part.text ?? '') };
    }
    if (part.type === 'input_image') {
      const imageUrl = typeof part.image_url === 'string'
        ? part.image_url
        : asObject(part.image_url)?.url;
      if (typeof imageUrl !== 'string') {
        throw new ResponsesCompatibilityError('input_image requires a string image_url');
      }
      return { type: 'image_url', image_url: { url: imageUrl, detail: part.detail ?? 'auto' } };
    }
    if (typeof part.text === 'string') return { type: 'text', text: part.text };
    throw new ResponsesCompatibilityError(`Unsupported Responses content type: ${String(part.type)} (${preview(part)})`);
  });
}

const IGNORED_INPUT_ITEM_TYPES = new Set([
  'reasoning',
  'item_reference',
  'web_search_call',
  'file_search_call',
  'computer_call',
  'computer_call_output',
]);

function inputItemToMessages(itemValue: unknown): NormalizedMessage[] {
  const item = asObject(itemValue);
  if (!item) throw new ResponsesCompatibilityError(`Each input item must be an object (received ${preview(itemValue)})`);

  if (typeof item.type === 'string' && IGNORED_INPUT_ITEM_TYPES.has(item.type)) return [];

  if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
    if (typeof item.call_id !== 'string') {
      throw new ResponsesCompatibilityError(`${item.type} requires call_id`);
    }
    return [{
      role: 'tool',
      tool_call_id: item.call_id,
      content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
    }];
  }

  if (item.type === 'function_call' || item.type === 'custom_tool_call') {
    const name = typeof item.name === 'string' ? item.name : '';
    const callId = typeof item.call_id === 'string' ? item.call_id : id('fc');
    const rawArguments = item.arguments ?? item.input;
    const toolCall: ToolCallDelta = {
      id: callId,
      type: 'function',
      function: {
        name,
        arguments: typeof rawArguments === 'string' ? rawArguments : JSON.stringify(rawArguments ?? {}),
      },
    };
    return [{ role: 'assistant', content: '', tool_calls: [toolCall] }];
  }

  const rawRole = typeof item.role === 'string' ? item.role : '';
  if (!['user', 'assistant', 'system', 'developer'].includes(rawRole)) {
    throw new ResponsesCompatibilityError(
      `Unsupported Responses input item: ${String(item.type ?? (rawRole || 'unknown'))} (${preview(item)})`,
    );
  }
  const role = rawRole === 'developer' ? 'system' : rawRole;
  return [{ role, content: contentToChat(item.content) as NormalizedMessage['content'] }];
}

function toolsToChat(tools: unknown): unknown[] | undefined {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools)) throw new ResponsesCompatibilityError('tools must be an array');

  const translated: unknown[] = [];
  for (const toolValue of tools) {
    const tool = asObject(toolValue);
    if (!tool) continue;

    // Chat Completions-shaped tools are already usable.
    const nested = asObject(tool.function);
    if (tool.type === 'function' && nested && typeof nested.name === 'string') {
      translated.push(tool);
      continue;
    }

    if (tool.type === 'function' && typeof tool.name === 'string') {
      translated.push({
        type: 'function',
        function: {
          name: tool.name,
          ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
          parameters: tool.parameters ?? { type: 'object', properties: {} },
          ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
        },
      });
      continue;
    }

    // Codex freeform/grammar tools (apply_patch) map onto the JSON variant of
    // the same tool, which takes a single string argument named `input`.
    if (tool.type === 'custom' && typeof tool.name === 'string') {
      translated.push({
        type: 'function',
        function: {
          name: tool.name,
          ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
          parameters: {
            type: 'object',
            properties: { input: { type: 'string' } },
            required: ['input'],
          },
        },
      });
      continue;
    }

    // Hosted tools (web_search, file_search, computer_use, local_shell, ...)
    // cannot run on a Chat Completions backend; drop them instead of failing
    // the whole request.
  }

  return translated.length > 0 ? translated : undefined;
}

function toolChoiceToChat(value: unknown): unknown {
  const choice = asObject(value);
  if (!choice || choice.type !== 'function') return value;
  if (typeof choice.name !== 'string') throw new ResponsesCompatibilityError('Function tool_choice requires name');
  return { type: 'function', function: { name: choice.name } };
}

function responseFormatToChat(textValue: unknown): unknown {
  const text = asObject(textValue);
  const format = asObject(text?.format);
  if (!format || format.type === 'text') return undefined;
  if (format.type === 'json_object') return { type: 'json_object' };
  if (format.type === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: format.name,
        schema: format.schema,
        ...(format.description !== undefined ? { description: format.description } : {}),
        ...(format.strict !== undefined ? { strict: format.strict } : {}),
      },
    };
  }
  throw new ResponsesCompatibilityError(`Unsupported text format: ${String(format.type)}`);
}

export function responsesRequestToNormalized(body: JsonObject): NormalizedRequest {
  if (typeof body.model !== 'string' || !body.model) throw new ResponsesCompatibilityError('model is required');
  if (body.previous_response_id !== undefined && body.previous_response_id !== null) {
    throw new ResponsesCompatibilityError('previous_response_id is not supported by the Chat Completions compatibility layer');
  }
  if (body.background === true) {
    throw new ResponsesCompatibilityError('background responses are not supported by the Chat Completions compatibility layer');
  }

  const messages: NormalizedMessage[] = [];
  if (typeof body.instructions === 'string' && body.instructions) {
    messages.push({ role: 'system', content: body.instructions });
  }
  if (typeof body.input === 'string') {
    messages.push({ role: 'user', content: body.input });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) messages.push(...inputItemToMessages(item));
  } else {
    throw new ResponsesCompatibilityError('input must be a string or an array of input items');
  }

  return {
    model: body.model,
    messages,
    stream: body.stream === true,
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    max_completion_tokens: typeof body.max_output_tokens === 'number' ? body.max_output_tokens : undefined,
    tools: toolsToChat(body.tools),
    tool_choice: toolChoiceToChat(body.tool_choice),
    parallel_tool_calls: typeof body.parallel_tool_calls === 'boolean' ? body.parallel_tool_calls : undefined,
    response_format: responseFormatToChat(body.text),
  };
}

function usageToResponses(usage: TokenUsage | undefined): JsonObject | undefined {
  if (!usage) return undefined;
  return {
    input_tokens: usage.prompt_tokens,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: usage.completion_tokens,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: usage.total_tokens,
  };
}

function messageOutput(text: string, messageId = id('msg'), status = 'completed'): JsonObject {
  return {
    id: messageId,
    type: 'message',
    status,
    role: 'assistant',
    content: [{ type: 'output_text', annotations: [], logprobs: [], text }],
  };
}

function functionOutputs(toolCalls: ToolCallDelta[] | undefined): JsonObject[] {
  return (toolCalls ?? []).map(call => ({
    id: id('fc'),
    type: 'function_call',
    status: 'completed',
    call_id: call.id ?? id('fc'),
    name: call.function?.name ?? '',
    arguments: call.function?.arguments ?? '',
  }));
}

export function normalizedResponseToResponses(normalized: NormalizedResponse, requestedModel: string): JsonObject {
  const choice = normalized.choices[0];
  const text = choice?.message.content ?? '';
  const output: JsonObject[] = [];
  if (text || !choice?.message.tool_calls?.length) output.push(messageOutput(text));
  output.push(...functionOutputs(choice?.message.tool_calls));

  return {
    id: normalized.id.startsWith('resp_') ? normalized.id : id('resp'),
    object: 'response',
    created_at: normalized.created,
    status: 'completed',
    completed_at: Math.floor(Date.now() / 1000),
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: requestedModel,
    output,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: null,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    truncation: 'disabled',
    usage: usageToResponses(normalized.usage),
    metadata: {},
  };
}

function sse(event: JsonObject): string {
  return `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;
}

interface StreamToolCall {
  id: string;
  itemId: string;
  name: string;
  arguments: string;
  outputIndex: number;
  added: boolean;
}

export class ResponsesStreamTranslator {
  private readonly responseId = id('resp');
  private readonly messageId = id('msg');
  private readonly createdAt = Math.floor(Date.now() / 1000);
  private sequence = 0;
  private text = '';
  private textStarted = false;
  private readonly calls = new Map<number, StreamToolCall>();

  constructor(private readonly model: string) {}

  private event(type: string, fields: JsonObject = {}): string {
    return sse({ type, sequence_number: this.sequence++, ...fields });
  }

  private response(status: 'in_progress' | 'completed', usage?: TokenUsage): JsonObject {
    const output: JsonObject[] = [];
    if (this.textStarted) output.push(messageOutput(this.text, this.messageId, status));
    for (const call of [...this.calls.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      output.push({
        id: call.itemId,
        type: 'function_call',
        status,
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
      });
    }
    return {
      id: this.responseId,
      object: 'response',
      created_at: this.createdAt,
      status,
      error: null,
      incomplete_details: null,
      instructions: null,
      max_output_tokens: null,
      model: this.model,
      output,
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      store: false,
      temperature: null,
      text: { format: { type: 'text' } },
      tool_choice: 'auto',
      tools: [],
      top_p: null,
      truncation: 'disabled',
      usage: usageToResponses(usage),
      metadata: {},
    };
  }

  start(): string {
    return this.event('response.created', { response: this.response('in_progress') })
      + this.event('response.in_progress', { response: this.response('in_progress') });
  }

  consume(chunk: NormalizedChunk): string {
    const choice = chunk.choices[0];
    if (!choice) return '';
    let output = '';
    const delta = choice.delta.content;
    if (delta !== undefined && delta !== '') {
      if (!this.textStarted) {
        this.textStarted = true;
        output += this.event('response.output_item.added', {
          output_index: 0,
          item: { id: this.messageId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
        });
        output += this.event('response.content_part.added', {
          item_id: this.messageId,
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', annotations: [], logprobs: [], text: '' },
        });
      }
      this.text += delta;
      output += this.event('response.output_text.delta', {
        item_id: this.messageId,
        output_index: 0,
        content_index: 0,
        delta,
        logprobs: [],
      });
    }

    for (const toolDelta of choice.delta.tool_calls ?? []) {
      const toolIndex = toolDelta.index ?? 0;
      let call = this.calls.get(toolIndex);
      if (!call) {
        call = {
          id: toolDelta.id ?? id('fc'),
          itemId: id('fc'),
          name: '',
          arguments: '',
          outputIndex: (this.textStarted ? 1 : 0) + toolIndex,
          added: false,
        };
        this.calls.set(toolIndex, call);
      }
      if (toolDelta.id) call.id = toolDelta.id;
      if (toolDelta.function?.name) call.name += toolDelta.function.name;
      if (!call.added) {
        call.added = true;
        output += this.event('response.output_item.added', {
          output_index: call.outputIndex,
          item: {
            id: call.itemId,
            type: 'function_call',
            status: 'in_progress',
            call_id: call.id,
            name: call.name,
            arguments: '',
          },
        });
      }
      const argumentDelta = toolDelta.function?.arguments ?? '';
      if (argumentDelta) {
        call.arguments += argumentDelta;
        output += this.event('response.function_call_arguments.delta', {
          item_id: call.itemId,
          output_index: call.outputIndex,
          delta: argumentDelta,
        });
      }
    }
    return output;
  }

  finish(usage?: TokenUsage): string {
    let output = '';
    if (this.textStarted) {
      const part = { type: 'output_text', annotations: [], logprobs: [], text: this.text };
      output += this.event('response.output_text.done', {
        item_id: this.messageId,
        output_index: 0,
        content_index: 0,
        text: this.text,
        logprobs: [],
      });
      output += this.event('response.content_part.done', {
        item_id: this.messageId,
        output_index: 0,
        content_index: 0,
        part,
      });
      output += this.event('response.output_item.done', {
        output_index: 0,
        item: messageOutput(this.text, this.messageId),
      });
    }
    for (const call of [...this.calls.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      output += this.event('response.function_call_arguments.done', {
        item_id: call.itemId,
        output_index: call.outputIndex,
        arguments: call.arguments,
      });
      output += this.event('response.output_item.done', {
        output_index: call.outputIndex,
        item: {
          id: call.itemId,
          type: 'function_call',
          status: 'completed',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        },
      });
    }
    output += this.event('response.completed', { response: this.response('completed', usage) });
    return output;
  }
}
