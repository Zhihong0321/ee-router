import { type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { query } from '../db/pool.js';

export interface ApiKeyInfo {
  id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  description: string;
  is_active: boolean;
  rate_limit: number;
  allowed_ips: string[];
  created_at: Date;
}

// Cache key lookups to reduce DB pressure
const keyCache = new Map<string, { info: ApiKeyInfo; expiresAt: number }>();
const CACHE_TTL = 5_000; // 5 seconds

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function lookupApiKey(bearerToken: string): Promise<ApiKeyInfo | null> {
  const keyHash = hashKey(bearerToken);
  const cached = keyCache.get(keyHash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.info;
  }

  try {
    const rows = await query<ApiKeyInfo>(
      'SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = true',
      [keyHash]
    );
    const info = rows[0] ?? null;
    if (info) {
      keyCache.set(keyHash, { info, expiresAt: Date.now() + CACHE_TTL });
    }
    return info;
  } catch {
    return null;
  }
}

export function clearKeyCache(): void {
  keyCache.clear();
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ keyInfo: ApiKeyInfo } | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    await reply.status(401).send({
      error: { type: 'authentication_error', message: 'Missing or invalid Authorization header' },
    });
    return null;
  }

  const token = authHeader.slice(7);
  const keyInfo = await lookupApiKey(token);
  if (!keyInfo) {
    await reply.status(401).send({
      error: { type: 'authentication_error', message: 'Invalid API key' },
    });
    return null;
  }

  return { keyInfo };
}