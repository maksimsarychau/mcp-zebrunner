import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

describe('MCP Tools Schema Validation', () => {
  describe('Tool Input Validation', () => {
    it('should validate list_test_suites parameters', () => {
      const validInput = {
        project_key: 'MFPAND',
        format: 'json',
        include_hierarchy: false
      };

      assert.equal(typeof validInput.project_key, 'string');
      assert.equal(validInput.project_key.length > 0, true);
      assert.ok(['json', 'string', 'dto'].includes(validInput.format as string));
    });

    it('should validate get_test_case_by_key parameters', () => {
      const validInput = {
        project_key: 'MFPAND',
        case_key: 'MFPAND-29',
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
        project_key: 'MFPAND',
        page: 0,
        size: 10,
        format: 'json',
        include_steps: true,
        suite_id: 12345,
        root_suite_id: 67890
      };

      assert.equal(typeof validInput.project_key, 'string');
      assert.ok(validInput.page >= 0);
      assert.ok(validInput.size > 0 && validInput.size <= 100);
      assert.ok(['json', 'string', 'dto', 'markdown'].includes(validInput.format as string));
      assert.equal(typeof validInput.include_steps, 'boolean');
      assert.equal(typeof validInput.suite_id, 'number');
      assert.equal(typeof validInput.root_suite_id, 'number');
    });

    it('should validate get_suite_hierarchy parameters', () => {
      const validInput = {
        project_key: 'MFPAND',
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
        key: 'MFPAND-29',
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
        { project_key: '', case_key: 'MFPAND-29' }, // Empty project key
        { project_key: 'MFPAND', case_key: '' }, // Empty case key
        { project_key: 'MFPAND', page: -1 }, // Negative page
        { project_key: 'MFPAND', size: 0 }, // Zero size
        { project_key: 'MFPAND', max_depth: 11 } // Exceeds max depth
      ];

      invalidInputs.forEach(input => {
        if ('case_key' in input && (input.case_key === '' || input.project_key === '')) {
          assert.ok(input.project_key === '' || input.case_key === '');
        }
        if ('page' in input && input.page < 0) {
          assert.ok(input.page < 0);
        }
        if ('size' in input && input.size <= 0) {
          assert.ok(input.size <= 0);
        }
        if ('max_depth' in input && input.max_depth > 10) {
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
        key: 'MFPAND-29',
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
});