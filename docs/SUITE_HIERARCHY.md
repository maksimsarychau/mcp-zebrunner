# Suite Hierarchy Enhancement

## Overview

The Suite Hierarchy enhancement adds `featureSuiteId` and `rootSuiteId` fields to test case responses, providing complete suite hierarchy context for better test organization and analysis.

## Features

### 🆕 New Fields
- **`featureSuiteId`**: The immediate parent suite ID (from `testSuite.id`)
- **`rootSuiteId`**: The top-level root suite ID (resolved by traversing hierarchy)

### 🔧 New Parameter
- **`include_suite_hierarchy: boolean`**: Optional parameter to enable hierarchy resolution

## Test Case: PROJ-6013

### Known Values (for testing)
- **Test Case ID**: 81891
- **Key**: PROJ-6013
- **Feature Suite ID**: 18667 (from API response `testSuite.id`)
- **Root Suite ID**: 18659 (resolved by hierarchy traversal)

### API Response Structure
```json
{
  "data": {
    "id": 81891,
    "key": "PROJ-6013",
    "testSuite": {
      "id": 18667  // This becomes featureSuiteId
    },
    // ... other fields
  }
}
```

### Enhanced Response Structure
```json
{
  "id": 81891,
  "key": "PROJ-6013",
  "testSuite": {
    "id": 18667
  },
  "featureSuiteId": 18667,  // Added: immediate parent suite
  "rootSuiteId": 18659,     // Added: resolved root suite
  // ... other fields
}
```

## Usage Examples

### Basic Usage (Backward Compatible)
```typescript
const testCase = await client.getTestCaseByKey('PROJ', 'PROJ-6013');
// featureSuiteId and rootSuiteId will be undefined
```

### With Suite Hierarchy
```typescript
const testCase = await client.getTestCaseByKey('PROJ', 'PROJ-6013', { 
  includeSuiteHierarchy: true 
});
// featureSuiteId: 18667, rootSuiteId: 18659
```

### MCP Tools
All MCP tools now support the `include_suite_hierarchy` parameter:

```bash
# Get test case with hierarchy
get_test_case_by_key:
  case_key: "PROJ-6013"
  format: "markdown"
  include_suite_hierarchy: true

# Coverage analysis with hierarchy
get_test_coverage_by_test_case_steps_by_key:
  case_key: "PROJ-6013"
  implementation_context: "your test code"
  include_suite_hierarchy: true

# Draft test generation with hierarchy
generate_draft_test_by_key:
  case_key: "PROJ-6013"
  implementation_context: "framework hints"
  include_suite_hierarchy: true
```

## Hierarchy Path Resolution

### Get Complete Hierarchy Path
```typescript
const hierarchyPath = await client.getSuiteHierarchyPath('PROJ', 18667);
// Returns: [{id: 18659, name: "Root Suite"}, {id: 18667, name: "Feature Suite"}]
```

### Markdown Output Example
```markdown
## 📁 Suite Hierarchy

- **Root Suite ID**: 18659
- **Feature Suite ID**: 18667  
- **Test Suite ID**: 18667
- **Hierarchy Path**: Root Suite (18659) → Parent Suite (18XXX) → Feature Suite (18667) → Test Case
```

## Testing

### Run Suite Hierarchy Tests
```bash
# Run specific hierarchy tests
npm run test:hierarchy

# Run all integration tests (includes hierarchy)
npm run test:integration

# Build and run all tests
npm run build && npm test
```

### Test Coverage
The integration tests verify:
- ✅ Basic test case retrieval (backward compatibility)
- ✅ Hierarchy enhancement functionality  
- ✅ Hierarchy path resolution with names
- ✅ Error handling and graceful fallbacks
- ✅ API response structure validation
- ✅ Performance and timeout handling

## Implementation Details

### Hierarchy Resolution Algorithm
1. Extract `featureSuiteId` from `testSuite.id` in API response
2. Traverse up the suite hierarchy by calling `/test-suites/{id}` API
3. Follow `parentSuiteId` chain until reaching root (no parent)
4. Return both `featureSuiteId` and resolved `rootSuiteId`

### Safety Features
- **Loop Detection**: Prevents infinite loops in circular hierarchies
- **Depth Limit**: Maximum 20 levels to prevent excessive API calls
- **Graceful Fallbacks**: Returns available data even if hierarchy resolution fails
- **Error Handling**: Logs warnings but doesn't break main functionality

### Performance Considerations
- **Optional Feature**: Only makes additional API calls when requested
- **No Caching**: Fresh data on every request (as requested)
- **Timeout Handling**: Reasonable timeouts to prevent hanging
- **Minimal Impact**: Zero performance impact when hierarchy not requested

## Backward Compatibility

✅ **Fully Backward Compatible**
- All existing functionality works unchanged
- New fields are optional and undefined by default
- No breaking changes to existing APIs
- All tools maintain existing signatures

## File Structure

```
tests/integration/
└── suite-hierarchy.test.ts    # Comprehensive integration tests

src/api/
└── enhanced-client.ts         # Enhanced with hierarchy methods

src/types/
└── core.ts                   # Updated schema with new fields

src/server.ts                 # All MCP tools updated with hierarchy support

docs/
└── SUITE_HIERARCHY.md        # This documentation
```

## Future Enhancements

Potential future improvements:
- Hierarchy caching for better performance
- Batch hierarchy resolution for multiple test cases
- Suite name resolution in API responses
- Hierarchy visualization tools
