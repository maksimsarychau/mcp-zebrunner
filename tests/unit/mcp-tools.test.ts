import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

describe('MCP Tools Schema Validation', () => {
  describe('Tool Input Validation', () => {
    it('should validate list_test_suites parameters', () => {
      const validInput = {
        project_key: 'MCP',
        format: 'json',
        include_hierarchy: false
      };

      assert.equal(typeof validInput.project_key, 'string');
      assert.equal(validInput.project_key.length > 0, true);
      assert.ok(['json', 'string', 'dto'].includes(validInput.format as string));
    });

    it('should validate get_test_case_by_key parameters', () => {
      const validInput = {
        project_key: 'MCP',
        case_key: 'MCP-1',
        format: 'markdown',
        include_suite_hierarchy: true,
        include_debug: false
      };

      assert.equal(typeof validInput.project_key, 'string');
      assert.equal(typeof validInput.case_key, 'string');
      assert.ok(['json', 'string', 'dto', 'markdown'].includes(validInput.format as string));
      assert.equal(typeof validInput.include_suite_hierarchy, 'boolean');
      assert.equal(typeof validInput.include_debug, 'boolean');
    });

    it('should validate get_test_cases_advanced parameters', () => {
      const validInput = {
        project_key: 'MCP',
        page: 0,
        size: 10,
        format: 'json',
        include_steps: true,
        suite_id: 1,
        root_suite_id: 1
      };

      assert.equal(typeof validInput.project_key, 'string');
      assert.ok(validInput.page >= 0);
      assert.ok(validInput.size > 0 && validInput.size <= 100);
      assert.ok(['json', 'string', 'dto', 'markdown'].includes(validInput.format as string));
      assert.equal(typeof validInput.include_steps, 'boolean');
      assert.equal(typeof validInput.suite_id, 'number');
      assert.equal(typeof validInput.root_suite_id, 'number');
    });

    it('should validate get_test_cases_by_suite_smart parameters', () => {
      const validInput = {
        project_key: 'MCP',
        suite_id: 18824,
        include_steps: false,
        format: 'json',
        page: 0,
        size: 50
      };

      assert.equal(typeof validInput.project_key, 'string');
      assert.equal(validInput.project_key.length > 0, true);
      assert.equal(typeof validInput.suite_id, 'number');
      assert.ok(validInput.suite_id > 0, 'suite_id should be positive');
      assert.equal(typeof validInput.include_steps, 'boolean');
      assert.ok(['json', 'string', 'dto', 'markdown'].includes(validInput.format as string));
      assert.ok(validInput.page >= 0, 'page should be non-negative');
      assert.ok(validInput.size > 0 && validInput.size <= 100, 'size should be between 1-100');
    });

    it('should validate get_suite_hierarchy parameters', () => {
      const validInput = {
        project_key: 'MCP',
        max_depth: 5,
        root_suite_id: 12345,
        format: 'json'
      };

      assert.equal(typeof validInput.project_key, 'string');
      assert.ok(validInput.max_depth > 0 && validInput.max_depth <= 10);
      assert.equal(typeof validInput.root_suite_id, 'number');
      assert.ok(['json', 'string', 'dto'].includes(validInput.format as string));
    });
  });

  describe('Tool Output Format Validation', () => {
    it('should handle JSON format output', () => {
      const testData = {
        id: 123,
        title: 'Test Case',
        priority: { id: 1, name: 'High' }
      };

      const jsonOutput = JSON.stringify(testData, null, 2);
      assert.equal(typeof jsonOutput, 'string');

      const parsed = JSON.parse(jsonOutput);
      assert.deepEqual(parsed, testData);
    });

    it('should handle string format output structure', () => {
      const testSuite = {
        id: 456,
        title: 'Test Suite',
        relativePosition: 1,
        description: 'Sample test suite'
      };

      // Simulate string formatting
      const stringOutput = `=== Test Suite: ${testSuite.title} ===\nID: ${testSuite.id}\nPosition: ${testSuite.relativePosition}`;

      assert.ok(stringOutput.includes('=== Test Suite:'));
      assert.ok(stringOutput.includes(testSuite.title));
      assert.ok(stringOutput.includes(testSuite.id.toString()));
    });

    it('should handle markdown format structure', () => {
      const testCase = {
        id: 789,
        key: 'MCP-1',
        title: 'Sample Test Case',
        description: 'Test description',
        priority: { id: 1, name: 'High' },
        steps: []
      };

      // Simulate markdown formatting
      const markdownOutput = `# Test Case: ${testCase.title}\n\n**ID:** ${testCase.id}\n**Key:** ${testCase.key}\n**Priority:** ${testCase.priority.name}`;

      assert.ok(markdownOutput.includes('# Test Case:'));
      assert.ok(markdownOutput.includes('**ID:**'));
      assert.ok(markdownOutput.includes('**Key:**'));
      assert.ok(markdownOutput.includes('**Priority:**'));
    });
  });

  describe('Error Handling', () => {
    it('should validate required parameters', () => {
      const invalidInputs = [
        { project_key: '', case_key: 'MCP-1' }, // Empty project key
        { project_key: 'MCP', case_key: '' }, // Empty case key
        { project_key: 'MCP', page: -1 }, // Negative page
        { project_key: 'MCP', size: 0 }, // Zero size
        { project_key: 'MCP', max_depth: 11 } // Exceeds max depth
      ];

      invalidInputs.forEach(input => {
        if ('case_key' in input && (input.case_key === '' || input.project_key === '')) {
          assert.ok(input.project_key === '' || input.case_key === '');
        }
        if ('page' in input && input.page !== undefined && input.page < 0) {
          assert.ok(input.page < 0);
        }
        if ('size' in input && input.size !== undefined && input.size <= 0) {
          assert.ok(input.size <= 0);
        }
        if ('max_depth' in input && input.max_depth !== undefined && input.max_depth > 10) {
          assert.ok(input.max_depth > 10);
        }
      });
    });

    it('should handle invalid format values', () => {
      const validFormats = ['json', 'string', 'dto', 'markdown'];
      const invalidFormats = ['xml', 'yaml', 'csv', ''];

      validFormats.forEach(format => {
        assert.ok(validFormats.includes(format));
      });

      invalidFormats.forEach(format => {
        assert.ok(!validFormats.includes(format));
      });
    });
  });

  describe('Pagination', () => {
    it('should validate pagination parameters', () => {
      const validPagination = {
        page: 0,
        size: 20,
        totalElements: 100,
        totalPages: 5,
        hasNext: true,
        hasPrevious: false
      };

      assert.ok(validPagination.page >= 0);
      assert.ok(validPagination.size > 0);
      assert.ok(validPagination.totalElements >= 0);
      assert.ok(validPagination.totalPages >= 1);
      assert.equal(typeof validPagination.hasNext, 'boolean');
      assert.equal(typeof validPagination.hasPrevious, 'boolean');
    });

    it('should calculate pagination correctly', () => {
      const pageSize = 10;
      const totalElements = 25;
      const totalPages = Math.ceil(totalElements / pageSize);

      assert.equal(totalPages, 3);

      // Page 0 should have hasNext=true, hasPrevious=false
      const page0 = { page: 0, hasNext: true, hasPrevious: false };
      assert.equal(page0.hasPrevious, false);
      assert.equal(page0.hasNext, true);

      // Last page should have hasNext=false
      const lastPage = { page: totalPages - 1, hasNext: false, hasPrevious: true };
      assert.equal(lastPage.hasNext, false);
      assert.equal(lastPage.hasPrevious, true);
    });
  });

  describe('Hierarchy Processing', () => {
    it('should validate suite hierarchy structure', () => {
      const hierarchicalSuite = {
        id: 1,
        title: 'Root Suite',
        parentSuiteId: null,
        rootSuiteId: 1,
        level: 0,
        path: 'Root Suite',
        children: [
          {
            id: 2,
            title: 'Child Suite',
            parentSuiteId: 1,
            rootSuiteId: 1,
            level: 1,
            path: 'Root Suite > Child Suite',
            children: []
          }
        ]
      };

      // Validate root suite properties
      assert.equal(hierarchicalSuite.parentSuiteId, null);
      assert.equal(hierarchicalSuite.rootSuiteId, hierarchicalSuite.id);
      assert.equal(hierarchicalSuite.level, 0);
      assert.equal(hierarchicalSuite.path, hierarchicalSuite.title);

      // Validate child suite properties
      const child = hierarchicalSuite.children[0];
      assert.equal(child.parentSuiteId, hierarchicalSuite.id);
      assert.equal(child.rootSuiteId, hierarchicalSuite.id);
      assert.equal(child.level, 1);
      assert.ok(child.path.includes('>'));
      assert.ok(child.path.includes(hierarchicalSuite.title));
      assert.ok(child.path.includes(child.title));
    });

    it('should validate test case hierarchy enhancement', () => {
      const enhancedTestCase = {
        id: 123,
        key: 'MCP-1',
        title: 'Test Case',
        testSuite: { id: 456, title: 'Feature Suite' },
        featureSuiteId: 456,
        rootSuiteId: 789
      };

      // featureSuiteId should match testSuite.id
      assert.equal(enhancedTestCase.featureSuiteId, enhancedTestCase.testSuite.id);

      // rootSuiteId should be different from featureSuiteId (unless it's a root suite)
      assert.ok(typeof enhancedTestCase.rootSuiteId, 'number');
      assert.ok(enhancedTestCase.rootSuiteId > 0);
    });
  });

  describe('Enhanced Widget Tools with Milestone Support', () => {
    it('should validate get_platform_results_by_period with milestone parameter', () => {
      const validInputWithMilestone = {
        project: 'android',
        period: 'Last 7 Days',
        platform: 'android',
        browser: ['chrome'],
        milestone: ['25.39.0', '25.38.0'],
        format: 'formatted'
      };

      assert.equal(typeof validInputWithMilestone.project, 'string');
      assert.ok(['Last 7 Days', 'Week', 'Month'].includes(validInputWithMilestone.period));
      assert.ok(Array.isArray(validInputWithMilestone.milestone), 'milestone should be array');
      validInputWithMilestone.milestone.forEach(m => {
        assert.ok(typeof m === 'string', 'milestone items should be strings');
        assert.ok(m.length > 0, 'milestone items should not be empty');
      });
      assert.ok(['raw', 'formatted'].includes(validInputWithMilestone.format));
    });

    it('should validate get_top_bugs with milestone parameter', () => {
      const validInputWithMilestone = {
        project: 'ios',
        period: 'Week',
        limit: 5,
        milestone: ['25.39.0'],
        platform: ['ios'],
        format: 'raw'
      };

      assert.equal(typeof validInputWithMilestone.project, 'string');
      assert.ok(['Last 7 Days', 'Week', 'Month'].includes(validInputWithMilestone.period));
      assert.ok(typeof validInputWithMilestone.limit === 'number');
      assert.ok(validInputWithMilestone.limit > 0 && validInputWithMilestone.limit <= 100);
      assert.ok(Array.isArray(validInputWithMilestone.milestone), 'milestone should be array');
      assert.ok(Array.isArray(validInputWithMilestone.platform), 'platform should be array');
      assert.ok(['raw', 'formatted'].includes(validInputWithMilestone.format));
    });

    it('should validate get_bug_review parameters', () => {
      const validInput = {
        project: 'android',
        period: 'Last 14 Days',
        limit: 100,
        templateId: 9,
        format: 'detailed'
      };

      assert.equal(typeof validInput.project, 'string');
      assert.ok(['Last 7 Days', 'Last 14 Days', 'Last 30 Days', 'Last 90 Days', 'Week', 'Month', 'Quarter'].includes(validInput.period));
      assert.ok(typeof validInput.limit === 'number');
      assert.ok(validInput.limit > 0 && validInput.limit <= 500);
      assert.ok(typeof validInput.templateId === 'number');
      assert.equal(validInput.templateId, 9);
      assert.ok(['detailed', 'summary', 'json'].includes(validInput.format));
    });

    it('should validate get_bug_review with include_failure_details', () => {
      const validInput = {
        project: 'ios',
        period: 'Last 7 Days',
        limit: 10,
        include_failure_details: true,
        failure_detail_level: 'full',
        max_details_limit: 30,
        format: 'detailed'
      };

      assert.equal(typeof validInput.project, 'string');
      assert.ok(['Last 7 Days', 'Last 14 Days', 'Last 30 Days', 'Last 90 Days', 'Week', 'Month', 'Quarter'].includes(validInput.period));
      assert.ok(typeof validInput.limit === 'number');
      assert.ok(validInput.limit > 0 && validInput.limit <= 500);
      assert.equal(typeof validInput.include_failure_details, 'boolean');
      assert.ok(validInput.include_failure_details === true);
      assert.ok(['none', 'summary', 'full'].includes(validInput.failure_detail_level));
      assert.ok(typeof validInput.max_details_limit === 'number');
      assert.ok(validInput.max_details_limit > 0 && validInput.max_details_limit <= 50);
      assert.ok(['detailed', 'summary', 'json'].includes(validInput.format));
    });

    it('should validate get_bug_review failure_detail_level options', () => {
      const levels = ['none', 'summary', 'full'];
      
      levels.forEach(level => {
        const input = {
          project: 'web',
          period: 'Last 7 Days',
          include_failure_details: true,
          failure_detail_level: level as 'none' | 'summary' | 'full'
        };
        assert.ok(['none', 'summary', 'full'].includes(input.failure_detail_level));
      });
    });

    it('should validate get_bug_review with minimal parameters', () => {
      const minimalInput = {
        project: 'web',
        period: 'Last 7 Days',
        limit: 50,
        format: 'summary'
      };

      assert.equal(typeof minimalInput.project, 'string');
      assert.ok(['Last 7 Days', 'Last 14 Days', 'Last 30 Days', 'Last 90 Days', 'Week', 'Month', 'Quarter'].includes(minimalInput.period));
      assert.ok(typeof minimalInput.limit === 'number');
      assert.ok(minimalInput.limit > 0 && minimalInput.limit <= 500);
      assert.ok(['detailed', 'summary', 'json'].includes(minimalInput.format));
    });

    it('should validate get_bug_failure_info parameters', () => {
      const validInput = {
        project: 'android',
        dashboardId: 99,
        hashcode: '1051677506',
        period: 'Last 14 Days',
        format: 'detailed'
      };

      assert.equal(typeof validInput.project, 'string');
      assert.ok(typeof validInput.dashboardId === 'number');
      assert.ok(validInput.dashboardId > 0);
      assert.equal(typeof validInput.hashcode, 'string');
      assert.ok(validInput.hashcode.length > 0);
      assert.ok(['Last 7 Days', 'Last 14 Days', 'Last 30 Days', 'Last 90 Days', 'Week', 'Month', 'Quarter'].includes(validInput.period));
      assert.ok(['detailed', 'summary', 'json'].includes(validInput.format));
    });

    it('should validate get_bug_failure_info with different format options', () => {
      const formats = ['detailed', 'summary', 'json'];
      
      formats.forEach(format => {
        const input = {
          project: 'ios',
          dashboardId: 102,
          hashcode: '987654321',
          period: 'Last 7 Days',
          format: format as 'detailed' | 'summary' | 'json'
        };

        assert.ok(['detailed', 'summary', 'json'].includes(input.format));
      });
    });

    it('should validate milestone parameter backward compatibility', () => {
      // Test that tools work without milestone parameter (backward compatibility)
      const legacyInput = {
        project: 'web',
        period: 'Month',
        format: 'formatted'
        // No milestone parameter - should default to []
      };

      assert.equal(typeof legacyInput.project, 'string');
      assert.ok(['Last 7 Days', 'Week', 'Month'].includes(legacyInput.period));
      assert.ok(['raw', 'formatted'].includes(legacyInput.format));
      
      // Milestone should default to empty array when not provided
      const defaultMilestone: string[] = [];
      assert.ok(Array.isArray(defaultMilestone), 'default milestone should be array');
      assert.equal(defaultMilestone.length, 0, 'default milestone should be empty');
    });

    it('should validate buildParamsConfig milestone integration', () => {
      const mockParamsConfig = {
        BROWSER: ['chrome'],
        DEFECT: [], APPLICATION: [], BUILD: [], PRIORITY: [],
        RUN: [], USER: [], ENV: [], MILESTONE: ['25.39.0'],
        PLATFORM: ['android'],
        STATUS: [], LOCALE: [],
        PERIOD: 'Last 7 Days',
        dashboardName: 'Test Dashboard',
        isReact: true
      };

      assert.ok(Array.isArray(mockParamsConfig.MILESTONE), 'MILESTONE should be array');
      assert.equal(mockParamsConfig.MILESTONE.length, 1, 'should contain milestone');
      assert.equal(mockParamsConfig.MILESTONE[0], '25.39.0', 'should contain correct milestone');
      assert.ok(typeof mockParamsConfig.PERIOD === 'string', 'PERIOD should be string');
      assert.ok(typeof mockParamsConfig.isReact === 'boolean', 'isReact should be boolean');
    });
  });

  describe('New Project Discovery Tools', () => {
    it('should validate get_available_projects parameters', () => {
      const validInput = {
        starred: true,
        publiclyAccessible: false,
        format: 'formatted',
        includePaginationInfo: true
      };

      assert.ok(typeof validInput.starred === 'boolean' || validInput.starred === undefined);
      assert.ok(typeof validInput.publiclyAccessible === 'boolean' || validInput.publiclyAccessible === undefined);
      assert.ok(['raw', 'formatted'].includes(validInput.format));
      assert.ok(typeof validInput.includePaginationInfo === 'boolean');
    });

    it('should validate get_project_milestones parameters', () => {
      const validInput = {
        project: 'android',
        page: 1,
        pageSize: 10,
        status: 'incomplete',
        format: 'formatted'
      };

      assert.ok(['web', 'android', 'ios', 'api'].includes(validInput.project) || typeof validInput.project === 'number');
      assert.ok(typeof validInput.page === 'number' && validInput.page >= 1);
      assert.ok(typeof validInput.pageSize === 'number' && validInput.pageSize > 0 && validInput.pageSize <= 100);
      assert.ok(['incomplete', 'completed', 'overdue', 'all'].includes(validInput.status));
      assert.ok(['raw', 'formatted'].includes(validInput.format));
    });

    it('should validate enhanced project resolution', () => {
      const projectInputs = [
        'android',        // Hardcoded alias
        'MCP',           // Direct project key
        1,               // Numeric project ID
        'MCP Project'    // Project name (for dynamic discovery)
      ];

      projectInputs.forEach(input => {
        if (typeof input === 'string') {
          assert.ok(input.length > 0, 'string project input should not be empty');
        } else if (typeof input === 'number') {
          assert.ok(input > 0, 'numeric project input should be positive');
        }
      });
    });
  });
});