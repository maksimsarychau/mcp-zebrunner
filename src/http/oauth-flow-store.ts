import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { deriveKey, encrypt, decrypt } from './crypto.js';

export const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
export const ISSUED_CODE_TTL_MS = 5 * 60 * 1000;

const OAUTH_FLOW_KEY_SALT = 'mcp-zebrunner-oauth-flow';
const STORE_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface OAuthPendingAuth {
  mcpClientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes?: string[];
  createdAt: number;
}

export interface OAuthRegisteredClientRecord {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  client_id_issued_at: number;
}

export interface OAuthFlowStore {
  setPending(stateKey: string, data: OAuthPendingAuth): Promise<void>;
  getPending(stateKey: string): Promise<OAuthPendingAuth | null>;
  deletePending(stateKey: string): Promise<void>;

  setIssuedCode(code: string, data: Record<string, unknown>): Promise<void>;
  takeIssuedCode<T extends Record<string, unknown>>(code: string): Promise<T | null>;

  setClient(clientId: string, client: OAuthRegisteredClientRecord): Promise<void>;
  getClient(clientId: string): Promise<OAuthRegisteredClientRecord | null>;

  sweepExpired(): Promise<void>;
}

export function sanitizeOAuthStoreKey(key: string): void {
  if (!STORE_KEY_PATTERN.test(key)) {
    throw new Error('Invalid OAuth flow store key');
  }
}

function isExpired(createdAt: number, ttlMs: number): boolean {
  return Date.now() - createdAt > ttlMs;
}

export class InMemoryOAuthFlowStore implements OAuthFlowStore {
  private pending = new Map<string, OAuthPendingAuth>();
  private codes = new Map<string, Record<string, unknown>>();
  private clients = new Map<string, OAuthRegisteredClientRecord>();

  async setPending(stateKey: string, data: OAuthPendingAuth): Promise<void> {
    sanitizeOAuthStoreKey(stateKey);
    this.pending.set(stateKey, data);
  }

  async getPending(stateKey: string): Promise<OAuthPendingAuth | null> {
    sanitizeOAuthStoreKey(stateKey);
    const val = this.pending.get(stateKey);
    if (!val) return null;
    if (isExpired(val.createdAt, PENDING_AUTH_TTL_MS)) {
      this.pending.delete(stateKey);
      return null;
    }
    return val;
  }

  async deletePending(stateKey: string): Promise<void> {
    sanitizeOAuthStoreKey(stateKey);
    this.pending.delete(stateKey);
  }

  async setIssuedCode(code: string, data: Record<string, unknown>): Promise<void> {
    sanitizeOAuthStoreKey(code);
    this.codes.set(code, data);
  }

  async takeIssuedCode<T extends Record<string, unknown>>(code: string): Promise<T | null> {
    sanitizeOAuthStoreKey(code);
    const val = this.codes.get(code) as T | undefined;
    if (!val) return null;
    this.codes.delete(code);
    const createdAt = val.createdAt as number | undefined;
    if (typeof createdAt === 'number' && isExpired(createdAt, ISSUED_CODE_TTL_MS)) {
      return null;
    }
    return val;
  }

  async setClient(clientId: string, client: OAuthRegisteredClientRecord): Promise<void> {
    sanitizeOAuthStoreKey(clientId);
    this.clients.set(clientId, client);
  }

  async getClient(clientId: string): Promise<OAuthRegisteredClientRecord | null> {
    sanitizeOAuthStoreKey(clientId);
    return this.clients.get(clientId) ?? null;
  }

  async sweepExpired(): Promise<void> {
    const now = Date.now();
    for (const [key, val] of this.pending) {
      if (now - val.createdAt > PENDING_AUTH_TTL_MS) this.pending.delete(key);
    }
    for (const [key, val] of this.codes) {
      const createdAt = val.createdAt as number | undefined;
      if (typeof createdAt === 'number' && now - createdAt > ISSUED_CODE_TTL_MS) {
        this.codes.delete(key);
      }
    }
  }
}

export class FileOAuthFlowStore implements OAuthFlowStore {
  private baseDir: string;
  private key: Buffer;

  constructor(baseDir: string, encryptionKey: string) {
    this.baseDir = baseDir;
    this.key = deriveKey(encryptionKey, OAUTH_FLOW_KEY_SALT);
  }

  private pathFor(subdir: 'pending' | 'codes' | 'clients', id: string): string {
    sanitizeOAuthStoreKey(id);
    const resolved = resolve(this.baseDir, subdir, `${id}.enc`);
    const base = resolve(this.baseDir);
    if (!resolved.startsWith(base + '/')) {
      throw new Error('Invalid store path');
    }
    return resolved;
  }

  private async writeEncrypted(filePath: string, payload: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const encrypted = encrypt(JSON.stringify(payload), this.key);
    await writeFile(filePath, encrypted, 'utf8');
  }

  private async readEncrypted<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(decrypt(raw, this.key)) as T;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async setPending(stateKey: string, data: OAuthPendingAuth): Promise<void> {
    await this.writeEncrypted(this.pathFor('pending', stateKey), data);
  }

  async getPending(stateKey: string): Promise<OAuthPendingAuth | null> {
    const filePath = this.pathFor('pending', stateKey);
    const val = await this.readEncrypted<OAuthPendingAuth>(filePath);
    if (!val) return null;
    if (isExpired(val.createdAt, PENDING_AUTH_TTL_MS)) {
      await unlink(filePath).catch(() => {});
      return null;
    }
    return val;
  }

  async deletePending(stateKey: string): Promise<void> {
    const filePath = this.pathFor('pending', stateKey);
    await unlink(filePath).catch((err: any) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  async setIssuedCode(code: string, data: Record<string, unknown>): Promise<void> {
    await this.writeEncrypted(this.pathFor('codes', code), data);
  }

  async takeIssuedCode<T extends Record<string, unknown>>(code: string): Promise<T | null> {
    const filePath = this.pathFor('codes', code);
    let val: T | null;
    try {
      const raw = await readFile(filePath, 'utf8');
      await unlink(filePath);
      val = JSON.parse(decrypt(raw, this.key)) as T;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    const createdAt = val.createdAt as number | undefined;
    if (typeof createdAt === 'number' && isExpired(createdAt, ISSUED_CODE_TTL_MS)) {
      return null;
    }
    return val;
  }

  async setClient(clientId: string, client: OAuthRegisteredClientRecord): Promise<void> {
    await this.writeEncrypted(this.pathFor('clients', clientId), client);
  }

  async getClient(clientId: string): Promise<OAuthRegisteredClientRecord | null> {
    return this.readEncrypted<OAuthRegisteredClientRecord>(this.pathFor('clients', clientId));
  }

  async sweepExpired(): Promise<void> {
    await this.sweepDir('pending', PENDING_AUTH_TTL_MS);
    await this.sweepDir('codes', ISSUED_CODE_TTL_MS);
  }

  private async sweepDir(subdir: 'pending' | 'codes', ttlMs: number): Promise<void> {
    const dir = join(this.baseDir, subdir);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    const now = Date.now();
    for (const name of names) {
      if (!name.endsWith('.enc')) continue;
      const filePath = join(dir, name);
      const val = await this.readEncrypted<{ createdAt?: number }>(filePath);
      if (!val) {
        await unlink(filePath).catch(() => {});
        continue;
      }
      const createdAt = val.createdAt;
      if (typeof createdAt === 'number' && now - createdAt > ttlMs) {
        await unlink(filePath).catch(() => {});
      }
    }
  }
}

export function createOAuthFlowStore(): OAuthFlowStore {
  const tokenPath = process.env.TOKEN_STORE_PATH;
  const storeKey = process.env.TOKEN_STORE_KEY;
  if (tokenPath && storeKey) {
    const dir = process.env.OAUTH_FLOW_STORE_DIR ?? join(dirname(tokenPath), 'oauth-flow');
    return new FileOAuthFlowStore(dir, storeKey);
  }
  return new InMemoryOAuthFlowStore();
}
