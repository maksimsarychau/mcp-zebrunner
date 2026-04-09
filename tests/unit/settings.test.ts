import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  validateIdOrName,
  validateCustomFields,
  SettingsItem,
  CustomFieldDef,
} from '../../src/helpers/settings.js';

describe('settings validators', () => {
  const sampleItems: SettingsItem[] = [
    { id: 1, name: 'Manual', isDefault: true },
    { id: 2, name: 'Automated', isDefault: false },
    { id: 3, name: 'Not Automated', isDefault: false },
  ];

  describe('validateIdOrName', () => {
    it('accepts a valid id', () => {
      assert.doesNotThrow(() => validateIdOrName({ id: 1 }, sampleItems, 'automationState'));
    });

    it('accepts a valid name', () => {
      assert.doesNotThrow(() => validateIdOrName({ name: 'Automated' }, sampleItems, 'automationState'));
    });

    it('rejects an invalid id with a descriptive message', () => {
      assert.throws(
        () => validateIdOrName({ id: 999 }, sampleItems, 'automationState'),
        (err: Error) => {
          assert.ok(err.message.includes('Invalid automationState id: 999'));
          assert.ok(err.message.includes('1 (Manual)'));
          return true;
        },
      );
    });

    it('rejects an invalid name with a descriptive message', () => {
      assert.throws(
        () => validateIdOrName({ name: 'Unknown' }, sampleItems, 'priority'),
        (err: Error) => {
          assert.ok(err.message.includes('Invalid priority name: "Unknown"'));
          assert.ok(err.message.includes('Manual'));
          return true;
        },
      );
    });

    it('does nothing when neither id nor name is provided', () => {
      assert.doesNotThrow(() => validateIdOrName({}, sampleItems, 'test'));
    });
  });

  describe('validateCustomFields', () => {
    const sampleFieldDefs: CustomFieldDef[] = [
      {
        id: 1,
        systemName: 'manualOnly',
        name: 'Manual Only',
        enabled: true,
        dataType: 'DROPDOWN',
        valueDefinition: null,
      },
      {
        id: 2,
        systemName: 'testrailId',
        name: 'TestRail ID',
        enabled: true,
        dataType: 'STRING',
        valueDefinition: null,
      },
      {
        id: 3,
        systemName: 'dueDate',
        name: 'Due Date',
        enabled: true,
        dataType: 'DATE',
        valueDefinition: null,
      },
      {
        id: 4,
        systemName: 'tags',
        name: 'Tags',
        enabled: true,
        dataType: 'MULTI_SELECT',
        valueDefinition: null,
      },
      {
        id: 5,
        systemName: 'disabledField',
        name: 'Disabled',
        enabled: false,
        dataType: 'STRING',
        valueDefinition: null,
      },
      {
        id: 6,
        systemName: 'assignee',
        name: 'Assignee',
        enabled: true,
        dataType: 'USER',
        valueDefinition: null,
      },
    ];

    it('accepts valid STRING field', () => {
      assert.doesNotThrow(() =>
        validateCustomFields({ testrailId: 'TR-123' }, sampleFieldDefs),
      );
    });

    it('accepts valid DROPDOWN field', () => {
      assert.doesNotThrow(() =>
        validateCustomFields({ manualOnly: 'Yes' }, sampleFieldDefs),
      );
    });

    it('accepts valid DATE field', () => {
      assert.doesNotThrow(() =>
        validateCustomFields({ dueDate: '2026-04-08' }, sampleFieldDefs),
      );
    });

    it('accepts valid MULTI_SELECT field', () => {
      assert.doesNotThrow(() =>
        validateCustomFields({ tags: ['smoke', 'regression'] }, sampleFieldDefs),
      );
    });

    it('accepts valid USER field', () => {
      assert.doesNotThrow(() =>
        validateCustomFields({ assignee: { id: 1, email: 'a@b.com' } }, sampleFieldDefs),
      );
    });

    it('accepts null values (clearing a field)', () => {
      assert.doesNotThrow(() =>
        validateCustomFields({ testrailId: null }, sampleFieldDefs),
      );
    });

    it('rejects unknown systemName', () => {
      assert.throws(
        () => validateCustomFields({ unknown_field: 'value' }, sampleFieldDefs),
        (err: Error) => {
          assert.ok(err.message.includes('Unknown custom field systemName: "unknown_field"'));
          return true;
        },
      );
    });

    it('rejects disabled field', () => {
      assert.throws(
        () => validateCustomFields({ disabledField: 'val' }, sampleFieldDefs),
        (err: Error) => {
          assert.ok(err.message.includes('disabled'));
          return true;
        },
      );
    });

    it('rejects wrong type for STRING field', () => {
      assert.throws(
        () => validateCustomFields({ testrailId: 123 }, sampleFieldDefs),
        (err: Error) => {
          assert.ok(err.message.includes('must be a string'));
          return true;
        },
      );
    });

    it('rejects wrong format for DATE field', () => {
      assert.throws(
        () => validateCustomFields({ dueDate: 'April 8' }, sampleFieldDefs),
        (err: Error) => {
          assert.ok(err.message.includes('YYYY-MM-DD'));
          return true;
        },
      );
    });

    it('rejects non-array for MULTI_SELECT field', () => {
      assert.throws(
        () => validateCustomFields({ tags: 'single' }, sampleFieldDefs),
        (err: Error) => {
          assert.ok(err.message.includes('array of strings'));
          return true;
        },
      );
    });

    it('rejects USER field without required keys', () => {
      assert.throws(
        () => validateCustomFields({ assignee: { foo: 'bar' } }, sampleFieldDefs),
        (err: Error) => {
          assert.ok(err.message.includes('id, email, username'));
          return true;
        },
      );
    });

    it('handles empty customField object', () => {
      assert.doesNotThrow(() => validateCustomFields({}, sampleFieldDefs));
    });
  });
});
