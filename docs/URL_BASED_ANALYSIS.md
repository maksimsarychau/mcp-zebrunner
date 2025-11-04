# 🔗 Smart URL-Based Analysis Guide

> **NEW in v5.5.0**: Claude can automatically detect Zebrunner URLs and analyze them with optimal settings!

## 🎯 Overview

Instead of manually extracting IDs and calling tools, just paste a Zebrunner URL in your conversation with Claude. Claude will automatically:
1. **Detect** the URL pattern (test or launch)
2. **Extract** relevant parameters (projectKey, testRunId, testId)
3. **Route** to the appropriate analysis tool
4. **Apply** optimal default settings (videos, screenshots, AI analysis)

## 📋 Supported URL Patterns

### 1. Test Analysis URLs

**Pattern:**
```
https://workspace.zebrunner.com/projects/PROJECT/automation-launches/LAUNCH_ID/tests/TEST_ID
```

**Example:**
```
https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455386
```

**What Claude Does:**
- Calls `analyze_test_failure` tool
- Extracts: `projectKey: "MCP"`, `testRunId: 120911`, `testId: 5455386`
- Applies defaults:
  - ✅ `includeVideo: true`
  - ✅ `analyzeScreenshotsWithAI: true`
  - ✅ `includeLogs: true`
  - ✅ `includeScreenshots: true`
  - ✅ `includeArtifacts: true`
  - ✅ `analyzeSimilarFailures: true`
  - ✅ `screenshotAnalysisType: "detailed"`
  - ✅ `format: "detailed"`

### 2. Launch Analysis URLs

**Pattern:**
```
https://workspace.zebrunner.com/projects/PROJECT/automation-launches/LAUNCH_ID
```

**Example:**
```
https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911
```

**What Claude Does:**
- Calls `detailed_analyze_launch_failures` tool
- Extracts: `projectKey: "MCP"`, `testRunId: 120911`
- Applies defaults:
  - ✅ `filterType: "without_issues"` (tests without linked Jira tickets)
  - ✅ `includeScreenshotAnalysis: true`
  - ✅ `screenshotAnalysisType: "detailed"`
  - ✅ `format: "summary"`
  - ✅ `executionMode: "sequential"`

## ✨ Usage Examples

### Example 1: Simple Test Analysis

**User:**
```
Analyze https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455386
```

**Claude:**
- Detects test URL pattern
- Extracts parameters automatically
- Calls `analyze_test_failure` with all diagnostics enabled
- Returns comprehensive failure analysis with:
  - 📊 Error classification
  - 📝 Full logs
  - 🖼️ Screenshots with AI analysis
  - 🎥 Video recording
  - 🔍 Similar failures
  - 💡 Recommendations

### Example 2: Launch Analysis

**User:**
```
Check https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911
```

**Claude:**
- Detects launch URL pattern
- Extracts projectKey and testRunId
- Calls `detailed_analyze_launch_failures`
- Returns:
  - 📊 Overview statistics
  - 🔬 Pattern analysis
  - 📈 Failure breakdown
  - 🎯 Recommendations
  - 📋 Individual test analyses

### Example 3: With Natural Language Overrides

**User:**
```
Generate JIRA ticket for https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455386 without screenshots
```

**Claude:**
- Detects URL and extracts parameters
- Recognizes "JIRA ticket" intent → `format: "jira"`
- Recognizes "without screenshots" → `analyzeScreenshotsWithAI: false`
- Returns Jira-formatted ticket ready to create

**User:**
```
Quick analysis of https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455386
```

**Claude:**
- Detects "quick" intent
- Applies: `format: "summary"`, `screenshotAnalysisType: "basic"`
- Returns concise summary

### Example 4: Multiple URLs (Comparison)

**User:**
```
Compare these failures:
https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455386
https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455390
```

**Claude:**
- Detects both URLs
- Analyzes each test sequentially
- Compares:
  - Error patterns
  - Classifications
  - Similarities
  - Common root causes
- Provides unified comparison report

### Example 5: Mixed Context

**User:**
```
Why did this fail? https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455386

Is it related to recent code changes?
```

**Claude:**
- Detects URL and analyzes the test
- Provides failure explanation
- Checks similar failures timeline
- Suggests if it's a new vs. recurring issue
- Recommends checking recent commits in affected areas

## 🎨 Natural Language Override Patterns

Claude recognizes these intent patterns:

| User Intent | Detected Keywords | Parameter Overrides |
|-------------|-------------------|---------------------|
| JIRA ticket | "jira", "create ticket", "jira format" | `format: "jira"` |
| Quick check | "quick", "summary", "brief" | `format: "summary"`, `screenshotAnalysisType: "basic"` |
| No screenshots | "without screenshots", "skip screenshots" | `analyzeScreenshotsWithAI: false` |
| All tests | "all tests", "including linked" | `filterType: "all"` |
| Basic analysis | "basic", "simple" | `screenshotAnalysisType: "basic"` |
| Detailed | "detailed", "comprehensive", "full" | `format: "detailed"`, `screenshotAnalysisType: "detailed"` |

## 🌍 Cross-Workspace Support

URLs from different Zebrunner workspaces will trigger a warning but still attempt analysis:

**User:**
```
Analyze https://other-company.zebrunner.com/projects/PROJ/automation-launches/12345/tests/67890
```

**Claude:**
- ⚠️ Warns: "URL is from 'other-company.zebrunner.com' but configured workspace is 'your-workspace.zebrunner.com'"
- Attempts analysis using configured credentials
- May fail if credentials don't have access to that workspace

## 📖 URL Component Reference

```
https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455386
       ├──────────────────┤ ├─────┤                    ├─────┤       ├──────┤
       │                   │                            │             │
       Workspace           Project Key                  Launch ID     Test ID
       (validated)         (extracted)                  (extracted)   (extracted)
```

| Component | Description | Used In | Validation |
|-----------|-------------|---------|------------|
| Workspace | Zebrunner instance domain | Validation warning | Compared to `ZEBRUNNER_URL` |
| Project Key | Project identifier (e.g., MCP) | `projectKey` parameter | Required, min 1 char |
| Launch ID | Test run/launch identifier | `testRunId` parameter | Required, positive integer |
| Test ID | Individual test identifier | `testId` parameter | Required for test URLs |

## 💡 Pro Tips

1. **Direct from Browser**: Copy URLs directly from Zebrunner UI tabs - no manual ID extraction needed

2. **Batch Analysis**: Paste multiple URLs separated by newlines for batch processing
   ```
   Check these:
   https://...test-1...
   https://...test-2...
   https://...test-3...
   ```

3. **Custom Settings**: Add natural language hints to customize analysis
   ```
   Quick check of https://...url... without videos
   ```

4. **Why Questions**: Works great with conversational queries
   ```
   Why did https://...url... fail? Is it a flake?
   ```

5. **Report Generation**: Combine with format requests
   ```
   Create JIRA ticket for https://...url... with full details
   ```

6. **Trend Analysis**: Ask follow-up questions after URL analysis
   ```
   User: "Analyze https://...url..."
   Claude: [provides analysis]
   User: "Has this been failing consistently?"
   Claude: [checks similar failures timeline]
   ```

7. **Pattern Detection**: Let Claude identify patterns across multiple URLs
   ```
   User: "What's common between these failures?"
   [paste 3-5 test URLs]
   ```

## 🚀 Getting Started

### Step 1: Ensure MCP Server is Running

Make sure your MCP Zebrunner server (v5.5.0+) is configured and running with Claude Desktop/Code.

### Step 2: Copy a URL from Zebrunner

Navigate to a failed test or launch in Zebrunner UI and copy the URL from your browser.

### Step 3: Paste in Claude

Just paste the URL with a simple request:
```
Analyze https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120911/tests/5455386
```

### Step 4: Review Results

Claude will automatically:
- Detect and parse the URL
- Call the appropriate tool
- Present comprehensive analysis

### Step 5: Ask Follow-ups

Continue the conversation naturally:
```
"Is this a recurring issue?"
"What's the recommended fix?"
"Create a JIRA ticket for this"
```

## ❓ FAQ

### Q: Do I need to configure anything?
**A:** No! If your MCP Zebrunner server (v5.5.0+) is already configured with Claude, URL detection works automatically.

### Q: What if I paste a URL from a different workspace?
**A:** Claude will show a warning but still attempt analysis. It may fail if your credentials don't have access.

### Q: Can I override the default settings?
**A:** Yes! Just add natural language hints like "without screenshots" or "in jira format" in your request.

### Q: How many URLs can I analyze at once?
**A:** Claude will analyze all URLs you provide. For large batches (10+), consider analyzing in smaller groups for better response time.

### Q: Does this work with old Zebrunner URL formats?
**A:** Only the current format is supported:
- ✅ `https://workspace.zebrunner.com/projects/PROJECT/automation-launches/LAUNCH_ID/tests/TEST_ID`
- ❌ Legacy formats (e.g., `/testrunner/ID`) are not automatically detected

### Q: What if URL parsing fails?
**A:** Claude will show a clear error message with the expected URL format and ask you to provide the IDs manually.

## 🔧 Troubleshooting

### URL Not Recognized

**Symptom:** Claude doesn't automatically analyze the URL

**Solutions:**
1. Ensure URL matches the expected pattern exactly
2. Check that you're using v5.5.0+ of mcp-zebrunner
3. Restart Claude Desktop/Code if just upgraded
4. Try adding explicit context: "Analyze this Zebrunner URL: [url]"

### Wrong Tool Called

**Symptom:** Claude calls wrong analysis tool for your URL

**Solutions:**
1. Verify URL format (test URLs must include `/tests/TEST_ID`)
2. Add explicit intent: "Analyze this TEST failure: [url]" or "Analyze this LAUNCH: [url]"

### Analysis Fails

**Symptom:** URL is parsed but analysis fails

**Solutions:**
1. Check that test/launch ID exists in Zebrunner
2. Verify your credentials have access to that project
3. Confirm the URL workspace matches your configured `ZEBRUNNER_URL`
4. Check server logs for detailed error messages

## 📚 Related Documentation

- [README.md](../README.md) - Main documentation and tool reference
- [INSTALL-GUIDE.md](../INSTALL-GUIDE.md) - Installation and setup
- [change-logs.md](../change-logs.md) - Version history and changes
- [Available Tools](../README.md#️-available-tools) - Full tool reference

## 📝 Technical Details

### How It Works

1. **Pattern Detection**: Claude's language model recognizes Zebrunner URL patterns in user messages
2. **Parameter Extraction**: Uses regex or pattern matching to extract projectKey, testRunId, testId
3. **Tool Selection**: Routes to appropriate tool based on URL structure (test vs. launch)
4. **Default Application**: Applies optimal default parameters for comprehensive analysis
5. **Override Processing**: Detects natural language intent to adjust parameters
6. **Tool Invocation**: Calls the selected MCP tool with extracted and adjusted parameters
7. **Result Presentation**: Formats and presents the analysis results to the user

### Implementation

This is an **AI-level feature**, not a new MCP tool. The implementation consists of:
- 📖 Documentation updates (README, this guide)
- 🔧 Tool description hints (in server.ts)
- 🧠 AI training (via documentation and examples)

No code changes to the MCP server itself were required. Claude learns the URL patterns from documentation and automatically applies this knowledge.

### Version Requirements

- **MCP Zebrunner Server**: v5.5.0 or higher
- **Claude Desktop/Code**: Latest version recommended
- **Zebrunner**: Any version with the current URL format

---

## 🎉 Conclusion

Smart URL-based analysis makes working with Zebrunner test failures faster and more intuitive. Just copy-paste URLs from your browser, and Claude handles the rest!

For questions or issues, please check the [main README](../README.md) or open an issue on GitHub.

Happy testing! 🚀

