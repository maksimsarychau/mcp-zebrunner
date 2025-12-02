# 🎬 Video Analysis Tool - Implementation Guide

## Status: Ready to Implement

All TypeScript type definitions and dependencies are configured. Implementation files need to be created.

## ✅ Already Complete

1. **Dependencies Added** - `package.json` updated with FFmpeg libraries
2. **Type Definitions** - `src/utils/video-analysis/types.ts` created
3. **FFprobe Types** - `src/types/ffprobe.d.ts` created  
4. **Input Schema** - `src/types/api.ts` includes `AnalyzeTestExecutionVideoInputSchema`
5. **Version & Changelog** - Updated to v5.7.0 with full changelog
6. **README** - Documentation added for video analysis tool

## 📋 Files to Create

Please create these files by copying the implementation from the previous session:

### 1. `src/utils/video-analysis/video-downloader.ts` (~310 lines)
**Purpose**: Downloads videos from test session artifacts
**Key Features**:
- Fetches test sessions using `reportingClient.getTestSessionsForTest()`
- Extracts video URL from last session's `artifactReferences`
- Downloads video with authentication
- Extracts metadata using FFprobe
- Handles cleanup

**Dependencies**:
```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ZebrunnerReportingClient } from '../../api/reporting-client.js';
import { TestSessionVideo, VideoDownloadResult } from './types.js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
```

**Key Methods**:
- `getVideoUrlFromTestSessions()` - Gets video URL from test sessions
- `downloadVideo()` - Downloads video file
- `getVideoMetadata()` - Extracts duration and resolution
- `cleanupVideo()` - Removes temp files

### 2. `src/utils/video-analysis/frame-extractor.ts` (~350 lines)
**Purpose**: Extracts frames from video using FFmpeg
**Key Features**:
- 3 extraction modes: failure_focused, smart, full_test
- Smart timestamp distribution
- Frame to base64 conversion
- Image resizing for token efficiency

**Key Methods**:
- `extractFrames()` - Main extraction method
- `getFailureFocusedTimestamps()` - Frames around failure
- `getSmartTimestamps()` - Log + failure timestamps
- `extractSingleFrame()` - FFmpeg frame extraction
- `frameToBase64()` - Convert to base64 with resize

### 3. `src/utils/video-analysis/test-case-comparator.ts` (~340 lines)
**Purpose**: Compares video execution with test case
**Key Features**:
- Fetches test case using `EnhancedZebrunnerClient`
- Parses test case steps from various formats
- Compares executed steps with expected
- Calculates coverage percentage

**Dependencies**:
```typescript
import { EnhancedZebrunnerClient } from '../../api/enhanced-client.js';
import { TestCaseComparison, LogStep, AnalyzedFrame } from './types.js';
```

**Key Methods**:
- `compareWithTestCase()` - Main comparison
- `parseTestCaseSteps()` - Parse from test case data
- `compareSteps()` - Match executed vs expected
- `calculateCoverage()` - Coverage stats

### 4. `src/utils/video-analysis/prediction-engine.ts` (~400 lines)
**Purpose**: Predicts if failure is bug or test issue
**Key Features**:
- Evidence-based prediction
- Confidence scoring
- Actionable recommendations
- Multiple failure categories

**Key Methods**:
- `predictIssueType()` - Main prediction
- `collectBugEvidence()` - Bug indicators
- `collectTestUpdateEvidence()` - Test issue indicators
- `generateRecommendations()` - Action items

### 5. `src/utils/video-analysis/analyzer.ts` (~550 lines)
**Purpose**: Main orchestrator
**Key Features**:
- Coordinates all components
- Handles log parsing
- Generates markdown reports
- OCR integration
- Cleanup management

**Dependencies**:
```typescript
import { ZebrunnerReportingClient } from '../../api/reporting-client.js';
import { EnhancedZebrunnerClient } from '../../api/enhanced-client.js';
import { VideoDownloader } from './video-downloader.js';
import { FrameExtractor } from './frame-extractor.js';
import { TestCaseComparator } from './test-case-comparator.js';
import { PredictionEngine } from './prediction-engine.js';
import { extractTextOCR } from '../screenshot-analyzer.js';
```

**Key Methods**:
- `analyzeTestExecutionVideo()` - Main entry point
- `fetchTestDetails()` - Get test data
- `parseTestLogs()` - Extract steps from logs
- `analyzeFailure()` - Failure analysis
- `generateExecutiveSummary()` - Create summary

### 6. `src/utils/video-analysis/index.ts` (~10 lines)
```typescript
export * from './types.js';
export * from './video-downloader.js';
export * from './frame-extractor.js';
export * from './test-case-comparator.js';
export * from './prediction-engine.js';
export * from './analyzer.js';
```

### 7. `src/handlers/reporting-tools.ts` - Add video analyzer

**Add to class constructor**:
```typescript
import { VideoAnalyzer } from '../utils/video-analysis/analyzer.js';

export class ZebrunnerReportingToolHandlers {
  private videoAnalyzer: VideoAnalyzer | null = null;

  constructor(
    private reportingClient: ZebrunnerReportingClient,
    private tcmClient?: EnhancedZebrunnerClient
  ) {
    if (tcmClient) {
      this.videoAnalyzer = new VideoAnalyzer(reportingClient, tcmClient, false);
    }
  }
```

**Add method** (~240 lines):
```typescript
async analyzeTestExecutionVideoTool(input: {
  testId: number;
  testRunId: number;
  projectKey?: string;
  projectId?: number;
  extractionMode?: 'failure_focused' | 'full_test' | 'smart';
  frameInterval?: number;
  failureWindowSeconds?: number;
  compareWithTestCase?: boolean;
  testCaseKey?: string;
  includeOCR?: boolean;
  analyzeSimilarFailures?: boolean;
  includeLogCorrelation?: boolean;
  format?: 'detailed' | 'summary' | 'jira';
  generateVideoReport?: boolean;
}): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> }>
```

### 8. `src/server.ts` - Register tool

**Add after `analyze_screenshot` tool** (~60 lines):
```typescript
server.tool(
  "analyze_test_execution_video",
  "🎬 Download and analyze test execution video with Claude Vision...",
  {
    testId: z.number().int().positive()...,
    // ... all parameters from AnalyzeTestExecutionVideoInputSchema
  },
  async (args): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> }> => {
    try {
      debugLog("analyze_test_execution_video called", args);
      return await reportingHandlers.analyzeTestExecutionVideoTool(args);
    } catch (error: any) {
      // Error handling
    }
  }
);
```

## 🔧 Implementation Notes

### Type Fixes Required:
1. Use `EnhancedZebrunnerClient` (not `ZebrunnerApiClient`)
2. Use `test.testCases[0].testCaseId` (not `.key`)
3. Convert timestamps: `String(lastSession.startedAt)` for string|number types
4. Add `|| undefined` for nullable fields
5. Explicit MCP content types in return signatures

### Import Statements:
- Always use `.js` extensions for imports
- Use `EnhancedZebrunnerClient` from `enhanced-client.js`
- Import ffmpeg with installers at top of video files

### Error Handling:
- Graceful degradation if video unavailable
- Cleanup temp files in finally blocks
- Return helpful error messages with troubleshooting

## 🚀 Quick Implementation Steps

1. **Create implementation files** - Copy from previous session
2. **Fix type errors** - Use notes above
3. **Add handler method** - In `reporting-tools.ts`
4. **Register tool** - In `server.ts`
5. **Build**: `npm run build`
6. **Test**: Try with a real test video

## 📚 Reference

All implementation details from the previous successful build session are available in the chat history. Each file has been fully implemented and tested.

**Status**: All TypeScript type errors were resolved in the last build. The implementation compiled successfully with no errors.

## ✅ Success Criteria

- TypeScript builds with no errors
- Tool shows in MCP server list
- Downloads video from test sessions
- Extracts frames using FFmpeg
- Returns frames to Claude Vision
- Generates comprehensive analysis report

---

**Version**: 5.7.0  
**Last Successful Build**: Previous session - all files compiled cleanly


