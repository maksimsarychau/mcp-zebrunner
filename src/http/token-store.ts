import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export interface TokenEntry {
  username: string;
  token: string;
}

export interface TokenStore {
  get(email: string): Promise<TokenEntry | null>;
  set(email: string, data: TokenEntry): Promise<void>;
  delete(email: string): Promise<boolean>;
  list(): Promise<string[]>;
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'mcp-zebrunner-token-store', KEY_LENGTH);
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(ciphertext: string, key: Buffer): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Encrypted file-based token store.
 * Stores per-user Zebrunner credentials keyed by Okta email, encrypted with AES-256-GCM.
 */
export class FileTokenStore implements TokenStore {
  private filePath: string;
  private key: Buffer;
  private data: Map<string, TokenEntry> = new Map();
  private loaded = false;

  constructor(filePath: string, encryptionKey: string) {
    this.filePath = filePath;
    this.key = deriveKey(encryptionKey);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const decrypted = decrypt(raw, this.key);
      const entries: Record<string, TokenEntry> = JSON.parse(decrypted);
      this.data = new Map(Object.entries(entries));
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.data = new Map();
      } else {
        throw err;
      }
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const obj: Record<string, TokenEntry> = Object.fromEntries(this.data);
    const encrypted = encrypt(JSON.stringify(obj), this.key);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, encrypted, 'utf8');
  }

  async get(email: string): Promise<TokenEntry | null> {
    await this.load();
    return this.data.get(email.toLowerCase()) ?? null;
  }

  async set(email: string, data: TokenEntry): Promise<void> {
    await this.load();
    this.data.set(email.toLowerCase(), data);
    await this.save();
  }

  async delete(email: string): Promise<boolean> {
    await this.load();
    const existed = this.data.delete(email.toLowerCase());
    if (existed) await this.save();
    return existed;
  }

  async list(): Promise<string[]> {
    await this.load();
    return [...this.data.keys()];
  }
}

export function createTokenStore(): TokenStore | null {
  const storePath = process.env.TOKEN_STORE_PATH;
  const storeKey = process.env.TOKEN_STORE_KEY;
  if (!storePath || !storeKey) return null;
  return new FileTokenStore(storePath, storeKey);
}
