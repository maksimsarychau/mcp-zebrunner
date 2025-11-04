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

      // Step 3: Determine frame extraction strategy based on video duration
      // Note: Video length ≠ test execution time (video may start late, end early, have gaps)
      // So we extract frames throughout the video + extra at the end (where failures typically occur)
      
      let frames: any[] = [];
      
      // Determine frame extraction settings based on analysis depth
      const { shouldExtractFrames, extractionMode, includeOCR, minFrames, maxFrames } = this.getFrameExtractionSettings(params.analysisDepth);
      
      let frameExtractionError: string | undefined;
      
      if (shouldExtractFrames) {
        try {
          const videoDuration = downloadResult.duration || 0;
          
          if (this.debug) {
            console.error(`[VideoAnalyzer] Starting frame extraction: mode=smart_distributed, minFrames=${minFrames}, maxFrames=${maxFrames}, duration=${videoDuration}s`);
            console.error(`[VideoAnalyzer] Note: Extracting frames throughout video + extra frames in last 30s (where failures typically occur)`);
          }
          
          // Use test timing as hints only (not for exact frame timestamps)
          const testDurationHint = this.calculateTestDurationHint(test);
          
          frames = await this.extractor.extractFrames(
            videoPath,
            videoDuration,
            'smart', // Always use smart mode (distributed + end-focused)
            undefined, // Don't pass calculated failure timestamp - let it use end of video
            30, // Always extract extra frames in last 30 seconds
            params.frameInterval,
            includeOCR || params.includeOCR  // Allow manual override
          );

          // Limit frames based on analysis depth (max)
          if (frames.length > maxFrames) {
            if (this.debug) {
              console.error(`[VideoAnalyzer] Limiting frames from ${frames.length} to ${maxFrames} for ${params.analysisDepth} mode`);
            }
            frames = frames.slice(0, maxFrames);
          }

          if (this.debug) {
            console.error(`[VideoAnalyzer] ✅ Extracted ${frames.length} frames (${params.analysisDepth} mode)`);
          }

          // Enforce minimum frames for visual analysis
          if (frames.length < minFrames && minFrames > 0) {
            frameExtractionError = `Frame extraction produced only ${frames.length} frames (minimum required: ${minFrames}). Possible causes: video too short, extraction failed, or FFmpeg issues.`;
            console.error(`[VideoAnalyzer] ⚠️  ${frameExtractionError}`);
          } else if (frames.length === 0) {
            frameExtractionError = `Frame extraction completed but produced 0 frames. Possible causes: video too short, invalid timestamps, or FFmpeg extraction issues.`;
            console.error(`[VideoAnalyzer] ⚠️  ${frameExtractionError}`);
          }
        } catch (frameError: any) {
          frameExtractionError = `Frame extraction failed: ${frameError.message || frameError}`;
          console.error(`[VideoAnalyzer] ❌ ${frameExtractionError}`);
          console.error(`[VideoAnalyzer] Continuing with text-only analysis (logs, test case comparison, predictions)`);
          frames = []; // Continue with empty frames array
        }
      } else {
        if (this.debug) {
          console.error(`[VideoAnalyzer] Skipping frame extraction (${params.analysisDepth} mode)`);
        }
        frameExtractionError = `Frame extraction skipped (analysisDepth: ${params.analysisDepth})`;
      }

      // Step 4: Fetch logs and parse execution steps
      const logsResponse = await this.reportingClient.getTestLogsAndScreenshots(params.testRunId, params.testId, { maxPageSize: 1000 });
      const logItems = logsResponse.items.filter(item => item.kind === 'log');
      const logSteps = this.parseLogsToSteps(logItems);

      if (this.debug) {
        console.log(`[VideoAnalyzer] Parsed ${logSteps.length} log steps`);
      }

      // Step 5: Analyze failure
      // Assume failure is near the end of video (most common case)
      // Use last 30 seconds as the failure window for frame correlation
      const estimatedFailureTimestamp = Math.max(0, (downloadResult.duration || 0) - 15); // 15s before end
      const failureAnalysis = this.analyzeFailure(test, logItems, frames, estimatedFailureTimestamp);

      // Step 6: Compare with test cases (if enabled) WITH VISUAL VERIFICATION
      // NEW: Support for MULTIPLE test cases!
      let testCaseComparison = null;
      let multiTestCaseComparison = null;
      
      if (params.compareWithTestCase && this.comparator && test.testCases && test.testCases.length > 0) {
        // Collect ALL test case keys (not just first one!)
        const testCaseKeys: string[] = [];
        
        if (params.testCaseKey) {
          // User provided specific test case key
          testCaseKeys.push(params.testCaseKey);
        } else {
          // Use all test cases assigned to test
          for (const tc of test.testCases) {
            if (tc.testCaseId) {
              testCaseKeys.push(tc.testCaseId);
            }
          }
        }
        
        if (testCaseKeys.length > 0) {
          if (this.debug) {
            console.log(`[VideoAnalyzer] Found ${testCaseKeys.length} test case(s): ${testCaseKeys.join(', ')}`);
          }
          
          if (testCaseKeys.length === 1) {
            // Single test case - use legacy comparison
            if (this.debug) {
              console.log(`[VideoAnalyzer] Starting single test case comparison with visual verification (${frames.length} frames)`);
            }
            
            testCaseComparison = await this.comparator.compareWithTestCase(
              testCaseKeys[0],
              projectKey,
              logSteps,
              frames
            );
          } else {
            // Multiple test cases - use NEW multi-TC comparison
            if (this.debug) {
              console.log(`[VideoAnalyzer] Starting MULTI test case comparison with visual verification (${frames.length} frames)`);
            }
            
            const baseUrl = this.reportingClient['config'].baseUrl;
            multiTestCaseComparison = await this.comparator.compareWithMultipleTestCases(
              testCaseKeys,
              projectKey,
              logSteps,
              frames,
              baseUrl  // Pass baseUrl for building clickable TC URLs
            );
          }
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
        status: videoInfo.status,
        frameExtractionError
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
        testCaseComparison: testCaseComparison || undefined,  // Legacy: single test case
        multiTestCaseComparison: multiTestCaseComparison || undefined,  // NEW: multiple test cases
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
   * Get frame extraction settings based on analysis depth
   */
  private getFrameExtractionSettings(analysisDepth: 'quick_text_only' | 'standard' | 'detailed'): {
    shouldExtractFrames: boolean;
    extractionMode: 'failure_focused' | 'full_test' | 'smart';
    includeOCR: boolean;
    minFrames: number;
    maxFrames: number;
  } {
    switch (analysisDepth) {
      case 'quick_text_only':
        // Quick text-only mode: No frames, fastest analysis
        return {
          shouldExtractFrames: false,
          extractionMode: 'failure_focused',
          includeOCR: false,
          minFrames: 0,
          maxFrames: 0
        };
      
      case 'standard':
        // Standard mode: 8-12 frames (failure + coverage), no OCR, balanced speed/insight
        return {
          shouldExtractFrames: true,
          extractionMode: 'failure_focused',
          includeOCR: false,
          minFrames: 5,  // Minimum frames always
          maxFrames: 12
        };
      
      case 'detailed':
        // Detailed mode: 20-30 frames with smart selection + OCR
        return {
          shouldExtractFrames: true,
          extractionMode: 'smart',
          includeOCR: true,
          minFrames: 10,
          maxFrames: 30
        };
      
      default:
        return {
          shouldExtractFrames: true,
          extractionMode: 'failure_focused',
          includeOCR: false,
          minFrames: 5,
          maxFrames: 12
        };
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
  private analyzeFailure(test: any, logItems: any[], frames: any[], failureVideoTimestamp: number | undefined): FailureAnalysis {
    // Priority 1: Parse stack trace from logs (most reliable source)
    const stackTraceInfo = this.parseStackTrace(logItems);
    
    // Priority 2: Find closest frames to failure for visual correlation
    const closestFrames = this.findClosestFrames(failureVideoTimestamp, frames, 3);
    
    // Priority 3: Use parsed stack trace for failure classification
    const errorMessage = stackTraceInfo.errorMessage || test.reason || 'Unknown error';
    const failureType = stackTraceInfo.failureType || 'Unknown';
    const stackTrace = stackTraceInfo.fullStackTrace || '';
    
    // Get failure timestamp (ISO string for absolute time)
    const failureTimestamp = test.finishTime 
      ? (typeof test.finishTime === 'number' ? new Date(test.finishTime).toISOString() : test.finishTime)
      : new Date().toISOString();
    
    // Build failure frames with visual correlation
    const failureFrames = closestFrames.map(frame => ({
      timestamp: frame.timestamp,
      description: frame.visualAnalysis || 'Frame analysis pending',
      visualState: frame.appState || 'Unknown state'
    }));

    // Analyze root cause with stack trace context
    const rootCause = this.analyzeRootCause(
      errorMessage,
      failureType,
      stackTrace,
      stackTraceInfo,
      closestFrames
    );

    return {
      failureTimestamp,
      failureVideoTimestamp,
      failureType,
      errorMessage,
      stackTrace,
      failureFrames,
      rootCause
    };
  }

  /**
   * Parse Java stack trace from logs to extract failure details
   */
  private parseStackTrace(logItems: any[]): {
    errorMessage: string;
    failureType: string;
    locator?: string;
    failingMethod?: string;
    exceptionClass?: string;
    fullStackTrace: string;
  } {
    // Find ERROR level logs first
    const errorLogs = logItems.filter(log => log.level === 'ERROR');
    const allLogs = errorLogs.length > 0 ? errorLogs : logItems;
    
    // Combine all log messages to build full stack trace
    let fullStackTrace = '';
    let errorMessage = '';
    let failureType = 'Unknown';
    let locator: string | undefined;
    let failingMethod: string | undefined;
    let exceptionClass: string | undefined;
    
    for (const log of allLogs) {
      const message = log.value || '';
      fullStackTrace += message + '\n';
      
      // Pattern 1: Extract test failure message (TEST [...] FAILED at [...])
      const testFailedMatch = message.match(/TEST \[.*?\] FAILED at \[.*?\] - (.*?)(?:\n|$)/);
      if (testFailedMatch && !errorMessage) {
        errorMessage = testFailedMatch[1].trim();
      }
      
      // Pattern 2: Extract locator information (Locator:... By.xpath:...)
      const locatorMatch = message.match(/Locator:(\w+)\s*\(By\.(\w+):\s*(.+?)\)/);
      if (locatorMatch && !locator) {
        locator = `${locatorMatch[2]}=${locatorMatch[3]}`;
      }
      
      // Pattern 3: Extract failing method from stack trace
      const methodMatch = message.match(/at\s+([\w.]+\.[\w]+)\([\w.]+:\d+\)/);
      if (methodMatch && !failingMethod) {
        failingMethod = methodMatch[1];
      }
      
      // Pattern 4: Extract exception class
      const exceptionMatch = message.match(/([\w.]+Exception|[\w.]+Error|org\.testng\.Assert\.\w+)/);
      if (exceptionMatch && !exceptionClass) {
        exceptionClass = exceptionMatch[1];
      }
    }
    
    // Fallback: Use last log message if no structured error found
    if (!errorMessage && allLogs.length > 0) {
      errorMessage = allLogs[allLogs.length - 1].value || 'Unknown error';
    }
    
    // Filter out framework noise from error message
    if (errorMessage.includes('Your retry_interval is too low')) {
      // Look for actual error before the noise
      const realErrorMatch = fullStackTrace.match(/TEST \[.*?\] FAILED.*? - ((?:(?!retry_interval).)*?)(?:Your retry_interval|$)/s);
      if (realErrorMatch) {
        errorMessage = realErrorMatch[1].trim();
      }
    }
    
    // Classify failure type based on error message and stack trace
    const errorLower = errorMessage.toLowerCase();
    if (errorLower.includes('not found') || errorLower.includes("wasn't found")) {
      failureType = 'Element Not Found';
    } else if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
      failureType = 'Timeout';
    } else if (errorLower.includes('assertion') || exceptionClass?.includes('Assert')) {
      failureType = 'Assertion Failed';
    } else if (errorLower.includes('crash') || errorLower.includes('anr')) {
      failureType = 'Application Crash';
    } else if (errorLower.includes('network') || errorLower.includes('connection')) {
      failureType = 'Network Error';
    } else if (errorLower.includes('stale element')) {
      failureType = 'Stale Element';
    } else if (exceptionClass) {
      failureType = exceptionClass.split('.').pop() || 'Unknown';
    }
    
    return {
      errorMessage: errorMessage || 'Unknown error',
      failureType,
      locator,
      failingMethod,
      exceptionClass,
      fullStackTrace: fullStackTrace.trim()
    };
  }

  /**
   * Calculate test duration as a hint (for logging/context only)
   * Note: This is NOT used for frame extraction since video time ≠ test execution time
   */
  private calculateTestDurationHint(test: any): { testDuration?: number; confidence: 'high' | 'low' } {
    if (!test.startTime || !test.finishTime) {
      return { confidence: 'low' };
    }
    
    try {
      const startMs = typeof test.startTime === 'number' 
        ? test.startTime 
        : new Date(test.startTime).getTime();
        
      const finishMs = typeof test.finishTime === 'number'
        ? test.finishTime
        : new Date(test.finishTime).getTime();
      
      const testDuration = Math.floor((finishMs - startMs) / 1000);
      
      return {
        testDuration: testDuration > 0 ? testDuration : undefined,
        confidence: testDuration > 0 ? 'high' : 'low'
      };
    } catch (error) {
      return { confidence: 'low' };
    }
  }

  /**
   * Calculate failure timestamp relative to video start (in seconds)
   * Handles both ISO strings and numeric timestamps
   * DEPRECATED: Use video-based estimation instead (failure typically near end)
   */
  private calculateFailureTimestampInVideo(test: any, videoDuration: number): number | undefined {
    if (!test.startTime || !test.finishTime) {
      // No timing info, default to end of video
      return Math.max(0, videoDuration - 30); // 30s before end
    }
    
    try {
      // Convert both to milliseconds timestamps
      const startMs = typeof test.startTime === 'number' 
        ? test.startTime 
        : new Date(test.startTime).getTime();
        
      const finishMs = typeof test.finishTime === 'number'
        ? test.finishTime
        : new Date(test.finishTime).getTime();
      
      // Calculate seconds from start
      const videoTimestamp = Math.floor((finishMs - startMs) / 1000);
      
      // Ensure timestamp is within video bounds
      if (videoTimestamp < 0) return 0;
      if (videoTimestamp > videoDuration) {
        // Failure timestamp is beyond video end, use last 30 seconds
        if (this.debug) {
          console.error(`[VideoAnalyzer] Failure timestamp ${videoTimestamp}s exceeds video duration ${videoDuration}s. Using last 30s of video.`);
        }
        return Math.max(0, videoDuration - 30);
      }
      
      return videoTimestamp;
      
    } catch (error) {
      if (this.debug) {
        console.error('[VideoAnalyzer] Error calculating video timestamp:', error);
      }
      // Fallback to end of video
      return Math.max(0, videoDuration - 30);
    }
  }

  /**
   * Find N closest frames to a given timestamp
   */
  private findClosestFrames(timestamp: number | undefined, frames: any[], count: number = 3): any[] {
    if (!timestamp || frames.length === 0) return [];
    
    const sorted = [...frames].sort((a, b) => 
      Math.abs(a.timestamp - timestamp) - Math.abs(b.timestamp - timestamp)
    );
    
    return sorted.slice(0, count);
  }

  /**
   * Investigate "Element Not Found" failures using visual frame analysis
   * Provides specific diagnosis of WHY element wasn't found
   */
  private investigateElementNotFound(
    errorMessage: string,
    locator: string | undefined,
    closestFrames: any[]
  ): {
    suggestedCategory: 'app_bug' | 'test_issue' | 'environment_issue' | 'data_issue' | 'unclear';
    confidence: number;
    findings: string[];
    visualDiagnosis: string;
  } {
    const findings: string[] = [];
    let suggestedCategory: 'app_bug' | 'test_issue' | 'environment_issue' | 'data_issue' | 'unclear' = 'test_issue';
    let confidence = 75; // Default for element not found
    let visualDiagnosis = '';

    if (closestFrames.length === 0) {
      visualDiagnosis = 'No frames available for visual investigation';
      findings.push('Unable to verify visually - no frames extracted near failure');
      return { suggestedCategory, confidence, findings, visualDiagnosis };
    }

    // Extract element name from error message (e.g., "Diary button", "Add Food button")
    const elementNameMatch = errorMessage.match(/(?:button|element|field|link|menu|icon)\s+['"]?(\w+)['"]?/i);
    const elementName = elementNameMatch ? elementNameMatch[1] : 'element';

    // Analyze frames for common "Element Not Found" scenarios
    const frameAnalysis = {
      hasLoadingState: false,
      hasModal: false,
      hasPopup: false,
      differentScreen: false,
      elementMentioned: false,
      hasError: false,
      appState: closestFrames[0]?.appState || 'Unknown'
    };

    // Check each frame for visual clues
    for (const frame of closestFrames) {
      const visualDesc = (frame.visualAnalysis || '').toLowerCase();
      const appState = (frame.appState || '').toLowerCase();
      const ocrText = (frame.ocrText || '').toLowerCase();

      // Check for loading states
      if (visualDesc.includes('loading') || visualDesc.includes('please wait') || 
          ocrText.includes('loading') || ocrText.includes('please wait')) {
        frameAnalysis.hasLoadingState = true;
      }

      // Check for modals/popups/overlays
      if (visualDesc.includes('modal') || visualDesc.includes('popup') || 
          visualDesc.includes('dialog') || visualDesc.includes('overlay')) {
        frameAnalysis.hasModal = true;
      }

      // Check if element name is mentioned in OCR/visual analysis
      if (ocrText.includes(elementName.toLowerCase()) || 
          visualDesc.includes(elementName.toLowerCase())) {
        frameAnalysis.elementMentioned = true;
      }

      // Check for error messages in app
      if (visualDesc.includes('error') || ocrText.includes('error') ||
          ocrText.includes('failed') || ocrText.includes('unable')) {
        frameAnalysis.hasError = true;
      }
    }

    // Build diagnosis based on visual clues
    if (frameAnalysis.hasLoadingState) {
      visualDiagnosis = 'App was in loading state when locator was checked. Test may need to wait for loading to complete before searching for element.';
      suggestedCategory = 'test_issue';
      confidence = 85;
      findings.push('🔍 Loading/waiting screen detected in frames - timing issue');
      findings.push('Recommendation: Add explicit wait for loading to complete');
    } else if (frameAnalysis.hasModal) {
      visualDiagnosis = 'Modal, popup, or overlay was present on screen. Element may be obscured or on a different UI layer.';
      suggestedCategory = 'test_issue';
      confidence = 80;
      findings.push('🔍 Modal/popup detected - element may be covered or inaccessible');
      findings.push('Recommendation: Dismiss modal/popup before searching for element');
    } else if (frameAnalysis.elementMentioned && locator) {
      visualDiagnosis = `Element "${elementName}" appears to be visible in frames, but locator failed. This suggests the locator strategy (${locator}) may be incorrect or the element structure changed.`;
      suggestedCategory = 'test_issue';
      confidence = 90;
      findings.push(`🔍 Element "${elementName}" visible in UI but locator failed`);
      findings.push('Recommendation: Update locator strategy or check if element attributes changed');
    } else if (frameAnalysis.hasError) {
      visualDiagnosis = 'App displayed error message. Element may not be rendered due to application error or unexpected state.';
      suggestedCategory = 'app_bug';
      confidence = 70;
      findings.push('🔍 App error detected in frames - element may not render due to app issue');
      findings.push('Possible app bug preventing element from appearing');
    } else {
      // Generic analysis based on app state
      const stateDesc = frameAnalysis.appState;
      visualDiagnosis = `App was on "${stateDesc}" screen. Element may not exist on this screen, or app navigated to wrong screen.`;
      suggestedCategory = 'test_issue';
      confidence = 75;
      findings.push(`🔍 App state: "${stateDesc}" - verify element should exist on this screen`);
      findings.push('Possible issues: Wrong navigation path, UI redesign, or element moved to different screen');
    }

    return {
      suggestedCategory,
      confidence,
      findings,
      visualDiagnosis
    };
  }

  /**
   * Analyze root cause of failure with comprehensive context
   */
  private analyzeRootCause(
    errorMessage: string,
    failureType: string,
    stackTrace: string,
    stackTraceInfo: any,
    closestFrames: any[]
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

    // Priority 1: Analyze based on failure type from stack trace
    if (failureType === 'Element Not Found' || errorLower.includes("wasn't found")) {
      // Perform visual investigation of frames to understand WHY element wasn't found
      const visualInvestigation = this.investigateElementNotFound(
        errorMessage,
        stackTraceInfo.locator,
        closestFrames
      );
      
      category = visualInvestigation.suggestedCategory;
      confidence = visualInvestigation.confidence;
      
      evidence.push(`Element locator failed: ${stackTraceInfo.locator || 'unknown locator'}`);
      
      if (stackTraceInfo.failingMethod) {
        evidence.push(`Failed in method: ${stackTraceInfo.failingMethod}`);
      }
      
      // Add visual investigation findings
      evidence.push(...visualInvestigation.findings);
      
      // Update reasoning with visual context
      if (visualInvestigation.visualDiagnosis) {
        evidence.push(`Visual diagnosis: ${visualInvestigation.visualDiagnosis}`);
      }
    }
    // Stale element reference (test synchronization issue)
    else if (failureType === 'Stale Element' || errorLower.includes('stale element')) {
      category = 'test_issue';
      confidence = 80;
      evidence.push('Stale element reference - test synchronization issue');
      evidence.push('Element was found but became stale before interaction');
    }
    // Timeout issues (could be test or environment)
    else if (failureType === 'Timeout' || errorLower.includes('timeout') || errorLower.includes('timed out')) {
      // Check if it's a test wait issue or app performance issue
      if (errorLower.includes('element') || errorLower.includes('condition')) {
        category = 'test_issue';
        confidence = 75;
        evidence.push('Test wait condition timeout - may need longer timeout or better wait strategy');
      } else {
        category = 'environment_issue';
        confidence = 70;
        evidence.push('General timeout - possible environment or app performance issue');
      }
    }
    // Application crashes (definite app bug)
    else if (failureType === 'Application Crash' || errorLower.includes('crash') || errorLower.includes('anr')) {
      category = 'app_bug';
      confidence = 95;
      evidence.push('Application crashed during test execution');
      
      if (closestFrames.length > 0) {
        evidence.push(`App state before crash: ${closestFrames[0].appState || 'unknown'}`);
      }
    }
    // Assertion failures (could be app bug or test issue)
    else if (failureType === 'Assertion Failed' || errorLower.includes('assertion')) {
      // Need more context to determine if it's app or test issue
      if (errorLower.includes('expected') && errorLower.includes('actual')) {
        category = 'app_bug';
        confidence = 70;
        evidence.push('Assertion failed - actual value differs from expected');
      } else {
        category = 'unclear';
        confidence = 60;
        evidence.push('Assertion failed - need to verify expected vs actual behavior');
      }
    }
    // NullPointer and other exceptions (app bugs)
    else if (errorLower.includes('nullpointer') || errorLower.includes('nullreferenceexception')) {
      category = 'app_bug';
      confidence = 90;
      evidence.push('NullPointer exception - application bug');
    }
    // Network/connection issues (environment)
    else if (failureType === 'Network Error' || errorLower.includes('network') || errorLower.includes('connection')) {
      category = 'environment_issue';
      confidence = 75;
      evidence.push('Network or connectivity issue detected');
    }

    // Build detailed reasoning with stack trace context
    let reasoning = `Failure type: "${failureType}". `;
    reasoning += `Root cause: ${errorMessage.substring(0, 150)}`;
    
    if (stackTraceInfo.locator) {
      reasoning += `. Locator: ${stackTraceInfo.locator}`;
    }
    
    if (stackTraceInfo.failingMethod) {
      reasoning += `. Failed in: ${stackTraceInfo.failingMethod}`;
    }

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

