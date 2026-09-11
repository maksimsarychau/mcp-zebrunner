import type { PagedResponse, ZebrunnerShortTestCase } from '../types/core.js';

export type FetchStoppedReason =
  | 'complete'
  | 'max_pages'
  | 'empty_page'
  | 'no_new_items';

export interface FetchAllTestCasePagesResult<T = ZebrunnerShortTestCase> {
  items: T[];
  pagesTraversed: number;
  hasMorePages: boolean;
  stoppedReason: FetchStoppedReason;
}

export interface FetchAllTestCasePagesOptions<T = ZebrunnerShortTestCase> {
  fetchPage: (pageToken: string | undefined, pageSize: number) => Promise<PagedResponse<T>>;
  pageSize?: number;
  maxPages?: number;
  dedupeById?: boolean;
  debugLog?: (message: string, data?: Record<string, unknown>) => void;
}

/**
 * Walk Public API test-case pages using pageToken (not numeric page offsets).
 */
export async function fetchAllTestCasePages<T extends { id?: number } = ZebrunnerShortTestCase>(
  options: FetchAllTestCasePagesOptions<T>,
): Promise<FetchAllTestCasePagesResult<T>> {
  const {
    fetchPage,
    pageSize = 100,
    maxPages = 100,
    dedupeById = true,
    debugLog,
  } = options;

  const allItems: T[] = [];
  const seenIds = dedupeById ? new Set<number>() : undefined;
  let pageToken: string | undefined = undefined;
  let pagesTraversed = 0;
  let stoppedReason: FetchStoppedReason = 'complete';

  while (pagesTraversed < maxPages) {
    const response = await fetchPage(pageToken, pageSize);
    const pageItems = response.items ?? [];
    pagesTraversed++;

    let newItems = pageItems;
    if (seenIds) {
      newItems = pageItems.filter((item) => {
        const id = item.id;
        if (id == null) return true;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });
    }

    allItems.push(...newItems);

    const nextToken = response._meta?.nextPageToken;
    debugLog?.('Fetched test case page', {
      pagesTraversed,
      pageSize: pageItems.length,
      newItems: newItems.length,
      total: allItems.length,
      hasNextPage: !!nextToken,
    });

    if (pageItems.length === 0) {
      stoppedReason = 'empty_page';
      break;
    }

    if (!nextToken) {
      stoppedReason = 'complete';
      break;
    }

    if (seenIds && newItems.length === 0) {
      stoppedReason = 'no_new_items';
      break;
    }

    pageToken = nextToken;
  }

  if (pagesTraversed >= maxPages && pageToken) {
    return {
      items: allItems,
      pagesTraversed,
      hasMorePages: true,
      stoppedReason: 'max_pages',
    };
  }

  return {
    items: allItems,
    pagesTraversed,
    hasMorePages: false,
    stoppedReason,
  };
}

/** Build RQL `testSuite.id IN [...]` for all suites under a root suite id. */
export function buildRootSuiteInFilter(
  processedSuites: Array<{ id: number; rootSuiteId?: number }>,
  rootSuiteId: number,
): string {
  const suiteIds: number[] = [];
  for (const suite of processedSuites) {
    if (suite.rootSuiteId === rootSuiteId) {
      suiteIds.push(suite.id);
    }
  }
  if (suiteIds.length === 0) {
    return `testSuite.id = ${rootSuiteId}`;
  }
  return `testSuite.id IN [${suiteIds.join(',')}]`;
}

export const DEPRECATED_PAGE_PARAM_WARNING =
  'The numeric "page" parameter is deprecated and ignored by the Zebrunner Public API. Use "page_token" from the previous response instead.';
