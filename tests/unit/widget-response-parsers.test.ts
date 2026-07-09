import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertSqlRowsHaveKeys,
  distributionWithPercents,
  parseDistributionItems,
  parseLabeledValueItems,
  parseNetChangeItems,
} from '../../src/utils/widget-response-parsers.js';

const fixturesDir = path.join(process.cwd(), 'tests/fixtures/widgets');

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8'));
}

describe('widget-response-parsers', () => {
  it('parses TCM distribution fixture', () => {
    const items = parseDistributionItems(loadFixture('tcm-dist-automation-state.json'));
    assert.equal(items.length, 2);
    assert.equal(items[0].label, 'Yes');
  });

  it('parses net change fixture', () => {
    const items = parseNetChangeItems(loadFixture('tcm-net-change.json'));
    assert.equal(items[0].period, '2026-W01');
    assert.equal(items[0].valueFrom, 100);
  });

  it('parses tpl4 SQL rows', () => {
    const rows = loadFixture('tpl4-defects.json');
    assert.ok(assertSqlRowsHaveKeys(rows, ['DEFECT', 'FAILURES', '%']));
  });

  it('parses tpl8 week pie labels', () => {
    const rows = loadFixture('tpl8-week-pie.json') as Array<Record<string, unknown>>;
    assert.ok(rows.every(r => 'label' in r && 'value' in r));
  });

  it('computes distribution percents', () => {
    const withPct = distributionWithPercents([{ label: 'A', value: 75 }, { label: 'B', value: 25 }]);
    assert.equal(withPct[0].percent, 75);
    assert.equal(withPct[1].percent, 25);
  });

  it('parseLabeledValueItems from items envelope', () => {
    const items = parseLabeledValueItems({ items: [{ label: 'User1', value: 5 }] });
    assert.equal(items[0].value, 5);
  });
});
