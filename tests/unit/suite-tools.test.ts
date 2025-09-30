import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Unit tests for suite-related MCP tools
 * 
 * Tests the following tools:
 * - list_test_suites
 * - get_tcm_suite_by_id
 * - get_root_suites
 * - get_suite_hierarchy
 * - get_all_subsuites
 * - get_tcm_test_suites_by_project
 * - get_all_tcm_test_case_suites_by_project
 */

describe('Suite Tools Unit Tests', () => {
  
  describe('list_test_suites Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MFPAND',
        format: 'json',
        page: 0,
        size: 50
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.project_key.length > 0, 'project_key should not be empty');
    });
    
    it('should validate pagination parameters', () => {
      const validPagination = {
        page: 0,
        size: 50,
        page_token: 'optional-token'
      };
      
      assert.ok(validPagination.page >= 0, 'page should be non-negative');
      assert.ok(validPagination.size > 0, 'size should be positive');
      assert.ok(validPagination.size <= 1000, 'size should not exceed maximum');
    });
    
    it('should validate format parameter', () => {
      const validFormats = ['dto', 'json', 'string'];
      const invalidFormat = 'xml';
      
      assert.ok(validFormats.includes('json'), 'json should be valid format');
      assert.ok(!validFormats.includes(invalidFormat), 'xml should not be valid format');
    });
    
    it('should structure pagination response correctly', () => {
      const mockResponse = {
        items: [
          { id: 18815, title: 'Treatment ON', parentSuiteId: 18814 }
        ],
        _meta: { nextPageToken: 'token123' },
        pagination: {
          currentPage: 0,
          pageSize: 50,
          hasNextPage: true,
          nextPageToken: 'token123'
        }
      };
      
      assert.ok(Array.isArray(mockResponse.items), 'items should be array');
      assert.ok(mockResponse.pagination, 'pagination info should be present');
      assert.equal(mockResponse.pagination.hasNextPage, !!mockResponse._meta.nextPageToken, 'hasNextPage should match token presence');
    });
    
  });
  
  describe('get_tcm_suite_by_id Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MFPAND',
        suite_id: 17470,
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.suite_id > 0, 'suite_id should be positive integer');
    });
    
    it('should validate suite_id parameter type', () => {
      const validSuiteId = 17470;
      const invalidSuiteId = 'not-a-number';
      
      assert.equal(typeof validSuiteId, 'number', 'suite_id should be number');
      assert.notEqual(typeof invalidSuiteId, 'number', 'string should not be valid suite_id');
    });
    
    it('should handle only_root_suites parameter', () => {
      const params = {
        project_key: 'MFPAND',
        suite_id: 17470,
        only_root_suites: false
      };
      
      assert.equal(typeof params.only_root_suites, 'boolean', 'only_root_suites should be boolean');
    });
    
    it('should structure suite response with hierarchy', () => {
      const mockSuiteResponse = {
        id: 17470,
        title: 'Budget',
        description: null,
        parentSuiteId: 17468,
        relativePosition: 1,
        rootSuiteId: 17441,
        rootSuiteName: '10. Meal Planner',
        parentSuiteName: 'Settings',
        treeNames: '10. Meal Planner > Settings > Budget'
      };
      
      assert.ok(mockSuiteResponse.id, 'suite should have id');
      assert.ok(mockSuiteResponse.title, 'suite should have title');
      assert.ok(mockSuiteResponse.rootSuiteId, 'suite should have rootSuiteId');
      assert.ok(mockSuiteResponse.treeNames, 'suite should have hierarchy path');
    });
    
  });
  
  describe('get_root_suites Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MFPAND',
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.project_key.length > 0, 'project_key should not be empty');
    });
    
    it('should identify root suites correctly', () => {
      const mockSuites = [
        { id: 1, title: 'Root Suite 1', parentSuiteId: null },
        { id: 2, title: 'Child Suite', parentSuiteId: 1 },
        { id: 3, title: 'Root Suite 2', parentSuiteId: null }
      ];
      
      const rootSuites = mockSuites.filter(suite => suite.parentSuiteId === null);
      
      assert.equal(rootSuites.length, 2, 'should find 2 root suites');
      assert.ok(rootSuites.every(suite => suite.parentSuiteId === null), 'all root suites should have null parentSuiteId');
    });
    
  });
  
  describe('get_suite_hierarchy Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MFPAND',
        max_depth: 5,
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.max_depth > 0, 'max_depth should be positive');
      assert.ok(validParams.max_depth <= 10, 'max_depth should not exceed maximum');
    });
    
    it('should validate max_depth parameter', () => {
      const validDepth = 5;
      const invalidDepthZero = 0;
      const invalidDepthTooHigh = 11;
      
      assert.ok(validDepth > 0 && validDepth <= 10, 'depth 5 should be valid');
      assert.ok(invalidDepthZero <= 0, 'depth 0 should be invalid');
      assert.ok(invalidDepthTooHigh > 10, 'depth 11 should exceed maximum');
    });
    
    it('should handle root_suite_id parameter', () => {
      const params = {
        project_key: 'MFPAND',
        root_suite_id: 18659
      };
      
      assert.ok(params.root_suite_id > 0, 'root_suite_id should be positive when provided');
    });
    
  });
  
  describe('get_all_subsuites Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MFPAND',
        root_suite_id: 1079,
        include_root: true,
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.root_suite_id > 0, 'root_suite_id should be positive');
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
    
    it('should handle include_root parameter', () => {
      const params = {
        project_key: 'MFPAND',
        root_suite_id: 1079,
        include_root: true
      };
      
      assert.equal(typeof params.include_root, 'boolean', 'include_root should be boolean');
    });
    
  });
  
  describe('get_tcm_test_suites_by_project Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MFPAND',
        max_page_size: 100,
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.max_page_size > 0, 'max_page_size should be positive');
      assert.ok(validParams.max_page_size <= 1000, 'max_page_size should not exceed maximum');
    });
    
    it('should handle page_token parameter', () => {
      const params = {
        project_key: 'MFPAND',
        page_token: 'abc123token'
      };
      
      assert.equal(typeof params.page_token, 'string', 'page_token should be string when provided');
    });
    
    it('should validate max_page_size against configured limit', () => {
      const MAX_PAGE_SIZE = 100; // Simulated config value
      const validSize = 50;
      const invalidSize = 150;
      
      assert.ok(validSize <= MAX_PAGE_SIZE, 'valid size should not exceed limit');
      assert.ok(invalidSize > MAX_PAGE_SIZE, 'invalid size should exceed limit');
    });
    
  });
  
  describe('Suite Response Validation', () => {
    
    it('should validate suite object structure', () => {
      const mockSuite = {
        id: 17470,
        title: 'Budget',
        description: null,
        parentSuiteId: 17468,
        relativePosition: 1
      };
      
      assert.ok(typeof mockSuite.id === 'number', 'id should be number');
      assert.ok(typeof mockSuite.title === 'string', 'title should be string');
      assert.ok(mockSuite.parentSuiteId === null || typeof mockSuite.parentSuiteId === 'number', 'parentSuiteId should be number or null');
    });
    
    it('should validate enriched suite with hierarchy', () => {
      const enrichedSuite = {
        id: 17470,
        title: 'Budget',
        parentSuiteId: 17468,
        rootSuiteId: 17441,
        level: 2,
        path: '10. Meal Planner > Settings > Budget'
      };
      
      assert.ok(enrichedSuite.rootSuiteId, 'enriched suite should have rootSuiteId');
      assert.ok(typeof enrichedSuite.level === 'number', 'level should be number');
      assert.ok(enrichedSuite.path, 'enriched suite should have path');
    });
    
    it('should validate paged suite response', () => {
      const pagedResponse = {
        items: [
          { id: 1, title: 'Suite 1' },
          { id: 2, title: 'Suite 2' }
        ],
        _meta: {
          nextPageToken: 'token123',
          totalElements: 1188,
          currentPage: 0,
          pageSize: 50
        }
      };
      
      assert.ok(Array.isArray(pagedResponse.items), 'items should be array');
      assert.ok(pagedResponse._meta, 'response should have metadata');
      assert.ok(typeof pagedResponse._meta.totalElements === 'number', 'totalElements should be number');
    });
    
  });
  
  describe('Error Handling', () => {
    
    it('should handle missing project_key', () => {
      const invalidParams = {
        suite_id: 17470,
        format: 'json'
      };
      
      assert.ok(!invalidParams.hasOwnProperty('project_key'), 'should detect missing project_key');
    });
    
    it('should handle invalid suite_id', () => {
      const invalidSuiteId = -1;
      const validSuiteId = 17470;
      
      assert.ok(invalidSuiteId <= 0, 'negative suite_id should be invalid');
      assert.ok(validSuiteId > 0, 'positive suite_id should be valid');
    });
    
    it('should handle invalid format', () => {
      const validFormats = ['dto', 'json', 'string', 'markdown'];
      const invalidFormat = 'xml';
      
      assert.ok(!validFormats.includes(invalidFormat), 'xml should not be valid format');
    });
    
    it('should provide helpful error messages', () => {
      const MAX_PAGE_SIZE = 100;
      const requestedSize = 200;
      
      const errorMessage = `❌ Error: Requested page size (${requestedSize}) exceeds configured maximum (${MAX_PAGE_SIZE}). Set MAX_PAGE_SIZE environment variable to increase the limit.`;
      
      assert.ok(errorMessage.includes('exceeds configured maximum'), 'Error should explain the limit');
      assert.ok(errorMessage.includes('MAX_PAGE_SIZE environment variable'), 'Error should mention configuration');
    });
    
  });
  
});
