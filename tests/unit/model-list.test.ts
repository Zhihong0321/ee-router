import { describe, expect, it } from 'vitest';
import { filterModelsForKey } from '../../src/api/openai/chat.js';

describe('filterModelsForKey', () => {
  const models = ['gpt-5.5', 'gpt-5.6-luna', 'claude-opus-5'];

  it('returns all provider models when no allowlist is configured', () => {
    expect(filterModelsForKey(models, [])).toEqual(models);
  });

  it('returns all provider models for a wildcard allowlist', () => {
    expect(filterModelsForKey(models, ['*'])).toEqual(models);
  });

  it('advertises only exact allowlisted models', () => {
    expect(filterModelsForKey(models, ['gpt-5.6-luna', 'missing-model'])).toEqual(['gpt-5.6-luna']);
  });
});
