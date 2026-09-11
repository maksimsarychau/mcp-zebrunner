import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { FieldsLayout } from '../../src/api/reporting-client.js';
import {
  historyValuesMatch,
  normalizeHistoryCompareValue,
  resolveHistoryFieldPath,
  scanHistoryForFieldChanges,
} from '../../src/utils/field-history-search.js';
import type { HistoryEntry } from '../../src/utils/testCaseHistory.js';

const layout: FieldsLayout = {
  tabs: [],
  fields: [
    {
      id: 101,
      type: 'CUSTOM',
      tabId: 1,
      relativePosition: 1,
      name: 'Manual Only',
      enabled: true,
      dataType: 'boolean',
      description: null,
    },
    {
      id: 1,
      type: 'SYSTEM',
      tabId: 1,
      relativePosition: 2,
      name: 'Automation State',
      enabled: true,
      dataType: 'AUTOMATION_STATE',
      description: null,
    },
  ],
};

describe('field-history-search', () => {
  it('resolveHistoryFieldPath maps display names and paths', () => {
    assert.deepEqual(resolveHistoryFieldPath('Manual Only', layout), {
      historyField: 'customField.manualOnly',
      displayLabel: 'Manual Only',
    });
    assert.deepEqual(resolveHistoryFieldPath('customField.manualOnly', layout), {
      historyField: 'customField.manualOnly',
      displayLabel: 'customField.manualOnly',
    });
    assert.deepEqual(resolveHistoryFieldPath('automationState', layout), {
      historyField: 'automationState',
      displayLabel: 'automationState',
    });
  });

  it('normalizeHistoryCompareValue maps Yes/No and id:N', () => {
    assert.equal(normalizeHistoryCompareValue('Yes'), 'yes');
    assert.equal(normalizeHistoryCompareValue('id:1'), 'yes');
    assert.equal(normalizeHistoryCompareValue('No'), 'no');
    assert.equal(normalizeHistoryCompareValue('id:0'), 'no');
  });

  it('historyValuesMatch treats Yes and id:1 as equal', () => {
    assert.ok(historyValuesMatch('Yes', 'id:1'));
    assert.ok(historyValuesMatch('id:0', 'No'));
    assert.ok(!historyValuesMatch('Yes', 'No'));
    assert.ok(historyValuesMatch(undefined, 'anything'));
  });

  it('scanHistoryForFieldChanges filters by field, values, and date range', () => {
    const entries: HistoryEntry[] = [{
      entryId: 1,
      timestamp: '2026-08-02T16:33:23Z',
      author: 'imikulich',
      events: [],
      changes: [
        {
          field: 'customField.manualOnly',
          oldValue: 'Yes',
          newValue: 'No',
        },
        {
          field: 'automationState',
          oldValue: 'Not Automated',
          newValue: 'Semi-Automated',
        },
      ],
    }];

    const matches = scanHistoryForFieldChanges(entries, {
      historyField: 'customField.manualOnly',
      fromValue: 'Yes',
      toValue: 'No',
      changedAfter: new Date('2026-08-01T00:00:00Z'),
      changedBefore: new Date('2026-08-03T00:00:00Z'),
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0].author, 'imikulich');
    assert.equal(matches[0].concurrentChanges.length, 1);
    assert.equal(matches[0].concurrentChanges[0].field, 'automationState');
  });

  it('scanHistoryForFieldChanges excludes out-of-range timestamps', () => {
    const entries: HistoryEntry[] = [{
      entryId: 2,
      timestamp: '2025-01-01T00:00:00Z',
      author: 'user',
      events: [],
      changes: [{ field: 'customField.manualOnly', oldValue: 'Yes', newValue: 'No' }],
    }];

    const matches = scanHistoryForFieldChanges(entries, {
      historyField: 'customField.manualOnly',
      changedAfter: new Date('2026-01-01T00:00:00Z'),
    });

    assert.equal(matches.length, 0);
  });
});
