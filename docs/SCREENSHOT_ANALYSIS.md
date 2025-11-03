# Screenshot Analysis & Visual Forensics

## Overview

The MCP Zebrunner server now includes powerful screenshot analysis capabilities that allow you to download, analyze, and visually inspect test failure screenshots directly through Claude Desktop or Claude Code - without needing a separate Anthropic API key.

## Problem Solved

**Before:**
- ❌ Screenshots protected behind authentication
- ❌ Manual login to Zebrunner required
- ❌ No automated visual analysis
- ❌ Time-consuming manual inspection

**After:**
- ✅ Automatic authenticated screenshot download
- ✅ Image metadata extraction
- ✅ Optional OCR text extraction
- ✅ Claude Vision analysis via MCP
- ✅ No separate API key needed

## Available Tools

### 1. `download_test_screenshot`

Download screenshots from Zebrunner with authentication.

**Parameters:**
```typescript
{
  screenshotUrl: string,           // Required: URL to screenshot
  testId?: number,                  // Optional: Test ID for context
  projectKey?: string,              // Optional: Project key
  outputPath?: string,              // Optional: Custom save location
  returnBase64?: boolean            // Optional: Return as base64
}
```

**Example:**
```typescript
download_test_screenshot({
  screenshotUrl: "https://your-workspace.zebrunner.com/files/19a3c384-a06a-10d7-1aa1-cf9c3244b021",
  testId: 5451420,
  projectKey: "MCP"
})
```

**Response:**
```json
{
  "success": true,
  "screenshotUrl": "https://your-workspace.zebrunner.com/files/...",
  "localPath": "/tmp/mcp-zebrunner/screenshots/screenshot_test5451420_1699123456789.png",
  "metadata": {
    "fileSize": 245678,
    "format": "png",
    "dimensions": {
      "width": 1080,
      "height": 2340
    },
    "orientation": "portrait",
    "aspectRatio": "9:19"
  },
  "testId": 5451420,
  "projectKey": "MCP"
}
```

### 2. `analyze_screenshot`

Perform visual analysis with optional OCR and Claude Vision.

**Parameters:**
```typescript
{
  screenshotUrl?: string,           // Option 1: URL to download
  screenshotPath?: string,          // Option 2: Local file path
  testId?: number,                  // Optional: Test context
  enableOCR?: boolean,              // Default: false (slower if enabled)
  analysisType?: 'basic' | 'detailed',  // Default: 'detailed'
  expectedState?: string            // Optional: Expected UI state
}
```

**Example (Basic):**
```typescript
analyze_screenshot({
  screenshotUrl: "https://your-workspace.zebrunner.com/files/19a3c384-a06a-10d7-1aa1-cf9c3244b021",
  testId: 5451420,
  analysisType: "basic"
})
```

**Example (Detailed with Claude Vision):**
```typescript
analyze_screenshot({
  screenshotUrl: "https://your-workspace.zebrunner.com/files/19a3c384-a06a-10d7-1aa1-cf9c3244b021",
  testId: 5451420,
  enableOCR: true,
  analysisType: "detailed",
  expectedState: "Progress page with weight entries list visible"
})
```

**Response (Basic):**
```markdown
# Screenshot Analysis Report

## 📊 Basic Information
- **Dimensions:** 1080x2340 (portrait)
- **Format:** PNG
- **File Size:** 240 KB
- **Aspect Ratio:** 9:19

## 📱 Device Information
- **Detected Device:** Galaxy S24
- **Device Type:** Phone
- **Orientation:** portrait

## 📝 Extracted Text (OCR)
**Confidence:** 87%
```
My Progress
Start tracking your progress
Add your first weight entry...
+ Add Entry
```

## 🔍 UI Elements Detected
- ✅ Empty State
- 🧭 Navigation Bar

## 🎯 Expected State Comparison
**Expected:** Progress page with weight entries list visible
⚠️ **Actual State:** Empty state detected - no data displayed
```

**Response (Detailed):**

When using `analysisType: "detailed"`, the tool returns:
1. Text analysis (as above)
2. **The actual screenshot image** passed to Claude via MCP
3. A prompt asking Claude to analyze the image

This means Claude will see the screenshot and can provide detailed visual analysis like:
- Identifying specific UI elements
- Detecting error messages
- Comparing with expected state
- Explaining visual anomalies

## Integration with Test Failure Analysis

The `analyze_test_failure` tool automatically includes screenshot links and suggests using `analyze_screenshot` for detailed visual forensics:

```typescript
analyze_test_failure({
  testId: 5451420,
  testRunId: 120806,
  projectKey: "MCP"
})
```

Output includes:
```markdown
## 📸 Screenshots

**Total Screenshots:** 2

### Latest Screenshot Before Failure
- **Timestamp:** 9:41:53 PM
- **URL:** [View Screenshot](https://your-workspace.zebrunner.com/files/...)

💡 **Tip:** Use `analyze_screenshot` tool with this URL for detailed visual analysis including:
- Device and screen information
- OCR text extraction
- Claude Vision AI analysis
- UI element detection
```

## Workflow Examples

### Workflow 1: Quick Screenshot Check

```typescript
// Step 1: Analyze test failure
analyze_test_failure({
  testId: 5451420,
  testRunId: 120806,
  projectKey: "MCP"
})

// Step 2: Get screenshot URL from output, then analyze
analyze_screenshot({
  screenshotUrl: "https://your-workspace.zebrunner.com/files/...",
  analysisType: "detailed",
  expectedState: "Weight entry should be visible in list"
})

// Step 3: Claude sees the screenshot and provides visual analysis
```

### Workflow 2: OCR Text Extraction

```typescript
// Useful for reading error messages or UI text
analyze_screenshot({
  screenshotUrl: "https://your-workspace.zebrunner.com/files/...",
  enableOCR: true,
  analysisType: "basic"  // Just text, no Claude Vision
})
```

### Workflow 3: Download for External Analysis

```typescript
// Download to local file
download_test_screenshot({
  screenshotUrl: "https://your-workspace.zebrunner.com/files/...",
  outputPath: "/Users/qa/screenshots/test_5451420.png"
})
```

## Technical Details

### Authentication

Screenshots are downloaded using the existing Zebrunner authentication:
- Uses Bearer token from `ZEBRUNNER_TOKEN` environment variable
- Automatically refreshes expired tokens
- Same authentication as other MCP tools

### Image Processing

**Dependencies:**
- `sharp` (v0.33.5) - Fast image metadata extraction
- `tesseract.js` (v5.1.1) - Optional OCR (only loaded when `enableOCR: true`)

**Performance:**
- Download: < 2 seconds
- Basic metadata: < 100ms
- OCR extraction: 3-10 seconds (optional)
- Claude Vision: Depends on Claude response time

### Storage

Screenshots are temporarily saved to:
```
$SCREENSHOT_DOWNLOAD_DIR || /tmp/mcp-zebrunner/screenshots/
```

Files are named: `screenshot_test{testId}_{timestamp}.{format}`

**Automatic Cleanup:**
- Files older than 1 hour are automatically deleted
- Can be configured via environment variables

### MCP Image Passing

The `detailed` analysis type uses MCP's native image support:

```typescript
// Tool returns multiple content items:
[
  { type: "text", text: "Analysis report..." },
  { type: "image", data: base64Image, mimeType: "image/png" },
  { type: "text", text: "Please analyze this screenshot..." }
]
```

This allows Claude to see the actual screenshot without needing a separate Anthropic API key.

## Configuration

### Environment Variables

```bash
# Required (already configured for other tools)
ZEBRUNNER_URL=https://your-workspace.zebrunner.com
ZEBRUNNER_TOKEN=your_token_here

# Optional screenshot-specific
SCREENSHOT_DOWNLOAD_DIR=/tmp/mcp-zebrunner/screenshots
SCREENSHOT_CACHE_TTL=3600  # 1 hour in seconds
SCREENSHOT_MAX_SIZE=10485760  # 10MB
```

### Claude Desktop Configuration

No additional configuration needed! The tools work automatically through MCP in Claude Desktop or Claude Code.

## Capabilities

### ✅ What It Can Do

1. **Download Protected Screenshots**
   - Authenticated access to Zebrunner files
   - Works with any `/files/` URL
   - Automatic format detection

2. **Extract Image Metadata**
   - Dimensions and orientation
   - File size and format
   - Aspect ratio calculation
   - Device detection (Galaxy S24, iPhone 15, etc.)

3. **OCR Text Extraction** (Optional)
   - Extract visible text from screenshots
   - Confidence scores per word
   - Line-by-line text output
   - Supports multiple languages

4. **UI Element Detection**
   - Empty state detection
   - Loading indicators
   - Error dialogs
   - Navigation elements

5. **Claude Vision Analysis**
   - Pass screenshots directly to Claude
   - Context-aware prompts
   - Detailed visual forensics
   - UI state comparison

### ❌ Limitations

1. **OCR Accuracy**
   - Works best with clear, high-contrast text
   - May struggle with handwriting or stylized fonts
   - Performance depends on image quality

2. **Device Detection**
   - Based on screen dimensions
   - May misidentify similar devices
   - Limited to common devices in database

3. **No Video Analysis**
   - Only static screenshots supported
   - Video artifacts not yet supported

4. **No Page Source Parsing**
   - XML/HTML analysis not included (future enhancement)

## Troubleshooting

### Error: "Failed to download screenshot"

**Possible Causes:**
- Invalid screenshot URL
- Expired authentication token
- Screenshot has been deleted
- Network connectivity issues

**Solutions:**
```typescript
// Verify the URL is correct
download_test_screenshot({
  screenshotUrl: "https://your-workspace.zebrunner.com/files/valid-id-here"
})

// Check authentication
test_reporting_connection()
```

### Error: "OCR extraction failed"

**Possible Causes:**
- Tesseract.js not properly initialized
- Image format not supported
- Memory constraints

**Solutions:**
```typescript
// Try without OCR first
analyze_screenshot({
  screenshotUrl: "...",
  enableOCR: false  // Disable OCR
})

// If needed, enable OCR with retry
analyze_screenshot({
  screenshotUrl: "...",
  enableOCR: true
})
```

### Screenshots Not Showing in Claude

**Cause:** Using `analysisType: "basic"`

**Solution:**
```typescript
// Use "detailed" to pass image to Claude
analyze_screenshot({
  screenshotUrl: "...",
  analysisType: "detailed"  // This passes image to Claude
})
```

## Performance Optimization

### Best Practices

1. **Use Basic Analysis First**
   ```typescript
   // Fast: No OCR, no Claude Vision
   analyze_screenshot({ 
     screenshotUrl: "...", 
     analysisType: "basic",
     enableOCR: false
   })
   ```

2. **Enable OCR Only When Needed**
   ```typescript
   // Slower but thorough
   analyze_screenshot({ 
     screenshotUrl: "...", 
     enableOCR: true  // Only if you need text
   })
   ```

3. **Cache Downloaded Screenshots**
   - Screenshots are cached for 1 hour
   - Repeated analysis uses cached version
   - No need to download multiple times

4. **Batch Analysis**
   ```typescript
   // Analyze multiple screenshots in parallel
   const urls = [url1, url2, url3];
   const analyses = await Promise.all(
     urls.map(url => analyze_screenshot({ screenshotUrl: url }))
   );
   ```

## Cost Considerations

### Free (No Additional Costs)

- ✅ Screenshot download: Free
- ✅ Metadata extraction: Free
- ✅ Basic analysis: Free
- ✅ Claude Vision via MCP: **Free** (uses your Claude Desktop/Code subscription)

### Optional (Only if enabled)

- OCR text extraction: Free but slower (uses tesseract.js locally)

**No separate Anthropic API key required!**

## Future Enhancements

Planned for future versions:

1. **Screenshot Comparison**
   - Before/after comparison
   - Diff highlighting
   - Visual change detection

2. **Page Source Analysis**
   - XML/HTML element tree
   - Missing element detection
   - Alternative locator suggestions

3. **Video Analysis**
   - Frame extraction
   - Key moment detection
   - Failure point identification

4. **Advanced UI Detection**
   - ML-powered element recognition
   - Layout analysis
   - Accessibility checks

5. **Historical Analysis**
   - Compare with last successful run
   - Track UI changes over time
   - Pattern recognition

## Examples

### Example 1: Investigate Empty State

```typescript
// Test failure shows empty state instead of data
analyze_screenshot({
  screenshotUrl: "https://your-workspace.zebrunner.com/files/...",
  enableOCR: true,
  analysisType: "detailed",
  expectedState: "Weight entries list with at least one entry"
})
```

**Claude Response:**
> "The screenshot shows the Progress page in an empty state. The UI displays:
> - Header: 'My Progress'
> - Empty state message: 'Start tracking your progress'
> - Call-to-action: '+ Add Entry' button
> - Bottom navigation bar (Progress tab active)
>
> **Root Cause:** The weight entry list is not rendered because there are no entries to display. The element `entriesListToSwipe` doesn't exist in empty state.
>
> **Recommendation:** The test should verify data was saved before attempting to interact with the list."

### Example 2: Error Dialog Detection

```typescript
analyze_screenshot({
  screenshotUrl: "https://your-workspace.zebrunner.com/files/...",
  enableOCR: true,
  analysisType: "detailed"
})
```

**Claude Response:**
> "I can see an error dialog in the screenshot:
> - Title: 'Connection Error'
> - Message: 'Unable to sync your data. Please check your internet connection.'
> - Button: 'Retry'
>
> **Root Cause:** Network connectivity issue during test execution.
>
> **Recommendation:** Add network stability checks or retry logic in the test."

## Summary

Screenshot analysis transforms test failure investigation by:

- ✅ **Eliminating manual screenshot inspection** (save 5-10 minutes per failure)
- ✅ **Providing visual evidence** with AI-powered analysis
- ✅ **Identifying UI states automatically** (empty, error, loading)
- ✅ **No additional API costs** (uses Claude Desktop/Code via MCP)
- ✅ **Seamless integration** with existing failure analysis

Use `analyze_screenshot` whenever you need to understand what the UI actually showed during a test failure!

