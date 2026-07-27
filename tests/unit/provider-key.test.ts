import { afterEach, describe, expect, it } from 'vitest';
import { decryptProviderKey, encryptProviderKey } from '../../src/security/provider-key.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('provider credential encryption', () => {
  it('round-trips credentials with AES-256-GCM', () => {
    process.env.NODE_ENV = 'test';
    process.env.PROVIDER_ENCRYPTION_KEY = '01'.repeat(32);

    const result = encryptProviderKey('upstream-secret');

    expect(result.encrypted).not.toContain('upstream-secret');
    expect(result.iv).not.toBe('plaintext');
    expect(decryptProviderKey(result.encrypted, result.iv)).toBe('upstream-secret');
  });

  it('rejects legacy plaintext credentials in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
    process.env.ADMIN_API_KEY = 'a'.repeat(32);
    process.env.PROVIDER_ENCRYPTION_KEY = '02'.repeat(32);

    expect(() => decryptProviderKey('legacy-secret', '0')).toThrow('must be re-encrypted');
  });
});
