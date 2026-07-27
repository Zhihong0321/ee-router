import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authenticateAdmin } from '../../src/auth/admin.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function makeReply() {
  const status = vi.fn().mockReturnThis();
  const send = vi.fn().mockResolvedValue(undefined);
  return { reply: { status, send } as unknown as FastifyReply, status, send };
}

function makeRequest(token?: string): FastifyRequest {
  return {
    headers: { authorization: token ? `Bearer ${token}` : undefined },
  } as FastifyRequest;
}

describe('admin authentication', () => {
  it('leaves admin routes open when no key is configured', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ADMIN_API_KEY;
    const { reply, status } = makeReply();

    await authenticateAdmin(makeRequest(), reply);

    expect(status).not.toHaveBeenCalled();
  });

  it('accepts the configured bearer token', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_API_KEY = 'a'.repeat(32);
    const { reply, status } = makeReply();

    await authenticateAdmin(makeRequest('a'.repeat(32)), reply);

    expect(status).not.toHaveBeenCalled();
  });

  it('rejects a missing or incorrect token', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_API_KEY = 'a'.repeat(32);
    const { reply, status, send } = makeReply();

    await authenticateAdmin(makeRequest('b'.repeat(32)), reply);

    expect(status).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledWith({
      error: { type: 'authentication_error', message: 'Invalid admin credentials' },
    });
  });
});
