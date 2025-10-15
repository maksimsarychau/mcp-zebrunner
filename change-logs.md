# Change Logs

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
