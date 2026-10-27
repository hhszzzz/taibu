import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** AES-256-GCM ciphertext as stored in JSON columns; the additional data it was sealed with is never stored. */
export interface SealedSecret {
  version: 1;
  iv: string;
  tag: string;
  data: string;
}

export function isSealedSecret(value: unknown): value is SealedSecret {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const sealed = value as Record<string, unknown>;
  return sealed.version === 1 && typeof sealed.iv === 'string' && typeof sealed.tag === 'string' && typeof sealed.data === 'string';
}

/** A separate key per purpose (HKDF-SHA256), so one ciphertext family can never be opened as another. */
export function deriveSecretKey(master: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(info, 'utf8'), 32));
}

/** `aad` binds the ciphertext to where it is stored: moved to another row or field, it no longer opens. */
export function sealSecret(key: Buffer, secret: string, aad: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function openSecret(key: Buffer, value: SealedSecret, aad: string): string {
  if (value.version !== 1) throw new Error('SECRET_VERSION_UNSUPPORTED');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
}
