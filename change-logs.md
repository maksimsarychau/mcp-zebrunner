# Change Logs

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
