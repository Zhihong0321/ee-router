import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerAdminUiRoutes } from '../../src/web/admin-ui.js';

describe('admin provider model editor', () => {
  it('emits newline-safe model parsing JavaScript from the raw HTML template', async () => {
    const app = Fastify();
    await registerAdminUiRoutes(app);

    const response = await app.inject({ method: 'GET', url: '/' });
    const html = response.body;

    expect(response.statusCode).toBe(200);
    expect(html).toContain(".join('\\n')");
    expect(html).toContain(".split(/[\\n,]/)");
    expect(html).not.toContain(".join('\\\\n')");
    expect(html).not.toContain(".split(/[\\\\n,]/)");

    await app.close();
  });
});
