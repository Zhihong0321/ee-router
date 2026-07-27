import { query } from '../db/pool.js';
import { pool } from '../db/pool.js';

interface LatencyRecord {
  provider_id: string;
  model: string;
  ttfb_ms: number;
  total_ms: number;
  success: boolean;
  recorded_at: Date;
}

const WINDOW_SIZE = 100;
const FLUSH_INTERVAL_MS = 60_000;

export class LatencyTracker {
  private records = new Map<string, LatencyRecord[]>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flushToDb(), FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  record(providerId: string, model: string, ttfbMs: number, totalMs: number, success: boolean): void {
    const key = `${providerId}:${model}`;
    let list = this.records.get(key);
    if (!list) {
      list = [];
      this.records.set(key, list);
    }
    list.push({ provider_id: providerId, model, ttfb_ms: ttfbMs, total_ms: totalMs, success, recorded_at: new Date() });
    // Trim to window size
    if (list.length > WINDOW_SIZE) {
      list.splice(0, list.length - WINDOW_SIZE);
    }
  }

  getAverageLatency(providerId: string, model: string): number | null {
    const key = `${providerId}:${model}`;
    const list = this.records.get(key);
    if (!list || list.length === 0) return null;

    // Weighted average: recent entries count more (linear decay)
    const total = list.reduce((sum, r, i) => sum + r.ttfb_ms * (i + 1), 0);
    const weight = list.reduce((sum, _, i) => sum + (i + 1), 0);
    return total / weight;
  }

  getFailureRate(providerId: string, model: string): number {
    const key = `${providerId}:${model}`;
    const list = this.records.get(key);
    if (!list || list.length === 0) return 0;
    return list.filter(r => !r.success).length / list.length;
  }

  async loadFromDb(): Promise<void> {
    try {
      const rows = await query<LatencyRecord>(
        `SELECT provider_id, model, ttfb_ms, total_ms, success, recorded_at
         FROM latency_metrics
         WHERE recorded_at > NOW() - INTERVAL '1 hour'
         ORDER BY recorded_at DESC
         LIMIT 1000`
      );
      for (const row of rows) {
        const key = `${row.provider_id}:${row.model}`;
        let list = this.records.get(key);
        if (!list) {
          list = [];
          this.records.set(key, list);
        }
        if (list.length < WINDOW_SIZE) {
          list.push(row);
        }
      }
    } catch {
      // DB might not be available yet
    }
  }

  private async flushToDb(): Promise<void> {
    if (!pool) return;

    const allRecords: LatencyRecord[] = [];
    for (const list of this.records.values()) {
      // Only flush records from the last interval
      const cutoff = new Date(Date.now() - FLUSH_INTERVAL_MS);
      allRecords.push(...list.filter(r => r.recorded_at > cutoff));
    }
    if (allRecords.length === 0) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const record of allRecords) {
        await client.query(
          `INSERT INTO latency_metrics (provider_id, model, ttfb_ms, total_ms, success, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [record.provider_id, record.model, record.ttfb_ms, record.total_ms, record.success, record.recorded_at]
        );
      }
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
      // Flush errors are non-critical
    } finally {
      client.release();
    }
  }
}

export const latencyTracker = new LatencyTracker();