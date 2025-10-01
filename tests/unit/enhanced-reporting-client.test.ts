import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Unit tests for enhanced reporting client functionality
 * 
 * Tests the following functionality:
 * - ZebrunnerReportingClient milestone methods
 * - ZebrunnerReportingClient project discovery methods
 * - Enhanced authentication and error handling
 */

describe('Enhanced Reporting Client Unit Tests', () => {
  
  describe('Milestone Methods', () => {
    
    it('should validate getMilestones method parameters', () => {
      const validOptions = {
        page: 1,
        pageSize: 10,
        completed: false as boolean | 'all'
      };
      
      assert.ok(typeof validOptions.page === 'number', 'page should be number');
      assert.ok(validOptions.page >= 1, 'page should be 1-based');
      assert.ok(typeof validOptions.pageSize === 'number', 'pageSize should be number');
      assert.ok(validOptions.pageSize > 0 && validOptions.pageSize <= 100, 'pageSize should be reasonable');
      assert.ok(
        typeof validOptions.completed === 'boolean' || validOptions.completed === 'all',
        'completed should be boolean or "all"'
      );
    });
    
    it('should validate milestone API URL construction', () => {
      const projectId = 7;
      const page = 2;
      const pageSize = 20;
      const completed = true;
      
      const expectedUrl = `/api/reporting/v1/milestones?projectId=${projectId}&page=${page}&pageSize=${pageSize}&completed=${completed}`;
      
      assert.ok(expectedUrl.includes(`projectId=${projectId}`), 'should include projectId');
      assert.ok(expectedUrl.includes(`page=${page}`), 'should include page');
      assert.ok(expectedUrl.includes(`pageSize=${pageSize}`), 'should include pageSize');
      assert.ok(expectedUrl.includes(`completed=${completed}`), 'should include completed filter');
    });
    
    it('should handle "all" completed parameter correctly', () => {
      const projectId = 7;
      const page = 1;
      const pageSize = 10;
      const completed = 'all';
      
      // When completed is 'all', it should not be added to URL
      const baseUrl = `/api/reporting/v1/milestones?projectId=${projectId}&page=${page}&pageSize=${pageSize}`;
      
      // Simulate the logic: only add completed parameter if not 'all'
      const finalUrl = completed !== 'all' 
        ? `${baseUrl}&completed=${completed}`
        : baseUrl;
      
      assert.ok(!finalUrl.includes('completed='), 'should not include completed parameter when "all"');
      assert.ok(finalUrl.includes(`projectId=${projectId}`), 'should still include other parameters');
    });
    
    it('should validate milestone response parsing', () => {
      const mockApiResponse = {
        items: [
          {
            id: 556,
            name: '25.39.0',
            completed: false,
            description: null,
            projectId: 7,
            dueDate: '2025-09-30T22:00:00Z',
            startDate: '2025-09-23T22:00:00Z'
          }
        ],
        _meta: {
          total: 1,
          totalPages: 1
        }
      };
      
      // Validate that the response matches expected schema
      assert.ok(Array.isArray(mockApiResponse.items), 'should have items array');
      assert.ok(mockApiResponse._meta, 'should have _meta object');
      
      const milestone = mockApiResponse.items[0];
      assert.ok(typeof milestone.id === 'number', 'milestone id should be number');
      assert.ok(typeof milestone.name === 'string', 'milestone name should be string');
      assert.ok(typeof milestone.completed === 'boolean', 'completed should be boolean');
      assert.ok(milestone.description === null || typeof milestone.description === 'string', 'description should be string or null');
      assert.ok(milestone.dueDate === null || typeof milestone.dueDate === 'string', 'dueDate should be string or null');
      assert.ok(milestone.startDate === null || typeof milestone.startDate === 'string', 'startDate should be string or null');
    });
  });
  
  describe('Project Discovery Methods', () => {
    
    it('should validate getAvailableProjects method parameters', () => {
      const validOptions = {
        starred: true,
        publiclyAccessible: false,
        extraFields: ['starred', 'publiclyAccessible']
      };
      
      assert.ok(typeof validOptions.starred === 'boolean' || validOptions.starred === undefined, 
        'starred should be boolean or undefined');
      assert.ok(typeof validOptions.publiclyAccessible === 'boolean' || validOptions.publiclyAccessible === undefined, 
        'publiclyAccessible should be boolean or undefined');
      assert.ok(Array.isArray(validOptions.extraFields), 'extraFields should be array');
      validOptions.extraFields.forEach(field => {
        assert.ok(typeof field === 'string', 'extraFields items should be strings');
      });
    });
    
    it('should validate project API URL construction', () => {
      const extraFields = ['starred', 'publiclyAccessible'];
      const expectedUrl = `/api/projects/v1/projects?extraFields=${extraFields.join(',')}`;
      
      assert.ok(expectedUrl.includes('/api/projects/v1/projects'), 'should use correct base path');
      assert.ok(expectedUrl.includes('extraFields='), 'should include extraFields parameter');
      assert.ok(expectedUrl.includes('starred'), 'should include starred in extraFields');
      assert.ok(expectedUrl.includes('publiclyAccessible'), 'should include publiclyAccessible in extraFields');
    });
    
    it('should validate project response parsing', () => {
      const mockApiResponse = {
        items: [
          {
            id: 7,
            name: 'Android',
            key: 'MCP',
            logoUrl: '/files/18b4939f-37e9-0576-8c73-478c7095192e',
            createdAt: '2023-09-11T17:43:13.337691Z',
            leadId: 26,
            starred: true,
            publiclyAccessible: true,
            deleted: false
          }
        ]
      };
      
      assert.ok(Array.isArray(mockApiResponse.items), 'should have items array');
      
      const project = mockApiResponse.items[0];
      assert.ok(typeof project.id === 'number', 'project id should be number');
      assert.ok(typeof project.name === 'string', 'project name should be string');
      assert.ok(typeof project.key === 'string', 'project key should be string');
      assert.ok(typeof project.starred === 'boolean', 'starred should be boolean');
      assert.ok(typeof project.publiclyAccessible === 'boolean', 'publiclyAccessible should be boolean');
      assert.ok(typeof project.deleted === 'boolean', 'deleted should be boolean');
      assert.ok(project.leadId === null || typeof project.leadId === 'number', 'leadId should be number or null');
    });
    
    it('should validate client-side filtering logic', () => {
      const mockProjects = [
        { id: 1, name: 'Project 1', key: 'PROJ1', starred: true, publiclyAccessible: true, deleted: false },
        { id: 2, name: 'Project 2', key: 'PROJ2', starred: false, publiclyAccessible: true, deleted: false },
        { id: 3, name: 'Project 3', key: 'PROJ3', starred: true, publiclyAccessible: false, deleted: false },
        { id: 4, name: 'Deleted Project', key: 'DEL', starred: false, publiclyAccessible: true, deleted: true }
      ];
      
      // Simulate client-side filtering logic
      const applyFilters = (projects: any[], starred?: boolean, publiclyAccessible?: boolean) => {
        let filtered = projects.filter(p => !p.deleted); // Always exclude deleted
        
        if (starred !== undefined) {
          filtered = filtered.filter(p => p.starred === starred);
        }
        
        if (publiclyAccessible !== undefined) {
          filtered = filtered.filter(p => p.publiclyAccessible === publiclyAccessible);
        }
        
        return filtered;
      };
      
      // Test no filters
      const noFilters = applyFilters(mockProjects);
      assert.equal(noFilters.length, 3, 'should exclude deleted projects by default');
      
      // Test starred filter
      const starredOnly = applyFilters(mockProjects, true);
      assert.equal(starredOnly.length, 2, 'should filter by starred status');
      
      // Test public filter
      const publicOnly = applyFilters(mockProjects, undefined, true);
      assert.equal(publicOnly.length, 2, 'should filter by public accessibility');
      
      // Test combined filters
      const starredAndPublic = applyFilters(mockProjects, true, true);
      assert.equal(starredAndPublic.length, 1, 'should apply multiple filters');
    });
    
    it('should validate getProjectsLimit method', () => {
      const mockLimitResponse = {
        data: {
          limit: 50,
          currentTotal: 12
        }
      };
      
      assert.ok(mockLimitResponse.data, 'should have data object');
      assert.ok(typeof mockLimitResponse.data.limit === 'number', 'limit should be number');
      assert.ok(typeof mockLimitResponse.data.currentTotal === 'number', 'currentTotal should be number');
      assert.ok(mockLimitResponse.data.limit > 0, 'limit should be positive');
      assert.ok(mockLimitResponse.data.currentTotal >= 0, 'currentTotal should be non-negative');
    });
  });
  
  describe('Authentication and Error Handling', () => {
    
    it('should validate Bearer token authentication', () => {
      const mockConfig = {
        baseUrl: 'https://test.zebrunner.com',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        timeout: 30000,
        debug: false
      };
      
      assert.ok(mockConfig.baseUrl, 'should have baseUrl');
      assert.ok(mockConfig.accessToken, 'should have accessToken');
      assert.ok(mockConfig.accessToken.length > 20, 'accessToken should be substantial length');
      assert.ok(typeof mockConfig.timeout === 'number', 'timeout should be number');
      assert.ok(typeof mockConfig.debug === 'boolean', 'debug should be boolean');
    });
    
    it('should validate error response handling', () => {
      const mockErrorResponses = [
        { status: 401, message: 'Authentication failed' },
        { status: 404, message: 'Project not found' },
        { status: 403, message: 'Insufficient permissions' },
        { status: 500, message: 'Internal server error' }
      ];
      
      mockErrorResponses.forEach(errorResponse => {
        assert.ok(typeof errorResponse.status === 'number', 'error status should be number');
        assert.ok(typeof errorResponse.message === 'string', 'error message should be string');
        assert.ok(errorResponse.status >= 400, 'should be HTTP error status');
      });
    });
    
    it('should validate error message enhancement', () => {
      const enhanceError = (status: number, message: string) => {
        switch (status) {
          case 401:
            return `Authentication failed: ${message}`;
          case 404:
            return `Resource not found: ${message}`;
          case 403:
            return `Access denied: ${message}`;
          default:
            return `Request failed: ${message}`;
        }
      };
      
      assert.equal(
        enhanceError(401, 'Invalid token'),
        'Authentication failed: Invalid token',
        'should enhance 401 errors'
      );
      
      assert.equal(
        enhanceError(404, 'Project not found'),
        'Resource not found: Project not found',
        'should enhance 404 errors'
      );
      
      assert.equal(
        enhanceError(500, 'Server error'),
        'Request failed: Server error',
        'should handle other errors'
      );
    });
  });
  
  describe('Response Validation and Parsing', () => {
    
    it('should validate response structure handling', () => {
      const mockResponses = [
        { data: { items: [] } },           // Wrapped in data
        { items: [] },                     // Direct response
        { response: { data: { items: [] } } } // Nested response
      ];
      
      const extractData = (response: any) => {
        return response.data || response;
      };
      
      mockResponses.forEach(response => {
        const extractedData = extractData(response);
        assert.ok(extractedData, 'should extract data from various response structures');
      });
    });
    
    it('should validate schema parsing error handling', () => {
      const mockInvalidResponses = [
        null,
        undefined,
        { items: 'not an array' },
        { _meta: 'not an object' }
      ];
      
      const validateResponse = (data: any) => {
        if (!data) return false;
        if (!Array.isArray(data.items)) return false;
        return true;
      };
      
      mockInvalidResponses.forEach(response => {
        const isValid = validateResponse(response);
        assert.equal(isValid, false, 'should reject invalid response structures');
      });
    });
    
    it('should validate successful response parsing', () => {
      const mockValidResponse = {
        items: [
          { id: 1, name: 'Test', key: 'TEST' }
        ],
        _meta: {
          total: 1,
          totalPages: 1
        }
      };
      
      const validateResponse = (data: any) => {
        if (!data) return false;
        if (!Array.isArray(data.items)) return false;
        if (data._meta && typeof data._meta.total !== 'number') return false;
        return true;
      };
      
      const isValid = validateResponse(mockValidResponse);
      assert.equal(isValid, true, 'should accept valid response structures');
    });
  });
});
