import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeDiff, formatDiff, FieldDiff } from '../../src/helpers/diff.js';

describe('diff helper', () => {
  describe('computeDiff', () => {
    it('returns empty array when objects are identical', () => {
      const obj = { title: 'foo', id: 1 };
      const result = computeDiff(obj, { ...obj });
      assert.deepEqual(result, []);
    });

    it('detects a changed scalar value', () => {
      const before = { title: 'old', id: 1 };
      const after = { title: 'new', id: 1 };
      const result = computeDiff(before, after);
      assert.equal(result.length, 1);
      assert.equal(result[0].field, 'title');
      assert.equal(result[0].before, 'old');
      assert.equal(result[0].after, 'new');
    });

    it('detects a field added in after', () => {
      const before = { id: 1 };
      const after = { id: 1, description: 'desc' };
      const result = computeDiff(before, after);
      assert.equal(result.length, 1);
      assert.equal(result[0].field, 'description');
      assert.equal(result[0].before, undefined);
      assert.equal(result[0].after, 'desc');
    });

    it('detects a field removed in after', () => {
      const before = { id: 1, description: 'desc' };
      const after = { id: 1 };
      const result = computeDiff(before, after);
      assert.equal(result.length, 1);
      assert.equal(result[0].field, 'description');
      assert.equal(result[0].before, 'desc');
      assert.equal(result[0].after, undefined);
    });

    it('detects changes in nested objects', () => {
      const before = { priority: { id: 1, name: 'Low' } };
      const after = { priority: { id: 2, name: 'High' } };
      const result = computeDiff(before, after);
      assert.equal(result.length, 1);
      assert.equal(result[0].field, 'priority');
    });

    it('treats null and undefined as different', () => {
      const before = { val: null };
      const after = { val: undefined };
      const result = computeDiff(
        before as Record<string, unknown>,
        after as Record<string, unknown>,
      );
      assert.equal(result.length, 1);
    });

    it('handles both objects empty', () => {
      assert.deepEqual(computeDiff({}, {}), []);
    });
  });

  describe('formatDiff', () => {
    it('returns "No fields changed." for empty array', () => {
      assert.equal(formatDiff([]), 'No fields changed.');
    });

    it('formats a single diff line', () => {
      const diffs: FieldDiff[] = [{ field: 'title', before: 'a', after: 'b' }];
      const result = formatDiff(diffs);
      assert.ok(result.includes('title'));
      assert.ok(result.includes('"a"'));
      assert.ok(result.includes('"b"'));
      assert.ok(result.includes('→'));
    });

    it('formats multiple diff lines', () => {
      const diffs: FieldDiff[] = [
        { field: 'title', before: 'a', after: 'b' },
        { field: 'id', before: 1, after: 2 },
      ];
      const result = formatDiff(diffs);
      const lines = result.split('\n');
      assert.equal(lines.length, 2);
    });
  });
});
