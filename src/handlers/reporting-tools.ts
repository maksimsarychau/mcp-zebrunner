import { z } from "zod";
import { ZebrunnerReportingClient } from "../api/reporting-client.js";
import { EnhancedZebrunnerClient } from "../api/enhanced-client.js";
import { FormatProcessor } from "../utils/formatter.js";
import { GetLauncherDetailsInputSchema, AnalyzeTestExecutionVideoInput } from "../types/api.js";
import { VideoAnalyzer } from "../utils/video-analysis/analyzer.js";

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

      // Get launch details and project key for URL generation
      const launch = await this.reportingClient.getLaunch(launchId, resolvedProjectId!);
      const resolvedProjectKey = projectKey || await this.reportingClient.getProjectKey(resolvedProjectId!);
      const baseUrl = this.reportingClient['config'].baseUrl;
      
      // Build launch URL
      const launchUrl = `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${launchId}`;
      
      // Fetch ALL test runs (auto-paginated)
      const testRuns = await this.reportingClient.getAllTestRuns(launchId, resolvedProjectId!);
      
      // Extract essential fields only (configurable to exclude heavy arrays)
      const lightweightTests = await Promise.all(testRuns.items.map(async test => {
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
          maintainerId: test.maintainerId,
          testUrl: `${baseUrl}/projects/${resolvedProjectKey}/automation-launches/${launchId}/tests/${test.id}`
        };
        
        // Add clickable JIRA issue references with resolved URLs
        if (test.issueReferences && test.issueReferences.length > 0) {
          baseTest.issueReferencesWithUrls = await Promise.all(
            test.issueReferences.map(async (issue: any) => {
              if (issue.type === 'JIRA') {
                const jiraUrl = await this.reportingClient.buildJiraUrl(issue.value, resolvedProjectId);
                return {
                  ...issue,
                  url: jiraUrl
                };
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
      format = 'detailed'
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

      // Fetch test run details to get test information
      const testRuns = await this.reportingClient.getTestRuns(testRunId, resolvedProjectId!);
      const testRun = testRuns.items.find(t => t.id === testId);
      
      if (!testRun) {
        throw new Error(`Test ID ${testId} not found in launch ${testRunId}`);
      }

      // Fetch logs and screenshots
      let logsAndScreenshots;
      if (includeLogs || includeScreenshots) {
        logsAndScreenshots = await this.reportingClient.getTestLogsAndScreenshots(testRunId, testId);
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

      // Generate Jira format if requested
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
          baseUrl: this.reportingClient['config'].baseUrl
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

      // Generate analysis report (detailed or summary)
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
        screenshotAnalysisType
      });

      return {
        content: [
          {
            type: "text" as const,
            text: analysisReport
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
      screenshotAnalysisType = 'detailed'
    } = params;

    const duration = testRun.finishTime && testRun.startTime
      ? Math.round((testRun.finishTime - testRun.startTime) / 1000)
      : 0;

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
    
    // Test Cases
    if (testRun.testCases && testRun.testCases.length > 0) {
      const testCaseLinks = await this.formatTestCases(testRun.testCases, projectKey!, baseUrl, 'markdown');
      report += `- **Test Cases:** 📋 ${testCaseLinks}\n`;
    } else {
      report += `- **Test Cases:** ⚠️ Not linked to test case\n`;
    }
    
    report += `- **Bug Status:** ${testRun.issueReferences && testRun.issueReferences.length > 0 ? '✅ Bug Linked' : '❌ No Bug Linked'}\n\n`;

    // Test Session Details
    report += `## 🧪 Test Session Details\n\n`;
    report += `- **Test ID:** [${testId}](${testSessionUrl})\n`;
    report += `- **Launch ID:** [${testRunId}](${launchUrl})\n`;
    report += `- **Test Class:** ${testRun.testClass || 'Unknown'}\n`;
    report += `- **Duration:** ${Math.floor(duration / 60)}m ${duration % 60}s\n`;
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
    report += `### Error Message\n\n`;
    report += `\`\`\`\n${testRun.message || 'No error message available'}\n\`\`\`\n\n`;

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
        report += `### Error Logs\n\n`;
        logAnalysis.errorLogs.slice(0, 3).forEach((log: any) => {
          report += `**[${log.level}]** ${new Date(log.timestamp).toLocaleTimeString()}:\n`;
          report += `\`\`\`\n${log.message}\n\`\`\`\n\n`;
        });
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
        // Build clickable JIRA URL if it's a JIRA issue
        if (issue.type === 'JIRA') {
          const jiraUrl = await this.reportingClient.buildJiraUrl(issue.value, projectId);
          report += `- **${issue.type}:** [${issue.value}](${jiraUrl})\n`;
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
    report += `\n`;

    report += `**Error:**\n\`\`\`\n${testRun.message}\n\`\`\`\n\n`;

    // Get latest session for summary format
    const sessions = await this.getAllSessionsWithArtifacts(testRunId, testId, projectId);
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
      if (format === 'jira') {
        return `[${tc.testCaseId}|${url}]`;
      } else {
        return `[${tc.testCaseId}](${url})`;
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

    const duration = testRun.finishTime && testRun.startTime
      ? Math.round((testRun.finishTime - testRun.startTime) / 1000)
      : 0;
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

    jiraContent += `h3. Error Message\n\n`;
    jiraContent += `{code}\n${(testRun.message || 'No error message').substring(0, 500)}${testRun.message && testRun.message.length > 500 ? '\n... (truncated, see full logs in link)' : ''}\n{code}\n\n`;

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

    // Logs
    if (logAnalysis && logAnalysis.errorLogs && logAnalysis.errorLogs.length > 0) {
      jiraContent += `h3. Error Logs\n\n`;
      logAnalysis.errorLogs.slice(0, 3).forEach((log: any) => {
        jiraContent += `*[${log.level}]* ${new Date(log.timestamp).toLocaleString()}:\n`;
        jiraContent += `{code}\n${log.message.substring(0, 300)}${log.message.length > 300 ? '\n...' : ''}\n{code}\n\n`;
      });
      jiraContent += `[View all logs|${testUrl}]\n\n`;
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
        
        if (detail.errorMsg && detail.errorMsg !== 'No error message') {
          jiraContent += `\n{code:title=Error}\n${detail.errorMsg.substring(0, 200)}${detail.errorMsg.length > 200 ? '...' : ''}\n{code}\n`;
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
      
      // Build suite URL if available
      let suiteUrl: string | null = null;
      if (launch.testSuite && launch.testSuite.id) {
        suiteUrl = `${baseUrl}/projects/${resolvedProjectKey}/test-suites/${launch.testSuite.id}`;
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
          const errorMatch = textContent.match(/\*\*Error Message:\*\*\s*```([^`]+)```/);
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
            const testNameShort = test.testName.replace(/^\[[^\]]+\]\s*:\s*/, '').replace(/\s*-\s*\w+$/, '');
            const issueShort = test.rootCause !== 'Unknown' 
              ? test.rootCause.substring(0, 80) 
              : test.errorMsg.substring(0, 80);
            
            // Get video URL for evidence
            const sessions = await this.getAllSessionsWithArtifacts(testRunId, test.testId, resolvedProjectId!);
            const videoLink = sessions.length > 0 && sessions[0].videos.length > 0 
              ? `[Video](${sessions[0].videos[0].url})` 
              : 'N/A';
            
            report += `| [${testNameShort}](${testUrl}) | ${test.stability}% | ${issueShort} | ${videoLink} |\n`;
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
            const testNameShort = test.testName.replace(/^\[[^\]]+\]\s*:\s*/, '').replace(/\s*-\s*\w+$/, '');
            const issueShort = test.rootCause !== 'Unknown' 
              ? test.rootCause.substring(0, 80) 
              : test.errorMsg.substring(0, 80);
            
            // Get video URL for evidence
            const sessions = await this.getAllSessionsWithArtifacts(testRunId, test.testId, resolvedProjectId!);
            const videoLink = sessions.length > 0 && sessions[0].videos.length > 0 
              ? `[Video](${sessions[0].videos[0].url})` 
              : 'N/A';
            
            report += `| [${testNameShort}](${testUrl}) | ${test.stability}% | ${issueShort} | ${videoLink} |\n`;
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
              
              // Show full error message
              if (detail.errorMsg && detail.errorMsg !== 'No error message') {
                report += `\n**Error Message:**\n`;
                report += `\`\`\`\n${detail.errorMsg.substring(0, 300)}${detail.errorMsg.length > 300 ? '...' : ''}\n\`\`\`\n`;
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
}
