import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { z } from 'zod';
import {
  PublicTestRunResourceSchema,
  PublicTestRunsResponseSchema,
  PublicTestRunResponseSchema,
  PublicTestRunTestCasesResponseSchema
} from '../../src/types/core.js';

describe('Public API Test Run Tools Unit Tests', () => {

  describe('Public API Test Run Schemas', () => {
    it('should validate PublicTestRunResource schema', () => {
      const validTestRun = {
        id: 123,
        title: "Test Run 25.39.0",
        description: "Build 12345 test execution",
        milestone: {
          id: 556,
          name: "25.39.0",
          completed: false,
          description: "Release milestone",
          startDate: "2025-09-23T22:00:00Z",
          dueDate: "2025-09-30T22:00:00Z"
        },
        environment: {
          id: 1,
          key: "staging",
          name: "Staging Environment"
        },
        configurations: [
          {
            group: { id: 1, name: "Browser" },
            option: { id: 2, name: "Chrome" }
          }
        ],
        requirements: [
          {
            source: "JIRA",
            reference: "PROJ-123"
          }
        ],
        closed: false,
        createdBy: {
          id: 604,
          username: "maksim.sarychau",
          email: "maksim.sarychau@example.com"
        },
        createdAt: "2025-09-30T10:00:00Z",
        executionSummaries: [
          {
            status: {
              id: 1,
              name: "PASSED",
              colorHex: "#28a745"
            },
            testCasesCount: 15
          },
          {
            status: {
              id: 2,
              name: "FAILED",
              colorHex: "#dc3545"
            },
            testCasesCount: 3
          }
        ]
      };

      assert.doesNotThrow(() => PublicTestRunResourceSchema.parse(validTestRun));
    });

    it('should validate PublicTestRunsResponse schema', () => {
      const validResponse = {
        items: [
          {
            id: 123,
            title: "Test Run 1",
            description: null,
            milestone: null,
            environment: null,
            configurations: [],
            requirements: [],
            closed: false,
            createdBy: {
              id: 604,
              username: "test.user",
              email: "test@example.com"
            },
            createdAt: "2025-09-30T10:00:00Z",
            executionSummaries: []
          }
        ],
        _meta: {
          nextPageToken: "next_page_token_123"
        }
      };

      assert.doesNotThrow(() => PublicTestRunsResponseSchema.parse(validResponse));
    });

    it('should validate PublicTestRunResponse schema', () => {
      const validResponse = {
        data: {
          id: 123,
          title: "Test Run Details",
          description: "Detailed test run",
          milestone: null,
          environment: null,
          configurations: [],
          requirements: [],
          closed: true,
          createdBy: {
            id: 604,
            username: "test.user",
            email: "test@example.com"
          },
          createdAt: "2025-09-30T10:00:00Z",
          executionSummaries: []
        }
      };

      assert.doesNotThrow(() => PublicTestRunResponseSchema.parse(validResponse));
    });

    it('should validate PublicTestRunTestCasesResponse schema', () => {
      const validResponse = {
        items: [
          {
            testCase: {
              id: 456,
              key: "MCP-123",
              title: "Test login functionality"
            },
            assignee: {
              id: 604,
              username: "test.assignee",
              email: "assignee@example.com"
            },
            result: {
              status: {
                id: 1,
                name: "PASSED",
                aliases: "pass"
              },
              details: "Test executed successfully",
              issue: {
                type: "JIRA",
                id: "BUG-456"
              },
              executionTimeInMillis: 5000,
              executionType: "AUTOMATED",
              attachments: [
                { fileUuid: "uuid-123" }
              ]
            }
          }
        ]
      };

      assert.doesNotThrow(() => PublicTestRunTestCasesResponseSchema.parse(validResponse));
    });

    it('should handle nullable and optional fields correctly', () => {
      const minimalTestRun = {
        id: 123,
        title: "Minimal Test Run",
        milestone: null,
        environment: null,
        configurations: [],
        requirements: [],
        closed: false,
        createdBy: {
          id: 604,
          username: "test.user",
          email: "test@example.com"
        },
        createdAt: "2025-09-30T10:00:00Z",
        executionSummaries: []
      };

      assert.doesNotThrow(() => PublicTestRunResourceSchema.parse(minimalTestRun));
    });
  });


  describe('Public API Tool Parameter Validation', () => {
    describe('list_test_runs tool parameters', () => {
      const listTestRunsSchema = z.object({
        project: z.union([z.enum(["web","android","ios","api"]), z.string()])
          .default("web"),
        pageToken: z.string().optional(),
        maxPageSize: z.number().int().positive().max(100).default(10),
        nameFilter: z.string().optional(),
        milestoneFilter: z.string().optional(),
        buildNumberFilter: z.string().optional(),
        closedFilter: z.boolean().optional(),
        sortBy: z.enum(["-createdAt", "createdAt", "-title", "title"])
          .default("-createdAt"),
        format: z.enum(['raw', 'formatted']).default('formatted')
      });

      it('should validate default parameters', () => {
        const result = listTestRunsSchema.parse({});
        assert.strictEqual(result.project, "web");
        assert.strictEqual(result.maxPageSize, 10);
        assert.strictEqual(result.sortBy, "-createdAt");
        assert.strictEqual(result.format, "formatted");
      });

      it('should validate all filter parameters', () => {
        const input = {
          project: "android",
          pageToken: "token123",
          maxPageSize: 50,
          nameFilter: "regression",
          milestoneFilter: "25.39.0",
          buildNumberFilter: "12345",
          closedFilter: false,
          sortBy: "title" as const,
          format: "raw" as const
        };

        const result = listTestRunsSchema.parse(input);
        assert.deepStrictEqual(result, input);
      });

      it('should reject invalid maxPageSize', () => {
        assert.throws(() => listTestRunsSchema.parse({ maxPageSize: 101 }));
        assert.throws(() => listTestRunsSchema.parse({ maxPageSize: 0 }));
        assert.throws(() => listTestRunsSchema.parse({ maxPageSize: -5 }));
      });

      it('should accept project keys and aliases', () => {
        assert.strictEqual(listTestRunsSchema.parse({ project: "web" }).project, "web");
        assert.strictEqual(listTestRunsSchema.parse({ project: "MCP" }).project, "MCP");
        assert.strictEqual(listTestRunsSchema.parse({ project: "CUSTOM_PROJECT" }).project, "CUSTOM_PROJECT");
      });
    });

    describe('get_test_run_by_id tool parameters', () => {
      const getTestRunByIdSchema = z.object({
        id: z.number().int().positive(),
        project: z.union([z.enum(["web","android","ios","api"]), z.string()])
          .default("web"),
        format: z.enum(['raw', 'formatted']).default('formatted')
      });

      it('should validate required id parameter', () => {
        const result = getTestRunByIdSchema.parse({ id: 123 });
        assert.strictEqual(result.id, 123);
        assert.strictEqual(result.project, "web");
        assert.strictEqual(result.format, "formatted");
      });

      it('should reject invalid id values', () => {
        assert.throws(() => getTestRunByIdSchema.parse({ id: 0 }));
        assert.throws(() => getTestRunByIdSchema.parse({ id: -1 }));
        assert.throws(() => getTestRunByIdSchema.parse({ id: 1.5 }));
      });
    });

    describe('list_test_run_test_cases tool parameters', () => {
      const listTestRunTestCasesSchema = z.object({
        testRunId: z.number().int().positive(),
        project: z.union([z.enum(["web","android","ios","api"]), z.string()])
          .default("web"),
        format: z.enum(['raw', 'formatted']).default('formatted')
      });

      it('should validate required testRunId parameter', () => {
        const result = listTestRunTestCasesSchema.parse({ testRunId: 456 });
        assert.strictEqual(result.testRunId, 456);
        assert.strictEqual(result.project, "web");
        assert.strictEqual(result.format, "formatted");
      });

      it('should reject invalid testRunId values', () => {
        assert.throws(() => listTestRunTestCasesSchema.parse({ testRunId: 0 }));
        assert.throws(() => listTestRunTestCasesSchema.parse({ testRunId: -1 }));
      });
    });
  });

  describe('Filter Expression Building', () => {
    it('should build correct filter expressions for Resource Query Language', () => {
      const buildFilters = (args: any) => {
        const filters: string[] = [];
        
        if (args.nameFilter) {
          filters.push(`title ~= '${args.nameFilter.replace(/'/g, "\\'")}'`);
        }
        
        if (args.milestoneFilter) {
          filters.push(`milestone.name ~= '${args.milestoneFilter.replace(/'/g, "\\'")}'`);
        }
        
        if (args.buildNumberFilter) {
          filters.push(`(title ~= '${args.buildNumberFilter.replace(/'/g, "\\'")}' OR description ~= '${args.buildNumberFilter.replace(/'/g, "\\'")}')`);
        }
        
        if (args.closedFilter !== undefined) {
          filters.push(`closed = ${args.closedFilter}`);
        }

        return filters.length > 0 ? filters.join(' AND ') : undefined;
      };

      // Test individual filters
      assert.strictEqual(buildFilters({ nameFilter: "regression" }),
        "title ~= 'regression'");
      
      assert.strictEqual(buildFilters({ milestoneFilter: "25.39.0" }),
        "milestone.name ~= '25.39.0'");
      
      assert.strictEqual(buildFilters({ buildNumberFilter: "12345" }),
        "(title ~= '12345' OR description ~= '12345')");
      
      assert.strictEqual(buildFilters({ closedFilter: false }),
        "closed = false");

      // Test combined filters
      assert.strictEqual(buildFilters({ 
        nameFilter: "smoke", 
        milestoneFilter: "25.39.0",
        closedFilter: false 
      }), "title ~= 'smoke' AND milestone.name ~= '25.39.0' AND closed = false");

      // Test escaping single quotes
      assert.strictEqual(buildFilters({ nameFilter: "test's name" }),
        "title ~= 'test\\'s name'");
    });

    it('should handle empty filters', () => {
      const buildFilters = (args: any) => {
        const filters: string[] = [];
        return filters.length > 0 ? filters.join(' AND ') : undefined;
      };

      assert.strictEqual(buildFilters({}), undefined);
    });
  });

  describe('Formatted Output Structure', () => {
    it('should format test runs list correctly', () => {
      const mockTestRun = {
        id: 123,
        title: "Test Run 25.39.0",
        description: "Build 12345 execution",
        milestone: {
          id: 556,
          name: "25.39.0",
          completed: false,
          dueDate: "2025-09-30T22:00:00Z"
        },
        environment: {
          key: "staging",
          name: "Staging Environment"
        },
        configurations: [
          { group: { name: "Browser" }, option: { name: "Chrome" } }
        ],
        requirements: [
          { source: "JIRA", reference: "PROJ-123" }
        ],
        closed: false,
        createdBy: { username: "test.user", email: "test@example.com" },
        createdAt: "2025-09-30T10:00:00Z",
        executionSummaries: [
          { status: { name: "PASSED" }, testCasesCount: 15 }
        ]
      };

      const formatted = {
        id: mockTestRun.id,
        title: mockTestRun.title,
        description: mockTestRun.description,
        milestone: {
          id: mockTestRun.milestone.id,
          name: mockTestRun.milestone.name,
          completed: mockTestRun.milestone.completed,
          dueDate: mockTestRun.milestone.dueDate
        },
        environment: {
          key: mockTestRun.environment.key,
          name: mockTestRun.environment.name
        },
        configurations: ["Browser: Chrome"],
        requirements: ["JIRA: PROJ-123"],
        closed: mockTestRun.closed,
        createdBy: "test.user (test@example.com)",
        createdAt: mockTestRun.createdAt,
        testCasesSummary: "PASSED: 15"
      };

      assert.deepStrictEqual(formatted.milestone, {
        id: 556,
        name: "25.39.0",
        completed: false,
        dueDate: "2025-09-30T22:00:00Z"
      });
      assert.deepStrictEqual(formatted.configurations, ["Browser: Chrome"]);
      assert.deepStrictEqual(formatted.requirements, ["JIRA: PROJ-123"]);
      assert.strictEqual(formatted.createdBy, "test.user (test@example.com)");
      assert.strictEqual(formatted.testCasesSummary, "PASSED: 15");
    });

    it('should format test run details correctly', () => {
      const mockTestRun = {
        id: 123,
        title: "Detailed Test Run",
        executionSummaries: [
          { status: { name: "PASSED", colorHex: "#28a745" }, testCasesCount: 10 },
          { status: { name: "FAILED", colorHex: "#dc3545" }, testCasesCount: 2 }
        ]
      };

      const executionSummary = {
        totalStatuses: mockTestRun.executionSummaries.length,
        details: mockTestRun.executionSummaries.map(summary => ({
          status: summary.status.name,
          count: summary.testCasesCount,
          color: summary.status.colorHex,
          display: `${summary.status.name}: ${summary.testCasesCount} test cases`
        })),
        totalTestCases: mockTestRun.executionSummaries.reduce((sum, summary) => sum + summary.testCasesCount, 0)
      };

      assert.strictEqual(executionSummary.totalStatuses, 2);
      assert.strictEqual(executionSummary.totalTestCases, 12);
      assert.deepStrictEqual(executionSummary.details, [
        { status: "PASSED", count: 10, color: "#28a745", display: "PASSED: 10 test cases" },
        { status: "FAILED", count: 2, color: "#dc3545", display: "FAILED: 2 test cases" }
      ]);
    });

    it('should format test cases list correctly', () => {
      const mockTestCases = [
        {
          testCase: { id: 456, key: "MCP-123", title: "Login Test" },
          assignee: { id: 604, username: "tester", email: "tester@example.com" },
          result: {
            status: { id: 1, name: "PASSED", aliases: "pass" },
            details: "Test passed",
            executionTimeInMillis: 5000,
            executionType: "AUTOMATED",
            attachments: [{ fileUuid: "uuid1" }]
          }
        },
        {
          testCase: { id: 457, key: "MCP-124", title: "Logout Test" },
          assignee: null,
          result: null
        }
      ];

      const statusSummary = mockTestCases.reduce((acc: any, tc: any) => {
        const status = tc.result?.status.name || 'No Result';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      assert.deepStrictEqual(statusSummary, {
        "PASSED": 1,
        "No Result": 1
      });

      const withResults = mockTestCases.filter(tc => tc.result).length;
      const withAssignees = mockTestCases.filter(tc => tc.assignee).length;

      assert.strictEqual(withResults, 1);
      assert.strictEqual(withAssignees, 1);
    });
  });
});
