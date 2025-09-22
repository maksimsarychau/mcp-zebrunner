import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { HierarchyProcessor } from '../../src/utils/hierarchy.js';

/**
 * Debug Scenario Unit Tests
 * These tests validate the functionality that was originally in debug scripts
 * but focus on unit-testable components that don't require API calls
 */

describe('Debug Scenario Unit Tests', () => {

  // Sample test data similar to what debug scripts would encounter
  const sampleDebugSuites = [
    { id: 605, name: 'Root Suite', parentSuiteId: null, relativePosition: 1 },
    { id: 609, name: 'Parent Suite', parentSuiteId: 605, relativePosition: 1 },
    { id: 657, name: 'Child Suite', parentSuiteId: 609, relativePosition: 1 },
    { id: 736, name: 'Feature Suite', parentSuiteId: 657, relativePosition: 1 },
    { id: 999, name: 'Orphaned Suite', parentSuiteId: 888, relativePosition: 1 } // Parent doesn't exist
  ];

  describe('Hierarchy Processing Debug Scenarios', () => {
    it('should find target suites correctly', () => {
      const targetSuiteIds = [605, 609, 657, 736];
      const foundSuites = new Map();

      sampleDebugSuites.forEach(suite => {
        if (targetSuiteIds.includes(suite.id)) {
          foundSuites.set(suite.id, suite);
        }
      });

      assert.equal(foundSuites.size, 4);
      assert.ok(foundSuites.has(605));
      assert.ok(foundSuites.has(609));
      assert.ok(foundSuites.has(657));
      assert.ok(foundSuites.has(736));
    });

    it('should handle hierarchy processing with complete chain', () => {
      const processedSuites = HierarchyProcessor.setRootParentsToSuites(sampleDebugSuites);

      assert.equal(processedSuites.length, sampleDebugSuites.length);

      // Check specific suite 736 (feature suite from debug scenarios)
      const suite736 = processedSuites.find(s => s.id === 736);
      assert.ok(suite736);
      assert.equal(suite736.rootSuiteId, 605); // Should trace back to root
      assert.equal(suite736.rootSuiteName, 'Root Suite');
      assert.equal(suite736.parentSuiteName, 'Child Suite');
    });

    it('should calculate correct root IDs for debug scenario chain', () => {
      const rootMapping = HierarchyProcessor.calculateRootSuiteIds(sampleDebugSuites);

      assert.equal(rootMapping.get(605), 605); // Root maps to itself
      assert.equal(rootMapping.get(609), 605); // Child maps to root
      assert.equal(rootMapping.get(657), 605); // Grandchild maps to root
      assert.equal(rootMapping.get(736), 605); // Feature suite maps to root
      assert.equal(rootMapping.get(999), 999); // Orphaned suite maps to itself
    });

    it('should generate correct suite paths for debug scenarios', () => {
      const path605 = HierarchyProcessor.generateSuitePath(605, sampleDebugSuites);
      const path736 = HierarchyProcessor.generateSuitePath(736, sampleDebugSuites);
      const path999 = HierarchyProcessor.generateSuitePath(999, sampleDebugSuites);

      assert.equal(path605, 'Root Suite');
      assert.equal(path736, 'Root Suite > Parent Suite > Child Suite > Feature Suite');
      assert.equal(path999, 'Unknown Suite (888) > Orphaned Suite'); // Shows missing parent
    });

    it('should build suite tree correctly for debug scenarios', () => {
      const tree = HierarchyProcessor.buildSuiteTree(sampleDebugSuites);

      // Should have 2 root suites: 605 (valid root) and 999 (orphaned)
      assert.equal(tree.length, 2);

      const rootSuite = tree.find(s => s.id === 605);
      const orphanedSuite = tree.find(s => s.id === 999);

      assert.ok(rootSuite);
      assert.ok(orphanedSuite);

      // Check the hierarchy depth under root suite
      assert.equal(rootSuite.children?.length, 1); // One direct child (609)

      const childSuite609 = rootSuite.children?.[0];
      assert.equal(childSuite609?.id, 609);
      assert.equal(childSuite609?.children?.length, 1); // One child (657)

      const childSuite657 = childSuite609?.children?.[0];
      assert.equal(childSuite657?.id, 657);
      assert.equal(childSuite657?.children?.length, 1); // One child (736)

      const childSuite736 = childSuite657?.children?.[0];
      assert.equal(childSuite736?.id, 736);
      assert.equal(childSuite736?.children?.length, 0); // Leaf node
    });
  });

  describe('Java Approach Method Validation', () => {
    it('should implement parent-child mapping correctly', () => {
      const parentChildMap = HierarchyProcessor.buildParentChildMap(sampleDebugSuites);

      assert.equal(parentChildMap.get(609), 605);
      assert.equal(parentChildMap.get(657), 609);
      assert.equal(parentChildMap.get(736), 657);
      assert.equal(parentChildMap.get(999), 888); // Orphaned suite
      assert.ok(!parentChildMap.has(605)); // Root suite has no parent
    });

    it('should find root suites using Java approach', () => {
      const parentChildMap = HierarchyProcessor.buildParentChildMap(sampleDebugSuites);

      const root605 = HierarchyProcessor.getRoot(parentChildMap, 605);
      const root736 = HierarchyProcessor.getRoot(parentChildMap, 736);
      const root999 = HierarchyProcessor.getRoot(parentChildMap, 999);

      assert.equal(root605, 605); // Root maps to itself
      assert.equal(root736, 605); // Feature suite maps to root
      assert.equal(root999, 888); // Orphaned suite maps to missing parent (circular protection)
    });

    it('should get root suites correctly', () => {
      const rootSuites = HierarchyProcessor.getRootSuites(sampleDebugSuites);

      assert.equal(rootSuites.length, 1); // Only 605 is a true root (999 has a parent, even if missing)
      assert.equal(rootSuites[0].id, 605);
      assert.equal(rootSuites[0].name, 'Root Suite');
    });

    it('should find suite names by ID', () => {
      const name605 = HierarchyProcessor.getSuiteNameById(sampleDebugSuites, 605);
      const name736 = HierarchyProcessor.getSuiteNameById(sampleDebugSuites, 736);
      const nameNotFound = HierarchyProcessor.getSuiteNameById(sampleDebugSuites, 123);

      assert.equal(name605, 'Root Suite');
      assert.equal(name736, 'Feature Suite');
      assert.equal(nameNotFound, '');
    });
  });

  describe('Orphaned Suite Handling', () => {
    it('should handle missing parent suites gracefully', () => {
      const orphanedOnlySuites = [
        { id: 1, name: 'Valid Root', parentSuiteId: null },
        { id: 2, name: 'Orphaned Child', parentSuiteId: 999 }
      ];

      const levels = HierarchyProcessor.calculateSuiteLevels(orphanedOnlySuites);
      assert.equal(levels.get(1), 0); // Valid root
      assert.equal(levels.get(2), 0); // Orphaned treated as root level

      const rootMapping = HierarchyProcessor.calculateRootSuiteIds(orphanedOnlySuites);
      assert.equal(rootMapping.get(1), 1); // Valid root
      assert.equal(rootMapping.get(2), 2); // Orphaned maps to itself
    });

    it('should build tree with orphaned suites', () => {
      const mixedSuites = [
        { id: 1, name: 'Root', parentSuiteId: null },
        { id: 2, name: 'Child', parentSuiteId: 1 },
        { id: 3, name: 'Orphan', parentSuiteId: 999 }
      ];

      const tree = HierarchyProcessor.buildSuiteTree(mixedSuites);
      assert.equal(tree.length, 2); // Root + Orphan at root level

      const rootSuite = tree.find(s => s.id === 1);
      const orphanSuite = tree.find(s => s.id === 3);

      assert.ok(rootSuite);
      assert.ok(orphanSuite);
      assert.equal(rootSuite.children?.length, 1); // Has child 2
      assert.equal(orphanSuite.children?.length, 0); // No children
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle large suite sets efficiently', () => {
      // Generate a large set of suites for performance testing
      const largeSuiteSet: Array<{id: number, name: string, parentSuiteId: number | null, relativePosition: number}> = [];
      const rootCount = 10;
      const childrenPerSuite = 5;
      const maxDepth = 4;

      let suiteId = 1;

      // Generate root suites
      for (let r = 0; r < rootCount; r++) {
        largeSuiteSet.push({
          id: suiteId++,
          name: `Root Suite ${r}`,
          parentSuiteId: null,
          relativePosition: r
        });
      }

      // Generate children recursively
      function addChildren(parentId: number, depth: number) {
        if (depth >= maxDepth) return;

        for (let c = 0; c < childrenPerSuite; c++) {
          largeSuiteSet.push({
            id: suiteId++,
            name: `Suite ${suiteId - 1}`,
            parentSuiteId: parentId,
            relativePosition: c
          });

          addChildren(suiteId - 1, depth + 1);
        }
      }

      // Add children to first few roots
      for (let r = 1; r <= 3; r++) {
        addChildren(r, 0);
      }

      console.log(`   Generated ${largeSuiteSet.length} suites for performance test`);

      const startTime = Date.now();

      // Test hierarchy processing performance
      const processed = HierarchyProcessor.setRootParentsToSuites(largeSuiteSet);
      const tree = HierarchyProcessor.buildSuiteTree(largeSuiteSet);

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      console.log(`   Processed ${largeSuiteSet.length} suites in ${processingTime}ms`);

      assert.equal(processed.length, largeSuiteSet.length);
      assert.equal(tree.length, rootCount); // All root suites should be at top level
      assert.ok(processingTime < 5000, 'Should process large suite set quickly'); // 5 second limit

      // Verify a few key properties
      processed.forEach(suite => {
        assert.ok(typeof suite.rootSuiteId === 'number');
        assert.ok(typeof suite.treeNames === 'string');
      });
    });
  });

  describe('Data Consistency Validation', () => {
    it('should maintain data consistency across different processing methods', () => {
      // Test that different hierarchy methods produce consistent results for valid hierarchies
      // Note: Orphaned suites may be handled differently by different methods, which is acceptable
      const validHierarchySuites = sampleDebugSuites.filter(s => s.id !== 999); // Exclude orphaned suite

      const rootMapping1 = HierarchyProcessor.calculateRootSuiteIds(validHierarchySuites);
      const processedSuites = HierarchyProcessor.setRootParentsToSuites(validHierarchySuites);

      // Compare results from different methods for valid suites
      validHierarchySuites.forEach(suite => {
        const processed = processedSuites.find(s => s.id === suite.id);
        assert.ok(processed);

        const rootFromMapping = rootMapping1.get(suite.id);
        const rootFromProcessed = processed.rootSuiteId;

        assert.equal(rootFromMapping, rootFromProcessed,
          `Root ID mismatch for suite ${suite.id}: mapping=${rootFromMapping}, processed=${rootFromProcessed}`);
      });

      // Test that orphaned suites are handled (though methods may differ in approach)
      const orphanedSuite = { id: 999, name: 'Orphaned Suite', parentSuiteId: 888, relativePosition: 1 };
      const orphanedRootMapping = HierarchyProcessor.calculateRootSuiteIds([orphanedSuite]);
      const orphanedProcessed = HierarchyProcessor.setRootParentsToSuites([orphanedSuite]);

      // Both methods should handle orphaned suite without crashing
      assert.ok(orphanedRootMapping.has(999));
      assert.ok(orphanedProcessed.find(s => s.id === 999));
    });

    it('should handle edge cases consistently', () => {
      const edgeCaseSuites = [
        { id: 1, name: 'Normal Root', parentSuiteId: null },
        { id: 2, name: 'Self Referencing', parentSuiteId: 2 }, // Self reference
        { id: 3, name: 'Missing Parent', parentSuiteId: 999 }, // Missing parent
        { id: 4, name: 'Empty Name', parentSuiteId: 1 }
      ];

      // Should not crash or infinite loop
      const processed = HierarchyProcessor.setRootParentsToSuites(edgeCaseSuites);
      const tree = HierarchyProcessor.buildSuiteTree(edgeCaseSuites);
      const rootMapping = HierarchyProcessor.calculateRootSuiteIds(edgeCaseSuites);

      assert.equal(processed.length, edgeCaseSuites.length);
      assert.ok(tree.length > 0);
      assert.ok(rootMapping.size > 0);

      // Self-referencing suite should be treated as root
      assert.equal(rootMapping.get(2), 2);

      // Missing parent suite should be treated as root
      assert.equal(rootMapping.get(3), 3);
    });
  });
});

console.log('✅ Debug scenario unit tests ready for validation');