import type { EnhancedZebrunnerClient } from '../../api/enhanced-client.js';
import type { ZebrunnerReportingClient } from '../../api/reporting-client.js';
import type { ZebrunnerShortTestCase } from '../../types/core.js';
import { fetchParsedCaseHistory, type AutomationStatesMap } from '../testCaseHistory.js';
import {
  historyEntriesToIndexedChanges,
  mergeIndexedChanges,
  removeCaseFromIndex,
} from './extract.js';
import { getIndexFilePath } from './paths.js';
import { getOrCreateHistoryIndex, loadHistoryIndex, saveHistoryIndex } from './store.js';
import type { BuildHistoryIndexOptions, BuildHistoryIndexResult, HistoryIndexData } from './types.js';

export interface HistoryIndexBuilderDeps {
  client: EnhancedZebrunnerClient;
  reportingClient: ZebrunnerReportingClient;
  debugLog?: (message: string, data?: Record<string, unknown>) => void;
}

const DEFAULT_BATCH = 150;
const DEFAULT_CONCURRENCY = 10;

function caseNeedsReindex(
  snapshot: { lastModifiedAt?: string } | undefined,
  testCase: ZebrunnerShortTestCase,
  forceRefresh: boolean,
): boolean {
  if (forceRefresh) return true;
  if (!snapshot) return true;
  return snapshot.lastModifiedAt !== testCase.lastModifiedAt;
}

async function indexCaseIntoStore(
  deps: HistoryIndexBuilderDeps,
  index: HistoryIndexData,
  projectId: number,
  testCase: ZebrunnerShortTestCase,
  statesMap: AutomationStatesMap,
  historyLimit: number,
): Promise<void> {
  const caseId = testCase.id!;
  removeCaseFromIndex(index.byField, caseId);

  const entries = await fetchParsedCaseHistory(
    deps.reportingClient,
    testCase,
    projectId,
    statesMap,
    historyLimit,
  );
  mergeIndexedChanges(index.byField, historyEntriesToIndexedChanges(testCase, entries));

  index.meta.caseSnapshots[String(caseId)] = {
    lastModifiedAt: testCase.lastModifiedAt,
    indexedAt: new Date().toISOString(),
  };
  index.meta.totalCasesIndexed = Object.keys(index.meta.caseSnapshots).length;
}

async function processBatch(
  deps: HistoryIndexBuilderDeps,
  index: HistoryIndexData,
  projectId: number,
  batch: ZebrunnerShortTestCase[],
  statesMap: AutomationStatesMap,
  historyLimit: number,
  concurrency: number,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(batch.length, 1)) },
    async () => {
      while (nextIndex < batch.length) {
        const i = nextIndex++;
        await indexCaseIntoStore(deps, index, projectId, batch[i]!, statesMap, historyLimit);
      }
    },
  );
  await Promise.all(workers);
}

export async function buildHistoryIndexBatch(
  deps: HistoryIndexBuilderDeps,
  options: BuildHistoryIndexOptions,
): Promise<BuildHistoryIndexResult> {
  const started = Date.now();
  const {
    projectKey,
    projectId,
    maxCasesPerBatch = DEFAULT_BATCH,
    historyLimit = 100,
    historyConcurrency = DEFAULT_CONCURRENCY,
    forceRefresh = false,
    continueBuild = true,
  } = options;

  const notes: string[] = [];
  let index = loadHistoryIndex(projectKey) ?? getOrCreateHistoryIndex(projectKey, projectId);

  if (index.meta.projectId !== projectId) {
    index = getOrCreateHistoryIndex(projectKey, projectId);
    notes.push('Rebuilt index — projectId changed.');
  }

  if (index.meta.complete && !forceRefresh && !continueBuild) {
    return {
      projectKey,
      complete: true,
      casesProcessedThisBatch: 0,
      totalCasesIndexed: index.meta.totalCasesIndexed,
      casesSkippedFresh: 0,
      durationMs: Date.now() - started,
      indexPath: getIndexFilePath(projectKey),
      notes: ['Index already complete — pass force_refresh=true to rebuild.'],
    };
  }

  if (!index.meta.buildCursor || index.meta.complete || forceRefresh) {
    index.meta.buildCursor = {
      pageToken: undefined,
      casesProcessedThisRun: 0,
      startedAt: new Date().toISOString(),
    };
    index.meta.complete = false;
    if (forceRefresh) {
      index.byField = {};
      index.meta.caseSnapshots = {};
      index.meta.totalCasesIndexed = 0;
    }
  }

  const statesMap: AutomationStatesMap = await (async () => {
    try {
      const states = await deps.reportingClient.getAutomationStates(projectId);
      return Object.fromEntries(states.map(s => [s.id, s.name]));
    } catch {
      return {};
    }
  })();

  let pageToken = index.meta.buildCursor.pageToken;
  let processedThisBatch = 0;
  let skippedFresh = 0;
  const toIndex: ZebrunnerShortTestCase[] = [];

  while (processedThisBatch < maxCasesPerBatch) {
    const response = await deps.client.getTestCases(projectKey, {
      size: 100,
      pageToken,
    });

    const pageItems = (response.items ?? []).filter(
      (tc): tc is ZebrunnerShortTestCase => tc.id != null && !tc.deleted,
    );

    for (const tc of pageItems) {
      const snapshot = index.meta.caseSnapshots[String(tc.id)];
      if (!caseNeedsReindex(snapshot, tc, forceRefresh)) {
        skippedFresh++;
        continue;
      }

      toIndex.push(tc);
      processedThisBatch++;
      index.meta.buildCursor.casesProcessedThisRun++;

      if (processedThisBatch >= maxCasesPerBatch) {
        break;
      }
    }

    if (toIndex.length > 0) {
      await processBatch(deps, index, projectId, toIndex, statesMap, historyLimit, historyConcurrency);
      toIndex.length = 0;
    }

    const nextToken = response._meta?.nextPageToken;

    if (processedThisBatch >= maxCasesPerBatch && nextToken) {
      pageToken = nextToken;
      index.meta.buildCursor.pageToken = pageToken;
      index.meta.lastIncrementalAt = new Date().toISOString();
      saveHistoryIndex(index);
      notes.push(
        `Partial build — indexed ${processedThisBatch} case(s) this batch ` +
        `(${index.meta.totalCasesIndexed} total). Call again with continue_build=true.`,
      );
      return {
        projectKey,
        complete: false,
        casesProcessedThisBatch: processedThisBatch,
        totalCasesIndexed: index.meta.totalCasesIndexed,
        casesSkippedFresh: skippedFresh,
        continueToken: 'continue',
        durationMs: Date.now() - started,
        indexPath: getIndexFilePath(projectKey),
        notes,
      };
    }

    if (!nextToken || pageItems.length === 0) {
      index.meta.complete = true;
      delete index.meta.buildCursor;
      index.meta.lastIncrementalAt = new Date().toISOString();
      notes.push(`Index build complete — ${index.meta.totalCasesIndexed} cases indexed.`);
      return {
        projectKey,
        complete: true,
        casesProcessedThisBatch: processedThisBatch,
        totalCasesIndexed: index.meta.totalCasesIndexed,
        casesSkippedFresh: skippedFresh,
        durationMs: Date.now() - started,
        indexPath: saveHistoryIndex(index),
        notes,
      };
    }

    pageToken = nextToken;
    index.meta.buildCursor.pageToken = pageToken;
  }

  index.meta.lastIncrementalAt = new Date().toISOString();
  saveHistoryIndex(index);
  notes.push('Batch limit reached with no further pages detected.');
  return {
    projectKey,
    complete: index.meta.complete,
    casesProcessedThisBatch: processedThisBatch,
    totalCasesIndexed: index.meta.totalCasesIndexed,
    casesSkippedFresh: skippedFresh,
    continueToken: index.meta.complete ? undefined : 'continue',
    durationMs: Date.now() - started,
    indexPath: getIndexFilePath(projectKey),
    notes,
  };
}

export async function refreshHistoryIndexIncremental(
  deps: HistoryIndexBuilderDeps,
  options: BuildHistoryIndexOptions,
): Promise<BuildHistoryIndexResult> {
  return buildHistoryIndexBatch(deps, { ...options, continueBuild: true, forceRefresh: false });
}
