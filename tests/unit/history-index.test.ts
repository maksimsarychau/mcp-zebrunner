import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  historyEntriesToIndexedChanges,
  mergeIndexedChanges,
  queryHistoryIndex,
  removeCaseFromIndex,
} from '../../src/utils/history-index/index.js';
import type { HistoryIndexData } from '../../src/utils/history-index/types.js';
import type { HistoryEntry } from '../../src/utils/testCaseHistory.js';

describe('history-index', () => {
  it('extracts and queries field changes', () => {
    const entries: HistoryEntry[] = [{
      entryId: 1,
      timestamp: '2026-08-02T16:33:23Z',
      author: 'author.a',
      events: [],
      changes: [
        { field: 'customField.manualOnly', oldValue: 'Yes', newValue: 'No' },
        { field: 'automationState', oldValue: 'Not Automated', newValue: 'Semi-Automated' },
      ],
    }];

    const rows = historyEntriesToIndexedChanges(
      {
        id: 112,
        key: 'MFPAND-206',
        title: 'Sample',
        testSuite: { id: 999, title: 'Suite' },
        automationState: { id: 1, name: 'Semi-Automated' },
      } as any,
      entries,
    );

    assert.equal(rows.length, 2);

    const index: HistoryIndexData = {
      meta: {
        version: 1,
        projectKey: 'MFPAND',
        projectId: 7,
        builtAt: '2026-09-11T00:00:00Z',
        lastIncrementalAt: '2026-09-11T00:00:00Z',
        complete: true,
        totalCasesIndexed: 1,
        caseSnapshots: {},
      },
      byField: {},
    };
    mergeIndexedChanges(index.byField, rows);

    const result = queryHistoryIndex(index, {
      historyField: 'customField.manualOnly',
      fromValue: 'Yes',
      toValue: 'No',
      changedAfter: new Date('2026-07-13T00:00:00Z'),
      maxResults: 10,
      includeCaseSummary: true,
    });

    assert.equal(result.matchCount, 1);
    assert.equal(result.matches[0].key, 'MFPAND-206');
    assert.equal(result.matches[0].concurrentChanges.length, 1);
  });

  it('returns the N most recent matches when maxResults is smaller than total', () => {
    const index: HistoryIndexData = {
      meta: {
        version: 1,
        projectKey: 'MFPAND',
        projectId: 7,
        builtAt: '2026-09-11T00:00:00Z',
        lastIncrementalAt: '2026-09-11T00:00:00Z',
        complete: true,
        totalCasesIndexed: 3,
        caseSnapshots: {},
      },
      byField: {
        automationState: [
          {
            caseId: 1,
            caseKey: 'A-1',
            timestamp: '2026-01-01T00:00:00Z',
            author: 'old',
            field: 'automationState',
            oldValue: 'Not Automated',
            newValue: 'Automated',
            concurrentChanges: [],
          },
          {
            caseId: 2,
            caseKey: 'A-2',
            timestamp: '2026-06-01T00:00:00Z',
            author: 'mid',
            field: 'automationState',
            oldValue: 'Not Automated',
            newValue: 'Automated',
            concurrentChanges: [],
          },
          {
            caseId: 3,
            caseKey: 'A-3',
            timestamp: '2026-08-01T00:00:00Z',
            author: 'new',
            field: 'automationState',
            oldValue: 'Not Automated',
            newValue: 'Automated',
            concurrentChanges: [],
          },
        ],
      },
    };

    const result = queryHistoryIndex(index, {
      historyField: 'automationState',
      maxResults: 2,
      includeCaseSummary: false,
    });

    assert.equal(result.totalMatches, 3);
    assert.equal(result.matchCount, 2);
    assert.deepEqual(result.matches.map(m => m.key), ['A-3', 'A-2']);
  });

  it('removeCaseFromIndex drops all rows for a case', () => {
    const byField = {
      'customField.manualOnly': [
        { caseId: 1, caseKey: 'A-1', timestamp: 't', author: 'u', field: 'customField.manualOnly', oldValue: 'Yes', newValue: 'No', concurrentChanges: [] },
        { caseId: 2, caseKey: 'A-2', timestamp: 't', author: 'u', field: 'customField.manualOnly', oldValue: 'Yes', newValue: 'No', concurrentChanges: [] },
      ],
    };
    removeCaseFromIndex(byField, 1);
    assert.equal(byField['customField.manualOnly'].length, 1);
    assert.equal(byField['customField.manualOnly'][0].caseId, 2);
  });
});
