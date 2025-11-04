import { z } from "zod";

/** API-related types and interfaces */

// Output format options
export type OutputFormat = 'dto' | 'json' | 'string' | 'markdown';

// Pagination options
export interface PaginationOptions {
  page?: number;
  size?: number;
  pageToken?: string;
}

// Configuration interface
export interface ZebrunnerConfig {
  baseUrl: string;
  username: string;
  token: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  debug?: boolean;
  defaultPageSize?: number;
  maxPageSize?: number;
}

// Search and filter parameters
export interface TestCaseSearchParams extends PaginationOptions {
  projectKey?: string;
  projectId?: number;
  query?: string;
  suiteId?: number;
  rootSuiteId?: number;
  status?: string;
  priority?: string | number;
  automationState?: string | number | (string | number)[]; // Support mixed arrays of names and IDs
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  sortBy?: string; // Sorting parameter
  // RQL filter for advanced filtering
  filter?: string;
}

export interface TestSuiteSearchParams extends PaginationOptions {
  projectKey?: string;
  projectId?: number;
  parentSuiteId?: number;
  rootOnly?: boolean;
}

export interface TestRunSearchParams extends PaginationOptions {
  projectKey?: string;
  projectId?: number;
  status?: string;
  milestone?: string;
  build?: string;
  environment?: string;
  startedAfter?: string;
  startedBefore?: string;
}

// MCP Tool input schemas
export const GetTestCasesInputSchema = z.object({
  projectKey: z.string().min(1),
  suiteId: z.number().int().positive().optional(),
  rootSuiteId: z.number().int().positive().optional(),
  includeSteps: z.boolean().default(false),
  format: z.enum(['dto', 'json', 'string']).default('json'),
  page: z.number().int().nonnegative().optional(),
  size: z.number().int().positive().max(200).optional()
});

export const GetTestSuitesInputSchema = z.object({
  projectKey: z.string().min(1),
  parentSuiteId: z.number().int().positive().optional(),
  rootOnly: z.boolean().default(false),
  includeHierarchy: z.boolean().default(false),
  format: z.enum(['dto', 'json', 'string']).default('json'),
  page: z.number().int().nonnegative().optional(),
  size: z.number().int().positive().max(200).optional()
});

export const GetTestRunsInputSchema = z.object({
  projectKey: z.string().min(1),
  status: z.string().optional(),
  milestone: z.string().optional(),
  build: z.string().optional(),
  environment: z.string().optional(),
  format: z.enum(['dto', 'json', 'string']).default('json'),
  page: z.number().int().nonnegative().optional(),
  size: z.number().int().positive().max(200).optional()
});

export const GetTestResultsInputSchema = z.object({
  projectKey: z.string().min(1),
  runId: z.number().int().positive(),
  status: z.string().optional(),
  format: z.enum(['dto', 'json', 'string']).default('json')
});


export const FindTestCaseByKeyInputSchema = z.object({
  projectKey: z.string().min(1),
  caseKey: z.string().min(1),
  includeSteps: z.boolean().default(true),
  format: z.enum(['dto', 'json', 'string']).default('json')
});

export const GetSuiteHierarchyInputSchema = z.object({
  projectKey: z.string().min(1),
  rootSuiteId: z.number().int().positive().optional(),
  maxDepth: z.number().int().positive().max(10).default(5),
  format: z.enum(['dto', 'json', 'string']).default('json')
});

export const GetLauncherDetailsInputSchema = z.object({
  projectKey: z.string().min(1).optional(),
  projectId: z.number().int().positive().optional(),
  launchId: z.number().int().positive(),
  includeLaunchDetails: z.boolean().default(true),
  includeTestSessions: z.boolean().default(true),
  format: z.enum(['dto', 'json', 'string']).default('json')
});

export const AnalyzeTestFailureInputSchema = z.object({
  testId: z.number().int().positive(),
  testRunId: z.number().int().positive(), // launchId
  projectKey: z.string().min(1).optional(),
  projectId: z.number().int().positive().optional(),
  includeScreenshots: z.boolean().default(true),
  includeLogs: z.boolean().default(true),
  includeArtifacts: z.boolean().default(true),
  includePageSource: z.boolean().default(true),
  includeVideo: z.boolean().default(false),
  analyzeSimilarFailures: z.boolean().default(true),
  format: z.enum(['detailed', 'summary']).default('detailed')
});

export const ValidateTestCaseInputSchema = z.object({
  projectKey: z.string().min(1),
  caseKey: z.string().min(1),
  rulesFilePath: z.string().optional(),
  checkpointsFilePath: z.string().optional(),
  format: z.enum(['dto', 'json', 'string', 'markdown']).default('json'),
  improveIfPossible: z.boolean().default(true)
});

export const ImproveTestCaseInputSchema = z.object({
  projectKey: z.string().min(1),
  caseKey: z.string().min(1),
  rulesFilePath: z.string().optional(),
  checkpointsFilePath: z.string().optional(),
  format: z.enum(['dto', 'json', 'string', 'markdown']).default('markdown'),
  applyHighConfidenceChanges: z.boolean().default(true)
});

// Type exports for input schemas
export type GetTestCasesInput = z.infer<typeof GetTestCasesInputSchema>;
export type GetTestSuitesInput = z.infer<typeof GetTestSuitesInputSchema>;
export type GetTestRunsInput = z.infer<typeof GetTestRunsInputSchema>;
export type GetTestResultsInput = z.infer<typeof GetTestResultsInputSchema>;
export type FindTestCaseByKeyInput = z.infer<typeof FindTestCaseByKeyInputSchema>;
export type GetSuiteHierarchyInput = z.infer<typeof GetSuiteHierarchyInputSchema>;
export type GetLauncherDetailsInput = z.infer<typeof GetLauncherDetailsInputSchema>;
export type AnalyzeTestFailureInput = z.infer<typeof AnalyzeTestFailureInputSchema>;
export type ValidateTestCaseInput = z.infer<typeof ValidateTestCaseInputSchema>;
export type ImproveTestCaseInput = z.infer<typeof ImproveTestCaseInputSchema>;

// Error types
export class ZebrunnerApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: any,
    public endpoint?: string
  ) {
    super(message);
    this.name = 'ZebrunnerApiError';
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      response: this.response,
      endpoint: this.endpoint
    };
  }
}

export class ZebrunnerAuthError extends ZebrunnerApiError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401);
    this.name = 'ZebrunnerAuthError';
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      response: this.response,
      endpoint: this.endpoint
    };
  }
}

export class ZebrunnerNotFoundError extends ZebrunnerApiError {
  constructor(resource: string, identifier: string | number) {
    super(`${resource} not found: ${identifier}`, 404);
    this.name = 'ZebrunnerNotFoundError';
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      response: this.response,
      endpoint: this.endpoint
    };
  }
}

export class ZebrunnerRateLimitError extends ZebrunnerApiError {
  constructor(retryAfter?: number) {
    super(`Rate limit exceeded${retryAfter !== undefined ? `, retry after ${retryAfter}s` : ''}`, 429);
    this.name = 'ZebrunnerRateLimitError';
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      response: this.response,
      endpoint: this.endpoint
    };
  }
}

// Video Analysis Input Schema
export const AnalyzeTestExecutionVideoInputSchema = z.object({
  testId: z.number().int().positive().describe("Test ID from Zebrunner"),
  testRunId: z.number().int().positive().describe("Launch ID / Test Run ID"),
  projectKey: z.string().min(1).optional().describe("Project key (MFPAND, MFPIOS, MFPWEB)"),
  projectId: z.number().int().positive().optional().describe("Project ID (alternative to projectKey)"),

  // Video Analysis Options
  extractionMode: z.enum(['failure_focused', 'full_test', 'smart']).default('smart')
    .describe("Frame extraction mode: failure_focused (10 frames around failure), full_test (30 frames throughout), smart (20 frames at key moments)"),
  frameInterval: z.number().int().positive().default(5)
    .describe("Seconds between frames for full_test mode"),
  failureWindowSeconds: z.number().int().positive().default(30)
    .describe("Time window around failure to analyze (seconds)"),

  // Test Case Comparison
  compareWithTestCase: z.boolean().default(true)
    .describe("Compare video execution with test case steps"),
  testCaseKey: z.string().optional()
    .describe("Override test case key if different from test metadata"),

  // Analysis Depth
  includeOCR: z.boolean().default(true)
    .describe("Extract text from frames using OCR"),
  analyzeSimilarFailures: z.boolean().default(false)
    .describe("Find similar failures in launch (not yet implemented)"),
  includeLogCorrelation: z.boolean().default(true)
    .describe("Correlate frames with log timestamps"),

  // Output Format
  format: z.enum(['detailed', 'summary', 'jira']).default('detailed')
    .describe("Output format: detailed (full analysis), summary (condensed), jira (ticket-ready)"),
  generateVideoReport: z.boolean().default(true)
    .describe("Generate timestamped video analysis report")
});

export type AnalyzeTestExecutionVideoInput = z.infer<typeof AnalyzeTestExecutionVideoInputSchema>;
