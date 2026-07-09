import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  TCM_WIDGET_SYSTEM_NAMES,
  unwrapTcmWidgetItems,
} from '../../src/utils/tcm-widget-client.js';

describe('tcm-widget-client', () => {
  it('exports distribution widget system name', () => {
    assert.equal(TCM_WIDGET_SYSTEM_NAMES.DISTRIBUTION_BY_FIELD, 'test-cases-distribution-by-field');
  });

  it('unwraps items from envelope or array', () => {
    assert.deepEqual(unwrapTcmWidgetItems({ items: [{ label: 'A', value: 1 }] }), [{ label: 'A', value: 1 }]);
    assert.deepEqual(unwrapTcmWidgetItems([{ label: 'B', value: 2 }]), [{ label: 'B', value: 2 }]);
    assert.deepEqual(unwrapTcmWidgetItems({}), []);
  });
});
