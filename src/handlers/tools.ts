import { z } from "zod";
import { ZebrunnerApiClient } from "../api/client.js";
import { FormatProcessor } from "../utils/formatter.js";
import { HierarchyProcessor } from "../utils/hierarchy.js";
import {
  GetTestCasesInputSchema,
  GetTestSuitesInputSchema,
  GetTestRunsInputSchema,
  GetTestResultsInputSchema,
  SearchTestCasesInputSchema,
  FindTestCaseByKeyInputSchema,
  GetSuiteHierarchyInputSchema,
  OutputFormat
} from "../types/api.js";

/**
 * MCP Tool handlers for Zebrunner API
 */
export class ZebrunnerToolHandlers {
  constructor(private client: ZebrunnerApiClient) {}

  /**
   * Get test cases tool
   */
  async getTestCases(input: z.infer<typeof GetTestCasesInputSchema>) {
    const { projectKey, suiteId, rootSuiteId, includeSteps, format, page, size } = input;
    
    try {
      const searchParams = {
        page,
        size,
        suiteId,
        rootSuiteId
      };

      const response = await this.client.getTestCases(projectKey, searchParams);
      
      // If includeSteps is true, fetch detailed info for each test case
      if (includeSteps && response.items.length > 0) {
        const detailedCases = await Promise.all(
          response.items.slice(0, 10).map(async (testCase) => { // Limit to 10 for performance
            try {
              if (testCase.key) {
                return await this.client.getTestCaseByKey(projectKey, testCase.key);
              }
              return testCase;
            } catch (error) {
              return testCase; // Fallback to basic info if detailed fetch fails
            }
          })
        );
        
        const formattedData = FormatProcessor.format(detailedCases, format);
        return {
          content: [
            {
              type: "text" as const,
              text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
            }
          ]
        };
      }

      const formattedData = FormatProcessor.format(response, format);
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving test cases: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Get test suites tool
   */
  async getTestSuites(input: z.infer<typeof GetTestSuitesInputSchema>) {
    const { projectKey, parentSuiteId, rootOnly, includeHierarchy, format, page, size } = input;
    
    try {
      const searchParams = {
        page,
        size,
        parentSuiteId
      };

      let response = await this.client.getTestSuites(projectKey, searchParams);
      
      if (rootOnly) {
        response.items = response.items.filter(suite => !suite.parentSuiteId);
      }

      if (includeHierarchy) {
        // Get all suites to build hierarchy
        const allSuites = await this.client.getAllTestSuites(projectKey);
        const enrichedSuites = HierarchyProcessor.enrichSuitesWithHierarchy(allSuites);
        
        // Filter to requested suites but with hierarchy info
        response.items = response.items.map(suite => {
          const enriched = enrichedSuites.find(s => s.id === suite.id);
          return enriched || suite;
        });
      }

      const formattedData = FormatProcessor.format(response, format);
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving test suites: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Get suite hierarchy tool
   */
  async getSuiteHierarchy(input: z.infer<typeof GetSuiteHierarchyInputSchema>) {
    const { projectKey, rootSuiteId, maxDepth, format } = input;
    
    try {
      const allSuites = await this.client.getAllTestSuites(projectKey);
      let suitesToProcess = allSuites;

      // Filter by root suite if specified
      if (rootSuiteId) {
        const descendants = HierarchyProcessor.getSuiteDescendants(rootSuiteId, allSuites);
        const rootSuite = allSuites.find(s => s.id === rootSuiteId);
        suitesToProcess = rootSuite ? [rootSuite, ...descendants] : descendants;
      }

      // Build hierarchical tree
      const hierarchyTree = HierarchyProcessor.buildSuiteTree(suitesToProcess);
      
      // Limit depth if specified
      const limitDepth = (suites: any[], currentDepth: number): any[] => {
        if (currentDepth >= maxDepth) {
          return suites.map(suite => ({ ...suite, children: [] }));
        }
        
        return suites.map(suite => ({
          ...suite,
          children: suite.children ? limitDepth(suite.children, currentDepth + 1) : []
        }));
      };

      const limitedTree = limitDepth(hierarchyTree, 0);
      const formattedData = FormatProcessor.format(limitedTree, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving suite hierarchy: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Get test runs tool
   */
  async getTestRuns(input: z.infer<typeof GetTestRunsInputSchema>) {
    const { projectKey, status, milestone, build, environment, format, page, size } = input;
    
    try {
      const searchParams = {
        page,
        size,
        status,
        milestone,
        build,
        environment
      };

      const response = await this.client.getTestRuns(projectKey, searchParams);
      const formattedData = FormatProcessor.format(response, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving test runs: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Get test results tool
   */
  async getTestResults(input: z.infer<typeof GetTestResultsInputSchema>) {
    const { projectKey, runId, status, format } = input;
    
    try {
      let results = await this.client.getTestResults(projectKey, runId);
      
      if (status) {
        results = results.filter(result => result.status === status);
      }

      const formattedData = FormatProcessor.format(results, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving test results: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Search test cases tool
   */
  async searchTestCases(input: z.infer<typeof SearchTestCasesInputSchema>) {
    const { projectKey, query, suiteId, status, priority, automationState, format, page, size } = input;
    
    try {
      const searchParams = {
        page,
        size,
        suiteId,
        status,
        priority,
        automationState
      };

      const response = await this.client.searchTestCases(projectKey, query, searchParams);
      const formattedData = FormatProcessor.format(response, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error searching test cases: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Find test case by key tool
   */
  async findTestCaseByKey(input: z.infer<typeof FindTestCaseByKeyInputSchema>) {
    const { projectKey, caseKey, includeSteps, format } = input;
    
    try {
      const testCase = await this.client.getTestCaseByKey(projectKey, caseKey);
      
      let formattedData: string | object;
      
      if (format === 'string' && includeSteps) {
        // Use markdown format for better readability
        formattedData = FormatProcessor.formatTestCaseMarkdown(testCase);
      } else {
        formattedData = FormatProcessor.format(testCase, format);
      }
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error finding test case: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Get root suites tool
   */
  async getRootSuites(projectKey: string, format: OutputFormat = 'json') {
    try {
      const rootSuites = await this.client.getRootSuites(projectKey);
      const enrichedSuites = HierarchyProcessor.enrichSuitesWithHierarchy(rootSuites);
      const formattedData = FormatProcessor.format(enrichedSuites, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving root suites: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Get test cases by suite tool
   */
  async getTestCasesBySuite(projectKey: string, suiteId: number, format: OutputFormat = 'json') {
    try {
      const testCases = await this.client.getTestCasesBySuite(projectKey, suiteId);
      const formattedData = FormatProcessor.format(testCases, format);
      
      return {
        content: [
          {
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error retrieving test cases by suite: ${error.message}`
          }
        ]
      };
    }
  }
}
