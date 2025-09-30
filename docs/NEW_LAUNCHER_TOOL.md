# New Launcher Details MCP Tool

## Overview

A new MCP tool `get_launch_details` has been implemented that uses the new Zebrunner Reporting API authentication method (access token → bearer token). This tool provides comprehensive launcher information including test sessions data.

## Features

### 🚀 **New Authentication Method**
- Uses `ZEBRUNNER_TOKEN` as access token
- Automatically exchanges access token for short-lived bearer tokens
- Token caching and automatic refresh
- Completely separate from existing TCM Public API authentication

### 📊 **Flexible Tool Parameters**
- **Project Resolution**: Accept either `projectKey` (e.g., "MFPAND") or `projectId` (e.g., 7)
- **Configurable Output**: Choose what to include:
  - `includeLaunchDetails`: Launch information (default: true)
  - `includeTestSessions`: Test sessions data (default: true)
- **Output Formats**: 'json', 'dto', or 'string'

### ⚡ **Performance Optimizations**
- Project ID caching (5-minute cache)
- Bearer token reuse until expiration
- Concurrent API request handling

### 🛡️ **Robust Error Handling**
- Graceful handling of missing launches
- Clear error messages for invalid projects
- Partial data return if some endpoints fail

## Tool Signatures

### `get_launch_details`
```typescript
{
  projectKey?: string,        // "MFPAND" (alternative to projectId)
  projectId?: number,         // 7 (alternative to projectKey)
  launchId: number,          // 118685
  includeLaunchDetails?: boolean,  // default: true
  includeTestSessions?: boolean,   // default: true
  format?: 'json' | 'dto' | 'string'  // default: 'json'
}
```

### `get_launcher_summary`
```typescript
{
  projectKey?: string,        // "MFPAND" (alternative to projectId)
  projectId?: number,         // 7 (alternative to projectKey)
  launchId: number,          // 118685
  format?: 'json' | 'dto' | 'string'  // default: 'json'
}
```

## Example Usage

### Full Details with Project Key
```bash
# Using the MCP tool
get_launch_details({
  projectKey: "MFPAND",
  launchId: 118685,
  includeLaunchDetails: true,
  includeTestSessions: true,
  format: "json"
})
```

### Quick Summary with Project ID
```bash
get_launcher_summary({
  projectId: 7,
  launchId: 118685,
  format: "json"
})
```

## Response Structure

### Launch Details Response
```json
{
  "launchId": 118685,
  "projectId": 7,
  "project": {
    "id": 7,
    "name": "MFP Android",
    "key": "MFPAND",
    "createdAt": "2023-09-11T17:43:13.337691Z"
  },
  "launch": {
    "id": 118685,
    "name": "Android-Critical-Flow-Test",
    "status": "FAILED",
    "startedAt": 1758640128931,
    "endedAt": 1758640619033,
    "framework": "testng",
    "environment": "PRODUCTION",
    "platform": "Android",
    "build": "myfitnesspal-develop-45891-qaRelease.apk",
    "passed": 21,
    "failed": 3,
    "skipped": 0
  },
  "testSessions": {
    "items": [
      {
        "id": 3319802,
        "name": "3e091289-ae60-426f-a1a9-53d0836fc3c3",
        "status": "COMPLETED",
        "platformName": "Android",
        "platformVersion": "13",
        "deviceName": "Galaxy_S21_Ultra",
        "durationInSeconds": 89
      }
    ]
  },
  "testSessionsSummary": {
    "totalSessions": 26,
    "statuses": { "COMPLETED": 26 },
    "platforms": { "Android": 26 },
    "browsers": {}
  }
}
```

## Running the Server

### Development (Default Server with Reporting Tools)
```bash
npm run dev
```

### Production (Default Server with Reporting Tools)
```bash
npm run build
npm run start
```

### Alternative: Separate Reporting Server
```bash
npm run dev:with-reporting    # Development
npm run start:with-reporting  # Production
```

### Testing
```bash
npm run test:reporting
```

## Implementation Details

### New Components
1. **`ZebrunnerReportingClient`** - Handles new authentication and reporting API
2. **`ZebrunnerReportingToolHandlers`** - MCP tool implementations
3. **`server-with-reporting.ts`** - Extended server with both APIs
4. **New Types** - Complete type definitions for reporting API responses

### Authentication Flow
```
1. ZEBRUNNER_TOKEN (access token) → /api/iam/v1/auth/refresh
2. Response: short-lived bearer token
3. Use bearer token for all reporting API calls
4. Automatic refresh when token expires
```

### API Endpoints Used
- `POST /api/iam/v1/auth/refresh` - Token exchange
- `GET /api/projects/v1/projects/{projectKey}` - Project lookup
- `GET /api/reporting/v1/launches/{launchId}?projectId={projectId}` - Launch details
- `GET /api/reporting/v1/launches/{launchId}/test-sessions?projectId={projectId}` - Test sessions

## Backward Compatibility

✅ **Fully backward compatible** - all existing tools continue to work unchanged
✅ **Separate authentication** - no impact on existing TCM Public API calls
✅ **Optional usage** - can use original server or extended server

## Testing Results

All tests passing:
- ✅ Authentication flow with access token
- ✅ Project lookup and caching
- ✅ Launch details retrieval
- ✅ Test sessions data
- ✅ Error handling
- ✅ Token management
- ✅ Concurrent requests
- ✅ Bash script workflow replication
