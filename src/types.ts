// Re-export all types from the new modular structure
export * from "./types/core.js";
export * from "./types/api.js";

// Legacy schemas for backward compatibility
import { z } from "zod";

export const ListTestSuitesSchema = z.object({
  project_key: z.string().optional(),
  project_id: z.number().int().positive().optional()
}).refine(data => data.project_key || data.project_id, {
  message: "Either project_key or project_id must be provided"
});

export const GetTestSuiteSchema = z.object({
  suite_id: z.number().int().positive()
});

export const ListTestCasesSchema = z.object({
  suite_id: z.number().int().positive()
});

export const GetTestCaseSchema = z.object({
  case_id: z.number().int().positive()
});

export const GetTestCaseByKeySchema = z.object({
  case_key: z.string().min(1),
  project_key: z.string().min(1)
});

export const SearchTestCasesSchema = z.object({
  project_key: z.string().optional(),
  project_id: z.number().int().positive().optional(),
  query: z.string().min(1),
  page: z.number().int().nonnegative().optional(),   // 0-based
  size: z.number().int().positive().max(200).optional()
}).refine(data => data.project_key || data.project_id, {
  message: "Either project_key or project_id must be provided"
});

// Legacy schemas for backward compatibility - use new schemas from core.ts instead
export const TestSuiteSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  description: z.string().optional(),
  parentSuiteId: z.number().optional(),
  relativePosition: z.number().optional(),
  projectId: z.number().optional(),
  projectKey: z.string().optional()
});

export const TestCaseLiteSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  status: z.string().optional()
});

export const TestCaseDetailsSchema = z.object({
  id: z.number(),
  key: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  deleted: z.boolean().optional(),
  deprecated: z.boolean().optional(),
  draft: z.boolean().optional(),
  priority: z.object({
    id: z.number(),
    name: z.string()
  }).optional(),
  automationState: z.object({
    id: z.number(),
    name: z.string()
  }).optional(),
  testSuite: z.object({
    id: z.number()
  }).optional(),
  createdAt: z.string().optional(),
  createdBy: z.object({
    id: z.number(),
    username: z.string(),
    email: z.string()
  }).optional(),
  lastModifiedAt: z.string().optional(),
  lastModifiedBy: z.object({
    id: z.number(),
    username: z.string(),
    email: z.string()
  }).optional(),
  steps: z.array(z.record(z.any())).optional(),
  customField: z.record(z.any()).optional(),
  attachments: z.array(z.any()).optional(),
  requirements: z.array(z.any()).optional(),
  preConditions: z.string().optional(),
  postConditions: z.string().optional()
});

// Legacy type exports
export type TestSuite = z.infer<typeof TestSuiteSchema>;
export type TestCaseLite = z.infer<typeof TestCaseLiteSchema>;
export type TestCaseDetails = z.infer<typeof TestCaseDetailsSchema>;
