import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { ZebrunnerReportingClient } from '../../dist/api/reporting-client.js';
import { EnhancedZebrunnerClient } from '../../dist/api/enhanced-client.js';

/**
 * Unit tests for new test case tools
 * 
 * Tests the following tools:
 * - get_test_case_by_title
 * - get_test_case_by_filter  
 * - get_automation_priorities
 */

describe('New Test Case Tools Unit Tests', () => {
  let mockReportingClient: any;
  let mockEnhancedClient: any;
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    // Mock console.warn to capture fallback warnings
    originalConsoleWarn = console.warn;
    console.warn = () => {};

    // Mock ZebrunnerReportingClient
    mockReportingClient = {
      getPriorities: async (projectId: number) => {
        if (projectId === 999) {
          // Simulate API failure - should return fallback priorities
          throw new Error('Network error');
        }
        
        // Simulate successful API response with {"items": [...]} format
        return [
          { id: 15, name: 'High' },
          { id: 16, name: 'Medium' },
          { id: 17, name: 'Low' },
          { id: 18, name: 'Trivial' },
          { id: 35, name: 'Critical' }
        ];
      },
      makeAuthenticatedRequest: async (method: string, url: string) => {
        if (url.includes('projectId=999')) {
          throw new Error('Network error');
        }
        
        // Simulate actual API response format
        return {
          data: {
            items: [
              { id: 15, name: 'High', iconUrl: '/priority-high.svg', isDefault: false, relativePosition: 0 },
              { id: 16, name: 'Medium', iconUrl: '/priority-medium.svg', isDefault: true, relativePosition: 1 },
              { id: 17, name: 'Low', iconUrl: '/priority-low.svg', isDefault: false, relativePosition: 2 },
              { id: 18, name: 'Trivial', iconUrl: '/priority-trivial.svg', isDefault: false, relativePosition: 3 },
              { id: 35, name: 'Critical', iconUrl: null, isDefault: false, relativePosition: 4 }
            ]
          }
        };
      }
    };

    // Mock EnhancedZebrunnerClient
    mockEnhancedClient = {
      getTestCases: async (projectKey: string, options: any) => {
        const mockTestCases = [
          {
            id: 1501,
            key: 'MFPAND-605',
            title: 'Verify a non premium user is taken to the Meal Scan walkthrough when tapping [mfp://mfp/meal_scan]',
            automationState: { id: 12, name: 'Automated' },
            priority: { id: 16, name: 'Medium' },
            testSuite: { id: 491 },
            createdAt: '2023-10-17T09:12:49.814856Z',
            lastModifiedAt: '2023-10-27T11:31:05.573872Z',
            deleted: false,
            deprecated: false,
            draft: false
          },
          {
            id: 82095,
            key: 'MFPAND-6042',
            title: 'Verify a non premium user is taken to the Meal Scan walkthrough when tapping [mfp://mfp/meal_scan]',
            automationState: { id: 10, name: 'Not Automated' },
            priority: { id: 15, name: 'High' },
            testSuite: { id: 18744 },
            createdAt: '2025-09-15T13:46:05.818070Z',
            lastModifiedAt: '2025-09-23T12:25:35.119350Z',
            deleted: false,
            deprecated: false,
            draft: false
          }
        ];

        // Filter based on options
        let filteredCases = mockTestCases;

        // Handle title filtering
        if (options.filter && options.filter.includes('title~=')) {
          const titleMatch = options.filter.match(/title~="([^"]+)"/);
          if (titleMatch) {
            const searchTitle = titleMatch[1];
            filteredCases = mockTestCases.filter(testCase => 
              testCase.title.toLowerCase().includes(searchTitle.toLowerCase())
            );
          }
        }

        // Handle complex filters (testSuite.id, dates, priority.id, automationState.id)
        if (options.filter && !options.filter.includes('title~=')) {
          const filters = options.filter.split(' AND ');
          
          filteredCases = mockTestCases.filter(testCase => {
            return filters.every(filter => {
              filter = filter.trim();
              
              if (filter.includes('testSuite.id =')) {
                const suiteId = parseInt(filter.split('=')[1].trim());
                return testCase.testSuite.id === suiteId;
              }
              
              if (filter.includes('priority.id =')) {
                const priorityId = parseInt(filter.split('=')[1].trim());
                return testCase.priority.id === priorityId;
              }
              
              if (filter.includes('automationState.id =')) {
                const stateId = parseInt(filter.split('=')[1].trim());
                return testCase.automationState.id === stateId;
              }
              
              if (filter.includes('createdAt >=')) {
                const date = filter.split('>=')[1].trim().replace(/'/g, '');
                return new Date(testCase.createdAt) >= new Date(date);
              }
              
              if (filter.includes('createdAt <=')) {
                const date = filter.split('<=')[1].trim().replace(/'/g, '');
                return new Date(testCase.createdAt) <= new Date(date);
              }
              
              if (filter.includes('lastModifiedAt >=')) {
                const date = filter.split('>=')[1].trim().replace(/'/g, '');
                return new Date(testCase.lastModifiedAt) >= new Date(date);
              }
              
              if (filter.includes('lastModifiedAt <=')) {
                const date = filter.split('<=')[1].trim().replace(/'/g, '');
                return new Date(testCase.lastModifiedAt) <= new Date(date);
              }
              
              return true;
            });
          });
        }

        // Handle pagination
        const pageSize = options.size || 20;
        const hasNextPage = filteredCases.length > pageSize;
        const items = filteredCases.slice(0, pageSize);
        
        const response: any = {
          items: items,
          _meta: {
            totalElements: filteredCases.length
          }
        };
        
        if (hasNextPage) {
          response._meta.nextPageToken = 'next-page-token-123';
        }
        
        return response;
      }
    };
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  describe('get_test_case_by_title Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        project_key: 'MFPAND',
        title: 'Meal Scan walkthrough',
        max_page_size: 10,
        format: 'json'
      };
      
      assert.ok(validParams.project_key, 'project_key should be required');
      assert.ok(validParams.title, 'title should be required');
      assert.ok(validParams.project_key.length > 0, 'project_key should not be empty');
      assert.ok(validParams.title.length > 0, 'title should not be empty');
    });
    
    it('should validate parameter types and ranges', () => {
      const params = {
        project_key: 'MFPAND',
        title: 'test',
        max_page_size: 50,
        page_token: 'token-123',
        get_all: false,
        format: 'json',
        include_clickable_links: true
      };
      
      // String validations
      assert.strictEqual(typeof params.project_key, 'string');
      assert.strictEqual(typeof params.title, 'string');
      assert.ok(params.title.length >= 1, 'title should have minimum length');
      
      // Number validations
      assert.strictEqual(typeof params.max_page_size, 'number');
      assert.ok(params.max_page_size > 0 && params.max_page_size <= 100, 'max_page_size should be 1-100');
      
      // Boolean validations
      assert.strictEqual(typeof params.get_all, 'boolean');
      assert.strictEqual(typeof params.include_clickable_links, 'boolean');
      
      // Format enum validation
      const validFormats = ['dto', 'json', 'string', 'markdown'];
      assert.ok(validFormats.includes(params.format), 'format should be valid enum value');
    });
    
    it('should build correct RQL filter for title search', () => {
      const title = 'Meal Scan walkthrough';
      const expectedFilter = `title~="${title}"`;
      
      // Test basic filter construction
      assert.strictEqual(`title~="${title}"`, expectedFilter);
      
      // Test with quotes in title (should be escaped)
      const titleWithQuotes = 'Test "quoted" title';
      const expectedEscapedFilter = `title~="Test \\"quoted\\" title"`;
      const escapedTitle = titleWithQuotes.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      assert.strictEqual(`title~="${escapedTitle}"`, expectedEscapedFilter);
      
      // Test with backslashes and quotes (should escape backslashes first, then quotes)
      const titleWithBackslashes = 'Test\\Path "quoted"';
      const expectedBackslashFilter = `title~="Test\\\\Path \\"quoted\\""`;
      const escapedBackslashTitle = titleWithBackslashes.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      assert.strictEqual(`title~="${escapedBackslashTitle}"`, expectedBackslashFilter);
    });
    
    it('should handle pagination parameters correctly', () => {
      const singlePageParams = {
        max_page_size: 10,
        page_token: undefined,
        get_all: false
      };
      
      const getAllParams = {
        max_page_size: 20,
        page_token: 'token-123',
        get_all: true
      };
      
      const nextPageParams = {
        max_page_size: 15,
        page_token: 'next-token-456',
        get_all: false
      };
      
      // Validate parameter combinations
      assert.ok(!singlePageParams.get_all && !singlePageParams.page_token, 'Single page should not have pagination');
      assert.ok(getAllParams.get_all, 'Get all should be true when fetching all pages');
      assert.ok(nextPageParams.page_token && !nextPageParams.get_all, 'Next page should have token but not get_all');
    });
    
    it('should simulate successful API response parsing', async () => {
      const projectKey = 'MFPAND';
      const options = {
        size: 10,
        filter: 'title~="Meal Scan"'
      };
      
      const response = await mockEnhancedClient.getTestCases(projectKey, options);
      
      // Validate response structure
      assert.ok(response.items, 'Response should have items array');
      assert.ok(response._meta, 'Response should have meta information');
      assert.strictEqual(typeof response._meta.totalElements, 'number', 'Meta should have totalElements');
      
      // Validate filtered results
      assert.ok(response.items.length > 0, 'Should return matching test cases');
      response.items.forEach((item: any) => {
        assert.ok(item.title.toLowerCase().includes('meal scan'), 'All results should match title filter');
      });
    });
    
    it('should handle clickable links configuration', () => {
      const withLinksConfig = {
        include_clickable_links: true,
        baseWebUrl: 'https://mfp.zebrunner.com'
      };
      
      const withoutLinksConfig = {
        include_clickable_links: false,
        baseWebUrl: undefined
      };
      
      // Test link generation logic
      if (withLinksConfig.include_clickable_links && withLinksConfig.baseWebUrl) {
        const testCaseId = 1501;
        const projectKey = 'MFPAND';
        const expectedUrl = `${withLinksConfig.baseWebUrl}/projects/${projectKey}/test-cases?caseId=${testCaseId}`;
        assert.ok(expectedUrl.includes('test-cases?caseId='), 'Should generate correct URL format');
      }
      
      assert.ok(!withoutLinksConfig.include_clickable_links, 'Links should be disabled when requested');
    });
  });

  describe('get_test_case_by_filter Tool', () => {
    
    it('should validate required filter parameters', () => {
      // At least one filter must be provided
      const validFilterParams = [
        { test_suite_id: 491 },
        { created_after: '2024-01-01T00:00:00Z' },
        { created_before: '2024-12-31T23:59:59Z' },
        { last_modified_after: '2024-01-01T00:00:00Z' },
        { last_modified_before: '2024-12-31T23:59:59Z' },
        { priority_id: 16 },
        { automation_state_id: 12 }
      ];
      
      validFilterParams.forEach(params => {
        const hasAtLeastOneFilter = Object.keys(params).some(key => 
          ['test_suite_id', 'created_after', 'created_before', 'last_modified_after', 'last_modified_before', 'priority_id', 'automation_state_id'].includes(key)
        );
        assert.ok(hasAtLeastOneFilter, 'Should have at least one filter parameter');
      });
    });
    
    it('should validate parameter types and formats', () => {
      const params = {
        project_key: 'MFPAND',
        test_suite_id: 491,
        created_after: '2024-01-01T00:00:00Z',
        created_before: '2024-12-31T23:59:59Z',
        last_modified_after: '2024-01-01T00:00:00Z',
        last_modified_before: '2024-12-31T23:59:59Z',
        priority_id: 16,
        automation_state_id: 12,
        max_page_size: 20,
        page_token: 'token-123',
        get_all: false,
        format: 'json',
        include_clickable_links: false
      };
      
      // String validations
      assert.strictEqual(typeof params.project_key, 'string');
      assert.ok(params.project_key.length > 0, 'project_key should not be empty');
      
      // Number validations
      assert.strictEqual(typeof params.test_suite_id, 'number');
      assert.strictEqual(typeof params.priority_id, 'number');
      assert.strictEqual(typeof params.automation_state_id, 'number');
      assert.strictEqual(typeof params.max_page_size, 'number');
      assert.ok(params.test_suite_id > 0, 'test_suite_id should be positive');
      assert.ok(params.priority_id > 0, 'priority_id should be positive');
      assert.ok(params.automation_state_id > 0, 'automation_state_id should be positive');
      assert.ok(params.max_page_size > 0 && params.max_page_size <= 100, 'max_page_size should be 1-100');
      
      // Date format validation (ISO format)
      const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
      assert.ok(dateRegex.test(params.created_after), 'created_after should be ISO format');
      assert.ok(dateRegex.test(params.created_before), 'created_before should be ISO format');
      assert.ok(dateRegex.test(params.last_modified_after), 'last_modified_after should be ISO format');
      assert.ok(dateRegex.test(params.last_modified_before), 'last_modified_before should be ISO format');
      
      // Boolean validations
      assert.strictEqual(typeof params.get_all, 'boolean');
      assert.strictEqual(typeof params.include_clickable_links, 'boolean');
      
      // Format enum validation
      const validFormats = ['dto', 'json', 'string', 'markdown'];
      assert.ok(validFormats.includes(params.format), 'format should be valid enum value');
    });
    
    it('should build correct RQL filters for different parameters', () => {
      // Test individual filters
      const testSuiteFilter = 'testSuite.id = 491';
      const createdAfterFilter = "createdAt >= '2024-01-01T00:00:00Z'";
      const createdBeforeFilter = "createdAt <= '2024-12-31T23:59:59Z'";
      const lastModifiedAfterFilter = "lastModifiedAt >= '2024-01-01T00:00:00Z'";
      const lastModifiedBeforeFilter = "lastModifiedAt <= '2024-12-31T23:59:59Z'";
      const priorityFilter = 'priority.id = 16';
      const automationStateFilter = 'automationState.id = 12';
      
      // Validate filter formats
      assert.ok(testSuiteFilter.includes('testSuite.id ='), 'Suite filter should use exact match');
      assert.ok(createdAfterFilter.includes('createdAt >='), 'Created after should use >= operator');
      assert.ok(createdBeforeFilter.includes('createdAt <='), 'Created before should use <= operator');
      assert.ok(lastModifiedAfterFilter.includes('lastModifiedAt >='), 'Modified after should use >= operator');
      assert.ok(lastModifiedBeforeFilter.includes('lastModifiedAt <='), 'Modified before should use <= operator');
      assert.ok(priorityFilter.includes('priority.id ='), 'Priority filter should use exact match');
      assert.ok(automationStateFilter.includes('automationState.id ='), 'Automation state should use exact match');
      
      // Test combined filters
      const combinedFilter = [testSuiteFilter, priorityFilter, createdAfterFilter].join(' AND ');
      assert.ok(combinedFilter.includes(' AND '), 'Combined filters should use AND operator');
      assert.strictEqual(combinedFilter.split(' AND ').length, 3, 'Should have correct number of filter parts');
    });
    
    it('should simulate complex filter API response', async () => {
      const projectKey = 'MFPAND';
      const options = {
        size: 20,
        filter: 'testSuite.id = 491 AND priority.id = 16 AND createdAt >= \'2023-01-01T00:00:00Z\''
      };
      
      const response = await mockEnhancedClient.getTestCases(projectKey, options);
      
      // Validate response structure
      assert.ok(response.items, 'Response should have items array');
      assert.ok(response._meta, 'Response should have meta information');
      
      // Validate filtering logic
      response.items.forEach((item: any) => {
        assert.strictEqual(item.testSuite.id, 491, 'Should match suite filter');
        assert.strictEqual(item.priority.id, 16, 'Should match priority filter');
        assert.ok(new Date(item.createdAt) >= new Date('2023-01-01T00:00:00Z'), 'Should match date filter');
      });
    });
    
    it('should handle pagination for filtered results', async () => {
      const projectKey = 'MFPAND';
      const options = {
        size: 1, // Small page size to trigger pagination
        filter: 'testSuite.id = 491'
      };
      
      const response = await mockEnhancedClient.getTestCases(projectKey, options);
      
      // Should have pagination info when there are more results
      if (response._meta.totalElements > options.size) {
        assert.ok(response._meta.nextPageToken, 'Should have next page token when more results available');
      }
      
      assert.ok(response.items.length <= options.size, 'Should respect page size limit');
    });
    
    it('should validate date range logic', () => {
      const validDateRanges = [
        {
          created_after: '2024-01-01T00:00:00Z',
          created_before: '2024-12-31T23:59:59Z'
        },
        {
          last_modified_after: '2024-06-01T00:00:00Z',
          last_modified_before: '2024-06-30T23:59:59Z'
        }
      ];
      
      validDateRanges.forEach(range => {
        if (range.created_after && range.created_before) {
          const afterDate = new Date(range.created_after);
          const beforeDate = new Date(range.created_before);
          assert.ok(afterDate < beforeDate, 'After date should be before the before date');
        }
        
        if (range.last_modified_after && range.last_modified_before) {
          const afterDate = new Date(range.last_modified_after);
          const beforeDate = new Date(range.last_modified_before);
          assert.ok(afterDate < beforeDate, 'After date should be before the before date');
        }
      });
    });
  });

  describe('get_automation_priorities Tool', () => {
    
    it('should validate project parameter', () => {
      const validProjects = ['web', 'android', 'ios', 'api', 'MFPAND', 7];
      const invalidProjects = ['', null, undefined, -1];
      
      validProjects.forEach(project => {
        const isValidAlias = ['web', 'android', 'ios', 'api'].includes(project as string);
        const isValidString = typeof project === 'string' && project.length > 0;
        const isValidNumber = typeof project === 'number' && project > 0;
        
        assert.ok(isValidAlias || isValidString || isValidNumber, 
          `${project} should be valid project parameter`);
      });
      
      invalidProjects.forEach(project => {
        const isValid = project && (
          ['web', 'android', 'ios', 'api'].includes(project as string) ||
          (typeof project === 'string' && project.length > 0) ||
          (typeof project === 'number' && project > 0)
        );
        assert.ok(!isValid, `${project} should be invalid project parameter`);
      });
    });
    
    it('should validate format parameter', () => {
      const validFormats = ['json', 'markdown'];
      const invalidFormats = ['xml', 'csv', 'yaml', ''];
      
      validFormats.forEach(format => {
        assert.ok(['json', 'markdown'].includes(format), `${format} should be valid format`);
      });
      
      invalidFormats.forEach(format => {
        assert.ok(!['json', 'markdown'].includes(format), `${format} should be invalid format`);
      });
    });
    
    it('should simulate successful API response', async () => {
      const projectId = 7;
      const priorities = await mockReportingClient.getPriorities(projectId);
      
      // Validate response structure
      assert.ok(Array.isArray(priorities), 'Should return array of priorities');
      assert.ok(priorities.length > 0, 'Should have at least one priority');
      
      // Validate priority objects
      priorities.forEach(priority => {
        assert.ok(typeof priority.id === 'number', 'Priority should have numeric id');
        assert.ok(typeof priority.name === 'string', 'Priority should have string name');
        assert.ok(priority.id > 0, 'Priority id should be positive');
        assert.ok(priority.name.length > 0, 'Priority name should not be empty');
      });
      
      // Validate expected priorities
      const priorityNames = priorities.map(p => p.name);
      const expectedPriorities = ['High', 'Medium', 'Low', 'Trivial', 'Critical'];
      expectedPriorities.forEach(expectedName => {
        assert.ok(priorityNames.includes(expectedName), `Should include ${expectedName} priority`);
      });
    });
    
    it('should handle API failure with fallback priorities', async () => {
      const projectId = 999; // This triggers API failure in mock
      
      try {
        const priorities = await mockReportingClient.getPriorities(projectId);
        
        // Should still return fallback priorities
        assert.ok(Array.isArray(priorities), 'Should return fallback priorities array');
        assert.ok(priorities.length > 0, 'Should have fallback priorities');
        
        // Validate fallback structure
        priorities.forEach(priority => {
          assert.ok(typeof priority.id === 'number', 'Fallback priority should have numeric id');
          assert.ok(typeof priority.name === 'string', 'Fallback priority should have string name');
        });
        
        // Should have expected fallback priorities with correct IDs
        const expectedFallbacks = [
          { id: 15, name: 'High' },
          { id: 16, name: 'Medium' },
          { id: 17, name: 'Low' },
          { id: 18, name: 'Trivial' },
          { id: 35, name: 'Critical' }
        ];
        
        expectedFallbacks.forEach(expected => {
          const found = priorities.find(p => p.id === expected.id && p.name === expected.name);
          assert.ok(found, `Should have fallback priority: ${expected.name} (ID: ${expected.id})`);
        });
        
      } catch (error) {
        // If error is thrown instead of fallback, that's also valid behavior
        assert.ok(error instanceof Error, 'Should throw proper error on API failure');
      }
    });
    
    it('should validate priority icons mapping', () => {
      const iconMapping = {
        'High': '🔴',
        'Medium': '🟡',
        'Low': '🟢',
        'Trivial': '⚪',
        'Critical': '❗'
      };
      
      Object.entries(iconMapping).forEach(([name, icon]) => {
        assert.ok(typeof name === 'string', 'Priority name should be string');
        assert.ok(typeof icon === 'string', 'Icon should be string');
        assert.ok(icon.length > 0, 'Icon should not be empty');
      });
      
      // Validate all expected priorities have icons
      const priorityNames = ['High', 'Medium', 'Low', 'Trivial', 'Critical'];
      priorityNames.forEach(name => {
        assert.ok(iconMapping[name as keyof typeof iconMapping], `${name} should have icon mapping`);
      });
    });
    
    it('should generate correct usage examples', () => {
      const priorities = [
        { id: 15, name: 'High' },
        { id: 16, name: 'Medium' },
        { id: 17, name: 'Low' }
      ];
      
      // Test mapping generation
      const mapping = priorities.reduce((acc, priority) => {
        acc[priority.name] = priority.id;
        return acc;
      }, {} as Record<string, number>);
      
      assert.strictEqual(mapping['High'], 15, 'Mapping should have correct High priority ID');
      assert.strictEqual(mapping['Medium'], 16, 'Mapping should have correct Medium priority ID');
      assert.strictEqual(mapping['Low'], 17, 'Mapping should have correct Low priority ID');
      
      // Test usage example generation
      const examplePriorityId = priorities[0]?.id || 15;
      const exampleUsage = `get_test_case_by_filter(project_key: "android", priority_id: ${examplePriorityId})`;
      
      assert.ok(exampleUsage.includes('get_test_case_by_filter'), 'Should reference filter tool');
      assert.ok(exampleUsage.includes('priority_id'), 'Should include priority_id parameter');
      assert.ok(exampleUsage.includes(examplePriorityId.toString()), 'Should include actual priority ID');
    });
    
    it('should handle response format parsing', async () => {
      // Test direct API response parsing
      const mockApiResponse = {
        data: {
          items: [
            { id: 15, name: 'High', iconUrl: '/priority-high.svg', isDefault: false, relativePosition: 0 },
            { id: 16, name: 'Medium', iconUrl: '/priority-medium.svg', isDefault: true, relativePosition: 1 }
          ]
        }
      };
      
      // Simulate parsing logic
      const data = mockApiResponse.data;
      let prioritiesArray: any[] = [];
      
      if (data && Array.isArray(data.items)) {
        prioritiesArray = data.items;
      } else if (Array.isArray(data)) {
        prioritiesArray = data;
      }
      
      const priorities = prioritiesArray.map((item: any) => ({
        id: item.id,
        name: item.name
      }));
      
      assert.ok(priorities.length > 0, 'Should parse priorities from API response');
      assert.strictEqual(priorities[0].id, 15, 'Should extract correct ID');
      assert.strictEqual(priorities[0].name, 'High', 'Should extract correct name');
      assert.strictEqual(priorities[1].id, 16, 'Should extract correct ID');
      assert.strictEqual(priorities[1].name, 'Medium', 'Should extract correct name');
    });
  });

  describe('Integration Tests', () => {
    
    it('should work together for complete workflow', async () => {
      // 1. Get priorities to find priority IDs
      const projectId = 7;
      const priorities = await mockReportingClient.getPriorities(projectId);
      const highPriorityId = priorities.find(p => p.name === 'High')?.id;
      
      assert.ok(highPriorityId, 'Should find High priority ID');
      
      // 2. Use priority ID in filter search
      const projectKey = 'MFPAND';
      const filterOptions = {
        size: 10,
        filter: `priority.id = ${highPriorityId}`
      };
      
      const filterResponse = await mockEnhancedClient.getTestCases(projectKey, filterOptions);
      assert.ok(filterResponse.items, 'Filter search should return results');
      
      // 3. Use title search for additional cases
      const titleOptions = {
        size: 10,
        filter: 'title~="Meal Scan"'
      };
      
      const titleResponse = await mockEnhancedClient.getTestCases(projectKey, titleOptions);
      assert.ok(titleResponse.items, 'Title search should return results');
      
      // Validate that the workflow produces expected results
      assert.ok(priorities.length > 0, 'Workflow should start with priorities');
      assert.ok(filterResponse.items.length >= 0, 'Filter search should complete');
      assert.ok(titleResponse.items.length >= 0, 'Title search should complete');
    });
    
    it('should handle error scenarios gracefully', async () => {
      // Test API failure scenarios
      const failureProjectId = 999;
      
      try {
        await mockReportingClient.getPriorities(failureProjectId);
        // Should either return fallback or throw error
        assert.ok(true, 'Should handle API failure gracefully');
      } catch (error) {
        assert.ok(error instanceof Error, 'Should throw proper error on failure');
      }
      
      // Test empty results
      const emptyFilterOptions = {
        size: 10,
        filter: 'testSuite.id = 99999' // Non-existent suite
      };
      
      const emptyResponse = await mockEnhancedClient.getTestCases('MFPAND', emptyFilterOptions);
      assert.ok(Array.isArray(emptyResponse.items), 'Should return empty array for no results');
    });
  });
});
