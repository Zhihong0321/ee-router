import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  hasValidSession,
  issueSessionToken,
  loginBlockedFor,
  parseCookies,
  recordLoginFailure,
  resetLoginThrottle,
  safeRedirectTarget,
  serializeSessionCookie,
  verifySessionToken,
} from '../../src/auth/session.js';

const originalEnv = { ...process.env };
const PASSWORD = 'correct-horse-battery';
const MONTH_MS = 30 * 24 * 3600 * 1000;

beforeEach(() => {
  resetLoginThrottle();
});

afterEach(() => {
  process.env = { ...originalEnv };
});

function requestWithCookie(cookie?: string): FastifyRequest {
  return { headers: cookie ? { cookie } : {} } as FastifyRequest;
}

describe('session tokens', () => {
  it('accepts a token it just issued', () => {
    const token = issueSessionToken(PASSWORD, MONTH_MS);
    expect(verifySessionToken(token, PASSWORD)).toBe(true);
  });

  it('still accepts the token just under the one-month expiry', () => {
    const now = 1_000_000;
    const token = issueSessionToken(PASSWORD, MONTH_MS, now);
    expect(verifySessionToken(token, PASSWORD, now + MONTH_MS - 1)).toBe(true);
  });

  it('rejects an expired token', () => {
    const now = 1_000_000;
    const token = issueSessionToken(PASSWORD, MONTH_MS, now);
    expect(verifySessionToken(token, PASSWORD, now + MONTH_MS + 1)).toBe(false);
  });

  it('rejects a token signed with a different password', () => {
    const token = issueSessionToken(PASSWORD, MONTH_MS);
    expect(verifySessionToken(token, 'rotated-password')).toBe(false);
  });

  it('rejects a tampered expiry', () => {
    const token = issueSessionToken(PASSWORD, MONTH_MS);
    const parts = token.split('.');
    parts[1] = String(Number(parts[1]) + MONTH_MS);
    expect(verifySessionToken(parts.join('.'), PASSWORD)).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(verifySessionToken('', PASSWORD)).toBe(false);
    expect(verifySessionToken('v1.123', PASSWORD)).toBe(false);
    expect(verifySessionToken('v2.9999999999999.abc.def', PASSWORD)).toBe(false);
  });
});

describe('hasValidSession', () => {
  it('is false when no password is configured', () => {
    delete process.env.ADMIN_PASSWORD;
    const token = issueSessionToken(PASSWORD, MONTH_MS);
    expect(hasValidSession(requestWithCookie(`${SESSION_COOKIE}=${token}`))).toBe(false);
  });

  it('is false without a cookie', () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    expect(hasValidSession(requestWithCookie())).toBe(false);
  });

  it('is true for a valid cookie', () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
    const token = issueSessionToken(PASSWORD, MONTH_MS);
    expect(hasValidSession(requestWithCookie(`other=1; ${SESSION_COOKIE}=${token}`))).toBe(true);
  });
});

describe('cookie helpers', () => {
  it('parses cookie headers', () => {
    expect(parseCookies('a=1; b=two%20words')).toEqual({ a: '1', b: 'two words' });
    expect(parseCookies(undefined)).toEqual({});
  });

  it('serializes a hardened cookie', () => {
    const cookie = serializeSessionCookie('abc', 2_592_000, true);
    expect(cookie).toContain(`${SESSION_COOKIE}=abc`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('Secure');
  });

  it('omits Secure outside production', () => {
    expect(serializeSessionCookie('abc', 60, false)).not.toContain('Secure');
  });

  it('expires the cookie on logout', () => {
    expect(clearSessionCookie(false)).toContain('Max-Age=0');
  });
});

describe('login throttling', () => {
  it('blocks after repeated failures and reports a retry delay', () => {
    for (let i = 0; i < 7; i += 1) recordLoginFailure('1.2.3.4');
    expect(loginBlockedFor('1.2.3.4')).toBe(0);
    recordLoginFailure('1.2.3.4');
    expect(loginBlockedFor('1.2.3.4')).toBeGreaterThan(0);
  });

  it('tracks each address separately and expires the window', () => {
    const now = 1_000_000;
    for (let i = 0; i < 8; i += 1) recordLoginFailure('1.2.3.4', now);
    expect(loginBlockedFor('5.6.7.8', now)).toBe(0);
    expect(loginBlockedFor('1.2.3.4', now + 16 * 60_000)).toBe(0);
  });
});

describe('safeRedirectTarget', () => {
  it('keeps same-origin paths', () => {
    expect(safeRedirectTarget('/logs?page=2')).toBe('/logs?page=2');
  });

  it('rejects off-site targets', () => {
    expect(safeRedirectTarget('https://evil.test')).toBe('/');
    expect(safeRedirectTarget('//evil.test')).toBe('/');
    expect(safeRedirectTarget(undefined)).toBe('/');
  });
});
