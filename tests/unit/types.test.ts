import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  ZebrunnerTestCaseSchema,
  ZebrunnerTestSuiteSchema,
  ZebrunnerTestRunSchema,
  ZebrunnerTestResultResponseSchema,
  ZebrunnerUserSchema,
  ZebrunnerPrioritySchema,
  ZebrunnerAutomationStateSchema,
  ZebrunnerCaseStepSchema,
  MetaSchema,
  PagedResponseSchema
} from '../../src/types/core.js';

describe('Zod Schema Validation', () => {
  describe('ZebrunnerUserSchema', () => {
    it('should validate valid user object', () => {
      const validUser = {
        id: 123,
        username: 'john.doe',
        email: 'john.doe@example.com'
      };
      
      const result = ZebrunnerUserSchema.safeParse(validUser);
      assert.ok(result.success);
      assert.deepEqual(result.data, validUser);
    });

    it('should reject user without required fields', () => {
      const invalidUser = {
        username: 'john.doe'
        // Missing id and email
      };
      
      const result = ZebrunnerUserSchema.safeParse(invalidUser);
      assert.ok(!result.success);
    });

    it('should reject user with wrong types', () => {
      const invalidUser = {
        id: 'not-a-number',
        username: 123,
        email: 'john.doe@example.com'
      };
      
      const result = ZebrunnerUserSchema.safeParse(invalidUser);
      assert.ok(!result.success);
    });
  });

  describe('ZebrunnerPrioritySchema', () => {
    it('should validate valid priority object', () => {
      const validPriority = {
        id: 1,
        name: 'High'
      };
      
      const result = ZebrunnerPrioritySchema.safeParse(validPriority);
      assert.ok(result.success);
      assert.deepEqual(result.data, validPriority);
    });
  });

  describe('ZebrunnerAutomationStateSchema', () => {
    it('should validate valid automation state object', () => {
      const validState = {
        id: 2,
        name: 'Automated'
      };
      
      const result = ZebrunnerAutomationStateSchema.safeParse(validState);
      assert.ok(result.success);
      assert.deepEqual(result.data, validState);
    });
  });

  describe('ZebrunnerCaseStepSchema', () => {
    it('should validate step with all optional fields', () => {
      const validStep = {
        stepNumber: 1,
        action: 'Click login button',
        expected: 'User is logged in',
        data: { username: 'test', password: 'test123' }
      };
      
      const result = ZebrunnerCaseStepSchema.safeParse(validStep);
      assert.ok(result.success);
      assert.deepEqual(result.data, validStep);
    });

    it('should validate step with alternative field names', () => {
      const validStep = {
        number: 2,
        actionText: 'Fill form',
        expectedResult: 'Form is filled',
        inputs: ['username', 'password']
      };
      
      const result = ZebrunnerCaseStepSchema.safeParse(validStep);
      assert.ok(result.success);
    });

    it('should validate empty step object', () => {
      const emptyStep = {};
      
      const result = ZebrunnerCaseStepSchema.safeParse(emptyStep);
      assert.ok(result.success); // All fields are optional
    });
  });

  describe('ZebrunnerTestSuiteSchema', () => {
    it('should validate valid test suite', () => {
      const validSuite = {
        id: 456,
        title: 'Login Tests',
        description: 'Test suite for login functionality',
        parentSuiteId: 123,
        relativePosition: 1,
        projectId: 789,
        createdBy: {
          id: 1,
          username: 'creator',
          email: 'creator@example.com'
        }
      };
      
      const result = ZebrunnerTestSuiteSchema.safeParse(validSuite);
      assert.ok(result.success);
    });

    it('should validate minimal test suite', () => {
      const minimalSuite = {
        id: 456
      };
      
      const result = ZebrunnerTestSuiteSchema.safeParse(minimalSuite);
      assert.ok(result.success);
      assert.equal(result.data.id, 456);
    });

    it('should reject suite without id', () => {
      const invalidSuite = {
        title: 'Test Suite'
        // Missing required id
      };
      
      const result = ZebrunnerTestSuiteSchema.safeParse(invalidSuite);
      assert.ok(!result.success);
    });

    it('should handle hierarchical children', () => {
      const suiteWithChildren = {
        id: 1,
        title: 'Parent Suite',
        children: [
          {
            id: 2,
            title: 'Child Suite',
            parentSuiteId: 1
          }
        ]
      };
      
      const result = ZebrunnerTestSuiteSchema.safeParse(suiteWithChildren);
      assert.ok(result.success);
    });
  });

  describe('ZebrunnerTestCaseSchema', () => {
    it('should validate complete test case', () => {
      const validTestCase = {
        id: 789,
        key: 'TC-123',
        title: 'Login Test',
        description: 'Test user login',
        priority: { id: 1, name: 'High' },
        automationState: { id: 2, name: 'Automated' },
        testSuite: { id: 456, title: 'Login Suite' },
        createdBy: { id: 1, username: 'creator', email: 'creator@example.com' },
        steps: [
          {
            stepNumber: 1,
            action: 'Navigate to login',
            expected: 'Login page loads'
          }
        ],
        customField: {
          'Test Type': 'Functional',
          'Browser': 'Chrome'
        }
      };
      
      const result = ZebrunnerTestCaseSchema.safeParse(validTestCase);
      assert.ok(result.success);
    });

    it('should validate test case with null values', () => {
      const testCaseWithNulls = {
        id: 127,
        key: 'MCP-1',
        title: 'Premium user test',
        description: null,
        preConditions: null,
        postConditions: null,
        deleted: false,
        priority: { id: 16, name: 'Medium' },
        automationState: { id: 12, name: 'Automated' }
      };
      
      const result = ZebrunnerTestCaseSchema.safeParse(testCaseWithNulls);
      assert.ok(result.success);
    });

    it('should validate minimal test case', () => {
      const minimalTestCase = {
        id: 789
      };
      
      const result = ZebrunnerTestCaseSchema.safeParse(minimalTestCase);
      assert.ok(result.success);
      assert.equal(result.data.id, 789);
    });

    it('should reject test case without id', () => {
      const invalidTestCase = {
        title: 'Test Case'
        // Missing required id
      };
      
      const result = ZebrunnerTestCaseSchema.safeParse(invalidTestCase);
      assert.ok(!result.success);
    });
  });

  describe('ZebrunnerTestRunSchema', () => {
    it('should validate complete test run', () => {
      const validTestRun = {
        id: 999,
        name: 'Regression Run',
        description: 'Full regression test run',
        status: 'PASSED',
        startedAt: '2024-01-15T10:00:00Z',
        endedAt: '2024-01-15T12:00:00Z',
        createdBy: { id: 1, username: 'runner', email: 'runner@example.com' },
        totalTests: 100,
        passedTests: 95,
        failedTests: 3,
        skippedTests: 2,
        milestone: 'v1.0',
        build: '1.0.123',
        environment: 'staging'
      };
      
      const result = ZebrunnerTestRunSchema.safeParse(validTestRun);
      assert.ok(result.success);
    });

    it('should validate minimal test run', () => {
      const minimalTestRun = {
        id: 999,
        name: 'Test Run',
        status: 'RUNNING'
      };
      
      const result = ZebrunnerTestRunSchema.safeParse(minimalTestRun);
      assert.ok(result.success);
    });

    it('should reject test run without required fields', () => {
      const invalidTestRun = {
        id: 999
        // Missing required name and status
      };
      
      const result = ZebrunnerTestRunSchema.safeParse(invalidTestRun);
      assert.ok(!result.success);
    });
  });

  describe('ZebrunnerTestResultResponseSchema', () => {
    it('should validate complete test result', () => {
      const validResult = {
        testCaseId: 123,
        testCaseKey: 'TC-123',
        testCaseTitle: 'Login Test',
        status: 'PASSED',
        executedAt: '2024-01-15T10:30:00Z',
        duration: 5000,
        message: 'Test passed successfully',
        issues: ['Minor UI glitch'],
        attachments: [{ name: 'screenshot.png', url: 'http://example.com/screenshot.png' }]
      };
      
      const result = ZebrunnerTestResultResponseSchema.safeParse(validResult);
      assert.ok(result.success);
    });

    it('should validate minimal test result', () => {
      const minimalResult = {
        testCaseId: 123,
        status: 'FAILED'
      };
      
      const result = ZebrunnerTestResultResponseSchema.safeParse(minimalResult);
      assert.ok(result.success);
    });

    it('should reject result without required fields', () => {
      const invalidResult = {
        testCaseKey: 'TC-123'
        // Missing required testCaseId and status
      };
      
      const result = ZebrunnerTestResultResponseSchema.safeParse(invalidResult);
      assert.ok(!result.success);
    });
  });

  describe('MetaSchema', () => {
    it('should validate complete pagination metadata', () => {
      const validMeta = {
        nextPageToken: 'next-token',
        previousPageToken: 'prev-token',
        totalElements: 100,
        totalPages: 10,
        currentPage: 5,
        pageSize: 10,
        hasNext: true,
        hasPrevious: true
      };
      
      const result = MetaSchema.safeParse(validMeta);
      assert.ok(result.success);
    });

    it('should validate empty metadata', () => {
      const emptyMeta = {};
      
      const result = MetaSchema.safeParse(emptyMeta);
      assert.ok(result.success); // All fields are optional
    });
  });

  describe('PagedResponseSchema', () => {
    it('should validate paged response with test cases', () => {
      const pagedResponse = {
        items: [
          { id: 1, title: 'Test Case 1' },
          { id: 2, title: 'Test Case 2' }
        ],
        _meta: {
          totalElements: 2,
          currentPage: 0,
          pageSize: 10
        }
      };
      
      const schema = PagedResponseSchema(ZebrunnerTestCaseSchema);
      const result = schema.safeParse(pagedResponse);
      assert.ok(result.success);
    });

    it('should validate paged response without metadata', () => {
      const pagedResponse = {
        items: [
          { id: 1, title: 'Test Suite 1' }
        ]
      };
      
      const schema = PagedResponseSchema(ZebrunnerTestSuiteSchema);
      const result = schema.safeParse(pagedResponse);
      assert.ok(result.success);
    });

    it('should reject paged response without items', () => {
      const invalidResponse = {
        _meta: { totalElements: 0 }
        // Missing required items array
      };
      
      const schema = PagedResponseSchema(ZebrunnerTestCaseSchema);
      const result = schema.safeParse(invalidResponse);
      assert.ok(!result.success);
    });

    it('should validate items according to provided schema', () => {
      const pagedResponse = {
        items: [
          { id: 1, name: 'Test Run 1', status: 'PASSED' }, // Valid test run
          { id: 'invalid', title: 'Invalid' } // Invalid test run (wrong id type)
        ]
      };
      
      const schema = PagedResponseSchema(ZebrunnerTestRunSchema);
      const result = schema.safeParse(pagedResponse);
      assert.ok(!result.success); // Should fail due to invalid item
    });
  });

  describe('Schema Integration', () => {
    it('should handle nested schema validation', () => {
      const testCaseWithNestedObjects = {
        id: 123,
        title: 'Complex Test Case',
        priority: { id: 1, name: 'High' },
        automationState: { id: 2, name: 'Automated' },
        createdBy: { id: 1, username: 'creator', email: 'creator@example.com' },
        testSuite: { id: 456, title: 'Test Suite' },
        steps: [
          {
            stepNumber: 1,
            action: 'Login',
            expected: 'Success',
            data: { user: 'test' }
          }
        ]
      };
      
      const result = ZebrunnerTestCaseSchema.safeParse(testCaseWithNestedObjects);
      assert.ok(result.success);
    });

    it('should provide detailed error information for invalid data', () => {
      const invalidTestCase = {
        id: 'not-a-number',
        priority: { name: 'High' }, // Missing id
        createdBy: { username: 'creator' } // Missing id and email
      };
      
      const result = ZebrunnerTestCaseSchema.safeParse(invalidTestCase);
      assert.ok(!result.success);
      assert.ok(result.error.issues.length > 0);
    });
  });
});
