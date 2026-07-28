import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerProviderModelCostsUiRoutes } from '../../src/web/provider-model-costs-ui.js';

describe('provider model costs UI', () => {
  it('renders a dedicated per-model pricing page', async () => {
    const app = Fastify();
    await registerProviderModelCostsUiRoutes(app);

    const response = await app.inject({ method: 'GET', url: '/providers/provider-1/costs' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Set cost per model');
    expect(response.body).toContain('Input cost (USD / 1M)');
    expect(response.body).toContain("'/model-costs'");

    await app.close();
  });
});
