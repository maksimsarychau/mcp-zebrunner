import { z } from "zod";
import { ZebrunnerReportingClient } from "../api/reporting-client.js";
import { EnhancedZebrunnerClient } from "../api/enhanced-client.js";
import { FormatProcessor } from "../utils/formatter.js";
import { GetLauncherDetailsInputSchema, AnalyzeTestExecutionVideoInput } from "../types/api.js";
import { VideoAnalyzer } from "../utils/video-analysis/analyzer.js";
import type { TestEffectiveDuration, TestSessionBreakdown, SessionResolutionStrategy, TestSessionResponse } from "../types/reporting.js";

/**
 * MCP Tool handlers for Zebrunner Reporting API
 */
export class ZebrunnerReportingToolHandlers {
  private videoAnalyzer: VideoAnalyzer | null = null;

  constructor(
    private reportingClient: ZebrunnerReportingClient,
    private tcmClient?: EnhancedZebrunnerClient
  ) {
    // Initialize video analyzer if TCM client is available
    if (tcmClient) {
      this.videoAnalyzer = new VideoAnalyzer(reportingClient, tcmClient, false);
    }
  }

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
              const summary: any = {
                totalTests: testRuns.items.length,
                totalTestCasesCovered: 0,
                testsWithZeroTestCases: 0,
                testsWithOneTestCase: 0,
                testsWithMultipleTestCases: 0,
                statuses: {} as Record<string, number>,
                owners: {} as Record<string, number>,
                testClasses: {} as Record<string, number>
              };

              testRuns.items.forEach(testRun => {
                const tcCount = testRun.testCases?.length ?? 0;
                summary.totalTestCasesCovered += tcCount;
                if (tcCount === 0) summary.testsWithZeroTestCases++;
                else if (tcCount === 1) summary.testsWithOneTestCase++;
                else summary.testsWithMultipleTestCases++;

                if (testRun.status) {
                  summary.statuses[testRun.status] = (summary.statuses[testRun.status] || 0) + 1;
                }
                if (testRun.owner) {
                  summary.owners[testRun.owner] = (summary.owners[testRun.owner] || 0) + 1;
                }
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
    session_resolution?: SessionResolutionStrategy;
    jira_base_url?: string;
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
      format = 'json',
      session_resolution = 'auto',
      jira_base_url
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

      // Get launch details and project key for URL generation
      const launch = await this.reportingClient.getLaunch(launchId, resolvedProjectId!);
      const resolvedProjectKey = projectKey || await this.reportingClient.getProjectKey(resolvedProjectId!);
      const baseUrl = this.reportingClient['config'].baseUrl;
      
      // Build launch URL
      const launchUrl = `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${launchId}`;
      
      // Fetch ALL test runs (auto-paginated)
      const testRuns = await this.reportingClient.getAllTestRuns(launchId, resolvedProjectId!);

      // Resolve session-aware effective durations for tests with retries
      const effectiveDurations = await this.resolveTestEffectiveDurations(
        launchId, resolvedProjectId!, testRuns.items, session_resolution
      );

      // Extract essential fields only (configurable to exclude heavy arrays)
      const lightweightTests = await Promise.all(testRuns.items.map(async test => {
        const linkedTestCases = test.testCases || [];
        const wallClockDuration = test.finishTime && test.startTime
          ? Math.round((test.finishTime - test.startTime) / 1000)
          : 0;
        const eff = effectiveDurations.get(test.id);
        const baseTest: any = {
          id: test.id,
          name: test.name,
          status: test.status,
          durationSeconds: eff ? eff.effectiveDurationSeconds : wallClockDuration,
          startTime: test.startTime,
          finishTime: test.finishTime,
          issueReferences: test.issueReferences || [],
          knownIssue: test.knownIssue || false,
          testClass: test.testClass || 'Unknown',
          owner: test.owner,
          stability: test.stability !== undefined ? Math.round((test.stability || 0) * 100) : 0,
          maintainerId: test.maintainerId,
          testCasesLinkedCount: linkedTestCases.length,
          testCaseKeys: linkedTestCases.map((tc: any) => tc.testCaseId),
          testUrl: `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${launchId}/tests/${test.id}`,
          ...(eff ? {
            wallClockDurationSeconds: eff.wallClockDurationSeconds,
            longestSessionDurationSeconds: eff.longestSessionDurationSeconds,
            totalRetryDurationSeconds: eff.totalRetryDurationSeconds,
            sessionCount: eff.sessionCount,
            sessions: eff.sessions
          } : {})
        };
        
        // Add clickable JIRA issue references with resolved URLs
        if (test.issueReferences && test.issueReferences.length > 0) {
          baseTest.issueReferencesWithUrls = await Promise.all(
            test.issueReferences.map(async (issue: any) => {
              if (issue.type === 'JIRA') {
                try {
                  const jiraUrl = await this.reportingClient.buildJiraUrl(issue.value, resolvedProjectId, jira_base_url);
                  return { ...issue, url: jiraUrl };
                } catch {
                  return { ...issue, url: null, note: 'JIRA URL could not be resolved' };
                }
              }
              return issue;
            })
          );
        }
        
        // Optionally include labels (can be large)
        if (includeLabels) {
          baseTest.labels = test.labels || [];
        }
        
        // Optionally include test cases (can be large)
        if (includeTestCases) {
          baseTest.testCases = test.testCases || [];
        }
        
        return baseTest;
      }));

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
        maxStability: 0,

        // Test case coverage (tests → TCM test cases)
        totalTestCasesCovered: 0,
        testsWithZeroTestCases: 0,
        testsWithOneTestCase: 0,
        testsWithMultipleTestCases: 0
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

        // Test case coverage
        const tcCount = test.testCasesLinkedCount || 0;
        stats.totalTestCasesCovered += tcCount;
        if (tcCount === 0) stats.testsWithZeroTestCases++;
        else if (tcCount === 1) stats.testsWithOneTestCase++;
        else stats.testsWithMultipleTestCases++;
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
        projectKey: resolvedProjectKey,
        launchName: launch.name,
        launchUrl,
        launchStatus: launch.status,
        launchBuild: launch.build,
        launchEnvironment: launch.environment,
        launchPlatform: launch.platform,
        launchStartedAt: launch.startedAt,
        launchEndedAt: launch.endedAt,
        summary: stats,
        
        // Always include top 20 most unstable tests (lightweight)
        top20MostUnstableTests: filteredTests.slice(0, 20).map(t => ({
          id: t.id,
          name: t.name,
          stability: t.stability,
          status: t.status,
          testClass: t.testClass,
          knownIssue: t.knownIssue,
          durationSeconds: t.durationSeconds,
          issueReferences: t.issueReferencesWithUrls || t.issueReferences,
          testUrl: t.testUrl
        })),
        
        // Tests with issues
        testsWithIssues: filteredTests
          .filter(t => t.issueReferences.length > 0)
          .map(t => ({
            id: t.id,
            name: t.name,
            status: t.status,
            issues: t.issueReferencesWithUrls || t.issueReferences,
            stability: t.stability,
            testClass: t.testClass,
            testUrl: t.testUrl
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

      const jiraWarning = this.reportingClient.jiraResolutionWarning;
      if (jiraWarning) {
        result.warnings = [...(result.warnings || []), jiraWarning];
      }

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
   * Generate weekly regression stability report across suites
   */
  async generateWeeklyRegressionStabilityReport(input: {
    projectKey: string;
    suites: Array<{
      name: string;
      currentLaunchId: number;
      previousLaunchId: number;
    }>;
    builds?: {
      current: string;
      previous: string;
      pageSize?: number;
      maxPages?: number;
    };
    thresholds?: {
      stable?: number;
      watch?: number;
    };
    linkedIssues?: {
      enabled?: boolean;
      limit?: number;
      position?: 'after_comparison' | 'after_status' | 'end';
    };
    outputStyle?: 'strict' | 'default';
    outputFormat?: 'jira' | 'json' | 'dto' | 'summary' | 'detailed';
  }) {
    const {
      projectKey,
      suites,
      builds,
      thresholds,
      linkedIssues,
      outputStyle = 'strict',
      outputFormat = 'jira'
    } = input;

    try {
      if (!projectKey) {
        throw new Error("projectKey is required");
      }
      if ((!suites || suites.length === 0) && !builds) {
        throw new Error("At least one suite is required");
      }

      const normalizedThresholds = this.normalizeStabilityThresholds(thresholds);
      const projectId = await this.reportingClient.getProjectId(projectKey);

      const suiteResults: Array<{
        suite: string;
        passRate: number | null;
        total: number | null;
        failed: number | null;
        skipped: number | null;
        flaky: number | null;
        deltaWoW: number | null;
        status: 'STABLE' | 'WATCH' | 'UNSTABLE' | 'ERROR';
        note?: string;
        linkedIssues?: Array<{ key: string; url?: string; type?: string }>;
      }> = [];

      const linkedIssuesConfig = {
        enabled: linkedIssues?.enabled !== false,
        limit: typeof linkedIssues?.limit === 'number' ? linkedIssues.limit : 5,
        position: linkedIssues?.position || 'after_comparison' as const
      };

      let resolvedSuites = suites;
      let buildComparisonSummary: {
        currentBuild: string;
        previousBuild: string;
        currentLaunches: Array<{ suiteName: string; launchId: number; launchName: string; startedAt?: number }>;
        previousLaunches: Array<{ suiteName: string; launchId: number; launchName: string; startedAt?: number }>;
        matchedSuites: Array<{ suiteName: string; currentLaunchId: number; previousLaunchId: number }>;
        unmatchedCurrent: Array<{ suiteName: string; launchId: number; launchName: string }>;
        unmatchedPrevious: Array<{ suiteName: string; launchId: number; launchName: string }>;
      } | null = null;

      if (builds) {
        const buildResolution = await this.resolveSuitesFromBuilds(projectId, builds);
        resolvedSuites = buildResolution.suites;
        buildComparisonSummary = buildResolution.summary;

        if (buildResolution.unmatchedCurrent.length > 0) {
          buildResolution.unmatchedCurrent.forEach(entry => {
            suiteResults.push({
              suite: entry.suiteName,
              passRate: null,
              total: null,
              failed: null,
              skipped: null,
              flaky: null,
              deltaWoW: null,
              status: 'ERROR',
              note: `No matching suite found for previous build "${builds.previous}".`,
              linkedIssues: []
            });
          });
        }

        if (buildResolution.unmatchedPrevious.length > 0) {
          buildResolution.unmatchedPrevious.forEach(entry => {
            suiteResults.push({
              suite: entry.suiteName,
              passRate: null,
              total: null,
              failed: null,
              skipped: null,
              flaky: null,
              deltaWoW: null,
              status: 'ERROR',
              note: `No matching suite found for current build "${builds.current}".`,
              linkedIssues: []
            });
          });
        }
      }

      for (const suite of resolvedSuites) {
        try {
          const currentMetrics = await this.getLaunchMetricsForStability(
            suite.currentLaunchId,
            projectId,
            linkedIssuesConfig.enabled,
            linkedIssuesConfig.limit
          );
          const previousMetrics = await this.getLaunchMetricsForStability(
            suite.previousLaunchId,
            projectId,
            false,
            0
          );

          const comparisonValidation = this.validateLaunchComparison(
            currentMetrics,
            previousMetrics
          );
          if (!comparisonValidation.isValid) {
            suiteResults.push({
              suite: suite.name,
              passRate: null,
              total: null,
              failed: null,
              skipped: null,
              flaky: null,
              deltaWoW: null,
              status: 'ERROR',
              note: comparisonValidation.message,
              linkedIssues: currentMetrics.linkedIssues
            });
            continue;
          }

          const deltaWoW = currentMetrics.passRate - previousMetrics.passRate;
          const status = this.classifyStabilityStatus(
            currentMetrics.passRate,
            normalizedThresholds.stable,
            normalizedThresholds.watch
          );

          let note: string | undefined;
          if (status === 'WATCH' || status === 'UNSTABLE') {
            try {
              const failureSummary = await this.analyzeLaunchFailures({
                testRunId: suite.currentLaunchId,
                projectKey,
                format: 'summary',
                limit: 10
              });
              const reportText = failureSummary?.content?.find((c: any) => c.type === 'text')?.text;
              note = this.extractExecutiveFailureNote(reportText);
            } catch (error: any) {
              note = `Failure summary unavailable: ${error?.message || String(error)}`;
            }
          }

          suiteResults.push({
            suite: suite.name,
            passRate: currentMetrics.passRate,
            total: currentMetrics.total,
            failed: currentMetrics.failed,
            skipped: currentMetrics.skipped,
            flaky: currentMetrics.flaky,
            deltaWoW,
            status,
            note,
            linkedIssues: currentMetrics.linkedIssues
          });
        } catch (error: any) {
          suiteResults.push({
            suite: suite.name,
            passRate: null,
            total: null,
            failed: null,
            skipped: null,
            flaky: null,
            deltaWoW: null,
            status: 'ERROR',
            note: `Error fetching launch metrics: ${error?.message || String(error)}`
          });
        }
      }

      if (outputFormat === 'json' || outputFormat === 'dto') {
        const response = {
          generatedAt: new Date().toISOString().slice(0, 10),
          thresholds: normalizedThresholds,
          linkedIssues: linkedIssuesConfig,
          outputStyle,
          buildComparison: buildComparisonSummary,
          suites: suiteResults
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response, null, 2)
            }
          ]
        };
      }

      const report = this.buildWeeklyStabilityJiraReport(
        suiteResults,
        normalizedThresholds,
        linkedIssuesConfig,
        outputStyle,
        outputFormat === 'summary' ? 'summary' : 'detailed',
        buildComparisonSummary
      );
      return {
        content: [
          {
            type: "text" as const,
            text: report
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Error generating weekly regression stability report: ${error.message}`
          }
        ]
      };
    }
  }

  private normalizeStabilityThresholds(thresholds?: { stable?: number; watch?: number }) {
    const defaultStable = 90;
    const defaultWatch = 85;
    const minGap = 3;

    const stable = typeof thresholds?.stable === 'number' ? thresholds.stable : defaultStable;
    let watch = typeof thresholds?.watch === 'number' ? thresholds.watch : defaultWatch;

    if (watch >= stable || stable - watch < minGap) {
      watch = Math.max(0, stable - minGap);
    }

    return {
      stable: Math.max(0, Math.min(100, Math.round(stable))),
      watch: Math.max(0, Math.min(100, Math.round(watch)))
    };
  }

  private classifyStabilityStatus(passRate: number, stableThreshold: number, watchThreshold: number) {
    if (passRate >= stableThreshold) {
      return 'STABLE';
    }
    if (passRate >= watchThreshold) {
      return 'WATCH';
    }
    return 'UNSTABLE';
  }

  private async getLaunchMetricsForStability(
    launchId: number,
    projectId: number,
    includeLinkedIssues: boolean,
    linkedIssuesLimit: number,
    jira_base_url?: string
  ) {
    const launch = await this.reportingClient.getLaunch(launchId, projectId);
    const testRuns = await this.reportingClient.getAllTestRuns(launchId, projectId);
    const items = testRuns.items || [];

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let flaky = 0;
    let totalTestCasesCovered = 0;
    const linkedIssuesMap = new Map<string, { key: string; url?: string; type?: string }>();
    const testIdentifiers = new Set<string>();

    for (const test of items) {
      this.collectTestIdentifiers(test, testIdentifiers);
      totalTestCasesCovered += test.testCases?.length ?? 0;
      const status = (test.status || '').toUpperCase();
      if (status === 'PASSED' || test.passedManually === true) {
        passed += 1;
      } else if (status === 'FAILED' || status === 'ABORTED') {
        failed += 1;
      } else if (status === 'SKIPPED') {
        skipped += 1;
      }

      const stabilityPercent = test.stability !== undefined
        ? Math.round((test.stability || 0) * 100)
        : 0;
      if (status !== 'PASSED' && stabilityPercent >= 20 && stabilityPercent <= 80) {
        flaky += 1;
      }

      if (includeLinkedIssues && linkedIssuesLimit > 0 && test.issueReferences && test.issueReferences.length > 0) {
        for (const issue of test.issueReferences) {
          const issueKey = issue?.value;
          if (!issueKey || linkedIssuesMap.has(issueKey)) {
            continue;
          }

          if (linkedIssuesMap.size >= linkedIssuesLimit) {
            break;
          }

          if (issue?.type === 'JIRA') {
            try {
              const jiraUrl = await this.reportingClient.buildJiraUrl(issueKey, projectId, jira_base_url);
              linkedIssuesMap.set(issueKey, { key: issueKey, url: jiraUrl, type: issue.type });
            } catch {
              linkedIssuesMap.set(issueKey, { key: issueKey, type: issue.type });
            }
          } else {
            linkedIssuesMap.set(issueKey, { key: issueKey, type: issue?.type });
          }
        }
      }
    }

    const total = items.length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    return {
      launchName: launch?.name || `Launch ${launchId}`,
      testIdentifiers,
      total,
      totalTestCasesCovered,
      passed,
      failed,
      skipped,
      flaky,
      passRate,
      linkedIssues: Array.from(linkedIssuesMap.values())
    };
  }

  private validateLaunchComparison(
    current: {
      launchName: string;
      testIdentifiers: Set<string>;
    },
    previous: {
      launchName: string;
      testIdentifiers: Set<string>;
    }
  ) {
    const nameSimilarityThreshold = 0.7;
    const testOverlapThreshold = 0.7;

    const nameSimilarity = this.calculateNameSimilarity(current.launchName, previous.launchName);
    const testOverlap = this.calculateTestOverlap(current.testIdentifiers, previous.testIdentifiers);

    if (nameSimilarity < nameSimilarityThreshold || testOverlap < testOverlapThreshold) {
      const namePercent = Math.round(nameSimilarity * 100);
      const overlapPercent = Math.round(testOverlap * 100);
      return {
        isValid: false,
        message: `Launch comparison failed: "${current.launchName}" vs "${previous.launchName}" with name similarity ${namePercent}% and test overlap ${overlapPercent}%. Check that the current and previous launches belong to the same suite/week.`
      };
    }

    return { isValid: true };
  }

  private calculateNameSimilarity(a: string, b: string) {
    const tokensA = this.normalizeLaunchNameTokens(a);
    const tokensB = this.normalizeLaunchNameTokens(b);
    if (tokensA.length === 0 && tokensB.length === 0) {
      return 1;
    }
    if (tokensA.length === 0 || tokensB.length === 0) {
      return 0;
    }
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    const intersection = [...setA].filter(token => setB.has(token)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
  }

  private normalizeLaunchNameTokens(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1);
  }

  private calculateTestOverlap(current: Set<string>, previous: Set<string>) {
    if (current.size === 0 && previous.size === 0) {
      return 1;
    }
    if (current.size === 0 || previous.size === 0) {
      return 0;
    }
    let intersection = 0;
    for (const id of current) {
      if (previous.has(id)) {
        intersection += 1;
      }
    }
    const denominator = Math.max(current.size, previous.size);
    return denominator === 0 ? 0 : intersection / denominator;
  }

  private async resolveSuitesFromBuilds(
    projectId: number,
    builds: { current: string; previous: string; pageSize?: number; maxPages?: number }
  ) {
    const pageSize = builds.pageSize || 50;
    const maxPages = builds.maxPages || 10;

    const currentLaunches = await this.fetchLaunchesByBuild(projectId, builds.current, pageSize, maxPages);
    const previousLaunches = await this.fetchLaunchesByBuild(projectId, builds.previous, pageSize, maxPages);

    const currentBySuite = this.groupLaunchesBySuite(currentLaunches);
    const previousBySuite = this.groupLaunchesBySuite(previousLaunches);

    const matchedSuites: Array<{ suiteName: string; currentLaunchId: number; previousLaunchId: number }> = [];
    const unmatchedCurrent: Array<{ suiteName: string; launchId: number; launchName: string }> = [];
    const unmatchedPrevious: Array<{ suiteName: string; launchId: number; launchName: string }> = [];

    const previousSuiteNames = new Set<string>(Object.keys(previousBySuite));

    Object.entries(currentBySuite).forEach(([suiteName, currentLaunch]) => {
      let bestMatchName: string | null = null;
      let bestMatchSimilarity = 0;
      previousSuiteNames.forEach(prevName => {
        const similarity = this.calculateNameSimilarity(suiteName, prevName);
        if (similarity > bestMatchSimilarity) {
          bestMatchSimilarity = similarity;
          bestMatchName = prevName;
        }
      });

      if (bestMatchName && bestMatchSimilarity >= 0.7) {
        const previousLaunch = previousBySuite[bestMatchName];
        matchedSuites.push({
          suiteName,
          currentLaunchId: currentLaunch.launchId,
          previousLaunchId: previousLaunch.launchId
        });
        previousSuiteNames.delete(bestMatchName);
      } else {
        unmatchedCurrent.push({
          suiteName,
          launchId: currentLaunch.launchId,
          launchName: currentLaunch.launchName
        });
      }
    });

    previousSuiteNames.forEach(prevName => {
      const previousLaunch = previousBySuite[prevName];
      unmatchedPrevious.push({
        suiteName: prevName,
        launchId: previousLaunch.launchId,
        launchName: previousLaunch.launchName
      });
    });

    return {
      suites: matchedSuites.map(match => ({
        name: match.suiteName,
        currentLaunchId: match.currentLaunchId,
        previousLaunchId: match.previousLaunchId
      })),
      summary: {
        currentBuild: builds.current,
        previousBuild: builds.previous,
        currentLaunches,
        previousLaunches,
        matchedSuites,
        unmatchedCurrent,
        unmatchedPrevious
      },
      unmatchedCurrent,
      unmatchedPrevious
    };
  }

  private async fetchLaunchesByBuild(
    projectId: number,
    build: string,
    pageSize: number,
    maxPages: number
  ) {
    const launches: Array<{ suiteName: string; launchId: number; launchName: string; startedAt?: number }> = [];
    const normalizedBuild = build.toLowerCase();
    const versionMatch = build.match(/\d+\.\d+\.\d+/);
    const buildToken = versionMatch ? versionMatch[0] : (build.includes('-') ? build.split('-').pop() || build : build);
    const normalizedToken = buildToken.toLowerCase();
    const debugEnabled = Boolean(this.reportingClient['config']?.debug);

    let page = 1;
    let totalItems = 0;
    while (page <= maxPages) {
      const response = await this.reportingClient.getLaunches(projectId, {
        page,
        pageSize,
        query: buildToken
      });

      const items = response.items || [];
      totalItems += items.length;
      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        const buildNumber = item.buildNumber?.toLowerCase();
        const matchesBuild = buildNumber
          ? buildNumber.includes(normalizedBuild) || buildNumber.includes(normalizedToken)
          : true;

        if (!matchesBuild) {
          continue;
        }

        if (buildNumber) {
          if (debugEnabled) {
            console.log(`[WeeklyReport] Build match via buildNumber: ${item.id} "${item.name}" buildNumber="${item.buildNumber}" query="${buildToken}"`);
          }
          launches.push({
            suiteName: item.name,
            launchId: item.id,
            launchName: item.name,
            startedAt: item.startedAt
          });
          continue;
        }

        if (debugEnabled) {
          console.log(`[WeeklyReport] Build check via launch.build (no buildNumber): ${item.id} "${item.name}" query="${buildToken}"`);
        }
        const launch = await this.reportingClient.getLaunch(item.id, projectId);
        const launchBuild = launch.build?.toLowerCase();
        const launchMatchesBuild = launchBuild
          ? launchBuild.includes(normalizedBuild) || launchBuild.includes(normalizedToken)
          : false;

        if (!launchMatchesBuild) {
          continue;
        }

        if (debugEnabled) {
          console.log(`[WeeklyReport] Build match via launch.build: ${item.id} "${launch.name}" build="${launch.build}" query="${buildToken}"`);
        }
        const suiteName = launch.testSuite?.name || launch.name || `Launch ${launch.id}`;
        launches.push({
          suiteName,
          launchId: launch.id,
          launchName: launch.name || `Launch ${launch.id}`,
          startedAt: launch.startedAt
        });
      }

      if (!response._meta || page >= response._meta.totalPages) {
        break;
      }

      page += 1;
    }

    if (launches.length === 0) {
      if (totalItems === 0) {
        throw new Error(`No launches found for build "${build}" using query "${buildToken}"`);
      }
      throw new Error(`No launches matched build "${build}" (query "${buildToken}" returned ${totalItems} items)`);
    }

    return launches;
  }

  private groupLaunchesBySuite(
    launches: Array<{ suiteName: string; launchId: number; launchName: string; startedAt?: number }>
  ): Record<string, { suiteName: string; launchId: number; launchName: string; startedAt?: number }> {
    const grouped: Record<string, { suiteName: string; launchId: number; launchName: string; startedAt?: number }> = {};
    launches.forEach(launch => {
      const existing = grouped[launch.suiteName];
      if (!existing || (launch.startedAt || 0) > (existing.startedAt || 0)) {
        grouped[launch.suiteName] = launch;
      }
    });
    return grouped;
  }
  private collectTestIdentifiers(test: any, identifiers: Set<string>) {
    if (test?.testCases && Array.isArray(test.testCases) && test.testCases.length > 0) {
      test.testCases.forEach((tc: any) => {
        const idValue = tc?.testCaseId ?? tc?.testId;
        if (idValue !== undefined && idValue !== null) {
          identifiers.add(String(idValue).toLowerCase());
        }
      });
      return;
    }

    if (test?.name) {
      identifiers.add(this.normalizeTestName(test.name));
    }
  }

  private normalizeTestName(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractExecutiveFailureNote(reportText?: string): string | undefined {
    if (!reportText) {
      return undefined;
    }

    const patternMatch = reportText.match(/## 🔬 Pattern Analysis[\s\S]*?\*\*1️⃣ ([^*]+)\*\* -/);
    if (patternMatch) {
      return `Failures mostly caused by ${patternMatch[1].trim()}`;
    }

    const breakdownMatch = reportText.match(/## 📈 Failure Breakdown by Category[\s\S]*?-\s\*\*([^*]+)\*\*:\s*\d+\stest/);
    if (breakdownMatch) {
      return `Failures mostly caused by ${breakdownMatch[1].trim()}`;
    }

    const patternsMatch = reportText.match(/Detected\s+(\d+)\s+unique error pattern/);
    if (patternsMatch) {
      return `Multiple failure patterns detected (${patternsMatch[1]} unique patterns)`;
    }

    const failedMatch = reportText.match(/\*\*Failed Tests \(Total\):\*\*\s*(\d+)/);
    const totalMatch = reportText.match(/\*\*Total Tests in Launch:\*\*\s*(\d+)/);
    if (failedMatch && totalMatch) {
      const failed = Number(failedMatch[1]);
      const total = Number(totalMatch[1]);
      if (total > 0) {
        const failureRate = Math.round((failed / total) * 100);
        return `Failure rate ${failureRate}% (${failed}/${total} tests) in current launch`;
      }
    }

    return undefined;
  }

  private buildWeeklyStabilityJiraReport(
    suites: Array<{
      suite: string;
      passRate: number | null;
      total: number | null;
      failed: number | null;
      skipped: number | null;
      flaky: number | null;
      deltaWoW: number | null;
      status: 'STABLE' | 'WATCH' | 'UNSTABLE' | 'ERROR';
      note?: string;
      linkedIssues?: Array<{ key: string; url?: string; type?: string }>;
    }>,
    thresholds: { stable: number; watch: number },
    linkedIssuesConfig: { enabled: boolean; limit: number; position: 'after_comparison' | 'after_status' | 'end' },
    outputStyle: 'strict' | 'default',
    detailLevel: 'summary' | 'detailed',
    buildComparisonSummary: {
      currentBuild: string;
      previousBuild: string;
      currentLaunches: Array<{ suiteName: string; launchId: number; launchName: string; startedAt?: number }>;
      previousLaunches: Array<{ suiteName: string; launchId: number; launchName: string; startedAt?: number }>;
      matchedSuites: Array<{ suiteName: string; currentLaunchId: number; previousLaunchId: number }>;
      unmatchedCurrent: Array<{ suiteName: string; launchId: number; launchName: string }>;
      unmatchedPrevious: Array<{ suiteName: string; launchId: number; launchName: string }>;
    } | null
  ) {
    let report = `## 📊 Stability Snapshot\n\n`;
    report += `| Suite | Pass % | Total | Failed | Skipped | Flaky | Δ WoW |\n`;
    report += `|------|--------|-------|--------|---------|-------|-------|\n`;

    suites.forEach(suite => {
      const passRate = suite.passRate === null ? 'N/A' : `${suite.passRate}%`;
      const total = suite.total === null ? 'N/A' : suite.total;
      const failed = suite.failed === null ? 'N/A' : suite.failed;
      const skipped = suite.skipped === null ? 'N/A' : suite.skipped;
      const flaky = suite.flaky === null ? 'N/A' : suite.flaky;
      const delta = suite.deltaWoW === null
        ? 'N/A'
        : `${suite.deltaWoW >= 0 ? '+' : ''}${suite.deltaWoW}%`;
      report += `| ${suite.suite} | ${passRate} | ${total} | ${failed} | ${skipped} | ${flaky} | ${delta} |\n`;
    });

    if (detailLevel === 'detailed' && buildComparisonSummary) {
      report += this.buildLaunchMappingSection(buildComparisonSummary);
    }

    const linkedIssuesSection = this.buildLinkedIssuesSection(suites, linkedIssuesConfig);

    if (detailLevel === 'detailed' && linkedIssuesConfig.enabled && linkedIssuesConfig.position === 'after_comparison' && linkedIssuesSection) {
      report += `\n${linkedIssuesSection}\n`;
    }

    const stableSuites = suites.filter(s => s.status === 'STABLE').map(s => s.suite);
    const watchSuites = suites.filter(s => s.status === 'WATCH').map(s => s.suite);
    const unstableSuites = suites.filter(s => s.status === 'UNSTABLE').map(s => s.suite);
    const errorSuites = suites.filter(s => s.status === 'ERROR').map(s => s.suite);

    report += `\n## 🚦 Status\n`;
    report += `🟢 Stable (>= ${thresholds.stable}%): ${stableSuites.length ? stableSuites.join(', ') : 'None'}\n`;
    report += `🟡 Watch (>= ${thresholds.watch}%): ${watchSuites.length ? watchSuites.join(', ') : 'None'}\n`;
    report += `🔴 Unstable (< ${thresholds.watch}%): ${unstableSuites.length ? unstableSuites.join(', ') : 'None'}\n`;
    if (errorSuites.length > 0) {
      report += `⚠️ Error: ${errorSuites.join(', ')}\n`;
    }

    if (detailLevel === 'detailed' && linkedIssuesConfig.enabled && linkedIssuesConfig.position === 'after_status' && linkedIssuesSection) {
      report += `\n${linkedIssuesSection}\n`;
    }

    if (detailLevel === 'detailed') {
      const notes = suites.filter(s => s.note).map(s => `- ${s.suite} — ${s.note}`);
      if (notes.length > 0) {
        report += `\n## 🧭 Notes\n`;
        report += `${notes.join('\n')}\n`;
      }
    }

    if (detailLevel === 'detailed' && linkedIssuesConfig.enabled && linkedIssuesConfig.position === 'end' && linkedIssuesSection) {
      report += `\n${linkedIssuesSection}\n`;
    }

    if (outputStyle === 'default') {
      report += `\n_Generated by MCP Zebrunner Weekly Stability Report_\n`;
    }

    return report;
  }

  private buildLaunchMappingSection(summary: {
    currentBuild: string;
    previousBuild: string;
    currentLaunches: Array<{ suiteName: string; launchId: number; launchName: string; startedAt?: number }>;
    previousLaunches: Array<{ suiteName: string; launchId: number; launchName: string; startedAt?: number }>;
    matchedSuites: Array<{ suiteName: string; currentLaunchId: number; previousLaunchId: number }>;
    unmatchedCurrent: Array<{ suiteName: string; launchId: number; launchName: string }>;
    unmatchedPrevious: Array<{ suiteName: string; launchId: number; launchName: string }>;
  }) {
    let section = `\n## 🧩 Build Launch Mapping\n\n`;
    section += `**Current Build:** ${summary.currentBuild}\n`;
    section += `**Previous Build:** ${summary.previousBuild}\n\n`;
    section += `| Suite | Current Launch | Previous Launch |\n`;
    section += `|------|----------------|-----------------|\n`;

    summary.matchedSuites.forEach(match => {
      section += `| ${match.suiteName} | ${match.currentLaunchId} | ${match.previousLaunchId} |\n`;
    });

    if (summary.unmatchedCurrent.length > 0) {
      section += `\n**Unmatched Current Launches:**\n`;
      summary.unmatchedCurrent.forEach(entry => {
        section += `- ${entry.suiteName} — ${entry.launchName} (ID: ${entry.launchId})\n`;
      });
      section += `\n`;
    }

    if (summary.unmatchedPrevious.length > 0) {
      section += `**Unmatched Previous Launches:**\n`;
      summary.unmatchedPrevious.forEach(entry => {
        section += `- ${entry.suiteName} — ${entry.launchName} (ID: ${entry.launchId})\n`;
      });
      section += `\n`;
    }

    return section;
  }

  private buildLinkedIssuesSection(
    suites: Array<{
      suite: string;
      linkedIssues?: Array<{ key: string; url?: string; type?: string }>;
    }>,
    linkedIssuesConfig: { enabled: boolean; limit: number }
  ) {
    if (!linkedIssuesConfig.enabled) {
      return '';
    }

    const lines: string[] = [];
    suites.forEach(suite => {
      const issues = suite.linkedIssues || [];
      if (issues.length === 0) {
        return;
      }
      const displayIssues = issues
        .slice(0, linkedIssuesConfig.limit)
        .map(issue => issue.url ? `[${issue.key}](${issue.url})` : issue.key);
      lines.push(`- ${suite.suite} — ${displayIssues.join(', ')}`);
    });

    if (lines.length === 0) {
      return '';
    }

    let section = `## 🔗 Linked Issues\n\n`;
    section += `${lines.join('\n')}\n`;
    return section;
  }

  /**
   * Get launcher summary - quick overview without detailed test sessions
   */
  async getLauncherSummary(input: { projectKey?: string; projectId?: number; launchId: number; format?: 'dto' | 'json' | 'string'; jira_base_url?: string }) {
    const { projectKey, projectId, launchId, format = 'json', jira_base_url } = input;

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
          total: (launch.passed || 0) + (launch.failed || 0) + (launch.skipped || 0) + (launch.blocked || 0) + (launch.aborted || 0),
          note: 'These are test counts (not TCM test cases). Each test may cover 0, 1, or many test cases. Use get_launch_test_summary for test case coverage details.'
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

  /**
   * Get test execution history - Shows history of test executions across launches
   */
  async getTestExecutionHistory(input: {
    testId: number;
    testRunId: number;
    projectKey?: string;
    projectId?: number;
    limit?: number;
    format?: 'dto' | 'json' | 'string';
  }) {
    const {
      testId,
      testRunId,
      projectKey,
      projectId,
      limit = 10,
      format = 'string'
    } = input;

    try {
      // Validate input
      if (!projectKey && !projectId) {
        throw new Error("Either projectKey or projectId must be provided");
      }

      let resolvedProjectId = projectId;
      let resolvedProjectKey = projectKey;
      
      if (projectKey && !projectId) {
        resolvedProjectId = await this.reportingClient.getProjectId(projectKey);
      } else if (projectId && !projectKey) {
        resolvedProjectKey = await this.reportingClient.getProjectKey(projectId);
      }

      // Fetch test execution history
      const history = await this.reportingClient.getTestExecutionHistory(
        testRunId,
        testId,
        resolvedProjectId!,
        limit
      );

      const baseUrl = this.reportingClient['config'].baseUrl;

      // Find last passed execution
      const lastPassed = history.items.find(item => 
        item.status === 'PASSED' && !item.passedManually
      );

      // Calculate pass rate
      const totalExecutions = history.items.length;
      const passedExecutions = history.items.filter(item => 
        item.status === 'PASSED' && !item.passedManually
      ).length;
      const passRate = totalExecutions > 0 
        ? Math.round((passedExecutions / totalExecutions) * 100) 
        : 0;

      // Format timestamps
      const formattedHistory = history.items.map(item => ({
        testId: item.testId,
        status: item.status,
        passedManually: item.passedManually,
        duration: `${Math.round(item.elapsed / 1000)}s`,
        durationMs: item.elapsed,
        launchId: item.testRunId,
        launchUrl: `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${item.testRunId}/tests/${item.testId}`,
        date: new Date(item.startTime).toISOString(),
        dateFormatted: new Date(item.startTime).toLocaleString(),
        issues: item.issueReferences.length > 0 
          ? item.issueReferences.map(issue => issue.value).join(', ')
          : 'None'
      }));

      // Prepare summary object
      const summary = {
        testId,
        currentLaunchId: testRunId,
        totalExecutions,
        passedExecutions,
        failedExecutions: history.items.filter(item => item.status === 'FAILED').length,
        passRate: `${passRate}%`,
        lastPassedExecution: lastPassed ? {
          testId: lastPassed.testId,
          launchId: lastPassed.testRunId,
          date: new Date(lastPassed.startTime).toLocaleString(),
          duration: `${Math.round(lastPassed.elapsed / 1000)}s`,
          launchUrl: `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${lastPassed.testRunId}/tests/${lastPassed.testId}`
        } : null,
        history: formattedHistory
      };

      // Format based on requested format
      if (format === 'dto' || format === 'json') {
        const formattedData = FormatProcessor.format(summary, format);
        return {
          content: [
            {
              type: "text" as const,
              text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
            }
          ]
        };
      }

      // String format (markdown table)
      let report = `# 📊 Test Execution History\n\n`;
      report += `**Test ID:** ${testId}\n`;
      report += `**Current Launch:** [${testRunId}](${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${testRunId}/tests/${testId})\n`;
      report += `**Total Executions:** ${totalExecutions}\n`;
      report += `**Pass Rate:** ${passRate}% (${passedExecutions}/${totalExecutions})\n\n`;

      if (lastPassed) {
        report += `## ✅ Last Passed Execution\n\n`;
        report += `- **Launch:** [${lastPassed.testRunId}](${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${lastPassed.testRunId}/tests/${lastPassed.testId})\n`;
        report += `- **Date:** ${new Date(lastPassed.startTime).toLocaleString()}\n`;
        report += `- **Duration:** ${Math.round(lastPassed.elapsed / 1000)}s\n\n`;
      } else {
        report += `## ⚠️ No Passed Executions Found\n\n`;
        report += `This test has not passed in the last ${limit} executions.\n\n`;
      }

      report += `## 📋 Execution History (Last ${Math.min(limit, totalExecutions)})\n\n`;
      report += `| # | Status | Date | Duration | Launch | Issues |\n`;
      report += `|---|--------|------|----------|--------|--------|\n`;

      formattedHistory.forEach((item, idx) => {
        const statusIcon = item.status === 'PASSED' ? '✅' :
                          item.status === 'FAILED' ? '❌' :
                          item.status === 'SKIPPED' ? '⏭️' : '❓';
        const manualFlag = item.passedManually ? ' 👤' : '';
        
        report += `| ${idx + 1} | ${statusIcon} ${item.status}${manualFlag} | ${item.dateFormatted} | ${item.duration} | [${item.launchId}](${item.launchUrl}) | ${item.issues} |\n`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: report
          }
        ]
      };

    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving test execution history: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Analyze test failure by ID - Deep forensic analysis
   */
  async analyzeTestFailureById(input: {
    testId: number;
    testRunId: number;
    projectKey?: string;
    projectId?: number;
    includeScreenshots?: boolean;
    includeLogs?: boolean;
    includeArtifacts?: boolean;
    includePageSource?: boolean;
    includeVideo?: boolean;
    analyzeSimilarFailures?: boolean;
    analyzeScreenshotsWithAI?: boolean;
    screenshotAnalysisType?: 'basic' | 'detailed';
    format?: 'detailed' | 'summary' | 'jira';
    compareWithLastPassed?: {
      enabled: boolean;
      includeLogs?: boolean;
      includeScreenshots?: boolean;
      includeVideo?: boolean;
      includeEnvironment?: boolean;
      includeDuration?: boolean;
    };
    jira_base_url?: string;
  }) {
    const {
      testId,
      testRunId,
      projectKey,
      projectId,
      includeScreenshots = true,
      includeLogs = true,
      includeArtifacts = true,
      includePageSource = true,
      includeVideo = false,
      analyzeSimilarFailures = true,
      analyzeScreenshotsWithAI = false,
      screenshotAnalysisType = 'detailed',
      format = 'detailed',
      compareWithLastPassed,
      jira_base_url
    } = input;

    try {
      // Validate input
      if (!projectKey && !projectId) {
        throw new Error("Either projectKey or projectId must be provided");
      }

      let resolvedProjectId = projectId;
      let resolvedProjectKey = projectKey;
      
      if (projectKey && !projectId) {
        resolvedProjectId = await this.reportingClient.getProjectId(projectKey);
      } else if (projectId && !projectKey) {
        resolvedProjectKey = await this.reportingClient.getProjectKey(projectId);
      }

      const allTestRuns = await this.reportingClient.getAllTestRuns(testRunId, resolvedProjectId!);
      const testRun = allTestRuns.items.find(t => t.id === testId);
      if (!testRun) {
        throw new Error(`Test ID ${testId} not found in launch ${testRunId} (${allTestRuns.items.length} tests scanned)`);
      }

      let logsAndScreenshots;
      let logsFetchError: string | null = null;
      if (includeLogs || includeScreenshots) {
        try {
          logsAndScreenshots = await this.reportingClient.getTestLogsAndScreenshots(testRunId, testId);
        } catch (err) {
          logsFetchError = `Failed to fetch logs/screenshots: ${err instanceof Error ? err.message : err}`;
        }
      }

      // Parse logs for errors and key events
      const logAnalysis = includeLogs && logsAndScreenshots 
        ? this.parseLogsForAnalysis(logsAndScreenshots.items)
        : null;

      // Extract screenshots
      const screenshots = includeScreenshots && logsAndScreenshots
        ? this.extractScreenshots(logsAndScreenshots.items)
        : [];

      // Find similar failures if requested
      let similarFailures: any[] = [];
      if (analyzeSimilarFailures && testRun.message) {
        similarFailures = await this.findSimilarFailures(
          testRunId,
          resolvedProjectId!,
          testRun.message,
          testRun.testClass || '',
          testId
        );
      }

      // Classify the error
      const errorClassification = this.classifyError(testRun.message || '', logAnalysis?.errorLogs || []);

      if (format === 'jira') {
        const jiraTicket = await this.generateJiraTicketForTest({
          testRun,
          testId,
          testRunId,
          launchName: `Launch ${testRunId}`,
          projectKey: resolvedProjectKey!,
          projectId: resolvedProjectId!,
          errorClassification,
          logAnalysis: logAnalysis || {},
          screenshots,
          similarFailures,
          baseUrl: this.reportingClient['config'].baseUrl,
          jiraBaseUrlOverride: jira_base_url
        });

        return {
          content: [
            {
              type: "text" as const,
              text: jiraTicket
            }
          ]
        };
      }

      // Fetch comparison data if requested
      let comparisonData = null;
      if (compareWithLastPassed?.enabled) {
        try {
          // First, check test execution history to see if there's any passed execution
          const history = await this.reportingClient.getTestExecutionHistory(
            testRunId,
            testId,
            resolvedProjectId!,
            10 // Check last 10 executions
          );

          const lastPassed = history.items.find(item => 
            item.status === 'PASSED' && !item.passedManually
          );

          if (!lastPassed) {
            // All recent executions failed - set special flag
            comparisonData = {
              noPassedExecutionFound: true,
              totalExecutionsChecked: history.items.length,
              allFailedCount: history.items.filter(item => item.status === 'FAILED').length
            };
          } else {
            // Fetch detailed comparison data
            comparisonData = await this.fetchLastPassedComparison({
              testId,
              testRunId,
              projectId: resolvedProjectId!,
              projectKey: resolvedProjectKey!,
              currentTestRun: testRun,
              currentLogs: logsAndScreenshots,
              compareOptions: compareWithLastPassed,
              lastPassedExecution: lastPassed
            });
          }
        } catch (error: any) {
          // Log error but continue with analysis
          if (this.reportingClient['config'].debug) {
            console.warn(`[analyzeTestFailureById] Failed to fetch comparison data: ${error.message}`);
          }
        }
      }

      const analysisReport = await this.generateFailureAnalysisReport({
        testRun,
        testRunId,
        testId,
        projectId: resolvedProjectId!,
        projectKey: resolvedProjectKey!,
        logAnalysis,
        screenshots,
        similarFailures,
        errorClassification,
        format,
        baseUrl: this.reportingClient['config'].baseUrl,
        analyzeScreenshotsWithAI,
        screenshotAnalysisType,
        comparisonData,
        jiraBaseUrlOverride: jira_base_url
      });

      const warnings: string[] = [];
      if (logsFetchError) warnings.push(logsFetchError);
      const jiraWarning = this.reportingClient.jiraResolutionWarning;
      if (jiraWarning) warnings.push(jiraWarning);
      const warningBlock = warnings.length > 0
        ? `\n\n---\n**Warnings:**\n${warnings.map(w => `- ${w}`).join('\n')}\n`
        : '';

      return {
        content: [
          {
            type: "text" as const,
            text: analysisReport + warningBlock
          }
        ]
      };

    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error analyzing test failure: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Parse logs to extract key information
   */
  private parseLogsForAnalysis(items: any[]): {
    totalLogs: number;
    errorCount: number;
    warnCount: number;
    infoCount: number;
    errorLogs: Array<{ timestamp: string; message: string; level: string }>;
    lastActions: string[];
    criticalEvents: string[];
  } {
    const logs = items.filter(item => item.kind === 'log');
    
    const errorLogs: Array<{ timestamp: string; message: string; level: string }> = [];
    const lastActions: string[] = [];
    const criticalEvents: string[] = [];
    
    let errorCount = 0;
    let warnCount = 0;
    let infoCount = 0;

    // Reverse to get chronological order for last actions
    const recentLogs = [...logs].reverse().slice(0, 20);

    logs.forEach(log => {
      const level = log.level?.toUpperCase() || 'INFO';
      
      if (level === 'ERROR') {
        errorCount++;
        errorLogs.push({
          timestamp: log.instant,
          message: log.value,
          level: log.level
        });
      } else if (level === 'WARN') {
        warnCount++;
      } else if (level === 'INFO') {
        infoCount++;
      }

      // Capture critical events
      if (log.value && (
        log.value.includes('FAIL') ||
        log.value.includes('Cannot') ||
        log.value.includes('Unable to') ||
        log.value.includes('Exception') ||
        log.value.includes('Error')
      )) {
        criticalEvents.push(`[${log.instant}] ${log.value}`);
      }

      // Capture actions (Element clicked, Keys sent, etc.)
      if (log.value && (
        log.value.includes('is clicked') ||
        log.value.includes('are sent') ||
        log.value.includes('is present') ||
        log.value.includes('Navigating to')
      )) {
        lastActions.push(log.value);
      }
    });

    return {
      totalLogs: logs.length,
      errorCount,
      warnCount,
      infoCount,
      errorLogs: errorLogs.slice(0, 10), // Top 10 errors
      lastActions: lastActions.slice(-10), // Last 10 actions
      criticalEvents: criticalEvents.slice(-15) // Last 15 critical events
    };
  }

  /**
   * Extract screenshots from log items
   */
  private extractScreenshots(items: any[]): Array<{ timestamp: string; url: string; fileId: string }> {
    return items
      .filter(item => item.kind === 'screenshot')
      .map(screenshot => ({
        timestamp: screenshot.instant,
        fileId: screenshot.value.replace('/files/', ''),
        url: screenshot.value
      }));
  }

  /**
   * Find similar failures in recent test runs
   */
  private async findSimilarFailures(
    launchId: number,
    projectId: number,
    errorMessage: string,
    testClass: string,
    currentTestId: number
  ): Promise<any[]> {
    try {
      // Get all test runs from this launch
      const allTestRuns = await this.reportingClient.getAllTestRuns(launchId, projectId);
      
      // Filter for similar failures
      const similar = allTestRuns.items
        .filter(test => 
          test.id !== currentTestId &&
          test.status === 'FAILED' &&
          (
            test.message?.includes(errorMessage.substring(0, 50)) ||
            test.testClass === testClass
          )
        )
        .slice(0, 5) // Top 5 similar failures
        .map(test => ({
          testId: test.id,
          testName: test.name,
          testClass: test.testClass,
          status: test.status,
          message: test.message,
          stability: test.stability ? Math.round(test.stability * 100) : 0,
          sameError: test.message === errorMessage
        }));

      return similar;
    } catch (error) {
      console.error('Error finding similar failures:', error);
      return [];
    }
  }

  /**
   * Classify error type
   */
  private classifyError(errorMessage: string, errorLogs: any[]): {
    category: string;
    confidence: string;
    reasons: string[];
  } {
    const msg = errorMessage.toLowerCase();
    const allLogs = errorLogs.map(l => l.message.toLowerCase()).join(' ');

    if (msg.includes('element') && (msg.includes('not found') || msg.includes('impossible to find'))) {
      return {
        category: 'Locator Issue',
        confidence: 'High',
        reasons: [
          'Error message indicates element not found',
          'Likely UI element selector issue or timing problem'
        ]
      };
    }

    if (msg.includes('timeout') || allLogs.includes('timeout')) {
      return {
        category: 'Timing Issue',
        confidence: 'High',
        reasons: [
          'Timeout detected in error message or logs',
          'Element or condition took too long to appear'
        ]
      };
    }

    if (msg.includes('assertion') || msg.includes('expected') || msg.includes('actual')) {
      return {
        category: 'Business Issue',
        confidence: 'Medium',
        reasons: [
          'Assertion failure detected',
          'Expected vs actual value mismatch'
        ]
      };
    }

    if (msg.includes('network') || msg.includes('connection') || msg.includes('api')) {
      return {
        category: 'Environment Issue',
        confidence: 'Medium',
        reasons: [
          'Network or API related error',
          'May be infrastructure or connectivity problem'
        ]
      };
    }

    if (msg.includes('cannot swipe') || msg.includes('cannot scroll')) {
      return {
        category: 'Interaction Issue',
        confidence: 'High',
        reasons: [
          'UI interaction failed',
          'Element might be obscured or not interactable'
        ]
      };
    }

    return {
      category: 'Unknown',
      confidence: 'Low',
      reasons: ['Unable to determine specific error category']
    };
  }

  /**
   * Fetch last passed execution data for comparison
   */
  private async fetchLastPassedComparison(params: {
    testId: number;
    testRunId: number;
    projectId: number;
    projectKey: string;
    currentTestRun: any;
    currentLogs: any;
    compareOptions: any;
    lastPassedExecution: any;
  }): Promise<any> {
    const { testId, projectId, currentTestRun, currentLogs, compareOptions, lastPassedExecution } = params;

    const comparisonData: any = {
      lastPassedExecution: {
        testId: lastPassedExecution.testId,
        launchId: lastPassedExecution.testRunId,
        date: new Date(lastPassedExecution.startTime).toLocaleString(),
        duration: lastPassedExecution.elapsed
      }
    };

    // Fetch last passed test details
    const lastPassedTestRuns = await this.reportingClient.getTestRuns(lastPassedExecution.testRunId, projectId);
    const lastPassedTestRun = lastPassedTestRuns.items.find(t => t.id === lastPassedExecution.testId);

    if (!lastPassedTestRun) {
      return comparisonData;
    }

    // Compare duration (use session-aware effective duration when available)
    if (compareOptions.includeDuration !== false) {
      const wallClockMs = currentTestRun.finishTime - currentTestRun.startTime;
      let currentDuration = wallClockMs;

      try {
        const effDurMap = await this.resolveTestEffectiveDurations(
          params.testRunId, projectId,
          [{ id: testId, startTime: currentTestRun.startTime, finishTime: currentTestRun.finishTime }],
          'per_test'
        );
        const effDur = effDurMap.get(testId);
        if (effDur) {
          currentDuration = effDur.effectiveDurationSeconds * 1000;
        }
      } catch { /* fall back to wall-clock */ }

      const lastPassedDuration = lastPassedExecution.elapsed;
      const durationDiff = currentDuration - lastPassedDuration;
      const durationDiffPercent = lastPassedDuration > 0
        ? ((durationDiff / lastPassedDuration) * 100).toFixed(1) : '0.0';

      comparisonData.duration = {
        current: currentDuration,
        lastPassed: lastPassedDuration,
        difference: durationDiff,
        percentChange: durationDiffPercent
      };
    }

    // Compare environment
    if (compareOptions.includeEnvironment !== false && lastPassedTestRun) {
      comparisonData.environment = {
        changed: false,
        differences: []
      };

      // Check for environment changes (would need launch details for full comparison)
      if (lastPassedTestRun.testClass !== currentTestRun.testClass) {
        comparisonData.environment.changed = true;
        comparisonData.environment.differences.push('Test class changed');
      }
    }

    // Compare logs
    if (compareOptions.includeLogs !== false) {
      try {
        const lastPassedLogs = await this.reportingClient.getTestLogsAndScreenshots(
          lastPassedExecution.testRunId,
          lastPassedExecution.testId
        );

        const currentErrorLogs = currentLogs?.items?.filter((item: any) => 
          item.kind === 'log' && item.level === 'ERROR'
        ) || [];

        const lastPassedErrorLogs = lastPassedLogs.items.filter(item => 
          item.kind === 'log' && item.level === 'ERROR'
        );

        comparisonData.logs = {
          currentErrorCount: currentErrorLogs.length,
          lastPassedErrorCount: lastPassedErrorLogs.length,
          newErrors: currentErrorLogs.length > 0 ? ['New errors detected in current execution'] : []
        };
      } catch (error: any) {
        comparisonData.logs = { error: 'Failed to fetch last passed logs' };
      }
    }

    // Compare screenshots
    if (compareOptions.includeScreenshots !== false) {
      try {
        const lastPassedLogs = await this.reportingClient.getTestLogsAndScreenshots(
          lastPassedExecution.testRunId,
          lastPassedExecution.testId
        );

        const currentScreenshots = currentLogs?.items?.filter((item: any) => item.kind === 'screenshot') || [];
        const lastPassedScreenshots = lastPassedLogs.items.filter(item => item.kind === 'screenshot');

        comparisonData.screenshots = {
          currentCount: currentScreenshots.length,
          lastPassedCount: lastPassedScreenshots.length,
          lastScreenshotAvailable: lastPassedScreenshots.length > 0
        };
      } catch (error: any) {
        comparisonData.screenshots = { error: 'Failed to fetch last passed screenshots' };
      }
    }

    return comparisonData;
  }

  /**
   * Generate comprehensive failure analysis report
   */
  private async generateFailureAnalysisReport(params: {
    testRun: any;
    testRunId: number;
    testId: number;
    projectId: number;
    projectKey?: string;
    logAnalysis: any;
    screenshots: any[];
    similarFailures: any[];
    errorClassification: any;
    format: 'detailed' | 'summary';
    baseUrl: string;
    analyzeScreenshotsWithAI?: boolean;
    screenshotAnalysisType?: 'basic' | 'detailed';
    comparisonData?: any;
    jiraBaseUrlOverride?: string;
  }): Promise<string> {
    const {
      testRun,
      testRunId,
      testId,
      projectId,
      projectKey,
      logAnalysis,
      screenshots,
      similarFailures,
      errorClassification,
      format,
      baseUrl,
      analyzeScreenshotsWithAI = false,
      screenshotAnalysisType = 'detailed',
      comparisonData,
      jiraBaseUrlOverride
    } = params;

    const wallClockDuration = testRun.finishTime && testRun.startTime
      ? Math.round((testRun.finishTime - testRun.startTime) / 1000)
      : 0;

    // Resolve session-aware effective duration for this test
    const effMap = await this.resolveTestEffectiveDurations(
      testRunId, projectId, [{ id: testId, startTime: testRun.startTime, finishTime: testRun.finishTime }], 'per_test'
    );
    const eff = effMap.get(testId);
    const duration = eff ? eff.effectiveDurationSeconds : wallClockDuration;

    const stability = testRun.stability ? Math.round(testRun.stability * 100) : 0;

    // Build Zebrunner UI links
    const testSessionUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}/tests/${testId}`;
    const launchUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}`;

    if (format === 'summary') {
      return await this.generateSummaryReport({
        testRun,
        testId,
        testRunId,
        projectId,
        projectKey,
        duration,
        stability,
        errorClassification,
        logAnalysis,
        screenshots,
        similarFailures,
        testSessionUrl,
        baseUrl
      });
    }

    // Detailed report
    let report = `# 🔍 Deep Failure Analysis: Test ID ${testId}\n\n`;

    // Executive Summary
    report += `## 📊 Executive Summary\n\n`;
    report += `- **Test Name:** ${testRun.name}\n`;
    report += `- **Status:** ❌ ${testRun.status}\n`;
    report += `- **Root Cause:** ${errorClassification.category}\n`;
    report += `- **Confidence:** ${errorClassification.confidence}\n`;
    report += `- **Stability:** ${stability}%\n`;
    
    // Get device/OS info from sessions (FAILED first) for Executive Summary
    const sessionsForSummary = await this.getAllSessionsWithArtifacts(testRunId, testId, projectId);
    if (sessionsForSummary.length > 0) {
      const failedSession = sessionsForSummary.find(s => s.status === 'FAILED' || s.status === 'ABORTED');
      const primarySession = failedSession || sessionsForSummary[0];
      
      report += `- **Device:** ${primarySession.device}\n`;
      report += `- **Platform:** ${primarySession.platform}\n`;
      
      // Show other environments if available
      if (sessionsForSummary.length > 1) {
        const uniqueEnvs = [...new Set(sessionsForSummary.map(s => `${s.device} (${s.platform})`))];
        if (uniqueEnvs.length > 1) {
          const otherEnvs = sessionsForSummary
            .filter(s => s.sessionId !== primarySession.sessionId)
            .map(s => `${s.device} (${s.platform})`)
            .slice(0, 2)
            .join(', ');
          report += `- **Other Environments:** ${otherEnvs}`;
          if (sessionsForSummary.length > 3) {
            report += `, +${sessionsForSummary.length - 3} more`;
          }
          report += `\n`;
        }
      }
    }
    
    // Test Cases
    if (testRun.testCases && testRun.testCases.length > 0) {
      const testCaseLinks = await this.formatTestCases(testRun.testCases, projectKey!, baseUrl, 'markdown');
      report += `- **Test Cases:** 📋 ${testCaseLinks}\n`;
    } else {
      report += `- **Test Cases:** ⚠️ Not linked to test case\n`;
    }
    
    report += `- **Bug Status:** ${testRun.issueReferences && testRun.issueReferences.length > 0 ? '✅ Bug Linked' : '❌ No Bug Linked'}\n\n`;

    // Comparison with Last Passed Execution
    if (comparisonData) {
      if (comparisonData.noPassedExecutionFound) {
        report += `## ⚠️ Comparison with Last Passed\n\n`;
        report += `**🔴 CRITICAL: No Passed Executions Found**\n\n`;
        report += `This test has **FAILED** in all of the last **${comparisonData.totalExecutionsChecked}** executions.\n`;
        report += `- **Total Failures:** ${comparisonData.allFailedCount}\n`;
        report += `- **Recommendation:** This test appears to be consistently failing. Investigate if:\n`;
        report += `  - Test is flaky or broken\n`;
        report += `  - Feature is not implemented\n`;
        report += `  - Environment issues are blocking the test\n\n`;
      } else {
        report += `## 🔄 Comparison with Last Passed\n\n`;
        report += `Comparing current failure with last successful execution:\n\n`;
        report += `**Last Passed:** [Launch ${comparisonData.lastPassedExecution.launchId}](${baseUrl}/projects/${projectKey}/automation-launches/${comparisonData.lastPassedExecution.launchId}/tests/${comparisonData.lastPassedExecution.testId})\n`;
        report += `**Date:** ${comparisonData.lastPassedExecution.date}\n\n`;

        if (comparisonData.duration) {
          const currentDurationSec = Math.round(comparisonData.duration.current / 1000);
          const lastPassedDurationSec = Math.round(comparisonData.duration.lastPassed / 1000);
          const diffSec = Math.round(comparisonData.duration.difference / 1000);
          const diffIndicator = diffSec > 0 ? '🔴 Slower' : '🟢 Faster';
          
          report += `**Duration Comparison:**\n`;
          report += `- Current: ${currentDurationSec}s\n`;
          report += `- Last Passed: ${lastPassedDurationSec}s\n`;
          report += `- Difference: ${diffIndicator} by ${Math.abs(diffSec)}s (${comparisonData.duration.percentChange}%)\n\n`;
        }

        if (comparisonData.logs) {
          report += `**Log Comparison:**\n`;
          if (comparisonData.logs.error) {
            report += `- ⚠️ ${comparisonData.logs.error}\n`;
          } else {
            report += `- Current Errors: ${comparisonData.logs.currentErrorCount}\n`;
            report += `- Last Passed Errors: ${comparisonData.logs.lastPassedErrorCount}\n`;
            if (comparisonData.logs.currentErrorCount > comparisonData.logs.lastPassedErrorCount) {
              report += `- 🔴 New errors appeared in current execution\n`;
            }
          }
          report += `\n`;
        }

        if (comparisonData.screenshots) {
          report += `**Screenshot Comparison:**\n`;
          if (comparisonData.screenshots.error) {
            report += `- ⚠️ ${comparisonData.screenshots.error}\n`;
          } else {
            report += `- Current Screenshots: ${comparisonData.screenshots.currentCount}\n`;
            report += `- Last Passed Screenshots: ${comparisonData.screenshots.lastPassedCount}\n`;
          }
          report += `\n`;
        }

        if (comparisonData.environment?.changed) {
          report += `**Environment Changes:**\n`;
          comparisonData.environment.differences.forEach((diff: string) => {
            report += `- 🔶 ${diff}\n`;
          });
          report += `\n`;
        }
      }
    }

    // Test Session Details
    report += `## 🧪 Test Session Details\n\n`;
    report += `- **Test ID:** [${testId}](${testSessionUrl})\n`;
    report += `- **Launch ID:** [${testRunId}](${launchUrl})\n`;
    report += `- **Test Class:** ${testRun.testClass || 'Unknown'}\n`;
    if (eff && eff.sessionCount > 1) {
      report += `- **Effective Duration:** ${Math.floor(duration / 60)}m ${duration % 60}s (session that produced the result)\n`;
      report += `- **Longest Session:** ${Math.floor(eff.longestSessionDurationSeconds / 60)}m ${eff.longestSessionDurationSeconds % 60}s\n`;
      report += `- **Total with ${eff.sessionCount} retries:** ${Math.floor(wallClockDuration / 60)}m ${wallClockDuration % 60}s\n`;
    } else {
      report += `- **Duration:** ${Math.floor(duration / 60)}m ${duration % 60}s\n`;
    }
    report += `- **Started:** ${new Date(testRun.startTime).toISOString()}\n`;
    report += `- **Finished:** ${testRun.finishTime ? new Date(testRun.finishTime).toISOString() : 'N/A'}\n`;
    report += `- **Owner:** ${testRun.owner || 'Unknown'}\n\n`;

    // Test Execution Sessions (Videos & Screenshots)
    // Sessions are sorted: FAILED first, then newest within each status
    const sessions = await this.getAllSessionsWithArtifacts(testRunId, testId, projectId);
    if (sessions.length > 0) {
      report += `## 📹 Test Execution Sessions\n\n`;
      report += `**Total Sessions:** ${sessions.length}`;
      
      // Group sessions by status for summary
      const failedSessions = sessions.filter(s => s.status === 'FAILED' || s.status === 'ABORTED');
      const passedSessions = sessions.filter(s => s.status !== 'FAILED' && s.status !== 'ABORTED');
      
      if (failedSessions.length > 0 && passedSessions.length > 0) {
        report += ` (${failedSessions.length} failed, ${passedSessions.length} passed)`;
      }
      report += `\n\n`;
      
      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        const sessionNumber = i + 1;
        const isFailed = session.status === 'FAILED' || session.status === 'ABORTED';
        const isPassed = session.status === 'PASSED';
        
        // Status indicator emoji
        const statusEmoji = isFailed ? '❌' : (isPassed ? '✅' : '⚠️');
        const sessionType = i === 0 ? 'Latest Execution' : `Execution ${sessionNumber}`;
        
        report += `### ${statusEmoji} ${sessionType} - ${session.status}\n\n`;
        report += `- **Device:** ${session.device}\n`;
        report += `- **Platform:** ${session.platform}\n`;
        report += `- **Duration:** ${session.duration}\n`;
        report += `- **Started:** ${session.startedAt}\n\n`;
        
        // Display videos with clickable links
        if (session.videos.length > 0) {
          report += `**Videos:**\n\n`;
          session.videos.forEach((video, vidIdx) => {
            const videoLabel = session.videos.length > 1 ? `Video ${vidIdx + 1}` : 'Test Execution Video';
            report += `${session.videos.length > 1 ? `${vidIdx + 1}. ` : ''}🎥 [${videoLabel}](${video.url})\n`;
          });
          report += `\n`;
        }
        
        // Display all screenshots with clickable links (for detailed format)
        if (session.screenshots.length > 0) {
          report += `**Screenshots:** ${session.screenshots.length} available\n\n`;
          session.screenshots.forEach((screenshot, scrIdx) => {
            const screenshotNumber = scrIdx + 1;
            report += `${screenshotNumber}. 🖼️ [Screenshot ${screenshotNumber}](${screenshot.url})\n`;
          });
          report += `\n`;
        }
      }
    }

    // Failure Information
    report += `## 🚨 Failure Information\n\n`;
    
    // Error Message - Show both short (300 chars) and full
    const fullErrorMessage = testRun.message || 'No error message available';
    report += `### Error Message (Short)\n\n`;
    report += `\`\`\`\n${fullErrorMessage.substring(0, 300)}${fullErrorMessage.length > 300 ? '\n... (truncated, see full message below)' : ''}\n\`\`\`\n\n`;
    
    if (fullErrorMessage.length > 300) {
      report += `### Full Error Message\n\n`;
      report += `\`\`\`\n${fullErrorMessage}\n\`\`\`\n\n`;
    }

    // Error Classification
    report += `### Error Classification\n\n`;
    report += `- **Category:** ${errorClassification.category}\n`;
    report += `- **Confidence:** ${errorClassification.confidence}\n\n`;
    report += `**Reasons:**\n\n`;
    errorClassification.reasons.forEach((reason: string) => {
      report += `- ${reason}\n`;
    });
    report += `\n`;

    // Log Analysis
    if (logAnalysis) {
      report += `## 📝 Log Analysis\n\n`;
      report += `### Statistics\n\n`;
      report += `- **Total Log Lines:** ${logAnalysis.totalLogs}\n`;
      report += `- **Error Count:** ${logAnalysis.errorCount}\n`;
      report += `- **Warning Count:** ${logAnalysis.warnCount}\n`;
      report += `- **Info Count:** ${logAnalysis.infoCount}\n\n`;

      if (logAnalysis.criticalEvents.length > 0) {
        report += `### Critical Events\n\n`;
        logAnalysis.criticalEvents.slice(0, 10).forEach((event: string) => {
          report += `- ${event}\n`;
        });
        report += `\n`;
      }

      if (logAnalysis.lastActions.length > 0) {
        report += `### Last Actions Before Failure\n\n`;
        logAnalysis.lastActions.slice(-5).forEach((action: string, idx: number) => {
          report += `${idx + 1}. ${action}\n`;
        });
        report += `\n`;
      }

      if (logAnalysis.errorLogs.length > 0) {
        report += `### Error Logs (Top ${Math.min(5, logAnalysis.errorLogs.length)})\n\n`;
        logAnalysis.errorLogs.slice(0, 5).forEach((log: any, idx: number) => {
          report += `${idx + 1}. **[${log.level}]** ${new Date(log.timestamp).toLocaleTimeString()}:\n`;
          const truncatedLog = log.message.substring(0, 300);
          report += `\`\`\`\n${truncatedLog}${log.message.length > 300 ? '\n...' : ''}\n\`\`\`\n\n`;
        });
        if (logAnalysis.errorLogs.length > 5) {
          report += `_... and ${logAnalysis.errorLogs.length - 5} more error log entries_\n\n`;
        }
      }
    }

    // Screenshots with optional AI analysis (from test sessions)
    // Collect all screenshots from all sessions
    const allSessionScreenshots: Array<{ url: string; sessionName: string }> = [];
    for (const session of sessions) {
      for (const screenshot of session.screenshots) {
        allSessionScreenshots.push({
          url: screenshot.url,
          sessionName: session.name
        });
      }
    }
    
    // Use latest screenshot from latest session for AI analysis
    const latestScreenshot = sessions.length > 0 && sessions[0].screenshots.length > 0 
      ? sessions[0].screenshots[sessions[0].screenshots.length - 1] 
      : null;
      
    if (latestScreenshot || screenshots.length > 0) {
      report += `## 📸 Screenshot Analysis\n\n`;
      
      // Use screenshot from session if available, otherwise fall back to old screenshots array
      const screenshotForAnalysis = latestScreenshot || screenshots[screenshots.length - 1];
      
      if (screenshotForAnalysis) {
        report += `### Latest Screenshot Before Failure\n\n`;
        const screenshotUrl = latestScreenshot ? latestScreenshot.url : `${baseUrl}${screenshotForAnalysis.url}`;
        report += `- **URL:** [View Screenshot](${screenshotUrl})\n\n`;
        
        // AI-powered screenshot analysis if requested
        if (analyzeScreenshotsWithAI) {
          try {
            const enableOCR = screenshotAnalysisType === 'detailed';
            
            report += `#### 🤖 AI-Powered Visual Analysis\n\n`;
            report += `*Analyzing screenshot with ${screenshotAnalysisType} analysis...*\n\n`;
            
            const screenshotAnalysisResult = await this.analyzeScreenshotTool({
              screenshotUrl: screenshotUrl,
              testId: testId,
              enableOCR,
              analysisType: screenshotAnalysisType,
              expectedState: `Test ${testRun?.name || testId} should pass without errors`
            });
            
            // Extract text content from analysis result
            if (screenshotAnalysisResult.content) {
              const textContent = screenshotAnalysisResult.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n\n');
              
              if (textContent) {
                report += `<details>\n<summary>📊 Click to view visual analysis results</summary>\n\n`;
                report += textContent;
                report += `\n\n</details>\n\n`;
              }
            }
          } catch (error) {
            report += `⚠️ **Screenshot analysis failed:** ${error instanceof Error ? error.message : error}\n\n`;
          }
        } else {
          // Note about visual analysis
          report += `💡 **Tip:** Use \`analyze_screenshot\` tool or enable \`analyzeScreenshotsWithAI: true\` for detailed visual analysis including:\n`;
          report += `- Device and screen information\n`;
          report += `- OCR text extraction\n`;
          report += `- Claude Vision AI analysis\n`;
          report += `- UI element detection\n\n`;
        }
      }
      
      // Note about all screenshots being in the Sessions section
      if (sessions.length > 0 && allSessionScreenshots.length > 1) {
        report += `💡 **Note:** All ${allSessionScreenshots.length} screenshots are available in the "Test Execution Sessions" section above.\n\n`;
      }
    }

    // Similar Failures
    if (similarFailures.length > 0) {
      report += `## 🔄 Similar Failure Pattern Analysis\n\n`;
      report += `**Similar Failures Found:** ${similarFailures.length}\n\n`;
      
      similarFailures.forEach((failure: any, idx: number) => {
        report += `### ${idx + 1}. Test ID ${failure.testId}\n\n`;
        report += `- **Test Name:** ${failure.testName}\n`;
        report += `- **Test Class:** ${failure.testClass}\n`;
        report += `- **Status:** ${failure.status}\n`;
        report += `- **Stability:** ${failure.stability}%\n`;
        report += `- **Same Error:** ${failure.sameError ? '✅ Yes' : '❌ No'}\n`;
        if (failure.message) {
          report += `- **Error:** ${failure.message.substring(0, 100)}...\n`;
        }
        report += `\n`;
      });

      const pattern = similarFailures.filter((f: any) => f.sameError).length;
      if (pattern > 0) {
        report += `**Pattern Detected:** ${pattern} test(s) failed with the same error message.\n\n`;
      }
    }

    // Root Cause Assessment
    report += `## 💡 Root Cause Assessment\n\n`;
    report += `### Identified Issues\n\n`;
    report += `**Primary Cause (Confidence: ${errorClassification.confidence})**\n\n`;
    report += `${errorClassification.reasons.join('. ')}\n\n`;

    // Actionable Recommendations
    report += `## 🎯 Actionable Recommendations\n\n`;
    report += this.generateRecommendations(errorClassification, testRun, similarFailures);

    // Bug Report Section
    report += `## 📋 Bug Report Status\n\n`;
    if (testRun.issueReferences && testRun.issueReferences.length > 0) {
      report += `**Linked Issues:**\n\n`;
      for (const issue of testRun.issueReferences) {
        if (issue.type === 'JIRA') {
          try {
            const jiraUrl = await this.reportingClient.buildJiraUrl(issue.value, projectId, jiraBaseUrlOverride);
            report += `- **${issue.type}:** [${issue.value}](${jiraUrl})\n`;
          } catch {
            report += `- **${issue.type}:** ${issue.value}\n`;
          }
        } else {
          report += `- **${issue.type}:** ${issue.value}\n`;
        }
      }
      report += `\n`;
    } else {
      report += `**Should Create Bug?** Yes\n\n`;
      report += `**Suggested Priority:** ${stability < 50 ? 'P1 (High)' : 'P2 (Medium)'}\n\n`;
      report += `**Draft Title:**\n\n`;
      report += `\`\`\`\n[${errorClassification.category}] ${testRun.name} - ${errorClassification.category}\n\`\`\`\n\n`;
    }

    // Test Case Links
    if (testRun.testCases && testRun.testCases.length > 0) {
      report += `## 🔗 Linked Test Cases\n\n`;
      for (const tc of testRun.testCases) {
        const tcUrl = await this.buildTestCaseUrl(tc.testCaseId, projectKey!, baseUrl);
        report += `- **[${tc.testCaseId}](${tcUrl})** (Type: ${tc.tcmType || 'ZEBRUNNER'}${tc.resultStatus ? `, Status: ${tc.resultStatus}` : ''})\n`;
      }
      report += `\n`;
    }

    // Test Stability Context
    report += `## 📊 Test Stability Context\n\n`;
    report += `- **Stability:** ${stability}%\n`;
    report += `- **Failure Rate:** ${100 - stability}%\n`;
    report += `- **Trend:** ${stability >= 70 ? '✅ Generally Stable' : stability >= 40 ? '⚠️ Moderately Unstable' : '❌ Highly Unstable'}\n\n`;

    // Quick Access Links
    report += `## 🔍 Quick Access Links\n\n`;
    report += `- **[🔗 Test Session](${testSessionUrl})**\n`;
    report += `- **[🚀 Launch](${launchUrl})**\n`;
    
    // Test Case Links
    if (testRun.testCases && testRun.testCases.length > 0) {
      for (const tc of testRun.testCases) {
        const tcUrl = await this.buildTestCaseUrl(tc.testCaseId, projectKey!, baseUrl);
        report += `- **[📋 Test Case ${tc.testCaseId}](${tcUrl})**\n`;
      }
    }
    
    // Videos and screenshots links are now in the Test Execution Sessions section
    if (sessions.length > 0) {
      report += `\n💡 **Tip:** Videos and screenshots are available in the "Test Execution Sessions" section above.\n`;
    }
    
    report += `\n`;

    report += `---\n\n`;
    report += `*Analysis generated at ${new Date().toISOString()}*\n`;

    return report;
  }

  /**
   * Generate summary report
   */
  private async generateSummaryReport(params: {
    testRun: any;
    testId: number;
    testRunId: number;
    projectId: number;
    projectKey?: string;
    duration: number;
    stability: number;
    errorClassification: any;
    logAnalysis: any;
    screenshots: any[];
    similarFailures: any[];
    testSessionUrl: string;
    baseUrl: string;
  }): Promise<string> {
    const {
      testRun,
      testId,
      testRunId,
      projectId,
      projectKey,
      duration,
      stability,
      errorClassification,
      logAnalysis,
      screenshots,
      similarFailures,
      testSessionUrl,
      baseUrl
    } = params;

    let report = `# 🔍 Test Failure Summary: ${testId}\n\n`;
    report += `**Test:** ${testRun.name}\n`;
    report += `**Test ID:** [${testId}](${testSessionUrl})\n`;
    report += `**Status:** ❌ ${testRun.status}\n`;
    
    // Add suite/test class
    if (testRun.testClass) {
      report += `**Suite/Test Class:** ${testRun.testClass}\n`;
    }
    
    report += `**Error Type:** ${errorClassification.category} (${errorClassification.confidence} confidence)\n`;
    report += `**Stability:** ${stability}%\n`;
    report += `**Duration:** ${Math.floor(duration / 60)}m ${duration % 60}s\n`;
    
    // Test Cases
    if (testRun.testCases && testRun.testCases.length > 0) {
      const testCaseLinks = await this.formatTestCases(testRun.testCases, projectKey!, baseUrl, 'markdown');
      report += `**Test Cases:** 📋 ${testCaseLinks}\n`;
    } else {
      report += `**Test Cases:** ⚠️ Not linked to test case\n`;
    }
    
    // Get sessions for device/OS info (FAILED sessions first)
    const sessions = await this.getAllSessionsWithArtifacts(testRunId, testId, projectId);
    if (sessions.length > 0) {
      // Show device/OS info from FAILED session first, then others
      const failedSession = sessions.find(s => s.status === 'FAILED' || s.status === 'ABORTED');
      const sessionToShow = failedSession || sessions[0];
      
      report += `**Device:** ${sessionToShow.device}\n`;
      report += `**Platform:** ${sessionToShow.platform}\n`;
      
      // If there are multiple sessions with different devices, note that
      if (sessions.length > 1) {
        const uniqueDevices = [...new Set(sessions.map(s => s.device))];
        const uniquePlatforms = [...new Set(sessions.map(s => s.platform))];
        if (uniqueDevices.length > 1 || uniquePlatforms.length > 1) {
          report += `**Other Environments:** `;
          const otherSessions = sessions.filter(s => s.sessionId !== sessionToShow.sessionId);
          const envs = otherSessions.map(s => `${s.device} (${s.platform})`).slice(0, 2);
          report += envs.join(', ');
          if (otherSessions.length > 2) {
            report += `, +${otherSessions.length - 2} more`;
          }
          report += `\n`;
        }
      }
    }
    
    report += `\n`;

    // Error Message (short) and Error Logs
    const errorMessage = testRun.message || 'No error message';
    const truncatedError = errorMessage.substring(0, 300);
    report += `**Error (Short):**\n\`\`\`\n${truncatedError}${errorMessage.length > 300 ? '\n... (truncated)' : ''}\n\`\`\`\n\n`;
    
    // Show first 5 error logs with timestamps
    if (logAnalysis && logAnalysis.errorLogs && logAnalysis.errorLogs.length > 0) {
      report += `**Error Logs (Top ${Math.min(5, logAnalysis.errorLogs.length)}):**\n\n`;
      logAnalysis.errorLogs.slice(0, 5).forEach((log: any, idx: number) => {
        const logTime = new Date(log.timestamp).toLocaleTimeString();
        const truncatedLog = log.message.substring(0, 200);
        report += `${idx + 1}. **[${log.level}]** ${logTime}:\n\`\`\`\n${truncatedLog}${log.message.length > 200 ? '...' : ''}\n\`\`\`\n\n`;
      });
      if (logAnalysis.errorLogs.length > 5) {
        report += `_... and ${logAnalysis.errorLogs.length - 5} more error log entries_\n\n`;
      }
    }

    // Session artifacts (videos and screenshots)
    if (sessions.length > 0) {
      const latestSession = sessions[0];
      
      // Video link from latest session
      if (latestSession.videos.length > 0) {
        report += `**🎥 Video:** [Watch Test Execution](${latestSession.videos[0].url})\n`;
      }
      
      // Last screenshot from latest session
      if (latestSession.screenshots.length > 0) {
        const lastScreenshot = latestSession.screenshots[latestSession.screenshots.length - 1];
        report += `**📸 Screenshot:** [View Last Screenshot](${lastScreenshot.url})\n`;
      }
      
      // Show session count if multiple
      if (sessions.length > 1) {
        report += `**📹 Sessions:** ${sessions.length} test executions recorded\n`;
      }
    }

    if (similarFailures.length > 0) {
      report += `**Similar Failures:** ${similarFailures.length} found in this launch\n`;
    }

    const launchUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}`;
    report += `\n**[View Test Details](${testSessionUrl})** | **[View Launch](${launchUrl})**\n`;

    return report;
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(errorClassification: any, testRun: any, similarFailures: any[]): string {
    let recommendations = ``;

    if (errorClassification.category === 'Locator Issue') {
      recommendations += `### Immediate Actions (High Priority)\n\n`;
      recommendations += `1. ✅ **Update Element Locator**\n`;
      recommendations += `   - Review the page object for element selector\n`;
      recommendations += `   - Check if UI has changed and selector needs update\n`;
      recommendations += `   - Consider using more robust locator strategies\n\n`;
      recommendations += `2. ✅ **Add Explicit Waits**\n`;
      recommendations += `   - Add wait for element visibility before interaction\n`;
      recommendations += `   - Increase timeout if element loads slowly\n\n`;
    } else if (errorClassification.category === 'Timing Issue') {
      recommendations += `### Immediate Actions (High Priority)\n\n`;
      recommendations += `1. ✅ **Increase Timeout Values**\n`;
      recommendations += `   - Review and increase wait timeouts\n`;
      recommendations += `   - Add retry logic for flaky operations\n\n`;
      recommendations += `2. ✅ **Improve Wait Strategies**\n`;
      recommendations += `   - Use explicit waits instead of implicit waits\n`;
      recommendations += `   - Wait for specific conditions before proceeding\n\n`;
    } else if (errorClassification.category === 'Business Issue') {
      recommendations += `### Immediate Actions (High Priority)\n\n`;
      recommendations += `1. ✅ **Verify Expected Values**\n`;
      recommendations += `   - Check if expected values are still valid\n`;
      recommendations += `   - Review business logic changes\n`;
      recommendations += `   - Validate test data\n\n`;
    } else {
      recommendations += `### Immediate Actions (High Priority)\n\n`;
      recommendations += `1. ✅ **Investigate Root Cause**\n`;
      recommendations += `   - Review logs and screenshots\n`;
      recommendations += `   - Check environment configuration\n`;
      recommendations += `   - Validate test prerequisites\n\n`;
    }

    if (similarFailures.length > 2) {
      recommendations += `### Follow-up Actions (Medium Priority)\n\n`;
      recommendations += `2. 🔧 **Address Pattern of Failures**\n`;
      recommendations += `   - ${similarFailures.length} similar failures detected\n`;
      recommendations += `   - Consider refactoring common test code\n`;
      recommendations += `   - Review shared page objects or utilities\n\n`;
    }

    recommendations += `### Long-term Improvements\n\n`;
    recommendations += `3. 🌟 **Improve Test Reliability**\n`;
    recommendations += `   - Add better error handling\n`;
    recommendations += `   - Implement test data cleanup\n`;
    recommendations += `   - Consider test isolation improvements\n\n`;

    return recommendations;
  }

  /**
   * Download test screenshot with authentication
   */
  async downloadTestScreenshot(input: {
    screenshotUrl: string;
    testId?: number;
    projectKey?: string;
    outputPath?: string;
    returnBase64?: boolean;
  }) {
    const { screenshotUrl, testId, projectKey, outputPath, returnBase64 = false } = input;

    try {
      // Import screenshot analyzer utilities
      const { 
        saveScreenshotToTemp, 
        getImageMetadata, 
        bufferToBase64,
        detectImageFormat 
      } = await import('../utils/screenshot-analyzer.js');

      // Download screenshot using authenticated client
      const imageBuffer = await this.reportingClient.downloadScreenshot(screenshotUrl);

      // Get metadata
      const metadata = await getImageMetadata(imageBuffer);
      const format = detectImageFormat(imageBuffer);

      // Determine filename
      const timestamp = Date.now();
      const testIdPart = testId ? `_test${testId}` : '';
      const filename = outputPath || `screenshot${testIdPart}_${timestamp}.${format}`;

      // Save to temp directory if not using custom path
      const localPath = outputPath || await saveScreenshotToTemp(imageBuffer, filename);

      // Prepare response
      const result: any = {
        success: true,
        screenshotUrl,
        localPath,
        metadata: {
          fileSize: imageBuffer.length,
          format,
          dimensions: {
            width: metadata.width,
            height: metadata.height
          },
          orientation: metadata.orientation,
          aspectRatio: metadata.aspectRatio
        }
      };

      if (testId) {
        result.testId = testId;
      }

      if (projectKey) {
        result.projectKey = projectKey;
      }

      if (returnBase64) {
        result.base64 = bufferToBase64(imageBuffer);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error downloading screenshot: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Analyze screenshot with optional OCR and visual analysis
   * Returns analysis that can be used by Claude's vision capabilities via MCP
   */
  async analyzeScreenshotTool(input: {
    screenshotUrl?: string;
    screenshotPath?: string;
    testId?: number;
    enableOCR?: boolean;
    analysisType?: 'basic' | 'detailed';
    expectedState?: string;
  }) {
    const {
      screenshotUrl,
      screenshotPath,
      testId,
      enableOCR = false,
      analysisType = 'basic',
      expectedState
    } = input;

    try {
      // Import analyzer utilities
      const {
        analyzeScreenshot,
        detectDeviceInfo,
        getImageMetadata,
        bufferToBase64
      } = await import('../utils/screenshot-analyzer.js');

      let imageBuffer: Buffer;

      // Get image buffer from URL or path
      if (screenshotUrl) {
        imageBuffer = await this.reportingClient.downloadScreenshot(screenshotUrl);
      } else if (screenshotPath) {
        const fs = await import('fs');
        imageBuffer = await fs.promises.readFile(screenshotPath);
      } else {
        throw new Error('Either screenshotUrl or screenshotPath must be provided');
      }

      // Perform basic analysis
      const analysis = await analyzeScreenshot(imageBuffer, {
        enableOCR,
        ocrLanguage: 'eng'
      });

      // Build analysis report
      let report = `# Screenshot Analysis Report\n\n`;

      // Basic Information
      report += `## 📊 Basic Information\n\n`;
      report += `- **Dimensions:** ${analysis.metadata.width}x${analysis.metadata.height} (${analysis.metadata.orientation})\n`;
      report += `- **Format:** ${analysis.metadata.format.toUpperCase()}\n`;
      report += `- **File Size:** ${Math.round(analysis.metadata.size / 1024)} KB\n`;
      report += `- **Aspect Ratio:** ${analysis.metadata.aspectRatio}\n\n`;

      // Device Detection
      if (analysis.deviceInfo?.detectedDevice) {
        report += `## 📱 Device Information\n\n`;
        report += `- **Detected Device:** ${analysis.deviceInfo.detectedDevice}\n`;
        report += `- **Device Type:** Phone\n`;
        report += `- **Orientation:** ${analysis.metadata.orientation}\n\n`;
      }

      // OCR Results
      if (analysis.ocrText && enableOCR) {
        report += `## 📝 Extracted Text (OCR)\n\n`;
        report += `**Confidence:** ${Math.round(analysis.ocrText.confidence)}%\n\n`;
        report += `\`\`\`\n${analysis.ocrText.text}\n\`\`\`\n\n`;

        if (analysis.ocrText.lines.length > 0) {
          report += `**Key Lines:**\n\n`;
          analysis.ocrText.lines.slice(0, 10).forEach((line, idx) => {
            if (line.trim()) {
              report += `${idx + 1}. ${line}\n`;
            }
          });
          report += `\n`;
        }
      }

      // UI Element Detection
      if (analysis.uiElements) {
        report += `## 🔍 UI Elements Detected\n\n`;
        
        const elements: string[] = [];
        if (analysis.uiElements.hasEmptyState) elements.push('✅ Empty State');
        if (analysis.uiElements.hasLoadingIndicator) elements.push('⏳ Loading Indicator');
        if (analysis.uiElements.hasErrorDialog) elements.push('❌ Error Dialog');
        if (analysis.uiElements.hasNavigationBar) elements.push('🧭 Navigation Bar');
        
        if (elements.length > 0) {
          elements.forEach(el => report += `- ${el}\n`);
        } else {
          report += `- No specific UI elements detected from text\n`;
        }
        report += `\n`;
      }

      // Expected State Comparison
      if (expectedState) {
        report += `## 🎯 Expected State Comparison\n\n`;
        report += `**Expected:** ${expectedState}\n\n`;
        if (analysis.uiElements) {
          if (analysis.uiElements.hasEmptyState) {
            report += `⚠️ **Actual State:** Empty state detected - no data displayed\n\n`;
          } else if (analysis.uiElements.hasErrorDialog) {
            report += `❌ **Actual State:** Error dialog visible\n\n`;
          } else if (analysis.uiElements.hasLoadingIndicator) {
            report += `⏳ **Actual State:** Loading in progress\n\n`;
          }
        }
      }

      // For detailed analysis, include base64 for Claude Vision
      if (analysisType === 'detailed') {
        const base64Image = bufferToBase64(imageBuffer);
        const imageFormat = analysis.metadata.format === 'jpg' ? 'jpeg' : analysis.metadata.format;
        
        report += `\n## 🤖 Advanced Analysis\n\n`;
        report += `For detailed visual analysis, the screenshot is available for Claude Vision analysis.\n\n`;

        // Return both text and image for MCP
        return {
          content: [
            {
              type: "text" as const,
              text: report
            },
            {
              type: "image" as const,
              data: base64Image,
              mimeType: `image/${imageFormat}` as any
            },
            {
              type: "text" as const,
              text: `\n\n**Analysis Context:**\nTest ID: ${testId || 'N/A'}\nExpected State: ${expectedState || 'Not provided'}\n\n**Please analyze this screenshot and:**\n1. Identify what page/screen is displayed\n2. List all visible UI elements\n3. Detect any error messages or dialogs\n4. Determine if the UI matches the expected state\n5. Explain any visual anomalies\n6. Provide recommendations for test fixes if needed`
            }
          ]
        };
      }

      // Basic analysis - text only
      return {
        content: [
          {
            type: "text" as const,
            text: report
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error analyzing screenshot: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Get all test sessions with their artifacts (videos, screenshots)
   * Returns sessions sorted by status (FAILED first) then by date (newest first within each status)
   * Only includes sessions with valid artifacts (videos or screenshots)
   */
  private async getAllSessionsWithArtifacts(
    testRunId: number, 
    testId: number, 
    projectId: number
  ): Promise<Array<{
    sessionId: string;
    name: string;
    status: string;
    device: string;
    platform: string;
    duration: string;
    startedAt: string;
    startedAtTimestamp: number;
    videos: Array<{ name: string; url: string; description?: string }>;
    screenshots: Array<{ name: string; url: string; description?: string }>;
  }>> {
    try {
      const sessions = await this.reportingClient.getTestSessionsForTest(testRunId, testId, projectId);
      
      if (!sessions.items || sessions.items.length === 0) {
        return [];
      }
      
      const baseUrl = this.reportingClient['config'].baseUrl;
      const processedSessions: Array<any> = [];
      
      // Process each session (newest first)
      for (const session of sessions.items) {
        const videos: Array<{ name: string; url: string; description?: string }> = [];
        const screenshots: Array<{ name: string; url: string; description?: string }> = [];
        
        // Extract video artifacts (only those with descriptions)
        if (session.artifactReferences) {
          for (const artifact of session.artifactReferences) {
            if (artifact.name === 'Video' && artifact.value) {
              // Only include videos with non-empty description or no description field
              // (We filter by checking if there's meaningful data)
              const videoUrl = `${baseUrl}/${artifact.value}`;
              videos.push({
                name: artifact.name,
                url: videoUrl,
                description: (artifact as any).description
              });
            } else if (artifact.name.includes('Screenshot') || artifact.name.includes('screenshot')) {
              const screenshotUrl = artifact.value.startsWith('http') 
                ? artifact.value 
                : `${baseUrl}${artifact.value}`;
              screenshots.push({
                name: artifact.name,
                url: screenshotUrl,
                description: (artifact as any).description
              });
            }
          }
        }
        
        // Only include sessions that have at least one video or screenshot
        if (videos.length > 0 || screenshots.length > 0) {
          const device = session.deviceName || session.device || 'Unknown Device';
          const platform = session.platformName || session.platform || 'Unknown Platform';
          const platformVersion = session.platformVersion ? ` ${session.platformVersion}` : '';
          
          // Calculate duration
          let duration = 'Unknown';
          if (session.durationInSeconds) {
            const mins = Math.floor(session.durationInSeconds / 60);
            const secs = session.durationInSeconds % 60;
            duration = `${mins}m ${secs}s`;
          }
          
          // Format start time and get timestamp
          let startedAt = 'Unknown';
          let startedAtTimestamp = 0;
          if (session.initiatedAt) {
            const date = new Date(session.initiatedAt);
            startedAt = date.toLocaleString();
            startedAtTimestamp = date.getTime();
          } else if (session.startedAt) {
            const timestamp = typeof session.startedAt === 'number' 
              ? session.startedAt 
              : parseInt(session.startedAt);
            startedAt = new Date(timestamp).toLocaleString();
            startedAtTimestamp = timestamp;
          }
          
          processedSessions.push({
            sessionId: session.sessionId || session.id.toString(),
            name: session.name,
            status: session.status,
            device,
            platform: `${platform}${platformVersion}`,
            duration,
            startedAt,
            startedAtTimestamp,
            videos,
            screenshots
          });
        }
      }
      
      // Sort sessions: FAILED first, then PASSED/others, newest first within each group
      processedSessions.sort((a, b) => {
        // First priority: FAILED status comes first
        const aIsFailed = a.status === 'FAILED' || a.status === 'ABORTED';
        const bIsFailed = b.status === 'FAILED' || b.status === 'ABORTED';
        
        if (aIsFailed && !bIsFailed) return -1;
        if (!aIsFailed && bIsFailed) return 1;
        
        // Second priority: within same status group, newest first
        return b.startedAtTimestamp - a.startedAtTimestamp;
      });
      
      return processedSessions;
    } catch (error) {
      if (this.reportingClient['config'].debug) {
        console.warn(`[getAllSessionsWithArtifacts] Failed to get sessions: ${error}`);
      }
      return [];
    }
  }

  /**
   * Get video URL from test sessions artifacts
   * Returns the first valid video URL from the newest session
   * @deprecated Use getAllSessionsWithArtifacts() for complete session data
   */
  private async getVideoUrlForTest(testRunId: number, testId: number, projectId: number): Promise<string | null> {
    try {
      const sessions = await this.getAllSessionsWithArtifacts(testRunId, testId, projectId);
      
      if (sessions.length === 0) {
        return null;
      }
      
      // Get first video from the newest session
      const firstSession = sessions[0];
      if (firstSession.videos.length > 0) {
        return firstSession.videos[0].url;
      }
      
      return null;
    } catch (error) {
      if (this.reportingClient['config'].debug) {
        console.warn(`[getVideoUrlForTest] Failed to get video URL: ${error}`);
      }
      return null;
    }
  }

  /**
   * Build test case URL from testCaseId
   * Resolves testCaseId (e.g., "MCP-82") to numeric ID via TCM API
   * and constructs URL: https://baseUrl/projects/MCP/test-cases/{numericId}
   */
  private async buildTestCaseUrl(testCaseId: string, projectKey: string, baseUrl: string): Promise<string> {
    try {
      // Use TCM client to resolve test case key to numeric ID
      if (this.tcmClient) {
        const testCase = await this.tcmClient.getTestCaseByKey(projectKey, testCaseId);
        return `${baseUrl}/projects/${projectKey}/test-cases/${testCase.id}`;
      } else {
        // Fallback: got to the test case page
        return `${baseUrl}/projects/${projectKey}/test-cases`;
      }
    } catch (error) {
      // If lookup fails, fallback to extracting numeric part
      return `${baseUrl}/projects/${projectKey}/test-cases`;
    }
  }

  /**
   * Convert embedded test case IDs in text to clickable markdown links
   * Detects patterns like "MCP-2064", "APPS-1234" and abbreviated lists like "MCP-2869, 2870, 2871"
   * @param text - Text containing potential test case IDs (e.g., test names)
   * @param projectKey - Project key for URL resolution
   * @param baseUrl - Zebrunner base URL
   * @returns Text with test case IDs converted to markdown links
   */
  private async makeTestCaseIDsClickable(
    text: string,
    projectKey: string,
    baseUrl: string
  ): Promise<string> {
    // First, expand abbreviated patterns like "MCP-2869, 2870, 2871" to full format
    // Pattern: PROJECT-NUMBER followed by comma/space and standalone numbers
    const abbreviatedPattern = /\b([A-Z]{2,10})-(\d+)(?:\s*,\s*(\d+))+/g;
    
    let expandedText = text;
    const abbreviatedMatches = Array.from(text.matchAll(abbreviatedPattern));
    
    // Process abbreviated patterns in reverse order
    for (let i = abbreviatedMatches.length - 1; i >= 0; i--) {
      const match = abbreviatedMatches[i];
      const fullMatch = match[0]; // e.g., "MCP-2869, 2870, 2871"
      const projectPrefix = match[1]; // e.g., "MCP"
      const matchIndex = match.index!;
      
      // Extract all numbers (first one from the main match, rest from the text)
      const numbers: string[] = [];
      const numberPattern = /\b\d+\b/g;
      const numberMatches = Array.from(fullMatch.matchAll(numberPattern));
      numberMatches.forEach(m => numbers.push(m[0]));
      
      // Build expanded format: "MCP-2869, MCP-2870, MCP-2871"
      const expandedIDs = numbers.map(num => `${projectPrefix}-${num}`);
      const expandedFormat = expandedIDs.join(', ');
      
      // Replace in text
      expandedText = expandedText.substring(0, matchIndex) + expandedFormat + expandedText.substring(matchIndex + fullMatch.length);
    }
    
    // Now process all full-format test case IDs (including the ones we just expanded)
    // Regex pattern to match test case IDs: PROJECTKEY-NUMBER
    const testCasePattern = /\b([A-Z]{2,10}-\d+)\b/g;
    
    const matches = Array.from(expandedText.matchAll(testCasePattern));
    if (matches.length === 0) {
      return expandedText; // No test case IDs found
    }

    let result = expandedText;
    // Process matches in reverse order to maintain string positions
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const testCaseId = match[1]; // e.g., "MCP-2064"
      const matchIndex = match.index!;
      
      try {
        // Build clickable URL
        const testCaseUrl = await this.buildTestCaseUrl(testCaseId, projectKey, baseUrl);
        const clickableLink = `[${testCaseId}](${testCaseUrl})`;
        
        // Replace in text
        result = result.substring(0, matchIndex) + clickableLink + result.substring(matchIndex + testCaseId.length);
      } catch (error) {
        // If URL building fails, leave as plain text
        if (this.reportingClient['config'].debug) {
          console.warn(`[makeTestCaseIDsClickable] Failed to create link for ${testCaseId}: ${error}`);
        }
      }
    }
    
    return result;
  }

  /**
   * Format test cases for display
   * Returns formatted string with test case links
   */
  private async formatTestCases(
    testCases: Array<{ testCaseId: string; tcmType: string }> | undefined,
    projectKey: string,
    baseUrl: string,
    format: 'markdown' | 'jira'
  ): Promise<string> {
    if (!testCases || testCases.length === 0) {
      return '';
    }

    const links = await Promise.all(testCases.map(async tc => {
      const url = await this.buildTestCaseUrl(tc.testCaseId, projectKey, baseUrl);
      
      // Try to fetch test case title for enhanced display
      let displayText = tc.testCaseId;
      try {
        if (this.tcmClient) {
          const testCase = await this.tcmClient.getTestCaseByKey(projectKey, tc.testCaseId);
          if (testCase.title) {
            displayText = `${tc.testCaseId}: ${testCase.title}`;
          }
        }
      } catch (error) {
        // If we can't fetch the title, just use the ID
        if (this.reportingClient['config'].debug) {
          console.warn(`[formatTestCases] Could not fetch title for ${tc.testCaseId}`);
        }
      }
      
      if (format === 'jira') {
        return `[${displayText}|${url}]`;
      } else {
        return `[${displayText}](${url})`;
      }
    }));

    return links.join(', ');
  }

  /**
   * Generate Jira-formatted ticket for a single test failure
   */
  private async generateJiraTicketForTest(params: {
    testRun: any;
    testId: number;
    testRunId: number;
    launchName: string;
    projectKey?: string;
    projectId: number;
    errorClassification: any;
    logAnalysis: any;
    screenshots: any[];
    similarFailures: any[];
    baseUrl: string;
    jiraBaseUrlOverride?: string;
  }): Promise<string> {
    const {
      testRun,
      testId,
      testRunId,
      launchName,
      projectKey,
      projectId,
      errorClassification,
      logAnalysis,
      screenshots,
      similarFailures,
      baseUrl
    } = params;

    const wallClockDur = testRun.finishTime && testRun.startTime
      ? Math.round((testRun.finishTime - testRun.startTime) / 1000)
      : 0;

    const jiraEffMap = await this.resolveTestEffectiveDurations(
      testRunId, projectId, [{ id: testId, startTime: testRun.startTime, finishTime: testRun.finishTime }], 'per_test'
    );
    const jiraEff = jiraEffMap.get(testId);
    const duration = jiraEff ? jiraEff.effectiveDurationSeconds : wallClockDur;

    const stability = testRun.stability ? Math.round(testRun.stability * 100) : 0;

    // Auto-generate title based on error and test name
    let title = `${errorClassification.category}: ${testRun.name}`;
    if (stability === 0) {
      title += ' (Consistently Failing)';
    } else if (stability < 50) {
      title += ' (Flaky)';
    }

    // Calculate priority based on stability and similar failures
    let priority = 'Medium';
    if (stability === 0 || similarFailures.length > 3) {
      priority = 'Critical';
    } else if (stability < 30 || similarFailures.length > 1) {
      priority = 'High';
    } else if (stability > 70) {
      priority = 'Low';
    }

    // Auto-generate labels
    const labels: string[] = ['test-automation', errorClassification.category.toLowerCase().replace(/\s+/g, '-')];
    if (stability === 0) labels.push('consistently-failing');
    if (stability < 50 && stability > 0) labels.push('flaky-test');
    if (similarFailures.length > 0) labels.push('pattern-failure');

    // Build URLs
    const testUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}/tests/${testId}`;
    const launchUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}`;
    
    let jiraContent = `h1. ${title}\n\n`;
    jiraContent += `||Field||Value||\n`;
    jiraContent += `|Priority|${priority}|\n`;
    jiraContent += `|Labels|${labels.join(', ')}|\n`;
    jiraContent += `|Test ID|[${testId}|${testUrl}]|\n`;
    jiraContent += `|Launch ID|[${testRunId}|${launchUrl}]|\n`;
    jiraContent += `|Launch Name|[${launchName}|${launchUrl}]|\n`;
    
    // Add suite/test class
    if (testRun.testClass) {
      jiraContent += `|Test Suite/Class|${testRun.testClass}|\n`;
    }
    
    jiraContent += `|Stability|${stability}%|\n`;
    jiraContent += `|Duration|${Math.floor(duration / 60)}m ${duration % 60}s|\n`;
    if (jiraEff && jiraEff.sessionCount > 1) {
      jiraContent += `|Retries|${jiraEff.sessionCount} sessions (total: ${Math.floor(wallClockDur / 60)}m ${wallClockDur % 60}s, longest: ${Math.floor(jiraEff.longestSessionDurationSeconds / 60)}m ${jiraEff.longestSessionDurationSeconds % 60}s)|\n`;
    }
    
    // Get device/OS info from sessions (FAILED first)
    const sessions = await this.getAllSessionsWithArtifacts(testRunId, testId, projectId);
    if (sessions.length > 0) {
      const failedSession = sessions.find(s => s.status === 'FAILED' || s.status === 'ABORTED');
      const sessionToShow = failedSession || sessions[0];
      
      jiraContent += `|Device|${sessionToShow.device}|\n`;
      jiraContent += `|Platform/OS|${sessionToShow.platform}|\n`;
      
      // If there are multiple environments, add them too
      if (sessions.length > 1) {
        const uniqueEnvs = [...new Set(sessions.map(s => `${s.device} (${s.platform})`))];
        if (uniqueEnvs.length > 1) {
          const otherEnvs = sessions
            .filter(s => s.sessionId !== sessionToShow.sessionId)
            .map(s => `${s.device} (${s.platform})`)
            .slice(0, 3)
            .join(', ');
          jiraContent += `|Other Environments|${otherEnvs}`;
          if (sessions.length > 4) {
            jiraContent += `, +${sessions.length - 4} more`;
          }
          jiraContent += `|\n`;
        }
      }
    }
    
    // Test Cases
    if (testRun.testCases && testRun.testCases.length > 0 && projectKey) {
      const testCaseLinks = await this.formatTestCases(testRun.testCases, projectKey, baseUrl, 'jira');
      jiraContent += `|Test Cases|${testCaseLinks}|\n`;
    } else {
      jiraContent += `|Test Cases|⚠️ Not linked to test case|\n`;
    }
    jiraContent += `\n`;

    jiraContent += `h2. Description\n\n`;
    jiraContent += `Test *${testRun.name}* is failing in launch [${launchName}|${launchUrl}] with *${errorClassification.category}*.\n\n`;

    // Video Recording - Prominent placement
    const videoUrl = await this.getVideoUrlForTest(testRunId, testId, projectId);
    if (videoUrl) {
      jiraContent += `{panel:title=🎥 Video Recording Available|borderStyle=solid|borderColor=#0052CC|titleBGColor=#DEEBFF|bgColor=#F4F5F7}\n`;
      jiraContent += `[🎥 Watch Test Execution Video|${videoUrl}]\n`;
      jiraContent += `{panel}\n\n`;
    }

    jiraContent += `h3. Error Classification\n`;
    jiraContent += `*Category:* ${errorClassification.category}\n`;
    jiraContent += `*Confidence:* ${errorClassification.confidence}\n\n`;

    if (errorClassification.reasons && errorClassification.reasons.length > 0) {
      jiraContent += `*Reasons:*\n`;
      errorClassification.reasons.forEach((reason: string) => {
        jiraContent += `* ${reason}\n`;
      });
      jiraContent += `\n`;
    }

    jiraContent += `h3. Error Message (Short)\n\n`;
    jiraContent += `{code}\n${(testRun.message || 'No error message').substring(0, 300)}${testRun.message && testRun.message.length > 300 ? '\n... (truncated, see full logs in link)' : ''}\n{code}\n\n`;

    // Error Logs - Show first 5 error log entries with timestamps
    if (logAnalysis && logAnalysis.errorLogs && logAnalysis.errorLogs.length > 0) {
      jiraContent += `h3. Error Logs (Top 5)\n\n`;
      logAnalysis.errorLogs.slice(0, 5).forEach((log: any, idx: number) => {
        jiraContent += `*${idx + 1}. [${log.level}]* ${new Date(log.timestamp).toLocaleString()}:\n`;
        jiraContent += `{code}\n${log.message.substring(0, 250)}${log.message.length > 250 ? '\n...' : ''}\n{code}\n\n`;
      });
      if (logAnalysis.errorLogs.length > 5) {
        jiraContent += `_... and ${logAnalysis.errorLogs.length - 5} more error log entries_\n\n`;
      }
      jiraContent += `[View all logs|${testUrl}]\n\n`;
    }

    // Expected vs Actual
    jiraContent += `h3. Expected vs Actual\n\n`;
    jiraContent += `*Expected:* Test should pass without errors\n`;
    jiraContent += `*Actual:* Test failed with ${errorClassification.category}\n\n`;

    // Steps to Reproduce
    if (logAnalysis && logAnalysis.lastActions && logAnalysis.lastActions.length > 0) {
      jiraContent += `h3. Steps to Reproduce\n\n`;
      jiraContent += `Based on test execution logs:\n`;
      logAnalysis.lastActions.slice(0, 10).forEach((action: string, idx: number) => {
        jiraContent += `# ${action}\n`;
      });
      jiraContent += `\n`;
    }

    // Screenshots
    if (screenshots.length > 0) {
      const latestScreenshot = screenshots[screenshots.length - 1];
      jiraContent += `h3. Screenshots\n\n`;
      jiraContent += `*Latest screenshot before failure:*\n`;
      jiraContent += `[!${baseUrl}${latestScreenshot.url}|thumbnail!|${baseUrl}${latestScreenshot.url}]\n`;
      jiraContent += `[View screenshot|${baseUrl}${latestScreenshot.url}]\n\n`;
      
      if (screenshots.length > 1) {
        jiraContent += `*All screenshots:*\n`;
        screenshots.slice(-5).forEach((screenshot: any, idx: number) => {
          jiraContent += `* [Screenshot ${idx + 1}|${baseUrl}${screenshot.url}] (${new Date(screenshot.timestamp).toLocaleTimeString()})\n`;
        });
        jiraContent += `\n`;
      }
    }

    // Similar Failures
    if (similarFailures.length > 0) {
      jiraContent += `h3. Similar Failures Pattern\n\n`;
      jiraContent += `{warning}This test is part of a failure pattern affecting *${similarFailures.length + 1} tests* in this launch.{warning}\n\n`;
      jiraContent += `*Other affected tests:*\n`;
      similarFailures.slice(0, 5).forEach((failure: any) => {
        const failureTestUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}/tests/${failure.testId}`;
        jiraContent += `* [Test ${failure.testId}|${failureTestUrl}]: ${failure.testName} (${failure.stability}% stability)\n`;
      });
      if (similarFailures.length > 5) {
        jiraContent += `* ... and ${similarFailures.length - 5} more\n`;
      }
      jiraContent += `\n`;
    }

    // Recommendations
    jiraContent += `h3. Recommended Actions\n\n`;
    const recommendations = this.generateRecommendations(errorClassification, testRun, similarFailures);
    jiraContent += recommendations.split('\n').map(line => {
      if (line.match(/^\d+\./)) {
        return `# ${line.substring(line.indexOf('.') + 1).trim()}`;
      }
      return line;
    }).join('\n');
    jiraContent += `\n\n`;

    // Links
    jiraContent += `h3. Links\n\n`;
    jiraContent += `* [View Test in Zebrunner|${testUrl}]\n`;
    jiraContent += `* [View Launch|${launchUrl}]\n`;
    if (videoUrl) {
      jiraContent += `* [🎥 Test Execution Video|${videoUrl}]\n`;
    }
    
    // Test Case Links
    if (testRun.testCases && testRun.testCases.length > 0 && projectKey) {
      for (const tc of testRun.testCases) {
        const tcUrl = await this.buildTestCaseUrl(tc.testCaseId, projectKey, baseUrl);
        jiraContent += `* [📋 Test Case ${tc.testCaseId}|${tcUrl}]\n`;
      }
    }
    jiraContent += `\n`;

    jiraContent += `----\n`;
    jiraContent += `_Generated automatically by MCP Zebrunner Analysis Tool_\n`;

    return jiraContent;
  }

  /**
   * Generate Jira tickets for launch failures with smart grouping
   * Creates individual tickets for unique errors, combined tickets for similar errors
   */
  private async generateJiraTicketsForLaunch(params: {
    testRunId: number;
    launchName: string;
    projectKey: string;
    projectId: number;
    testsToAnalyze: any[];
    detailLevel: 'basic' | 'full';
    includeScreenshotAnalysis: boolean;
    screenshotAnalysisType: 'basic' | 'detailed';
    baseUrl: string;
  }) {
    const {
      testRunId,
      launchName,
      projectKey,
      projectId,
      testsToAnalyze,
      detailLevel,
      includeScreenshotAnalysis,
      screenshotAnalysisType,
      baseUrl
    } = params;

    let output = `# 🎫 Jira Tickets - Launch ${launchName}\n\n`;
    output += `Generated: ${new Date().toLocaleString()}\n\n`;
    output += `---\n\n`;

    // If basic detail level, use simple approach without deep analysis
    if (detailLevel === 'basic') {
      output += `## Basic Jira Tickets (One per test)\n\n`;
      
      for (let i = 0; i < testsToAnalyze.length; i++) {
        const test = testsToAnalyze[i];
        output += `### Ticket ${i + 1}/${testsToAnalyze.length}: Test ${test.id}\n\n`;
        
        // Create basic ticket without deep analysis
        const videoUrl = await this.getVideoUrlForTest(testRunId, test.id, projectId);
        const testSessionUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}/tests/${test.id}`;
        const launchUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}`;
        
        output += `h1. Test Failure: ${test.name}\n\n`;
        output += `h2. Quick Info\n\n`;
        output += `*Status:* ${test.status}\n`;
        output += `*Launch:* [${launchName}|${launchUrl}]\n`;
        output += `*Test ID:* ${test.id}\n`;
        
        // Test Cases
        if (test.testCases && test.testCases.length > 0) {
          const testCaseLinks = await Promise.all(test.testCases.map(async (tc: any) => {
            const tcUrl = await this.buildTestCaseUrl(tc.testCaseId, projectKey, baseUrl);
            return `[${tc.testCaseId}|${tcUrl}]`;
          }));
          output += `*Test Cases:* 📋 ${testCaseLinks.join(', ')}\n`;
        } else {
          output += `*Test Cases:* ⚠️ Not linked to test case\n`;
        }
        output += `\n`;
        
        if (test.message) {
          output += `h3. Error Message\n\n`;
          output += `{code}\n${test.message.substring(0, 500)}${test.message.length > 500 ? '...' : ''}\n{code}\n\n`;
        }
        
        output += `h3. Links\n\n`;
        output += `* [View Test in Zebrunner|${testSessionUrl}]\n`;
        output += `* [View Launch|${launchUrl}]\n`;
        if (videoUrl) {
          output += `* [🎥 Test Execution Video|${videoUrl}]\n`;
        }
        
        // Test Case Links
        if (test.testCases && test.testCases.length > 0) {
          for (const tc of test.testCases) {
            const tcUrl = await this.buildTestCaseUrl(tc.testCaseId, projectKey, baseUrl);
            output += `* [📋 Test Case ${tc.testCaseId}|${tcUrl}]\n`;
          }
        }
        
        output += `\n---\n\n`;
      }
      
      return {
        content: [{
          type: "text" as const,
          text: output
        }]
      };
    }

    // FULL detail level - Deep analysis with grouping
    output += `## Full Analysis - Generating Jira Tickets with Smart Grouping\n\n`;
    output += `Analyzing ${testsToAnalyze.length} tests to detect similar failures...\n\n`;

    // Step 1: Analyze each test with full details
    const fullAnalyses: Array<{
      testId: number;
      testName: string;
      status: string;
      jiraTicket: string;
      errorMessage: string;
      errorClassification: string;
      videoUrl: string | null;
      screenshotUrl: string | null;
      testCases: Array<{ testCaseId: string; tcmType: string }>;
    }> = [];

    for (let i = 0; i < testsToAnalyze.length; i++) {
      const test = testsToAnalyze[i];
      try {
        output += `Progress: ${i + 1}/${testsToAnalyze.length} - Analyzing test ${test.id}...\n`;
        
        // Call individual test analysis with Jira format
        const analysis = await this.analyzeTestFailureById({
          testId: test.id,
          testRunId,
          projectKey,
          projectId,
          includeScreenshots: true,
          includeLogs: true,
          includeArtifacts: true,
          includePageSource: false,
          includeVideo: true,
          analyzeSimilarFailures: true,
          analyzeScreenshotsWithAI: includeScreenshotAnalysis,
          screenshotAnalysisType,
          format: 'jira'
        });

        // Extract the Jira ticket text
        const jiraTicket = analysis.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');

        // Extract key info for grouping
        const errorMatch = jiraTicket.match(/\*Category:\* ([^\n]+)/);
        const errorClassification = errorMatch ? errorMatch[1].trim() : 'Unknown';
        
        // Extract error message for grouping
        const messageMatch = test.message || 'No error message';
        const errorMessage = messageMatch.substring(0, 200); // First 200 chars for grouping
        
        // Get video and screenshot links
        const videoUrl = await this.getVideoUrlForTest(testRunId, test.id, projectId);
        const screenshotUrl = null; // We'll add screenshot extraction if needed
        
        fullAnalyses.push({
          testId: test.id,
          testName: test.name,
          status: test.status,
          jiraTicket,
          errorMessage,
          errorClassification,
          videoUrl,
          screenshotUrl,
          testCases: test.testCases || []
        });
      } catch (error) {
        output += `⚠️ Error analyzing test ${test.id}: ${error}\n`;
      }
    }

    output += `\n✅ Analysis complete. Grouping similar failures...\n\n`;
    output += `---\n\n`;

    // Step 2: Group by error similarity
    const errorGroups = new Map<string, typeof fullAnalyses>();
    
    fullAnalyses.forEach(analysis => {
      // Use first 150 chars of error message as grouping key
      const groupKey = `${analysis.errorClassification}:${analysis.errorMessage.substring(0, 150)}`;
      
      if (!errorGroups.has(groupKey)) {
        errorGroups.set(groupKey, []);
      }
      errorGroups.get(groupKey)!.push(analysis);
    });

    output += `## 📊 Grouping Summary\n\n`;
    output += `- **Total Tests Analyzed:** ${fullAnalyses.length}\n`;
    output += `- **Unique Error Patterns:** ${errorGroups.size}\n`;
    output += `- **Individual Tickets:** ${Array.from(errorGroups.values()).filter(g => g.length === 1).length}\n`;
    output += `- **Combined Tickets:** ${Array.from(errorGroups.values()).filter(g => g.length > 1).length}\n\n`;
    output += `---\n\n`;

    // Step 3: Generate tickets based on grouping
    let ticketNumber = 1;
    
    for (const [groupKey, groupTests] of errorGroups.entries()) {
      if (groupTests.length === 1) {
        // Individual ticket - just one test with this error
        const test = groupTests[0];
        output += `## 🎫 Ticket ${ticketNumber}: ${test.testName}\n\n`;
        output += `**Type:** Individual Failure\n`;
        output += `**Affected Tests:** 1\n\n`;
        output += `### Jira Ticket Content (Copy & Paste)\n\n`;
        output += `\`\`\`\n`;
        output += test.jiraTicket;
        output += `\n\`\`\`\n\n`;
        output += `---\n\n`;
      } else {
        // Combined ticket - multiple tests with similar error
        output += `## 🎫 Ticket ${ticketNumber}: Multiple Tests - ${groupTests[0].errorClassification}\n\n`;
        output += `**Type:** Combined Failure (Similar Root Cause)\n`;
        output += `**Affected Tests:** ${groupTests.length}\n\n`;
        
        // Create combined Jira ticket
        let combinedTicket = `h1. Multiple Test Failures: ${groupTests[0].errorClassification}\n\n`;
        combinedTicket += `h2. Summary\n\n`;
        combinedTicket += `*${groupTests.length} tests* are failing with similar errors in launch [${launchName}|${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}].\n\n`;
        combinedTicket += `||Test ID||Test Name||Status||Test Cases||Video||\n`;
        
        for (const test of groupTests) {
          const videoLink = test.videoUrl ? `[🎥 Video|${test.videoUrl}]` : 'N/A';
          const testCaseLinks = test.testCases && test.testCases.length > 0
            ? (await Promise.all(test.testCases.map(async (tc: any) => {
                const tcUrl = await this.buildTestCaseUrl(tc.testCaseId, projectKey, baseUrl);
                return `[${tc.testCaseId}|${tcUrl}]`;
              }))).join(', ')
            : '⚠️ Not linked';
          combinedTicket += `|${test.testId}|${test.testName}|${test.status}|${testCaseLinks}|${videoLink}|\n`;
        }
        
        combinedTicket += `\n`;
        combinedTicket += `h2. Common Error\n\n`;
        combinedTicket += `*Category:* ${groupTests[0].errorClassification}\n\n`;
        combinedTicket += `{code}\n${groupTests[0].errorMessage}\n{code}\n\n`;
        
        combinedTicket += `h2. Affected Tests Details\n\n`;
        groupTests.forEach((test, idx) => {
          const groupTestUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}/tests/${test.testId}`;
          combinedTicket += `h3. ${idx + 1}. ${test.testName} (ID: ${test.testId})\n\n`;
          combinedTicket += `* [View Test|${groupTestUrl}]\n`;
          if (test.videoUrl) {
            combinedTicket += `* [🎥 Test Video|${test.videoUrl}]\n`;
          }
          combinedTicket += `\n`;
        });
        
        combinedTicket += `h2. Recommendations\n\n`;
        combinedTicket += `# Investigate the common root cause affecting all ${groupTests.length} tests\n`;
        combinedTicket += `# Check for recent code changes that might have introduced this issue\n`;
        combinedTicket += `# Review test environment and configuration\n`;
        combinedTicket += `# Fix once to resolve all ${groupTests.length} failures\n\n`;
        
        combinedTicket += `----\n`;
        combinedTicket += `_Generated automatically by MCP Zebrunner Analysis Tool_\n`;
        
        output += `### Jira Ticket Content (Copy & Paste)\n\n`;
        output += `\`\`\`\n`;
        output += combinedTicket;
        output += `\n\`\`\`\n\n`;
        output += `---\n\n`;
      }
      ticketNumber++;
    }

    output += `\n## ✅ Summary\n\n`;
    output += `Generated **${ticketNumber - 1} Jira tickets** ready to paste into your Jira instance.\n\n`;
    output += `**Tips:**\n`;
    output += `- Copy each ticket content (inside code blocks) and paste directly into Jira\n`;
    output += `- Jira will automatically format the markup (h1, h2, tables, links, code blocks)\n`;
    output += `- Combined tickets help you fix multiple tests at once\n`;
    output += `- Video links are clickable and authenticated\n\n`;

    return {
      content: [{
        type: "text" as const,
        text: output
      }]
    };
  }

  /**
   * Generate Jira-formatted ticket for launch-wide failures
   */
  private generateJiraTicketForLaunch(params: {
    launch: any;
    testRunId: number;
    projectKey?: string;
    analysisResults: any[];
    errorClassifications: Map<string, number>;
    errorGroups: Map<string, any[]>;
    testDetails: Map<number, any>;
    totalFailedTests: number;
    avgStability: number;
    baseUrl: string;
  }): string {
    const {
      launch,
      testRunId,
      projectKey,
      analysisResults,
      errorClassifications,
      errorGroups,
      testDetails,
      totalFailedTests,
      avgStability,
      baseUrl
    } = params;

    // Auto-generate title based on patterns
    const topClassification = Array.from(errorClassifications.entries())
      .sort((a, b) => b[1] - a[1])[0];
    
    let title = '';
    if (topClassification && topClassification[1] > analysisResults.length * 0.5) {
      // Single dominant issue
      title = `${topClassification[0]}: ${analysisResults.length} tests failing in ${launch.name}`;
    } else if (errorGroups.size === 1) {
      // Single error pattern
      title = `Multiple tests failing with same issue in ${launch.name}`;
    } else {
      // Multiple issues
      title = `${analysisResults.length} tests failing in launch ${testRunId} - Multiple Issues`;
    }

    // Calculate priority
    let priority = 'Medium';
    if (avgStability < 30 || analysisResults.length > totalFailedTests * 0.5) {
      priority = 'Critical';
    } else if (avgStability < 60 || analysisResults.length > totalFailedTests * 0.3) {
      priority = 'High';
    }

    // Generate labels
    const labels = ['test-automation', 'launch-failure', 'bulk-issue'];
    if (errorGroups.size > 1) labels.push('multiple-patterns');
    if (avgStability < 50) labels.push('critical-stability');

    let jiraContent = `h1. ${title}\n\n`;
    jiraContent += `||Field||Value||\n`;
    jiraContent += `|Priority|${priority}|\n`;
    jiraContent += `|Labels|${labels.join(', ')}|\n`;
    jiraContent += `|Launch ID|${testRunId}|\n`;
    jiraContent += `|Launch Name|${launch.name || 'N/A'}|\n`;
    jiraContent += `|Failed Tests|${analysisResults.length} / ${totalFailedTests}|\n`;
    jiraContent += `|Average Stability|${avgStability}%|\n\n`;

    jiraContent += `h2. Executive Summary\n\n`;
    jiraContent += `{panel:title=Key Findings|borderStyle=solid|borderColor=#ccc|titleBGColor=#F7D6C1|bgColor=#FFFFCE}\n`;
    jiraContent += `* *${analysisResults.length} failed tests* analyzed across *${errorClassifications.size} distinct error categories*\n`;
    jiraContent += `* *${errorGroups.size} unique failure patterns* detected\n`;
    jiraContent += `* *Average stability:* ${avgStability}% ${avgStability < 50 ? '(!)' : avgStability < 80 ? '(/)' : '(+)'}\n`;
    
    const sortedGroups = Array.from(errorGroups.entries()).sort((a, b) => b[1].length - a[1].length);
    if (sortedGroups.length > 0 && sortedGroups[0][1].length > 1) {
      jiraContent += `* *Most common issue:* ${sortedGroups[0][1][0].classification} (affecting ${sortedGroups[0][1].length} tests)\n`;
    }
    jiraContent += `{panel}\n\n`;

    // Pattern Analysis
    jiraContent += `h2. Failure Pattern Analysis\n\n`;
    
    if (errorClassifications.size > 0) {
      const sortedClassifications = Array.from(errorClassifications.entries())
        .sort((a, b) => b[1] - a[1]);
      
      sortedClassifications.forEach(([classification, count], idx) => {
        const percentage = ((count / analysisResults.length) * 100).toFixed(1);
        const priorityEmoji = count > analysisResults.length * 0.3 ? '(!)' : count > 1 ? '(/)' : '(+)';
        
        jiraContent += `h3. ${idx + 1}. ${classification} - ${count} test${count > 1 ? 's' : ''} (${percentage}%) ${priorityEmoji}\n\n`;
        
        // Find tests in this category
        const testsInCategory = Array.from(testDetails.values())
          .filter((t: any) => t.classification === classification);
        
        if (testsInCategory.length > 0) {
          jiraContent += `*Affected Tests:*\n`;
          testsInCategory.forEach((test: any) => {
            const categoryTestUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}/tests/${test.testId}`;
            jiraContent += `* [Test ${test.testId}|${categoryTestUrl}]: ${test.testName} (${test.stability}% stability)\n`;
          });
          jiraContent += `\n`;
          
          if (testsInCategory.length > 0 && testsInCategory[0].rootCause !== 'Unknown') {
            jiraContent += `*Root Cause:* ${testsInCategory[0].rootCause}\n\n`;
          }
        }
      });
    }

    // Recommended Actions
    jiraContent += `h2. Recommended Actions (Prioritized)\n\n`;
    
    // Extract and prioritize recommendations
    const recommendations = new Map<string, { count: number; tests: any[]; classification: string }>();
    
    analysisResults.forEach((result: any) => {
      if (result.analysis && result.analysis.content) {
        const textContent = result.analysis.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join(' ');

        const classMatch = textContent.match(/\*\*Error Classification:\*\* ([^\n]+)/);
        const classification = classMatch ? classMatch[1].trim() : 'Unknown';
        const recMatch = textContent.match(/## 💡 Recommended Actions\n\n([^#]+)/);
        
        if (recMatch) {
          const rec = recMatch[1].trim().split('\n')[0];
          if (!recommendations.has(rec)) {
            recommendations.set(rec, { count: 0, tests: [], classification });
          }
          const entry = recommendations.get(rec)!;
          entry.count++;
          entry.tests.push(result);
        }
      }
    });

    const sortedRecs = Array.from(recommendations.entries())
      .sort((a, b) => b[1].count - a[1].count);

    const highPriority = sortedRecs.filter(([_, data]) => data.count > analysisResults.length * 0.3);
    const mediumPriority = sortedRecs.filter(([_, data]) => data.count > 1 && data.count <= analysisResults.length * 0.3);

    if (highPriority.length > 0) {
      jiraContent += `h3. (!) HIGH Priority Actions\n\n`;
      highPriority.forEach(([rec, data], idx) => {
        jiraContent += `# *${rec.replace(/^\d+\.\s*/, '')}* - Affects ${data.count} test${data.count > 1 ? 's' : ''}\n`;
        jiraContent += `** Category: ${data.classification}\n`;
        jiraContent += `** Tests: ${data.tests.slice(0, 3).map((t: any) => `Test ${t.testId}`).join(', ')}${data.tests.length > 3 ? ` and ${data.tests.length - 3} more` : ''}\n`;
      });
      jiraContent += `\n`;
    }

    if (mediumPriority.length > 0) {
      jiraContent += `h3. (/) MEDIUM Priority Actions\n\n`;
      mediumPriority.slice(0, 3).forEach(([rec, data], idx) => {
        jiraContent += `# ${rec.replace(/^\d+\.\s*/, '')} - Affects ${data.count} tests\n`;
      });
      jiraContent += `\n`;
    }

    // Individual Test Details (Summary)
    jiraContent += `h2. Individual Test Details\n\n`;
    jiraContent += `{expand:title=Click to view all ${analysisResults.length} test details}\n`;
    
    analysisResults.forEach((result: any, idx: number) => {
      const detail = testDetails.get(result.testId);
      if (detail) {
        const detailTestUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}/tests/${result.testId}`;
        jiraContent += `h4. ${idx + 1}. [Test ${result.testId}|${detailTestUrl}]: ${result.testName}\n\n`;
        jiraContent += `* *Status:* ${result.status}\n`;
        jiraContent += `* *Error Type:* ${detail.classification}\n`;
        jiraContent += `* *Stability:* ${detail.stability}% ${detail.stability < 50 ? '(!)' : detail.stability < 80 ? '(/)' : '(+)'}\n`;
        jiraContent += `* *Root Cause:* ${detail.rootCause}\n`;
        
        // Extract and display device/OS info
        const deviceMatch = detail.fullAnalysis.match(/\*\*Device:\*\*\s*([^\n]+)/);
        const platformMatch = detail.fullAnalysis.match(/\*\*Platform:\*\*\s*([^\n]+)/);
        
        if (deviceMatch) {
          jiraContent += `* *Device:* ${deviceMatch[1].trim()}\n`;
        }
        if (platformMatch) {
          jiraContent += `* *Platform/OS:* ${platformMatch[1].trim()}\n`;
        }
        
        if (detail.errorMsg && detail.errorMsg !== 'No error message') {
          jiraContent += `\n{code:title=Error (Short)}\n${detail.errorMsg.substring(0, 300)}${detail.errorMsg.length > 300 ? '...' : ''}\n{code}\n`;
        }
        
        // Extract and show top 3 error logs
        const errorLogsMatch = detail.fullAnalysis.match(/\*\*Error Logs \(Top \d+\):\*\*\n\n([\s\S]*?)(?=\n\n\*\*|$)/);
        if (errorLogsMatch) {
          const logs = errorLogsMatch[1].substring(0, 400);
          jiraContent += `\n{code:title=Error Logs (Top 3)}\n${logs}${errorLogsMatch[1].length > 400 ? '...' : ''}\n{code}\n`;
        }
        
        jiraContent += `\n`;
      }
    });
    
    jiraContent += `{expand}\n\n`;

    // Links
    jiraContent += `h2. Links\n\n`;
    const launchUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}`;
    jiraContent += `* [View Launch in Zebrunner|${launchUrl}]\n`;
    jiraContent += `* [View All Test Results|${launchUrl}#results]\n\n`;

    jiraContent += `----\n`;
    jiraContent += `_Generated automatically by MCP Zebrunner Analysis Tool_\n`;
    jiraContent += `_Analysis Date: ${new Date().toLocaleString()}_\n`;

    return jiraContent;
  }

  /**
   * Analyze all failures in a launch with optional pagination
   * Groups similar failures, provides statistics and recommendations
   */
  async analyzeLaunchFailures(input: {
    testRunId: number;
    projectKey?: string;
    projectId?: number;
    filterType?: 'all' | 'without_issues';
    includeScreenshotAnalysis?: boolean;
    screenshotAnalysisType?: 'basic' | 'detailed';
    format?: 'detailed' | 'summary' | 'jira';
    jiraDetailLevel?: 'basic' | 'full';
    executionMode?: 'sequential' | 'parallel' | 'batches';
    batchSize?: number;
    offset?: number;
    limit?: number;
  }) {
    const {
      testRunId,
      projectKey,
      projectId,
      filterType = 'without_issues',
      includeScreenshotAnalysis = false,
      screenshotAnalysisType = 'detailed',
      format = 'summary',
      jiraDetailLevel = 'full',
      executionMode = 'sequential',
      batchSize = 5,
      offset = 0,
      limit = 10
    } = input;

    try {
      // Resolve project ID and key if needed
      let resolvedProjectId = projectId;
      let resolvedProjectKey = projectKey;
      
      if (projectKey && !projectId) {
        const projectInfo = await this.reportingClient.getProject(projectKey);
        resolvedProjectId = projectInfo.id;
      } else if (projectId && !projectKey) {
        resolvedProjectKey = await this.reportingClient.getProjectKey(projectId);
      }

      if (!resolvedProjectId || !resolvedProjectKey) {
        throw new Error('Either projectKey or projectId must be provided');
      }

      // Base URL for generating links
      const baseUrl = this.reportingClient['config'].baseUrl;

      // Get launch details
      const launch = await this.reportingClient.getLaunch(testRunId, resolvedProjectId);
      
      // Get all tests in this launch
      const testRunsResponse = await this.reportingClient.getAllTestRuns(testRunId, resolvedProjectId);
      const allTests = testRunsResponse.items || [];
      
      // Filter failed tests
      let failedTests = allTests.filter((test: any) => 
        test.status === 'FAILED' || test.status === 'ABORTED'
      );

      // Filter by issue status if requested
      if (filterType === 'without_issues') {
        failedTests = failedTests.filter((test: any) => 
          !test.knownIssue && (!test.issues || test.issues.length === 0)
        );
      }

      const totalFailedTests = failedTests.length;

      // Smart limit: analyze all if <= 10, otherwise use limit parameter (default 10)
      const effectiveLimit = totalFailedTests <= 10 ? totalFailedTests : limit;

      // Apply pagination
      const testsToAnalyze = failedTests.slice(offset, offset + effectiveLimit);
      const actualLimit = testsToAnalyze.length;

      // Build launch URL
      const launchUrl = `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${testRunId}`;
      
      // Build suite URL if available (use correct Zebrunner UI format)
      let suiteUrl: string | null = null;
      if (launch.testSuite && launch.testSuite.id) {
        suiteUrl = `${baseUrl}/projects/${resolvedProjectKey}/test-cases?suiteId=${launch.testSuite.id}`;
      }
      
      // Collect unique devices from actual test sessions
      const uniqueDevices = new Set<string>();
      for (const test of testsToAnalyze) {
        try {
          const sessions = await this.reportingClient.getTestSessionsForTest(testRunId, test.id, resolvedProjectId!);
          if (sessions.items) {
            for (const session of sessions.items) {
              const device = session.deviceName || session.device;
              if (device && device !== 'Unknown Device') {
                uniqueDevices.add(device);
              }
            }
          }
        } catch (error) {
          // Silently continue if we can't get sessions for a test
        }
      }
      const devicesArray = Array.from(uniqueDevices);
      
      let report = `# 🔍 Launch Failure Analysis Report\n\n`;
      report += `## 🚀 Launch Information\n\n`;
      report += `- **Launch:** [${launch.name || 'N/A'}](${launchUrl})\n`;
      report += `- **Launch ID:** [${testRunId}](${launchUrl})\n`;
      report += `- **Project:** ${resolvedProjectKey}\n`;
      report += `- **Status:** ${launch.status || 'N/A'}\n`;
      
      // Suite information
      if (launch.testSuite) {
        if (suiteUrl) {
          report += `- **Test Suite:** [${launch.testSuite.name}](${suiteUrl})\n`;
        } else {
          report += `- **Test Suite:** ${launch.testSuite.name}\n`;
        }
      }
      
      // Build with potential link (if it's a URL)
      if (launch.build) {
        // Check if build looks like a URL or file path
        if (launch.build.startsWith('http://') || launch.build.startsWith('https://')) {
          report += `- **Build:** [${launch.build}](${launch.build})\n`;
        } else {
          report += `- **Build:** ${launch.build}\n`;
        }
      }
      
      if (launch.environment) {
        report += `- **Environment:** ${launch.environment}\n`;
      }
      if (launch.platform) {
        report += `- **Platform:** ${launch.platform}\n`;
      }
      
      // Show devices collected from actual test executions
      if (devicesArray.length > 0) {
        report += `- **Devices:** ${devicesArray.join(', ')}\n`;
      }
      
      // Calculate durations
      if (launch.startedAt && launch.endedAt) {
        const startTime = typeof launch.startedAt === 'number' ? launch.startedAt : new Date(launch.startedAt).getTime();
        const endTime = typeof launch.endedAt === 'number' ? launch.endedAt : new Date(launch.endedAt).getTime();
        const durationMs = endTime - startTime;
        const durationMins = Math.floor(durationMs / 60000);
        const durationSecs = Math.floor((durationMs % 60000) / 1000);
        report += `- **Duration:** ${durationMins}m ${durationSecs}s\n`;
        report += `- **Started:** ${new Date(startTime).toLocaleString()}\n`;
        report += `- **Finished:** ${new Date(endTime).toLocaleString()}\n`;
      }
      
      if (launch.user?.username) {
        report += `- **Owner:** ${launch.user.username}\n`;
      }
      
      report += `- **Analysis Date:** ${new Date().toLocaleString()}\n\n`;
      report += `---\n\n`;

      // Statistics
      report += `## 📊 Overview Statistics\n\n`;
      report += `- **Total Tests in Launch:** ${allTests.length}\n`;
      report += `- **Failed Tests (Total):** ${totalFailedTests}\n`;
      report += `- **Tests Being Analyzed:** ${actualLimit}`;
      
      // Add pagination info if needed (only if there are more tests to analyze)
      if (totalFailedTests > 10 && offset + actualLimit < totalFailedTests) {
        report += ` (showing ${offset + 1}-${offset + actualLimit} of ${totalFailedTests})`;
      }
      report += `\n`;
      
      report += `- **Filter:** ${filterType === 'without_issues' ? '🎯 Tests without linked issues' : '📋 All failed tests'}\n`;
      report += `- **Screenshot Analysis:** ${includeScreenshotAnalysis ? `✅ Enabled (${screenshotAnalysisType})` : '❌ Disabled'}\n`;
      report += `- **Execution Mode:** ${executionMode}\n\n`;

      // Add note about more tests being available
      if (totalFailedTests > 10 && offset + actualLimit < totalFailedTests) {
        const remaining = totalFailedTests - (offset + actualLimit);
        report += `✨ **Note:** ${remaining} more failed test${remaining > 1 ? 's' : ''} available. See bottom for pagination options.\n\n`;
      }

      // Analyze each test
      const analysisResults: any[] = [];
      const startTime = Date.now();

      report += `## 🔬 Analyzing Tests...\n\n`;

      if (executionMode === 'sequential') {
        // Sequential execution
        for (let i = 0; i < testsToAnalyze.length; i++) {
          const test = testsToAnalyze[i];
          try {
            report += `Progress: ${i + 1}/${actualLimit} - Analyzing test ${test.id}...\n`;
            
            const analysis = await this.analyzeTestFailureById({
              testId: test.id,
              testRunId,
              projectKey,
              projectId: resolvedProjectId,
              includeScreenshots: true,
              includeLogs: true,
              includeArtifacts: false,
              includePageSource: false,
              includeVideo: false,
              analyzeSimilarFailures: false,
              analyzeScreenshotsWithAI: includeScreenshotAnalysis,
              screenshotAnalysisType,
              format: format === 'detailed' ? 'detailed' : 'summary'
            });

            analysisResults.push({
              testId: test.id,
              testName: test.name,
              status: test.status,
              testCases: test.testCases || [],
              analysis,
              error: null
            });
          } catch (error) {
            analysisResults.push({
              testId: test.id,
              testName: test.name,
              status: test.status,
              testCases: test.testCases || [],
              analysis: null,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      } else if (executionMode === 'parallel') {
        // Parallel execution
        const promises = testsToAnalyze.map(async (test: any) => {
          try {
            const analysis = await this.analyzeTestFailureById({
              testId: test.id,
              testRunId,
              projectKey,
              projectId: resolvedProjectId,
              includeScreenshots: true,
              includeLogs: true,
              includeArtifacts: false,
              includePageSource: false,
              includeVideo: false,
              analyzeSimilarFailures: false,
              analyzeScreenshotsWithAI: includeScreenshotAnalysis,
              screenshotAnalysisType,
              format: format === 'detailed' ? 'detailed' : 'summary'
            });

            return {
              testId: test.id,
              testName: test.name,
              status: test.status,
              testCases: test.testCases || [],
              analysis,
              error: null
            };
          } catch (error) {
            return {
              testId: test.id,
              testName: test.name,
              status: test.status,
              testCases: test.testCases || [],
              analysis: null,
              error: error instanceof Error ? error.message : String(error)
            };
          }
        });

        analysisResults.push(...await Promise.all(promises));
      } else {
        // Batch execution
        for (let i = 0; i < testsToAnalyze.length; i += batchSize) {
          const batch = testsToAnalyze.slice(i, i + batchSize);
          report += `Progress: Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(testsToAnalyze.length / batchSize)}...\n`;

          const batchPromises = batch.map(async (test: any) => {
            try {
              const analysis = await this.analyzeTestFailureById({
                testId: test.id,
                testRunId,
                projectKey,
                projectId: resolvedProjectId,
                includeScreenshots: true,
                includeLogs: true,
                includeArtifacts: false,
                includePageSource: false,
                includeVideo: false,
                analyzeSimilarFailures: false,
                analyzeScreenshotsWithAI: includeScreenshotAnalysis,
                screenshotAnalysisType,
                format: format === 'detailed' ? 'detailed' : 'summary'
              });

              return {
                testId: test.id,
                testName: test.name,
                status: test.status,
                testCases: test.testCases || [],
                analysis,
                error: null
              };
            } catch (error) {
              return {
                testId: test.id,
                testName: test.name,
                status: test.status,
                testCases: test.testCases || [],
                analysis: null,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          });

          analysisResults.push(...await Promise.all(batchPromises));
        }
      }

      const analysisTime = ((Date.now() - startTime) / 1000).toFixed(1);
      report += `\n✅ Analysis completed in ${analysisTime}s\n\n`;

      // Deep analysis: Extract comprehensive data from all test results
      const errorGroups: Map<string, any[]> = new Map();
      const errorClassifications: Map<string, number> = new Map();
      const testDetails: Map<number, any> = new Map();
      const timelineData: { testId: number; testName: string; timestamp: string; error: string; classification: string }[] = [];
      const stabilityData: { testId: number; testName: string; stability: number }[] = [];

      analysisResults.forEach(result => {
        if (result.analysis && result.analysis.content) {
          const textContent = result.analysis.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join(' ');

          // Extract all relevant information
          const classMatch = textContent.match(/\*\*Error Classification:\*\* ([^\n]+)/);
          // Try multiple patterns for error message extraction (summary vs detailed format)
          let errorMatch = textContent.match(/\*\*Error \(Short\):\*\*\s*```([^`]+)```/); // Summary format
          if (!errorMatch) {
            errorMatch = textContent.match(/### Error Message \(Short\)\s*\n\s*```([^`]+)```/); // Detailed format
          }
          const rootCauseMatch = textContent.match(/\*\*Root Cause:\*\*\s*([^\n]+)/);
          const stabilityMatch = textContent.match(/\*\*Stability:\*\* (\d+)%/);
          const timestampMatch = textContent.match(/\*\*Failure Time:\*\* ([^\n]+)/);
          const stackTraceMatch = textContent.match(/\*\*Stack Trace:\*\*\s*```([^`]+)```/);

          const classification = classMatch ? classMatch[1].trim() : 'Unknown';
          const errorMsg = errorMatch ? errorMatch[1].trim() : 'No error message';
          const rootCause = rootCauseMatch ? rootCauseMatch[1].trim() : 'Unknown';
          const stability = stabilityMatch ? parseInt(stabilityMatch[1]) : 0;
          const timestamp = timestampMatch ? timestampMatch[1].trim() : 'Unknown';
          const stackTrace = stackTraceMatch ? stackTraceMatch[1].trim() : null;

          // Store detailed information
          testDetails.set(result.testId, {
            testId: result.testId,
            testName: result.testName,
            status: result.status,
            classification,
            errorMsg,
            rootCause,
            stability,
            timestamp,
            stackTrace,
            testCases: result.testCases || [],
            fullAnalysis: textContent
          });

          // Track error classifications
          if (classMatch) {
            errorClassifications.set(classification, (errorClassifications.get(classification) || 0) + 1);
          }

          // Group by error message (first 150 chars for better grouping)
          const errorKey = errorMsg.substring(0, 150);
          if (!errorGroups.has(errorKey)) {
            errorGroups.set(errorKey, []);
          }
          errorGroups.get(errorKey)!.push({
            ...result,
            classification,
            rootCause,
            stability,
            timestamp,
            errorMsg
          });

          // Timeline data
          if (timestamp !== 'Unknown') {
            timelineData.push({
              testId: result.testId,
              testName: result.testName,
              timestamp,
              error: errorMsg.substring(0, 80),
              classification
            });
          }

          // Stability tracking
          stabilityData.push({
            testId: result.testId,
            testName: result.testName,
            stability
          });
        }
      });

      // Sort timeline chronologically
      timelineData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Generate Executive Summary
      report += `---\n\n`;
      report += `## 🎯 Executive Summary\n\n`;
      
      const totalClassifications = Array.from(errorClassifications.values()).reduce((a, b) => a + b, 0);
      const avgStabilityNum = stabilityData.length > 0 
        ? stabilityData.reduce((sum, item) => sum + item.stability, 0) / stabilityData.length
        : 0;
      const avgStability = avgStabilityNum.toFixed(1);
      
      report += `**Key Findings:**\n\n`;
      report += `- **${actualLimit} failed tests analyzed** across ${errorClassifications.size} distinct error categories\n`;
      report += `- **${errorGroups.size} unique failure patterns** detected\n`;
      report += `- **Average test stability:** ${avgStability}% (${avgStabilityNum < 50 ? '🔴 Critical' : avgStabilityNum < 80 ? '🟡 Needs Attention' : '🟢 Acceptable'})\n`;
      
      // Identify most critical issues
      const sortedGroups = Array.from(errorGroups.entries())
        .sort((a, b) => b[1].length - a[1].length);
      
      if (sortedGroups.length > 0 && sortedGroups[0][1].length > 1) {
        const topGroup = sortedGroups[0][1];
        report += `- **Most common issue:** ${topGroup[0].classification} (affecting ${topGroup.length} tests)\n`;
      }
      
      report += `\n`;

      // Quick Reference Tables - Grouped by Feature Area and Priority
      report += `---\n\n`;
      
      // Group tests by stability priority
      const criticalTests = Array.from(testDetails.values()).filter((t: any) => t.stability <= 30);
      const mediumTests = Array.from(testDetails.values()).filter((t: any) => t.stability > 30 && t.stability <= 70);
      const lowTests = Array.from(testDetails.values()).filter((t: any) => t.stability > 70);

      // Helper function to extract feature area from test name
      const extractFeatureArea = (testName: string): string => {
        // Look for patterns like "[ Feature Name ]:" at the start
        const bracketMatch = testName.match(/^\[\s*([^\]]+)\s*\]/);
        if (bracketMatch) {
          return bracketMatch[1].trim();
        }
        
        // Extract from camelCase or common patterns
        if (testName.toLowerCase().includes('search') || testName.toLowerCase().includes('quicklog')) {
          return 'Search & Quick Log';
        }
        if (testName.toLowerCase().includes('notification')) {
          return 'Notifications';
        }
        if (testName.toLowerCase().includes('meal')) {
          return 'Meal Management';
        }
        if (testName.toLowerCase().includes('message')) {
          return 'Messages';
        }
        if (testName.toLowerCase().includes('goal')) {
          return 'Goals';
        }
        if (testName.toLowerCase().includes('dashboard')) {
          return 'Dashboard';
        }
        if (testName.toLowerCase().includes('premium')) {
          return 'Premium Features';
        }
        if (testName.toLowerCase().includes('export')) {
          return 'Export';
        }
        
        return 'Other';
      };

      // Generate Quick Reference Tables for Critical Tests
      if (criticalTests.length > 0) {
        report += `## 🔴 Priority 1 - Critical Failures (0-30% Stability)\n\n`;
        
        // Group critical tests by feature area
        const criticalByFeature = new Map<string, any[]>();
        criticalTests.forEach((test: any) => {
          const feature = extractFeatureArea(test.testName);
          if (!criticalByFeature.has(feature)) {
            criticalByFeature.set(feature, []);
          }
          criticalByFeature.get(feature)!.push(test);
        });

        // Generate table for each feature area
        for (const [feature, tests] of Array.from(criticalByFeature.entries()).sort((a, b) => b[1].length - a[1].length)) {
          const subtitle = tests.length > 1 ? 'Complete Breakdown' : 'Critical Issue';
          report += `### ${feature} - ${subtitle}\n\n`;
          report += `| Test | Stability | Issue | Evidence |\n`;
          report += `|------|-----------|-------|----------|\n`;
          
          for (const test of tests.sort((a, b) => a.stability - b.stability)) {
            const testUrl = `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${testRunId}/tests/${test.testId}`;
            // Use FULL test name instead of shortened version
            const testNameDisplay = test.testName;
            // Use error message first, fallback to root cause
            const issueShort = test.errorMsg && test.errorMsg !== 'No error message'
              ? test.errorMsg.substring(0, 80) 
              : (test.rootCause !== 'Unknown' ? test.rootCause.substring(0, 80) : 'Unknown error');
            
            // Get video URL for evidence
            const sessions = await this.getAllSessionsWithArtifacts(testRunId, test.testId, resolvedProjectId!);
            const videoLink = sessions.length > 0 && sessions[0].videos.length > 0 
              ? `[Video](${sessions[0].videos[0].url})` 
              : 'N/A';
            
            report += `| [${testNameDisplay}](${testUrl}) | ${test.stability}% | ${issueShort} | ${videoLink} |\n`;
          }
          report += `\n`;
        }
      }

      // Generate Quick Reference Tables for Medium Priority Tests
      if (mediumTests.length > 0 && mediumTests.length <= 10) {
        report += `## 🟡 Priority 2 - Medium Failures (31-70% Stability)\n\n`;
        
        // Group medium tests by feature area
        const mediumByFeature = new Map<string, any[]>();
        mediumTests.forEach((test: any) => {
          const feature = extractFeatureArea(test.testName);
          if (!mediumByFeature.has(feature)) {
            mediumByFeature.set(feature, []);
          }
          mediumByFeature.get(feature)!.push(test);
        });

        // Generate table for each feature area
        for (const [feature, tests] of Array.from(mediumByFeature.entries()).sort((a, b) => b[1].length - a[1].length)) {
          report += `### ${feature}\n\n`;
          report += `| Test | Stability | Issue | Evidence |\n`;
          report += `|------|-----------|-------|----------|\n`;
          
          for (const test of tests.sort((a, b) => a.stability - b.stability)) {
            const testUrl = `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${testRunId}/tests/${test.testId}`;
            // Use FULL test name instead of shortened version
            const testNameDisplay = test.testName;
            // Use error message first, fallback to root cause
            const issueShort = test.errorMsg && test.errorMsg !== 'No error message'
              ? test.errorMsg.substring(0, 80) 
              : (test.rootCause !== 'Unknown' ? test.rootCause.substring(0, 80) : 'Unknown error');
            
            // Get video URL for evidence
            const sessions = await this.getAllSessionsWithArtifacts(testRunId, test.testId, resolvedProjectId!);
            const videoLink = sessions.length > 0 && sessions[0].videos.length > 0 
              ? `[Video](${sessions[0].videos[0].url})` 
              : 'N/A';
            
            report += `| [${testNameDisplay}](${testUrl}) | ${test.stability}% | ${issueShort} | ${videoLink} |\n`;
          }
          report += `\n`;
        }
      }

      report += `---\n\n`;

      // Timeline Analysis
      if (timelineData.length > 0) {
        report += `## 📅 Timeline Analysis\n\n`;
        report += `**Failure Timeline** (when issues first appeared):\n\n`;
        
        const uniqueDates = new Set(timelineData.map(t => {
          const date = new Date(t.timestamp);
          return date.toLocaleDateString();
        }));
        
        report += `**${uniqueDates.size} day${uniqueDates.size > 1 ? 's' : ''} with failures:**\n\n`;
        
        // Group by date
        const byDate = new Map<string, typeof timelineData>();
        timelineData.forEach(item => {
          const date = new Date(item.timestamp).toLocaleDateString();
          if (!byDate.has(date)) {
            byDate.set(date, []);
          }
          byDate.get(date)!.push(item);
        });
        
        Array.from(byDate.entries()).forEach(([date, items]) => {
          report += `**${date}** (${items.length} failure${items.length > 1 ? 's' : ''})\n`;
          items.slice(0, 3).forEach(item => {
            report += `  - ${item.testName}: ${item.classification}\n`;
          });
          if (items.length > 3) {
            report += `  - ... and ${items.length - 3} more\n`;
          }
          report += `\n`;
        });
      }

      // Pattern Analysis with Root Cause Grouping
      report += `## 🔬 Pattern Analysis\n\n`;
      report += `**Distinct failure categories identified:**\n\n`;
      
      if (errorClassifications.size > 0) {
        const sortedClassifications = Array.from(errorClassifications.entries())
          .sort((a, b) => b[1] - a[1]);
        
        sortedClassifications.forEach(([classification, count], idx) => {
          const percentage = ((count / actualLimit) * 100).toFixed(1);
          const priority = count > actualLimit * 0.3 ? '🔴 HIGH' : count > 1 ? '🟡 MEDIUM' : '🟢 LOW';
          
          report += `**${idx + 1}️⃣ ${classification}** - ${count} test${count > 1 ? 's' : ''} (${percentage}%) ${priority}\n\n`;
          
          // Find tests in this category
          const testsInCategory = Array.from(testDetails.values())
            .filter(t => t.classification === classification);
          
          if (testsInCategory.length > 0) {
            report += `**Affected Tests:**\n`;
            testsInCategory.forEach(test => {
              report += `- Test ${test.testId}: ${test.testName} (${test.stability}% stability)\n`;
            });
            report += `\n`;
            
            // Show common root cause if available
            const rootCauses = testsInCategory.map(t => t.rootCause).filter(r => r !== 'Unknown');
            if (rootCauses.length > 0) {
              const commonRootCause = rootCauses[0]; // Take first as representative
              report += `**Root Cause Assessment:** ${commonRootCause}\n\n`;
            }
          }
        });
      }

      // Generate detailed summary report
      report += `---\n\n`;
      report += `## 📈 Failure Breakdown by Category\n\n`;
      
      if (errorClassifications.size > 0) {
        const sortedClassifications = Array.from(errorClassifications.entries())
          .sort((a, b) => b[1] - a[1]);
        
        sortedClassifications.forEach(([classification, count]) => {
          const percentage = ((count / actualLimit) * 100).toFixed(1);
          report += `- **${classification}**: ${count} test${count > 1 ? 's' : ''} (${percentage}%)\n`;
        });
        report += `\n`;
      } else {
        report += `No error classifications detected.\n\n`;
      }

      // Similar failure groups
      if (errorGroups.size > 0) {
        report += `## 🔄 Similar Failure Groups\n\n`;
        report += `**Detected ${errorGroups.size} unique error pattern(s)**\n\n`;

        let groupNum = 1;
        for (const [errorMsg, tests] of Array.from(errorGroups.entries()).sort((a, b) => b[1].length - a[1].length)) {
          if (tests.length > 1) {
            report += `### Group ${groupNum}: ${tests.length} tests with similar error\n\n`;
            report += `**Error snippet:** \`${errorMsg.substring(0, 80)}...\`\n\n`;
            report += `**Affected tests:**\n`;
            for (const test of tests) {
              const testUrl = `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${testRunId}/tests/${test.testId}`;
              const clickableTestName = await this.makeTestCaseIDsClickable(test.testName, resolvedProjectKey!, baseUrl);
              report += `- [Test ${test.testId}](${testUrl}): [${clickableTestName}](${testUrl})\n`;
            }
            report += `\n`;
            groupNum++;
          }
        }
      }

      // Comprehensive Recommendations with Priority
      report += `## 🎯 Recommendations by Priority\n\n`;
      
      const recommendations = new Map<string, { count: number; tests: any[]; classification: string }>();
      
      analysisResults.forEach(result => {
        if (result.analysis && result.analysis.content) {
          const textContent = result.analysis.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join(' ');

          const classMatch = textContent.match(/\*\*Error Classification:\*\* ([^\n]+)/);
          const classification = classMatch ? classMatch[1].trim() : 'Unknown';

          // Extract recommendations
          const recMatch = textContent.match(/## 💡 Recommended Actions\n\n([^#]+)/);
          if (recMatch) {
            const rec = recMatch[1].trim().split('\n')[0]; // First recommendation
            if (!recommendations.has(rec)) {
              recommendations.set(rec, { count: 0, tests: [], classification });
            }
            const entry = recommendations.get(rec)!;
            entry.count++;
            entry.tests.push(result);
          }
        }
      });

      if (recommendations.size > 0) {
        const sortedRecs = Array.from(recommendations.entries())
          .sort((a, b) => b[1].count - a[1].count);

        // Group by priority
        const highPriority = sortedRecs.filter(([_, data]) => data.count > actualLimit * 0.3);
        const mediumPriority = sortedRecs.filter(([_, data]) => data.count > 1 && data.count <= actualLimit * 0.3);
        const lowPriority = sortedRecs.filter(([_, data]) => data.count === 1);

        if (highPriority.length > 0) {
          report += `### 🔴 HIGH Priority (Affects Multiple Tests)\n\n`;
          for (let i = 0; i < highPriority.length; i++) {
            const [rec, data] = highPriority[i];
            report += `**${i + 1}. ${rec.replace(/^\d+\.\s*/, '')}**\n`;
            report += `   - **Impact:** ${data.count} test${data.count > 1 ? 's' : ''} affected\n`;
            report += `   - **Category:** ${data.classification}\n`;
            report += `   - **Tests:**\n`;
            for (const t of data.tests.slice(0, 5)) {
              const detail = testDetails.get(t.testId);
              const testUrl = `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${testRunId}/tests/${t.testId}`;
              const clickableTestName = await this.makeTestCaseIDsClickable(t.testName, resolvedProjectKey!, baseUrl);
              report += `     - [Test ${t.testId}](${testUrl}): [${clickableTestName}](${testUrl}) (${detail?.stability || 0}% stability)\n`;
            }
            if (data.tests.length > 5) {
              report += `     - ... and ${data.tests.length - 5} more tests\n`;
            }
            report += `\n`;
          }
        }

        if (mediumPriority.length > 0) {
          report += `### 🟡 MEDIUM Priority (Affects 2+ Tests)\n\n`;
          const mediumToShow = mediumPriority.slice(0, 3);
          for (let i = 0; i < mediumToShow.length; i++) {
            const [rec, data] = mediumToShow[i];
            report += `**${i + 1}. ${rec.replace(/^\d+\.\s*/, '')}**\n`;
            report += `   - **Impact:** ${data.count} tests\n`;
            report += `   - **Category:** ${data.classification}\n`;
            const testLinks = await Promise.all(data.tests.map(async (t: any) => {
              const testUrl = `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${testRunId}/tests/${t.testId}`;
              return `[Test ${t.testId}](${testUrl})`;
            }));
            report += `   - **Tests:** ${testLinks.join(', ')}\n`;
            report += `\n`;
          }
        }

        if (lowPriority.length > 0) {
          report += `### 🟢 LOW Priority (Single Test Issues)\n\n`;
          report += `${lowPriority.length} individual test${lowPriority.length > 1 ? 's' : ''} with unique issues. See individual analysis below for details.\n\n`;
        }
      } else {
        report += `No specific recommendations extracted from analysis.\n\n`;
      }

      // Questions for Follow-up (like Claude provided)
      report += `## ❓ Questions for Follow-up\n\n`;
      
      if (errorGroups.size > 1) {
        report += `1. Should we investigate the **${Array.from(errorGroups.entries())[0][1][0].classification}** issues first (affects ${Array.from(errorGroups.entries())[0][1].length} tests)?\n`;
      }
      
      if (timelineData.length > 0) {
        const oldestFailure = timelineData[0];
        report += `2. Do you want to check for related failures in other launches since **${new Date(oldestFailure.timestamp).toLocaleDateString()}**?\n`;
      }
      
      if (includeScreenshotAnalysis === false) {
        report += `3. Should we analyze screenshots to see the actual UI state? (Use \`includeScreenshotAnalysis: true\`)\n`;
      }
      
      report += `4. Should we search for recent code changes that might have caused these failures?\n`;
      report += `\n`;

      // Individual test results
      report += `---\n\n`;
      report += `## 📋 Individual Test Analysis\n\n`;

      for (let idx = 0; idx < analysisResults.length; idx++) {
        const result = analysisResults[idx];
        const detail = testDetails.get(result.testId);
        
        // Build test URL
        const testUrl = `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${testRunId}/tests/${result.testId}`;
        
        // Make embedded test case IDs in test name clickable
        const clickableTestName = await this.makeTestCaseIDsClickable(result.testName, resolvedProjectKey!, baseUrl);
        
        // Header with clickable test name and ID
        report += `### ${idx + 1}. [${clickableTestName}](${testUrl})\n\n`;
        report += `- **Test ID:** [${result.testId}](${testUrl})\n`;
        report += `- **Status:** ${result.status}\n`;
        
        // Get test details to find suite information
        const testRun = testsToAnalyze.find(t => t.id === result.testId);
        if (testRun && testRun.testClass) {
          report += `- **Suite/Test Class:** ${testRun.testClass}\n`;
        }
        
        // Display test cases (Q1. Option B - right after status line)
        if (result.testCases && result.testCases.length > 0) {
          const testCaseLinks = await Promise.all(result.testCases.map(async (tc: any) => {
            const tcUrl = await this.buildTestCaseUrl(tc.testCaseId, resolvedProjectKey!, baseUrl);
            return `[${tc.testCaseId}](${tcUrl})`;
          }));
          report += `- **Test Cases:** 📋 ${testCaseLinks.join(', ')}\n`;
        }

        if (result.error) {
          report += `- **Analysis Error:** ${result.error}\n\n`;
        } else if (result.analysis && result.analysis.content) {
          if (format === 'detailed') {
            // Include full analysis
            const textContent = result.analysis.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n\n');
            
            report += `\n<details>\n<summary>📊 Click to view full analysis</summary>\n\n`;
            report += textContent;
            report += `\n\n</details>\n\n`;
          } else {
            // Enhanced summary with key details
            if (detail) {
              report += `- **Error Type:** ${detail.classification}\n`;
              report += `- **Stability:** ${detail.stability}% ${detail.stability < 50 ? '🔴' : detail.stability < 80 ? '🟡' : '🟢'}\n`;
              if (detail.timestamp !== 'Unknown') {
                report += `- **Failure Time:** ${detail.timestamp}\n`;
              }
              report += `- **Root Cause:** ${detail.rootCause}\n`;
              
              // Extract and show device/OS info from the full analysis
              const textContent = result.analysis.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join(' ');
              
              const deviceMatch = textContent.match(/\*\*Device:\*\*\s*([^\n]+)/);
              const platformMatch = textContent.match(/\*\*Platform:\*\*\s*([^\n]+)/);
              
              if (deviceMatch) {
                report += `- **Device:** ${deviceMatch[1].trim()}\n`;
              }
              if (platformMatch) {
                report += `- **Platform:** ${platformMatch[1].trim()}\n`;
              }
              
              // Show full error message (short)
              if (detail.errorMsg && detail.errorMsg !== 'No error message') {
                report += `\n**Error Message (Short):**\n`;
                report += `\`\`\`\n${detail.errorMsg.substring(0, 300)}${detail.errorMsg.length > 300 ? '...' : ''}\n\`\`\`\n`;
              }
              
              // Extract and show error logs from the full analysis
              const errorLogsMatch = textContent.match(/\*\*Error Logs \(Top \d+\):\*\*\n\n([\s\S]*?)(?=\n\n\*\*|$)/);
              if (errorLogsMatch) {
                report += `\n**Error Logs:**\n${errorLogsMatch[1].substring(0, 500)}${errorLogsMatch[1].length > 500 ? '\n...' : ''}\n\n`;
              }
              
              // Show stack trace if available
              if (detail.stackTrace) {
                report += `\n<details>\n<summary>📜 Stack Trace</summary>\n\n`;
                report += `\`\`\`\n${detail.stackTrace.substring(0, 500)}${detail.stackTrace.length > 500 ? '\n... (truncated)' : ''}\n\`\`\`\n`;
                report += `\n</details>\n`;
              }
              
              report += `\n`;
            } else {
              // Fallback if detail extraction failed
              const textContent = result.analysis.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join(' ');

              const classMatch = textContent.match(/\*\*Error Classification:\*\* ([^\n]+)/);
              const rootCauseMatch = textContent.match(/\*\*Root Cause:\*\*\s*([^\n]+)/);
              
              if (classMatch) {
                report += `- **Error Type:** ${classMatch[1].trim()}\n`;
              }
              if (rootCauseMatch) {
                report += `- **Root Cause:** ${rootCauseMatch[1].trim()}\n`;
              }
              report += `\n`;
            }
          }
        }
      }

      // Pagination info - only show if there are more tests to analyze
      if (totalFailedTests > 10 && offset + actualLimit < totalFailedTests) {
        const remaining = totalFailedTests - (offset + actualLimit);
        report += `---\n\n`;
        report += `## 📄 Continue Analysis\n\n`;
        report += `**Currently Analyzed:** ${offset + 1}-${offset + actualLimit} of ${totalFailedTests} failed tests\n`;
        report += `**Remaining:** ${remaining} test${remaining > 1 ? 's' : ''}\n\n`;
        report += `**To analyze the next batch:**\n\n`;
        report += `\`\`\`\n`;
        report += `detailed_analyze_launch_failures({\n`;
        report += `  testRunId: ${testRunId},\n`;
        report += `  projectKey: "${resolvedProjectKey}",\n`;
        report += `  limit: 10,\n`;
        report += `  offset: ${offset + actualLimit}\n`;
        report += `})\n`;
        report += `\`\`\`\n\n`;
        report += `**Or analyze all remaining:**\n\n`;
        report += `\`\`\`\n`;
        report += `detailed_analyze_launch_failures({\n`;
        report += `  testRunId: ${testRunId},\n`;
        report += `  projectKey: "${resolvedProjectKey}",\n`;
        report += `  limit: ${remaining},\n`;
        report += `  offset: ${offset + actualLimit}\n`;
        report += `})\n`;
        report += `\`\`\`\n\n`;
      }

      // Special handling for Jira format
      if (format === 'jira') {
        return await this.generateJiraTicketsForLaunch({
          testRunId,
          launchName: launch.name || `Launch ${testRunId}`,
          projectKey: resolvedProjectKey!,
          projectId: resolvedProjectId!,
          testsToAnalyze,
          detailLevel: jiraDetailLevel,
          includeScreenshotAnalysis,
          screenshotAnalysisType,
          baseUrl: this.reportingClient['config'].baseUrl
        });
      }

      return {
        content: [{
          type: "text" as const,
          text: report
        }]
      };

    } catch (error: any) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ Error analyzing launch failures: ${error.message}`
        }]
      };
    }
  }

  /**
   * Analyze test execution video tool - downloads video, extracts frames, compares with test case,
   * and predicts if failure is a bug or test issue using Claude Vision
   */
async analyzeTestExecutionVideoTool(input: AnalyzeTestExecutionVideoInput): Promise<{
    content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  }> {
    try {
      if (!this.videoAnalyzer) {
        return {
          content: [{
            type: "text" as const,
            text: "❌ Video analysis is not available. TCM client is required for video analysis features."
          }]
        };
      }

      // Run video analysis
      const result = await this.videoAnalyzer.analyzeTestExecutionVideo(input);

      // Build detailed markdown report
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

      // Header
      let report = `# 🎬 Test Execution Video Analysis\n\n`;
      report += `## 📹 Video Metadata\n\n`;
      report += `- **Session ID**: ${result.videoMetadata.sessionId}\n`;
      report += `- **Duration**: ${result.videoMetadata.videoDuration}s\n`;
      report += `- **Resolution**: ${result.videoMetadata.videoResolution}\n`;
      report += `- **Frames Extracted**: ${result.videoMetadata.extractedFrames}\n`;
      
      // Show frame extraction error prominently if present
      if (result.videoMetadata.frameExtractionError) {
        report += `\n⚠️ **Frame Extraction Issue**: ${result.videoMetadata.frameExtractionError}\n\n`;
        
        if (result.videoMetadata.extractedFrames === 0) {
          report += `**Note**: Analysis will proceed with text-only mode (logs and stack trace analysis). This is often sufficient for diagnosing test failures.\n\n`;
        }
      }
      
      if (result.videoMetadata.platformName) {
        report += `- **Platform**: ${result.videoMetadata.platformName}`;
        if (result.videoMetadata.deviceName) {
          report += ` (${result.videoMetadata.deviceName})`;
        }
        report += `\n`;
      }
      
      report += `- **Status**: ${result.videoMetadata.status || 'COMPLETED'}\n`;
      report += `- **Video URL**: ${result.links.videoUrl}\n`;
      report += `\n`;

      // Failure Analysis
      report += `## ❌ Failure Analysis\n\n`;
      report += `- **Failure Type**: ${result.failureAnalysis.failureType}\n`;
      report += `- **Error Message**: \`${result.failureAnalysis.errorMessage}\`\n`;
      report += `- **Timestamp**: ${result.failureAnalysis.failureTimestamp}\n`;
      
      if (result.failureAnalysis.failureVideoTimestamp !== undefined) {
        report += `- **Video Timestamp**: ${result.failureAnalysis.failureVideoTimestamp}s\n`;
      }
      
      report += `\n`;
      report += `**Root Cause Analysis**:\n`;
      report += `- Category: **${result.failureAnalysis.rootCause.category}**\n`;
      report += `- Confidence: ${result.failureAnalysis.rootCause.confidence}%\n`;
      report += `- Reasoning: ${result.failureAnalysis.rootCause.reasoning}\n`;
      
      if (result.failureAnalysis.rootCause.evidence.length > 0) {
        report += `\n**Evidence**:\n`;
        for (const evidence of result.failureAnalysis.rootCause.evidence) {
          report += `- ${evidence}\n`;
        }
      }
      
      // Show failure frames if available
      if (result.failureAnalysis.failureFrames && result.failureAnalysis.failureFrames.length > 0) {
        report += `\n**📸 Visual Context (Frames near failure)**:\n`;
        for (const frame of result.failureAnalysis.failureFrames) {
          report += `- **Frame @ ${frame.timestamp}s**: ${frame.visualState}\n`;
        }
      }
      
      report += `\n`;

      if (result.failureAnalysis.stackTrace) {
        report += `<details>\n<summary>📋 Full Stack Trace (click to expand)</summary>\n\n\`\`\`\n${result.failureAnalysis.stackTrace.substring(0, 3000)}\n\`\`\`\n</details>\n\n`;
      }

      // NEW: Multi-Test Case Comparison (for tests with multiple TCs)
      if (result.multiTestCaseComparison) {
        const mtc = result.multiTestCaseComparison;
        
        report += `## 📊 Test Case Analysis (${mtc.combinedAnalysis.totalTestCases} Test Cases Found)\n\n`;
        
        // Summary table
        report += `### Test Case Summary\n\n`;
        report += `| Rank | Test Case | Steps | Coverage | Visual Confidence | Match Quality |\n`;
        report += `|------|-----------|-------|----------|-------------------|---------------|\n`;
        
        for (const tc of mtc.testCases) {
          const rankIcon = tc.rank === 1 ? '⭐' : tc.rank.toString();
          const qualityIcon = tc.matchQuality === 'excellent' ? '🟢' : 
                            tc.matchQuality === 'good' ? '🟡' : 
                            tc.matchQuality === 'moderate' ? '🟠' : '🔴';
          
          // Make test case key clickable if URL available
          const tcDisplay = tc.testCaseUrl 
            ? `[${tc.testCaseKey}](${tc.testCaseUrl})` 
            : tc.testCaseKey;
          
          report += `| ${rankIcon} | ${tcDisplay} | ${tc.coverageAnalysis.totalSteps} | ${tc.coverageAnalysis.coveragePercentage}% | ${tc.averageVisualConfidence}% | ${qualityIcon} ${tc.matchQuality.charAt(0).toUpperCase() + tc.matchQuality.slice(1)} |\n`;
        }
        report += `\n`;
        
        // Combined analysis
        report += `### 📈 Combined Coverage Analysis\n\n`;
        report += `- **Total Test Cases Analyzed**: ${mtc.combinedAnalysis.totalTestCases}\n`;
        report += `- **Merged Steps**: ${mtc.combinedAnalysis.totalSteps} (after deduplication)\n`;
        report += `- **Combined Coverage**: ${mtc.combinedAnalysis.combinedCoverage}%\n`;
        report += `- **Best Match**: ${mtc.combinedAnalysis.bestMatch.testCaseKey} (${mtc.combinedAnalysis.bestMatch.coverage}%)\n`;
        report += `  - ${mtc.combinedAnalysis.bestMatch.reasoning}\n`;
        report += `\n`;
        
        // Merged step-by-step comparison
        report += `### 🎥 Merged Test Case Steps (with Visual Verification)\n\n`;
        report += `| Step | Source TC | Expected Action | Actual Execution | Match | Visual Confidence | Notes |\n`;
        report += `|------|-----------|----------------|------------------|-------|-------------------|-------|\n`;
        
        for (const step of mtc.stepByStepComparison.slice(0, 20)) { // Limit to first 20 for readability
          const match = step.match ? '✅' : '❌';
          
          // Visual confidence indicator
          let confidenceIcon = '❓';
          if (step.visualConfidence === 'high') {
            confidenceIcon = '🟢';
          } else if (step.visualConfidence === 'medium') {
            confidenceIcon = '🟡';
          } else if (step.visualConfidence === 'low') {
            confidenceIcon = '🔴';
          } else {
            confidenceIcon = '⚪';
          }
          
          // Build notes
          const notes: string[] = [];
          if (step.videoTimestamp) {
            notes.push(`@${step.videoTimestamp}s`);
          }
          if (step.deviation) {
            notes.push(step.deviation.substring(0, 30));
          }
          
          const notesText = notes.join(' | ');
          
          // Show full test case key (no abbreviation)
          const sourceTC = step.sourceTestCase;
          
          report += `| ${step.testCaseStep} | ${sourceTC} | ${step.expectedAction.substring(0, 30)} | ${step.actualExecution.substring(0, 30)} | ${match} | ${confidenceIcon} | ${notesText} |\n`;
        }
        
        if (mtc.stepByStepComparison.length > 20) {
          report += `\n*Showing first 20 of ${mtc.stepByStepComparison.length} merged steps*\n`;
        }
        report += `\n`;
        
        // Visual verification summary
        const visualStats = {
          high: mtc.stepByStepComparison.filter(s => s.visualConfidence === 'high').length,
          medium: mtc.stepByStepComparison.filter(s => s.visualConfidence === 'medium').length,
          low: mtc.stepByStepComparison.filter(s => s.visualConfidence === 'low').length,
          notVerified: mtc.stepByStepComparison.filter(s => s.visualConfidence === 'not_verified').length,
          discrepancies: mtc.stepByStepComparison.filter(s => s.deviation && s.deviation.includes('⚠️')).length
        };
        
        report += `**Visual Verification Summary (Merged Steps)**:\n`;
        report += `- 🟢 High Confidence: ${visualStats.high} steps\n`;
        report += `- 🟡 Medium Confidence: ${visualStats.medium} steps\n`;
        report += `- 🔴 Low Confidence: ${visualStats.low} steps\n`;
        report += `- ⚪ Not Verified: ${visualStats.notVerified} steps\n`;
        if (visualStats.discrepancies > 0) {
          report += `- ⚠️ **Discrepancies Detected**: ${visualStats.discrepancies} steps with log/video mismatch\n`;
        }
        report += `\n`;
        
      } else if (result.testCaseComparison) {
        // Fallback: Single Test Case Comparison (legacy)
        const tc = result.testCaseComparison;
        report += `## 📋 Test Case Comparison\n\n`;
        report += `- **Test Case**: ${tc.testCaseKey} - ${tc.testCaseTitle}\n`;
        report += `- **Total Steps**: ${tc.coverageAnalysis.totalSteps}\n`;
        report += `- **Executed**: ${tc.coverageAnalysis.executedSteps}\n`;
        report += `- **Coverage**: ${tc.coverageAnalysis.coveragePercentage}%\n`;
        
        if (tc.coverageAnalysis.skippedSteps.length > 0) {
          report += `- **Skipped Steps**: ${tc.coverageAnalysis.skippedSteps.join(', ')}\n`;
        }
        
        if (tc.coverageAnalysis.extraSteps.length > 0) {
          report += `- **Extra Steps**: ${tc.coverageAnalysis.extraSteps.length} steps executed but not in test case\n`;
        }
        report += `\n`;

        // Test case quality assessment (show prominently if outdated)
        if (tc.testCaseQuality.isOutdated) {
          report += `### ⚠️ Test Case Documentation Issue Detected\n\n`;
          report += `**Assessment**: Test case documentation appears **outdated/incomplete** (${tc.testCaseQuality.confidence}% confidence)\n\n`;
          report += `**Analysis**: ${tc.testCaseQuality.reasoning}\n\n`;
          report += `**Recommendation**: ${tc.testCaseQuality.recommendation}\n\n`;
          report += `---\n\n`;
        }

        // Step-by-step comparison table WITH VISUAL VERIFICATION
        report += `### 🎥 Step-by-Step Comparison (with Visual Verification)\n\n`;
        report += `| Step | Expected Action | Actual Execution | Match | Visual Confidence | Notes |\n`;
        report += `|------|----------------|------------------|-------|-------------------|-------|\n`;
        
        for (const step of tc.stepByStepComparison) {
          const match = step.match ? '✅' : '❌';
          
          // Visual confidence indicator
          let confidenceIcon = '❓';
          if (step.visualConfidence === 'high') {
            confidenceIcon = '🟢 High';
          } else if (step.visualConfidence === 'medium') {
            confidenceIcon = '🟡 Medium';
          } else if (step.visualConfidence === 'low') {
            confidenceIcon = '🔴 Low';
          } else {
            confidenceIcon = '⚪ Not Verified';
          }
          
          // Build notes with video timestamp and deviation
          const notes: string[] = [];
          if (step.videoTimestamp) {
            notes.push(`@${step.videoTimestamp}s`);
          }
          if (step.deviation) {
            notes.push(step.deviation);
          }
          
          const notesText = notes.join(' | ');
          report += `| ${step.testCaseStep} | ${step.expectedAction.substring(0, 35)} | ${step.actualExecution.substring(0, 35)} | ${match} | ${confidenceIcon} | ${notesText} |\n`;
        }
        report += `\n`;
        
        // Summary of visual verification
        const visualStats = {
          high: tc.stepByStepComparison.filter(s => s.visualConfidence === 'high').length,
          medium: tc.stepByStepComparison.filter(s => s.visualConfidence === 'medium').length,
          low: tc.stepByStepComparison.filter(s => s.visualConfidence === 'low').length,
          notVerified: tc.stepByStepComparison.filter(s => s.visualConfidence === 'not_verified').length,
          discrepancies: tc.stepByStepComparison.filter(s => s.deviation && s.deviation.includes('⚠️')).length
        };
        
        report += `**Visual Verification Summary**:\n`;
        report += `- 🟢 High Confidence: ${visualStats.high} steps\n`;
        report += `- 🟡 Medium Confidence: ${visualStats.medium} steps\n`;
        report += `- 🔴 Low Confidence: ${visualStats.low} steps\n`;
        report += `- ⚪ Not Verified: ${visualStats.notVerified} steps\n`;
        if (visualStats.discrepancies > 0) {
          report += `- ⚠️ **Discrepancies Detected**: ${visualStats.discrepancies} steps with log/video mismatch\n`;
        }
        report += `\n`;
      }

      // Prediction
      report += `## 🔮 Prediction\n\n`;
      report += `### Verdict: **${result.prediction.verdict}**\n`;
      report += `**Confidence**: ${result.prediction.confidence}%\n\n`;
      report += `**Reasoning**: ${result.prediction.reasoning}\n\n`;

      if (result.prediction.evidenceForBug.length > 0) {
        report += `**Evidence for Bug**:\n`;
        result.prediction.evidenceForBug.forEach(e => {
          report += `- ${e}\n`;
        });
        report += `\n`;
      }

      if (result.prediction.evidenceForTestUpdate.length > 0) {
        report += `**Evidence for Test Update**:\n`;
        result.prediction.evidenceForTestUpdate.forEach(e => {
          report += `- ${e}\n`;
        });
        report += `\n`;
      }

      // Recommendations
      report += `## 💡 Recommendations\n\n`;
      for (const rec of result.prediction.recommendations) {
        const priorityEmoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
        report += `### ${priorityEmoji} ${rec.description} (${rec.priority} priority)\n\n`;
        report += `**Action Items**:\n`;
        rec.actionItems.forEach(item => {
          report += `- ${item}\n`;
        });
        report += `\n`;
      }

      // Summary
      report += `## 📊 Summary\n\n`;
      report += result.summary;
      report += `\n\n`;

      // Links
      report += `## 🔗 Links\n\n`;
      report += `- [Test Execution](${result.links.testUrl})\n`;
      if (result.links.testCaseUrl) {
        report += `- [Test Case](${result.links.testCaseUrl})\n`;
      }
      report += `- [Video Recording](${result.links.videoUrl})\n`;
      report += `\n`;

      // Add report text to content
      content.push({
        type: "text" as const,
        text: report
      });

      // Add frames as clickable file:// links (avoiding 1MB MCP response limit)
      if (result.frames.length > 0) {
        content.push({
          type: "text" as const,
          text: `## 🖼️ Extracted Frames for Analysis\n\n` +
                `${result.frames.length} frames were extracted from the test execution video. ` +
                `Click the links below to view each frame:\n\n`
        });

        let framesText = '';
        for (const frame of result.frames) {
          if (frame.framePath) {
            framesText += `### Frame ${frame.frameNumber} @ ${frame.timestamp}s\n`;
            framesText += `📷 [View Frame](file://${frame.framePath})\n\n`;
            
            if (frame.ocrText && frame.ocrText.length > 0) {
              framesText += `**OCR Text Detected**:\n\`\`\`\n${frame.ocrText.substring(0, 300)}${frame.ocrText.length > 300 ? '...' : ''}\n\`\`\`\n\n`;
            }
          }
        }
        
        content.push({
          type: "text" as const,
          text: framesText
        });
      } else {
        content.push({
          type: "text" as const,
          text: `## ⚠️ No Frames Extracted\n\n` +
                `Frame extraction did not produce any frames. This could indicate:\n` +
                `- Video format issues\n` +
                `- FFmpeg extraction errors\n` +
                `- Video file corruption\n\n` +
                `Check the error logs for more details.\n\n`
        });
      }

      // Final analysis summary
      if (result.frames.length > 0) {
        content.push({
          type: "text" as const,
          text: `\n\n---\n\n` +
                `**📊 Analysis Summary**\n\n` +
                `- **Frames Extracted**: ${result.frames.length}\n` +
                `- **Video Duration**: ${result.videoMetadata.videoDuration}s\n` +
                `- **Prediction**: **${result.prediction.verdict}** (${result.prediction.confidence}% confidence)\n\n` +
                `💡 **Tip**: Click the frame links above to visually inspect what happened during the test execution.`
        });
      }

      return { content };

    } catch (error: any) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ Error analyzing test execution video: ${error.message}\n\n` +
                `Please ensure:\n` +
                `1. The test has a video recording available\n` +
                `2. FFmpeg is installed and accessible\n` +
                `3. You have sufficient disk space for temporary video files\n\n` +
                `Error details: ${error.stack || error}`
        }]
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Regression Runtime Efficiency
  // ---------------------------------------------------------------------------

  static readonly DEFAULT_MEDIUM_THRESHOLD_S = 300;
  static readonly DEFAULT_LONG_THRESHOLD_S = 600;

  private classifyTestDuration(
    durationSeconds: number,
    mediumThreshold = ZebrunnerReportingToolHandlers.DEFAULT_MEDIUM_THRESHOLD_S,
    longThreshold = ZebrunnerReportingToolHandlers.DEFAULT_LONG_THRESHOLD_S
  ): 'short' | 'medium' | 'long' {
    if (durationSeconds < mediumThreshold) return 'short';
    if (durationSeconds < longThreshold) return 'medium';
    return 'long';
  }

  private formatElapsed(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.round(totalSeconds % 60);
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  private computeAttemptElapsed(attempt: { startedAt: string; finishedAt?: string | null }): number {
    if (!attempt.finishedAt) return 0;
    const start = new Date(attempt.startedAt).getTime();
    const end = new Date(attempt.finishedAt).getTime();
    return Math.max(0, (end - start) / 1000);
  }

  /**
   * Build a TestEffectiveDuration for a single test given its sessions.
   */
  private buildEffectiveDuration(
    testId: number,
    sessions: Array<{ session: TestSessionResponse; testStatus: string; passedManually: boolean }>,
    wallClockSeconds: number
  ): TestEffectiveDuration {
    const sortedByEnd = [...sessions].sort((a, b) => {
      const aEnd = a.session.endedAt ? new Date(String(a.session.endedAt)).getTime() : 0;
      const bEnd = b.session.endedAt ? new Date(String(b.session.endedAt)).getTime() : 0;
      return bEnd - aEnd;
    });

    const totalRetry = sessions.reduce((sum, s) => sum + (s.session.durationInSeconds ?? 0), 0);
    const longestEntry = sessions.reduce((best, s) =>
      (s.session.durationInSeconds ?? 0) > (best.session.durationInSeconds ?? 0) ? s : best
    , sessions[0]);

    let effectiveEntry = sortedByEnd.find(s => s.testStatus === 'PASSED' && !s.passedManually)
      ?? sortedByEnd.find(s => s.testStatus === 'PASSED')
      ?? sortedByEnd[0];

    const effectiveDur = effectiveEntry.session.durationInSeconds ?? 0;
    const longestDur = longestEntry.session.durationInSeconds ?? 0;

    const breakdowns: TestSessionBreakdown[] = sessions.map(s => ({
      sessionId: s.session.id,
      device: s.session.deviceName ?? s.session.device ?? null,
      platform: s.session.platformName ?? s.session.platform ?? null,
      platformVersion: s.session.platformVersion ?? null,
      durationSeconds: s.session.durationInSeconds ?? 0,
      status: s.session.status,
      testStatus: s.testStatus,
      passedManually: s.passedManually,
      isEffective: s.session.id === effectiveEntry.session.id,
      isLongest: s.session.id === longestEntry.session.id
    }));

    return {
      effectiveDurationSeconds: effectiveDur,
      longestSessionDurationSeconds: longestDur,
      totalRetryDurationSeconds: totalRetry,
      wallClockDurationSeconds: wallClockSeconds,
      sessionCount: sessions.length,
      effectiveSessionId: effectiveEntry.session.id,
      sessions: breakdowns
    };
  }

  /**
   * Resolve session-aware effective durations for all tests in a launch.
   *
   * Strategy:
   *  - "auto": launch-level fetch first, fall back to per-test for missing data
   *  - "launch_level": single launch-level call only
   *  - "per_test": individual call per test
   *
   * Returns a map keyed by testId for every test that has session data.
   */
  async resolveTestEffectiveDurations(
    launchId: number,
    projectId: number,
    tests: Array<{ id: number; startTime?: number; finishTime?: number }>,
    strategy: SessionResolutionStrategy = 'auto'
  ): Promise<Map<number, TestEffectiveDuration>> {
    const result = new Map<number, TestEffectiveDuration>();
    if (tests.length === 0) return result;

    const wallClockFor = (t: { startTime?: number; finishTime?: number }) =>
      t.finishTime && t.startTime ? Math.round((t.finishTime - t.startTime) / 1000) : 0;

    // -- Group sessions by testId from a sessions response --
    const groupByTest = (sessions: TestSessionResponse[]) => {
      const map = new Map<number, Array<{ session: TestSessionResponse; testStatus: string; passedManually: boolean }>>();
      for (const session of sessions) {
        for (const t of session.tests ?? []) {
          const arr = map.get(t.id) ?? [];
          arr.push({ session, testStatus: t.status, passedManually: t.passedManually });
          map.set(t.id, arr);
        }
      }
      return map;
    };

    if (strategy === 'per_test') {
      for (const test of tests) {
        try {
          const resp = await this.reportingClient.getTestSessionsForTest(launchId, test.id, projectId);
          if (resp.items.length >= 1) {
            const grouped = groupByTest(resp.items);
            const entries = grouped.get(test.id);
            if (entries && entries.length >= 1) {
              result.set(test.id, this.buildEffectiveDuration(test.id, entries, wallClockFor(test)));
            }
          }
        } catch { /* skip on error */ }
      }
      return result;
    }

    // launch_level or auto: start with a launch-level call
    try {
      const allSessions = await this.reportingClient.getAllTestSessions(launchId, projectId);
      const grouped = groupByTest(allSessions.items);

      for (const test of tests) {
        const entries = grouped.get(test.id);
        if (entries && entries.length >= 1) {
          result.set(test.id, this.buildEffectiveDuration(test.id, entries, wallClockFor(test)));
        }
      }

      if (strategy === 'auto') {
        const testIdsWithSessions = new Set(grouped.keys());
        const missingTests = tests.filter(t => !testIdsWithSessions.has(t.id));
        for (const test of missingTests) {
          try {
            const resp = await this.reportingClient.getTestSessionsForTest(launchId, test.id, projectId);
            if (resp.items.length >= 1) {
              const perTestGrouped = groupByTest(resp.items);
              const entries = perTestGrouped.get(test.id);
              if (entries && entries.length >= 1) {
                result.set(test.id, this.buildEffectiveDuration(test.id, entries, wallClockFor(test)));
              }
            }
          } catch { /* skip on error */ }
        }
      }
    } catch {
      if (strategy === 'auto') {
        for (const test of tests) {
          try {
            const resp = await this.reportingClient.getTestSessionsForTest(launchId, test.id, projectId);
            if (resp.items.length >= 1) {
              const grouped = groupByTest(resp.items);
              const entries = grouped.get(test.id);
              if (entries && entries.length >= 1) {
                result.set(test.id, this.buildEffectiveDuration(test.id, entries, wallClockFor(test)));
              }
            }
          } catch { /* skip on error */ }
        }
      }
    }

    return result;
  }

  /**
   * Collect runtime metrics for a single launch (reusable for current & baseline).
   */
  private async collectLaunchRuntimeMetrics(
    launchId: number,
    projectId: number,
    includeTestDetails: boolean,
    includeAttemptsDetails: boolean,
    sessionResolution: SessionResolutionStrategy = 'auto',
    mediumThreshold = ZebrunnerReportingToolHandlers.DEFAULT_MEDIUM_THRESHOLD_S,
    longThreshold = ZebrunnerReportingToolHandlers.DEFAULT_LONG_THRESHOLD_S
  ) {
    let attemptsFetchWarning: string | null = null;
    const [launch, attempts, testRuns] = await Promise.all([
      this.reportingClient.getLaunch(launchId, projectId),
      this.reportingClient.getLaunchAttempts(launchId, projectId).catch((err) => {
        attemptsFetchWarning = `Failed to fetch launch attempts: ${err instanceof Error ? err.message : err}`;
        return { items: [] };
      }),
      this.reportingClient.getAllTestRuns(launchId, projectId)
    ]);

    const elapsedSeconds = launch.elapsed ?? 0;
    const tests = testRuns.items || [];

    // Resolve session-aware effective durations
    const effectiveDurations = await this.resolveTestEffectiveDurations(
      launchId, projectId, tests, sessionResolution
    );

    // --- Per-test duration classification + test case coverage ---
    const durationBuckets: Record<'short' | 'medium' | 'long', { count: number; totalDuration: number; testCaseCount: number; tests: any[] }> = {
      short:  { count: 0, totalDuration: 0, testCaseCount: 0, tests: [] },
      medium: { count: 0, totalDuration: 0, testCaseCount: 0, tests: [] },
      long:   { count: 0, totalDuration: 0, testCaseCount: 0, tests: [] }
    };

    let totalTestCasesCovered = 0;
    let testsWithZeroTCs = 0;
    let testsWithOneTc = 0;
    let testsWithMultipleTCs = 0;
    let testsWithRetries = 0;
    let totalRetryOverheadSeconds = 0;

    for (const test of tests) {
      const wallClock = test.finishTime && test.startTime
        ? Math.round((test.finishTime - test.startTime) / 1000)
        : 0;
      const eff = effectiveDurations.get(test.id);
      const dur = eff ? eff.effectiveDurationSeconds : wallClock;

      if (eff) {
        testsWithRetries++;
        totalRetryOverheadSeconds += eff.totalRetryDurationSeconds - eff.effectiveDurationSeconds;
      }

      const bucket = this.classifyTestDuration(dur, mediumThreshold, longThreshold);
      const tcCount = test.testCases?.length ?? 0;

      durationBuckets[bucket].count += 1;
      durationBuckets[bucket].totalDuration += dur;
      durationBuckets[bucket].testCaseCount += tcCount;
      totalTestCasesCovered += tcCount;

      if (tcCount === 0) testsWithZeroTCs++;
      else if (tcCount === 1) testsWithOneTc++;
      else testsWithMultipleTCs++;

      if (includeTestDetails) {
        const detail: any = {
          id: test.id,
          name: test.name,
          status: test.status,
          durationSeconds: dur,
          testCasesLinked: tcCount,
          testCaseKeys: test.testCases?.map((tc: any) => tc.testCaseId) ?? []
        };
        if (eff) {
          detail.wallClockDurationSeconds = eff.wallClockDurationSeconds;
          detail.longestSessionDurationSeconds = eff.longestSessionDurationSeconds;
          detail.totalRetryDurationSeconds = eff.totalRetryDurationSeconds;
          detail.sessionCount = eff.sessionCount;
          detail.sessions = eff.sessions;
        }
        durationBuckets[bucket].tests.push(detail);
      }
    }

    const classificationSummary = Object.fromEntries(
      (['short', 'medium', 'long'] as const).map(k => [k, {
        count: durationBuckets[k].count,
        totalDuration: durationBuckets[k].totalDuration,
        avgDuration: durationBuckets[k].count > 0
          ? Math.round(durationBuckets[k].totalDuration / durationBuckets[k].count)
          : 0,
        testCasesCovered: durationBuckets[k].testCaseCount,
        avgDurationPerTestCase: durationBuckets[k].testCaseCount > 0
          ? Math.round(durationBuckets[k].totalDuration / durationBuckets[k].testCaseCount)
          : 0,
        ...(includeTestDetails ? { tests: durationBuckets[k].tests } : {})
      }])
    );

    // --- Attempts summary ---
    const sortedAttempts = [...attempts.items].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );

    const initialRun = sortedAttempts.length > 0 ? sortedAttempts[0] : null;
    const reRuns = sortedAttempts.slice(1);

    const initialElapsed = initialRun ? this.computeAttemptElapsed(initialRun) : 0;
    const totalReRunElapsed = reRuns.reduce((sum, a) => sum + this.computeAttemptElapsed(a), 0);

    const attemptsSummary: any = {
      totalAttempts: sortedAttempts.length,
      initialRunElapsedSeconds: Math.round(initialElapsed),
      initialRunElapsedFormatted: this.formatElapsed(initialElapsed),
      reRunCount: reRuns.length,
      totalReRunElapsedSeconds: Math.round(totalReRunElapsed),
      totalReRunElapsedFormatted: this.formatElapsed(totalReRunElapsed)
    };

    if (includeAttemptsDetails && sortedAttempts.length > 0) {
      attemptsSummary.initialRun = {
        id: initialRun!.id,
        startedAt: initialRun!.startedAt,
        finishedAt: initialRun!.finishedAt,
        passed: initialRun!.finishPassed ?? 0,
        failed: initialRun!.finishFailed ?? 0,
        skipped: initialRun!.finishSkipped ?? 0,
        knownIssue: initialRun!.finishKnownIssue ?? 0
      };
      attemptsSummary.reRuns = reRuns.map((a, idx) => ({
        attempt: idx + 2,
        id: a.id,
        startedAt: a.startedAt,
        finishedAt: a.finishedAt,
        elapsedSeconds: Math.round(this.computeAttemptElapsed(a)),
        passed: a.finishPassed ?? 0,
        failed: a.finishFailed ?? 0,
        skipped: a.finishSkipped ?? 0,
        knownIssue: a.finishKnownIssue ?? 0
      }));
    }

    // --- Metrics ---
    const totalExecutedTests = (launch.passed ?? 0) + (launch.failed ?? 0)
      + (launch.skipped ?? 0) + (launch.aborted ?? 0) + (launch.blocked ?? 0);
    const avgRuntimePerTest = totalExecutedTests > 0
      ? Math.round((elapsedSeconds / totalExecutedTests) * 100) / 100
      : 0;
    const avgRuntimePerTestCase = totalTestCasesCovered > 0
      ? Math.round((elapsedSeconds / totalTestCasesCovered) * 100) / 100
      : 0;

    // Weighted Runtime Index (experimental, trend-analysis only)
    const wShort = 1, wMedium = 2, wLong = 3;
    const sc = classificationSummary.short as any;
    const mc = classificationSummary.medium as any;
    const lc = classificationSummary.long as any;

    const weightedSum = sc.avgDuration * sc.count * wShort
      + mc.avgDuration * mc.count * wMedium
      + lc.avgDuration * lc.count * wLong;
    const weightedCount = sc.count * wShort + mc.count * wMedium + lc.count * wLong;
    const weightedRuntimeIndex = weightedCount > 0
      ? Math.round((weightedSum / weightedCount) * 100) / 100
      : 0;

    const weightedSumPerTC = sc.avgDurationPerTestCase * sc.testCasesCovered * wShort
      + mc.avgDurationPerTestCase * mc.testCasesCovered * wMedium
      + lc.avgDurationPerTestCase * lc.testCasesCovered * wLong;
    const weightedCountPerTC = sc.testCasesCovered * wShort + mc.testCasesCovered * wMedium + lc.testCasesCovered * wLong;
    const weightedRuntimeIndexPerTestCase = weightedCountPerTC > 0
      ? Math.round((weightedSumPerTC / weightedCountPerTC) * 100) / 100
      : 0;

    return {
      launchId: launch.id,
      name: launch.name,
      suiteName: launch.testSuite?.name ?? launch.name,
      status: launch.status,
      elapsedSeconds,
      elapsedFormatted: this.formatElapsed(elapsedSeconds),
      attempts: attemptsSummary,
      testDurationClassification: classificationSummary,
      testCaseCoverage: {
        totalTestCasesCovered,
        testsWithZeroTestCases: testsWithZeroTCs,
        testsWithOneTestCase: testsWithOneTc,
        testsWithMultipleTestCases: testsWithMultipleTCs
      },
      sessionAwareDuration: {
        testsWithRetries,
        totalRetryOverheadSeconds: Math.round(totalRetryOverheadSeconds),
        totalRetryOverheadFormatted: this.formatElapsed(totalRetryOverheadSeconds),
        note: 'Durations use session-level effective time (passed/last session) instead of wall-clock span'
      },
      metrics: {
        totalExecutedTests,
        totalTestCasesCovered,
        totalElapsedSeconds: elapsedSeconds,
        avgRuntimePerTest,
        avgRuntimePerTestFormatted: this.formatElapsed(avgRuntimePerTest),
        avgRuntimePerTestCase,
        avgRuntimePerTestCaseFormatted: this.formatElapsed(avgRuntimePerTestCase),
        weightedRuntimeIndex,
        weightedRuntimeIndexPerTestCase,
        weightedRuntimeIndexNote: 'Experimental – trend analysis only'
      },
      ...(attemptsFetchWarning ? { warnings: [attemptsFetchWarning] } : {})
    };
  }

  /**
   * Resolve launches matching the provided filters for a project.
   */
  private async resolveLaunches(
    projectId: number,
    opts: {
      milestone?: string;
      build?: string;
      suiteNames?: string[];
      launchIds?: number[];
    }
  ) {
    if (opts.launchIds && opts.launchIds.length > 0) {
      return opts.launchIds;
    }

    const launchIds: number[] = [];
    let page = 1;
    const pageSize = 50;
    const maxPages = 10;
    const seenIds = new Set<number>();

    while (page <= maxPages) {
      const resp = await this.reportingClient.getLaunches(projectId, {
        page,
        pageSize,
        milestone: opts.milestone,
        query: opts.build
      });

      for (const l of resp.items) {
        if (seenIds.has(l.id)) continue;
        seenIds.add(l.id);

        if (opts.suiteNames && opts.suiteNames.length > 0) {
          const lowerName = l.name.toLowerCase();
          const matches = opts.suiteNames.some(s => lowerName.includes(s.toLowerCase()));
          if (!matches) continue;
        }

        launchIds.push(l.id);
      }

      if (page >= (resp._meta?.totalPages ?? 1)) break;
      page++;
    }

    return launchIds;
  }

  /**
   * Analyze Regression Runtime Efficiency across launches for a project.
   *
   * Collects per-launch timing, attempt/re-run breakdown, per-test duration
   * classification, and calculates Average Runtime per Test and Weighted Runtime
   * Index with optional baseline comparison.
   */
  async analyzeRegressionRuntime(input: {
    projectKey?: string;
    projectId?: number;
    milestone?: string;
    build?: string;
    suiteNames?: string[];
    launchIds?: number[];
    previousMilestone?: string;
    previousBuild?: string;
    includeTestDetails?: boolean;
    includeAttemptsDetails?: boolean;
    format?: 'dto' | 'json' | 'string';
    session_resolution?: SessionResolutionStrategy;
    medium_threshold_seconds?: number;
    long_threshold_seconds?: number;
  }) {
    const {
      projectKey,
      projectId,
      milestone,
      build,
      suiteNames,
      launchIds,
      previousMilestone,
      previousBuild,
      includeTestDetails = false,
      includeAttemptsDetails = true,
      format = 'json',
      session_resolution = 'auto',
      medium_threshold_seconds = ZebrunnerReportingToolHandlers.DEFAULT_MEDIUM_THRESHOLD_S,
      long_threshold_seconds = ZebrunnerReportingToolHandlers.DEFAULT_LONG_THRESHOLD_S
    } = input;

    try {
      if (!projectKey && !projectId) {
        throw new Error('Either projectKey or projectId must be provided');
      }

      let resolvedProjectId = projectId;
      let projectInfo: any = null;

      if (projectKey) {
        projectInfo = await this.reportingClient.getProject(projectKey);
        resolvedProjectId = projectInfo.id;
      }

      if (!resolvedProjectId) {
        throw new Error('Could not resolve project ID');
      }

      // --- Resolve current launches ---
      const currentLaunchIds = await this.resolveLaunches(resolvedProjectId, {
        milestone,
        build,
        suiteNames,
        launchIds
      });

      if (currentLaunchIds.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No launches found matching the provided filters. ' +
              'Try adjusting milestone, build, suite_names, or launch_ids parameters.'
          }]
        };
      }

      // --- Collect metrics for each current launch (parallel) ---
      const currentResults = await Promise.all(
        currentLaunchIds.map(id =>
          this.collectLaunchRuntimeMetrics(id, resolvedProjectId!, includeTestDetails, includeAttemptsDetails, session_resolution, medium_threshold_seconds, long_threshold_seconds)
        )
      );

      // --- Aggregate across launches ---
      const totalTests = currentResults.reduce((s, r) => s + r.metrics.totalExecutedTests, 0);
      const totalTCsCovered = currentResults.reduce((s, r) => s + r.metrics.totalTestCasesCovered, 0);
      const totalElapsed = currentResults.reduce((s, r) => s + r.metrics.totalElapsedSeconds, 0);
      const overallAvgRuntime = totalTests > 0
        ? Math.round((totalElapsed / totalTests) * 100) / 100
        : 0;
      const overallAvgRuntimePerTC = totalTCsCovered > 0
        ? Math.round((totalElapsed / totalTCsCovered) * 100) / 100
        : 0;

      const allShort = currentResults.reduce((s, r) => s + (r.testDurationClassification.short as any).count, 0);
      const allMedium = currentResults.reduce((s, r) => s + (r.testDurationClassification.medium as any).count, 0);
      const allLong = currentResults.reduce((s, r) => s + (r.testDurationClassification.long as any).count, 0);
      const allTestsCount = allShort + allMedium + allLong;

      const aggZeroTCs = currentResults.reduce((s, r) => s + r.testCaseCoverage.testsWithZeroTestCases, 0);
      const aggOneTc = currentResults.reduce((s, r) => s + r.testCaseCoverage.testsWithOneTestCase, 0);
      const aggMultiTCs = currentResults.reduce((s, r) => s + r.testCaseCoverage.testsWithMultipleTestCases, 0);

      const wShort = 1, wMedium = 2, wLong = 3;
      const aggWeightedSum = currentResults.reduce((s, r) => {
        const sc = r.testDurationClassification.short as any;
        const mc = r.testDurationClassification.medium as any;
        const lc = r.testDurationClassification.long as any;
        return s + sc.avgDuration * sc.count * wShort
                 + mc.avgDuration * mc.count * wMedium
                 + lc.avgDuration * lc.count * wLong;
      }, 0);
      const aggWeightedCount = allShort * wShort + allMedium * wMedium + allLong * wLong;
      const overallWeightedIndex = aggWeightedCount > 0
        ? Math.round((aggWeightedSum / aggWeightedCount) * 100) / 100
        : 0;

      const allShortTCs = currentResults.reduce((s, r) => s + (r.testDurationClassification.short as any).testCasesCovered, 0);
      const allMediumTCs = currentResults.reduce((s, r) => s + (r.testDurationClassification.medium as any).testCasesCovered, 0);
      const allLongTCs = currentResults.reduce((s, r) => s + (r.testDurationClassification.long as any).testCasesCovered, 0);
      const allTCsCount = allShortTCs + allMediumTCs + allLongTCs;

      const aggWeightedSumPerTC = currentResults.reduce((s, r) => {
        const sc = r.testDurationClassification.short as any;
        const mc = r.testDurationClassification.medium as any;
        const lc = r.testDurationClassification.long as any;
        return s + sc.avgDurationPerTestCase * sc.testCasesCovered * wShort
                 + mc.avgDurationPerTestCase * mc.testCasesCovered * wMedium
                 + lc.avgDurationPerTestCase * lc.testCasesCovered * wLong;
      }, 0);
      const aggWeightedCountPerTC = allShortTCs * wShort + allMediumTCs * wMedium + allLongTCs * wLong;
      const overallWeightedIndexPerTC = aggWeightedCountPerTC > 0
        ? Math.round((aggWeightedSumPerTC / aggWeightedCountPerTC) * 100) / 100
        : 0;

      const aggregated: any = {
        totalLaunches: currentResults.length,
        totalTests,
        totalTestCasesCovered: totalTCsCovered,
        totalElapsedSeconds: totalElapsed,
        totalElapsedFormatted: this.formatElapsed(totalElapsed),
        overallAvgRuntimePerTest: overallAvgRuntime,
        overallAvgRuntimePerTestFormatted: this.formatElapsed(overallAvgRuntime),
        overallAvgRuntimePerTestCase: overallAvgRuntimePerTC,
        overallAvgRuntimePerTestCaseFormatted: this.formatElapsed(overallAvgRuntimePerTC),
        overallWeightedRuntimeIndex: overallWeightedIndex,
        overallWeightedRuntimeIndexPerTestCase: overallWeightedIndexPerTC,
        testCaseCoverage: {
          totalTestCasesCovered: totalTCsCovered,
          testsWithZeroTestCases: aggZeroTCs,
          testsWithOneTestCase: aggOneTc,
          testsWithMultipleTestCases: aggMultiTCs
        },
        durationDistribution: {
          shortCount: allShort,
          shortPercent: allTestsCount > 0 ? Math.round((allShort / allTestsCount) * 100) : 0,
          shortTestCases: allShortTCs,
          shortTestCasesPercent: allTCsCount > 0 ? Math.round((allShortTCs / allTCsCount) * 100) : 0,
          mediumCount: allMedium,
          mediumPercent: allTestsCount > 0 ? Math.round((allMedium / allTestsCount) * 100) : 0,
          mediumTestCases: allMediumTCs,
          mediumTestCasesPercent: allTCsCount > 0 ? Math.round((allMediumTCs / allTCsCount) * 100) : 0,
          longCount: allLong,
          longPercent: allTestsCount > 0 ? Math.round((allLong / allTestsCount) * 100) : 0,
          longTestCases: allLongTCs,
          longTestCasesPercent: allTCsCount > 0 ? Math.round((allLongTCs / allTCsCount) * 100) : 0,
        }
      };

      // --- Baseline comparison (optional) ---
      let baselineComparison: any = null;
      if (previousMilestone || previousBuild) {
        const prevLaunchIds = await this.resolveLaunches(resolvedProjectId, {
          milestone: previousMilestone,
          build: previousBuild,
          suiteNames
        });

        if (prevLaunchIds.length > 0) {
          const prevResults = await Promise.all(
            prevLaunchIds.map(id =>
              this.collectLaunchRuntimeMetrics(id, resolvedProjectId!, false, false, session_resolution, medium_threshold_seconds, long_threshold_seconds)
            )
          );

          const prevTotalTests = prevResults.reduce((s, r) => s + r.metrics.totalExecutedTests, 0);
          const prevTotalTCs = prevResults.reduce((s, r) => s + r.metrics.totalTestCasesCovered, 0);
          const prevTotalElapsed = prevResults.reduce((s, r) => s + r.metrics.totalElapsedSeconds, 0);
          const prevAvgRuntime = prevTotalTests > 0
            ? Math.round((prevTotalElapsed / prevTotalTests) * 100) / 100
            : 0;
          const prevAvgRuntimePerTC = prevTotalTCs > 0
            ? Math.round((prevTotalElapsed / prevTotalTCs) * 100) / 100
            : 0;

          const prevShort = prevResults.reduce((s, r) => s + (r.testDurationClassification.short as any).count, 0);
          const prevMedium = prevResults.reduce((s, r) => s + (r.testDurationClassification.medium as any).count, 0);
          const prevLong = prevResults.reduce((s, r) => s + (r.testDurationClassification.long as any).count, 0);
          const prevWeightedSum = prevResults.reduce((s, r) => {
            const sc = r.testDurationClassification.short as any;
            const mc = r.testDurationClassification.medium as any;
            const lc = r.testDurationClassification.long as any;
            return s + sc.avgDuration * sc.count * wShort
                     + mc.avgDuration * mc.count * wMedium
                     + lc.avgDuration * lc.count * wLong;
          }, 0);
          const prevWeightedCount = prevShort * wShort + prevMedium * wMedium + prevLong * wLong;
          const prevWeightedIndex = prevWeightedCount > 0
            ? Math.round((prevWeightedSum / prevWeightedCount) * 100) / 100
            : 0;

          const prevWeightedSumPerTC = prevResults.reduce((s, r) => {
            const sc = r.testDurationClassification.short as any;
            const mc = r.testDurationClassification.medium as any;
            const lc = r.testDurationClassification.long as any;
            return s + sc.avgDurationPerTestCase * sc.testCasesCovered * wShort
                     + mc.avgDurationPerTestCase * mc.testCasesCovered * wMedium
                     + lc.avgDurationPerTestCase * lc.testCasesCovered * wLong;
          }, 0);
          const prevShortTCs = prevResults.reduce((s, r) => s + (r.testDurationClassification.short as any).testCasesCovered, 0);
          const prevMediumTCs = prevResults.reduce((s, r) => s + (r.testDurationClassification.medium as any).testCasesCovered, 0);
          const prevLongTCs = prevResults.reduce((s, r) => s + (r.testDurationClassification.long as any).testCasesCovered, 0);
          const prevWeightedCountPerTC = prevShortTCs * wShort + prevMediumTCs * wMedium + prevLongTCs * wLong;
          const prevWeightedIndexPerTC = prevWeightedCountPerTC > 0
            ? Math.round((prevWeightedSumPerTC / prevWeightedCountPerTC) * 100) / 100
            : 0;

          const avgDelta = prevAvgRuntime > 0
            ? Math.round(((overallAvgRuntime - prevAvgRuntime) / prevAvgRuntime) * 10000) / 100
            : 0;
          const avgDeltaPerTC = prevAvgRuntimePerTC > 0
            ? Math.round(((overallAvgRuntimePerTC - prevAvgRuntimePerTC) / prevAvgRuntimePerTC) * 10000) / 100
            : 0;
          const weightedDelta = prevWeightedIndex > 0
            ? Math.round(((overallWeightedIndex - prevWeightedIndex) / prevWeightedIndex) * 10000) / 100
            : 0;
          const weightedDeltaPerTC = prevWeightedIndexPerTC > 0
            ? Math.round(((overallWeightedIndexPerTC - prevWeightedIndexPerTC) / prevWeightedIndexPerTC) * 10000) / 100
            : 0;

          // Per-suite delta (match by suiteName)
          const perSuiteDeltas: any[] = [];
          for (const curr of currentResults) {
            const prev = prevResults.find(p => p.suiteName === curr.suiteName);
            if (prev) {
              const suiteAvgDelta = prev.metrics.avgRuntimePerTest > 0
                ? Math.round(((curr.metrics.avgRuntimePerTest - prev.metrics.avgRuntimePerTest) / prev.metrics.avgRuntimePerTest) * 10000) / 100
                : 0;
              const suiteTcDelta = prev.metrics.avgRuntimePerTestCase > 0
                ? Math.round(((curr.metrics.avgRuntimePerTestCase - prev.metrics.avgRuntimePerTestCase) / prev.metrics.avgRuntimePerTestCase) * 10000) / 100
                : 0;
              const suiteWriDelta = prev.metrics.weightedRuntimeIndex > 0
                ? Math.round(((curr.metrics.weightedRuntimeIndex - prev.metrics.weightedRuntimeIndex) / prev.metrics.weightedRuntimeIndex) * 10000) / 100
                : 0;
              const suiteWriTcDelta = prev.metrics.weightedRuntimeIndexPerTestCase > 0
                ? Math.round(((curr.metrics.weightedRuntimeIndexPerTestCase - prev.metrics.weightedRuntimeIndexPerTestCase) / prev.metrics.weightedRuntimeIndexPerTestCase) * 10000) / 100
                : 0;
              perSuiteDeltas.push({
                suiteName: curr.suiteName,
                currentAvgRuntimePerTest: curr.metrics.avgRuntimePerTest,
                previousAvgRuntimePerTest: prev.metrics.avgRuntimePerTest,
                deltaPerTestPercent: suiteAvgDelta,
                currentAvgRuntimePerTestCase: curr.metrics.avgRuntimePerTestCase,
                previousAvgRuntimePerTestCase: prev.metrics.avgRuntimePerTestCase,
                deltaPerTestCasePercent: suiteTcDelta,
                currentWRI: curr.metrics.weightedRuntimeIndex,
                previousWRI: prev.metrics.weightedRuntimeIndex,
                deltaWRIPercent: suiteWriDelta,
                currentWRIPerTestCase: curr.metrics.weightedRuntimeIndexPerTestCase,
                previousWRIPerTestCase: prev.metrics.weightedRuntimeIndexPerTestCase,
                deltaWRIPerTestCasePercent: suiteWriTcDelta,
                currentTestCasesCovered: curr.metrics.totalTestCasesCovered,
                previousTestCasesCovered: prev.metrics.totalTestCasesCovered,
                status: Math.abs(suiteAvgDelta) <= 5 ? 'stable' : suiteAvgDelta > 0 ? 'degraded' : 'improved'
              });
            }
          }

          // Flag abnormal degradation in long-running tests
          const longTestDegradations: any[] = [];
          for (const curr of currentResults) {
            const prev = prevResults.find(p => p.suiteName === curr.suiteName);
            if (!prev) continue;
            const currLong = (curr.testDurationClassification.long as any);
            const prevLong = (prev.testDurationClassification.long as any);
            if (prevLong.avgDuration > 0 && currLong.count > 0) {
              const longDelta = ((currLong.avgDuration - prevLong.avgDuration) / prevLong.avgDuration) * 100;
              if (longDelta > 20) {
                longTestDegradations.push({
                  suiteName: curr.suiteName,
                  currentAvgLongDuration: currLong.avgDuration,
                  previousAvgLongDuration: prevLong.avgDuration,
                  degradationPercent: Math.round(longDelta * 100) / 100,
                  warning: 'Abnormal degradation detected in long-running tests (>20% increase)'
                });
              }
            }
          }

          baselineComparison = {
            previous: {
              totalLaunches: prevResults.length,
              totalTests: prevTotalTests,
              totalTestCasesCovered: prevTotalTCs,
              overallAvgRuntimePerTest: prevAvgRuntime,
              overallAvgRuntimePerTestCase: prevAvgRuntimePerTC,
              overallWeightedRuntimeIndex: prevWeightedIndex,
              overallWeightedRuntimeIndexPerTestCase: prevWeightedIndexPerTC
            },
            delta: {
              avgRuntimePerTestChangePercent: avgDelta,
              avgRuntimePerTestCaseChangePercent: avgDeltaPerTC,
              weightedIndexChangePercent: weightedDelta,
              weightedIndexPerTestCaseChangePercent: weightedDeltaPerTC,
              overallStatus: Math.abs(avgDelta) <= 5 ? 'stable' : avgDelta > 0 ? 'degraded' : 'improved'
            },
            perSuiteDeltas,
            ...(longTestDegradations.length > 0 ? { longTestDegradations } : {})
          };
        }
      }

      // --- Build final result ---
      const result: any = {
        project: projectInfo ? {
          id: projectInfo.id,
          key: projectInfo.key,
          name: projectInfo.name
        } : { id: resolvedProjectId },
        filters: {
          ...(milestone ? { milestone } : {}),
          ...(build ? { build } : {}),
          ...(suiteNames ? { suiteNames } : {}),
          ...(launchIds ? { launchIds } : {})
        },
        launches: currentResults,
        aggregated,
        ...(baselineComparison ? { baselineComparison } : {}),
        durationClassThresholds: {
          short: `< ${medium_threshold_seconds}s`,
          medium: `${medium_threshold_seconds}s - ${long_threshold_seconds}s`,
          long: `>= ${long_threshold_seconds}s`
        }
      };

      const formattedData = FormatProcessor.format(result, format);

      return {
        content: [{
          type: 'text' as const,
          text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error analyzing regression runtime: ${error.message}`
        }]
      };
    }
  }
}
