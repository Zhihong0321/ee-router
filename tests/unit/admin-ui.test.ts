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
    expect(html).toContain('<option value="runware">Runware (ready-to-use preset)</option>');
    expect(html).toContain("runware: 'https://api.runware.ai/v1'");
    expect(html).toContain("type === 'runware' ? 'openai-compatible' : type");
    expect(html).toContain("el('models').value = '*'");

    await app.close();
  });
});
