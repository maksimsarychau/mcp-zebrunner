import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { deriveKey, encrypt, decrypt } from './crypto.js';

const TOKEN_KEY_SALT = 'mcp-zebrunner-token-store';

export interface TokenEntry {
  username: string;
  token: string;
  zebrunnerUrl?: string;
}

export interface TokenStore {
  get(email: string): Promise<TokenEntry | null>;
  set(email: string, data: TokenEntry): Promise<void>;
  delete(email: string): Promise<boolean>;
  list(): Promise<string[]>;
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
    this.key = deriveKey(encryptionKey, TOKEN_KEY_SALT);
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
    await writeFile(this.filePath, encrypted, { encoding: 'utf8', mode: 0o600 });
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
