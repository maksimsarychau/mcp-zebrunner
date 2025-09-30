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
  startedAt: z.number(), // timestamp
  endedAt: z.number().optional(), // timestamp
  elapsed: z.number().optional(),
  framework: z.string().optional(),
  environment: z.string().optional(),
  build: z.string().optional(),
  locale: z.string().optional(),
  platform: z.string().optional(),
  platformVersion: z.string().optional(),
  device: z.string().optional(),
  passed: z.number().optional(),
  passedManually: z.number().optional(),
  failed: z.number().optional(),
  failedAsKnown: z.number().optional(),
  skipped: z.number().optional(),
  blocked: z.number().optional(),
  inProgress: z.number().optional(),
  aborted: z.number().optional(),
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

// Test session response schema
export const TestSessionResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  platform: z.string().optional(),
  platformVersion: z.string().optional(),
  browser: z.string().optional(),
  browserVersion: z.string().optional(),
  device: z.string().optional(),
  sessionId: z.string().optional(),
  passed: z.number().optional(),
  failed: z.number().optional(),
  skipped: z.number().optional(),
  aborted: z.number().optional(),
  knownIssue: z.number().optional(),
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
