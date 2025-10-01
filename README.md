# Zebrunner MCP Server
**Current version:** 🟢 <!--VERSION_START-->3.7.44<!--VERSION_END--> 

A **Model Context Protocol (MCP)** server that integrates with **Zebrunner Test Case Management** to help QA teams manage test cases, test suites, and test execution data through AI assistants like Claude.

## 🎯 What is this tool?

This tool allows you to:
- **Retrieve test cases** and test suites from Zebrunner
- **Analyze test coverage** and generate test code
- **Get test execution results** and launch details
- **Validate test case quality** with automated checks
- **Generate reports** and insights from your test data

All through natural language commands in AI assistants!

## 📋 Prerequisites

### What you need to know
- **Basic command line usage** (opening terminal, running commands)
- **Your Zebrunner credentials** (login and API token)
- **Basic understanding of test management** (test cases, test suites)

### Software requirements
- **Node.js 18 or newer** - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Access to a Zebrunner instance** with API credentials

### How to check if you have Node.js
Open your terminal/command prompt and run:
```bash
node --version
npm --version
```
If you see version numbers, you're ready to go!

## 🚀 Quick Start Guide

### Step 1: Get the code
Choose one of these methods:

#### Option A: Clone from repository (recommended)
```bash
git clone <repository-url>
cd mcp-zebrunner
```

#### Option B: Download and extract
Download the project files and extract them to a folder.

### Step 2: Install dependencies
```bash
npm install
```

### Step 3: Configure your Zebrunner connection
Create a `.env` file in the project folder with your Zebrunner details:

```env
# Your Zebrunner instance URL (without trailing slash)
ZEBRUNNER_URL=https://your-company.zebrunner.com/api/public/v1

# Your Zebrunner login (usually your email)
ZEBRUNNER_LOGIN=your.email@company.com

# Your Zebrunner API token (get this from your Zebrunner profile)
ZEBRUNNER_TOKEN=your_api_token_here

# Optional: Enable debug logging (default: false)
DEBUG=false
```

#### How to get your Zebrunner API token:
1. Log into your Zebrunner instance
2. Go to your profile settings
3. Find the "API Access" section
4. Generate a new API token
5. Copy the token to your `.env` file

### Step 4: Build the project
```bash
npm run build
```

### Step 5: Test your connection
```bash
npm run test:health
```
If you see "✅ Health check completed", you're ready to go!

## 🔧 Usage Methods

### Method 1: Use with Claude Desktop/Code (Recommended)

Add this configuration to your Claude Desktop or Claude Code settings. **Important:** You must use the full absolute path to your project folder.

```json
{
  "mcpServers": {
    "mcp-zebrunner": {
      "command": "node",
      "args": ["/full/absolute/path/to/mcp-zebrunner/dist/server.js"],
      "env": {
        "ZEBRUNNER_URL": "https://your-company.zebrunner.com/api/public/v1",
        "ZEBRUNNER_LOGIN": "your.email@company.com",
        "ZEBRUNNER_TOKEN": "your_api_token_here",
        "DEBUG": "false",
        "DEFAULT_PAGE_SIZE": "100",
        "MAX_PAGE_SIZE": "100"
      }
    }
  }
}
```

**Example paths:**
- **Windows:** `C:\\Users\\YourName\\Projects\\mcp-zebrunner\\dist\\server.js`
- **macOS/Linux:** `/Users/YourName/Projects/mcp-zebrunner/dist/server.js`

### Alternative: Command Line Integration (Claude Code)

You can also add the server using the command line:

```bash
claude mcp add mcp-zebrunner \
  --env ZEBRUNNER_URL="https://your-company.zebrunner.com/api/public/v1" \
  --env ZEBRUNNER_LOGIN="your.email@company.com" \
  --env ZEBRUNNER_TOKEN="your_api_token_here" \
  --env DEBUG="false" \
  -- node /full/absolute/path/to/mcp-zebrunner/dist/server.js
```

**Important:** Replace `/full/absolute/path/to/mcp-zebrunner/` with the actual full path to your project folder.

### Method 2: Run as standalone server

#### Development mode (with auto-reload)
```bash
npm run dev
```

#### Production mode
```bash
npm start
```

## 🛠️ Available Tools

Once connected, you can use these tools through natural language in your AI assistant:

### 📋 Test Case Management

#### Get test case details
```
"Get test case PROJ-123 details"
"Show me test case PROJ-456 in markdown format"
```

#### List test suites
```
"List test suites for project MYAPP"
"Show me all test suites"
```

#### Get test cases with filtering
```
"Get test cases for project MYAPP"
"Get test cases from suite 18708"
"Show me test cases with pagination"
```

### 🌳 Test Suite Hierarchy

#### View suite structure
```
"Show me the hierarchy of test suites for project MYAPP"
"Get suite hierarchy with depth 3"
```

#### Get all subsuites
```
"Get all subsuites from root suite 18697"
"List subsuites with pagination"
```

### 🔍 Test Coverage Analysis

#### Analyze test coverage
```
"Analyze test coverage for PROJ-123 against my implementation"
```

Provide your actual test code, and the tool will:
- Compare test steps with your implementation
- Calculate coverage percentages
- Suggest improvements
- Identify missing validations

#### Enhanced coverage with rules
```
"Enhanced coverage analysis with rules validation for PROJ-123"
```

### 🧪 Test Code Generation

#### Generate draft test code
```
"Generate draft test code for PROJ-123 using Java framework"
"Create test code for PROJ-456 with JavaScript/Jest"
```

The tool can detect and generate code for:
- **Java/Carina framework**
- **JavaScript/Jest**
- **Python/Pytest**

### ✅ Test Case Validation

#### Validate test case quality
```
"Validate test case PROJ-123"
"Check test case quality for PROJ-456"
```

The tool checks for:
- Clear titles and descriptions
- Complete preconditions
- Actionable test steps
- Specific expected results
- Automation readiness

### 📊 Test Execution & Reporting

#### Get launch details
```
"Get launch details for launch 118685"
"Show me test execution results"
```

#### Get test results by platform
```
"Get iOS test results for the last 7 days"
"Show me Android test results for the last month"
```

#### Get top bugs/issues
```
"Show me the top 5 most frequent bugs"
"Get bug reports for the last week"
```

## 📖 Output Formats

All tools support multiple output formats:

- **`json`** - Structured data (default)
- **`markdown`** - Rich formatted output with sections and tables
- **`string`** - Human-readable text summaries
- **`dto`** - Raw data objects

Example:
```
"Get test case PROJ-123 in markdown format"
"Show me test suites as JSON"
```

## ⚙️ Configuration Options

### Environment Variables

```env
# Required
ZEBRUNNER_URL=https://your-instance.zebrunner.com/api/public/v1
ZEBRUNNER_LOGIN=your.email@company.com
ZEBRUNNER_TOKEN=your_api_token

# Optional - Basic Settings
DEBUG=false                        # Enable detailed logging (default: false)
DEFAULT_PAGE_SIZE=100             # Default items per page (optional)
MAX_PAGE_SIZE=100                 # Maximum items per page (optional)

# Optional - Advanced Features
ENABLE_RULES_ENGINE=true          # Enable test validation rules (optional)
MCP_RULES_FILE=custom-rules.md    # Custom validation rules file (optional)
MIN_COVERAGE_THRESHOLD=70         # Minimum coverage percentage (optional)
REQUIRE_UI_VALIDATION=true        # Require UI validation in tests (optional)
REQUIRE_API_VALIDATION=true       # Require API validation in tests (optional)
```

### Custom Validation Rules

Create a `mcp-zebrunner-rules.md` file to customize test case validation:

```markdown
# Custom Test Case Validation Rules

## Rule 1: Title Quality
- Titles must be descriptive and specific
- Minimum length: 10 characters
- Should not contain vague terms like "test", "check"

## Rule 2: Test Steps
- Each step must have clear action and expected result
- Steps should be numbered and sequential
- Avoid combining multiple actions in one step
```

## 🧪 Testing Your Setup

### Run health checks
```bash
npm run test:health
```

### Test API connection
```bash
npm run smoke
```

### Run full test suite
```bash
npm test
```

### Run specific test types
```bash
npm run test:unit           # Fast unit tests
npm run test:integration    # API integration tests
npm run test:e2e           # End-to-end tests
```

## 🔍 Troubleshooting

### Common Issues

#### "Authentication failed" or 401 errors
- ✅ Check your `ZEBRUNNER_LOGIN` and `ZEBRUNNER_TOKEN`
- ✅ Verify your API token is still valid
- ✅ Ensure your user has proper permissions in Zebrunner

#### "Project not found" or 404 errors
- ✅ Check the project key spelling (e.g., "MYAPP", not "myapp")
- ✅ Verify you have access to the project in Zebrunner
- ✅ Some endpoints may not be available on all Zebrunner instances

#### "Connection timeout" errors
- ✅ Check your `ZEBRUNNER_URL` is correct
- ✅ Ensure your network can reach the Zebrunner instance
- ✅ Try increasing timeout in configuration

#### MCP integration not working
- ✅ Verify the path to `dist/server.js` is correct
- ✅ Check that the project built successfully (`npm run build`)
- ✅ Ensure environment variables are set in MCP configuration
- ✅ Look at Claude Desktop/Code logs for error messages

### Debug Mode

Enable detailed logging to troubleshoot issues:

```env
DEBUG=true
```

This will show:
- API requests and responses
- Error details and stack traces
- Performance metrics
- Feature availability

### Getting Help

1. **Check the logs** - Enable debug mode and look for error messages
2. **Test your connection** - Run `npm run test:health`
3. **Verify your configuration** - Double-check your `.env` file
4. **Check Zebrunner permissions** - Ensure your user has proper access

## 🎯 Example Workflows

### Workflow 1: Test Case Review
```
1. "Get test case PROJ-123 details"
2. "Validate test case PROJ-123"
3. "Analyze test coverage for PROJ-123 against my implementation"
4. "Generate improvement suggestions"
```

### Workflow 2: Test Suite Analysis
```
1. "List test suites for project MYAPP"
2. "Show me the hierarchy of test suites"
3. "Get all test cases from suite 18708"
4. "Generate coverage report for the suite"
```

### Workflow 3: Test Automation
```
1. "Get test case PROJ-456 details"
2. "Generate draft test code for PROJ-456 using Java"
3. "Validate the generated code quality"
4. "Get automation readiness assessment"
```

### Workflow 4: Test Execution Analysis
```
1. "Get launch details for launch 118685"
2. "Show me test results by platform"
3. "Get top bugs from the last week"
4. "Generate execution summary report"
```

## 🔧 Advanced Features

### Batch Operations
Process multiple test cases at once:
```
"Validate all test cases in suite 18708"
"Generate coverage report for all test cases in project MYAPP"
```

### Custom Output Formats
Get data in the format you need:
```
"Get test cases as JSON for API integration"
"Show test suite hierarchy in markdown for documentation"
```

### Filtering and Search
Find exactly what you need:
```
"Get test cases created after 2024-01-01"
"Find test cases with automation state 'Manual'"
"Search for test cases containing 'login'"
```

## 📚 Additional Documentation

- **NEW_LAUNCHER_TOOL.md** - Detailed information about launch and reporting tools
- **SUITE_HIERARCHY.md** - Complete guide to suite hierarchy features
- **TEST_CASE_VALIDATION_IMPLEMENTATION.md** - Test case validation system details
- **ENHANCED_VALIDATION_FEATURES.md** - Advanced validation and improvement features

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with appropriate tests
4. Ensure all tests pass: `npm test`
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

---

## 🎉 You're Ready!

Once you've completed the setup:

1. **Test your connection** with `npm run test:health`
2. **Configure your AI assistant** with the MCP server
3. **Start asking questions** about your test cases!

Example first commands to try:
- "List test suites for project [YOUR_PROJECT_KEY]"
- "Get test case [YOUR_TEST_CASE_KEY] details"
- "Show me the test suite hierarchy"

Happy testing! 🚀
