import { z } from "zod";
import { ZebrunnerReportingClient } from "../api/reporting-client.js";
import { FormatProcessor } from "../utils/formatter.js";
import { GetLauncherDetailsInputSchema } from "../types/api.js";

/**
 * MCP Tool handlers for Zebrunner Reporting API
 */
export class ZebrunnerReportingToolHandlers {
  constructor(private reportingClient: ZebrunnerReportingClient) {}

  /**
   * Get launcher details tool - comprehensive launch information with test sessions
   */
  async getLauncherDetails(input: z.infer<typeof GetLauncherDetailsInputSchema>) {
    const { 
      projectKey, 
      projectId, 
      launchId, 
      includeLaunchDetails, 
      includeTestSessions, 
      format 
    } = input;

    try {
      // Validate input - either projectKey or projectId must be provided
      if (!projectKey && !projectId) {
        throw new Error("Either projectKey or projectId must be provided");
      }

      let resolvedProjectId = projectId;
      let projectInfo = null;

      // If projectKey is provided, resolve to projectId
      if (projectKey) {
        projectInfo = await this.reportingClient.getProject(projectKey);
        resolvedProjectId = projectInfo.id;
      }

      const results: any = {
        launchId,
        projectId: resolvedProjectId
      };

      // Add project info if we fetched it
      if (projectInfo) {
        results.project = projectInfo;
      }

      // Fetch launch details if requested
      if (includeLaunchDetails) {
        try {
          const launchDetails = await this.reportingClient.getLaunch(launchId, resolvedProjectId!);
          results.launch = launchDetails;
        } catch (error: any) {
          results.launchError = `Failed to fetch launch details: ${error.message}`;
        }
      }

      // Fetch test sessions if requested (deprecated, use test runs instead)
      if (includeTestSessions) {
        try {
          // Try to fetch test runs first (more detailed)
          try {
            const testRuns = await this.reportingClient.getTestRuns(launchId, resolvedProjectId!);
            results.testRuns = testRuns;
            
            // Add summary statistics from test runs
            if (testRuns.items && testRuns.items.length > 0) {
              const summary = {
                totalTests: testRuns.items.length,
                statuses: {} as Record<string, number>,
                owners: {} as Record<string, number>,
                testClasses: {} as Record<string, number>
              };

              testRuns.items.forEach(testRun => {
                // Count statuses
                if (testRun.status) {
                  summary.statuses[testRun.status] = (summary.statuses[testRun.status] || 0) + 1;
                }
                
                // Count owners
                if (testRun.owner) {
                  summary.owners[testRun.owner] = (summary.owners[testRun.owner] || 0) + 1;
                }
                
                // Count test classes
                if (testRun.testClass) {
                  summary.testClasses[testRun.testClass] = (summary.testClasses[testRun.testClass] || 0) + 1;
                }
              });

              results.testRunsSummary = summary;
            }
          } catch (testRunError) {
            // Fallback to test sessions if test runs endpoint doesn't work
            const testSessions = await this.reportingClient.getTestSessions(launchId, resolvedProjectId!);
            results.testSessions = testSessions;
            
            // Add summary statistics
            if (testSessions.items && testSessions.items.length > 0) {
              const summary = {
                totalSessions: testSessions.items.length,
                statuses: {} as Record<string, number>,
                platforms: {} as Record<string, number>,
                browsers: {} as Record<string, number>
              };

              testSessions.items.forEach(session => {
                // Count statuses
                if (session.status) {
                  summary.statuses[session.status] = (summary.statuses[session.status] || 0) + 1;
                }
                
                // Count platforms
                if (session.platform) {
                  summary.platforms[session.platform] = (summary.platforms[session.platform] || 0) + 1;
                }
                
                // Count browsers
                if (session.browser) {
                  summary.browsers[session.browser] = (summary.browsers[session.browser] || 0) + 1;
                }
              });

              results.testSessionsSummary = summary;
            }
          }
        } catch (error: any) {
          results.testSessionsError = `Failed to fetch test data: ${error.message}`;
        }
      }

      // Format the output
      const formattedData = FormatProcessor.format(results, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };

    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving launcher details: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Get launch test summary - lightweight aggregated test results with statistics
   */
  async getLaunchTestSummary(input: { 
    projectKey?: string; 
    projectId?: number; 
    launchId: number;
    statusFilter?: string[];
    minStability?: number;
    maxStability?: number;
    sortBy?: 'stability' | 'duration' | 'name';
    limit?: number;
    summaryOnly?: boolean;
    includeLabels?: boolean;
    includeTestCases?: boolean;
    format?: 'dto' | 'json' | 'string';
  }) {
    const { 
      projectKey, 
      projectId, 
      launchId,
      statusFilter,
      minStability,
      maxStability,
      sortBy = 'stability',
      limit,
      summaryOnly = false,
      includeLabels = false,
      includeTestCases = false,
      format = 'json'
    } = input;

    try {
      // Validate input
      if (!projectKey && !projectId) {
        throw new Error("Either projectKey or projectId must be provided");
      }

      let resolvedProjectId = projectId;
      
      if (projectKey) {
        resolvedProjectId = await this.reportingClient.getProjectId(projectKey);
      }

      // Fetch ALL test runs (auto-paginated)
      const testRuns = await this.reportingClient.getAllTestRuns(launchId, resolvedProjectId!);
      
      // Extract essential fields only (configurable to exclude heavy arrays)
      const lightweightTests = testRuns.items.map(test => {
        const baseTest: any = {
          id: test.id,
          name: test.name,
          status: test.status,
          durationSeconds: test.finishTime && test.startTime 
            ? Math.round((test.finishTime - test.startTime) / 1000)
            : 0,
          startTime: test.startTime,
          finishTime: test.finishTime,
          issueReferences: test.issueReferences || [],
          knownIssue: test.knownIssue || false,
          testClass: test.testClass || 'Unknown',
          owner: test.owner,
          stability: test.stability !== undefined ? Math.round((test.stability || 0) * 100) : 0, // Convert to percentage
          maintainerId: test.maintainerId
        };
        
        // Optionally include labels (can be large)
        if (includeLabels) {
          baseTest.labels = test.labels || [];
        }
        
        // Optionally include test cases (can be large)
        if (includeTestCases) {
          baseTest.testCases = test.testCases || [];
        }
        
        return baseTest;
      });

      // Apply filters
      let filteredTests = lightweightTests;
      
      if (statusFilter && statusFilter.length > 0) {
        filteredTests = filteredTests.filter(test => 
          statusFilter.includes(test.status)
        );
      }

      if (minStability !== undefined) {
        filteredTests = filteredTests.filter(test => 
          test.stability >= minStability
        );
      }

      if (maxStability !== undefined) {
        filteredTests = filteredTests.filter(test => 
          test.stability <= maxStability
        );
      }

      // Sort tests
      if (sortBy === 'stability') {
        filteredTests.sort((a, b) => a.stability - b.stability); // Most unstable first
      } else if (sortBy === 'duration') {
        filteredTests.sort((a, b) => b.durationSeconds - a.durationSeconds); // Longest first
      } else if (sortBy === 'name') {
        filteredTests.sort((a, b) => a.name.localeCompare(b.name));
      }

      // Calculate statistics
      const stats = {
        totalTests: lightweightTests.length,
        filteredTests: filteredTests.length,
        
        // Status breakdown
        byStatus: {} as Record<string, number>,
        
        // Stability breakdown
        byStabilityRange: {
          'critical_0-20': 0,
          'low_21-40': 0,
          'medium_41-60': 0,
          'good_61-80': 0,
          'excellent_81-100': 0
        },
        
        // Test class breakdown
        byTestClass: {} as Record<string, { count: number; avgStability: number; failedCount: number }>,
        
        // Issue statistics
        testsWithIssues: 0,
        testsWithKnownIssues: 0,
        totalIssueReferences: 0,
        
        // Duration statistics
        totalDurationSeconds: 0,
        avgDurationSeconds: 0,
        maxDurationSeconds: 0,
        minDurationSeconds: Infinity,
        
        // Stability statistics
        avgStability: 0,
        minStability: 100,
        maxStability: 0
      };

      // Calculate statistics
      filteredTests.forEach(test => {
        // Status count
        stats.byStatus[test.status] = (stats.byStatus[test.status] || 0) + 1;
        
        // Stability ranges
        if (test.stability <= 20) stats.byStabilityRange['critical_0-20']++;
        else if (test.stability <= 40) stats.byStabilityRange['low_21-40']++;
        else if (test.stability <= 60) stats.byStabilityRange['medium_41-60']++;
        else if (test.stability <= 80) stats.byStabilityRange['good_61-80']++;
        else stats.byStabilityRange['excellent_81-100']++;
        
        // Test class breakdown
        if (!stats.byTestClass[test.testClass]) {
          stats.byTestClass[test.testClass] = { count: 0, avgStability: 0, failedCount: 0 };
        }
        stats.byTestClass[test.testClass].count++;
        stats.byTestClass[test.testClass].avgStability += test.stability;
        if (test.status === 'FAILED') {
          stats.byTestClass[test.testClass].failedCount++;
        }
        
        // Issue statistics
        if (test.issueReferences.length > 0) {
          stats.testsWithIssues++;
          stats.totalIssueReferences += test.issueReferences.length;
        }
        if (test.knownIssue) {
          stats.testsWithKnownIssues++;
        }
        
        // Duration statistics
        stats.totalDurationSeconds += test.durationSeconds;
        stats.maxDurationSeconds = Math.max(stats.maxDurationSeconds, test.durationSeconds);
        stats.minDurationSeconds = Math.min(stats.minDurationSeconds, test.durationSeconds);
        
        // Stability statistics
        stats.avgStability += test.stability;
        stats.minStability = Math.min(stats.minStability, test.stability);
        stats.maxStability = Math.max(stats.maxStability, test.stability);
      });

      // Calculate averages
      if (filteredTests.length > 0) {
        stats.avgDurationSeconds = Math.round(stats.totalDurationSeconds / filteredTests.length);
        stats.avgStability = Math.round(stats.avgStability / filteredTests.length);
        
        // Calculate average stability per test class
        Object.keys(stats.byTestClass).forEach(testClass => {
          stats.byTestClass[testClass].avgStability = Math.round(
            stats.byTestClass[testClass].avgStability / stats.byTestClass[testClass].count
          );
        });
      }

      // Apply limit if specified
      let limitedTests = filteredTests;
      if (limit && limit > 0) {
        limitedTests = filteredTests.slice(0, limit);
      }
      
      // Prepare result based on mode
      const result: any = {
        launchId,
        projectId: resolvedProjectId,
        summary: stats,
        
        // Always include top 20 most unstable tests (lightweight)
        top20MostUnstableTests: filteredTests.slice(0, 20).map(t => ({
          name: t.name,
          stability: t.stability,
          status: t.status,
          testClass: t.testClass,
          knownIssue: t.knownIssue,
          durationSeconds: t.durationSeconds,
          issueReferences: t.issueReferences
        })),
        
        // Tests with issues
        testsWithIssues: filteredTests
          .filter(t => t.issueReferences.length > 0)
          .map(t => ({
            name: t.name,
            status: t.status,
            issues: t.issueReferences,
            stability: t.stability,
            testClass: t.testClass
          }))
      };
      
      // Add full test list only if not summary-only mode
      if (!summaryOnly) {
        result.tests = limitedTests;
        result.testCount = {
          returned: limitedTests.length,
          total: filteredTests.length,
          allTests: lightweightTests.length
        };
      }

      // Format the output
      const formattedData = FormatProcessor.format(result, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };

    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving launch test summary: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Get launcher summary - quick overview without detailed test sessions
   */
  async getLauncherSummary(input: { projectKey?: string; projectId?: number; launchId: number; format?: 'dto' | 'json' | 'string' }) {
    const { projectKey, projectId, launchId, format = 'json' } = input;

    try {
      if (!projectKey && !projectId) {
        throw new Error("Either projectKey or projectId must be provided");
      }

      let resolvedProjectId = projectId;
      
      if (projectKey) {
        resolvedProjectId = await this.reportingClient.getProjectId(projectKey);
      }

      const launch = await this.reportingClient.getLaunch(launchId, resolvedProjectId!);
      
      // Create a summary with key information
      const summary = {
        id: launch.id,
        name: launch.name,
        status: launch.status,
        projectId: launch.projectId,
        startedAt: new Date(launch.startedAt).toISOString(),
        endedAt: launch.endedAt ? new Date(launch.endedAt).toISOString() : null,
        elapsed: launch.elapsed,
        framework: launch.framework,
        environment: launch.environment,
        platform: launch.platform,
        device: launch.device,
        build: launch.build,
        testResults: {
          passed: launch.passed || 0,
          failed: launch.failed || 0,
          skipped: launch.skipped || 0,
          blocked: launch.blocked || 0,
          aborted: launch.aborted || 0,
          total: (launch.passed || 0) + (launch.failed || 0) + (launch.skipped || 0) + (launch.blocked || 0) + (launch.aborted || 0)
        }
      };

      const formattedData = FormatProcessor.format(summary, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };

    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving launcher summary: ${error.message}`
          }
        ]
      };
    }
  }
}
