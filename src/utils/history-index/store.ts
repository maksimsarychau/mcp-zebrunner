import * as fs from 'fs';
import {
  HISTORY_INDEX_VERSION,
  type HistoryIndexData,
  type HistoryIndexMeta,
} from './types.js';
import { ensureProjectIndexDir, getIndexFilePath } from './paths.js';

function emptyIndex(projectKey: string, projectId: number): HistoryIndexData {
  const now = new Date().toISOString();
  return {
    meta: {
      version: HISTORY_INDEX_VERSION,
      projectKey,
      projectId,
      builtAt: now,
      lastIncrementalAt: now,
      complete: false,
      totalCasesIndexed: 0,
      caseSnapshots: {},
    },
    byField: {},
  };
}

export function loadHistoryIndex(projectKey: string): HistoryIndexData | null {
  const filePath = getIndexFilePath(projectKey);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as HistoryIndexData;
    if (data.meta?.version !== HISTORY_INDEX_VERSION) return null;
    if (data.meta.projectKey !== projectKey) return null;
    data.byField ??= {};
    data.meta.caseSnapshots ??= {};
    return data;
  } catch {
    return null;
  }
}

export function saveHistoryIndex(data: HistoryIndexData): string {
  ensureProjectIndexDir(data.meta.projectKey);
  const filePath = getIndexFilePath(data.meta.projectKey);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
  fs.renameSync(tmp, filePath);
  return filePath;
}

export function getOrCreateHistoryIndex(projectKey: string, projectId: number): HistoryIndexData {
  return loadHistoryIndex(projectKey) ?? emptyIndex(projectKey, projectId);
}

export function isIndexUsable(meta: HistoryIndexMeta, projectId: number): boolean {
  return meta.complete && meta.projectId === projectId && meta.totalCasesIndexed > 0;
}
