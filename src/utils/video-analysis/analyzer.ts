import { ZebrunnerReportingClient } from '../../api/reporting-client.js';
import { EnhancedZebrunnerClient } from '../../api/enhanced-client.js';
import { VideoDownloader } from './video-downloader.js';
import { FrameExtractor } from './frame-extractor.js';
import { TestCaseComparator } from './test-case-comparator.js';
import { PredictionEngine } from './prediction-engine.js';
import {
  VideoAnalysisParams,
  VideoAnalysisResult,
  FailureAnalysis,
  LogStep,
  VideoMetadata,
  AnalysisLinks
} from './types.js';

/**
 * VideoAnalyzer - Main orchestrator for video analysis
 * Coordinates all video analysis components
 */
export class VideoAnalyzer {
  private downloader: VideoDownloader;
  private extractor: FrameExtractor;
  private comparator: TestCaseComparator | null = null;
  private predictor: PredictionEngine;

  constructor(
    private reportingClient: ZebrunnerReportingClient,
    private tcmClient?: EnhancedZebrunnerClient,
    private debug: boolean = false
  ) {
    this.downloader = new VideoDownloader(reportingClient, debug);
    this.extractor = new FrameExtractor(debug);
    
    if (tcmClient) {
      this.comparator = new TestCaseComparator(tcmClient, debug);
    }
    
    this.predictor = new PredictionEngine(debug);
  }

  /**
   * Main method to analyze test execution video
   */
  async analyzeTestExecutionVideo(params: VideoAnalysisParams): Promise<VideoAnalysisResult> {
    let videoPath: string | undefined;
    
    try {
      if (this.debug) {
        console.log('[VideoAnalyzer] Starting video analysis for test:', params.testId);
      }

      // Step 1: Fetch test details and determine project
      const { test, projectId, projectKey } = await this.fetchTestDetails(
        params.testId,
        params.testRunId,
        params.projectKey,
        params.projectId
      );

      if (this.debug) {
        console.log(`[VideoAnalyzer] Test: ${test.name}, Project: ${projectKey} (${projectId})`);
      }

      // Step 2: Get video URL and download video
      const videoInfo = await this.downloader.getVideoUrlFromTestSessions(
        params.testId,
        params.testRunId,
        projectId
      );

      if (!videoInfo) {
        throw new Error('No video found for this test execution');
      }

      const downloadResult = await this.downloader.downloadVideo(
        videoInfo.videoUrl,
        params.testId,
        videoInfo.sessionId
      );

      if (!downloadResult.success || !downloadResult.localPath) {
        throw new Error(downloadResult.error || 'Failed to download video');
      }

      videoPath = downloadResult.localPath;

      if (this.debug) {
        console.log(`[VideoAnalyzer] Video downloaded: ${downloadResult.duration}s, ${downloadResult.resolution}`);
      }

      // Step 3: Extract frames from video
      const failureTimestamp = test.finishTime 
        ? Math.floor((new Date(test.finishTime).getTime() - new Date(test.startTime || test.finishTime).getTime()) / 1000)
        : undefined;

      const frames = await this.extractor.extractFrames(
        videoPath,
        downloadResult.duration || 0,
        params.extractionMode,
        failureTimestamp,
        params.failureWindowSeconds,
        params.frameInterval,
        params.includeOCR
      );

      if (this.debug) {
        console.log(`[VideoAnalyzer] Extracted ${frames.length} frames`);
      }

      // Step 4: Fetch logs and parse execution steps
      const logsResponse = await this.reportingClient.getTestLogsAndScreenshots(params.testRunId, params.testId, { maxPageSize: 1000 });
      const logItems = logsResponse.items.filter(item => item.kind === 'log');
      const logSteps = this.parseLogsToSteps(logItems);

      if (this.debug) {
        console.log(`[VideoAnalyzer] Parsed ${logSteps.length} log steps`);
      }

      // Step 5: Analyze failure
      const failureAnalysis = this.analyzeFailure(test, logItems, frames);

      // Step 6: Compare with test case (if enabled)
      let testCaseComparison = null;
      if (params.compareWithTestCase && this.comparator && test.testCases && test.testCases.length > 0) {
        const testCaseKey = params.testCaseKey || test.testCases[0].testCaseId;
        
        if (testCaseKey) {
          testCaseComparison = await this.comparator.compareWithTestCase(
            testCaseKey,
            projectKey,
            logSteps,
            frames.map(f => ({ timestamp: f.timestamp, action: f.visualAnalysis }))
          );
        }
      }

      // Step 7: Generate prediction
      const prediction = this.predictor.predictIssueType(
        failureAnalysis,
        testCaseComparison,
        frames,
        JSON.stringify(logItems)
      );

      // Step 8: Build video metadata
      const videoMetadata: VideoMetadata = {
        videoUrl: videoInfo.videoUrl,
        sessionId: videoInfo.sessionId,
        sessionStart: videoInfo.sessionStart,
        sessionEnd: videoInfo.sessionEnd,
        videoDuration: downloadResult.duration || 0,
        extractedFrames: frames.length,
        videoResolution: downloadResult.resolution || 'unknown',
        downloadSuccess: true,
        localVideoPath: videoPath,
        platformName: videoInfo.platformName,
        deviceName: videoInfo.deviceName,
        status: videoInfo.status
      };

      // Step 9: Build execution flow
      const executionFlow = {
        stepsFromLogs: logSteps,
        stepsFromVideo: frames.map((f, idx) => ({
          stepNumber: idx + 1,
          timestamp: f.timestamp,
          inferredAction: f.visualAnalysis || 'Frame analysis pending',
          screenTransition: f.appState || 'Unknown',
          confidence: 'medium' as const
        })),
        correlatedSteps: logSteps.map((logStep, idx) => ({
          logStep: idx + 1,
          videoTimestamp: this.findClosestFrameTimestamp(logStep.timestamp, frames),
          match: true,
          discrepancy: undefined
        }))
      };

      // Step 10: Build links
      const baseUrl = this.reportingClient['config'].baseUrl;
      const links: AnalysisLinks = {
        videoUrl: videoInfo.videoUrl,
        testUrl: `${baseUrl}/tests/runs/${params.testRunId}/results/${params.testId}`,
        testCaseUrl: testCaseComparison 
          ? `${baseUrl}/tests/cases/${testCaseComparison.testCaseKey}`
          : undefined
      };

      // Step 11: Generate summary
      const summary = this.generateSummary(
        test,
        videoMetadata,
        prediction,
        testCaseComparison
      );

      // Step 12: Cleanup
      if (videoPath) {
        this.downloader.cleanupVideo(videoPath);
      }
      this.extractor.cleanupFrames(frames);

      if (this.debug) {
        console.log('[VideoAnalyzer] Analysis complete!');
      }

      return {
        videoMetadata,
        frames,
        executionFlow,
        testCaseComparison: testCaseComparison || undefined,
        failureAnalysis,
        prediction,
        summary,
        links
      };

    } catch (error) {
      if (this.debug) {
        console.error('[VideoAnalyzer] Analysis failed:', error);
      }

      // Cleanup on error
      if (videoPath) {
        this.downloader.cleanupVideo(videoPath);
      }

      throw new Error(`Video analysis failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Fetch test details and determine project
   */
  private async fetchTestDetails(
    testId: number,
    testRunId: number,
    projectKey?: string,
    projectId?: number
  ): Promise<{
    test: any;
    projectId: number;
    projectKey: string;
  }> {
    try {
      // Determine project ID
      let resolvedProjectId = projectId;
      let resolvedProjectKey = projectKey;

      if (!resolvedProjectId && projectKey) {
        // Look up project ID from key
        resolvedProjectId = await this.reportingClient.getProjectId(projectKey);
        resolvedProjectKey = projectKey;
      } else if (resolvedProjectId && !projectKey) {
        // Look up project key from ID
        resolvedProjectKey = await this.reportingClient.getProjectKey(resolvedProjectId);
      }

      if (!resolvedProjectId) {
        throw new Error('Could not determine project ID');
      }

      // Fetch test details
      const testsResponse = await this.reportingClient.getTestRuns(
        testRunId,
        resolvedProjectId,
        { page: 1, pageSize: 1000 }
      );

      const test = testsResponse.items.find((t: any) => t.id === testId);

      if (!test) {
        throw new Error(`Test ${testId} not found in launch ${testRunId}`);
      }

      return {
        test,
        projectId: resolvedProjectId,
        projectKey: resolvedProjectKey || 'UNKNOWN'
      };

    } catch (error) {
      throw new Error(`Failed to fetch test details: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Parse logs into structured steps
   */
  private parseLogsToSteps(logItems: any[]): LogStep[] {
    const steps: LogStep[] = [];

    for (const logItem of logItems) {
      // Extract action from log value (message)
      const message = logItem.value || '';
      
      // Skip debug/trace logs
      if (logItem.level === 'DEBUG' || logItem.level === 'TRACE') {
        continue;
      }

      // Try to identify action steps
      if (this.isActionLog(message)) {
        steps.push({
          stepNumber: steps.length + 1,
          timestamp: logItem.instant,
          action: message,
          result: logItem.level === 'ERROR' ? 'Failed' : 'Success',
          logLevel: logItem.level || 'INFO'
        });
      }
    }

    return steps;
  }

  /**
   * Check if log message represents an action
   */
  private isActionLog(message: string): boolean {
    const actionKeywords = [
      'click', 'tap', 'press', 'select', 'enter', 'type', 'input',
      'open', 'close', 'navigate', 'scroll', 'swipe',
      'verify', 'check', 'assert', 'wait', 'expect'
    ];

    const lowerMessage = message.toLowerCase();
    return actionKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  /**
   * Analyze failure details
   */
  private analyzeFailure(test: any, logItems: any[], frames: any[]): FailureAnalysis {
    const failureLog = logItems.find(log => log.level === 'ERROR') || logItems[logItems.length - 1];
    
    const errorMessage = failureLog?.value || test.reason || 'Unknown error';
    const stackTrace = '';

    // Determine failure type from error message
    let failureType = 'Unknown';
    const errorLower = errorMessage.toLowerCase();
    
    if (errorLower.includes('element') && errorLower.includes('not found')) {
      failureType = 'ElementNotFound';
    } else if (errorLower.includes('timeout')) {
      failureType = 'Timeout';
    } else if (errorLower.includes('assertion')) {
      failureType = 'Assertion';
    } else if (errorLower.includes('crash') || errorLower.includes('anr')) {
      failureType = 'Crash';
    } else if (errorLower.includes('network') || errorLower.includes('connection')) {
      failureType = 'NetworkError';
    }

    // Analyze root cause
    const rootCause = this.analyzeRootCause(errorMessage, failureType, stackTrace);

    return {
      failureTimestamp: test.finishTime || new Date().toISOString(),
      failureVideoTimestamp: undefined,
      failureType,
      errorMessage,
      stackTrace,
      failureFrames: [],
      rootCause
    };
  }

  /**
   * Analyze root cause of failure
   */
  private analyzeRootCause(
    errorMessage: string,
    failureType: string,
    stackTrace: string
  ): {
    category: 'app_bug' | 'test_issue' | 'environment_issue' | 'data_issue' | 'unclear';
    confidence: number;
    reasoning: string;
    evidence: string[];
  } {
    const errorLower = errorMessage.toLowerCase();
    const evidence: string[] = [];
    let category: 'app_bug' | 'test_issue' | 'environment_issue' | 'data_issue' | 'unclear' = 'unclear';
    let confidence = 50;

    // App bug indicators
    if (failureType === 'Crash' || errorLower.includes('nullpointer') || errorLower.includes('exception')) {
      category = 'app_bug';
      confidence = 80;
      evidence.push('Application crash or exception detected');
    }
    // Test issue indicators
    else if (failureType === 'ElementNotFound' || errorLower.includes('stale element')) {
      category = 'test_issue';
      confidence = 75;
      evidence.push('Element locator issue detected');
    }
    // Environment issue indicators
    else if (errorLower.includes('connection') || errorLower.includes('timeout')) {
      category = 'environment_issue';
      confidence = 70;
      evidence.push('Network or connectivity issue detected');
    }

    const reasoning = `Failure type "${failureType}" with message "${errorMessage.substring(0, 100)}"`;

    return { category, confidence, reasoning, evidence };
  }

  /**
   * Find closest video frame timestamp to log timestamp
   */
  private findClosestFrameTimestamp(logTimestamp: string, frames: any[]): number {
    const logTime = new Date(logTimestamp).getTime();
    
    let closestFrame = frames[0];
    let minDiff = Math.abs(logTime - closestFrame?.timestamp * 1000 || Infinity);

    for (const frame of frames) {
      const diff = Math.abs(logTime - frame.timestamp * 1000);
      if (diff < minDiff) {
        minDiff = diff;
        closestFrame = frame;
      }
    }

    return closestFrame?.timestamp || 0;
  }

  /**
   * Generate summary
   */
  private generateSummary(
    test: any,
    videoMetadata: VideoMetadata,
    prediction: any,
    testCaseComparison: any
  ): string {
    const parts: string[] = [];

    parts.push(`**Test Execution Video Analysis Summary**\n`);
    parts.push(`Test: ${test.name}`);
    parts.push(`Status: ${test.status}`);
    parts.push(`Video Duration: ${videoMetadata.videoDuration}s`);
    parts.push(`Frames Analyzed: ${videoMetadata.extractedFrames}`);
    parts.push(`\n**Prediction:** ${prediction.verdict} (${prediction.confidence}% confidence)`);
    
    if (testCaseComparison) {
      parts.push(`\n**Test Case Coverage:** ${testCaseComparison.coverageAnalysis.coveragePercentage}%`);
    }

    parts.push(`\n**Recommended Action:**`);
    if (prediction.recommendations.length > 0) {
      const topRec = prediction.recommendations[0];
      parts.push(`${topRec.description} (${topRec.priority} priority)`);
    }

    return parts.join('\n');
  }
}

