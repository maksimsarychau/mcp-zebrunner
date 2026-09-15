import { buildRootSuiteInFilter } from './test-case-pagination.js';

/** Default batch size for `testSuite.id IN [...]` (matches getTestCasesByRootSuiteWithFilter). */
export const DEFAULT_SUITE_IN_BATCH_SIZE = 10;

/** Max suite IDs in a single IN clause before splitting into batches. */
export const MAX_SUITE_IDS_SINGLE_IN = 50;

export interface ProcessedSuiteRow {
  id: number;
  parentSuiteId?: number;
  rootSuiteId?: number;
}

export function findAllDescendantSuiteIds(
  parentId: number,
  processedSuites: ProcessedSuiteRow[],
): number[] {
  const descendants: number[] = [];
  const directChildren = processedSuites.filter((s) => s.parentSuiteId === parentId);

  for (const child of directChildren) {
    descendants.push(child.id);
    descendants.push(...findAllDescendantSuiteIds(child.id, processedSuites));
  }

  return descendants;
}

export function analyzeSuiteHierarchy(
  suiteId: number,
  processedSuites: ProcessedSuiteRow[],
  rootId: number,
): { isRootSuite: boolean; hasChildren: boolean } {
  return {
    isRootSuite: rootId === suiteId,
    hasChildren: processedSuites.some((s) => s.parentSuiteId === suiteId),
  };
}

/**
 * Suite IDs to scope test cases — mirrors adv_get_test_cases_by_suite_smart.
 * When includeSubSuites is false, only the direct suite id is returned.
 */
export function collectSubtreeSuiteIds(
  processedSuites: ProcessedSuiteRow[],
  suiteId: number,
  options: {
    includeSubSuites: boolean;
    isRootSuite: boolean;
    hasChildren: boolean;
  },
): number[] {
  if (!options.includeSubSuites) {
    return [suiteId];
  }

  if (!options.isRootSuite && !options.hasChildren) {
    return [suiteId];
  }

  const ids: number[] = [suiteId];

  if (options.isRootSuite) {
    for (const suite of processedSuites) {
      if (suite.rootSuiteId === suiteId && suite.id !== suiteId) {
        ids.push(suite.id);
      }
    }
  } else {
    ids.push(...findAllDescendantSuiteIds(suiteId, processedSuites));
  }

  return ids;
}

/** All suite ids under a Zebrunner root suite id (rootSuiteId field). */
export function collectZebrunnerRootSuiteIds(
  processedSuites: ProcessedSuiteRow[],
  rootSuiteId: number,
): number[] {
  const suiteIds: number[] = [];
  for (const suite of processedSuites) {
    if (suite.rootSuiteId === rootSuiteId) {
      suiteIds.push(suite.id);
    }
  }
  if (suiteIds.length === 0) {
    return [rootSuiteId];
  }
  return suiteIds;
}

export function buildTestSuiteIdInRql(suiteIds: number[]): string {
  if (suiteIds.length === 0) {
    return `testSuite.id = 0`;
  }
  if (suiteIds.length === 1) {
    return `testSuite.id=${suiteIds[0]}`;
  }
  return `testSuite.id IN [${suiteIds.join(',')}]`;
}

export function buildZebrunnerRootSuiteRql(
  processedSuites: ProcessedSuiteRow[],
  rootSuiteId: number,
): string {
  return buildRootSuiteInFilter(processedSuites, rootSuiteId);
}

export function shouldBatchSuiteInFilter(suiteIds: number[]): boolean {
  return suiteIds.length > MAX_SUITE_IDS_SINGLE_IN;
}

/**
 * Fetch test cases for many suite ids using smaller IN batches (deduped by id).
 */
export async function fetchTestCasesForSuiteIdsBatched<T extends { id?: number }>(
  suiteIds: number[],
  options: {
    batchSize?: number;
    fetchWithFilter: (filter: string) => Promise<T[]>;
  },
): Promise<T[]> {
  const batchSize = options.batchSize ?? DEFAULT_SUITE_IN_BATCH_SIZE;
  const seenIds = new Set<number>();
  const all: T[] = [];

  for (let i = 0; i < suiteIds.length; i += batchSize) {
    const batch = suiteIds.slice(i, i + batchSize);
    const filter = buildTestSuiteIdInRql(batch);
    const batchResults = await options.fetchWithFilter(filter);

    for (const item of batchResults) {
      const id = item.id;
      if (id != null) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      all.push(item);
    }

    if (i + batchSize < suiteIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return all;
}

/**
 * Count test cases across batched suite IN filters (full page walk per batch).
 */
export async function countTestCasesForSuiteIdsBatched(
  suiteIds: number[],
  options: {
    batchSize?: number;
    countWithFilter: (filter: string) => Promise<number>;
  },
): Promise<number> {
  const batchSize = options.batchSize ?? DEFAULT_SUITE_IN_BATCH_SIZE;
  let total = 0;

  for (let i = 0; i < suiteIds.length; i += batchSize) {
    const batch = suiteIds.slice(i, i + batchSize);
    const filter = buildTestSuiteIdInRql(batch);
    total += await options.countWithFilter(filter);

    if (i + batchSize < suiteIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return total;
}

export function collectNumericPageWarnings(
  page: number | undefined,
  pageToken: string | undefined,
  deprecatedMessage: string,
): string[] {
  if (pageToken) return [];
  if (page === undefined) return [];
  return [deprecatedMessage];
}

export function appendWarningsToText(text: string, warnings: string[]): string {
  if (warnings.length === 0) return text;
  return `${warnings.join('\n')}\n\n${text}`;
}
