// ── Normalized internal format ──────────────────────────────

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: string | ContentBlock[];
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

export interface NormalizedRequest {
  model: string;
  messages: Array<{ role: string; content: string | ContentBlock[] }>;
  temperature?: number;
  max_tokens?: number;
  stream: boolean;
  tools?: unknown[];
  [key: string]: unknown;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface NormalizedResponse {
  id: string;
  model: string;
  created: number;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null; tool_calls?: ToolCallDelta[] };
    finish_reason: string | null;
  }>;
  usage?: TokenUsage;
}

export interface NormalizedChunk {
  id: string;
  model: string;
  created: number;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string; tool_calls?: ToolCallDelta[] };
    finish_reason: string | null;
  }>;
  usage?: Partial<TokenUsage>;
}

// ── Provider Adapter contract ───────────────────────────────

export interface ProviderConfig {
  id: string;
  name: string;
  provider_type: 'openai-compatible' | 'anthropic' | 'gemini' | 'agy-cli' | 'codex-cli' | 'custom';
  base_url: string;
  api_key: string;
  models: string[];
  timeout_ms: number;
  max_retries: number;
  is_active?: boolean;
  api_key_expires_at?: string | null;
  extra_headers?: Record<string, string>;
  /** USD charged per 1 million input/prompt tokens. */
  input_cost_per_1m_tokens?: number;
  /** USD charged per 1 million output/completion tokens. */
  output_cost_per_1m_tokens?: number;
}

export interface ProviderAdapter {
  readonly config: ProviderConfig;

  /** Translate an incoming normalized request to this provider's wire format */
  translateRequest(req: NormalizedRequest): { body: unknown; headers: Record<string, string> };

  /** Parse streaming chunks from the provider's wire format */
  translateStreamChunk(raw: Buffer): NormalizedChunk[];

  /** Parse a non-streaming response */
  translateResponse(raw: unknown): NormalizedResponse;

  /** Execute an in-process or local-provider request without an HTTP upstream. */
  execute?(requestBody: unknown): Promise<NormalizedResponse>;

  /** Health check: returns status and measured latency */
  checkHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency_ms: number; error?: string }>;

  /** List models available from this provider */
  listModels(): Promise<string[]>;
}