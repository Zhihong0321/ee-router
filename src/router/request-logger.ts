import { pool } from '../db/pool.js';
import { type TokenUsage } from '../providers/interface.js';

export type RequestLogStatus = 'success' | 'error' | 'timeout' | 'failover';

export interface RequestLogInput {
  apiKeyId: string;
  apiKeyPrefix: string;
  providerId: string | null;
  providerName: string;
  model: string;
  latencyMs: number;
  ttfbMs: number;
  status: RequestLogStatus;
  errorMessage?: string;
  isStreaming: boolean;
  usage?: TokenUsage;
  inputCostPer1mTokens?: number;
  outputCostPer1mTokens?: number;
}

export function calculateRequestCost(
  usage: TokenUsage | undefined,
  inputCostPer1mTokens = 0,
  outputCostPer1mTokens = 0,
): number | null {
  if (!usage) return null;
  return (
    (usage.prompt_tokens * Math.max(0, inputCostPer1mTokens)) +
    (usage.completion_tokens * Math.max(0, outputCostPer1mTokens))
  ) / 1_000_000;
}

export async function writeRequestLog(input: RequestLogInput): Promise<void> {
  if (!pool) return;

  const usage = input.usage;
  const costUsd = calculateRequestCost(
    usage,
    input.inputCostPer1mTokens,
    input.outputCostPer1mTokens,
  );

  try {
    await pool.query(
      `INSERT INTO request_logs
       (api_key_id, api_key_prefix, provider_id, provider_name, model,
        prompt_tokens, completion_tokens, total_tokens, cost_usd,
        latency_ms, ttfb_ms, is_streaming, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        input.apiKeyId,
        input.apiKeyPrefix,
        input.providerId,
        input.providerName,
        input.model,
        usage?.prompt_tokens ?? null,
        usage?.completion_tokens ?? null,
        usage?.total_tokens ?? null,
        costUsd,
        Math.max(0, Math.round(input.latencyMs)),
        Math.max(0, Math.round(input.ttfbMs)),
        input.isStreaming,
        input.status,
        input.errorMessage ?? null,
      ],
    );
  } catch {
    // Request logging must never make a client request fail.
  }
}