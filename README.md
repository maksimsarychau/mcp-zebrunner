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
        "EXPERIMENTAL_FEATURES": "false"
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