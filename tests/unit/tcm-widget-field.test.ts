import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { FieldsLayout } from '../../src/api/reporting-client.js';
import {
  expandSuiteIds,
  findFirstBooleanCustomField,
  findManualOnlyField,
  resolveDistributionField,
} from '../../src/utils/tcm-widget-field.js';

const layout: FieldsLayout = {
  tabs: [],
  fields: [
    { id: 1, type: 'SYSTEM', tabId: null, relativePosition: 0, name: 'Automation State', enabled: true, dataType: 'AUTOMATION_STATE', description: null },
    { id: 38, type: 'CUSTOM', tabId: 1, relativePosition: 1, name: 'Is Automated', enabled: true, dataType: 'boolean', description: null },
    { id: 99, type: 'CUSTOM', tabId: 1, relativePosition: 2, name: 'Manual Only', enabled: true, dataType: 'boolean', description: null },
  ],
};

describe('tcm-widget-field', () => {
  it('resolves system_field enum', () => {
    const r = resolveDistributionField({ system_field: 'AUTOMATION_STATE' }, layout);
    assert.deepEqual(r.filter, { field: { systemFieldDataType: 'AUTOMATION_STATE' } });
    assert.equal(r.fieldType, 'system');
  });

  it('resolves custom_field_id', () => {
    const r = resolveDistributionField({ custom_field_id: 38 }, layout);
    assert.deepEqual(r.filter, { field: { customFieldId: 38 } });
    assert.equal(r.fieldLabel, 'Is Automated');
  });

  it('resolves field name to custom id', () => {
    const r = resolveDistributionField({ field: 'Is Automated' }, layout);
    assert.equal(r.customFieldId, 38);
  });

  it('resolves Manual Only by name', () => {
    const r = resolveDistributionField({ field: 'Manual Only' }, layout);
    assert.equal(r.customFieldId, 99);
  });

  it('rejects multiple field specifiers', () => {
    assert.throws(
      () => resolveDistributionField({ field: 'X', system_field: 'PRIORITY' }, layout),
      /only one/i,
    );
  });

  it('expands root suite descendants', () => {
    const suites = [
      { id: 1, parentSuiteId: null, title: 'Root' } as any,
      { id: 2, parentSuiteId: 1, title: 'Child' } as any,
      { id: 3, parentSuiteId: 2, title: 'Grand' } as any,
    ];
    const ids = expandSuiteIds(suites, [1], [], true);
    assert.ok(ids.includes(1));
    assert.ok(ids.includes(2));
    assert.ok(ids.includes(3));
  });

  it('finds boolean custom field and Manual Only', () => {
    assert.equal(findFirstBooleanCustomField(layout)?.id, 38);
    assert.equal(findManualOnlyField(layout)?.id, 99);
  });
});
