import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  analyzeSuiteHierarchy,
  buildTestSuiteIdInRql,
  collectSubtreeSuiteIds,
  collectZebrunnerRootSuiteIds,
  findAllDescendantSuiteIds,
  shouldBatchSuiteInFilter,
  MAX_SUITE_IDS_SINGLE_IN,
} from '../../src/utils/suite-scope-filter.js';

const hierarchy = [
  { id: 63, parentSuiteId: undefined, rootSuiteId: 63 },
  { id: 64, parentSuiteId: 63, rootSuiteId: 63 },
  { id: 17441, parentSuiteId: 63, rootSuiteId: 63 },
  { id: 17442, parentSuiteId: 17441, rootSuiteId: 63 },
  { id: 99, parentSuiteId: 20, rootSuiteId: 20 },
];

describe('suite-scope-filter', () => {
  it('findAllDescendantSuiteIds walks parentSuiteId chain', () => {
    assert.deepEqual(findAllDescendantSuiteIds(17441, hierarchy), [17442]);
  });

  it('collectSubtreeSuiteIds without sub-suites returns single id', () => {
    const ids = collectSubtreeSuiteIds(hierarchy, 17441, {
      includeSubSuites: false,
      isRootSuite: false,
      hasChildren: true,
    });
    assert.deepEqual(ids, [17441]);
  });

  it('collectSubtreeSuiteIds with sub-suites includes descendants', () => {
    const ids = collectSubtreeSuiteIds(hierarchy, 17441, {
      includeSubSuites: true,
      isRootSuite: false,
      hasChildren: true,
    });
    assert.deepEqual(ids, [17441, 17442]);
  });

  it('collectZebrunnerRootSuiteIds gathers rootSuiteId matches', () => {
    const ids = collectZebrunnerRootSuiteIds(hierarchy, 63);
    assert.ok(ids.includes(63));
    assert.ok(ids.includes(64));
    assert.ok(ids.includes(17441));
    assert.ok(!ids.includes(99));
  });

  it('analyzeSuiteHierarchy detects children', () => {
    const { hasChildren, isRootSuite } = analyzeSuiteHierarchy(17441, hierarchy, 63);
    assert.equal(hasChildren, true);
    assert.equal(isRootSuite, false);
  });

  it('buildTestSuiteIdInRql formats single and IN', () => {
    assert.equal(buildTestSuiteIdInRql([5]), 'testSuite.id=5');
    assert.equal(buildTestSuiteIdInRql([5, 6]), 'testSuite.id IN [5,6]');
  });

  it('shouldBatchSuiteInFilter when over max', () => {
    const many = Array.from({ length: MAX_SUITE_IDS_SINGLE_IN + 1 }, (_, i) => i + 1);
    assert.equal(shouldBatchSuiteInFilter(many), true);
    assert.equal(shouldBatchSuiteInFilter([1, 2]), false);
  });
});
