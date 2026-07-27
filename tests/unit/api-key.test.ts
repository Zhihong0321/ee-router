import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiKeyInfo } from '../../src/auth/api-key.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../src/db/pool.js', () => ({ query, pool: null }));

import { authenticate, clearKeyCache, lookupApiKey } from '../../src/auth/api-key.js';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function makeKeyInfo(key_hash: string): ApiKeyInfo {
  return {
    id: 'key-1',
    key_hash,
    key_prefix: 'sk_live',
    name: 'test key',
    description: '',
    is_active: true,
    rate_limit: 10,
    allowed_ips: [],
    created_at: new Date('2025-01-01T00:00:00.000Z'),
  };
}

function makeReply() {
  const status = vi.fn().mockReturnThis();
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    reply: { status, send } as unknown as FastifyReply,
    status,
    send,
  };
}

function makeRequest(authorization?: string): FastifyRequest {
  return { headers: { authorization } } as FastifyRequest;
}

describe('lookupApiKey', () => {
  beforeEach(() => {
    query.mockReset();
    clearKeyCache();
  });

  it('hashes the token and passes the SHA-256 hex digest to the query', async () => {
    const token = 'sk_live_test_token';
    const row = makeKeyInfo(hash(token));
    query.mockResolvedValueOnce([row]);

    await expect(lookupApiKey(token)).resolves.toEqual(row);
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = true',
      [hash(token)],
    );
    expect(hash(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('caches successful lookups and clearKeyCache forces a new query', async () => {
    const token = 'sk_live_cached';
    const row = makeKeyInfo(hash(token));
    query.mockResolvedValue([row]);

    await lookupApiKey(token);
    await lookupApiKey(token);
    expect(query).toHaveBeenCalledTimes(1);

    clearKeyCache();
    await lookupApiKey(token);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns null for an empty result or query failure', async () => {
    query.mockResolvedValueOnce([]);
    await expect(lookupApiKey('missing')).resolves.toBeNull();

    query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(lookupApiKey('broken')).resolves.toBeNull();
  });
});

describe('authenticate', () => {
  beforeEach(() => {
    query.mockReset();
    clearKeyCache();
  });

  it('rejects a missing Authorization header', async () => {
    const { reply, status, send } = makeReply();
    await expect(authenticate(makeRequest(), reply)).resolves.toBeNull();
    expect(status).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledWith({
      error: { type: 'authentication_error', message: 'Missing or invalid Authorization header' },
    });
  });

  it('rejects an unknown Bearer token', async () => {
    query.mockResolvedValueOnce([]);
    const { reply, status, send } = makeReply();

    await expect(authenticate(makeRequest('Bearer unknown'), reply)).resolves.toBeNull();
    expect(status).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledWith({
      error: { type: 'authentication_error', message: 'Invalid API key' },
    });
  });

  it('returns key info for a valid Bearer token', async () => {
    const token = 'sk_live_valid';
    const row = makeKeyInfo(hash(token));
    query.mockResolvedValueOnce([row]);
    const { reply, status } = makeReply();

    await expect(authenticate(makeRequest(`Bearer ${token}`), reply)).resolves.toEqual({ keyInfo: row });
    expect(status).not.toHaveBeenCalled();
  });
});
