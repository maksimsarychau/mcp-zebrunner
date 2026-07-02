import { dirname, join, resolve, sep } from 'node:path';

/** Returns true when `err` is a Node.js ENOENT filesystem error. */
export function isNodeEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/**
 * Resolve OAuth flow store directory safely relative to the token store file.
 * Rejects NUL bytes; relative `OAUTH_FLOW_STORE_DIR` must stay under the token directory.
 */
export function resolveSafeOAuthFlowStoreDir(tokenStorePath: string): string {
  const tokenDir = resolve(dirname(tokenStorePath));
  const raw = process.env.OAUTH_FLOW_STORE_DIR?.trim();

  if (!raw) {
    return join(tokenDir, 'oauth-flow');
  }

  if (raw.includes('\0')) {
    throw new Error('Invalid OAUTH_FLOW_STORE_DIR');
  }

  const resolved = raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)
    ? resolve(raw)
    : resolve(tokenDir, raw);

  const tokenDirWithSep = tokenDir.endsWith(sep) ? tokenDir : tokenDir + sep;
  if (resolved !== tokenDir && !resolved.startsWith(tokenDirWithSep)) {
    throw new Error('OAUTH_FLOW_STORE_DIR must be under the token store directory');
  }

  return resolved;
}
