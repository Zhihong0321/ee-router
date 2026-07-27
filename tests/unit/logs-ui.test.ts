import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerAdminLogsUiRoutes } from '../../src/web/logs-ui.js';

describe('request logs UI', () => {
  it('renders the per-key logs page and its filters', async () => {
    const app = Fastify();
    await registerAdminLogsUiRoutes(app);

    const response = await app.inject({ method: 'GET', url: '/logs?api_key_id=key-1' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Request logs by API key.');
    expect(response.body).toContain('id="key-filter"');
    expect(response.body).toContain('/api/admin/keys/options');
    expect(response.body).toContain('/api/admin/logs?');
    expect(response.body).toContain('Prompts and responses are never stored');

    await app.close();
  });
});
