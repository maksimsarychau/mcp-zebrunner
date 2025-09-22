# Zebrunner MCP Server

A **Model Context Protocol (MCP)** server in **TypeScript** that integrates with **Zebrunner Test Case Management (TCM) Public API** using **Basic Auth**. Designed for **Cursor** users and integrates cleanly with **Claude Code/Desktop**.

## Features

### 🚀 Current Implementation (server.ts - Recommended)
The main **unified server** (`src/server.ts`) provides the most comprehensive and stable implementation:

- **Core Working Features**:
  - `list_test_suites` - List test suites for a project (✅ **Verified Working**)
  - `get_test_case_by_key` - Get detailed test case by key with rich Markdown export (✅ **Verified Working**)
  - `get_test_cases_advanced` - Advanced test case retrieval with filtering and pagination
  - `get_suite_hierarchy` - Hierarchical test suite tree with configurable depth
  - `get_all_subsuites` - ✨ **NEW** Flat list of all subsuites with pagination (✅ **Tested**)
  - `get_test_coverage_by_test_case_steps_by_key` - ✨ **NEW** Test coverage analysis with recommendations (✅ **Tested**)
  - `generate_draft_test_by_key` - ✨ **NEW** Generate test code with framework detection (requires ENABLE_RULES_ENGINE=true)
  - `get_enhanced_test_coverage_with_rules` - ✨ **NEW** Enhanced coverage with configurable rules validation

- **Enhanced Framework**:
  - **Advanced API Client** - Retry logic, error handling, comprehensive pagination
  - **Hierarchy Processing** - Suite tree building, path generation, level calculation  
  - **Multi-Format Output** - DTO, JSON, string, and Markdown formats
  - **Type-Safe Architecture** - Comprehensive Zod schemas based on Java DTO analysis
  - **Debug Mode** - Comprehensive logging with `DEBUG=true`
  - **Experimental Features** - Optional advanced endpoints with `EXPERIMENTAL_FEATURES=true`

### 🔧 Legacy Implementations (Available)
- **Original Server** (`src/index.ts`) - Simple, proven working implementation
- **Working Enhanced** (`src/index-working-enhanced.ts`) - Enhanced features with legacy compatibility
- **Full Enhanced** (`src/index-enhanced.ts`) - Complete feature set (may have compilation issues)

### 📊 Technical Features
- **Rich Markdown Export** - Test cases with steps, custom fields, and metadata
- **Environment-based Configuration** - `ZEBRUNNER_URL`, `ZEBRUNNER_LOGIN`, `ZEBRUNNER_TOKEN`
- **TypeScript with Full Type Safety** - Comprehensive Zod schemas
- **Tested with Real Instance** - Verified with mfp.zebrunner.com
- **Modular Architecture** - Clean separation of concerns with comprehensive documentation

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Access to a Zebrunner instance with API credentials

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Zebrunner credentials
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

## Configuration

Create a `.env` file with your Zebrunner instance details:

```env
# Zebrunner TCM Public API base (no trailing slash)
ZEBRUNNER_URL=https://mfp.zebrunner.com/api/public/v1
# Login (often your Zebrunner email)
ZEBRUNNER_LOGIN=your.login@example.com
# Personal API token from Zebrunner profile
ZEBRUNNER_TOKEN=YOUR_API_TOKEN

# Optional: Enable debug mode
DEBUG=true
# Optional: Enable experimental features
EXPERIMENTAL_FEATURES=true

# Optional: Pagination Configuration
DEFAULT_PAGE_SIZE=10
MAX_PAGE_SIZE=100

# Optional: Enhanced Rules Engine (default: false for backward compatibility)
ENABLE_RULES_ENGINE=false
# Path to rules file (only used when ENABLE_RULES_ENGINE=true)
MCP_RULES_FILE=mcp-zebrunner-rules.md
# Coverage thresholds (only used when ENABLE_RULES_ENGINE=true)
MIN_COVERAGE_THRESHOLD=70
REQUIRE_UI_VALIDATION=true
REQUIRE_API_VALIDATION=true
```

> **✅ Verified Configuration**: This configuration has been tested and works with the mfp.zebrunner.com instance.

> **Note:** Zebrunner instances may vary. If you get 404/401 errors, adjust endpoint paths in the API client to match your workspace's Public API. Refer to your instance's API documentation at `https://<workspace>.zebrunner.com/api/docs`.

## Usage

### Development Mode (Recommended)
```bash
# Main unified server (recommended)
npm run dev

# Legacy servers (alternative)
npm run dev:legacy          # Original simple server
npm run dev:working         # Working enhanced server
npm run dev:enhanced        # Full enhanced server
```

### Production Mode
```bash
# Main unified server (recommended)
npm start

# Legacy servers (alternative)  
npm run start:legacy        # Original simple server
npm run start:working       # Working enhanced server
npm run start:enhanced      # Full enhanced server
```

### Testing
```bash
# API smoke test
npm run smoke

# Comprehensive test suite
npm run test
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:e2e           # End-to-end tests only

# Debug mode testing
npm run test:legacy         # Test original server with debug
npm run test:working        # Test working enhanced server
```

## MCP Integration

### Integration with Claude Desktop/Code

Add the MCP server to Claude Desktop or Claude Code using the **main unified server**:

```json
{
  "mcpServers": {
    "zebrunner": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/path/to/mcp-zebrunner",
      "env": {
        "ZEBRUNNER_URL": "https://mfp.zebrunner.com/api/public/v1",
        "ZEBRUNNER_LOGIN": "your.login@example.com", 
        "ZEBRUNNER_TOKEN": "YOUR_API_TOKEN",
        "DEBUG": "true",
        "EXPERIMENTAL_FEATURES": "false",
        "DEFAULT_PAGE_SIZE": "50",
        "MAX_PAGE_SIZE": "200"
      }
    }
  }
}
```

### Alternative: Command Line Integration
```bash
# Using the main server (recommended)
claude mcp add zebrunner \
  --env ZEBRUNNER_URL="https://mfp.zebrunner.com/api/public/v1" \
  --env ZEBRUNNER_LOGIN="your.login@example.com" \
  --env ZEBRUNNER_TOKEN="YOUR_API_TOKEN" \
  --env DEBUG="true" \
  -- node dist/server.js
```

Give a full path to the local files for dist/server.js

### Usage Examples in Claude

Once integrated, you can use natural language commands:

#### Core Features (Always Available)
- **"List test suites for project MFPAND"** → `list_test_suites` ✅
- **"Get test case MFPAND-29 details"** → `get_test_case_by_key` ✅
- **"Show me test case MFPAND-29 in markdown format"** → Rich formatted output ✅

#### Advanced Features (Main Server)
- **"Get test cases for project MFPAND with pagination"** → `get_test_cases_advanced`
- **"Show me the hierarchy of test suites for project MFPAND"** → `get_suite_hierarchy`
- **"Get test cases from suite 18708 with steps included"** → Advanced filtering
- **"Get all subsuites from root suite 18697 with pagination"** → `get_all_subsuites` ✨ **NEW**
- **"Analyze test coverage for MFPAND-6 against my implementation"** → `get_test_coverage_by_test_case_steps_by_key` ✨ **NEW**
- **"Generate draft test code for MFPAND-6 using Java Carina framework"** → `generate_draft_test_by_key` ✨ **NEW** (requires ENABLE_RULES_ENGINE=true)
- **"Enhanced coverage analysis with rules validation for MFPAND-6"** → `get_enhanced_test_coverage_with_rules` ✨ **NEW**

#### Experimental Features (When Enabled)
- **"Get details for test suite 18708"** → `get_test_suite_experimental`
- **"List test cases in suite 18708"** → `list_test_cases_by_suite_experimental`
- **"Search for login test cases in project MFPAND"** → `search_test_cases_experimental`

## API Endpoints

The server uses the following Zebrunner API endpoints:

### Core Endpoints (Verified Working)
- `GET /test-suites?projectKey={key}&projectId={id}` - List test suites ✅
- `GET /test-cases/key:{key}?projectKey={projectKey}` - Get test case by key ✅

### Enhanced Endpoints (Advanced Features)
- `GET /test-cases?projectKey={key}&page={page}&size={size}` - Paginated test cases
- `GET /test-suites/{suiteId}` - Individual suite details (experimental)
- `GET /test-suites/{suiteId}/test-cases` - Suite test cases (experimental)
- `GET /test-cases/search` - Search with filters (experimental)

> **Note**: Endpoint availability varies by Zebrunner instance and user permissions. Core endpoints are confirmed working across instances.

## ✨ New Features

### 📋 Enhanced Subsuite Management

#### `get_all_subsuites`
Get all subsuites from a root suite as a flat, paginated list - perfect for comprehensive suite analysis.

**Parameters:**
- `project_key` (string): Project key (e.g., "MFPAND")
- `root_suite_id` (number): Root suite ID to get all subsuites from
- `include_root` (boolean): Include the root suite in results (default: true)
- `format` (enum): Output format - dto, json, string, markdown (default: json)
- `page` (number): Page number, 0-based (default: 0)
- `size` (number): Page size, respects MAX_PAGE_SIZE (default: 50)

**Example Usage:**
```
Get all subsuites from root suite 18697 with pagination:
- project_key: "MFPAND"
- root_suite_id: 18697
- include_root: true
- page: 0
- size: 20
- format: "markdown"
```

**Response includes:**
- Flat list of all subsuites (not hierarchical)
- Complete pagination metadata (total pages, has next/previous)
- Root suite information
- Consistent sorting by suite ID

---

### 🔍 Test Coverage Analysis

#### `get_test_coverage_by_test_case_steps_by_key`
Comprehensive test coverage analysis tool that compares test case steps against actual implementation code, providing detailed recommendations and multiple output formats.

**Parameters:**
- `project_key` (string, optional): Auto-detected from case_key if not provided
- `case_key` (string): Test case key (e.g., "MFPAND-6", "MFPIOS-2")
- `implementation_context` (string): Actual implementation details (code snippets, file paths, implementation description)
- `analysis_scope` (enum): Scope of analysis - steps, assertions, data, full (default: full)
- `output_format` (enum): Output format - chat, markdown, code_comments, all (default: chat)
- `include_recommendations` (boolean): Include improvement recommendations (default: true)
- `file_path` (string, optional): File path for adding code comments or saving markdown

**Analysis Features:**
- **Step-by-Step Coverage**: Analyzes each test case step against implementation
- **Intelligent Keyword Matching**: Extracts and matches meaningful terms
- **Coverage Scoring**: Calculates percentage coverage for each step and overall
- **Implementation Detection**: Identifies methods, assertions, UI elements, API calls
- **Smart Recommendations**: Generates actionable improvement suggestions
- **Multiple Output Formats**: Chat response, markdown reports, code comments

**Example Usage in Claude Code:**
```
Analyze coverage for test case MFPAND-6:
- case_key: "MFPAND-6" (project auto-detected as MFPAND)
- implementation_context: |
  function testMoreMenu() {
    const user = loginAsPremiumUser();
    expect(user.isPremium).toBe(true);
    
    const moreButton = findElement('more-menu-button');
    click(moreButton);
    
    const premiumTools = findElement('premium-tools-screen');
    expect(premiumTools).toBeVisible();
    
    assert(findElement('intermittent-fasting').isDisplayed());
    assert(findElement('recipe-discovery').isDisplayed());
  }
- analysis_scope: "full"
- output_format: "all"
- include_recommendations: true
- file_path: "tests/more_menu_test.js"
```

**Sample Analysis Output:**
```
# 🔍 Test Coverage Analysis: MFPAND-6

**Test Case**: Verify "More" menu (Premium) - My Premium Tools, Intermittent Fasting, Recipe Discovery...
**Overall Score**: 67%

## 📋 Step Analysis

### ⚠️ Step 1 (67%)
**Action**: 1. Open App. 2. Login as Premium User. 3. Go to the "More" menu...
**Expected**: The user sees "More" menu screen...

### ✅ Step 2 (80%)
**Action**: 1. On "More" menu Tap "My Premium Tools"...
**Expected**: The user sees "My Premium Tools" screen...

## 💡 Recommendations
🟢 **Good**: Decent coverage. Fine-tune missing elements.
📋 **Missing Steps**: 3 steps need better coverage.
```

**Use Cases:**
- **Code Reviews**: Verify test implementation completeness
- **Test Planning**: Identify gaps in test coverage
- **Documentation**: Generate coverage reports and code comments
- **Quality Assurance**: Ensure test cases match actual implementation

---

### 🧪 Draft Test Generation

#### `generate_draft_test_by_key`
Generate complete draft test code from Zebrunner test cases with intelligent framework detection and configurable templates.

**⚠️ Requires**: `ENABLE_RULES_ENGINE=true` in your `.env` file

**Parameters:**
- `project_key` (string, optional): Auto-detected from case_key if not provided
- `case_key` (string): Test case key (e.g., "MFPAND-6", "MFPIOS-2")
- `implementation_context` (string): Existing code, file paths, or framework hints
- `target_framework` (enum): auto, java-carina, javascript-jest, python-pytest (default: auto)
- `output_format` (enum): code, markdown, comments, all (default: code)
- `include_setup_teardown` (boolean): Include setup/teardown code (default: true)
- `include_assertions_templates` (boolean): Include assertion templates (default: true)
- `generate_page_objects` (boolean): Generate page object classes (default: false)
- `include_data_providers` (boolean): Include data provider templates (default: false)
- `file_path` (string, optional): File path for saving generated code

**Generation Features:**
- **Intelligent Framework Detection**: Analyzes implementation context to detect Java/Carina, JavaScript/Jest, Python/Pytest
- **Template-Based Generation**: Uses configurable templates from rules file
- **Complete Test Structure**: Generates imports, setup, test methods, assertions, teardown
- **Page Object Support**: Optional page object class generation
- **Data Provider Integration**: Optional test data provider generation
- **Quality Scoring**: Calculates quality score based on completeness and best practices

**Example Usage in Claude Code:**
```
Generate draft test for MFPAND-6:
- case_key: "MFPAND-6" (project auto-detected as MFPAND)
- implementation_context: |
  // Existing Carina framework setup
  public class BaseTest extends AbstractTest {
    @Test
    public void testLogin() {
      HomePage homePage = new HomePage(getDriver());
      LoginPage loginPage = homePage.openLoginPage();
    }
  }
- target_framework: "auto" (will detect java-carina)
- output_format: "all"
- include_setup_teardown: true
- generate_page_objects: true
```

---

### 🔍 Enhanced Coverage Analysis

#### `get_enhanced_test_coverage_with_rules`
Advanced test coverage analysis with configurable rules validation, framework detection, and detailed quality scoring.

**Parameters:**
- `project_key` (string, optional): Auto-detected from case_key if not provided
- `case_key` (string): Test case key (e.g., "MFPAND-6")
- `implementation_context` (string): Actual implementation code or description
- `analysis_scope` (enum): steps, assertions, data, full (default: full)
- `output_format` (enum): chat, markdown, detailed, all (default: detailed)
- `include_recommendations` (boolean): Include improvement recommendations (default: true)
- `validate_against_rules` (boolean): Validate against configured rules (default: true)
- `show_framework_detection` (boolean): Show detected framework info (default: true)
- `file_path` (string, optional): File path for saving reports

**Enhanced Analysis Features:**
- **Rules-Based Validation**: Validates coverage against configurable thresholds and requirements
- **Framework-Aware Analysis**: Tailors analysis based on detected test framework
- **Quality Scoring**: Comprehensive scoring with violation tracking
- **Detailed Reporting**: Step-by-step analysis with coverage percentages
- **Configurable Rules**: Uses `mcp-zebrunner-rules.md` for project-specific standards
- **Multiple Output Formats**: Supports chat, markdown, and detailed analysis formats

**Sample Enhanced Output:**
```
# 🔍 Enhanced Test Coverage Analysis: MFPAND-6

## 🔧 Framework Detection
- **Detected Framework**: java-carina
- **Keywords Found**: @Test, WebDriver, AbstractTest
- **File Patterns**: *.java, *Test.java

## ⚖️ Rules Validation
**Status**: ❌ Failed

### ❌ Violations
- Overall coverage 67% is below minimum threshold 70%
- Critical step 1 coverage 67% is below threshold 90%

### 💡 Rules Recommendations
- 🟡 Moderate coverage. Focus on improving critical and UI validation steps.
- 💡 Consider adding API response validations to ensure data integrity.
```

**Use Cases:**
- **Automated Quality Gates**: Enforce coverage standards in CI/CD pipelines
- **Framework-Specific Analysis**: Get tailored recommendations based on your test framework
- **Custom Rules Enforcement**: Apply project-specific quality standards
- **Detailed Reporting**: Generate comprehensive coverage reports with violations

## 📖 Comprehensive Usage Examples

### 🚀 Getting Started

#### Basic Setup (All Users)
```bash
# 1. Clone and install
git clone <repository>
cd mcp-zebrunner
npm install
npm run build

# 2. Configure environment
cp .env.example .env
# Edit .env with your credentials:
# ZEBRUNNER_URL=https://your-instance.zebrunner.com/api/public/v1
# ZEBRUNNER_LOGIN=your.email@company.com
# ZEBRUNNER_TOKEN=your_api_token

# 3. Test connection
npm run test:smoke
```

#### Enable Enhanced Features (Optional)
```bash
# Add to your .env file:
ENABLE_RULES_ENGINE=true
MCP_RULES_FILE=mcp-zebrunner-rules.md

# Create custom rules file (optional)
cp mcp-zebrunner-rules.md.example mcp-zebrunner-rules.md
# Edit rules file for your project standards

# Restart MCP server
```

### 🔍 Core Features Examples

#### 1. List Test Suites
```
Natural language: "List test suites for project MFPAND"

Tool: list_test_suites
Parameters:
- project_key: "MFPAND"
- format: "markdown"
```

**Response:**
```markdown
# Test Suites for Project MFPAND

## Suite: Android App Testing (ID: 18697)
- **Description**: Main Android application test suite
- **Test Cases**: 45
- **Status**: Active

## Suite: iOS App Testing (ID: 18698)  
- **Description**: iOS application test suite
- **Test Cases**: 32
- **Status**: Active
```

#### 2. Get Test Case Details
```
Natural language: "Get details for test case MFPAND-29"

Tool: get_test_case_by_key
Parameters:
- project_key: "MFPAND" (auto-detected)
- case_key: "MFPAND-29"
- format: "markdown"
- include_debug: true
```

**Response:**
```markdown
# 🧪 Test Case: MFPAND-29

**Title**: Verify premium user login functionality
**Priority**: High | **Status**: Automated

## 📋 Test Steps
### Step 1
**Action**: Open the application
**Expected**: Application launches successfully

### Step 2  
**Action**: Navigate to login screen
**Expected**: Login form is displayed with username and password fields

## 📊 Metadata
- **Created**: 2023-09-15 by john.doe@company.com
- **Suite**: Authentication Tests (ID: 18697)
```

### 📋 Advanced Features Examples

#### 3. Get Suite Hierarchy
```
Natural language: "Show me the test suite hierarchy for MFPAND project"

Tool: get_suite_hierarchy  
Parameters:
- project_key: "MFPAND"
- max_depth: 3
- format: "markdown"
- include_test_count: true
```

**Response:**
```markdown
# 🌳 Test Suite Hierarchy: MFPAND

## 📁 Root Suites
### [Android] Mobile App Testing (ID: 18697) - 45 tests
  ├── 📁 Authentication (ID: 18710) - 12 tests
  │   ├── 🧪 Login Tests - 8 tests  
  │   └── 🧪 Registration Tests - 4 tests
  ├── 📁 Core Features (ID: 18711) - 25 tests
  └── 📁 Premium Features (ID: 18712) - 8 tests

### [iOS] Mobile App Testing (ID: 18698) - 32 tests
  ├── 📁 Authentication (ID: 18720) - 10 tests
  └── 📁 Core Features (ID: 18721) - 22 tests
```

#### 4. Get All Subsuites (Flat List)
```
Natural language: "Get all subsuites from root suite 18697 with pagination"

Tool: get_all_subsuites
Parameters:
- project_key: "MFPAND"
- root_suite_id: 18697
- include_root: true
- page: 0
- size: 10
- format: "markdown"
```

**Response:**
```markdown
# 📋 All Subsuites from Root Suite 18697

## 📊 Summary
- **Root Suite**: [Android] Mobile App Testing (ID: 18697)
- **Total Subsuites**: 156
- **Current Page**: 1 of 16 (showing 10 items)

## 🗂️ Suites (Page 1)
1. **[Android] Mobile App Testing** (ID: 18697) - Root Suite
2. **Authentication Tests** (ID: 18710) - Level 1
3. **Login Functionality** (ID: 18715) - Level 2
4. **Social Login** (ID: 18716) - Level 3
5. **Registration Tests** (ID: 18717) - Level 2
6. **Core Features** (ID: 18711) - Level 1
7. **Navigation Tests** (ID: 18720) - Level 2
8. **Search Functionality** (ID: 18721) - Level 2
9. **Premium Features** (ID: 18712) - Level 1
10. **Premium Tools** (ID: 18725) - Level 2

## 📄 Pagination
- **Has Next Page**: Yes
- **Has Previous Page**: No
- **Total Pages**: 16
```

### 🔍 Coverage Analysis Examples

#### 5. Basic Coverage Analysis
```
Natural language: "Analyze test coverage for MFPAND-6 against my implementation"

Tool: get_test_coverage_by_test_case_steps_by_key
Parameters:
- case_key: "MFPAND-6" (project auto-detected as MFPAND)
- implementation_context: |
  function testMoreMenu() {
    const user = loginAsPremiumUser();
    expect(user.isPremium).toBe(true);
    
    const moreButton = findElement('more-menu-button');
    click(moreButton);
    
    const premiumTools = findElement('premium-tools-screen');
    expect(premiumTools).toBeVisible();
    
    assert(findElement('intermittent-fasting').isDisplayed());
    assert(findElement('recipe-discovery').isDisplayed());
  }
- analysis_scope: "full"
- output_format: "chat"
```

**Response:**
```
# 🔍 Test Coverage Analysis: MFPAND-6

**Test Case**: Verify "More" menu (Premium) - My Premium Tools, Intermittent Fasting, Recipe Discovery
**Overall Score**: 73%

## 📋 Step Analysis

### ✅ Step 1 (80%)
**Action**: 1. Open App. 2. Login as Premium User. 3. Go to the "More" menu
**Expected**: The user sees "More" menu screen
**Matches**: login, premium, more, menu

### ⚠️ Step 2 (67%)
**Action**: 1. On "More" menu Tap "My Premium Tools"
**Expected**: The user sees "My Premium Tools" screen
**Matches**: premium, tools
**Missing**: screen navigation validation

## 💡 Recommendations
- 🟢 Good coverage overall. Fine-tune missing elements.
- 📋 Add validation for screen transitions
- 🎯 Include more specific UI element checks
```

#### 6. Enhanced Coverage Analysis with Rules
```
Natural language: "Enhanced coverage analysis with rules validation for MFPAND-6"

Tool: get_enhanced_test_coverage_with_rules
Parameters:
- case_key: "MFPAND-6"
- implementation_context: |
  @Test(description = "Verify More menu premium features access")
  public void testMoreMenuPremiumAccess() {
      // Setup
      User premiumUser = UserFactory.createPremiumUser();
      LoginPage loginPage = new LoginPage(getDriver());
      
      // Login as premium user
      HomePage homePage = loginPage.loginAs(premiumUser);
      Assert.assertTrue(homePage.isDisplayed(), "Home page should be displayed");
      
      // Navigate to More menu
      MoreMenuPage moreMenuPage = homePage.openMoreMenu();
      Assert.assertTrue(moreMenuPage.isDisplayed(), "More menu should be displayed");
      
      // Access premium tools
      PremiumToolsPage premiumToolsPage = moreMenuPage.tapPremiumTools();
      Assert.assertTrue(premiumToolsPage.isDisplayed(), "Premium tools page should be displayed");
  }
- validate_against_rules: true
- show_framework_detection: true
- output_format: "detailed"
```

**Response:**
```
# 🔍 Enhanced Test Coverage Analysis: MFPAND-6

## 📋 Test Case Details
- **Key**: MFPAND-6
- **Title**: Verify "More" menu (Premium) - My Premium Tools, Intermittent Fasting, Recipe Discovery
- **Priority**: Medium
- **Automation State**: Automated

## 🔧 Framework Detection
- **Detected Framework**: java-carina
- **Keywords Found**: @Test, WebDriver, Assert, getDriver
- **File Patterns**: *.java, *Test.java

## 📊 Coverage Summary
- **Overall Score**: 85%
- **Total Steps**: 9
- **Covered Steps**: 7
- **Rules Validation**: ✅ Passed

## 🔄 Step Analysis

### ✅ Step 1 (90%)
**Action**: 1. Open App. 2. Login as Premium User. 3. Go to the "More" menu
**Expected**: The user sees "More" menu screen
**Matches**: login, premium, more, menu, homePage, loginAs
**Implementation**: LoginPage.loginAs(), HomePage.isDisplayed()

### ✅ Step 2 (85%)
**Action**: 1. On "More" menu Tap "My Premium Tools"
**Expected**: The user sees "My Premium Tools" screen  
**Matches**: premium, tools, tap, moreMenuPage, premiumToolsPage
**Implementation**: MoreMenuPage.tapPremiumTools(), Assert.assertTrue()

## ⚖️ Rules Validation
**Status**: ✅ Passed

### 💡 Rules Recommendations
- 🟢 Excellent coverage. Meets all quality thresholds.
- ✅ UI validations properly implemented with assertions
- ✅ Page Object Model correctly used
- ✅ Proper setup and validation flow

## 💡 Improvement Recommendations
- 🎯 Consider adding error scenario testing
- 📱 Add mobile-specific gesture validations
- 🔄 Include navigation flow verification

## ⚙️ Configuration
- **Rules Engine**: Enabled
- **Analysis Scope**: full
- **Rules Validation**: Enabled
- **Rules File**: /Users/project/mcp-zebrunner-rules.md
```

### 🧪 Draft Test Generation Examples

#### 7. Generate Java/Carina Test
```
Natural language: "Generate draft test code for MFPAND-6 using Java Carina framework"

Tool: generate_draft_test_by_key
Parameters:
- case_key: "MFPAND-6"
- implementation_context: |
  // Existing Carina framework setup
  public class BaseTest extends AbstractTest {
    @Test
    public void testLogin() {
      HomePage homePage = new HomePage(getDriver());
      LoginPage loginPage = homePage.openLoginPage();
    }
  }
- target_framework: "auto" (will detect java-carina)
- output_format: "all"
- include_setup_teardown: true
- generate_page_objects: true
```

**Response:**
```
# 🧪 Generated Test Code

**Framework Detected**: java-carina
**Quality Score**: 78%

## Imports
```java
import org.testng.Assert;
import org.testng.annotations.Test;
import com.qaprosoft.carina.core.foundation.AbstractTest;
import org.openqa.selenium.WebDriver;
```

## Test Code
```java
@Test(description = "Verify More menu (Premium) - My Premium Tools, Intermittent Fasting, Recipe Discovery")
public void testVerifyMoreMenuPremiumMyPremiumToolsIntermittentFastingRecipeDiscovery() {
    // Test setup
    WebDriver driver = getDriver();
    HomePage homePage = new HomePage(driver);
    
    // Step 1: 1. Open App. 2. Login as Premium User. 3. Go to the "More" menu
    LoginPage loginPage = new LoginPage(driver);
    loginPage.loginAsPremiumUser();
    MoreMenuPage moreMenuPage = homePage.openMoreMenu();
    // Validation: The user sees "More" menu screen
    Assert.assertTrue(moreMenuPage.isDisplayed(), "Expected More menu screen to be displayed");
    
    // Step 2: 1. On "More" menu Tap "My Premium Tools"
    PremiumToolsPage premiumToolsPage = moreMenuPage.tapPremiumTools();
    // Validation: The user sees "My Premium Tools" screen
    Assert.assertTrue(premiumToolsPage.isDisplayed(), "Expected My Premium Tools screen to be displayed");
    
    // Step 3: 1. On "More" menu Tap "Intermittent Fasting"
    IntermittentFastingPage intermittentFastingPage = moreMenuPage.tapIntermittentFasting();
    // Validation: The user sees "Intermittent Fasting" screen
    Assert.assertTrue(intermittentFastingPage.isDisplayed(), "Expected Intermittent Fasting screen to be displayed");
    
    // Test cleanup
    // Driver cleanup handled by framework
}
```

## Page Object
```java
public class MoreMenuPage extends AbstractPage {
    public MoreMenuPage(WebDriver driver) {
        super(driver);
    }
    
    public PremiumToolsPage tapPremiumTools() {
        // TODO: Implement premium tools navigation
        return new PremiumToolsPage(getDriver());
    }
    
    public IntermittentFastingPage tapIntermittentFasting() {
        // TODO: Implement intermittent fasting navigation  
        return new IntermittentFastingPage(getDriver());
    }
}
```

## 💡 Recommendations
- 📋 Consider breaking this test into smaller, more focused tests
- 🧪 Review generated code and customize for your specific implementation
- 📝 Add meaningful assertions and error messages
- 🔧 Consider adding test data management and cleanup

## ⚙️ Configuration
- **Rules File**: /Users/project/mcp-zebrunner-rules.md
- **Framework**: java-carina
- **Quality Score**: 78%
```

#### 8. Generate JavaScript/Jest Test
```
Tool: generate_draft_test_by_key
Parameters:
- case_key: "MFPIOS-15"
- implementation_context: |
  describe('iOS App Tests', () => {
    beforeEach(async () => {
      await device.reloadReactNative();
    });
    
    it('should login successfully', async () => {
      await element(by.id('username')).typeText('testuser');
      await element(by.id('password')).typeText('password');
      await element(by.id('loginButton')).tap();
      await expect(element(by.id('homeScreen'))).toBeVisible();
    });
  });
- target_framework: "javascript-jest"
- output_format: "code"
```

**Response:**
```
# 🧪 Generated Test Code

**Framework Detected**: javascript-jest
**Quality Score**: 82%

## Test Code
```javascript
describe('Verify iOS navigation flow', () => {
    beforeEach(async () => {
        // Test setup
        await device.reloadReactNative();
    });
    
    it('should verify iOS navigation flow', async () => {
        // Step 1: Open app and navigate to main screen
        await element(by.id('mainScreen')).tap();
        // Validation: Main screen is displayed
        await expect(element(by.id('mainScreen'))).toBeVisible();
        
        // Step 2: Navigate to settings
        await element(by.id('settingsButton')).tap();
        // Validation: Settings screen is displayed
        await expect(element(by.id('settingsScreen'))).toBeVisible();
        
        // Step 3: Verify navigation elements
        await expect(element(by.id('backButton'))).toBeVisible();
        await expect(element(by.id('navigationTitle'))).toHaveText('Settings');
    });
    
    afterEach(async () => {
        // Test cleanup
        await device.pressBack();
    });
});
```
```

### 🎯 Real-World Scenarios

#### 9. CI/CD Integration Example
```bash
# In your CI/CD pipeline
export ZEBRUNNER_URL="https://company.zebrunner.com/api/public/v1"
export ZEBRUNNER_LOGIN="ci-user@company.com"  
export ZEBRUNNER_TOKEN="${CI_ZEBRUNNER_TOKEN}"
export ENABLE_RULES_ENGINE=true
export MIN_COVERAGE_THRESHOLD=80

# Run coverage analysis for all test cases in a suite
node scripts/analyze-suite-coverage.js --suite-id=18697 --min-coverage=80
```

#### 10. Team Collaboration Example
```
# Developer workflow:
1. Get test case: "Get details for MFPAND-123"
2. Generate draft: "Generate Java test for MFPAND-123"  
3. Implement test based on generated code
4. Analyze coverage: "Analyze coverage for MFPAND-123 against my implementation"
5. Iterate until coverage meets team standards (>80%)
```

### 🔧 Troubleshooting Examples

#### Common Issues and Solutions

**Issue**: Draft test generation not available
```
Error: "Draft test generation requires the enhanced rules engine"
Solution: Set ENABLE_RULES_ENGINE=true in .env and restart server
```

**Issue**: Framework not detected correctly  
```
Solution: Provide more context in implementation_context parameter:
- Include import statements
- Include framework-specific annotations (@Test, describe, etc.)
- Include file paths or class names
```

**Issue**: Coverage analysis shows 0% coverage
```
Solution: Ensure implementation_context contains:
- Actual test implementation code
- Method names that match test case actions
- UI element identifiers or API calls
```

**Issue**: Rules validation always fails
```
Solution: Check your mcp-zebrunner-rules.md file:
- Verify threshold values are reasonable
- Check required elements match your implementation
- Ensure framework patterns match your codebase
```

## Project Structure

```
mcp-zebrunner/
├── src/
│   ├── server.ts                   # 🟢 Main unified server (RECOMMENDED)
│   ├── index.ts                    # 🟢 Original working server
│   ├── index-working-enhanced.ts   # 🟢 Working enhanced server
│   ├── index-enhanced.ts           # 🔧 Full enhanced server
│   ├── types/
│   │   ├── core.ts                # Comprehensive Zebrunner data models
│   │   └── api.ts                 # API interfaces and error types
│   ├── api/
│   │   ├── client.ts              # Enhanced API client with retry logic
│   │   └── enhanced-client.ts     # Advanced client implementation
│   ├── handlers/
│   │   └── tools.ts               # MCP tool handlers
│   ├── utils/
│   │   ├── hierarchy.ts           # Suite hierarchy processing
│   │   └── formatter.ts           # Multi-format output processing
│   ├── zebrunnerClient.ts         # Original working client
│   ├── types.ts                   # Legacy compatibility layer
│   └── smoke.ts                   # API testing utility
├── tests/
│   ├── test-runner.ts             # Comprehensive test suite
│   ├── unit/                      # Unit tests
│   ├── integration/               # Integration tests
│   └── e2e/                       # End-to-end tests
├── dist/                          # Compiled JavaScript
├── .env.example                   # Environment template
├── IMPLEMENTATION_SUMMARY.md      # Comprehensive implementation analysis
├── ZEBRUNNER_MCP_ANALYSIS.md      # Original analysis document
└── README.md                      # This file
```

## Available Scripts

### Development
- `npm run dev` - **Main server** development mode with hot reload (recommended)
- `npm run dev:legacy` - Original server development mode
- `npm run dev:working` - Working enhanced server development mode
- `npm run dev:enhanced` - Full enhanced server development mode

### Production
- `npm start` - **Main server** production mode (recommended)
- `npm run start:legacy` - Original server production mode
- `npm run start:working` - Working enhanced server production mode
- `npm run start:enhanced` - Full enhanced server production mode

### Testing & Development
- `npm run build` - Build TypeScript to JavaScript
- `npm run smoke` - Run API smoke tests
- `npm run test` - Run comprehensive test suite
- `npm run test:unit` - Unit tests only
- `npm run test:integration` - Integration tests only
- `npm run test:e2e` - End-to-end tests only
- `npm run test:watch` - Watch mode for tests
- `npm run test:health` - Health check tests
- `npm run test:verbose` - Verbose test output

## Output Formats

The server supports multiple output formats for maximum flexibility:

- **`dto`** - Raw TypeScript objects for programmatic use
- **`json`** - Structured JSON data (default)
- **`string`** - Human-readable formatted text
- **`markdown`** - Rich formatted output with test steps and metadata

### Example Markdown Output
```markdown
# Test Case: User Login Validation

- **ID:** 12345
- **Key:** MFPAND-29
- **Priority:** High
- **Automation State:** Automated
- **Created By:** john.doe (2024-01-15)

## Description
Verify that user can successfully log in with valid credentials.

## Custom Fields
- **Test Type:** Functional
- **Component:** Authentication
- **Browser:** Chrome, Firefox

## Steps

### Step 1
- **Action:** Navigate to login page
- **Expected:** Login form is displayed

### Step 2
- **Action:** Enter valid username and password
- **Expected:** User is redirected to dashboard
```

## Troubleshooting

### Common Issues

#### 401/404 Errors
- Verify `ZEBRUNNER_URL` (no trailing slash)
- Check login/token credentials in `.env`
- Ensure your user has appropriate permissions
- Some endpoints may not be available on all Zebrunner instances

#### MCP Integration Issues
- Ensure the server builds successfully: `npm run build`
- Check that `dist/server.js` exists after building
- Verify environment variables are properly set
- Use `DEBUG=true` for detailed logging

#### Performance Issues
- Use pagination for large datasets (`page` and `size` parameters)
- Enable experimental features cautiously (`EXPERIMENTAL_FEATURES=true`)
- Consider using the simpler `index.ts` server for basic needs

### Debug Mode
Enable comprehensive logging:
```bash
DEBUG=true npm run dev
```

This provides detailed information about:
- API requests and responses
- Error details and stack traces
- Performance metrics
- Feature availability

### Security Best Practices
- Never commit `.env` files to version control
- Use environment variables in production deployments
- Rotate API tokens regularly
- Prefer Claude Desktop's secure environment variable handling

## Architecture Overview

### Server Implementations
1. **`server.ts`** (Recommended) - Unified server with all features, comprehensive error handling, and experimental feature flags
2. **`index.ts`** - Original simple server, proven stable for basic operations
3. **`index-working-enhanced.ts`** - Enhanced features with backward compatibility
4. **`index-enhanced.ts`** - Complete feature set (may require additional configuration)

### Key Components
- **Enhanced API Client** - Retry logic, error handling, automatic pagination
- **Type System** - Comprehensive Zod schemas based on Java DTO analysis
- **Hierarchy Processor** - Convert flat suite lists to hierarchical trees
- **Format Processor** - Multi-format output with intelligent type detection
- **Tool Handlers** - MCP-compliant tool implementations

## Future Enhancements

Potential additions based on user feedback:
- **Project Management** - `get_project_by_key` with intelligent caching
- **Export Capabilities** - Standalone Markdown/MDX file generation
- **Comparison Tools** - Diff between Zebrunner steps and actual test implementations
- **Advanced Filtering** - Status, labels, date ranges for all endpoints
- **Batch Operations** - Bulk test case operations
- **Real-time Updates** - WebSocket support for live test execution monitoring

## 🔧 Quick Reference: New Tools

### 📋 Subsuite Management
```bash
# Get all subsuites from root suite with pagination
get_all_subsuites:
  project_key: "MFPAND"
  root_suite_id: 18697
  page: 0
  size: 50
  format: "markdown"
```

### 🔍 Test Coverage Analysis  
```bash
# Analyze test case coverage against implementation
get_test_coverage_by_test_case_steps_by_key:
  case_key: "MFPAND-6"  # Auto-detects project: MFPAND
  implementation_context: "Your actual test code here..."
  analysis_scope: "full"
  output_format: "all"
  include_recommendations: true
  file_path: "tests/my_test.js"
```

**Coverage Analysis Output:**
- **Step Coverage**: Individual step analysis with percentage scores
- **Overall Score**: Comprehensive coverage percentage
- **Recommendations**: Actionable improvement suggestions
- **Multiple Formats**: Chat, Markdown, Code Comments
- **Implementation Detection**: Methods, assertions, UI elements, API calls

### 📚 Quick Start Cheat Sheet

#### Most Common Commands
```
# Basic operations (always available)
"List test suites for project MFPAND"
"Get test case MFPAND-29 details in markdown format"
"Show me the hierarchy of test suites for project MFPAND"

# Coverage analysis (always available)
"Analyze test coverage for MFPAND-6 against my implementation"

# Enhanced features (requires ENABLE_RULES_ENGINE=true)
"Generate draft test code for MFPAND-6 using Java Carina framework"
"Enhanced coverage analysis with rules validation for MFPAND-6"

# Advanced operations
"Get all subsuites from root suite 18697 with pagination"
```

#### Parameter Quick Reference
```
# Project keys are auto-detected from test case keys:
MFPAND-6 → project_key: "MFPAND"
MFPIOS-15 → project_key: "MFPIOS"

# Common formats:
format: "json" | "markdown" | "string" | "dto"
output_format: "chat" | "markdown" | "code" | "all"

# Framework detection keywords:
Java/Carina: @Test, WebDriver, AbstractTest, getDriver()
JavaScript/Jest: describe, it, expect, beforeEach
Python/Pytest: def test_, assert, pytest
```

#### Environment Setup Checklist
```
✅ ZEBRUNNER_URL - Your instance API URL
✅ ZEBRUNNER_LOGIN - Your username/email  
✅ ZEBRUNNER_TOKEN - Your API token
⚙️ ENABLE_RULES_ENGINE - Enable enhanced features (optional)
⚙️ MCP_RULES_FILE - Custom rules file path (optional)
⚙️ MIN_COVERAGE_THRESHOLD - Coverage threshold (optional)
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with appropriate tests
4. Ensure all tests pass: `npm test`
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

---

**Note**: This server has been thoroughly tested with real Zebrunner instances and provides both simple and advanced integration options. Choose the server implementation that best fits your needs - start with `server.ts` for the most comprehensive experience.