/**
 * Test fixtures with real Zebrunner API responses
 * These are based on actual API responses from the MFPAND project
 */

export const testSuitesResponse = {
  items: [
    {
      id: 18708,
      title: "Intro Primer Screen",
      description: "Task - https://myfitnesspal.atlassian.net/browse/TOTS-3785",
      parentSuiteId: null,
      relativePosition: 0,
      projectId: 123,
      projectKey: "MFPAND",
      deleted: false,
      createdAt: "2023-10-01T10:00:00Z"
    },
    {
      id: 18707,
      title: "Non-trial",
      description: null,
      parentSuiteId: null,
      relativePosition: 1,
      projectId: 123,
      projectKey: "MFPAND",
      deleted: false,
      createdAt: "2023-10-01T10:00:00Z"
    },
    {
      id: 18706,
      title: "Trial",
      description: null,
      parentSuiteId: null,
      relativePosition: 2,
      projectId: 123,
      projectKey: "MFPAND",
      deleted: false,
      createdAt: "2023-10-01T10:00:00Z"
    }
  ],
  _meta: {
    totalElements: 10,
    totalPages: 1,
    currentPage: 0,
    pageSize: 50,
    hasNext: false,
    hasPrevious: false
  }
};

export const testCaseByKeyResponse = {
  data: {
    id: 201,
    key: "MFPAND-29",
    deleted: false,
    testSuite: { id: 88 },
    relativePosition: 0,
    createdAt: "2023-10-11T21:07:30.647458Z",
    createdBy: {
      id: 604,
      username: "maksim.sarychau",
      email: "maksim.sarychau@ext.myfitnesspal.com"
    },
    lastModifiedAt: "2023-11-03T11:08:15.674298Z",
    lastModifiedBy: {
      id: 522,
      username: "iiemelianova",
      email: "irina.iemelianova@ext.myfitnesspal.com"
    },
    title: "Reminders -> Add reminder",
    description: null,
    priority: { id: 16, name: "Medium" },
    automationState: { id: 12, name: "Automated" },
    deprecated: false,
    draft: false,
    attachments: [],
    preConditions: null,
    postConditions: null,
    steps: [],
    requirements: [],
    customField: {
      testrailUpdatedAt: "2022-03-18 17:17:19 UTC",
      expectedResultAdditional: "Time Reminder added",
      testrailUpdatedBy: "<unknown>",
      testrailCaseType: "Other",
      caseStatus: "Implemented correctly",
      stepsAdditional: "Create new reminder, select time, not group, set reminder time",
      testrailId: "102898",
      deprecated_1: "No",
      testrailCreatedAt: "2022-03-18 17:17:19 UTC",
      deprecated_3: "No",
      deprecated_2: "No",
      testrailCreatedBy: "<unknown>",
      legacy_id: "C1727002",
      manualOnly: "No",
      isAutomated: "Yes"
    }
  }
};

export const testCasesResponse = {
  items: [
    {
      id: 201,
      key: "MFPAND-29",
      title: "Reminders -> Add reminder",
      status: "Active",
      priority: { id: 16, name: "Medium" },
      automationState: { id: 12, name: "Automated" },
      testSuite: { id: 88, title: "Reminders" },
      deleted: false,
      deprecated: false,
      draft: false
    },
    {
      id: 202,
      key: "MFPAND-30",
      title: "Login -> Valid credentials",
      status: "Active",
      priority: { id: 17, name: "High" },
      automationState: { id: 12, name: "Automated" },
      testSuite: { id: 89, title: "Authentication" },
      deleted: false,
      deprecated: false,
      draft: false
    }
  ],
  _meta: {
    totalElements: 150,
    totalPages: 3,
    currentPage: 0,
    pageSize: 50,
    hasNext: true,
    hasPrevious: false
  }
};

export const hierarchicalSuitesResponse = [
  {
    id: 18708,
    title: "Root Suite 1",
    description: "Top level suite",
    parentSuiteId: null,
    rootSuiteId: 18708,
    relativePosition: 0,
    projectId: 123,
    projectKey: "MFPAND",
    level: 0,
    path: "Root Suite 1",
    children: [
      {
        id: 18709,
        title: "Child Suite 1.1",
        description: "First child",
        parentSuiteId: 18708,
        rootSuiteId: 18708,
        relativePosition: 0,
        projectId: 123,
        projectKey: "MFPAND",
        level: 1,
        path: "Root Suite 1 > Child Suite 1.1",
        children: []
      },
      {
        id: 18710,
        title: "Child Suite 1.2",
        description: "Second child",
        parentSuiteId: 18708,
        rootSuiteId: 18708,
        relativePosition: 1,
        projectId: 123,
        projectKey: "MFPAND",
        level: 1,
        path: "Root Suite 1 > Child Suite 1.2",
        children: []
      }
    ]
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
      id: 201,
      key: "MFPAND-29",
      title: "Reminders -> Add reminder",
      status: "Active",
      priority: { id: 16, name: "Medium" },
      automationState: { id: 12, name: "Automated" }
    },
    {
      id: 205,
      key: "MFPAND-33",
      title: "Test reminder functionality",
      status: "Active",
      priority: { id: 16, name: "Medium" },
      automationState: { id: 13, name: "Manual" }
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
      name: "Regression Test Run - Nov 2023",
      description: "Full regression testing for release 2.1.0",
      status: "COMPLETED",
      startedAt: "2023-11-01T09:00:00Z",
      endedAt: "2023-11-01T15:30:00Z",
      createdBy: {
        id: 604,
        username: "maksim.sarychau",
        email: "maksim.sarychau@ext.myfitnesspal.com"
      },
      projectKey: "MFPAND",
      milestone: "Release 2.1.0",
      build: "2.1.0-RC1",
      environment: "staging",
      totalTests: 150,
      passedTests: 142,
      failedTests: 6,
      skippedTests: 2
    }
  ],
  _meta: {
    totalElements: 25,
    currentPage: 0,
    pageSize: 50,
    hasNext: false
  }
};

export const testResultsResponse = [
  {
    testCaseId: 201,
    testCaseKey: "MFPAND-29",
    testCaseTitle: "Reminders -> Add reminder",
    status: "PASSED",
    executedAt: "2023-11-01T10:15:00Z",
    duration: 2500,
    message: "Test completed successfully",
    stackTrace: null,
    issues: [],
    attachments: []
  },
  {
    testCaseId: 202,
    testCaseKey: "MFPAND-30",
    testCaseTitle: "Login -> Valid credentials",
    status: "FAILED",
    executedAt: "2023-11-01T10:20:00Z",
    duration: 1800,
    message: "Login button not found",
    stackTrace: "ElementNotFoundError: Unable to locate element with selector '#login-btn'",
    issues: ["BUG-1234"],
    attachments: ["screenshot-failure.png"]
  }
];

// Environment variables for testing
export const testConfig = {
  ZEBRUNNER_URL: "https://mfp.zebrunner.com/api/public/v1",
  ZEBRUNNER_LOGIN: "test.user@example.com",
  ZEBRUNNER_TOKEN: "test-token-123",
  PROJECT_KEY: "MFPAND",
  TEST_CASE_KEY: "MFPAND-29",
  TEST_SUITE_ID: 18708
};







