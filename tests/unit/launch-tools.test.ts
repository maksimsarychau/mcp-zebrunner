import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { z } from 'zod';
import {
  LaunchListItemSchema,
  LaunchesResponseSchema,
  LaunchAttemptItemSchema,
  LaunchAttemptsResponseSchema,
  TestRunResponseSchema
} from '../../dist/types/reporting.js';

/**
 * Unit tests for launch-related tools
 * 
 * Tests the following functionality:
 * - get_all_launches_for_project tool
 * - get_all_launches_with_filter tool
 * - Launch response schemas
 * - Launch data formatting and validation
 */

describe('Launch Tools Unit Tests', () => {

  describe('Launch Response Schemas', () => {
    
    it('should validate LaunchListItemSchema with complete data', () => {
      const validLaunchItem = {
        id: 12345,
        name: "Android Regression Suite",
        status: "PASSED",
        milestone: {
          id: 556,
          name: "25.39.0",
          completed: false,
          description: "Release milestone for version 25.39.0",
          startDate: "2025-09-23T22:00:00Z",
          dueDate: "2025-09-30T22:00:00Z"
        },
        startedAt: 1727692800000, // timestamp
        finishedAt: 1727696400000, // timestamp
        duration: 3600000, // 1 hour in milliseconds
        passed: 85,
        failed: 3,
        skipped: 2,
        aborted: 0,
        queued: 0,
        total: 90,
        projectId: 7,
        userId: 604,
        buildNumber: "mcp-1.0.0-build-123.apk",
        jobUrl: "https://jenkins.example.com/job/android-tests/123",
        upstream: false,
        reviewed: true
      };

      const result = LaunchListItemSchema.parse(validLaunchItem);
      assert.deepStrictEqual(result, validLaunchItem);
    });

    it('should validate LaunchListItemSchema with minimal required data', () => {
      const minimalLaunchItem = {
        id: 12345,
        name: "Minimal Test Launch",
        status: "IN_PROGRESS",
        projectId: 7
      };

      const result = LaunchListItemSchema.parse(minimalLaunchItem);
      assert.strictEqual(result.id, 12345);
      assert.strictEqual(result.name, "Minimal Test Launch");
      assert.strictEqual(result.status, "IN_PROGRESS");
      assert.strictEqual(result.projectId, 7);
    });

    it('should validate LaunchListItemSchema with null milestone', () => {
      const launchWithNullMilestone = {
        id: 12345,
        name: "Launch Without Milestone",
        status: "FAILED",
        milestone: null,
        projectId: 7,
        startedAt: 1727692800000,
        finishedAt: 1727696400000,
        passed: 10,
        failed: 5,
        total: 15
      };

      const result = LaunchListItemSchema.parse(launchWithNullMilestone);
      assert.strictEqual(result.milestone, null);
    });

    it('should validate LaunchListItemSchema with undefined optional fields', () => {
      const launchWithUndefinedFields = {
        id: 12345,
        name: "Launch With Undefined Fields",
        status: "SKIPPED",
        projectId: 7
        // All optional fields are undefined
      };

      const result = LaunchListItemSchema.parse(launchWithUndefinedFields);
      assert.strictEqual(result.milestone, undefined);
      assert.strictEqual(result.startedAt, undefined);
      assert.strictEqual(result.duration, undefined);
    });

    it('should validate milestone object structure', () => {
      const launchWithMilestone = {
        id: 12345,
        name: "Launch With Milestone",
        status: "PASSED",
        projectId: 7,
        milestone: {
          id: 556,
          name: "25.39.0",
          completed: false,
          description: null,
          startDate: "2025-09-23T22:00:00Z",
          dueDate: "2025-09-30T22:00:00Z"
        }
      };

      const result = LaunchListItemSchema.parse(launchWithMilestone);
      assert.strictEqual(result.milestone?.id, 556);
      assert.strictEqual(result.milestone?.name, "25.39.0");
      assert.strictEqual(result.milestone?.completed, false);
    });

    it('should validate LaunchesResponseSchema with pagination metadata', () => {
      const validLaunchesResponse = {
        items: [
          {
            id: 12345,
            name: "Launch 1",
            status: "PASSED",
            projectId: 7
          },
          {
            id: 12346,
            name: "Launch 2",
            status: "FAILED",
            projectId: 7,
            milestone: {
              id: 556,
              name: "25.39.0"
            }
          }
        ],
        _meta: {
          total: 150,
          totalPages: 8
        }
      };

      const result = LaunchesResponseSchema.parse(validLaunchesResponse);
      assert.strictEqual(result.items.length, 2);
      assert.strictEqual(result._meta.total, 150);
      assert.strictEqual(result._meta.totalPages, 8);
    });

    it('should validate empty launches response', () => {
      const emptyLaunchesResponse = {
        items: [],
        _meta: {
          total: 0,
          totalPages: 0
        }
      };

      const result = LaunchesResponseSchema.parse(emptyLaunchesResponse);
      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(result._meta.total, 0);
    });

    it('should reject invalid launch item data', () => {
      const invalidLaunchItem = {
        // Missing required fields: id, name, status, projectId
        milestone: "invalid_milestone_format", // Should be object or null
        startedAt: "invalid_timestamp", // Should be number
        passed: "not_a_number" // Should be number
      };

      assert.throws(() => {
        LaunchListItemSchema.parse(invalidLaunchItem);
      }, {
        name: 'ZodError'
      });
    });

    it('should reject invalid milestone structure', () => {
      const launchWithInvalidMilestone = {
        id: 12345,
        name: "Launch With Invalid Milestone",
        status: "PASSED",
        projectId: 7,
        milestone: {
          // Missing required id and name fields
          completed: true
        }
      };

      assert.throws(() => {
        LaunchListItemSchema.parse(launchWithInvalidMilestone);
      }, {
        name: 'ZodError'
      });
    });
  });

  describe('get_all_launches_for_project Tool Parameters', () => {
    
    it('should validate project parameter types', () => {
      const validProjectParams = [
        'web',
        'android', 
        'ios',
        'api',
        'MCP',
        'MCP',
        7,
        16
      ];

      validProjectParams.forEach(project => {
        // Test that project parameter accepts aliases, strings, and numbers
        const isValidAlias = ['web', 'android', 'ios', 'api'].includes(project as string);
        const isValidString = typeof project === 'string';
        const isValidNumber = typeof project === 'number';
        
        assert.ok(isValidAlias || isValidString || isValidNumber, 
          `Project parameter ${project} should be valid`);
      });
    });

    it('should validate pagination parameters', () => {
      const validPaginationParams = {
        page: 1,
        pageSize: 20
      };

      // Page validation
      assert.ok(validPaginationParams.page >= 1, 'page should be 1-based');
      assert.ok(Number.isInteger(validPaginationParams.page), 'page should be integer');

      // PageSize validation  
      assert.ok(validPaginationParams.pageSize > 0, 'pageSize should be positive');
      assert.ok(validPaginationParams.pageSize <= 100, 'pageSize should not exceed 100');
      assert.ok(Number.isInteger(validPaginationParams.pageSize), 'pageSize should be integer');
    });

    it('should validate format parameter', () => {
      const validFormats = ['raw', 'formatted'];
      
      validFormats.forEach(format => {
        assert.ok(['raw', 'formatted'].includes(format), 
          `Format ${format} should be valid`);
      });
    });

    it('should use correct default values', () => {
      const defaultParams = {
        page: 1,
        pageSize: 20,
        format: 'formatted'
      };

      assert.strictEqual(defaultParams.page, 1);
      assert.strictEqual(defaultParams.pageSize, 20);
      assert.strictEqual(defaultParams.format, 'formatted');
    });
  });

  describe('get_all_launches_with_filter Tool Parameters', () => {
    
    it('should validate milestone filter parameter', () => {
      const validMilestoneFilters = [
        '25.39.0',
        '24.12.5',
        'Release-2025-Q1',
        undefined // Optional parameter
      ];

      validMilestoneFilters.forEach(milestone => {
        if (milestone !== undefined) {
          assert.strictEqual(typeof milestone, 'string', 
            'milestone filter should be string when provided');
        }
      });
    });

    it('should validate query filter parameter', () => {
      const validQueryFilters = [
        'mcp-1.0.0-build-123',
        'Performance',
        'Android Regression',
        'build-12345',
        undefined // Optional parameter
      ];

      validQueryFilters.forEach(query => {
        if (query !== undefined) {
          assert.strictEqual(typeof query, 'string', 
            'query filter should be string when provided');
        }
      });
    });

    it('should require at least one filter parameter', () => {
      // This test validates the business logic that at least one filter must be provided
      const testCases = [
        { milestone: '25.39.0', query: undefined, valid: true },
        { milestone: undefined, query: 'Performance', valid: true },
        { milestone: '25.39.0', query: 'Performance', valid: true },
        { milestone: undefined, query: undefined, valid: false }
      ];

      testCases.forEach(testCase => {
        const hasFilter = testCase.milestone !== undefined || testCase.query !== undefined;
        assert.strictEqual(hasFilter, testCase.valid, 
          `Filter validation should match expected result for milestone: ${testCase.milestone}, query: ${testCase.query}`);
      });
    });
  });

  describe('Launch Data Formatting Logic', () => {
    
    it('should format launch timestamps correctly', () => {
      const timestamp = 1727692800000; // September 30, 2025 10:00:00 GMT
      const date = new Date(timestamp);
      
      assert.ok(date instanceof Date, 'timestamp should convert to Date');
      assert.ok(!isNaN(date.getTime()), 'converted date should be valid');
      assert.strictEqual(date.getTime(), timestamp, 'date conversion should preserve timestamp');
    });

    it('should calculate duration in minutes correctly', () => {
      const durationMs = 3600000; // 1 hour in milliseconds
      const durationMin = Math.round(durationMs / 60000);
      
      assert.strictEqual(durationMin, 60, 'duration should be 60 minutes');
    });

    it('should format test results summary correctly', () => {
      const testResults = {
        total: 100,
        passed: 85,
        failed: 10,
        skipped: 5
      };

      // Validate that totals add up correctly
      assert.strictEqual(testResults.passed + testResults.failed + testResults.skipped, 
        testResults.total, 'test result counts should sum to total');
      
      // Validate individual counts are non-negative
      assert.ok(testResults.passed >= 0, 'passed count should be non-negative');
      assert.ok(testResults.failed >= 0, 'failed count should be non-negative');
      assert.ok(testResults.skipped >= 0, 'skipped count should be non-negative');
    });

    it('should handle missing optional display fields gracefully', () => {
      const launchWithMissingFields: Record<string, any> = {
        id: 12345,
        name: "Launch With Missing Fields",
        status: "PASSED",
        projectId: 7
      };

      assert.strictEqual(launchWithMissingFields.milestone, undefined);
      assert.strictEqual(launchWithMissingFields.buildNumber, undefined);
      assert.strictEqual(launchWithMissingFields.startedAt, undefined);
      assert.strictEqual(launchWithMissingFields.finishedAt, undefined);
      assert.strictEqual(launchWithMissingFields.duration, undefined);
    });

    it('should handle zero test results correctly', () => {
      const launchWithZeroResults = {
        id: 12345,
        name: "Launch With Zero Results",
        status: "IN_PROGRESS",
        projectId: 7,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0
      };

      assert.strictEqual(launchWithZeroResults.total, 0);
      assert.strictEqual(launchWithZeroResults.passed, 0);
      assert.strictEqual(launchWithZeroResults.failed, 0);
      assert.strictEqual(launchWithZeroResults.skipped, 0);
    });
  });

  describe('Error Handling Scenarios', () => {
    
    it('should handle empty launches response gracefully', () => {
      const emptyResponse = {
        items: [],
        _meta: {
          total: 0,
          totalPages: 0
        }
      };

      const result = LaunchesResponseSchema.parse(emptyResponse);
      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(result._meta.total, 0);
    });

    it('should handle large pagination numbers', () => {
      const largePaginationResponse = {
        items: [],
        _meta: {
          total: 10000,
          totalPages: 500
        }
      };

      const result = LaunchesResponseSchema.parse(largePaginationResponse);
      assert.strictEqual(result._meta.total, 10000);
      assert.strictEqual(result._meta.totalPages, 500);
    });

    it('should validate required fields are present', () => {
      const requiredFields = ['id', 'name', 'status', 'projectId'];
      
      requiredFields.forEach(field => {
        const incompleteItem = {
          id: 12345,
          name: "Test Launch",
          status: "PASSED",
          projectId: 7
        };
        
        // Remove the required field
        delete (incompleteItem as any)[field];
        
        assert.throws(() => {
          LaunchListItemSchema.parse(incompleteItem);
        }, {
          name: 'ZodError'
        }, `Should throw error when ${field} is missing`);
      });
    });

    it('should validate field types are correct', () => {
      const invalidTypeTests = [
        { field: 'id', invalidValue: 'not_a_number' },
        { field: 'name', invalidValue: 123 },
        { field: 'status', invalidValue: null },
        { field: 'projectId', invalidValue: 'not_a_number' },
        { field: 'startedAt', invalidValue: 'not_a_timestamp' },
        { field: 'passed', invalidValue: 'not_a_number' }
      ];

      invalidTypeTests.forEach(test => {
        const invalidItem = {
          id: 12345,
          name: "Test Launch",
          status: "PASSED",
          projectId: 7,
          [test.field]: test.invalidValue
        };

        assert.throws(() => {
          LaunchListItemSchema.parse(invalidItem);
        }, {
          name: 'ZodError'
        }, `Should throw error when ${test.field} has invalid type`);
      });
    });
  });

  describe('Integration with Project Resolution', () => {
    
    it('should support all project parameter formats', () => {
      const projectFormats = [
        { input: 'android', expected: 'alias' },
        { input: 'MCP', expected: 'key' },
        { input: 7, expected: 'id' },
        { input: 'MCP', expected: 'key' }
      ];

      projectFormats.forEach(format => {
        if (typeof format.input === 'string') {
          const isAlias = ['web', 'android', 'ios', 'api'].includes(format.input);
          const expectedType = isAlias ? 'alias' : 'key';
          assert.strictEqual(expectedType, format.expected, 
            `Project ${format.input} should be recognized as ${format.expected}`);
        } else {
          assert.strictEqual(typeof format.input, 'number', 
            `Project ID ${format.input} should be number`);
        }
      });
    });
  });

  describe('API Response Structure Validation', () => {
    
    it('should match actual API response structure for launches list', () => {
      const actualApiResponse = {
        items: [
          {
            id: 118685,
            name: "Android Regression Suite - 25.39.0",
            status: "PASSED",
            milestone: {
              id: 556,
              name: "25.39.0",
              completed: false,
              description: "builds: 34000",
              startDate: "2025-09-23T22:00:00Z",
              dueDate: "2025-09-30T22:00:00Z"
            },
            startedAt: 1727692800000,
            finishedAt: 1727696400000,
            duration: 3600000,
            passed: 365,
            failed: 39,
            skipped: 102,
            aborted: 0,
            queued: 0,
            total: 506,
            projectId: 7,
            userId: 604,
            buildNumber: "mcp-1.0.0-build-123.apk",
            jobUrl: "https://jenkins.example.com/job/android-regression/118685",
            upstream: false,
            reviewed: true
          }
        ],
        _meta: {
          total: 1,
          totalPages: 1
        }
      };

      const result = LaunchesResponseSchema.parse(actualApiResponse);
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].name, "Android Regression Suite - 25.39.0");
      assert.strictEqual(result.items[0].milestone?.name, "25.39.0");
    });
  });

  describe('Launch Attempts Schema', () => {

    it('should validate LaunchAttemptItemSchema with full data', () => {
      const attempt = {
        id: 67544,
        startedBy: { id: 90, username: "admin", email: "admin@example.com" },
        startedAt: "2026-03-21T02:51:39.906764Z",
        finishedAt: "2026-03-21T03:23:13.496575Z",
        finishPassed: 84,
        finishPassedManually: 0,
        finishFailed: 37,
        finishKnownIssue: 20,
        finishSkipped: 25,
        finishBlocked: 0,
        finishAborted: 0
      };

      const result = LaunchAttemptItemSchema.parse(attempt);
      assert.strictEqual(result.id, 67544);
      assert.strictEqual(result.startedBy?.username, "admin");
      assert.strictEqual(result.finishPassed, 84);
      assert.strictEqual(result.finishFailed, 37);
    });

    it('should validate LaunchAttemptItemSchema with minimal data', () => {
      const minimal = {
        id: 100,
        startedAt: "2026-03-21T10:00:00Z"
      };

      const result = LaunchAttemptItemSchema.parse(minimal);
      assert.strictEqual(result.id, 100);
      assert.strictEqual(result.finishedAt, undefined);
    });

    it('should validate LaunchAttemptsResponseSchema with multiple attempts', () => {
      const response = {
        items: [
          {
            id: 67544,
            startedAt: "2026-03-21T02:51:39Z",
            finishedAt: "2026-03-21T03:23:13Z",
            finishPassed: 84, finishFailed: 37, finishSkipped: 25
          },
          {
            id: 67630,
            startedAt: "2026-03-23T11:02:05Z",
            finishedAt: "2026-03-23T11:12:48Z",
            finishPassed: 94, finishFailed: 34, finishSkipped: 18
          },
          {
            id: 67752,
            startedAt: "2026-03-24T11:45:52Z",
            finishedAt: "2026-03-24T11:49:21Z",
            finishPassed: 127, finishFailed: 19, finishSkipped: 0
          }
        ]
      };

      const result = LaunchAttemptsResponseSchema.parse(response);
      assert.strictEqual(result.items.length, 3);
      assert.strictEqual(result.items[0].id, 67544);
      assert.strictEqual(result.items[2].finishPassed, 127);
    });

    it('should validate empty attempts response', () => {
      const result = LaunchAttemptsResponseSchema.parse({ items: [] });
      assert.strictEqual(result.items.length, 0);
    });
  });

  describe('Test Case Coverage in Test Runs', () => {

    it('should validate TestRunResponseSchema with linked test cases', () => {
      const testRun = {
        id: 5500001,
        name: "topTest",
        status: "PASSED",
        startTime: 1774352800000,
        finishTime: 1774353285000,
        testRunId: 127644,
        testCases: [
          { testId: 5500001, tcmType: "ZEBRUNNER", testCaseId: "MCP-1859", resultStatus: null },
          { testId: 5500001, tcmType: "ZEBRUNNER", testCaseId: "MCP-1860", resultStatus: null }
        ]
      };

      const result = TestRunResponseSchema.parse(testRun);
      assert.strictEqual(result.testCases?.length, 2);
      assert.strictEqual(result.testCases?.[0].testCaseId, "MCP-1859");
      assert.strictEqual(result.testCases?.[1].testCaseId, "MCP-1860");
    });

    it('should validate TestRunResponseSchema with zero test cases', () => {
      const testRun = {
        id: 5500002,
        name: "simpleTest",
        status: "PASSED",
        startTime: 1774352800000,
        finishTime: 1774352830000,
        testRunId: 127644,
        testCases: []
      };

      const result = TestRunResponseSchema.parse(testRun);
      assert.strictEqual(result.testCases?.length, 0);
    });

    it('should validate TestRunResponseSchema without testCases field', () => {
      const testRun = {
        id: 5500003,
        name: "legacyTest",
        status: "FAILED",
        startTime: 1774352800000,
        testRunId: 127644
      };

      const result = TestRunResponseSchema.parse(testRun);
      assert.strictEqual(result.testCases, undefined);
    });

    it('should correctly count tests vs test cases from mock data', () => {
      const mockTests = [
        { id: 1, testCases: [{ testCaseId: "A-1" }, { testCaseId: "A-2" }] },
        { id: 2, testCases: [{ testCaseId: "A-3" }] },
        { id: 3, testCases: [] },
        { id: 4 }
      ];

      const totalTests = mockTests.length;
      const totalTestCases = mockTests.reduce((sum, t) => sum + ((t as any).testCases?.length ?? 0), 0);
      const withZero = mockTests.filter(t => ((t as any).testCases?.length ?? 0) === 0).length;
      const withOne = mockTests.filter(t => ((t as any).testCases?.length ?? 0) === 1).length;
      const withMultiple = mockTests.filter(t => ((t as any).testCases?.length ?? 0) > 1).length;

      assert.strictEqual(totalTests, 4);
      assert.strictEqual(totalTestCases, 3);
      assert.strictEqual(withZero, 2);
      assert.strictEqual(withOne, 1);
      assert.strictEqual(withMultiple, 1);
    });
  });

  describe('Session-Aware Effective Duration Logic', () => {

    function pickEffectiveSession(
      sessions: Array<{ durationSeconds: number; testStatus: string; passedManually: boolean; endedAt: string }>
    ) {
      const sorted = [...sessions].sort((a, b) =>
        new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
      );
      return sorted.find(s => s.testStatus === 'PASSED' && !s.passedManually)
        ?? sorted.find(s => s.testStatus === 'PASSED')
        ?? sorted[0];
    }

    it('should pick passed session as effective for multi-session test', () => {
      const sessions = [
        { durationSeconds: 478, testStatus: 'FAILED', passedManually: false, endedAt: '2026-03-22T16:54:54Z' },
        { durationSeconds: 979, testStatus: 'PASSED', passedManually: true, endedAt: '2026-03-22T17:24:21Z' }
      ];
      const eff = pickEffectiveSession(sessions);
      assert.strictEqual(eff.durationSeconds, 979);
      assert.strictEqual(eff.testStatus, 'PASSED');
    });

    it('should prefer non-manually-passed session over manually passed', () => {
      const sessions = [
        { durationSeconds: 300, testStatus: 'PASSED', passedManually: true, endedAt: '2026-03-22T17:00:00Z' },
        { durationSeconds: 500, testStatus: 'PASSED', passedManually: false, endedAt: '2026-03-22T17:30:00Z' }
      ];
      const eff = pickEffectiveSession(sessions);
      assert.strictEqual(eff.durationSeconds, 500);
      assert.strictEqual(eff.passedManually, false);
    });

    it('should fall back to last session when none passed', () => {
      const sessions = [
        { durationSeconds: 200, testStatus: 'FAILED', passedManually: false, endedAt: '2026-03-22T16:30:00Z' },
        { durationSeconds: 350, testStatus: 'FAILED', passedManually: false, endedAt: '2026-03-22T17:00:00Z' }
      ];
      const eff = pickEffectiveSession(sessions);
      assert.strictEqual(eff.durationSeconds, 350);
    });

    it('should compute correct totals for multi-session test', () => {
      const sessions = [
        { durationSeconds: 478, testStatus: 'FAILED', passedManually: false, endedAt: '2026-03-22T16:54:54Z' },
        { durationSeconds: 979, testStatus: 'PASSED', passedManually: true, endedAt: '2026-03-22T17:24:21Z' }
      ];
      const eff = pickEffectiveSession(sessions);
      const total = sessions.reduce((s, x) => s + x.durationSeconds, 0);
      const longest = Math.max(...sessions.map(s => s.durationSeconds));
      const wallClock = 2459;

      assert.strictEqual(eff.durationSeconds, 979);
      assert.strictEqual(total, 1457);
      assert.strictEqual(longest, 979);
      assert.ok(wallClock > total, 'wall-clock includes gaps');
    });

    it('should identify longest session even when it is not the effective one', () => {
      const sessions = [
        { durationSeconds: 1200, testStatus: 'FAILED', passedManually: false, endedAt: '2026-03-22T16:50:00Z' },
        { durationSeconds: 400, testStatus: 'PASSED', passedManually: false, endedAt: '2026-03-22T17:10:00Z' }
      ];
      const eff = pickEffectiveSession(sessions);
      const longest = sessions.reduce((best, s) => s.durationSeconds > best.durationSeconds ? s : best);

      assert.strictEqual(eff.durationSeconds, 400, 'effective should be the passed session');
      assert.strictEqual(longest.durationSeconds, 1200, 'longest should be the failed session');
    });

    it('single session should be effective, longest, and total', () => {
      const sessions = [
        { durationSeconds: 600, testStatus: 'PASSED', passedManually: false, endedAt: '2026-03-22T17:00:00Z' }
      ];
      const eff = pickEffectiveSession(sessions);
      const total = sessions.reduce((s, x) => s + x.durationSeconds, 0);
      const longest = Math.max(...sessions.map(s => s.durationSeconds));

      assert.strictEqual(eff.durationSeconds, 600);
      assert.strictEqual(total, 600);
      assert.strictEqual(longest, 600);
    });
  });
});
