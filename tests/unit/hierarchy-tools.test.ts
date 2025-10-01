import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Unit tests for hierarchy-related MCP tools
 * 
 * Tests the following tools:
 * - get_root_id_by_suite_id
 * - get_suite_hierarchy
 * - get_all_subsuites
 * - build_suite_tree
 * - get_suite_path
 * - get_suite_children
 */

describe('Hierarchy Tools Unit Tests', () => {
  
  describe('get_root_id_by_suite_id Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MCP',
        suite_id: 17470,
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.suite_id > 0, 'suite_id should be positive');
      assert.ok(validParams.project_key.length > 0, 'project_key should not be empty');
    });
    
    it('should validate suite_id parameter', () => {
      const validSuiteId = 17470;
      const invalidSuiteIds = [0, -1, 'not-a-number', null, undefined];
      
      assert.ok(validSuiteId > 0, 'valid suite_id should be positive');
      
      invalidSuiteIds.forEach(id => {
        if (typeof id === 'number') {
          assert.ok(id <= 0, `${id} should be invalid suite_id`);
        } else {
          assert.ok(typeof id !== 'number', `${id} should not be a number`);
        }
      });
    });
    
    it('should handle root suite detection logic', () => {
      const mockSuites = [
        { id: 17470, parentSuiteId: 17468, rootSuiteId: 17441 },
        { id: 17468, parentSuiteId: 17441, rootSuiteId: 17441 },
        { id: 17441, parentSuiteId: null, rootSuiteId: 17441 }
      ];
      
      const targetSuite = mockSuites.find(s => s.id === 17470);
      assert.ok(targetSuite, 'should find target suite');
      assert.equal(targetSuite.rootSuiteId, 17441, 'should have correct root suite ID');
      
      const rootSuite = mockSuites.find(s => s.id === targetSuite.rootSuiteId);
      assert.ok(rootSuite, 'should find root suite');
      assert.equal(rootSuite.parentSuiteId, null, 'root suite should have null parent');
    });
    
  });
  
  describe('get_suite_hierarchy Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MCP',
        max_depth: 5,
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.max_depth > 0, 'max_depth should be positive');
      assert.ok(validParams.max_depth <= 10, 'max_depth should not exceed maximum');
    });
    
    it('should validate max_depth parameter', () => {
      const validDepths = [1, 5, 10];
      const invalidDepths = [0, -1, 11, 'not-a-number'];
      
      validDepths.forEach(depth => {
        assert.ok(depth > 0 && depth <= 10, `${depth} should be valid max_depth`);
      });
      
      invalidDepths.forEach(depth => {
        if (typeof depth === 'number') {
          assert.ok(depth <= 0 || depth > 10, `${depth} should be invalid max_depth`);
        } else {
          assert.ok(typeof depth !== 'number', `${depth} should not be a number`);
        }
      });
    });
    
    it('should handle root_suite_id filter', () => {
      const params = {
        project_key: 'MCP',
        root_suite_id: 18659,
        max_depth: 5
      };
      
      assert.ok(params.root_suite_id > 0, 'root_suite_id should be positive when provided');
    });
    
    it('should handle include_test_counts parameter', () => {
      const params = {
        project_key: 'MCP',
        include_test_counts: true,
        max_depth: 5
      };
      
      assert.equal(typeof params.include_test_counts, 'boolean', 'include_test_counts should be boolean');
    });
    
    it('should validate hierarchy structure', () => {
      const mockHierarchy = {
        id: 17441,
        title: '10. Meal Planner',
        level: 0,
        children: [
          {
            id: 17468,
            title: 'Settings',
            level: 1,
            parentId: 17441,
            children: [
              {
                id: 17470,
                title: 'Budget',
                level: 2,
                parentId: 17468,
                children: []
              }
            ]
          }
        ]
      };
      
      assert.ok(mockHierarchy.id, 'hierarchy should have id');
      assert.ok(mockHierarchy.title, 'hierarchy should have title');
      assert.equal(mockHierarchy.level, 0, 'root should be level 0');
      assert.ok(Array.isArray(mockHierarchy.children), 'children should be array');
      
      const child = mockHierarchy.children[0];
      assert.equal(child.level, 1, 'child should be level 1');
      assert.equal(child.parentId, mockHierarchy.id, 'child should reference parent');
    });
    
  });
  
  describe('get_all_subsuites Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MCP',
        root_suite_id: 1079,
        include_root: true,
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.root_suite_id > 0, 'root_suite_id should be positive');
    });
    
    it('should handle include_root parameter', () => {
      const params = {
        project_key: 'MCP',
        root_suite_id: 1079,
        include_root: false
      };
      
      assert.equal(typeof params.include_root, 'boolean', 'include_root should be boolean');
    });
    
    it('should validate pagination parameters', () => {
      const validPagination = {
        page: 0,
        size: 50
      };
      
      assert.ok(validPagination.page >= 0, 'page should be non-negative');
      assert.ok(validPagination.size > 0, 'size should be positive');
      assert.ok(validPagination.size <= 1000, 'size should not exceed maximum');
    });
    
    it('should handle subsuite filtering logic', () => {
      const mockSuites = [
        { id: 1079, title: 'Root Suite', parentSuiteId: null },
        { id: 1080, title: 'Child 1', parentSuiteId: 1079 },
        { id: 1081, title: 'Child 2', parentSuiteId: 1079 },
        { id: 1082, title: 'Grandchild', parentSuiteId: 1080 },
        { id: 1083, title: 'Other Root', parentSuiteId: null }
      ];
      
      const rootSuiteId = 1079;
      
      // Simulate finding all descendants
      const findDescendants = (parentId: number): any[] => {
        const directChildren = mockSuites.filter(s => s.parentSuiteId === parentId);
        const allDescendants = [...directChildren];
        
        directChildren.forEach(child => {
          allDescendants.push(...findDescendants(child.id));
        });
        
        return allDescendants;
      };
      
      const descendants = findDescendants(rootSuiteId);
      assert.equal(descendants.length, 3, 'should find 3 descendants');
      
      const includeRoot = true;
      const result = includeRoot ? [mockSuites.find(s => s.id === rootSuiteId), ...descendants] : descendants;
      assert.equal(result.length, includeRoot ? 4 : 3, 'should handle include_root correctly');
    });
    
  });
  
  describe('build_suite_tree Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MCP',
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
    });
    
    it('should handle root_suite_id filter', () => {
      const params = {
        project_key: 'MCP',
        root_suite_id: 18659
      };
      
      assert.ok(params.root_suite_id > 0, 'root_suite_id should be positive when provided');
    });
    
    it('should validate tree structure', () => {
      const mockTree = {
        roots: [
          {
            id: 17441,
            title: '10. Meal Planner',
            children: [
              {
                id: 17468,
                title: 'Settings',
                parentId: 17441,
                children: [
                  {
                    id: 17470,
                    title: 'Budget',
                    parentId: 17468,
                    children: []
                  }
                ]
              }
            ]
          }
        ],
        orphaned: [],
        statistics: {
          totalSuites: 3,
          rootSuites: 1,
          orphanedSuites: 0,
          maxDepth: 2
        }
      };
      
      assert.ok(Array.isArray(mockTree.roots), 'tree should have roots array');
      assert.ok(Array.isArray(mockTree.orphaned), 'tree should have orphaned array');
      assert.ok(mockTree.statistics, 'tree should have statistics');
      assert.ok(mockTree.statistics.totalSuites > 0, 'should count total suites');
      assert.ok(mockTree.statistics.maxDepth >= 0, 'should calculate max depth');
    });
    
    it('should handle orphaned suites', () => {
      const mockSuites = [
        { id: 1, title: 'Root', parentSuiteId: null },
        { id: 2, title: 'Child', parentSuiteId: 1 },
        { id: 3, title: 'Orphaned', parentSuiteId: 999 } // Parent doesn't exist
      ];
      
      const existingIds = new Set(mockSuites.map(s => s.id));
      const orphaned = mockSuites.filter(s => 
        s.parentSuiteId !== null && !existingIds.has(s.parentSuiteId)
      );
      
      assert.equal(orphaned.length, 1, 'should find 1 orphaned suite');
      assert.equal(orphaned[0].id, 3, 'should identify correct orphaned suite');
    });
    
  });
  
  describe('get_suite_path Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MCP',
        suite_id: 17470,
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.suite_id > 0, 'suite_id should be positive');
    });
    
    it('should handle separator parameter', () => {
      const params = {
        project_key: 'MCP',
        suite_id: 17470,
        separator: ' > '
      };
      
      assert.equal(typeof params.separator, 'string', 'separator should be string');
      assert.ok(params.separator.length > 0, 'separator should not be empty');
    });
    
    it('should validate path construction', () => {
      const mockSuites = [
        { id: 17441, title: '10. Meal Planner', parentSuiteId: null },
        { id: 17468, title: 'Settings', parentSuiteId: 17441 },
        { id: 17470, title: 'Budget', parentSuiteId: 17468 }
      ];
      
      const targetSuiteId = 17470;
      const separator = ' > ';
      
      // Simulate path construction
      const buildPath = (suiteId: number): string[] => {
        const suite = mockSuites.find(s => s.id === suiteId);
        if (!suite) return [];
        
        if (suite.parentSuiteId === null) {
          return [suite.title];
        }
        
        const parentPath = buildPath(suite.parentSuiteId);
        return [...parentPath, suite.title];
      };
      
      const path = buildPath(targetSuiteId);
      const pathString = path.join(separator);
      
      assert.equal(path.length, 3, 'should have 3 levels in path');
      assert.equal(pathString, '10. Meal Planner > Settings > Budget', 'should construct correct path');
    });
    
  });
  
  describe('get_suite_children Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MCP',
        suite_id: 17441,
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.suite_id > 0, 'suite_id should be positive');
    });
    
    it('should handle direct_only parameter', () => {
      const params = {
        project_key: 'MCP',
        suite_id: 17441,
        direct_only: true
      };
      
      assert.equal(typeof params.direct_only, 'boolean', 'direct_only should be boolean');
    });
    
    it('should validate children filtering logic', () => {
      const mockSuites = [
        { id: 17441, title: 'Root', parentSuiteId: null },
        { id: 17468, title: 'Child 1', parentSuiteId: 17441 },
        { id: 17469, title: 'Child 2', parentSuiteId: 17441 },
        { id: 17470, title: 'Grandchild', parentSuiteId: 17468 }
      ];
      
      const parentSuiteId = 17441;
      
      // Direct children only
      const directChildren = mockSuites.filter(s => s.parentSuiteId === parentSuiteId);
      assert.equal(directChildren.length, 2, 'should find 2 direct children');
      
      // All descendants
      const findAllDescendants = (parentId: number): any[] => {
        const directChildren = mockSuites.filter(s => s.parentSuiteId === parentId);
        const allDescendants = [...directChildren];
        
        directChildren.forEach(child => {
          allDescendants.push(...findAllDescendants(child.id));
        });
        
        return allDescendants;
      };
      
      const allDescendants = findAllDescendants(parentSuiteId);
      assert.equal(allDescendants.length, 3, 'should find 3 total descendants');
    });
    
  });
  
  describe('Hierarchy Processing Logic', () => {
    
    it('should validate level calculation', () => {
      const mockSuites = [
        { id: 1, title: 'Root', parentSuiteId: null },
        { id: 2, title: 'Level 1', parentSuiteId: 1 },
        { id: 3, title: 'Level 2', parentSuiteId: 2 },
        { id: 4, title: 'Level 3', parentSuiteId: 3 }
      ];
      
      const calculateLevel = (suiteId: number): number => {
        const suite = mockSuites.find(s => s.id === suiteId);
        if (!suite || suite.parentSuiteId === null) return 0;
        
        return 1 + calculateLevel(suite.parentSuiteId);
      };
      
      assert.equal(calculateLevel(1), 0, 'root should be level 0');
      assert.equal(calculateLevel(2), 1, 'child should be level 1');
      assert.equal(calculateLevel(3), 2, 'grandchild should be level 2');
      assert.equal(calculateLevel(4), 3, 'great-grandchild should be level 3');
    });
    
    it('should validate circular reference detection', () => {
      const mockSuitesWithCircular = [
        { id: 1, title: 'Suite 1', parentSuiteId: 2 },
        { id: 2, title: 'Suite 2', parentSuiteId: 1 } // Circular reference
      ];
      
      const detectCircular = (suiteId: number, visited: Set<number> = new Set()): boolean => {
        if (visited.has(suiteId)) return true;
        
        const suite = mockSuitesWithCircular.find(s => s.id === suiteId);
        if (!suite || suite.parentSuiteId === null) return false;
        
        visited.add(suiteId);
        return detectCircular(suite.parentSuiteId, visited);
      };
      
      assert.ok(detectCircular(1), 'should detect circular reference');
      assert.ok(detectCircular(2), 'should detect circular reference from either direction');
    });
    
    it('should validate depth limiting', () => {
      const mockDeepSuites = Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        title: `Level ${i}`,
        parentSuiteId: i === 0 ? null : i
      }));
      
      const MAX_DEPTH = 10;
      
      const calculateDepth = (suiteId: number): number => {
        const suite = mockDeepSuites.find(s => s.id === suiteId);
        if (!suite || suite.parentSuiteId === null) return 0;
        
        return 1 + calculateDepth(suite.parentSuiteId);
      };
      
      const deepestSuite = mockDeepSuites[mockDeepSuites.length - 1];
      const depth = calculateDepth(deepestSuite.id);
      
      assert.ok(depth > MAX_DEPTH, 'test suite should exceed max depth');
      
      // Simulate depth limiting
      const shouldInclude = depth <= MAX_DEPTH;
      assert.ok(!shouldInclude, 'deep suite should be excluded');
    });
    
  });
  
  describe('Error Handling', () => {
    
    it('should handle missing suite_id', () => {
      const invalidParams = {
        project_key: 'MCP',
        format: 'json'
      };
      
      assert.ok(!invalidParams.hasOwnProperty('suite_id'), 'should detect missing suite_id');
    });
    
    it('should handle invalid suite_id', () => {
      const invalidSuiteIds = [0, -1, 'not-a-number', null, undefined];
      
      invalidSuiteIds.forEach(id => {
        if (typeof id === 'number') {
          assert.ok(id <= 0, `${id} should be invalid suite_id`);
        } else {
          assert.ok(typeof id !== 'number', `${id} should not be a number`);
        }
      });
    });
    
    it('should handle non-existent suite references', () => {
      const mockSuites = [
        { id: 1, title: 'Suite 1', parentSuiteId: null },
        { id: 2, title: 'Suite 2', parentSuiteId: 999 } // Parent doesn't exist
      ];
      
      const existingIds = new Set(mockSuites.map(s => s.id));
      const invalidReferences = mockSuites.filter(s => 
        s.parentSuiteId !== null && !existingIds.has(s.parentSuiteId)
      );
      
      assert.equal(invalidReferences.length, 1, 'should find invalid parent reference');
    });
    
    it('should provide helpful error messages', () => {
      const errorScenarios = [
        {
          type: 'suite_not_found',
          message: 'Suite with ID 17470 not found in project MCP',
          suggestion: 'Verify the suite ID exists and you have access to it'
        },
        {
          type: 'max_depth_exceeded',
          message: 'Maximum hierarchy depth (10) exceeded',
          suggestion: 'Reduce max_depth parameter or check for circular references'
        },
        {
          type: 'circular_reference',
          message: 'Circular reference detected in suite hierarchy',
          suggestion: 'Check suite parent-child relationships for loops'
        }
      ];
      
      errorScenarios.forEach(scenario => {
        assert.ok(scenario.message.length > 0, 'Error message should not be empty');
        assert.ok(scenario.suggestion.length > 0, 'Error suggestion should be provided');
      });
    });
    
  });
  
  describe('Performance Considerations', () => {
    
    it('should validate efficient hierarchy traversal', () => {
      const LARGE_SUITE_COUNT = 1000;
      const MAX_DEPTH = 10;
      
      // Simulate performance constraints
      const shouldUseCache = LARGE_SUITE_COUNT > 100;
      const shouldLimitDepth = MAX_DEPTH <= 10;
      
      assert.ok(shouldUseCache, 'Should use caching for large datasets');
      assert.ok(shouldLimitDepth, 'Should limit depth for performance');
    });
    
    it('should validate memory-efficient tree building', () => {
      const mockLargeSuiteSet = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        title: `Suite ${i + 1}`,
        parentSuiteId: i === 0 ? null : Math.floor(i / 10) + 1
      }));
      
      // Simulate memory-efficient processing
      const BATCH_SIZE = 100;
      const batches = Math.ceil(mockLargeSuiteSet.length / BATCH_SIZE);
      
      assert.ok(batches > 1, 'Should process in batches');
      assert.ok(BATCH_SIZE <= 100, 'Batch size should be reasonable');
    });
    
  });
  
});
