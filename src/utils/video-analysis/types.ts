/**
 * Type definitions for video analysis
 */

export interface TestSessionVideo {
  sessionId: string;
  videoUrl: string;
  projectId: number;
  sessionStart?: string;
  sessionEnd?: string;
  platformName?: string;
  deviceName?: string;
  status?: string;
}

export interface VideoMetadata {
  videoUrl: string;
  sessionId: string;
  sessionStart?: string;
  sessionEnd?: string;
  videoDuration: number;
  extractedFrames: number;
  videoResolution: string;
  downloadSuccess: boolean;
  localVideoPath?: string;
  platformName?: string;
  deviceName?: string;
  status?: string;
}

export interface ExtractedFrame {
  timestamp: number;
  frameNumber: number;
  localPath: string;
  base64?: string;
}

export interface FrameAnalysis {
  timestamp: number;
  frameNumber: number;
  imageBase64?: string;
  ocrText?: string;
  visualAnalysis: string;
  detectedElements: string[];
  appState: string;
  anomaliesDetected: string[];
}

// Alias for backward compatibility
export type AnalyzedFrame = FrameAnalysis;

export interface LogStep {
  stepNumber: number;
  timestamp: string;
  action: string;
  result: string;
  logLevel: string;
}

export interface VideoStep {
  stepNumber: number;
  timestamp: number;
  inferredAction: string;
  screenTransition: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface CorrelatedStep {
  logStep: number;
  videoTimestamp: number;
  match: boolean;
  discrepancy?: string;
}

export interface TestCaseStep {
  stepNumber: number;
  expectedAction: string;
  expectedResult: string;
}

export interface TestCaseComparison {
  testCaseKey: string;
  testCaseTitle: string;
  testCaseSteps: TestCaseStep[];
  
  coverageAnalysis: {
    totalSteps: number;
    executedSteps: number;
    skippedSteps: number[];
    extraSteps: number[];
    coveragePercentage: number;
  };
  
  stepByStepComparison: Array<{
    testCaseStep: number;
    expectedAction: string;
    actualExecution: string;
    videoTimestamp?: number;
    logReference?: string;
    match: boolean;
    deviation?: string;
  }>;
}

export interface FailureAnalysis {
  failureTimestamp: string;
  failureVideoTimestamp?: number;
  failureType: string;
  errorMessage: string;
  stackTrace: string;
  
  failureFrames: Array<{
    timestamp: number;
    description: string;
    visualState: string;
  }>;
  
  rootCause: {
    category: 'app_bug' | 'test_issue' | 'environment_issue' | 'data_issue' | 'unclear';
    confidence: number;
    reasoning: string;
    evidence: string[];
  };
}

export interface Prediction {
  verdict: 'bug' | 'test_needs_update' | 'infrastructure_issue' | 'data_issue' | 'unclear';
  confidence: number;
  reasoning: string;
  
  evidenceForBug: string[];
  evidenceForTestUpdate: string[];
  
  recommendations: Array<{
    type: 'bug_report' | 'test_update' | 'infrastructure_fix' | 'investigation';
    priority: 'high' | 'medium' | 'low';
    description: string;
    actionItems: string[];
  }>;
}

export interface SimilarFailure {
  testId: number;
  testName: string;
  similarity: number;
  commonPatterns: string[];
}

export interface VideoAnalysisParams {
  testId: number;
  testRunId: number;
  projectKey?: string;
  projectId?: number;
  
  // Video Analysis Options
  extractionMode: 'failure_focused' | 'full_test' | 'smart';
  frameInterval?: number;
  failureWindowSeconds?: number;
  
  // Test Case Comparison
  compareWithTestCase: boolean;
  testCaseKey?: string;
  
  // Analysis Depth
  includeOCR: boolean;
  analyzeSimilarFailures: boolean;
  includeLogCorrelation: boolean;
  
  // Output Format
  format: 'detailed' | 'summary' | 'jira';
  generateVideoReport: boolean;
}

export interface ExecutionFlow {
  stepsFromLogs: LogStep[];
  stepsFromVideo: VideoStep[];
  correlatedSteps: CorrelatedStep[];
}

export interface AnalysisLinks {
  videoUrl: string;
  testUrl: string;
  testCaseUrl?: string;
  relatedJiraIssues?: string[];
}

export interface VideoAnalysisResult {
  videoMetadata: VideoMetadata;
  frames: FrameAnalysis[];
  executionFlow: ExecutionFlow;
  testCaseComparison?: TestCaseComparison;
  failureAnalysis: FailureAnalysis;
  prediction: Prediction;
  similarFailures?: SimilarFailure[];
  summary: string;
  links: AnalysisLinks;
}

export interface VideoDownloadResult {
  success: boolean;
  localPath?: string;
  duration?: number;
  resolution?: string;
  sessionId?: string;
  fileSize?: number;
  error?: string;
}

export interface FrameExtractionOptions {
  failureTimestamp?: number;
  failureWindow?: number;
  interval?: number;
  logTimestamps?: number[];
  maxFrames?: number;
}

