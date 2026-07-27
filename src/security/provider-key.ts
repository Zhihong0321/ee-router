import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { loadEnv } from '../config/env.js';

export interface EncryptedProviderKey {
  encrypted: string;
  iv: string;
}

function getKey(): Buffer | null {
  const value = loadEnv().PROVIDER_ENCRYPTION_KEY;
  return value ? Buffer.from(value, 'hex') : null;
}

export function encryptProviderKey(value: string): EncryptedProviderKey {
  const key = getKey();
  if (!key) {
    if (loadEnv().NODE_ENV === 'production') throw new Error('PROVIDER_ENCRYPTION_KEY is required');
    return { encrypted: value, iv: 'plaintext' };
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    encrypted: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

export function decryptProviderKey(encrypted: string, ivValue: string): string {
  if (ivValue === '0' || ivValue === 'plaintext') {
    if (loadEnv().NODE_ENV === 'production') {
      throw new Error('Legacy plaintext provider credentials must be re-encrypted before production deploy');
    }
    return encrypted;
  }
  const key = getKey();
  if (!key) throw new Error('PROVIDER_ENCRYPTION_KEY is required to decrypt provider credentials');

  const payload = Buffer.from(encrypted, 'base64');
  const authTag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(0, payload.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
