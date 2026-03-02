import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// ========== AUTHOR PUBLIC KEY (REPLACE WITH YOURS ON FIRST SIGN-RELEASE) ==========
const PUBLIC_KEY_BASE64 = `LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQ0lqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FnOEFNSUlDQ2dLQ0FnRUFwZFY5cGU1V0lOaDFqNmJFYU5QRgp4Z2w0YzFHcDdvamVSQWowOVpDOHUvalNRNVRBbHg2S1ZKamVaTFA1eFRxOUlTTVlMN1ZaeFBhSFcxVHVrVXYyCjF3R01JQlJSQWRnMTduVXU1eHl0M1I5WmJVbm5Oam9jZHUrQkZDTkxYSlVHMlZvVVZaQzBreENmU3pYZTQ2NGYKTjRNY2dEQUVHcUxwVGhTZlpUYkJQS0MvYXJnWFYrdjRRS2pWVkR2ZldlNzhtcTZvdnlWampmcVFzYytiWW9taAprVjAyNC9xZStXRjdyYjQ0NGhmMkdzUU1Odk02N1dtYkJCTGZmZ1lQb2plKzNUYUd3SHJjbUpPZzRxbERNbXFhCkk5VmZtL3Z5K0N5ZG5CZkh3Sm8ybDBnRnBqaGxOb2JuRVYvUVlydFNDTnZvTHh3M3k5NFQ2OUNmZDRzQlRlZXoKSVVlRVVQMDVqZDNrNEFnQUhQWXFhckJoSGlIbVB2ZXpxUVJUMWtpeXlUOGdJM1JCcXZKUFYreVVKMFhkdWd4Zgpqcjl4aUs4eE1pYUN6U0IyVVh6L3RaQTQwdjR3SlpVKzQ2cFpVL29Qb2xkTm9HUWk0WkQzVGk2cDNUVmoyWGx6CnQvcnhUa21RL0ZORTdQMGpvTzNKeWNxUlZaSVNSaW0ydkJtSEpLYzBhM2pDQTlZR2VYTEZkZUZhQlNlb3V6aTcKVzkycHhJUTErZVFXUWoxd1dLcHdjUVg0VGZMaVRoWWQwYUNtdGVzQWh5UTFGaEFQNGV3aGlDQ01zYTN5NG5LcQpTeW1xZG8wdFZBdThSU3lKOFpxRnQwby9STmhtQTJUbUs0SkJXTEFFMThFcVRidlJWbVg5VkJSMGh3NWErbVVLCk5KSUtwVUQ5aThQQzAxbGpueVJRTG4wQ0F3RUFBUT09Ci0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo=`;

const ALLOWED_ORIGINS = [
  'https://github.com/maksimsarychau/mcp-zebrunner.git',
  'https://github.com/maksimsarychau/mcp-zebrunner',
  'git@github.com:maksimsarychau/mcp-zebrunner.git',
  'git@github.com:maksimsarychau/mcp-zebrunner',
];

const CONTROL_URL = 'https://raw.githubusercontent.com/maksimsarychau/mcp-zebrunner/master/.mcp-status';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const WHITELIST_PATTERNS = [
  'logs/',
  '.env',
  'config/',
  'data/',
  'node_modules/',
  '.git/',
  'dist/',
  '.integrity-signature',
  '.mcp-status',
  'docs/',
];

const WHITELIST_EXTENSIONS = ['.md'];

const GENERIC_ERROR = `Server initialization failed. Please reinstall from the official source:\nhttps://github.com/maksimsarychau/mcp-zebrunner`;

export function getProjectRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..');
}

function isWhitelisted(relPath: string): boolean {
  if (WHITELIST_EXTENSIONS.some(ext => relPath.endsWith(ext))) return true;
  return WHITELIST_PATTERNS.some(p => relPath === p.replace(/\/$/, '') || relPath.startsWith(p));
}

export async function getCoreFiles(root: string): Promise<string[]> {
  let files: string[];
  try {
    const output = execSync('git ls-files', { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    files = output.trim().split('\n').filter(Boolean);
  } catch {
    files = await walkDirectory(root, root);
  }
  return files.filter(f => !isWhitelisted(f)).sort();
}

async function walkDirectory(dir: string, root: string): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath);
      if (isWhitelisted(relPath)) continue;
      if (entry.isDirectory()) {
        result.push(...await walkDirectory(fullPath, root));
      } else {
        result.push(relPath);
      }
    }
  } catch { /* skip inaccessible directories */ }
  return result;
}

export async function getDistFiles(root: string): Promise<string[]> {
  const distDir = path.join(root, 'dist');
  const files = await walkDirectoryFlat(distDir, distDir);
  return files.map(f => path.join('dist', f)).sort();
}

async function walkDirectoryFlat(dir: string, root: string): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath);
      if (entry.isDirectory()) {
        result.push(...await walkDirectoryFlat(fullPath, root));
      } else {
        result.push(relPath);
      }
    }
  } catch { /* skip inaccessible directories */ }
  return result;
}

export async function computeHash(root: string, files: string[]): Promise<Buffer> {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const fullPath = path.join(root, file);
    try {
      const data = await fs.readFile(fullPath);
      hash.update(file);
      hash.update(data);
    } catch {
      hash.update(file);
      hash.update('__MISSING__');
    }
  }
  return hash.digest();
}

function verifySignatureWithKey(data: Buffer, signatureB64: string): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(PUBLIC_KEY_BASE64, 'base64'),
      format: 'pem',
      type: 'spki',
    });
    const verifier = crypto.createVerify('SHA256');
    verifier.update(data);
    return verifier.verify(publicKey, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

function verifyRepositoryOrigin(root: string): boolean {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return ALLOWED_ORIGINS.some(o => remoteUrl === o);
  } catch {
    return true;
  }
}

function getCacheFilePath(root: string): string {
  const hash = crypto.createHash('md5').update(root).digest('hex');
  return path.join(os.tmpdir(), `.mcp-zr-${hash}`);
}

function compareVersions(current: string, minimum: string): boolean {
  const parse = (v: string) => v.split('.').map(Number);
  const c = parse(current);
  const m = parse(minimum);
  for (let i = 0; i < 3; i++) {
    const cv = c[i] || 0;
    const mv = m[i] || 0;
    if (cv > mv) return true;
    if (cv < mv) return false;
  }
  return true;
}

async function getCurrentVersion(root: string): Promise<string> {
  try {
    const pkgPath = path.join(root, 'package.json');
    const data = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(data);
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

interface ControlPayload {
  status: string;
  minVersion: string;
  message: string;
  updatedAt: string;
}

interface ControlFile {
  payload: ControlPayload;
  signature: string;
}

interface CacheEntry extends ControlFile {
  cachedAt: string;
}

function isValidControlFile(data: unknown): data is ControlFile {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.signature !== 'string' || !obj.signature) return false;
  const p = obj.payload;
  if (!p || typeof p !== 'object') return false;
  const payload = p as Record<string, unknown>;
  return (
    typeof payload.status === 'string' &&
    typeof payload.minVersion === 'string' &&
    typeof payload.message === 'string' &&
    typeof payload.updatedAt === 'string'
  );
}

function fetchUrl(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let body = '';
      res.on('data', (chunk: Buffer | string) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function remoteHealthCheck(root: string): Promise<{ ok: boolean; message: string }> {
  const cacheFile = getCacheFilePath(root);
  const currentVersion = await getCurrentVersion(root);

  let controlData: ControlFile | null = null;

  try {
    const body = await fetchUrl(CONTROL_URL, 5000);
    const parsed: unknown = JSON.parse(body);
    if (isValidControlFile(parsed)) {
      controlData = parsed;
    }
  } catch {
    // Network failure - try cache
  }

  if (controlData) {
    const payloadStr = JSON.stringify(controlData.payload);
    const valid = verifySignatureWithKey(Buffer.from(payloadStr), controlData.signature);
    if (!valid) {
      return { ok: false, message: 'verification failed' };
    }

    // Cache the successful result
    try {
      const cacheEntry: CacheEntry = { ...controlData, cachedAt: new Date().toISOString() };
      await fs.writeFile(cacheFile, JSON.stringify(cacheEntry), 'utf-8');
    } catch { /* cache write failure is non-fatal */ }

    return evaluatePayload(controlData.payload, currentVersion);
  }

  // Network failed - check cache
  let cacheExists = false;
  try {
    const cacheData = await fs.readFile(cacheFile, 'utf-8');
    cacheExists = true;
    const cached: unknown = JSON.parse(cacheData);
    if (isValidControlFile(cached) && typeof (cached as CacheEntry).cachedAt === 'string') {
      const age = Date.now() - new Date((cached as CacheEntry).cachedAt).getTime();
      if (age < CACHE_TTL_MS) {
        return evaluatePayload(cached.payload, currentVersion);
      }
    }
  } catch { /* no cache or corrupt */ }

  // Local fallback ONLY if no cache has ever existed (pre-push / first-time setup).
  // Once a cache exists, the remote was previously reachable, so we must not
  // fall back to the local file -- this preserves the remote kill switch.
  if (!cacheExists) {
    try {
      const localPath = path.join(root, '.mcp-status');
      const localData = await fs.readFile(localPath, 'utf-8');
      const parsed: unknown = JSON.parse(localData);
      if (isValidControlFile(parsed)) {
        const localPayloadStr = JSON.stringify(parsed.payload);
        if (verifySignatureWithKey(Buffer.from(localPayloadStr), parsed.signature)) {
          return evaluatePayload(parsed.payload, currentVersion);
        }
      }
    } catch { /* no local file or corrupt */ }
  }

  return { ok: false, message: 'cannot verify' };
}

function evaluatePayload(payload: ControlPayload, currentVersion: string): { ok: boolean; message: string } {
  if (payload.status === 'disabled' || payload.status === 'maintenance') {
    return { ok: false, message: payload.message || 'unavailable' };
  }
  if (payload.status === 'active') {
    if (payload.minVersion && !compareVersions(currentVersion, payload.minVersion)) {
      return { ok: false, message: 'update required' };
    }
    return { ok: true, message: '' };
  }
  return { ok: false, message: 'unknown status' };
}

export async function stealthIntegrityCheck(): Promise<void> {
  const root = getProjectRoot();

  // If no signature file, skip silently (dev mode / pre-signing / npm without it)
  const sigPath = path.join(root, '.integrity-signature');
  let sigData: { version: number; source: string; dist: string };
  try {
    const raw = await fs.readFile(sigPath, 'utf-8');
    sigData = JSON.parse(raw);
  } catch {
    return; // No signature file - skip all checks
  }

  // Detect mode: source (git clone) vs dist (npm/Docker)
  const srcExists = await dirExists(path.join(root, 'src'));

  // Layer 1: Local integrity
  if (srcExists) {
    const files = await getCoreFiles(root);
    const hash = await computeHash(root, files);
    if (!verifySignatureWithKey(hash, sigData.source)) {
      console.error(GENERIC_ERROR);
      process.exit(1);
    }
  } else {
    const files = await getDistFiles(root);
    const hash = await computeHash(root, files);
    if (!verifySignatureWithKey(hash, sigData.dist)) {
      console.error(GENERIC_ERROR);
      process.exit(1);
    }
  }

  // Layer 2: Fork protection (git clone mode only)
  if (srcExists) {
    if (!verifyRepositoryOrigin(root)) {
      console.error(GENERIC_ERROR);
      process.exit(1);
    }
  }

  // Layer 3: Remote health check
  const health = await remoteHealthCheck(root);
  if (!health.ok) {
    console.error(GENERIC_ERROR);
    process.exit(1);
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
