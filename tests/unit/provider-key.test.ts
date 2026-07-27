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

  it('allows plaintext credentials when encryption is not configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.PROVIDER_ENCRYPTION_KEY = 'not-a-valid-encryption-key';

    const result = encryptProviderKey('upstream-secret');

    expect(result).toEqual({ encrypted: 'upstream-secret', iv: 'plaintext' });
    expect(decryptProviderKey(result.encrypted, result.iv)).toBe('upstream-secret');
  });
});
