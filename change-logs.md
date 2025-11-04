# Change Logs

## v5.7.0
- **🎬 NEW: Test Execution Video Analysis Tool** - Comprehensive video analysis with Claude Vision integration
- **Video Processing Capabilities:**
  - Downloads test execution videos from Zebrunner test sessions
  - Extracts frames at strategic timestamps (3 modes: failure_focused, smart, full_test)
  - Analyzes 10-30 frames per video depending on extraction mode
  - Automatic frame resizing and optimization for Claude Vision
  - OCR text extraction from frames using Tesseract.js
  - Intelligent frame selection around failure points
- **Test Case Comparison:**
  - Fetches test case definitions from TCM
  - Compares expected steps with executed steps from video/logs
  - Calculates coverage percentage and identifies skipped/extra steps
  - Correlates video frames with test case steps
- **Failure Analysis & Prediction:**
  - Analyzes failure type, error messages, and stack traces
  - Predicts if failure is: bug, test_needs_update, infrastructure_issue, or data_issue
  - Provides confidence scores (0-100%) for predictions
  - Evidence-based reasoning with multiple data sources (logs, video, test case)
  - Root cause categorization with supporting evidence
- **Actionable Recommendations:**
  - Prioritized action items (high/medium/low priority)
  - Specific recommendations based on failure type
  - Bug report templates for developers
  - Test automation fixes for QA engineers
- **MCP Integration:**
  - Returns frames as image content blocks for Claude Vision analysis
  - Detailed markdown reports with frame thumbnails
  - Comprehensive metadata (video duration, resolution, platform, device)
  - Links to test execution, test case, and video recording
- **New Dependencies:**
  - `@ffmpeg-installer/ffmpeg` ^1.1.0 - FFmpeg binary for video processing
  - `@ffprobe-installer/ffprobe` ^1.4.1 - FFprobe for video metadata extraction
  - `fluent-ffmpeg` ^2.1.3 - Node.js FFmpeg wrapper
  - `@types/fluent-ffmpeg` ^2.1.24 - TypeScript types for fluent-ffmpeg
- **New Modules (~2,800 lines of code):**
  - `src/utils/video-analysis/analyzer.ts` - Main orchestrator
  - `src/utils/video-analysis/video-downloader.ts` - Video download & metadata
  - `src/utils/video-analysis/frame-extractor.ts` - FFmpeg frame extraction
  - `src/utils/video-analysis/test-case-comparator.ts` - Test case comparison
  - `src/utils/video-analysis/prediction-engine.ts` - AI-driven predictions
  - `src/utils/video-analysis/types.ts` - Type definitions
  - `src/types/ffprobe.d.ts` - FFprobe type declarations
- **Documentation:**
  - Updated README with video analysis tool usage
  - Added comprehensive input parameters documentation
  - Included example outputs and use cases
- **Use Cases:**
  - Automated root cause analysis for test failures
  - Evidence-based bug vs test issue classification
  - Visual debugging of mobile app test executions
  - Test case validation and coverage analysis
  - Failure pattern identification across multiple executions
- **Performance:**
  - Smart frame extraction limits token usage
  - Automatic cleanup of temporary video files
  - Configurable frame intervals and failure windows
  - Parallel processing support for multiple frames
- **Error Handling:**
  - Graceful degradation if video unavailable
  - FFmpeg installation validation
  - Disk space checks before download
  - Comprehensive error messages and troubleshooting
- **Backward Compatibility:** ✅ Fully backward compatible, video analysis is opt-in

## v5.6.4
- **🔥 CRITICAL FIX: URL Regression** - Fixed all incorrect test URLs from old pattern (`/tests/runs/.../results/...`) to correct pattern (`/projects/{projectKey}/automation-launches/{launchId}/tests/{testId}`)
- **📊 NEW: Quick Reference Tables** - Added feature-grouped tables for critical and medium failures in `detailed_analyze_launch_failures`
  - Tests automatically grouped by feature area (Search & Quick Log, Notifications, Meal Management, etc.)
  - Clean markdown tables with: Test (clickable), Stability %, Issue description, Evidence (video link)
  - Priority-based sections: 🔴 Critical (0-30%), 🟡 Medium (31-70%)
  - Perfect for sharing in Slack or team communications
- **🔧 Fixed URLs in All Formats**:
  - ✅ Individual test analysis (`analyze_test_failure`)
  - ✅ Launch-wide analysis (`detailed_analyze_launch_failures`)
  - ✅ JIRA format tickets
  - ✅ Summary reports
  - ✅ All links, recommendations, and similar failures sections

## v5.6.3
- **🔥 MAJOR: Fixed Session Handling & Clickable Links in All Formats**
- Enhanced `detailed_analyze_launch_failures` with comprehensive improvements:
  - **Session Sorting:** Failed sessions now display first, followed by successful ones (newest first within each status)
  - **Accurate Session Matching:** Videos and screenshots are correctly matched per session, not mixed between different executions
  - **Suite Information:** Test suite/test class now displayed in all formats (detailed, summary, jira)
  - **Device Collection:** Actual devices collected from test sessions (not inaccurate launch metadata)
  - **Clickable URLs:** All test names, test IDs, videos, screenshots, test cases, and launch links are now clickable
  - **Build Links:** If build field contains a URL, it's now clickable
  - **Enhanced Launch Header:** Displays test suite, collected devices from actual executions, and all metadata
- Updated `analyze_test_failure` tool:
  - Sessions displayed with status indicators (❌ FAILED, ✅ PASSED, ⚠️ OTHER)
  - Multiple test execution sessions shown with proper status grouping
  - Suite/test class information added to executive summary
  - All URLs are clickable (test, launch, test cases, videos, screenshots)
- Updated JIRA format:
  - Test ID, Launch ID, and Launch Name are clickable links
  - Suite/Test Class field added to ticket metadata
  - All test references in the ticket body are clickable
- Fixed summary format:
  - Test ID is now a clickable link
  - Suite/Test Class displayed
  - All artifact links properly formatted
- Comprehensive URL linking throughout all report sections:
  - Individual test analysis: clickable test names and IDs
  - Similar failure groups: clickable test links
  - Recommendations: clickable test links with stability info
  - Timeline analysis: all test references are clickable


## v5.6.1
- **🔗 Clickable URLs in Summary Reports** - All launch, test, and JIRA issue references now include clickable URLs
- **📊 Enhanced Launch Test Summary** - Added launch details and URLs to `get_launch_test_summary` output
- **✨ Smart JIRA URL Resolution** - JIRA tickets in summaries now link to actual JIRA instances

**What Changed:**

1. **Launch Information in Summary** ✅
   - Added `launchName`, `launchUrl`, `launchStatus`, `launchBuild`, `launchEnvironment`, `launchPlatform`
   - Added `launchStartedAt`, `launchEndedAt` timestamps
   - Launch name and ID are now clickable links

2. **Test URLs in All Test Lists** ✅
   - Every test now includes `testUrl` field
   - Direct links to test details in Zebrunner UI
   - Format: `https://workspace.zebrunner.com/projects/PROJECT/automation-launches/LAUNCH_ID/tests/TEST_ID`

3. **JIRA Issue URLs** ✅
   - All issue references now include resolved JIRA URLs
   - New field: `issueReferencesWithUrls` with full URL for each JIRA ticket
   - Uses `buildJiraUrl()` to resolve from Zebrunner integrations
   - Format: `[TICKET-123](https://your-jira.atlassian.net/browse/TICKET-123)`

4. **Enhanced Test Collections** ✅
   - `top20MostUnstableTests` - Now includes `testUrl` and resolved JIRA URLs
   - `testsWithIssues` - Now includes `testUrl` and `issueReferencesWithUrls`
   - All test objects in results include clickable links

**API Response Structure:**

```json
{
  "launchId": 120906,
  "projectId": 7,
  "projectKey": "MCP",
  "launchName": "Android-Minimal-Acceptance",
  "launchUrl": "https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120906",
  "launchStatus": "FAILED",
  "launchBuild": "your-workspace-develop-46975-qaRelease.apk",
  "summary": { ... },
  "top20MostUnstableTests": [
    {
      "id": 5455325,
      "name": "searchFoodQuickLogSectionTest",
      "stability": 10,
      "status": "FAILED",
      "testUrl": "https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120906/tests/5455325",
      "issueReferences": [
        {
          "type": "JIRA",
          "value": "QAT-27990",
          "url": "https://your-workspace.atlassian.net/browse/QAT-27990"
        }
      ]
    }
  ],
  "testsWithIssues": [
    {
      "id": 5455330,
      "name": "createMealFromDiaryWithExistingFoodsTest",
      "status": "FAILED",
      "testUrl": "https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120906/tests/5455330",
      "issues": [
        {
          "type": "JIRA",
          "value": "QAT-27990",
          "url": "https://your-workspace.atlassian.net/browse/QAT-27990"
        }
      ],
      "stability": 0,
      "testClass": "MealsTest"
    }
  ]
}
```

**Impact:**

When Claude formats this data into a summary, all references are now clickable:

**Before v5.6.1:**
```
Test: quickLogBestMatchesFoodTest
Known issue: QAT-27990
```

**After v5.6.1:**
```
Test: [quickLogBestMatchesFoodTest](https://your-workspace.zebrunner.com/.../tests/5455325)
Known issue: [QAT-27990](https://your-workspace.atlassian.net/browse/QAT-27990)
```

**Files Modified:**
- `src/handlers/reporting-tools.ts`:
  - Enhanced `getLaunchTestSummary()` to fetch launch details and build URLs
  - Added `testUrl` to all test objects
  - Added `issueReferencesWithUrls` with resolved JIRA URLs
  - Added launch metadata fields to result object
- `package.json` - Bumped version to 5.6.1
- `change-logs.md` - Documented changes

**Benefits:**

✅ **One-Click Navigation**: Direct access to tests and JIRA tickets from summaries  
✅ **Better UX**: No need to manually construct URLs  
✅ **Consistent Linking**: All tools now use the same URL generation logic  
✅ **Cross-Platform**: Works in any Markdown viewer (Cursor, VS Code, web browsers)  

---

## v5.6.0
- **📹 Multiple Test Sessions Support** - Display all test execution sessions with videos and screenshots
- **🔗 Enhanced Launch Details** - Comprehensive launch information at the top of failure analysis reports
- **🖼️ Smart Screenshot Display** - Summary shows last screenshot, detailed shows all screenshots per session
- **✨ All URLs Clickable** - Launch, test, test case, video, and screenshot URLs are now clickable links
- **🎯 Session-Based Artifacts** - Videos and screenshots organized by test execution session

**What Changed:**

1. **Multiple Test Sessions Display** ✅
   - **New Method**: `getAllSessionsWithArtifacts()` retrieves all test sessions with their artifacts
   - **Newest First**: Sessions sorted by execution time (newest to oldest)
   - **Filter Invalid Sessions**: Only shows sessions with valid videos or screenshots
   - **Structured Data**: Each session includes device, platform, duration, timestamps, videos, and screenshots

2. **Enhanced Test Session Section** ✅
   ```markdown
   ## 📹 Test Execution Sessions
   
   **Total Sessions:** 2
   
   ### 📹 Session 1 (Latest)
   - **Device:** Pixel 8 Pro
   - **Platform:** Android 15
   - **Duration:** 4m 1s
   - **Started:** November 3, 2025 at 7:22:57 PM
   - **Status:** FAILED
   
   **Videos:**
   🎥 [Watch Test Execution Video](https://...direct-link...)
   
   **Screenshots:** 5 available
   1. 🖼️ [Screenshot 1](https://...link...)
   2. 🖼️ [Screenshot 2](https://...link...)
   ...
   
   ### 📼 Session 2
   - **Device:** Galaxy S21
   - **Platform:** Android 14
   ...
   ```

3. **Enhanced Launch Header** ✅
   - **Detailed Information**: Launch name, ID, project, status, environment, platform, build
   - **Clickable Launch URL**: Direct link to launch in Zebrunner UI
   - **Duration Calculation**: Automatically calculates and displays launch duration
   - **Timestamps**: Shows start and end times in local format
   - **Owner Information**: Displays launch owner/uploader

   **Example:**
   ```markdown
   ## 🚀 Launch Information
   
   - **Launch:** [Android-Minimal-Acceptance](https://...launch-url...)
   - **Launch ID:** [120906](https://...launch-url...)
   - **Project:** MCP
   - **Status:** FAILED
   - **Environment:** production
   - **Platform:** Android
   - **Build:** 1.23.45
   - **Duration:** 15m 23s
   - **Started:** November 3, 2025 at 7:00:00 PM
   - **Finished:** November 3, 2025 at 7:15:23 PM
   - **Owner:** john.doe
   ```

4. **Smart Screenshot Display** ✅
   - **Summary Format**: Shows only the last screenshot from the latest session
   - **Detailed Format**: Shows all screenshots from all sessions (organized by session)
   - **AI Analysis**: Uses the latest screenshot from the latest session for AI-powered analysis
   - **Session Count**: Indicates if multiple test executions were recorded

5. **All URLs Clickable** ✅
   - **Launch URLs**: `[Launch Name](https://...)`
   - **Test URLs**: `[Test ID](https://...)`
   - **Test Case URLs**: `[MCP-123](https://...)`
   - **Video URLs**: `[🎥 Watch Test Execution Video](https://...)`
   - **Screenshot URLs**: `[🖼️ Screenshot N](https://...)`
   - **Jira Issue URLs**: `[QAS-456](https://...)`

6. **Video Artifact Filtering** ✅
   - **Description-Based**: Only shows videos with non-empty descriptions
   - **Multiple Videos**: Supports multiple videos per session
   - **Direct Links**: Uses Zebrunner proxy URLs (authenticated, no redirect needed)
   - **Fallback Support**: Gracefully handles sessions without videos

**Technical Implementation:**

```typescript
// New method structure
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
  videos: Array<{ name: string; url: string; description?: string }>;
  screenshots: Array<{ name: string; url: string; description?: string }>;
}>>
```

**Key Features:**

📹 **Multi-Session Support**
- Handles tests with 1, 2, or more test execution sessions
- Each session displayed with complete context (device, platform, time)
- Videos and screenshots properly attributed to their session

🔗 **Comprehensive Linking**
- Every entity (launch, test, test case, artifact) is now a clickable link
- Direct navigation to Zebrunner UI for detailed inspection
- Test cases resolve to actual numeric IDs via TCM API

🎯 **Intelligent Filtering**
- Skips sessions without any valid artifacts (videos/screenshots)
- Filters out video artifacts without descriptions
- Shows only relevant, actionable information

⚡ **Performance Optimized**
- Single API call retrieves all sessions for a test
- Efficient processing and filtering
- Graceful error handling with fallbacks

**Usage Examples:**

```typescript
// Analyze test with URL - automatically gets all sessions
"Analyze https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120906/tests/5455325"

// Result includes all sessions:
## 📹 Test Execution Sessions
**Total Sessions:** 2

### 📹 Session 1 (Latest)
- Device: Pixel 8 Pro
- 🎥 [Watch Video](https://...)
- 5 screenshots available

### 📼 Session 2
- Device: Galaxy S21
- 🎥 [Watch Video](https://...)
- 3 screenshots available
```

**Bug Fixes:**

✅ **Fixed Video URL Issues**
- Previously showed only first session video
- Now shows all videos from all sessions with descriptions
- Correctly filters artifacts by name and description

✅ **Fixed Screenshot Organization**
- Screenshots now properly grouped by session
- Latest screenshot correctly identified for AI analysis
- All screenshots accessible with clickable links

✅ **Fixed Launch Header**
- Added comprehensive launch details (was minimal before)
- Fixed property names (`build` not `buildNumber`, `endedAt` not `finishedAt`, `user.username` not `owner`)
- Made launch name and ID clickable

**Files Modified:**
- `src/handlers/reporting-tools.ts`:
  - Added `getAllSessionsWithArtifacts()` method
  - Updated `getVideoUrlForTest()` to use new method (deprecated)
  - Enhanced `generateFailureAnalysisReport()` with sessions section
  - Enhanced `generateSummaryReport()` with latest session data
  - Enhanced `analyzeLaunchFailures()` with detailed launch header
  - Made all URLs clickable throughout reports
- `package.json` - Bumped version to 5.6.0
- `change-logs.md` - Documented all changes

**Migration Notes:**

🔄 **Backward Compatible**: All existing tool calls continue to work
📊 **Enhanced Output**: Reports now include more detailed session information
🎥 **Better Video Links**: Videos are now correctly attributed to their sessions
🖼️ **Organized Screenshots**: Screenshots grouped by session for clarity

---

## v5.5.0
- **🔗 Smart URL-Based Analysis** - Claude automatically detects and analyzes Zebrunner URLs
- **✨ Natural Language Parsing** - Just paste a URL, Claude handles the rest
- **🚀 Optimal Defaults** - Auto-enables videos, screenshots, and AI analysis
- **🎯 Multi-URL Support** - Analyze multiple tests/launches in one request

**What Changed:**

1. **AI-Level URL Detection** ✅
   - **Pattern Recognition**: Claude automatically detects Zebrunner test and launch URLs
   - **Auto-Extraction**: Parses `projectKey`, `testRunId`, and `testId` from URLs
   - **Smart Routing**: Calls `analyze_test_failure` for test URLs, `detailed_analyze_launch_failures` for launch URLs
   - **No Manual Setup**: Works out of the box with existing MCP configuration

2. **Supported URL Patterns** ✅

   **Test URLs:**
   ```
   https://workspace.zebrunner.com/projects/PROJECT/automation-launches/LAUNCH_ID/tests/TEST_ID
   ```
   - Automatically calls `analyze_test_failure`
   - Extracts: `projectKey`, `testRunId`, `testId`
   - Default params: All diagnostics enabled, videos, screenshots, AI analysis

   **Launch URLs:**
   ```
   https://workspace.zebrunner.com/projects/PROJECT/automation-launches/LAUNCH_ID
   ```
   - Automatically calls `detailed_analyze_launch_failures`
   - Extracts: `projectKey`, `testRunId`
   - Default params: Screenshot analysis enabled, comprehensive reporting

3. **Natural Language Overrides** ✅
   - **"without screenshots"** → Sets `analyzeScreenshotsWithAI: false`
   - **"in jira format"** → Sets `format: "jira"`
   - **"quick analysis"** → Sets `format: "summary"`, `screenshotAnalysisType: "basic"`
   - **"compare these"** → Analyzes multiple URLs and compares results

4. **Multi-URL Processing** ✅
   - Paste multiple URLs in one request
   - Claude analyzes all sequentially
   - Results can be compared or aggregated
   - Useful for comparing similar failures across tests

5. **Cross-Workspace Support** ✅
   - URLs from different workspaces show warning
   - Analysis still attempted with configured credentials
   - Helpful for multi-environment setups

**Usage Examples:**

```markdown
# Single Test Analysis
User: "Analyze https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455386"

Claude automatically:
- Detects test URL pattern
- Extracts: projectKey=MCP, testRunId=120911, testId=5455386
- Calls analyze_test_failure with all defaults enabled
- Returns comprehensive failure analysis with videos and screenshots

# Launch Analysis
User: "Check https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911"

Claude automatically:
- Detects launch URL pattern  
- Extracts: projectKey=MCP, testRunId=120911
- Calls detailed_analyze_launch_failures
- Returns analysis of all failed tests without linked issues

# With Overrides
User: "Generate JIRA ticket for https://...url... without screenshots"

Claude:
- Detects URL and extracts parameters
- Applies override: format="jira", analyzeScreenshotsWithAI=false
- Generates JIRA-ready report

# Multiple URLs
User: "Compare these failures:
https://.../tests/5455386
https://.../tests/5455390"

Claude:
- Analyzes both tests sequentially
- Compares error patterns, classifications, similarities
- Provides unified comparison report
```

**Default Parameters Applied:**

When Claude detects a URL, these parameters are automatically used:

**For Test URLs** (`analyze_test_failure`):
```typescript
{
  projectKey: "<extracted>",
  testRunId: <extracted>,
  testId: <extracted>,
  includeVideo: true,
  analyzeScreenshotsWithAI: true,
  includeLogs: true,
  includeScreenshots: true,
  includeArtifacts: true,
  analyzeSimilarFailures: true,
  screenshotAnalysisType: "detailed",
  format: "detailed"
}
```

**For Launch URLs** (`detailed_analyze_launch_failures`):
```typescript
{
  projectKey: "<extracted>",
  testRunId: <extracted>,
  filterType: "without_issues",
  includeScreenshotAnalysis: true,
  screenshotAnalysisType: "detailed",
  format: "summary",
  executionMode: "sequential"
}
```

**URL Pattern Reference:**

```
https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455386
       ├──────────────────┤ ├─────┤                    ├─────┤       ├──────┤
       Workspace           Project                     Launch        Test
       (validated)         (projectKey)                (testRunId)   (testId)
```

**Documentation Added:**

✅ **README.md**
  - New section: "Method 3: Smart URL-Based Analysis"
  - Detailed URL pattern documentation
  - Usage examples and pro tips
  - Advanced override examples
  - Table of Contents updated

✅ **Tool Descriptions**
  - `analyze_test_failure` - Added URL hint
  - `detailed_analyze_launch_failures` - Added URL hint
  - Both tools now mention auto-invocation capability

**Files Modified:**
- `README.md` - Added comprehensive URL-based analysis documentation (Section 5.3)
- `src/server.ts` - Updated tool descriptions to hint at URL auto-detection capability
- `package.json` - Bumped version to 5.5.0
- `change-logs.md` - Documented the feature with examples

**Why This Matters:**

🎯 **Faster Workflow**: Copy-paste URLs directly from Zebrunner UI - no manual ID extraction  
🧠 **Smarter AI**: Claude understands context and intent from URLs  
⚡ **Optimal Settings**: Automatic use of recommended analysis parameters  
🔄 **Flexible**: Natural language overrides work seamlessly  
📊 **Batch-Friendly**: Analyze multiple URLs in one conversation  

**Pro Tips:**

1. Copy URLs directly from Zebrunner browser tabs
2. Paste multiple URLs for batch analysis and comparison
3. Add natural language hints to customize analysis
4. Works great with "why did this fail?" style questions
5. Combine with format requests for instant JIRA tickets

---

## v5.4.1
- **🔗 Smart Test Case ID Detection** - Automatically makes embedded test case IDs in test names clickable
- **✅ Abbreviated Format Support** - Expands shortened formats like "MCP-2869, 2870, 2871" to full format
- **📋 Pattern Recognition** - Detects test case IDs anywhere in test names (in parentheses, brackets, or standalone)

**What Changed:**

1. **Embedded Test Case ID Detection** ✅
   - **Pattern Matching**: Automatically detects test case IDs in test names using regex
   - **Examples**:
     - `Yesterday Nutrients Sharing Test (MCP-2064)` → `Yesterday Nutrients Sharing Test ([MCP-2064](url))`
     - `My Test [QAS-123]` → `My Test [[QAS-123](url)]`
     - `Test APPS-456 Something` → `Test [APPS-456](url) Something`

2. **Abbreviated Format Expansion** ✅
   - **Before**: `MCP-2869, 2870, 2871` (only first ID clickable)
   - **After**: `[MCP-2869](url), [MCP-2870](url), [MCP-2871](url)` (all clickable)
   - **Process**: Detects abbreviated pattern → Expands to full format → Makes all IDs clickable

3. **New makeTestCaseIDsClickable() Method** ✅
   - **Step 1**: Expand abbreviated patterns (e.g., `MCP-2869, 2870` → `MCP-2869, MCP-2870`)
   - **Step 2**: Detect all full-format test case IDs
   - **Step 3**: Convert each to clickable markdown link via TCM API
   - **Fallback**: If URL resolution fails, leaves as plain text

4. **Applied to Launch Analysis** ✅
   - Integrated into `detailed_analyze_launch_failures` tool
   - Test names with embedded IDs now automatically display clickable links
   - Works for both detailed and summary formats

**Technical Implementation:**

```typescript
/**
 * Convert embedded test case IDs in text to clickable markdown links
 * Detects patterns like "MCP-2064", "APPS-1234" and abbreviated lists like "MCP-2869, 2870, 2871"
 */
private async makeTestCaseIDsClickable(
  text: string,
  projectKey: string,
  baseUrl: string
): Promise<string> {
  // Step 1: Expand abbreviated patterns
  const abbreviatedPattern = /\b([A-Z]{2,10})-(\d+)(?:\s*,\s*(\d+))+/g;
  // "MCP-2869, 2870, 2871" → "MCP-2869, MCP-2870, MCP-2871"

  // Step 2: Detect all full-format test case IDs
  const testCasePattern = /\b([A-Z]{2,10}-\d+)\b/g;

  // Step 3: Make each ID clickable
  for (const testCaseId of matches) {
    const url = await this.buildTestCaseUrl(testCaseId, projectKey, baseUrl);
    // Replace with: [MCP-2869](url)
  }
}

// Usage in launch analysis
const clickableTestName = await this.makeTestCaseIDsClickable(
  result.testName,
  resolvedProjectKey!,
  baseUrl
);
report += `### ${idx + 1}. Test ${result.testId}: ${clickableTestName}\n\n`;
```

**Pattern Examples:**

| Input | Output |
|-------|--------|
| `Test (MCP-2064)` | `Test ([MCP-2064](url))` |
| `MCP-2869, 2870, 2871` | `[MCP-2869](url), [MCP-2870](url), [MCP-2871](url)` |
| `Test [QAS-123] Name` | `Test [[QAS-123](url)] Name` |
| `Multiple APPS-1, 2, 3 IDs` | `Multiple [APPS-1](url), [APPS-2](url), [APPS-3](url) IDs` |

**Regex Patterns:**

```typescript
// Abbreviated format detection:
/\b([A-Z]{2,10})-(\d+)(?:\s*,\s*(\d+))+/g
// Matches: "MCP-2869, 2870, 2871"
// Captures: projectPrefix="MCP", followed by comma-separated numbers

// Full format detection:
/\b([A-Z]{2,10}-\d+)\b/g
// Matches: "MCP-2064", "APPS-1234", "QAS-123"
// Captures: complete test case ID with project prefix and number
```

**Files Modified:**
- `src/handlers/reporting-tools.ts`
  - Added `makeTestCaseIDsClickable()` method
  - Enhanced `buildTestCaseUrl()` to restore fallback logic
  - Applied clickable conversion to test names in launch analysis
- `package.json` - Bumped version to 5.4.1
- `change-logs.md` - Documented the enhancement

**Before:**
```markdown
### 1. Test 5454462: Yesterday Nutrients Sharing Test (MCP-2064)
- **Status:** FAILED
```

**After:**
```markdown
### 1. Test 5454462: Yesterday Nutrients Sharing Test ([MCP-2064](https://your-workspace.zebrunner.com/projects/MCP/test-cases/2134))
- **Status:** FAILED
```

---

## v5.4.0
- **🔗 Smart JIRA URL Resolution** - Automatically fetches correct JIRA base URL from Zebrunner integrations
- **✅ Project-Aware Matching** - Matches JIRA integration by project ID for multi-project setups
- **🔄 Fallback Chain** - API → Environment Variable → Placeholder (graceful degradation)
- **💾 Session Caching** - JIRA URL cached for performance (no repeated API calls)
- **🌐 Clickable JIRA Links** - All JIRA issue references now link directly to correct JIRA instance

**What Changed:**

1. **JIRA URL Auto-Detection** ✅
   - **API Source**: Fetches from `/api/integrations/v2/integrations/tool:jira`
   - **Project Matching**: Prefers integration where `enabledForZebrunnerProjectIds` includes current project
   - **Fallback Strategy**: Falls back to any enabled JIRA integration if no project match
   - **Example**: For project MCP (ID=7), uses integration configured for that project

2. **New Environment Variable** ✅
   - **`JIRA_BASE_URL`**: Optional fallback if API unavailable or for security-restricted environments
   - **Example**: `JIRA_BASE_URL=https://your-workspace.atlassian.net`
   - **Priority**: Used only if Zebrunner integrations API fails or returns no results

3. **Central buildJiraUrl() Method** ✅
   - **Location**: `ZebrunnerReportingClient.buildJiraUrl(issueKey, projectId?)`
   - **Usage**: Replaces hardcoded "https://jira.com" URLs
   - **Format**: Returns full URL like `https://your-workspace.atlassian.net/browse/QAS-22939`
   - **Async**: Resolves URLs dynamically with caching

4. **Updated Issue References Display** ✅
   - **Before**: `- **JIRA:** QAS-22939` (plain text)
   - **After**: `- **JIRA:** [QAS-22939](https://your-workspace.atlassian.net/browse/QAS-22939)` (clickable link)
   - **Mixed Types**: Non-JIRA issue types (GitHub, etc.) remain as plain text

5. **Session-Level Caching** ✅
   - **Performance**: JIRA URL fetched once per server session
   - **Cache Key**: Stored in `jiraBaseUrlCache` private field
   - **Invalidation**: Only cleared when server restarts

**Technical Implementation:**

```typescript
// New schema in types/reporting.ts
export const JiraIntegrationSchema = z.object({
  id: z.number(),
  enabled: z.boolean(),
  tool: z.string(),
  config: z.object({
    type: z.string(),
    url: z.string(), // JIRA base URL
    // ... other fields
  }),
  projectsMapping: z.object({
    enabledForZebrunnerProjectIds: z.array(z.number()),
    // ... other fields
  })
});

// New methods in ZebrunnerReportingClient
class ZebrunnerReportingClient {
  private jiraBaseUrlCache: string | null = null;

  async getJiraIntegrations(): Promise<JiraIntegrationsResponse> {
    // Fetch from /api/integrations/v2/integrations/tool:jira
  }

  async resolveJiraBaseUrl(projectId?: number): Promise<string> {
    // Priority:
    // 1. Cached value (if available)
    // 2. Zebrunner API (match by projectId, fallback to any enabled)
    // 3. process.env.JIRA_BASE_URL
    // 4. Placeholder: https://jira.com
  }

  async buildJiraUrl(issueKey: string, projectId?: number): Promise<string> {
    const baseUrl = await this.resolveJiraBaseUrl(projectId);
    return `${baseUrl}/browse/${issueKey}`;
  }
}

// Updated in reporting-tools.ts
for (const issue of testRun.issueReferences) {
  if (issue.type === 'JIRA') {
    const jiraUrl = await this.reportingClient.buildJiraUrl(issue.value, projectId);
    report += `- **${issue.type}:** [${issue.value}](${jiraUrl})\n`;
  }
}
```

**Resolution Flow:**

```
┌─────────────────────┐
│ buildJiraUrl() Call │
└──────────┬──────────┘
           │
           ▼
   ┌───────────────┐
   │ Cache Check?  │──Yes──► Return cached URL
   └───────┬───────┘
           │ No
           ▼
   ┌─────────────────────────┐
   │ Fetch Integrations API  │
   └──────────┬──────────────┘
              │
              ▼
      ┌────────────────┐
      │ Filter Enabled │
      └───────┬────────┘
              │
              ▼
   ┌────────────────────────┐
   │ Match by projectId?    │──Yes──► Use matched integration
   └──────────┬─────────────┘
              │ No
              ▼
   ┌────────────────────────┐
   │ Use first enabled      │
   └──────────┬─────────────┘
              │
              ▼
      ┌──────────────┐
      │ API Failed?  │──Yes──► Check env var
      └───────┬──────┘
              │ No
              ▼
   ┌────────────────────────┐
   │ Cache & Return URL     │
   └────────────────────────┘
```

**Example Zebrunner Response:**

```json
{
  "items": [
    {
      "id": 7,
      "enabled": true,
      "tool": "JIRA",
      "config": {
        "url": "https://your-workspace.atlassian.net"
      },
      "projectsMapping": {
        "enabledForZebrunnerProjectIds": [7]  // MCP project
      }
    }
  ]
}
```

**Files Modified:**
- `src/types/reporting.ts` - Added JIRA integration schemas
- `src/api/reporting-client.ts` - Added JIRA URL resolution methods
- `src/handlers/reporting-tools.ts` - Updated issue references to use clickable links
- `.env` - Added `JIRA_BASE_URL` optional variable
- `package.json` - Bumped version to 5.4.0
- `change-logs.md` - Documented the feature

**Environment Variable:**
```bash
# Optional: JIRA base URL (if not auto-detected from Zebrunner integrations)
# Example: JIRA_BASE_URL=https://your-workspace.atlassian.net
# If not set, will try to fetch from Zebrunner integrations API
# JIRA_BASE_URL=
```

---

## v5.3.2
- **🔧 Fixed Test Case Display in Launch Analysis** - Test cases now show correctly with clickable links
- **✅ Consistent Format Across Detailed & Summary** - Test cases displayed uniformly in all formats

**What Changed:**

1. **Test Cases Now Visible for Each Test** ✅
   - **Detailed Format**: Test cases shown right after status line with clickable links
   - **Summary Format**: Test cases displayed on separate line with emoji 📋
   - **Format**: `- **Test Cases:** 📋 [MCP-2061](url), [MCP-123](url)`

2. **Fixed Missing Data Flow** ✅
   - Added `testCases` field to `analysisResults` array
   - Propagated test cases through all execution modes (sequential, parallel, batches)
   - Stored test cases in `testDetails` map for easy access
   - Test cases now available for each individual test in the report

3. **Proper Async Handling** ✅
   - Converted `forEach` loop to `for` loop to properly handle async test case URL resolution
   - Each test case URL is resolved via TCM API (as per v5.3.1 implementation)
   - Parallel resolution with `Promise.all()` for multiple test cases

4. **Display Location** ✅
   - **Q1 (Detailed)**: Right after status line (Option B) ✅
   - **Q2 (Summary)**: Separate line in compact view (Option B) ✅
   - **Q3 (Test Case References)**: Kept at end as quick reference (Option A) ✅

**Implementation Details:**

```typescript
// Add testCases to analysis results
analysisResults.push({
  testId: test.id,
  testName: test.name,
  status: test.status,
  testCases: test.testCases || [],  // NEW: Include test cases
  analysis,
  error: null
});

// Store in testDetails map
testDetails.set(result.testId, {
  // ... other fields
  testCases: result.testCases || [],  // NEW: Store test cases
  fullAnalysis: textContent
});

// Display in individual test sections (now using for loop for async)
for (let idx = 0; idx < analysisResults.length; idx++) {
  const result = analysisResults[idx];
  report += `### ${idx + 1}. Test ${result.testId}: ${result.testName}\n\n`;
  report += `- **Status:** ${result.status}\n`;

  // NEW: Display test cases right after status
  if (result.testCases && result.testCases.length > 0) {
    const testCaseLinks = await Promise.all(result.testCases.map(async (tc: any) => {
      const tcUrl = await this.buildTestCaseUrl(tc.testCaseId, resolvedProjectKey!, baseUrl);
      return `[${tc.testCaseId}](${tcUrl})`;
    }));
    report += `- **Test Cases:** 📋 ${testCaseLinks.join(', ')}\n`;
  }
  // ... rest of test details
}
```

**Example Output:**

**Before (v5.3.1):**
```markdown
### 1. Test 5454462: Weight Sharing to your-workspace
- **Status:** FAILED
- **Error Type:** Assertion
```

**After (v5.3.2):**
```markdown
### 1. Test 5454462: Weight Sharing to your-workspace
- **Status:** FAILED
- **Test Cases:** 📋 [MCP-2061](https://your-workspace.zebrunner.com/projects/MCP/test-cases/1971)
- **Error Type:** Assertion
```

**Files Modified:**
- `src/handlers/reporting-tools.ts`
  - Added `testCases` field to all `analysisResults.push()` calls (sequential, parallel, batches modes)
  - Added `testCases` to `testDetails.set()` call
  - Added `baseUrl` constant at beginning of `analyzeLaunchFailures` method
  - Converted `forEach` to `for` loop for async test case URL resolution
  - Added test case display logic right after status line
- `package.json` - Bumped version to 5.3.2
- `change-logs.md` - Documented the fix

---

## v5.3.1
- **🔧 Fixed Test Case URL Resolution** - Correct implementation using TCM API
- **✅ Proper Numeric ID Lookup** - Test case keys now resolved via `getTestCaseByKey()` API

**What Changed:**

1. **Incorrect Implementation Fixed** ❌→✅
   - **OLD (Wrong)**: Extracted numeric part from testCaseId string (e.g., "MCP-1921" → "1921")
   - **NEW (Correct)**: Resolves test case key via TCM API to get actual numeric ID
   - **Example**: "MCP-1075" → API call → numeric ID "1971" → `https://your-workspace.zebrunner.com/projects/MCP/test-cases/1971`

2. **TCM Client Integration** ✅
   - Injected `EnhancedZebrunnerClient` into `ZebrunnerReportingToolHandlers`
   - Uses `tcmClient.getTestCaseByKey(projectKey, testCaseId)` to resolve IDs
   - Returns full test case object with numeric `id` field

3. **Async Method Updates** ✅
   - `buildTestCaseUrl()` → async, resolves via API
   - `formatTestCases()` → async, awaits URL building
   - All call sites updated to await results (forEach → for...of loops)

4. **Graceful Error Handling** ✅
   - If TCM client not available: falls back to string extraction
   - If API call fails: catches error and falls back to string extraction
   - No breaking changes if TCM API is unreachable

**Technical Details:**

```typescript
// Before (WRONG):
private buildTestCaseUrl(testCaseId: string, projectKey: string, baseUrl: string): string {
  const numericId = testCaseId.split('-').pop(); // "MCP-1921" → "1921"
  return `${baseUrl}/projects/${projectKey}/test-cases/${numericId}`;
}

// After (CORRECT):
private async buildTestCaseUrl(testCaseId: string, projectKey: string, baseUrl: string): Promise<string> {
  try {
    if (this.tcmClient) {
      const testCase = await this.tcmClient.getTestCaseByKey(projectKey, testCaseId);
      return `${baseUrl}/projects/${projectKey}/test-cases/${testCase.id}`; // Actual numeric ID
    }
    // Fallback if no TCM client
    const numericId = testCaseId.split('-').pop();
    return `${baseUrl}/projects/${projectKey}/test-cases/${numericId}`;
  } catch (error) {
    // Fallback on API error
    const numericId = testCaseId.split('-').pop();
    return `${baseUrl}/projects/${projectKey}/test-cases/${numericId}`;
  }
}
```

**Files Modified:**
- `src/handlers/reporting-tools.ts` - Updated `buildTestCaseUrl()`, `formatTestCases()`, and all call sites
- `src/server.ts` - Injected TCM client into reporting handlers constructor
- `change-logs.md` - Documented correct implementation

---

## v5.3.0
- **📋 Test Case Numbers Integration** - Display linked Zebrunner TCM test cases in all reports
- **🔗 Clickable Test Case Links** - Direct links to test cases in Zebrunner UI
- **📊 Complete Coverage** - Test cases shown in all formats (detailed, summary, jira)

**New Features:**

1. **Test Case Display in All Formats** ✅
   - **Detailed Format**: Test cases shown in Executive Summary, Linked Test Cases section, and Quick Access Links
   - **Summary Format**: Test cases displayed with emoji 📋 and clickable links
   - **Jira Format (Individual)**: Test cases in summary table + Links section
   - **Jira Format (Launch)**: Test cases in combined ticket tables with clickable links

2. **Smart Test Case Links** ✅
   - **URL Format**: `https://your-workspace.zebrunner.com/projects/MCP/test-cases/{numericId}`
   - **TCM API Resolution**: Uses Zebrunner TCM API to resolve test case keys (e.g., "MCP-82") to numeric IDs
   - **Multiple Test Cases**: Displays all linked test cases, comma-separated with individual clickable links
   - **Not Linked Warning**: Shows "⚠️ Not linked to test case" when no test cases are linked
   - **Graceful Fallback**: If TCM API unavailable, extracts numeric part from key as fallback

3. **Display Locations** ✅
   - **Executive Summary**: `- **Test Cases:** 📋 [MCP-1921](url), [MCP-82](url)`
   - **Linked Test Cases Section**: Dedicated section with Type and Status info
   - **Quick Access Links**: Clickable links for quick navigation
   - **Jira Summary Table**: `|Test Cases|[MCP-1921|url], [MCP-82|url]|`
   - **Jira Links Section**: Individual links for each test case
   - **Combined Jira Tickets**: Table column showing test cases for each test

4. **API Integration** ✅
   - **Data Source (Test Runs)**: `/api/reporting/v1/launches/{launchId}/tests?projectId={projectId}`
   - **Schema**: Already supported via `testCases` field in `TestRunResponseSchema`
   - **Test Case Resolution**: `/test-cases/key:{testCaseId}?projectKey={projectKey}` via TCM client
   - **Format**: `{ testId, tcmType, testCaseId, resultStatus }` → resolved to `{ id, key, title, ... }`

**Technical Implementation:**

| Component | Implementation |
|-----------|----------------|
| **URL Builder** | `async buildTestCaseUrl(testCaseId, projectKey, baseUrl)` - resolves via TCM API |
| **TCM Resolution** | `tcmClient.getTestCaseByKey(projectKey, testCaseId)` → returns numeric `id` |
| **Formatter** | `async formatTestCases(testCases, projectKey, baseUrl, format)` - supports markdown & jira |
| **Link Format (Markdown)** | `[MCP-82](https://...)` |
| **Link Format (Jira)** | `[MCP-82\|https://...]` |
| **Multiple Cases** | Comma-separated list of all linked cases with individual resolution |
| **Error Handling** | Graceful fallback to numeric extraction if API call fails |

**Example Output:**

**Detailed Format:**
```markdown
## 📊 Executive Summary

- **Test Name:** loginScreenTest
- **Status:** ❌ FAILED
- **Root Cause:** Locator Issue
- **Confidence:** High
- **Stability:** 80%
- **Test Cases:** 📋 [MCP-1921](https://your-workspace.zebrunner.com/projects/MCP/test-cases/1921), [MCP-82](https://your-workspace.zebrunner.com/projects/MCP/test-cases/82)
- **Bug Status:** ❌ No Bug Linked

## 🔗 Linked Test Cases

- **[MCP-1921](https://...)** (Type: ZEBRUNNER)
- **[MCP-82](https://...)** (Type: ZEBRUNNER)

## 🔍 Quick Access Links

- **[Test Session](https://...)**
- **[Launch](https://...)**
- **[🎥 Test Execution Video](https://...)**
- **[📋 Test Case MCP-1921](https://...)**
- **[📋 Test Case MCP-82](https://...)**
```

**Jira Format:**
```
||Field||Value||
|Test Cases|[MCP-1921|https://...], [MCP-82|https://...]|

h3. Links

* [View Test in Zebrunner|https://...]
* [View Launch|https://...]
* [🎥 Test Execution Video|https://...]
* [📋 Test Case MCP-1921|https://...]
* [📋 Test Case MCP-82|https://...]
```

**Combined Jira Ticket:**
```
||Test ID||Test Name||Status||Test Cases||Video||
|5454462|loginScreenTest|FAILED|[MCP-1921|url], [MCP-82|url]|[🎥 Video|url]|
|5454472|logoutTest|FAILED|[MCP-1953|url]|[🎥 Video|url]|
```

**Benefits:**
- ✅ Easy navigation from failure analysis to test cases
- ✅ Full traceability between automation and TCM
- ✅ Consistent display across all formats
- ✅ Supports multiple test cases per automated test
- ✅ Clear warning when tests aren't linked to cases
- ✅ Ready for Jira paste with proper markup

## v5.2.6
- **🎫 Smart Jira Ticket Generation with Error Grouping** - Revolutionary fix for Jira format
- **🔍 Full Deep Analysis for Jira Format** - No more "Unknown" errors
- **🤖 Automatic Error Grouping** - Creates combined tickets for similar failures

**Critical Fixes:**

1. **Jira Format Now Works Properly** ✅
   - **Problem**: `format: 'jira'` in `detailed_analyze_launch_failures` was producing empty "Unknown" results
   - **Root Cause**: Tool was not calling `analyzeTestFailureById` with deep analysis
   - **Solution**: New `generateJiraTicketsForLaunch` method that:
     - Calls `analyzeTestFailureById` with `format: 'jira'` for EACH test
     - Gets full error messages, classifications, videos, similar failures
     - Groups tests with similar errors together
   - **Result**: Complete, rich Jira tickets ready to paste

2. **Smart Error Grouping** ✅
   - **Individual Tickets**: One test with unique error = one separate ticket
   - **Combined Tickets**: Multiple tests with same/similar error = one combined ticket
   - **Example**: If 3 tests fail with "Locator Issue", creates 1 ticket for all 3
   - **Benefit**: Fix once, resolve multiple failures

3. **New `jiraDetailLevel` Parameter** ✅
   - **`full`** (default): Comprehensive analysis with deep error classification
     - Calls `analyzeTestFailureById` for each test
     - Extracts full error details, root causes, recommendations
     - Smart grouping based on error similarity
     - ~30-60 seconds for 7 tests (thorough)
   - **`basic`**: Fast mode without deep analysis
     - Uses basic test run data
     - No individual test analysis calls
     - Quick Jira tickets (~5-10 seconds)
     - Less detail but faster

4. **Video + Screenshot Links** ✅
   - Every test includes video link (if available)
   - Last screenshot link (if available)
   - All links properly formatted for Jira markup
   - Authenticated URLs that work directly

**Technical Implementation:**

| Feature | Implementation |
|---------|----------------|
| **Deep Analysis** | `analyzeTestFailureById()` called with `format: 'jira'` for each test |
| **Error Grouping** | Groups by `errorClassification + first 150 chars of error message` |
| **Combined Tickets** | Creates table with all affected tests, common error, recommendations |
| **Individual Tickets** | Full Jira-formatted ticket from `generateJiraTicketForTest()` |
| **Video Links** | Uses `getVideoUrlForTest()` with test-sessions API |
| **Progress Updates** | Shows `Progress: 1/7 - Analyzing test...` during analysis |

**New Method:**
```typescript
generateJiraTicketsForLaunch({
  testRunId, launchName, projectKey, projectId,
  testsToAnalyze, detailLevel, includeScreenshotAnalysis,
  screenshotAnalysisType, baseUrl
})
  → Returns: Grouped Jira tickets (individual or combined based on similarity)
```

**Example Output Structure:**
```
# 🎫 Jira Tickets - Launch Android-Minimal-Acceptance

## Full Analysis - Generating Jira Tickets with Smart Grouping
Analyzing 7 tests to detect similar failures...
Progress: 1/7 - Analyzing test 5454462...
[... progress updates ...]
✅ Analysis complete. Grouping similar failures...

## 📊 Grouping Summary
- Total Tests Analyzed: 7
- Unique Error Patterns: 2
- Individual Tickets: 1
- Combined Tickets: 1

## 🎫 Ticket 1: loginScreenTest
**Type:** Individual Failure
**Affected Tests:** 1
### Jira Ticket Content (Copy & Paste)
[Full Jira markup with error, logs, video, recommendations]

## 🎫 Ticket 2: Multiple Tests - Locator Issue
**Type:** Combined Failure (Similar Root Cause)
**Affected Tests:** 6
### Jira Ticket Content (Copy & Paste)
[Combined Jira markup with table of all 6 tests, common error, videos for each]
```

**Benefits:**
- ✅ No more "Unknown" errors in Jira format
- ✅ Smart grouping reduces number of tickets to create
- ✅ Fix one root cause, resolve multiple test failures
- ✅ Video links for every test
- ✅ Configurable detail level (fast vs thorough)
- ✅ Progress updates so you know it's working
- ✅ Ready-to-paste Jira markup

## v5.2.5
- **🔧 Fixed Video URLs & Comprehensive Error Handling** - Major fixes for video retrieval and data handling
- **📺 New Test Sessions API** - Proper video URL extraction from artifact references

**Critical Fixes:**

1. **Video URL Retrieval** ✅
   - **Problem**: Videos were extracted incorrectly, causing errors and broken links
   - **Solution**: Now using `/api/reporting/v1/launches/{launchId}/test-sessions?testId={testId}&projectId={projectId}` API
   - **Removed**: Unnecessary S3 redirect resolution (Zebrunner URLs work directly with authentication)
   - **Result**: Video links now show as `https://your-workspace.zebrunner.com/artifacts/esg-test-sessions/.../video?projectId=7`

2. **Screenshot Error Handling** ✅
   - **Problem**: "Screenshots are not in proper JSON format" errors causing tool failures
   - **Solution**: Added comprehensive try-catch blocks with graceful fallbacks
   - **Behavior**: Returns empty array `[]` with warning instead of throwing errors
   - **Applied to**: `getTestLogsAndScreenshots()` and `getTestSessionsForTest()`

3. **"No result received" Error** ✅
   - **Problem**: Tool execution timing out or failing silently
   - **Solution**: Added error handling at multiple levels in `analyzeTestFailureById`
   - **Result**: Clear error messages instead of silent failures

4. **Schema Updates** ✅
   - **Updated**: `TestSessionResponseSchema` to support both old and new API structures
   - **Supports**: `platform` + `platformName`, `browser` + `browserName`, `device` + `deviceName`
   - **Added**: New fields: `initiatedAt`, `tests`, `durationInSeconds`, `artifactReferences`

**Technical Changes:**

| Change | Before | After |
|--------|--------|-------|
| **Video Extraction** | `extractVideoUrl()` + `resolveVideoUrl()` | `getVideoUrlForTest()` using test-sessions API |
| **Video URLs** | Attempted S3 redirect resolution | Direct Zebrunner proxy URLs |
| **Error Handling** | Throws exceptions | Returns empty data with warnings |
| **Screenshot Parsing** | Fails on bad JSON | Returns `{ items: [] }` |
| **Debug Logging** | Limited | Comprehensive with config.debug |

**New API Method:**
```typescript
getTestSessionsForTest(launchId, testId, projectId)
  → Returns: { items: [{ artifactReferences: [{ name: 'Video', value: 'artifacts/...' }] }] }
```

**Benefits:**
- ✅ No more "no result received" errors
- ✅ Video links work correctly
- ✅ Graceful handling of missing screenshots
- ✅ Better debug logging
- ✅ Cleaner, more maintainable code

## v5.2.3
- **🧹 Removed Backward Compatibility Fallbacks & Placeholder Data** - Clean production code
- **🔗 Fixed Launch URLs** - Now use correct format with project key
- **✅ All Data Now Real** - No mock or placeholder values in production

**Changes:**
- **Removed** all `/testrunner/` fallback URLs from production code
- **Removed** placeholder text `'YOUR_PROJECT'` from pagination instructions
- **Fixed** launch URLs to use proper format: `/projects/{projectKey}/automation-launches/{testRunId}`
- **Added** `getProjectKey(projectId)` method to resolve project key from ID
- **Enhanced** both `analyze_test_failure` and `detailed_analyze_launch_failures` to automatically resolve projectKey when only projectId is provided
- **Updated** all test session URLs to: `/tests/runs/{testRunId}/results/{testId}`

**Before:**
- ❌ `https://your-workspace.zebrunner.com/testrunner/120866` (incorrect)
- ❌ `projectKey: "YOUR_PROJECT"` in pagination (placeholder)
- ❌ Fallback logic with backward compatibility

**After:**
- ✅ `https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120866` (correct)
- ✅ `projectKey: "MCP"` - actual resolved value
- ✅ Automatic projectKey resolution when needed
- ✅ Clean code without fallbacks or mocks

**Impact:**
- All URLs now use the correct Zebrunner format
- All data in reports is real - no placeholders
- `projectKey` is automatically resolved from `projectId` when needed
- No more backward compatibility code or mock data cluttering production
- Legitimate defaults kept (empty arrays, 0 values, "Unknown" for missing data)


## v5.2.2
- **🎥 Video URL Resolution Fix** - Direct S3 URLs instead of proxy URLs
- **🎫 Jira-Ready Ticket Format** for `analyze_test_failure` and `detailed_analyze_launch_failures`

**Video Link Fix**:
- **Problem**: Video links were showing Zebrunner proxy URLs (`https://your-workspace.zebrunner.com/artifacts/esg-test-sessions/.../video?projectId=7`) instead of direct S3 URLs
- **Solution**: Added automatic redirect resolution to extract actual S3 signed URLs with AWS authentication
- **How it works**: Makes authenticated HEAD request to Zebrunner proxy URL, follows redirect to get S3 URL with signature
- **Result**: Video links now show direct playable URLs like `https://s3.us-east-2.amazonaws.com/zebrunner.com-engine/your-workspace/artifacts/test-sessions/.../video.mp4?X-Amz-Algorithm=...`
- **Applied to**: All formats (jira, detailed, summary)

**New Feature**: Generate Jira-ready tickets with one command using `format: 'jira'`

**What's Included:**

1. **Auto-Generated Ticket Title**
   - Intelligent title based on error classification and test name
   - Adds context: "(Consistently Failing)" or "(Flaky)" based on stability
   - For launches: Summarizes multiple tests with dominant issue

2. **Auto-Calculated Priority**
   - **Critical**: 0% stability or 3+ similar failures
   - **High**: <30% stability or 1+ similar failures
   - **Medium**: Default
   - **Low**: >70% stability

3. **Smart Labels**
   - `test-automation` (always)
   - Error classification (e.g., `locator-issue`, `timing-issue`)
   - `consistently-failing` (0% stability)
   - `flaky-test` (<50% stability)
   - `pattern-failure` (multiple similar failures)
   - Launch: `launch-failure`, `bulk-issue`, `multiple-patterns`, `critical-stability`

4. **Complete Jira Markup**
   - Metadata table with Priority, Labels, IDs, Stability
   - Description with clickable launch links
   - 🎥 **Prominent video recording panel** (if available)
   - Error Classification with confidence
   - Expected vs Actual
   - Steps to Reproduce (extracted from logs)
   - Error logs with truncation + link to full logs
   - Screenshots with thumbnail and links
   - Similar Failures warning panel
   - Prioritized Recommended Actions
   - Links section with Test, Launch, Video

5. **Video Links Enhancement** 🎥
   - **Automatic video detection** from artifacts or videoUrl field
   - **Clickable video links** in all formats (jira, detailed, summary)
   - **Jira format**: Prominent blue panel at top + links section
   - **Detailed format**: In Quick Access Links with 🎥 emoji
   - **Summary format**: Inline with emoji
   - Supports S3 URLs with authentication parameters

**Usage Examples:**

```typescript
// Single test - Jira format
analyze_test_failure({
  testId: 5451420,
  testRunId: 120806,
  projectKey: "MCP",
  format: "jira"
})

// Launch failures - Jira format
detailed_analyze_launch_failures({
  testRunId: 120814,
  projectKey: "MCP",
  format: "jira"
})
```

**Output Format:**
- Jira Wiki Markup (`h1.`, `h2.`, `{code}`, `{panel}`, `[link|url]`)
- Markdown code blocks for better compatibility
- Ready to copy-paste into Jira ticket description
- All links are clickable in Jira
- Videos show as `[🎥 Test Execution Video|URL]`

**Benefits:**
- ✅ Save 5-10 minutes per ticket
- ✅ Consistent ticket quality
- ✅ No manual formatting needed
- ✅ All context in one place
- ✅ Auto-prioritization based on data
- ✅ Clickable video links for quick review
- ✅ Works for both single test and launch-wide analysis


## v5.1.1
- **🧠 Intelligent Deep Analysis Enhancement** for `detailed_analyze_launch_failures`

**Problem Solved**: Tool provided basic summary requiring manual follow-up questions and multiple tool calls to get comprehensive analysis.

**Solution**: Added automatic deep synthesis with Claude-level intelligence built into the tool.

**Major Enhancements:**

1. **Executive Summary** - Automatic high-level findings
   - Total tests analyzed across error categories
   - Unique failure patterns detected
   - Average test stability with health indicators (🔴/🟡/🟢)
   - Most common issues highlighted

2. **Timeline Analysis** - When failures started appearing
   - Groups failures by date
   - Shows progression of issues
   - Identifies first occurrence patterns

3. **Pattern Analysis with Root Cause Grouping**
   - Categorizes failures by type (Locator, Timing, Business Logic, etc.)
   - Shows affected tests for each category
   - Includes stability percentages for each test
   - Provides root cause assessments

4. **Priority-Based Recommendations**
   - **🔴 HIGH Priority**: Issues affecting > 30% of tests
   - **🟡 MEDIUM Priority**: Issues affecting 2+ tests
   - **🟢 LOW Priority**: Single test issues
   - Shows impact, category, and affected tests for each
   - Includes stability data for prioritization

5. **Enhanced Individual Test Details**
   - Full error messages (300 chars)
   - Stack traces (expandable, 500 chars)
   - Stability percentages with health indicators
   - Failure timestamps
   - Classified root causes

6. **Questions for Follow-up** - Guides next steps
   - Suggests which issues to investigate first
   - Asks about checking related launches
   - Prompts for screenshot analysis if not enabled
   - Suggests code change investigation

**Output Example:**

```markdown
## 🎯 Executive Summary
- 10 failed tests analyzed across 2 distinct error categories
- 2 unique failure patterns detected  
- Average test stability: 45.0% (🔴 Critical)
- Most common issue: Locator Issue (affecting 8 tests)

## 📅 Timeline Analysis
**2 days with failures:**
**11/1/2025** (2 failures)
  - testA: Locator Issue
  - testB: Locator Issue
**11/3/2025** (8 failures)
  ...

## 🔬 Pattern Analysis
**1️⃣ Locator Issue** - 8 tests (80.0%) 🔴 HIGH
**Affected Tests:**
- Test 5451420: testProgressPageEmptyState (0% stability)
- Test 5451421: testProgressPageWithData (0% stability)
...
**Root Cause Assessment:** Element 'entriesListToSwipe' doesn't exist in empty state

## 🎯 Recommendations by Priority
### 🔴 HIGH Priority (Affects Multiple Tests)
**1. Fix locator 'entriesListToSwipe'**
   - Impact: 8 tests affected
   - Category: Locator Issue
   - Tests: [list with stability %]
```

**Technical Implementation:**
- Deep data extraction from all test analyses
- Cross-test pattern detection
- Timeline tracking and chronological sorting
- Priority calculation based on impact
- Comprehensive error and stack trace display

**Benefits:**
- ✅ **No manual follow-up needed** - Gets full picture immediately
- ✅ **Claude-level intelligence** - Automatic synthesis and grouping
- ✅ **Actionable insights** - Priority-based recommendations
- ✅ **Time savings** - One call instead of multiple
- ✅ **Better decisions** - See patterns across all failures at once


## v5.0.2
- **🚀 Advanced Failure Analysis & Launch-Wide Analysis** (2025-11-03)

**New Features**: Enhanced screenshot analysis in test failures + comprehensive launch-wide failure analysis

**Problem Solved**:
1. Screenshot analysis required manual tool invocation
2. No way to analyze all failures in a launch at once
3. Manual grouping of similar failures
4. Interrupting confirmation prompts for large launches

**Solution**: Automated screenshot analysis integrated into test failure reports + new intelligent bulk analysis tool

**Enhanced Tools:**

1. **`analyze_test_failure`** - Enhanced with integrated screenshot analysis
   - **New Parameter**: `analyzeScreenshotsWithAI: boolean` - Automatically download and analyze screenshots
   - **New Parameter**: `screenshotAnalysisType: 'basic' | 'detailed'` - Control analysis depth
   - Screenshots now analyzed inline with expandable details
   - Claude Vision analysis embedded directly in failure reports
   - No need to manually call `analyze_screenshot` separately

**New Tools:**

2. **`detailed_analyze_launch_failures`** - 🆕 Intelligent launch-wide failure analysis
   - **Smart Filtering by Default**: Analyzes only tests WITHOUT linked Jira issues (use `filterType: 'all'` to include all)
   - **Smart Default Behavior**: Analyzes ALL tests if ≤10, otherwise first 10 automatically
   - **No Confirmation Interrupts**: Starts analysis immediately
   - **Pagination When Needed**: Shows "Continue Analysis" section at bottom with next batch commands
   - **Similar Failure Grouping**: Groups tests with same error patterns
   - **Statistics Dashboard**: Breakdown by error category, pass/fail rates
   - **Top Recommendations**: Actionable fixes ranked by frequency
   - **Configurable Execution**: Sequential (safe), parallel (fast), or batches (balanced)
   - **Optional Screenshot Analysis**: Apply AI analysis to all test failures
   - **Flexible Output**: Detailed (full reports) or summary (key info only)

**Key Features of `detailed_analyze_launch_failures`:**
```typescript
// Simple call - analyzes tests WITHOUT linked issues (default)
// Analyzes first 10 if > 10 tests, all if ≤ 10
detailed_analyze_launch_failures({
  testRunId: 120806,
  projectKey: "MCP"
})

// To analyze ALL failed tests (including those with linked issues)
detailed_analyze_launch_failures({
  testRunId: 120806,
  projectKey: "MCP",
  filterType: "all"  // Include tests with Jira tickets
})

// With other options
detailed_analyze_launch_failures({
  testRunId: 120806,
  projectKey: "MCP",
  filterType: "without_issues",  // Explicit (this is default)
  format: "summary",              // Condensed output
  limit: 10,                      // Explicit limit
  offset: 10                      // Continue from test 11
})
```

**Output Includes:**
- 📊 Overview Statistics (total tests, failed tests, filter status)
- 📈 Failure Breakdown by Category (Locator Issues, Timing Issues, etc.)
- 🔄 Similar Failure Groups (tests with identical errors grouped)
- 🎯 Top Issues & Recommendations (actionable fixes ranked by impact)
- 📋 Individual Test Analysis (detailed or summary format)
- 📄 Pagination Support (analyze next 10, next 20, etc.)

**Use Cases:**
- **QA Managers**: Get overview of all failures in a launch
- **SDETs**: Identify patterns across multiple test failures
- **Developers**: Find tests affected by same bug
- **CI/CD**: Automated failure analysis in pipelines

**Technical Implementation:**
- Added async screenshot analysis to `generateFailureAnalysisReport()`
- New `analyzeLaunchFailures()` method with pagination logic
- Smart grouping by error message patterns
- Configurable execution modes (sequential/parallel/batches)
- Automatic confirmation for large analysis jobs

**Performance:**
- Sequential: ~2-3 seconds per test (safe, recommended)
- Parallel: ~0.5-1 second per test (fast, may hit rate limits)
- Batches: ~1-2 seconds per test (balanced approach)

**Files Changed:**
- `src/handlers/reporting-tools.ts` - Added `analyzeLaunchFailures()`, enhanced screenshot analysis
- `src/server.ts` - Registered `analyze_launch_failures` tool
- `package.json` - Version bump to 4.11.0

**Documentation:**
- Tool parameters and examples included in tool descriptions
- Pagination workflow documented
- Similar failure grouping explained

## v5.0.0
- **🎯 Screenshot Analysis & Visual Forensics** (2025-11-03)

**New Features**: Screenshot download and visual analysis capabilities

**Problem Solved**: Screenshots protected behind authentication, requiring manual login to Zebrunner and manual visual inspection.

**Solution**: Automated screenshot analysis with Claude Vision integration via MCP

**New Tools:**

1. **`download_test_screenshot`** - Download protected screenshots with authentication
   - Automatic authentication using existing Zebrunner token
   - Supports both full URLs and relative `/files/` paths
   - Returns image metadata (dimensions, format, size)
   - Optional base64 encoding

2. **`analyze_screenshot`** - Comprehensive visual analysis
   - **Basic Analysis**: Image metadata, dimensions, device detection
   - **OCR Text Extraction**: Extract visible text using Tesseract.js (optional)
   - **UI Element Detection**: Empty states, loading indicators, error dialogs, navigation
   - **Claude Vision Analysis**: Pass screenshots to Claude via MCP for AI-powered visual inspection
   - No separate Anthropic API key required (uses Claude Desktop/Code)

**Enhanced Tools:**
- **`analyze_test_failure`** - Now includes screenshot analysis suggestions

**Technical Implementation:**
- Added `sharp` for fast image processing
- Added `tesseract.js` for optional OCR
- Created `screenshot-analyzer.ts` utility module
- Enhanced `ZebrunnerReportingClient` with `downloadScreenshot()` method
- Leverages MCP image content type for Claude Vision
- Automatic temporary storage with cleanup

**Key Benefits:**
- ✅ No manual login required
- ✅ Automated visual analysis
- ✅ OCR text extraction
- ✅ Claude Vision insights
- ✅ No additional API costs
- ✅ Seamless MCP integration

**Documentation:**
- Added `docs/SCREENSHOT_ANALYSIS.md` with comprehensive guide
- Usage examples and workflows
- Performance optimization tips
- Troubleshooting guide

**Files Changed:**
- `src/api/reporting-client.ts` - Added `downloadScreenshot()` method
- `src/utils/screenshot-analyzer.ts` - New image analysis utilities
- `src/handlers/reporting-tools.ts` - Added new tool handlers
- `src/server.ts` - Registered new tools
- `src/types/reporting.ts` - Added screenshot analysis types
- `package.json` - Added sharp and tesseract.js dependencies

## v4.9.2
- Added automation priorities management tools with improved error handling, enhanced async operations, better logging


## v4.9.1
- Added `analyze_test_failure` tool to main server.ts (was only in server-with-reporting.ts)
- Fixed missing tool registration ensuring all users can access deep test failure analysis
- Added automation priorities management tools with improved error handling, enhanced async operations, better logging


## v4.9.0
- Added Deep Test Failure Analysis Tool (2025-11-03)

**New Feature**: `analyze_test_failure` - Comprehensive forensic analysis of failed tests

**Problem Solved**: Manual test failure investigation taking 15-20 minutes per failure, requiring multiple clicks through UI, log files, and screenshots.

**Solution**: Automated deep analysis tool that provides:
- **Complete Log Analysis**: Parse test execution logs, extract errors, warnings, and critical events
- **Screenshot Access**: Direct links to all screenshots with timestamps
- **Error Classification**: ML-assisted categorization (Locator Issue, Timing Issue, Business Issue, etc.)
- **Similar Failure Detection**: Find patterns across test failures in the same launch
- **Actionable Recommendations**: Specific steps to fix the issue based on error type
- **Comprehensive Report**: Markdown-formatted analysis with clickable links

**Key Features:**
- **Forensic Log Parsing**: Extract error logs, last actions before failure, critical events
- **Screenshot Timeline**: All screenshots with timestamps and direct viewing links
- **Error Classification**: Automatic categorization with confidence levels
- **Similar Failure Pattern**: Find other tests failing with the same error
- **Smart Recommendations**: Actionable steps based on failure type
- **Two Output Modes**: Detailed analysis or quick summary
- **Full Zebrunner Integration**: Direct links to test session, launch, and artifacts

**API Integration:**
- Uses new `/api/test-execution-logs/v1` endpoint for logs and screenshots
- Fetches test run details from reporting API
- Constructs clickable Zebrunner UI links

**Usage Examples:**
```typescript
// Detailed analysis (default)
analyze_test_failure({
  testId: 5451420,
  testRunId: 120806,
  projectKey: "MCP"
})

// Quick summary
analyze_test_failure({
  testId: 5451420,
  testRunId: 120806,
  projectKey: "MCP",
  format: "summary"
})

// Analysis without similar failures
analyze_test_failure({
  testId: 5451420,
  testRunId: 120806,
  projectKey: "MCP",
  analyzeSimilarFailures: false
})
```

**Output Includes:**
- Executive summary with root cause and confidence
- Test session details (duration, timestamps, owner)
- Error message and classification
- Log analysis (statistics, critical events, last actions)
- Screenshots with viewing links
- Similar failure patterns
- Root cause assessment
- Actionable recommendations
- Bug report suggestions
- Test stability context
- Quick access links to Zebrunner UI

**Performance**: Analysis completes in < 10 seconds vs 15-20 minutes manual investigation

**Success Metric**: Reduces test failure investigation time by 95%

---

## v4.8.188
- Added Lightweight Launch Test Summary Tool (2025-10-15)

**New Feature**: `get_launch_test_summary` - Token-optimized launch test analysis

**Problem Solved**: `get_launch_details` was returning 185K tokens, exceeding 25K limit

**Solution**: Flexible tool with multiple modes:
- **Summary-only mode**: ~1-2K tokens (statistics + top 20 unstable + issues)
- **Limited mode**: ~3-5K tokens (summary + N tests, configurable)
- **Full mode**: All tests without heavy arrays (labels/testCases excluded by default)

**Key Features:**
- **Smart defaults**: Labels and testCases excluded by default (can enable)
- **Limit parameter**: Return only N most unstable tests (e.g., limit: 10)
- **Summary-only mode**: Statistics without full test list
- **Stability-based sorting**: Most unstable first (0-100%)
- **Top 20 most unstable**: Always included for quick analysis
- **Filtering**: By status, stability range
- **Comprehensive statistics**: Test class breakdown, duration, issues

**Usage Examples:**
```typescript
// Recommended: Get first 10 tests (~3K tokens)
get_launch_test_summary({ projectKey: "MCP", launchId: 119783, limit: 10 })

// Ultra lightweight: Summary only (~1K tokens)
get_launch_test_summary({ projectKey: "MCP", launchId: 119783, summaryOnly: true })

// Get first 5 with full details
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  limit: 5,
  includeLabels: true,
  includeTestCases: true
})
```

**Files Modified:**
- `src/api/reporting-client.ts` - Added `getAllTestRuns()`
- `src/handlers/reporting-tools.ts` - Added configurable `getLaunchTestSummary()`
- `src/server.ts` - Registered `get_launch_test_summary` tool with new parameters
- `docs/LAUNCH_TEST_SUMMARY_TOOL.md` - Updated documentation

## v4.7.185 - Fixed Get Launch Details Feature (2025-10-15)

**Issue:** The `get_launch_details` tool was failing due to API data type mismatches in Zod schemas.

**Root Cause:**
- API sometimes returns numeric fields (timestamps, test counts) as strings instead of numbers
- Zod schemas were strictly typed as `z.number()`, causing validation failures

**Fix:**
1. **Updated all numeric fields to use `z.coerce.number()`** in `src/types/reporting.ts`:
   - `LaunchResponseSchema`: timestamps (`startedAt`, `endedAt`), test counts, elapsed time
   - `TestSessionResponseSchema`: timestamps and test counts
   - `LaunchListItemSchema`: timestamps and test counts

2. **Added support for Test Runs endpoint**:
   - Created `TestRunResponseSchema` and `TestRunsResponseSchema` for individual test executions
   - Added `getTestRuns()` method to `ZebrunnerReportingClient`
   - Endpoint: `/api/reporting/v1/launches/{launchId}/tests?projectId={projectId}`
   - Updated `getLauncherDetails()` handler to fetch test runs data with fallback to test sessions

3. **Benefits:**
   - Handles both string and numeric data types gracefully
   - Provides detailed test execution results (test runs) instead of just test sessions
   - Includes test metadata: owner, test class, test cases, labels, known issues, etc.
   - Better error handling with fallback to test sessions if test runs endpoint fails

**Files Modified:**
- `src/types/reporting.ts` - Updated schemas with coercion and added TestRun types
- `src/api/reporting-client.ts` - Added `getTestRuns()` method and imports
- `src/handlers/reporting-tools.ts` - Enhanced handler to fetch test runs
- `dist/**` - Rebuilt all compiled files

## v4.7.184
- Added new health test and potential LLM testing strategy document

## v4.7.182
- Added advanced test case search tools: title search, multi-criteria filtering, and automation priorities with improved error handling, enhanced async operations, better logging


## v4.7.179
- Advanced duplicate test case detection with semantic analysis with improved error handling, enhanced async operations, better logging


## v4.6.178
- Updated INSTALL-GUIDE.md with the more detailed steps


## v4.6.177
- Added comprehensive installation and setup documentation


## v4.6.176
- Added 1 new files with enhanced functionality



## v4.5.172
- Advanced duplicate test case detection with semantic analysis with improved error handling, enhanced async operations, better logging


This file tracks version changes and improvements to the MCP Zebrunner project.
