import { createHash, timingSafeEqual } from 'node:crypto';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';

function equalSecret(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

export async function authenticateAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const expected = loadEnv().ADMIN_API_KEY;
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!expected || !token || !equalSecret(token, expected)) {
    await reply.status(401).send({ error: { type: 'authentication_error', message: 'Invalid admin credentials' } });
  }
}
