import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  buildRootSuiteInFilter,
  fetchAllTestCasePages,
} from '../../src/utils/test-case-pagination.js';

describe('test-case-pagination', () => {
  it('fetchAllTestCasePages advances pageToken across pages', async () => {
    const pages = [
      { items: [{ id: 1 }, { id: 2 }], _meta: { nextPageToken: 'tok-2' } },
      { items: [{ id: 3 }], _meta: {} },
    ];
    let call = 0;

    const result = await fetchAllTestCasePages({
      fetchPage: async (pageToken) => {
        assert.equal(pageToken, call === 0 ? undefined : 'tok-2');
        return pages[call++] as any;
      },
    });

    assert.equal(result.items.length, 3);
    assert.equal(result.pagesTraversed, 2);
    assert.equal(result.stoppedReason, 'complete');
    assert.equal(result.hasMorePages, false);
  });

  it('fetchAllTestCasePages dedupes by id', async () => {
    const result = await fetchAllTestCasePages({
      fetchPage: async () => ({
        items: [{ id: 1 }, { id: 1 }, { id: 2 }],
        _meta: {},
      }),
      dedupeById: true,
    });

    assert.deepEqual(result.items.map((i) => i.id), [1, 2]);
  });

  it('buildRootSuiteInFilter includes all suites with matching rootSuiteId', () => {
    const suites = [
      { id: 10, rootSuiteId: 10 },
      { id: 11, rootSuiteId: 10 },
      { id: 99, rootSuiteId: 20 },
    ];
    assert.equal(
      buildRootSuiteInFilter(suites, 10),
      'testSuite.id IN [10,11]',
    );
  });

  it('buildRootSuiteInFilter falls back to direct suite when empty', () => {
    assert.equal(
      buildRootSuiteInFilter([{ id: 5, rootSuiteId: 99 }], 10),
      'testSuite.id = 10',
    );
  });
});
