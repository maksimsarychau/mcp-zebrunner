import { z } from "zod";

/** Core Zebrunner entities based on comprehensive analysis */

// User information
export const ZebrunnerUserSchema = z.object({
  id: z.number(),
  username: z.string().nullable(),
  email: z.string().nullable()
});

// Priority levels
export const ZebrunnerPrioritySchema = z.object({
  id: z.number(),
  name: z.string()
});

// Automation state
export const ZebrunnerAutomationStateSchema = z.object({
  id: z.number(),
  name: z.string()
});

// Test case step
export const ZebrunnerCaseStepSchema = z.object({
  id: z.number().optional(),
  stepNumber: z.number().optional(),
  number: z.number().optional(),
  index: z.number().optional(),
  order: z.number().optional(),
  action: z.string().optional(),
  actual: z.string().optional(),
  step: z.string().optional(),
  actionText: z.string().optional(),
  instruction: z.string().optional(),
  name: z.string().optional(),
  expected: z.string().optional(),
  expectedResult: z.string().optional(),
  expectedText: z.string().optional(),
  result: z.string().optional(),
  data: z.any().optional(),
  inputs: z.any().optional(),
  parameters: z.any().optional(),
  payload: z.any().optional()
});

// Test suite with full hierarchy information
export const ZebrunnerTestSuiteSchema: z.ZodType<any> = z.object({
  id: z.number(),
  title: z.string().optional(),
  name: z.string().optional(), // Some APIs use name instead of title
  description: z.string().nullable().optional(),
  parentSuiteId: z.number().nullable().optional(),
  rootSuiteId: z.number().nullable().optional(),
  // Enhanced hierarchy properties from Java methodology
  parentSuiteName: z.string().optional(),
  rootSuiteName: z.string().optional(),
  treeNames: z.string().optional(), // Complete path like "Root > Parent > Suite"
  level: z.number().optional(), // Hierarchy depth level
  path: z.string().optional(), // Alternative path representation
  relativePosition: z.number().optional(),
  projectId: z.number().optional(),
  projectKey: z.string().optional(),
  deleted: z.boolean().optional(),
  createdAt: z.string().optional(),
  createdBy: ZebrunnerUserSchema.optional(),
  lastModifiedAt: z.string().optional(),
  lastModifiedBy: ZebrunnerUserSchema.optional(),
  // Hierarchy information
  children: z.array(z.lazy(() => ZebrunnerTestSuiteSchema)).optional()
});

// Full test case with all metadata
export const ZebrunnerTestCaseSchema = z.object({
  id: z.number(),
  key: z.string().optional(),
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  deleted: z.boolean().optional(),
  testSuite: z.object({
    id: z.number(),
    title: z.string().optional(),
    name: z.string().optional()
  }).optional(),
  featureSuiteId: z.number().optional(), // The immediate parent suite (feature suite)
  rootSuiteId: z.number().optional(),
  relativePosition: z.number().optional(),
  createdAt: z.string().optional(),
  createdBy: ZebrunnerUserSchema.optional(),
  lastModifiedAt: z.string().optional(),
  lastModifiedBy: ZebrunnerUserSchema.optional(),
  priority: ZebrunnerPrioritySchema.optional(),
  automationState: ZebrunnerAutomationStateSchema.optional(),
  deprecated: z.boolean().optional(),
  draft: z.boolean().optional(),
  attachments: z.array(z.any()).optional(),
  preConditions: z.string().nullable().optional(),
  postConditions: z.string().nullable().optional(),
  customField: z.record(z.any()).optional(),
  steps: z.array(ZebrunnerCaseStepSchema).optional(),
  requirements: z.array(z.any()).optional(),
  projKey: z.string().optional()
});

// Lightweight test case for bulk operations
export const ZebrunnerShortTestCaseSchema = z.object({
  id: z.number(),
  key: z.string().optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  priority: ZebrunnerPrioritySchema.optional(),
  automationState: ZebrunnerAutomationStateSchema.optional(),
  testSuite: z.object({
    id: z.number(),
    title: z.string().optional()
  }).optional(),
  deleted: z.boolean().optional(),
  deprecated: z.boolean().optional(),
  draft: z.boolean().optional()
});

// Test execution item
export const ZebrunnerTestExecutionItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  status: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  createdBy: ZebrunnerUserSchema.optional(),
  projectKey: z.string().optional(),
  milestone: z.string().optional(),
  build: z.string().optional(),
  environment: z.string().optional()
});

// Test run details
export const ZebrunnerTestRunSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  status: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  createdBy: ZebrunnerUserSchema.optional(),
  projectKey: z.string().optional(),
  milestone: z.string().optional(),
  build: z.string().optional(),
  environment: z.string().optional(),
  totalTests: z.number().optional(),
  passedTests: z.number().optional(),
  failedTests: z.number().optional(),
  skippedTests: z.number().optional()
});

// Test result response
export const ZebrunnerTestResultResponseSchema = z.object({
  testCaseId: z.number(),
  testCaseKey: z.string().optional(),
  testCaseTitle: z.string().optional(),
  status: z.string(),
  executedAt: z.string().optional(),
  duration: z.number().optional(),
  message: z.string().optional(),
  stackTrace: z.string().optional(),
  issues: z.array(z.string()).optional(),
  attachments: z.array(z.any()).optional()
});

// Pagination metadata
export const MetaSchema = z.object({
  nextPageToken: z.string().optional(),
  previousPageToken: z.string().optional(),
  totalElements: z.number().optional(),
  totalPages: z.number().optional(),
  currentPage: z.number().optional(),
  pageSize: z.number().optional(),
  hasNext: z.boolean().optional(),
  hasPrevious: z.boolean().optional()
});

// Generic paged response
export const PagedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T): z.ZodObject<{
  items: z.ZodArray<T>;
  _meta: z.ZodOptional<typeof MetaSchema>;
}> => z.object({
  items: z.array(itemSchema),
  _meta: MetaSchema.optional()
});

// Type exports
export type ZebrunnerUser = z.infer<typeof ZebrunnerUserSchema>;
export type ZebrunnerPriority = z.infer<typeof ZebrunnerPrioritySchema>;
export type ZebrunnerAutomationState = z.infer<typeof ZebrunnerAutomationStateSchema>;
export type ZebrunnerCaseStep = z.infer<typeof ZebrunnerCaseStepSchema>;
export type ZebrunnerTestSuite = z.infer<typeof ZebrunnerTestSuiteSchema>;
export type ZebrunnerTestCase = z.infer<typeof ZebrunnerTestCaseSchema>;
export type ZebrunnerShortTestCase = z.infer<typeof ZebrunnerShortTestCaseSchema>;
export type ZebrunnerTestExecutionItem = z.infer<typeof ZebrunnerTestExecutionItemSchema>;
export type ZebrunnerTestRun = z.infer<typeof ZebrunnerTestRunSchema>;
export type ZebrunnerTestResultResponse = z.infer<typeof ZebrunnerTestResultResponseSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type PagedResponse<T> = {
  items: T[];
  _meta?: Meta;
};

// === Public API Test Run Schemas ===

// Test Run Configuration
export const PublicTestRunConfigurationSchema = z.object({
  group: z.object({
    id: z.number(),
    name: z.string()
  }),
  option: z.object({
    id: z.number(),
    name: z.string()
  })
});

// Test Run Environment
export const PublicTestRunEnvironmentSchema = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string()
});

// Test Run Milestone
export const PublicTestRunMilestoneSchema = z.object({
  id: z.number(),
  name: z.string(),
  completed: z.boolean(),
  description: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional()
});

// Test Run Requirement
export const PublicTestRunRequirementSchema = z.object({
  source: z.enum(["JIRA", "AZURE_DEVOPS"]),
  reference: z.string()
});

// Test Run Execution Summary
export const PublicTestRunExecutionSummarySchema = z.object({
  status: z.object({
    id: z.number(),
    name: z.string(),
    colorHex: z.string()
  }),
  testCasesCount: z.number()
});

// Public API Test Run Resource
export const PublicTestRunResourceSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable().optional(),
  milestone: PublicTestRunMilestoneSchema.nullable().optional(),
  environment: PublicTestRunEnvironmentSchema.nullable().optional(),
  configurations: z.array(PublicTestRunConfigurationSchema).default([]),
  requirements: z.array(PublicTestRunRequirementSchema).default([]),
  closed: z.boolean(),
  createdBy: ZebrunnerUserSchema,
  createdAt: z.string(),
  executionSummaries: z.array(PublicTestRunExecutionSummarySchema).default([])
});

// Test Run Test Case Resource
export const PublicTestRunTestCaseResourceSchema = z.object({
  testCase: z.object({
    id: z.number(),
    key: z.string(),
    title: z.string()
  }),
  assignee: ZebrunnerUserSchema.nullable().optional(),
  result: z.object({
    status: z.object({
      id: z.number(),
      name: z.string(),
      aliases: z.string().nullable().optional()
    }),
    details: z.string().nullable().optional(),
    issue: z.object({
      type: z.enum(["JIRA", "GITHUB"]),
      id: z.string()
    }).nullable().optional(),
    executionTimeInMillis: z.number().nullable().optional(),
    executionType: z.enum(["MANUAL", "AUTOMATED"]).optional(),
    attachments: z.array(z.object({
      fileUuid: z.string()
    })).default([])
  }).nullable().optional()
});

// Paginated responses for Public API
export const PublicTestRunsResponseSchema = z.object({
  items: z.array(PublicTestRunResourceSchema),
  _meta: z.object({
    nextPageToken: z.string().optional()
  }).optional()
});

export const PublicTestRunResponseSchema = z.object({
  data: PublicTestRunResourceSchema
});

export const PublicTestRunTestCasesResponseSchema = z.object({
  items: z.array(PublicTestRunTestCaseResourceSchema)
});

// Test Run Settings schemas
export const ResultStatusResourceSchema = z.object({
  id: z.number(),
  name: z.string(),
  aliases: z.string().nullable().optional(),
  colorHex: z.string(),
  enabled: z.boolean(),
  isCompleted: z.boolean(),
  isSuccess: z.boolean(),
  isFailure: z.boolean(),
  isAssignable: z.boolean()
});

export const ConfigurationGroupOptionSchema = z.object({
  id: z.number(),
  name: z.string()
});

export const ConfigurationGroupResourceSchema = z.object({
  id: z.number(),
  name: z.string(),
  options: z.array(ConfigurationGroupOptionSchema)
});

export const ResultStatusesResponseSchema = z.object({
  items: z.array(ResultStatusResourceSchema)
});

export const ConfigurationGroupsResponseSchema = z.object({
  items: z.array(ConfigurationGroupResourceSchema)
});

// Type exports for Public API
export type PublicTestRunResource = z.infer<typeof PublicTestRunResourceSchema>;
export type PublicTestRunTestCaseResource = z.infer<typeof PublicTestRunTestCaseResourceSchema>;
export type PublicTestRunsResponse = z.infer<typeof PublicTestRunsResponseSchema>;
export type PublicTestRunResponse = z.infer<typeof PublicTestRunResponseSchema>;
export type PublicTestRunTestCasesResponse = z.infer<typeof PublicTestRunTestCasesResponseSchema>;

// Type exports for Test Run Settings
export type ResultStatusResource = z.infer<typeof ResultStatusResourceSchema>;
export type ConfigurationGroupResource = z.infer<typeof ConfigurationGroupResourceSchema>;
export type ResultStatusesResponse = z.infer<typeof ResultStatusesResponseSchema>;
export type ConfigurationGroupsResponse = z.infer<typeof ConfigurationGroupsResponseSchema>;
