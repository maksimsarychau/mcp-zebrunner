/**
 * Test fixtures with Zebrunner API responses
 * These are based on MCP project structure
 */

export const testSuitesResponse = {
  items: [
    {
      id: 1,
      title: "MCP Test Suite",
      description: "Main test suite for MCP project",
      parentSuiteId: null,
      relativePosition: 0,
      projectId: 1,
      projectKey: "MCP",
      deleted: false,
      createdAt: "2023-10-01T10:00:00Z"
    }
  ],
  _meta: {
    totalElements: 1,
    totalPages: 1,
    currentPage: 0,
    pageSize: 50,
    hasNext: false,
    hasPrevious: false
  }
};

export const testCaseByKeyResponse = {
  data: {
    id: 1,
    key: "MCP-1",
    deleted: false,
    testSuite: { id: 1 },
    relativePosition: 0,
    createdAt: "2023-10-11T21:07:30.647458Z",
    lastModifiedAt: "2023-11-03T11:08:15.674298Z",
    title: "Test case 1",
    description: "Description for test case 1",
    priority: { id: 16, name: "Medium" },
    automationState: { id: 12, name: "Not Automated" },
    deprecated: false,
    draft: false,
    attachments: [],
    preConditions: null,
    postConditions: null,
    steps: [
      {
        id: 1,
        description: "Step 1 description",
        expectedResult: "Expected result for step 1"
      },
      {
        id: 2,
        description: "Step 2 description",
        expectedResult: "Expected result for step 2"
      }
    ],
    requirements: [],
    customField: {
      caseStatus: "Active",
      manualOnly: "No",
      isAutomated: "No"
    }
  }
};

export const testCasesResponse = {
  items: [
    {
      id: 1,
      key: "MCP-1",
      title: "Test case 1",
      status: "Active",
      priority: { id: 16, name: "Medium" },
      automationState: { id: 12, name: "Not Automated" },
      testSuite: { id: 1, title: "MCP Test Suite" },
      deleted: false,
      deprecated: false,
      draft: false
    },
    {
      id: 2,
      key: "MCP-2",
      title: "Test case 2",
      status: "Active",
      priority: { id: 16, name: "Medium" },
      automationState: { id: 12, name: "Not Automated" },
      testSuite: { id: 1, title: "MCP Test Suite" },
      deleted: false,
      deprecated: false,
      draft: false
    },
    {
      id: 3,
      key: "MCP-3",
      title: "Test case 3",
      status: "Active",
      priority: { id: 16, name: "Medium" },
      automationState: { id: 12, name: "Not Automated" },
      testSuite: { id: 1, title: "MCP Test Suite" },
      deleted: false,
      deprecated: false,
      draft: false
    }
  ],
  _meta: {
    totalElements: 3,
    totalPages: 1,
    currentPage: 0,
    pageSize: 50,
    hasNext: false,
    hasPrevious: false
  }
};

export const hierarchicalSuitesResponse = [
  {
    id: 1,
    title: "MCP Test Suite",
    description: "Main test suite for MCP project",
    parentSuiteId: null,
    rootSuiteId: 1,
    relativePosition: 0,
    projectId: 1,
    projectKey: "MCP",
    level: 0,
    path: "MCP Test Suite",
    children: []
  }
];

export const errorResponses = {
  notFound: {
    status: 404,
    data: {
      message: "Test suite not found",
      error: "NOT_FOUND",
      timestamp: "2023-11-15T10:30:00Z"
    }
  },
  badRequest: {
    status: 400,
    data: {
      message: "Either 'projectKey' or 'projectId' request parameter must be provided",
      error: "BAD_REQUEST",
      timestamp: "2023-11-15T10:30:00Z"
    }
  },
  unauthorized: {
    status: 401,
    data: {
      message: "Authentication failed",
      error: "UNAUTHORIZED",
      timestamp: "2023-11-15T10:30:00Z"
    }
  }
};

export const searchTestCasesResponse = {
  content: [
    {
      id: 1,
      key: "MCP-1",
      title: "Test case 1",
      status: "Active",
      priority: { id: 16, name: "Medium" },
      automationState: { id: 12, name: "Not Automated" }
    },
    {
      id: 2,
      key: "MCP-2",
      title: "Test case 2",
      status: "Active",
      priority: { id: 16, name: "Medium" },
      automationState: { id: 12, name: "Not Automated" }
    }
  ],
  totalElements: 2,
  totalPages: 1,
  currentPage: 0,
  pageSize: 20,
  hasNext: false,
  hasPrevious: false
};

export const testRunsResponse = {
  items: [
    {
      id: 1001,
      name: "MCP Test Run - Nov 2023",
      description: "Test run for MCP project",
      status: "COMPLETED",
      startedAt: "2023-11-01T09:00:00Z",
      endedAt: "2023-11-01T15:30:00Z",
      projectKey: "MCP",
      milestone: "Release 1.0.0",
      build: "1.0.0-RC1",
      environment: "staging",
      totalTests: 3,
      passedTests: 2,
      failedTests: 1,
      skippedTests: 0
    }
  ],
  _meta: {
    totalElements: 1,
    currentPage: 0,
    pageSize: 50,
    hasNext: false
  }
};

export const testResultsResponse = [
  {
    testCaseId: 1,
    testCaseKey: "MCP-1",
    testCaseTitle: "Test case 1",
    status: "PASSED",
    executedAt: "2023-11-01T10:15:00Z",
    duration: 2500,
    message: "Test completed successfully",
    stackTrace: null,
    issues: [],
    attachments: []
  },
  {
    testCaseId: 2,
    testCaseKey: "MCP-2",
    testCaseTitle: "Test case 2",
    status: "FAILED",
    executedAt: "2023-11-01T10:20:00Z",
    duration: 1800,
    message: "Test execution failed",
    stackTrace: "Error: Test assertion failed",
    issues: ["BUG-001"],
    attachments: ["screenshot-failure.png"]
  }
];

// Environment variables for testing
export const testConfig = {
  ZEBRUNNER_URL: "https://test.zebrunner.com/api/public/v1",
  ZEBRUNNER_LOGIN: "test.user@example.com",
  ZEBRUNNER_TOKEN: "test-token-123",
  PROJECT_KEY: "MCP",
  TEST_CASE_KEY: "MCP-1",
  TEST_SUITE_ID: 1
};









