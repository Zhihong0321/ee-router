import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';

export const SESSION_COOKIE = 'eter_session';

const SESSION_VERSION = 'v1';

/** Compare two secrets without leaking length or content through timing. */
export function equalSecret(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

/**
 * Sessions are signed with a key derived from the password itself, so rotating
 * ADMIN_PASSWORD immediately invalidates every issued cookie.
 */
function signingKey(password: string): Buffer {
  return createHash('sha256').update(`${SESSION_VERSION}:${password}`).digest();
}

function sign(payload: string, password: string): string {
  return createHmac('sha256', signingKey(password)).update(payload).digest('hex');
}

export function issueSessionToken(password: string, ttlMs: number, now = Date.now()): string {
  const payload = `${SESSION_VERSION}.${now + ttlMs}.${randomUUID()}`;
  return `${payload}.${sign(payload, password)}`;
}

export function verifySessionToken(token: string, password: string, now = Date.now()): boolean {
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [version, expRaw, , signature] = parts;
  if (version !== SESSION_VERSION || !expRaw || !signature) return false;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now) return false;

  const payload = parts.slice(0, 3).join('.');
  return equalSecret(signature, sign(payload, password));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function serializeSessionCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return serializeSessionCookie('', 0, secure);
}

/** True when the request carries a valid, unexpired password session. */
export function hasValidSession(request: FastifyRequest): boolean {
  const password = loadEnv().ADMIN_PASSWORD;
  if (!password) return false;
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) return false;
  return verifySessionToken(token, password);
}

// --- Login throttling -------------------------------------------------------

interface Attempt {
  failures: number;
  resetAt: number;
}

const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 8;

export function loginBlockedFor(ip: string, now = Date.now()): number {
  const record = attempts.get(ip);
  if (!record) return 0;
  if (record.resetAt <= now) {
    attempts.delete(ip);
    return 0;
  }
  return record.failures >= MAX_FAILURES ? Math.ceil((record.resetAt - now) / 1000) : 0;
}

export function recordLoginFailure(ip: string, now = Date.now()): void {
  const record = attempts.get(ip);
  if (!record || record.resetAt <= now) {
    attempts.set(ip, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }
  record.failures += 1;
}

export function clearLoginFailures(ip: string): void {
  attempts.delete(ip);
}

export function resetLoginThrottle(): void {
  attempts.clear();
}

// --- Request helpers --------------------------------------------------------

/** Only same-origin absolute paths are accepted, so `next` cannot be an open redirect. */
export function safeRedirectTarget(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

export function wantsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept ?? '';
  return request.method === 'GET' && accept.includes('text/html');
}

export async function denyUnauthenticated(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (wantsHtml(request)) {
    await reply.redirect(`/login?next=${encodeURIComponent(request.url)}`, 302);
    return;
  }
  await reply
    .status(401)
    .send({ error: { type: 'authentication_error', message: 'Password session required' } });
}
