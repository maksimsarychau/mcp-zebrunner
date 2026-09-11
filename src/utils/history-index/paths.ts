import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const INDEX_DIR_ENV = 'ZEBRUNNER_HISTORY_INDEX_DIR';

export function getHistoryIndexRoot(): string {
  const override = process.env[INDEX_DIR_ENV]?.trim();
  if (override) return override;
  return path.join(os.homedir(), '.mcp-zebrunner', 'history-index');
}

export function getProjectIndexDir(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return path.join(getHistoryIndexRoot(), safe);
}

export function getIndexFilePath(projectKey: string): string {
  return path.join(getProjectIndexDir(projectKey), 'index.json');
}

export function ensureProjectIndexDir(projectKey: string): string {
  const dir = getProjectIndexDir(projectKey);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
