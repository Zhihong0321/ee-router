import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter, ProviderConfig } from '../../src/providers/interface.js';

const { getAverageLatency, getFailureRate } = vi.hoisted(() => ({
  getAverageLatency: vi.fn(),
  getFailureRate: vi.fn(),
}));

vi.mock('../../src/router/latency-tracker.js', () => ({
  latencyTracker: { getAverageLatency, getFailureRate },
}));

import {
  selectByPriority,
  selectFastestProvider,
  selectRoundRobin,
} from '../../src/router/selector.js';

function makeAdapter(id: string, models = ['model']): ProviderAdapter {
  const config: ProviderConfig = {
    id,
    name: id,
    provider_type: 'openai-compatible',
    base_url: 'https://example.test',
    api_key: 'test-key',
    models,
    timeout_ms: 1_000,
    max_retries: 0,
  };

  return {
    config,
    translateRequest: vi.fn(),
    translateStreamChunk: vi.fn(),
    translateResponse: vi.fn(),
    checkHealth: vi.fn(),
    listModels: vi.fn(),
  };
}

describe('selectFastestProvider', () => {
  beforeEach(() => {
    getAverageLatency.mockReset();
    getFailureRate.mockReset();
    getFailureRate.mockReturnValue(0);
  });

  it('orders providers by the lowest latency score first', () => {
    const slow = makeAdapter('slow');
    const fast = makeAdapter('fast');
    const medium = makeAdapter('medium');
    getAverageLatency.mockImplementation((id: string) => ({ fast: 40, medium: 120, slow: 300 })[id] ?? null);

    const result = selectFastestProvider([slow, fast, medium]);

    expect(result.map(({ adapter }) => adapter.config.id)).toEqual(['fast', 'medium', 'slow']);
    expect(getAverageLatency).toHaveBeenCalledWith('fast', 'model');
  });

  it('adds the failure penalty and defaults missing latency to 500ms', () => {
    const reliable = makeAdapter('reliable');
    const failing = makeAdapter('failing');
    const unknown = makeAdapter('unknown');
    getAverageLatency.mockImplementation((id: string) => (id === 'reliable' || id === 'failing' ? 100 : null));
    getFailureRate.mockImplementation((id: string) => (id === 'failing' ? 0.25 : 0));

    const result = selectFastestProvider([unknown, failing, reliable]);
    const byId = new Map(result.map(score => [score.adapter.config.id, score]));

    expect(byId.get('reliable')).toMatchObject({ score: 100, averageLatency: 100, failureRate: 0 });
    expect(byId.get('failing')).toMatchObject({ score: 600, averageLatency: 100, failureRate: 0.25 });
    expect(byId.get('unknown')).toMatchObject({ score: 500, averageLatency: null, failureRate: 0 });
    expect(result.map(({ adapter }) => adapter.config.id)).toEqual(['reliable', 'unknown', 'failing']);
  });
});

describe('other provider selectors', () => {
  it('preserves input order for round robin selection', () => {
    const adapters = [makeAdapter('a'), makeAdapter('b')];
    expect(selectRoundRobin(adapters).map(({ adapter }) => adapter.config.id)).toEqual(['a', 'b']);
  });

  it('sorts by configured priority and puts missing priorities last', () => {
    const adapters = [makeAdapter('default'), makeAdapter('high'), makeAdapter('low')];
    const result = selectByPriority(adapters, new Map([['high', 1], ['low', 10]]));

    expect(result.map(({ adapter }) => adapter.config.id)).toEqual(['high', 'low', 'default']);
  });
});
