import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { HierarchyProcessor } from '../../src/utils/hierarchy.js';

describe('HierarchyProcessor', () => {
  const sampleSuites = [
    {
      id: 1,
      title: 'Root Suite 1',
      parentSuiteId: null,
      relativePosition: 1
    },
    {
      id: 2,
      title: 'Child Suite 1.1',
      parentSuiteId: 1,
      relativePosition: 1
    },
    {
      id: 3,
      title: 'Child Suite 1.2',
      parentSuiteId: 1,
      relativePosition: 2
    },
    {
      id: 4,
      title: 'Root Suite 2',
      parentSuiteId: null,
      relativePosition: 2
    },
    {
      id: 5,
      title: 'Grandchild Suite 1.1.1',
      parentSuiteId: 2,
      relativePosition: 1
    }
  ];

  describe('buildSuiteTree', () => {
    it('should build hierarchical tree from flat list', () => {
      const tree = HierarchyProcessor.buildSuiteTree(sampleSuites);
      
      assert.equal(tree.length, 2); // Two root suites
      
      const rootSuite1 = tree.find(s => s.id === 1);
      const rootSuite2 = tree.find(s => s.id === 4);
      
      assert.ok(rootSuite1);
      assert.ok(rootSuite2);
      assert.equal(rootSuite1.children?.length, 2); // Two child suites
      assert.equal(rootSuite2.children?.length, 0); // No children
    });

    it('should handle nested children correctly', () => {
      const tree = HierarchyProcessor.buildSuiteTree(sampleSuites);
      
      const rootSuite = tree.find(s => s.id === 1);
      const childSuite = rootSuite?.children?.find(s => s.id === 2);
      
      assert.ok(childSuite);
      assert.equal(childSuite.children?.length, 1); // One grandchild
      assert.equal(childSuite.children?.[0].id, 5);
    });

    it('should preserve original suite properties', () => {
      const tree = HierarchyProcessor.buildSuiteTree(sampleSuites);
      
      const suite = tree.find(s => s.id === 1);
      assert.equal(suite?.title, 'Root Suite 1');
      assert.equal(suite?.relativePosition, 1);
      assert.equal(suite?.parentSuiteId, null);
    });

    it('should handle empty input', () => {
      const tree = HierarchyProcessor.buildSuiteTree([]);
      assert.equal(tree.length, 0);
    });

    it('should handle orphaned suites', () => {
      const orphanedSuites = [
        { id: 1, title: 'Root', parentSuiteId: null, relativePosition: 1 },
        { id: 2, title: 'Orphan', parentSuiteId: 999, relativePosition: 1 } // Parent doesn't exist
      ];
      
      const tree = HierarchyProcessor.buildSuiteTree(orphanedSuites);
      
      assert.equal(tree.length, 2); // Both treated as roots
      assert.ok(tree.find(s => s.id === 1));
      assert.ok(tree.find(s => s.id === 2));
    });
  });

  describe('calculateRootSuiteIds', () => {
    it('should identify root suite IDs correctly', () => {
      const rootIds = HierarchyProcessor.calculateRootSuiteIds(sampleSuites);
      
      assert.equal(rootIds.size, 2);
      assert.ok(rootIds.has(1));
      assert.ok(rootIds.has(4));
    });

    it('should handle suites with no parent', () => {
      const suitesWithNulls = [
        { id: 1, parentSuiteId: null },
        { id: 2, parentSuiteId: undefined },
        { id: 3, parentSuiteId: 1 }
      ];
      
      const rootIds = HierarchyProcessor.calculateRootSuiteIds(suitesWithNulls);
      
      assert.equal(rootIds.size, 2);
      assert.ok(rootIds.has(1));
      assert.ok(rootIds.has(2));
    });

    it('should return empty set for empty input', () => {
      const rootIds = HierarchyProcessor.calculateRootSuiteIds([]);
      assert.equal(rootIds.size, 0);
    });
  });

  describe('generateSuitePath', () => {
    it('should generate correct path for root suite', () => {
      const path = HierarchyProcessor.generateSuitePath(1, sampleSuites);
      assert.equal(path, 'Root Suite 1');
    });

    it('should generate correct path for nested suite', () => {
      const path = HierarchyProcessor.generateSuitePath(5, sampleSuites);
      assert.equal(path, 'Root Suite 1 > Child Suite 1.1 > Grandchild Suite 1.1.1');
    });

    it('should handle missing suite', () => {
      const path = HierarchyProcessor.generateSuitePath(999, sampleSuites);
      assert.equal(path, 'Unknown Suite (999)');
    });

    it('should handle circular references gracefully', () => {
      const circularSuites = [
        { id: 1, title: 'Suite 1', parentSuiteId: 2 },
        { id: 2, title: 'Suite 2', parentSuiteId: 1 }
      ];
      
      const path = HierarchyProcessor.generateSuitePath(1, circularSuites);
      assert.ok(path.includes('Suite 1')); // Should not crash
    });

    it('should use fallback names for suites without titles', () => {
      const suitesWithoutTitles = [
        { id: 1, parentSuiteId: null },
        { id: 2, parentSuiteId: 1 }
      ];
      
      const path = HierarchyProcessor.generateSuitePath(2, suitesWithoutTitles);
      assert.equal(path, 'Suite 1 > Suite 2');
    });
  });

  describe('calculateSuiteLevels', () => {
    it('should calculate correct levels for hierarchy', () => {
      const levels = HierarchyProcessor.calculateSuiteLevels(sampleSuites);
      
      assert.equal(levels.get(1), 0); // Root level
      assert.equal(levels.get(4), 0); // Root level
      assert.equal(levels.get(2), 1); // First level child
      assert.equal(levels.get(3), 1); // First level child
      assert.equal(levels.get(5), 2); // Second level child
    });

    it('should handle orphaned suites', () => {
      const orphanedSuites = [
        { id: 1, parentSuiteId: null },
        { id: 2, parentSuiteId: 999 } // Parent doesn't exist
      ];
      
      const levels = HierarchyProcessor.calculateSuiteLevels(orphanedSuites);
      
      assert.equal(levels.get(1), 0);
      assert.equal(levels.get(2), 0); // Treated as root
    });

    it('should return empty map for empty input', () => {
      const levels = HierarchyProcessor.calculateSuiteLevels([]);
      assert.equal(levels.size, 0);
    });
  });

  describe('enrichSuitesWithHierarchy', () => {
    it('should add hierarchy metadata to suites', () => {
      const enriched = HierarchyProcessor.enrichSuitesWithHierarchy(sampleSuites);
      
      const rootSuite = enriched.find(s => s.id === 1);
      const childSuite = enriched.find(s => s.id === 2);
      const grandchildSuite = enriched.find(s => s.id === 5);
      
      assert.equal(rootSuite?.level, 0);
      assert.equal(rootSuite?.path, 'Root Suite 1');
      assert.equal(rootSuite?.rootSuiteId, 1);
      
      assert.equal(childSuite?.level, 1);
      assert.equal(childSuite?.path, 'Root Suite 1 > Child Suite 1.1');
      assert.equal(childSuite?.rootSuiteId, 1);
      
      assert.equal(grandchildSuite?.level, 2);
      assert.equal(grandchildSuite?.path, 'Root Suite 1 > Child Suite 1.1 > Grandchild Suite 1.1.1');
      assert.equal(grandchildSuite?.rootSuiteId, 1);
    });

    it('should preserve original suite properties', () => {
      const enriched = HierarchyProcessor.enrichSuitesWithHierarchy(sampleSuites);
      
      const originalSuite = sampleSuites.find(s => s.id === 1);
      const enrichedSuite = enriched.find(s => s.id === 1);
      
      assert.equal(enrichedSuite?.title, originalSuite?.title);
      assert.equal(enrichedSuite?.parentSuiteId, originalSuite?.parentSuiteId);
      assert.equal(enrichedSuite?.relativePosition, originalSuite?.relativePosition);
    });

    it('should handle empty input', () => {
      const enriched = HierarchyProcessor.enrichSuitesWithHierarchy([]);
      assert.equal(enriched.length, 0);
    });
  });

  describe('getSuiteDescendants', () => {
    it('should find all descendants of a suite', () => {
      const descendants = HierarchyProcessor.getSuiteDescendants(1, sampleSuites);
      
      assert.equal(descendants.length, 3); // 2 children + 1 grandchild
      
      const descendantIds = descendants.map(s => s.id);
      assert.ok(descendantIds.includes(2));
      assert.ok(descendantIds.includes(3));
      assert.ok(descendantIds.includes(5));
    });

    it('should return empty array for leaf suite', () => {
      const descendants = HierarchyProcessor.getSuiteDescendants(5, sampleSuites);
      assert.equal(descendants.length, 0);
    });

    it('should return empty array for non-existent suite', () => {
      const descendants = HierarchyProcessor.getSuiteDescendants(999, sampleSuites);
      assert.equal(descendants.length, 0);
    });

    it('should handle circular references', () => {
      const circularSuites = [
        { id: 1, parentSuiteId: 2 },
        { id: 2, parentSuiteId: 1 },
        { id: 3, parentSuiteId: 1 }
      ];
      
      const descendants = HierarchyProcessor.getSuiteDescendants(1, circularSuites);
      assert.ok(descendants.length > 0); // Should not crash or infinite loop
    });
  });

  describe('getSuiteAncestors', () => {
    it('should find all ancestors of a suite', () => {
      const ancestors = HierarchyProcessor.getSuiteAncestors(5, sampleSuites);
      
      assert.equal(ancestors.length, 2); // Parent and grandparent
      
      const ancestorIds = ancestors.map(s => s.id);
      assert.ok(ancestorIds.includes(1)); // Root
      assert.ok(ancestorIds.includes(2)); // Parent
    });

    it('should return empty array for root suite', () => {
      const ancestors = HierarchyProcessor.getSuiteAncestors(1, sampleSuites);
      assert.equal(ancestors.length, 0);
    });

    it('should return empty array for non-existent suite', () => {
      const ancestors = HierarchyProcessor.getSuiteAncestors(999, sampleSuites);
      assert.equal(ancestors.length, 0);
    });

    it('should handle orphaned suite', () => {
      const orphanedSuites = [
        { id: 1, parentSuiteId: null },
        { id: 2, parentSuiteId: 999 } // Parent doesn't exist
      ];
      
      const ancestors = HierarchyProcessor.getSuiteAncestors(2, orphanedSuites);
      assert.equal(ancestors.length, 0);
    });

    it('should handle circular references', () => {
      const circularSuites = [
        { id: 1, parentSuiteId: 2 },
        { id: 2, parentSuiteId: 1 }
      ];
      
      const ancestors = HierarchyProcessor.getSuiteAncestors(1, circularSuites);
      assert.ok(ancestors.length >= 0); // Should not crash or infinite loop
    });
  });
});
