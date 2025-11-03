# Change Logs

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
