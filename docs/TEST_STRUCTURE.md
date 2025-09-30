# Test Structure Documentation

This document describes the test organization and execution strategy for the Zebrunner MCP Server.

## 📁 Directory Structure

```
tests/
├── unit/                    # Unit tests (no credentials required)
│   ├── api-utils.test.ts
│   ├── debug-scenarios.test.ts
│   ├── formatter.test.ts
│   ├── hierarchy.test.ts
│   ├── mcp-tools.test.ts
│   └── types.test.ts
├── integration/             # Integration tests (require credentials)
│   ├── api-client.test.ts
│   ├── debug-scenarios-manual.test.ts
│   ├── reporting-api.test.ts
│   └── suite-hierarchy.test.ts
├── e2e/                     # End-to-end tests (require credentials + server)
│   ├── server-manual.test.ts
│   └── server.test.ts
├── fixtures/                # Test data and mock responses
│   └── api-responses.ts
├── helpers/                 # Test utilities
│   └── credentials.ts
└── test-runner.ts          # Main test runner
```

## 🚀 Running Tests

### Unit Tests (No Credentials Required)
```bash
npm run test:unit
```
- **Fast execution** (~400ms)
- **No external dependencies**
- **Perfect for CI/CD**
- Tests: Schema validation, formatters, hierarchy processing, error classes

### Integration Tests (Require Credentials)
```bash
npm run test:integration
```
- **Requires valid .env file** with Zebrunner credentials
- **Makes real API calls**
- **For local development only**
- Tests: API client, suite hierarchy, reporting API

### End-to-End Tests (Require Credentials + Server)
```bash
npm run test:e2e
```
- **Requires valid .env file**
- **Starts actual MCP server**
- **Full system testing**
- Tests: Server startup, MCP protocol, tool execution

### All Tests
```bash
npm test
# or
npm run test:all
```
- Runs all test categories in sequence
- Requires credentials for integration and e2e tests

## 🔐 Credential Management

### Required Environment Variables
For integration and e2e tests, you need:
```bash
ZEBRUNNER_URL=https://your-zebrunner-instance.com/api/public/v1
ZEBRUNNER_LOGIN=your.email@company.com
ZEBRUNNER_TOKEN=your_api_token
```

### Credential Validation
- **Unit tests**: Never require credentials
- **Integration tests**: Fail fast with helpful error if credentials missing
- **E2E tests**: Fail fast with helpful error if credentials missing

### Helper Functions
```typescript
import { requireCredentials, hasValidCredentials } from '../helpers/credentials.js';

// Fail fast if credentials missing
const credentials = requireCredentials('Test Suite Name');

// Check if credentials available (for optional tests)
if (hasValidCredentials()) {
  // Run test
} else {
  // Skip test
}
```

## 🤖 GitHub Actions

### CI/CD Strategy
- **GitHub Actions runs ONLY unit tests**
- **No secrets or credentials in CI**
- **Fast feedback loop** (~1-2 minutes)

### Workflow File
`.github/workflows/test.yml`:
- Runs on Node.js 18.x and 20.x
- Installs dependencies
- Builds project
- Runs unit tests only
- Checks TypeScript compilation

### Local vs CI Testing
| Environment | Unit Tests | Integration Tests | E2E Tests |
|-------------|------------|-------------------|-----------|
| **GitHub Actions** | ✅ Always | ❌ Never | ❌ Never |
| **Local Development** | ✅ Always | ✅ With credentials | ✅ With credentials |

## 📊 Test Categories

### Unit Tests (121 tests, ~400ms)
- **API Error Classes**: Error handling and inheritance
- **Debug Scenario Unit Tests**: Hierarchy processing logic
- **FormatProcessor**: Output formatting and type guards
- **HierarchyProcessor**: Suite tree building and navigation
- **MCP Tools Schema Validation**: Input/output validation
- **Zod Schema Validation**: Data structure validation

### Integration Tests (Variable count, ~60s)
- **API Client Tests**: Real Zebrunner API calls
- **Suite Hierarchy Tests**: Hierarchy enhancement features
- **Reporting API Tests**: Zebrunner reporting integration
- **Debug Scenarios**: Manual testing scenarios

### E2E Tests (Variable count, ~15s)
- **Server Manual Tests**: MCP server startup and protocol
- **Server Tests**: Full system integration

## 🛠️ Development Workflow

### For Contributors
1. **Always run unit tests first**: `npm run test:unit`
2. **Set up .env for integration testing**: Copy credentials
3. **Run integration tests locally**: `npm run test:integration`
4. **Run full test suite**: `npm test`

### For CI/CD
1. **GitHub Actions automatically runs unit tests**
2. **No manual intervention needed**
3. **Fast feedback on pull requests**

### Adding New Tests
- **Pure logic/formatting**: Add to `tests/unit/`
- **API interactions**: Add to `tests/integration/`
- **Full server testing**: Add to `tests/e2e/`

## 🔧 Test Utilities

### Credential Helper (`tests/helpers/credentials.ts`)
```typescript
// Require credentials (fail fast)
const credentials = requireCredentials('Test Name');

// Check if available (optional)
if (hasValidCredentials()) { /* ... */ }

// Skip if no credentials
skipIfNoCredentials('Test Name');
```

### Test Runner (`tests/test-runner.ts`)
- Handles different test categories
- Validates prerequisites
- Provides helpful error messages
- Supports watch mode and verbose output

## 📈 Benefits

### For Development
- **Fast unit test feedback** (400ms vs 60s+)
- **Clear separation of concerns**
- **Easy to run specific test types**
- **Helpful error messages for missing credentials**

### For CI/CD
- **No credential management in CI**
- **Fast pipeline execution**
- **Reliable unit test coverage**
- **No external API dependencies**

### For Maintenance
- **Clear test organization**
- **Easy to add new tests**
- **Consistent credential handling**
- **Good documentation and examples**
