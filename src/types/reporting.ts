import { z } from "zod";

/**
 * Types for Zebrunner Reporting API
 * This is separate from the TCM Public API and uses different authentication
 */

// Configuration for the new reporting client
export interface ZebrunnerReportingConfig {
  baseUrl: string;
  accessToken: string;
  timeout?: number;
  debug?: boolean;
}

// Authentication response from refresh endpoint
export const AuthTokenResponseSchema = z.object({
  authToken: z.string(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().optional(),
  tokenType: z.string().optional()
});

export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;

// Launch response schema - matches the actual API response structure
export const LaunchResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  ciRunId: z.string().optional(),
  status: z.string(),
  project: z.object({
    id: z.number(),
    name: z.string(),
    key: z.string(),
    deleted: z.boolean()
  }).optional(),
  projectId: z.number(),
  user: z.object({
    id: z.number(),
    username: z.string(),
    email: z.string()
  }).optional(),
  testSuite: z.object({
    id: z.number(),
    name: z.string(),
    projectId: z.number().nullable()
  }).optional(),
  ciBuild: z.object({
    jobUrl: z.string(),
    number: z.string()
  }).optional(),
  startedAt: z.coerce.number(), // timestamp - coerce to handle string or number
  endedAt: z.coerce.number().optional(), // timestamp - coerce to handle string or number
  elapsed: z.coerce.number().optional(),
  framework: z.string().optional(),
  environment: z.string().optional(),
  build: z.string().optional(),
  locale: z.string().optional(),
  platform: z.string().optional(),
  platformVersion: z.string().optional(),
  device: z.string().optional(),
  passed: z.coerce.number().optional(),
  passedManually: z.coerce.number().optional(),
  failed: z.coerce.number().optional(),
  failedAsKnown: z.coerce.number().optional(),
  skipped: z.coerce.number().optional(),
  blocked: z.coerce.number().optional(),
  inProgress: z.coerce.number().optional(),
  aborted: z.coerce.number().optional(),
  reviewed: z.boolean().optional(),
  isRelaunchPossible: z.boolean().optional(),
  isLaunchAgainPossible: z.boolean().optional(),
  isAbortPossible: z.boolean().optional(),
  labels: z.array(z.object({
    key: z.string(),
    value: z.string()
  })).optional(),
  artifacts: z.array(z.object({
    name: z.string(),
    value: z.string()
  })).optional(),
  testSuiteId: z.number().optional(),
  userId: z.number().optional()
});

export type LaunchResponse = z.infer<typeof LaunchResponseSchema>;

// Project response schema
export const ProjectResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  key: z.string(),
  logoUrl: z.string().optional(),
  createdAt: z.string(),
  leadId: z.number().nullable().optional(),
  publiclyAccessible: z.boolean().optional(),
  deleted: z.boolean()
});

export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

// Test session response schema - supports both old and new API structures
export const TestSessionResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  sessionId: z.string().optional(),
  initiatedAt: z.string().optional(), // New API uses ISO string
  startedAt: z.union([z.coerce.number(), z.string()]).optional(), // timestamp or ISO string
  endedAt: z.union([z.coerce.number(), z.string()]).optional(), // timestamp or ISO string
  platform: z.string().optional(), // Old API field
  platformName: z.string().nullable().optional(), // New API field
  platformVersion: z.string().nullable().optional(),
  browser: z.string().optional(), // Old API field
  browserName: z.string().nullable().optional(), // New API field
  browserVersion: z.string().nullable().optional(),
  device: z.string().optional(), // Old API field
  deviceName: z.string().nullable().optional(), // New API field
  passed: z.coerce.number().optional(),
  failed: z.coerce.number().optional(),
  skipped: z.coerce.number().optional(),
  aborted: z.coerce.number().optional(),
  knownIssue: z.coerce.number().optional(),
  durationInSeconds: z.number().optional(), // New API field
  tests: z.array(z.object({ // New API field
    id: z.number(),
    name: z.string(),
    status: z.string(),
    passedManually: z.boolean()
  })).optional(),
  artifactReferences: z.array(z.object({
    name: z.string(),
    value: z.string()
  })).optional()
});

export type TestSessionResponse = z.infer<typeof TestSessionResponseSchema>;

// Paginated test sessions response
export const TestSessionsResponseSchema = z.object({
  items: z.array(TestSessionResponseSchema),
  totalElements: z.number().optional(),
  totalPages: z.number().optional(),
  page: z.number().optional(),
  size: z.number().optional()
});

export type TestSessionsResponse = z.infer<typeof TestSessionsResponseSchema>;

// Milestone response schema - matches actual API response
export const MilestoneResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  completed: z.boolean(),
  description: z.string().nullable().optional(),
  projectId: z.number(),
  dueDate: z.string().nullable().optional(), // ISO date string, can be null
  startDate: z.string().nullable().optional(), // ISO date string, can be null
});

export type MilestoneResponse = z.infer<typeof MilestoneResponseSchema>;

// Paginated milestones response - matches actual API response structure
export const MilestonesResponseSchema = z.object({
  items: z.array(MilestoneResponseSchema),
  _meta: z.object({
    total: z.number(),
    totalPages: z.number()
  })
});

export type MilestonesResponse = z.infer<typeof MilestonesResponseSchema>;

// Available projects response schema
export const AvailableProjectResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  key: z.string(),
  logoUrl: z.string().optional(),
  createdAt: z.string().optional(), // ISO date string
  leadId: z.number().nullable().optional(),
  starred: z.boolean(),
  publiclyAccessible: z.boolean(),
  deleted: z.boolean()
});

export type AvailableProjectResponse = z.infer<typeof AvailableProjectResponseSchema>;

// Available projects list response
export const AvailableProjectsResponseSchema = z.object({
  items: z.array(AvailableProjectResponseSchema)
});

export type AvailableProjectsResponse = z.infer<typeof AvailableProjectsResponseSchema>;

// Projects limit response (for pagination info)
export const ProjectsLimitResponseSchema = z.object({
  data: z.object({
    limit: z.number(),
    currentTotal: z.number()
  })
});

export type ProjectsLimitResponse = z.infer<typeof ProjectsLimitResponseSchema>;

// Launch list item response schema (for launches listing API)
export const LaunchListItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  milestone: z.object({
    id: z.number(),
    name: z.string(),
    completed: z.boolean().optional(),
    description: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional()
  }).nullable().optional(),
  startedAt: z.coerce.number().optional(), // timestamp - coerce to handle string or number
  finishedAt: z.coerce.number().nullable().optional(), // timestamp - coerce to handle string or number
  duration: z.coerce.number().nullable().optional(),
  passed: z.coerce.number().optional(),
  failed: z.coerce.number().optional(),
  skipped: z.coerce.number().optional(),
  aborted: z.coerce.number().optional(),
  queued: z.coerce.number().optional(),
  total: z.coerce.number().optional(),
  projectId: z.number(),
  userId: z.number().optional(),
  buildNumber: z.string().nullable().optional(),
  jobUrl: z.string().nullable().optional(),
  upstream: z.boolean().optional(),
  reviewed: z.boolean().optional()
});

export type LaunchListItem = z.infer<typeof LaunchListItemSchema>;

// Paginated launches response
export const LaunchesResponseSchema = z.object({
  items: z.array(LaunchListItemSchema),
  _meta: z.object({
    total: z.number(),
    totalPages: z.number()
  })
});

export type LaunchesResponse = z.infer<typeof LaunchesResponseSchema>;

// Test run response schema (individual test execution within a launch)
export const TestRunResponseSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  status: z.string(),
  message: z.string().optional(),
  messageHashCode: z.coerce.number().optional(),
  startTime: z.coerce.number(), // timestamp
  finishTime: z.coerce.number().optional(), // timestamp
  issueReferences: z.array(z.object({
    id: z.coerce.number(),
    type: z.string(),
    value: z.string()
  })).optional(),
  knownIssue: z.boolean().optional(),
  passedManually: z.boolean().optional(),
  owner: z.string().optional(),
  testClass: z.string().optional(),
  artifacts: z.array(z.any()).optional(),
  labels: z.array(z.object({
    key: z.string(),
    value: z.string()
  })).optional(),
  failureTagAssignments: z.array(z.any()).optional(),
  testCases: z.array(z.object({
    testId: z.coerce.number(),
    tcmType: z.string(),
    testCaseId: z.string(),
    resultStatus: z.string().nullable().optional()
  })).optional(),
  testGroups: z.array(z.any()).optional(),
  testSessionsCount: z.coerce.number().optional(),
  maintainerId: z.coerce.number().optional(),
  stability: z.coerce.number().optional(),
  notNullTestGroup: z.string().optional(),
  testRunId: z.coerce.number(),
  testCaseId: z.coerce.number().optional()
});

export type TestRunResponse = z.infer<typeof TestRunResponseSchema>;

// Paginated test runs response
export const TestRunsResponseSchema = z.object({
  items: z.array(TestRunResponseSchema),
  totalElements: z.coerce.number().optional(),
  totalPages: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
  size: z.coerce.number().optional()
});

export type TestRunsResponse = z.infer<typeof TestRunsResponseSchema>;

// Log item schema (from test-execution-logs API)
export const LogItemSchema = z.object({
  kind: z.enum(['log', 'screenshot']),
  level: z.string().optional(), // INFO, WARN, ERROR, etc.
  instant: z.string(), // ISO timestamp
  value: z.string() // Log message or screenshot file path
});

export type LogItem = z.infer<typeof LogItemSchema>;

// Logs and screenshots response
export const LogsAndScreenshotsResponseSchema = z.object({
  items: z.array(LogItemSchema),
  _meta: z.object({
    nextPageToken: z.string().optional()
  }).optional()
});

export type LogsAndScreenshotsResponse = z.infer<typeof LogsAndScreenshotsResponseSchema>;

// Error types for reporting API
export class ZebrunnerReportingError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: any
  ) {
    super(message);
    this.name = 'ZebrunnerReportingError';
  }
}

export class ZebrunnerReportingAuthError extends ZebrunnerReportingError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = 'ZebrunnerReportingAuthError';
  }
}

export class ZebrunnerReportingNotFoundError extends ZebrunnerReportingError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = 'ZebrunnerReportingNotFoundError';
  }
}
