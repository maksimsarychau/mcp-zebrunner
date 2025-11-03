import { z } from "zod";
import { ZebrunnerReportingClient } from "../api/reporting-client.js";
import { EnhancedZebrunnerClient } from "../api/enhanced-client.js";
import { FormatProcessor } from "../utils/formatter.js";
import { GetLauncherDetailsInputSchema } from "../types/api.js";

/**
 * MCP Tool handlers for Zebrunner Reporting API
 */
export class ZebrunnerReportingToolHandlers {
  constructor(
    private reportingClient: ZebrunnerReportingClient,
    private tcmClient?: EnhancedZebrunnerClient
  ) {}

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
    const testSessionUrl = `${baseUrl}/tests/runs/${testRunId}/results/${testId}`;
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
    report += `- **Test ID:** ${testId}\n`;
    report += `- **Launch ID:** ${testRunId}\n`;
    report += `- **Test Class:** ${testRun.testClass || 'Unknown'}\n`;
    report += `- **Duration:** ${Math.floor(duration / 60)}m ${duration % 60}s\n`;
    report += `- **Started:** ${new Date(testRun.startTime).toISOString()}\n`;
    report += `- **Finished:** ${testRun.finishTime ? new Date(testRun.finishTime).toISOString() : 'N/A'}\n`;
    report += `- **Owner:** ${testRun.owner || 'Unknown'}\n\n`;

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

    // Screenshots with optional AI analysis
    if (screenshots.length > 0) {
      report += `## 📸 Screenshots\n\n`;
      report += `**Total Screenshots:** ${screenshots.length}\n\n`;
      
      const latestScreenshot = screenshots[screenshots.length - 1];
      if (latestScreenshot) {
        report += `### Latest Screenshot Before Failure\n\n`;
        report += `- **Timestamp:** ${new Date(latestScreenshot.timestamp).toLocaleTimeString()}\n`;
        report += `- **URL:** [View Screenshot](${baseUrl}${latestScreenshot.url})\n\n`;
        
        // AI-powered screenshot analysis if requested
        if (analyzeScreenshotsWithAI) {
          try {
            const enableOCR = screenshotAnalysisType === 'detailed';
            
            report += `#### 🤖 AI-Powered Visual Analysis\n\n`;
            report += `*Analyzing screenshot with ${screenshotAnalysisType} analysis...*\n\n`;
            
            const screenshotAnalysisResult = await this.analyzeScreenshotTool({
              screenshotUrl: `${baseUrl}${latestScreenshot.url}`,
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

      if (screenshots.length > 1) {
        report += `### All Screenshots\n\n`;
        screenshots.slice(-5).forEach((screenshot, idx) => {
          report += `${idx + 1}. [Screenshot at ${new Date(screenshot.timestamp).toLocaleTimeString()}](${baseUrl}${screenshot.url})\n`;
        });
        report += `\n`;
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
    report += `- **[Test Session](${testSessionUrl})**\n`;
    report += `- **[Launch](${launchUrl})**\n`;
    
    // Video link with prominent emoji
    const videoUrl = await this.getVideoUrlForTest(testRunId, testId, projectId);
    if (videoUrl) {
      report += `- **[🎥 Test Execution Video](${videoUrl})**\n`;
    }
    
    if (screenshots.length > 0) {
      report += `- **[Latest Screenshot](${baseUrl}${screenshots[screenshots.length - 1].url})**\n`;
    }
    
    // Test Case Links
    if (testRun.testCases && testRun.testCases.length > 0) {
      for (const tc of testRun.testCases) {
        const tcUrl = await this.buildTestCaseUrl(tc.testCaseId, projectKey!, baseUrl);
        report += `- **[📋 Test Case ${tc.testCaseId}](${tcUrl})**\n`;
      }
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
    report += `**Status:** ❌ ${testRun.status}\n`;
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

    // Video link
    const videoUrl = await this.getVideoUrlForTest(testRunId, testId, projectId);
    if (videoUrl) {
      report += `**🎥 Video:** [Watch Test Execution](${videoUrl})\n`;
    }
    
    if (screenshots.length > 0) {
      report += `**Screenshots:** ${screenshots.length} available\n`;
    }

    if (similarFailures.length > 0) {
      report += `**Similar Failures:** ${similarFailures.length} found in this launch\n`;
    }

    report += `\n**[View Full Details](${testSessionUrl})**\n`;

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
   * Get video URL from test sessions artifacts
   * Returns the Zebrunner proxy URL (no redirect resolution needed)
   */
  private async getVideoUrlForTest(testRunId: number, testId: number, projectId: number): Promise<string | null> {
    try {
      const sessions = await this.reportingClient.getTestSessionsForTest(testRunId, testId, projectId);
      
      if (!sessions.items || sessions.items.length === 0) {
        return null;
      }
      
      // Get the first session (usually there's only one per test)
      const session = sessions.items[0];
      
      // Find video artifact reference
      const videoArtifact = session.artifactReferences?.find(
        (ref: any) => ref.name === 'Video'
      );
      
      if (videoArtifact && videoArtifact.value) {
        // Construct full URL from relative path
        const baseUrl = this.reportingClient['config'].baseUrl;
        return `${baseUrl}/${videoArtifact.value}`;
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

    let jiraContent = `h1. ${title}\n\n`;
    jiraContent += `||Field||Value||\n`;
    jiraContent += `|Priority|${priority}|\n`;
    jiraContent += `|Labels|${labels.join(', ')}|\n`;
    jiraContent += `|Test ID|${testId}|\n`;
    jiraContent += `|Launch ID|${testRunId}|\n`;
    jiraContent += `|Launch Name|${launchName}|\n`;
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
    const launchUrl = `${baseUrl}/projects/${projectKey}/automation-launches/${testRunId}`;
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
      jiraContent += `[View all logs|${baseUrl}/tests/runs/${testRunId}/results/${testId}]\n\n`;
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
        jiraContent += `* [Test ${failure.testId}|${baseUrl}/tests/runs/${testRunId}/results/${failure.testId}]: ${failure.testName} (${failure.stability}% stability)\n`;
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
    jiraContent += `* [View Test in Zebrunner|${baseUrl}/tests/runs/${testRunId}/results/${testId}]\n`;
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
        const testSessionUrl = `${baseUrl}/tests/runs/${testRunId}/results/${test.id}`;
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
          combinedTicket += `h3. ${idx + 1}. ${test.testName} (ID: ${test.testId})\n\n`;
          combinedTicket += `* [View Test|${baseUrl}/tests/runs/${testRunId}/results/${test.testId}]\n`;
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
            jiraContent += `* [Test ${test.testId}|${baseUrl}/tests/runs/${testRunId}/results/${test.testId}]: ${test.testName} (${test.stability}% stability)\n`;
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
        jiraContent += `h4. ${idx + 1}. [Test ${result.testId}|${baseUrl}/tests/runs/${testRunId}/results/${result.testId}]: ${result.testName}\n\n`;
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

      let report = `# 🔍 Launch Failure Analysis Report\n\n`;
      report += `**Launch ID:** ${testRunId}\n`;
      report += `**Launch Name:** ${launch.name || 'N/A'}\n`;
      report += `**Analysis Date:** ${new Date().toLocaleString()}\n\n`;
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
            tests.forEach(test => {
              report += `- Test ${test.testId}: ${test.testName}\n`;
            });
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
          highPriority.forEach(([rec, data], idx) => {
            report += `**${idx + 1}. ${rec.replace(/^\d+\.\s*/, '')}**\n`;
            report += `   - **Impact:** ${data.count} test${data.count > 1 ? 's' : ''} affected\n`;
            report += `   - **Category:** ${data.classification}\n`;
            report += `   - **Tests:**\n`;
            data.tests.slice(0, 5).forEach(t => {
              const detail = testDetails.get(t.testId);
              report += `     - Test ${t.testId}: ${t.testName} (${detail?.stability || 0}% stability)\n`;
            });
            if (data.tests.length > 5) {
              report += `     - ... and ${data.tests.length - 5} more tests\n`;
            }
            report += `\n`;
          });
        }

        if (mediumPriority.length > 0) {
          report += `### 🟡 MEDIUM Priority (Affects 2+ Tests)\n\n`;
          mediumPriority.slice(0, 3).forEach(([rec, data], idx) => {
            report += `**${idx + 1}. ${rec.replace(/^\d+\.\s*/, '')}**\n`;
            report += `   - **Impact:** ${data.count} tests\n`;
            report += `   - **Category:** ${data.classification}\n`;
            report += `   - **Tests:** ${data.tests.map(t => `Test ${t.testId}`).join(', ')}\n`;
            report += `\n`;
          });
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
        
        // Make embedded test case IDs in test name clickable
        const clickableTestName = await this.makeTestCaseIDsClickable(result.testName, resolvedProjectKey!, baseUrl);
        
        report += `### ${idx + 1}. Test ${result.testId}: ${clickableTestName}\n\n`;
        report += `- **Status:** ${result.status}\n`;
        
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
}
