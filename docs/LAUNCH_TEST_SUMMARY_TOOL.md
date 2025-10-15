# Launch Test Summary Tool

## Overview

The `get_launch_test_summary` tool provides a **token-optimized** way to analyze launch test results. It automatically fetches all tests from all pages and provides comprehensive statistics while using minimal tokens (~5K vs 185K).

## Problem It Solves

The full `get_launch_details` tool returns complete test data which can exceed 185,000 tokens, far beyond the 25,000 token MCP limit. This new tool extracts only essential fields and provides smart aggregations.

## Key Features

### ✅ Auto-Pagination
- Automatically fetches ALL test runs from all pages
- No manual pagination needed
- Progress logging in debug mode

### ✅ Token-Optimized
- Extracts only essential fields
- Reduces response from ~185K to ~5K tokens
- Fits within MCP token limits

### ✅ Stability Analysis
- Tests sorted by stability (most unstable first)
- Stability shown as percentage (0-100%)
- Grouped into ranges: Critical (0-20%), Low (21-40%), Medium (41-60%), Good (61-80%), Excellent (81-100%)

### ✅ Comprehensive Statistics
- **By Status**: PASSED, FAILED, SKIPPED, ABORTED counts
- **By Test Class**: Count, average stability, failure count per class
- **Duration**: Total, average, min, max seconds
- **Issues**: Tests with issues, known issues, total issue references

### ✅ Smart Filtering
- Filter by status (e.g., only FAILED tests)
- Filter by stability range (min/max percentage)
- Sort by: stability, duration, or name

## Usage Examples

### Basic Usage - Get Summary + First 10 Tests (Recommended)

```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  limit: 10
})
```

**Returns:**
- Summary statistics
- First 10 tests (sorted by stability - most unstable first)
- Top 20 most unstable tests
- Tests with issues
- **Token usage: ~3-5K tokens** ✅

### Get Summary Only (Ultra Lightweight)

```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  summaryOnly: true
})
```

**Returns:**
- Summary statistics only
- Top 20 most unstable tests
- Tests with issues
- **Token usage: ~1-2K tokens** ✅✅

### Get All Tests (Use Carefully with Large Launches)

```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783
  // No limit = returns all tests
})
```

**Note:** For launches with 200+ tests, this may still exceed token limits. Use `limit` or `summaryOnly` instead.

### Filter Only Failed Tests

```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  statusFilter: ["FAILED"]
})
```

### Get Only Unstable Tests (< 50% stability)

```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  maxStability: 50,
  limit: 20  // Return first 20 unstable tests
})
```

### Get First 5 Tests with Full Details

```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  limit: 5,
  includeLabels: true,
  includeTestCases: true
})
```

### Get Critically Unstable Tests (< 20% stability)

```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  maxStability: 20,
  sortBy: "stability"
})
```

### Sort by Duration (Slowest First)

```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  sortBy: "duration"
})
```

## Response Structure

```json
{
  "launchId": 119783,
  "projectId": 7,
  "summary": {
    "totalTests": 24,
    "filteredTests": 24,
    "byStatus": {
      "PASSED": 23,
      "FAILED": 1
    },
    "byStabilityRange": {
      "critical_0-20": 1,
      "low_21-40": 0,
      "medium_41-60": 0,
      "good_61-80": 2,
      "excellent_81-100": 21
    },
    "byTestClass": {
      "": {
        "count": 3,
        "avgStability": 92,
        "failedCount": 0
      }
    },
    "testsWithIssues": 1,
    "testsWithKnownIssues": 1,
    "totalIssueReferences": 1,
    "totalDurationSeconds": 2500,
    "avgDurationSeconds": 104,
    "maxDurationSeconds": 420,
    "minDurationSeconds": 45,
    "avgStability": 94,
    "minStability": 10,
    "maxStability": 100
  },
  "tests": [
    {
      "id": 5406616,
      "name": "addExercisesFromMostUsedToDiaryTest",
      "status": "FAILED",
      "durationSeconds": 255,
      "startTime": 1760384016833,
      "finishTime": 1760384271783,
      "issueReferences": [
        {
          "id": 2798,
          "type": "JIRA",
          "value": "JIRA-2082"
        }
      ],
      "knownIssue": true,
      "testClass": "",
      "owner": "imikulich",
      "labels": [...],
      "testCases": [...],
      "stability": 10
    }
  ],
  "mostUnstableTests": [
    {
      "name": "addExercisesFromMostUsedToDiaryTest",
      "stability": 10,
      "status": "FAILED",
      "testClass": "",
      "knownIssue": true
    }
  ],
  "testsWithIssues": [
    {
      "name": "addExercisesFromMostUsedToDiaryTest",
      "status": "FAILED",
      "issues": [
        {
          "id": 2798,
          "type": "JIRA",
          "value": "JIRA-2082"
        }
      ],
      "stability": 10
    }
  ]
}
```

## Essential Fields Extracted

For each test, only these essential fields are extracted:

- **name**: Test name
- **status**: PASSED, FAILED, SKIPPED, etc.
- **durationSeconds**: Duration in seconds (calculated from startTime and finishTime)
- **startTime**: Start timestamp (ms)
- **finishTime**: End timestamp (ms)
- **issueReferences**: Array of linked issues (JIRA, etc.)
- **knownIssue**: Boolean flag
- **testClass**: Test class name
- **owner**: Test owner/maintainer
- **labels**: Array of labels/tags
- **testCases**: Array of linked test cases
- **stability**: Stability percentage (0-100)

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectKey` | string | - | Project key (e.g., 'MCP') |
| `projectId` | number | - | Project ID (alternative to projectKey) |
| `launchId` | number | - | Launch ID (required) |
| `statusFilter` | string[] | - | Filter by status (e.g., ['FAILED', 'SKIPPED']) |
| `minStability` | number | - | Minimum stability % (0-100) |
| `maxStability` | number | - | Maximum stability % (0-100) |
| `sortBy` | enum | 'stability' | Sort order: 'stability', 'duration', 'name' |
| `limit` | number | - | Limit tests returned (e.g., 10 for first 10 tests) |
| `summaryOnly` | boolean | false | Return only statistics (most lightweight) |
| `includeLabels` | boolean | false | Include labels array (increases tokens) |
| `includeTestCases` | boolean | false | Include testCases array (increases tokens) |
| `format` | enum | 'json' | Output format: 'json', 'dto', 'string' |

## Use Cases

### 1. Find Most Unstable Tests
```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  sortBy: "stability"
})
// Returns tests sorted from 0% (most unstable) to 100% (most stable)
```

### 2. Analyze Failures
```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  statusFilter: ["FAILED"],
  sortBy: "stability"
})
// Returns only failed tests, sorted by stability
```

### 3. Find Flaky Tests
```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  minStability: 20,
  maxStability: 80
})
// Returns tests with 20-80% stability (potential flaky tests)
```

### 4. Get Slowest Tests
```typescript
get_launch_test_summary({
  projectKey: "MCP",
  launchId: 119783,
  sortBy: "duration"
})
// Returns tests sorted by duration (slowest first)
```

### 5. Review Known Issues
```typescript
// The response always includes "testsWithIssues" section
// showing all tests with linked issues
```

## Comparison with Other Tools

| Feature | `get_launch_details` | `get_launch_test_summary` | `get_launch_summary` |
|---------|---------------------|--------------------------|---------------------|
| Token usage | ~185K | ~5K | ~1K |
| Auto-pagination | ✅ | ✅ | ❌ |
| Full test data | ✅ | ❌ | ❌ |
| Essential fields | ❌ | ✅ | ❌ |
| Statistics | ❌ | ✅ | ✅ |
| Stability analysis | ❌ | ✅ | ❌ |
| Test filtering | ❌ | ✅ | ❌ |
| Test list | ✅ | ✅ | ❌ |

## Best Practices

1. **Use for large launches**: When launch has > 20 tests
2. **Filter early**: Use statusFilter to reduce response size further
3. **Focus on stability**: Sort by stability to quickly identify problematic tests
4. **Review statistics**: Check byTestClass to identify problematic test suites
5. **Track issues**: Use testsWithIssues section to ensure all failures are tracked

## Example Workflow

1. **Get overview**: Use `get_launch_summary` to see high-level stats
2. **Analyze tests**: Use `get_launch_test_summary` to get detailed test analysis
3. **Focus on failures**: Add `statusFilter: ["FAILED"]` to drill down
4. **Review stability**: Check mostUnstableTests to prioritize fixes
5. **Track issues**: Ensure all failures have linked issues

## Notes

- Stability is shown as percentage: 0 = 0%, 1 = 100%
- Duration is calculated automatically from startTime/finishTime
- Tests are always sorted by stability (most unstable first) by default
- Auto-pagination fetches all pages automatically (no manual pagination needed)

