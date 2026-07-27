import { type ProviderAdapter } from '../providers/interface.js';
import { latencyTracker } from './latency-tracker.js';

export interface ProviderScore {
  adapter: ProviderAdapter;
  score: number;
  averageLatency: number | null;
  failureRate: number;
}

/**
 * Fastest-first selector:
 * Scores each provider by weighted average TTFB + failure penalty.
 * Lower score = better.
 */
export function selectFastestProvider(adapters: ProviderAdapter[]): ProviderScore[] {
  const scored = adapters.map(adapter => {
    // Pick first model for latency lookup
    const model = adapter.config.models[0] ?? 'default';
    const avgLatency = latencyTracker.getAverageLatency(adapter.config.id, model);
    const failureRate = latencyTracker.getFailureRate(adapter.config.id, model);

    // Score: average TTFB (or a default penalty of 500ms if no data) + failure penalty
    const latencyScore = avgLatency ?? 500;
    const failurePenalty = failureRate * 2000; // Add 2s penalty per 100% failure rate
    const score = latencyScore + failurePenalty;

    return { adapter, score, averageLatency: avgLatency, failureRate };
  });

  // Sort by score ascending
  scored.sort((a, b) => a.score - b.score);
  return scored;
}

/**
 * Round-robin selector
 */
export function selectRoundRobin(adapters: ProviderAdapter[]): ProviderScore[] {
  return adapters.map((adapter, index) => ({
    adapter,
    score: index,
    averageLatency: null,
    failureRate: 0,
  }));
}

/**
 * Priority selector
 */
export function selectByPriority(adapters: ProviderAdapter[], priorities: Map<string, number>): ProviderScore[] {
  return adapters
    .map(adapter => ({
      adapter,
      score: priorities.get(adapter.config.id) ?? 999,
      averageLatency: null,
      failureRate: 0,
    }))
    .sort((a, b) => a.score - b.score);
}