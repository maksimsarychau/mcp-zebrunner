import { z } from "zod";

/** Core Zebrunner entities based on comprehensive analysis */

// User information
export const ZebrunnerUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string()
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
  relativePosition: z.number().optional(),
  projectId: z.number().optional(),
  projectKey: z.string().optional(),
  deleted: z.boolean().optional(),
  createdAt: z.string().optional(),
  createdBy: ZebrunnerUserSchema.optional(),
  lastModifiedAt: z.string().optional(),
  lastModifiedBy: ZebrunnerUserSchema.optional(),
  // Hierarchy information
  children: z.array(z.lazy(() => ZebrunnerTestSuiteSchema)).optional(),
  path: z.string().optional(), // Full path from root
  level: z.number().optional() // Depth in hierarchy
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
