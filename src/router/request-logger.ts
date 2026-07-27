import { pool } from '../db/pool.js';

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
}

export async function writeRequestLog(input: RequestLogInput): Promise<void> {
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO request_logs
       (api_key_id, api_key_prefix, provider_id, provider_name, model, latency_ms, ttfb_ms, is_streaming, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.apiKeyId,
        input.apiKeyPrefix,
        input.providerId,
        input.providerName,
        input.model,
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
