import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export const AES_GCM_ALGORITHM = 'aes-256-gcm';
export const AES_KEY_LENGTH = 32;
export const AES_IV_LENGTH = 16;
export const AES_AUTH_TAG_LENGTH = 16;

export function deriveKey(secret: string, salt: string): Buffer {
  return scryptSync(secret, salt, AES_KEY_LENGTH);
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(AES_IV_LENGTH);
  const cipher = createCipheriv(AES_GCM_ALGORITHM, key, iv, { authTagLength: AES_AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string, key: Buffer): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, AES_IV_LENGTH);
  const authTag = buf.subarray(AES_IV_LENGTH, AES_IV_LENGTH + AES_AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(AES_IV_LENGTH + AES_AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(AES_GCM_ALGORITHM, key, iv, { authTagLength: AES_AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
