import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { extractChangeHistoryItems, parseRawChangeEntries } from '../../src/utils/testCaseHistory.js';

describe('testCaseHistory', () => {
  const statesMap = { 12: 'Semi-Automated', 10: 'Not Automated' };
  const userMap = new Map<number, string>([[42, 'test.author']]);

  const sampleEntry = {
    id: 9001,
    instant: '2026-08-02T16:33:23Z',
    userId: 42,
    type: 'LAYOUT_UPDATE',
    items: [],
  };

  it('extractChangeHistoryItems handles nested TCM response shapes', () => {
    assert.deepEqual(extractChangeHistoryItems([sampleEntry]), [sampleEntry]);
    assert.deepEqual(extractChangeHistoryItems({ items: [sampleEntry] }), [sampleEntry]);
    assert.deepEqual(extractChangeHistoryItems({ data: { items: [sampleEntry] } }), [sampleEntry]);
    assert.deepEqual(extractChangeHistoryItems({ content: [sampleEntry] }), [sampleEntry]);
    assert.deepEqual(extractChangeHistoryItems({}), []);
  });

  it('parses LAYOUT_UPDATE with customFields manualOnly and automationState', () => {
    const entries = parseRawChangeEntries(
      [{
        id: 9001,
        instant: '2026-08-02T16:33:23Z',
        userId: 42,
        type: 'LAYOUT_UPDATE',
        items: [
          {
            field: 'customFields',
            action: 'UPDATE',
            oldValue: { value: 'Yes', customField: { systemName: 'manualOnly', name: 'Manual Only' } },
            newValue: { value: 'No', customField: { systemName: 'manualOnly', name: 'Manual Only' } },
          },
          {
            field: 'automationState',
            action: 'UPDATE',
            oldValue: { id: 10, name: 'Not Automated' },
            newValue: { id: 12, name: 'Semi-Automated' },
          },
        ],
      }],
      statesMap,
      userMap,
      'all',
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0].author, 'test.author');
    const manualChange = entries[0].changes.find(c => c.field === 'customField.manualOnly');
    assert.ok(manualChange);
    assert.equal(manualChange!.oldValue, 'Yes');
    assert.equal(manualChange!.newValue, 'No');
    assert.ok(entries[0].events.includes('became_semi-automated'));
  });

  it('events_only keeps LAYOUT_UPDATE rows with automation lifecycle events', () => {
    const entries = parseRawChangeEntries(
      [{
        id: 1,
        instant: '2026-08-02T16:33:23Z',
        userId: 42,
        type: 'LAYOUT_UPDATE',
        items: [{
          field: 'automationState',
          action: 'UPDATE',
          oldValue: { id: 10 },
          newValue: { id: 12 },
        }],
      }],
      statesMap,
      userMap,
      'events_only',
    );

    assert.equal(entries.length, 1);
    assert.ok(entries[0].events.length > 0);
  });

  it('steps_only drops customFields-only LAYOUT_UPDATE rows', () => {
    const entries = parseRawChangeEntries(
      [{
        id: 2,
        instant: '2026-08-02T16:33:23Z',
        userId: 42,
        type: 'LAYOUT_UPDATE',
        items: [{
          field: 'customFields',
          action: 'UPDATE',
          oldValue: { value: 'Yes', customField: { systemName: 'manualOnly' } },
          newValue: { value: 'No', customField: { systemName: 'manualOnly' } },
        }],
      }],
      statesMap,
      userMap,
      'steps_only',
    );

    assert.equal(entries.length, 0);
  });
});
