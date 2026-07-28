import { describe, expect, it } from 'vitest';
import { calculateRequestCost } from '../../src/router/request-logger.js';

describe('request log cost calculation', () => {
  it('calculates input and output cost from normalized usage', () => {
    expect(calculateRequestCost(
      { prompt_tokens: 1_000, completion_tokens: 500, total_tokens: 1_500 },
      2,
      4,
    )).toBeCloseTo(0.004);
  });

  it('returns null when the provider did not report usage', () => {
    expect(calculateRequestCost(undefined, 2, 4)).toBeNull();
  });
});
