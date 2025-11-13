import { z } from "zod";
import { ZebrunnerApiClient } from "../api/client.js";
import { FormatProcessor } from "../utils/formatter.js";
import { HierarchyProcessor } from "../utils/hierarchy.js";
import {
  GetTestCasesInputSchema,
  GetTestSuitesInputSchema,
  GetTestRunsInputSchema,
  GetTestResultsInputSchema,
  FindTestCaseByKeyInputSchema,
  GetSuiteHierarchyInputSchema,
  ValidateTestCaseInputSchema,
  ImproveTestCaseInputSchema,
  OutputFormat
} from "../types/api.js";
import { TestCaseValidator } from "../utils/test-case-validator.js";
import { TestCaseImprover } from "../utils/test-case-improver.js";
import path from "path";
import { validateFilePath, sanitizeErrorMessage } from "../utils/security.js";

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
      const errorMsg = sanitizeErrorMessage(error, 'Error retrieving test cases', 'getTestCases');
      return {
        content: [
          {
            type: "text" as const,
            text: errorMsg
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

  /**
   * Validate test case tool
   */
  async validateTestCase(input: z.infer<typeof ValidateTestCaseInputSchema>) {
    const { projectKey, caseKey, rulesFilePath, checkpointsFilePath, format, improveIfPossible } = input;
    
    try {
      // Get the test case data first
      const testCase = await this.client.getTestCaseByKey(projectKey, caseKey);
      
      // Initialize validator with dynamic rules
      let validator: TestCaseValidator;
      if (rulesFilePath && checkpointsFilePath) {
        // Use custom rules from files - validate paths first
        try {
          const resolvedRulesPath = validateFilePath(rulesFilePath, process.cwd());
          const resolvedCheckpointsPath = validateFilePath(checkpointsFilePath, process.cwd());
          validator = await TestCaseValidator.fromMarkdownFiles(resolvedRulesPath, resolvedCheckpointsPath);
        } catch (error) {
          throw new Error(`Invalid file path provided: ${error instanceof Error ? error.message : error}`);
        }
      } else {
        // Use default rules, but try to load from standard files if they exist
        const defaultRulesPath = path.resolve(process.cwd(), 'test_case_review_rules.md');
        const defaultCheckpointsPath = path.resolve(process.cwd(), 'test_case_analysis_checkpoints.md');
        
        try {
          validator = await TestCaseValidator.fromMarkdownFiles(defaultRulesPath, defaultCheckpointsPath);
        } catch (error) {
          // Fall back to default rules if files don't exist
          validator = new TestCaseValidator();
        }
      }
      
      // Validate the test case
      const validationResult = await validator.validateTestCase(testCase);
      
      // Attempt improvement if requested
      let improvementResult = null;
      if (improveIfPossible) {
        const improver = new TestCaseImprover();
        improvementResult = await improver.improveTestCase(testCase, validationResult);
      }
      
      // Format the result based on requested format
      let formattedResult: string;
      
      if (format === 'markdown') {
        formattedResult = this.formatValidationResultAsMarkdown(validationResult, improvementResult);
      } else if (format === 'string') {
        formattedResult = this.formatValidationResultAsString(validationResult, improvementResult);
      } else {
        const result = improvementResult 
          ? { validation: validationResult, improvement: improvementResult }
          : validationResult;
        formattedResult = JSON.stringify(result, null, 2);
      }
      
      return {
        content: [
          {
            type: "text" as const,
            text: formattedResult
          }
        ]
      };
    } catch (error: any) {
      const errorMsg = sanitizeErrorMessage(error, 'Error validating test case', 'validateTestCase');
      return {
        content: [
          {
            type: "text" as const,
            text: errorMsg
          }
        ]
      };
    }
  }

  /**
   * Formats validation result as markdown
   */
  private formatValidationResultAsMarkdown(result: any, improvementResult?: any): string {
    const { testCaseKey, testCaseTitle, automationStatus, priority, status, manualOnly, overallScore, scoreCategory, issues, passedCheckpoints, summary, readyForAutomation, readyForManualExecution, rulesUsed } = result;
    
    let markdown = `# Test Case Validation Report\n\n`;
    
    // Test Case Information section
    markdown += `## 📋 Test Case Information\n\n`;
    markdown += `- **Test Case:** ${testCaseKey} - ${testCaseTitle}\n`;
    markdown += `- **Automation Status:** ${automationStatus}\n`;
    if (priority) {
      markdown += `- **Priority:** ${priority}\n`;
    }
    if (status) {
      markdown += `- **Status:** ${status}\n`;
    }
    if (manualOnly) {
      markdown += `- **Manual Only:** ${manualOnly}\n`;
    }
    markdown += `- **Rules Used:** ${rulesUsed}\n\n`;
    
    markdown += `## 📊 Summary\n\n`;
    markdown += `${summary}\n\n`;
    
    markdown += `## Overall Assessment\n\n`;
    markdown += `- **Score:** ${overallScore}% (${scoreCategory.replace('_', ' ').toUpperCase()})\n`;
    markdown += `- **Ready for Manual Execution:** ${readyForManualExecution ? '✅ Yes' : '❌ No'}\n`;
    markdown += `- **Ready for Automation:** ${readyForAutomation ? '✅ Yes' : '❌ No'}\n\n`;
    
    if (issues.length > 0) {
      markdown += `## Issues Found (${issues.length})\n\n`;
      
      const criticalIssues = issues.filter((i: any) => i.severity === 'critical');
      const majorIssues = issues.filter((i: any) => i.severity === 'major');
      const minorIssues = issues.filter((i: any) => i.severity === 'minor');
      
      if (criticalIssues.length > 0) {
        markdown += `### 🔴 Critical Issues (${criticalIssues.length})\n\n`;
        criticalIssues.forEach((issue: any, index: number) => {
          markdown += `${index + 1}. **${issue.checkpoint}** (${issue.category})\n`;
          markdown += `   - ${issue.description}\n`;
          if (issue.suggestion) {
            markdown += `   - 💡 *Suggestion: ${issue.suggestion}*\n`;
          }
          markdown += `\n`;
        });
      }
      
      if (majorIssues.length > 0) {
        markdown += `### 🟡 Major Issues (${majorIssues.length})\n\n`;
        majorIssues.forEach((issue: any, index: number) => {
          markdown += `${index + 1}. **${issue.checkpoint}** (${issue.category})\n`;
          markdown += `   - ${issue.description}\n`;
          if (issue.suggestion) {
            markdown += `   - 💡 *Suggestion: ${issue.suggestion}*\n`;
          }
          markdown += `\n`;
        });
      }
      
      if (minorIssues.length > 0) {
        markdown += `### 🔵 Minor Issues (${minorIssues.length})\n\n`;
        minorIssues.forEach((issue: any, index: number) => {
          markdown += `${index + 1}. **${issue.checkpoint}** (${issue.category})\n`;
          markdown += `   - ${issue.description}\n`;
          if (issue.suggestion) {
            markdown += `   - 💡 *Suggestion: ${issue.suggestion}*\n`;
          }
          markdown += `\n`;
        });
      }
    }
    
    if (passedCheckpoints.length > 0) {
      markdown += `## ✅ Passed Checkpoints (${passedCheckpoints.length})\n\n`;
      passedCheckpoints.forEach((checkpoint: any, index: number) => {
        markdown += `${index + 1}. ${checkpoint}\n`;
      });
    }

    // Add improvement section if available
    if (improvementResult) {
      markdown += `\n## 🔧 Test Case Improvement Analysis\n\n`;
      
      if (improvementResult.canImprove) {
        markdown += `**Can Improve:** ✅ Yes (Confidence: ${improvementResult.confidence.toUpperCase()})\n`;
        markdown += `**Requires Human Help:** ${improvementResult.requiresHumanHelp ? '⚠️ Yes' : '✅ No'}\n\n`;
        
        if (improvementResult.improvements.length > 0) {
          markdown += `### 🔨 Suggested Improvements (${improvementResult.improvements.length})\n\n`;
          
          const automaticImprovements = improvementResult.improvements.filter((imp: any) => imp.type === 'automatic');
          const contentImprovements = improvementResult.improvements.filter((imp: any) => imp.type === 'content');
          const structuralImprovements = improvementResult.improvements.filter((imp: any) => imp.type === 'structure');
          
          if (automaticImprovements.length > 0) {
            markdown += `#### 🤖 Automatic Fixes (${automaticImprovements.length})\n\n`;
            automaticImprovements.forEach((imp: any, index: number) => {
              markdown += `${index + 1}. **${imp.category}** [${imp.confidence.toUpperCase()} confidence]\n`;
              markdown += `   - ${imp.description}\n`;
              if (imp.originalValue && imp.suggestedValue) {
                markdown += `   - Before: "${imp.originalValue}"\n`;
                markdown += `   - After: "${imp.suggestedValue}"\n`;
              }
              markdown += `   - *${imp.reasoning}*\n\n`;
            });
          }
          
          if (contentImprovements.length > 0) {
            markdown += `#### ✏️ Content Improvements (${contentImprovements.length})\n\n`;
            contentImprovements.forEach((imp: any, index: number) => {
              markdown += `${index + 1}. **${imp.category}** [${imp.confidence.toUpperCase()} confidence]\n`;
              markdown += `   - ${imp.description}\n`;
              if (imp.originalValue && imp.suggestedValue) {
                markdown += `   - Suggested: "${imp.suggestedValue}"\n`;
              }
              markdown += `   - *${imp.reasoning}*\n\n`;
            });
          }
          
          if (structuralImprovements.length > 0) {
            markdown += `#### 🏗️ Structural Improvements (${structuralImprovements.length})\n\n`;
            structuralImprovements.forEach((imp: any, index: number) => {
              markdown += `${index + 1}. **${imp.category}** [${imp.confidence.toUpperCase()} confidence]\n`;
              markdown += `   - ${imp.description}\n`;
              if (imp.suggestedValue) {
                markdown += `   - Suggestion: ${imp.suggestedValue}\n`;
              }
              markdown += `   - *${imp.reasoning}*\n\n`;
            });
          }
        }
        
        if (improvementResult.improvedTestCase) {
          markdown += `### 📋 Improved Test Case Draft\n\n`;
          markdown += `**Title:** ${improvementResult.improvedTestCase.title || 'No title'}\n\n`;
          
          if (improvementResult.improvedTestCase.preConditions) {
            markdown += `**Preconditions:**\n${improvementResult.improvedTestCase.preConditions}\n\n`;
          }
          
          if (improvementResult.improvedTestCase.steps && improvementResult.improvedTestCase.steps.length > 0) {
            markdown += `**Steps:**\n`;
            improvementResult.improvedTestCase.steps.forEach((step: any, index: number) => {
              const action = step.action || step.step || step.instruction || '';
              const expected = step.expected || step.expectedResult || step.expectedText || step.result || '';
              markdown += `${index + 1}. ${action}\n`;
              if (expected) {
                markdown += `   - Expected: ${expected}\n`;
              }
            });
            markdown += `\n`;
          }
        }
      } else {
        markdown += `**Can Improve:** ❌ No automatic improvements possible\n\n`;
      }
      
      if (improvementResult.requiresHumanHelp && improvementResult.humanHelpReasons.length > 0) {
        markdown += `### 👤 Requires Human Help\n\n`;
        improvementResult.humanHelpReasons.forEach((reason: string, index: number) => {
          markdown += `${index + 1}. ${reason}\n`;
        });
        markdown += `\n`;
      }
    }
    
    return markdown;
  }

  /**
   * Formats validation result as readable string
   */
  private formatValidationResultAsString(result: any, improvementResult?: any): string {
    const { testCaseKey, testCaseTitle, automationStatus, priority, status, manualOnly, overallScore, scoreCategory, issues, passedCheckpoints, summary, readyForAutomation, readyForManualExecution } = result;
    
    let output = `TEST CASE VALIDATION REPORT\n`;
    output += `${'='.repeat(50)}\n\n`;
    
    // Test Case Information section
    output += `TEST CASE INFORMATION:\n`;
    output += `Test Case: ${testCaseKey} - ${testCaseTitle}\n`;
    output += `Automation Status: ${automationStatus}\n`;
    if (priority) {
      output += `Priority: ${priority}\n`;
    }
    if (status) {
      output += `Status: ${status}\n`;
    }
    if (manualOnly) {
      output += `Manual Only: ${manualOnly}\n`;
    }
    output += `\nSUMMARY:\n`;
    output += `${summary}\n\n`;
    
    if (issues.length > 0) {
      output += `ISSUES FOUND (${issues.length}):\n`;
      issues.forEach((issue: any, index: number) => {
        const severityIcon = issue.severity === 'critical' ? '🔴' : issue.severity === 'major' ? '🟡' : '🔵';
        output += `${index + 1}. ${severityIcon} [${issue.severity.toUpperCase()}] ${issue.checkpoint}\n`;
        output += `   ${issue.description}\n`;
        if (issue.suggestion) {
          output += `   💡 ${issue.suggestion}\n`;
        }
        output += `\n`;
      });
    }
    
    if (passedCheckpoints.length > 0) {
      output += `PASSED CHECKPOINTS (${passedCheckpoints.length}):\n`;
      passedCheckpoints.forEach((checkpoint: any, index: number) => {
        output += `${index + 1}. ✅ ${checkpoint}\n`;
      });
    }

    // Add improvement section if available
    if (improvementResult) {
      output += `\nIMPROVEMENT ANALYSIS:\n`;
      output += `${'='.repeat(30)}\n`;
      output += `Can Improve: ${improvementResult.canImprove ? 'Yes' : 'No'}\n`;
      if (improvementResult.canImprove) {
        output += `Confidence: ${improvementResult.confidence.toUpperCase()}\n`;
        output += `Requires Human Help: ${improvementResult.requiresHumanHelp ? 'Yes' : 'No'}\n\n`;
        
        if (improvementResult.improvements.length > 0) {
          output += `SUGGESTED IMPROVEMENTS (${improvementResult.improvements.length}):\n`;
          improvementResult.improvements.forEach((imp: any, index: number) => {
            output += `${index + 1}. [${imp.type.toUpperCase()}] ${imp.category}\n`;
            output += `   ${imp.description}\n`;
            if (imp.suggestedValue) {
              output += `   Suggestion: ${imp.suggestedValue}\n`;
            }
            output += `   Confidence: ${imp.confidence.toUpperCase()}\n\n`;
          });
        }
        
        if (improvementResult.humanHelpReasons.length > 0) {
          output += `REQUIRES HUMAN HELP:\n`;
          improvementResult.humanHelpReasons.forEach((reason: string, index: number) => {
            output += `${index + 1}. ${reason}\n`;
          });
        }
      }
    }
    
    return output;
  }

  /**
   * Improve test case tool - dedicated improvement functionality
   */
  async improveTestCase(input: z.infer<typeof ImproveTestCaseInputSchema>) {
    const { projectKey, caseKey, rulesFilePath, checkpointsFilePath, format, applyHighConfidenceChanges } = input;
    
    try {
      // Get the test case data first
      const testCase = await this.client.getTestCaseByKey(projectKey, caseKey);
      
      // Initialize validator with dynamic rules
      let validator: TestCaseValidator;
      if (rulesFilePath && checkpointsFilePath) {
        // Use custom rules from files - validate paths first
        try {
          const resolvedRulesPath = validateFilePath(rulesFilePath, process.cwd());
          const resolvedCheckpointsPath = validateFilePath(checkpointsFilePath, process.cwd());
          validator = await TestCaseValidator.fromMarkdownFiles(resolvedRulesPath, resolvedCheckpointsPath);
        } catch (error) {
          throw new Error(`Invalid file path provided: ${error instanceof Error ? error.message : error}`);
        }
      } else {
        // Use default rules, but try to load from standard files if they exist
        const defaultRulesPath = path.resolve(process.cwd(), 'test_case_review_rules.md');
        const defaultCheckpointsPath = path.resolve(process.cwd(), 'test_case_analysis_checkpoints.md');
        
        try {
          validator = await TestCaseValidator.fromMarkdownFiles(defaultRulesPath, defaultCheckpointsPath);
        } catch (error) {
          // Fall back to default rules if files don't exist
          validator = new TestCaseValidator();
        }
      }
      
      // Validate the test case first
      const validationResult = await validator.validateTestCase(testCase);
      
      // Attempt improvement
      const improver = new TestCaseImprover();
      const improvementResult = await improver.improveTestCase(testCase, validationResult);
      
      // Apply high-confidence changes if requested
      let finalTestCase = testCase;
      if (applyHighConfidenceChanges && improvementResult.improvedTestCase) {
        finalTestCase = improvementResult.improvedTestCase;
      }
      
      // Format the result
      let formattedResult: string;
      
      if (format === 'markdown') {
        formattedResult = this.formatImprovementResultAsMarkdown(
          validationResult, 
          improvementResult, 
          finalTestCase, 
          applyHighConfidenceChanges
        );
      } else if (format === 'string') {
        formattedResult = this.formatImprovementResultAsString(
          validationResult, 
          improvementResult, 
          finalTestCase, 
          applyHighConfidenceChanges
        );
      } else {
        formattedResult = JSON.stringify({
          validation: validationResult,
          improvement: improvementResult,
          finalTestCase,
          changesApplied: applyHighConfidenceChanges
        }, null, 2);
      }
      
      return {
        content: [
          {
            type: "text" as const,
            text: formattedResult
          }
        ]
      };
    } catch (error: any) {
      const errorMsg = sanitizeErrorMessage(error, 'Error improving test case', 'improveTestCase');
      return {
        content: [
          {
            type: "text" as const,
            text: errorMsg
          }
        ]
      };
    }
  }

  /**
   * Format improvement result as markdown
   */
  private formatImprovementResultAsMarkdown(
    validationResult: any, 
    improvementResult: any, 
    finalTestCase: any, 
    changesApplied: boolean
  ): string {
    let markdown = `# Test Case Improvement Report\n\n`;
    
    // Test Case Information section
    markdown += `## 📋 Test Case Information\n\n`;
    markdown += `- **Test Case:** ${validationResult.testCaseKey} - ${validationResult.testCaseTitle}\n`;
    markdown += `- **Automation Status:** ${validationResult.automationStatus}\n`;
    if (validationResult.priority) {
      markdown += `- **Priority:** ${validationResult.priority}\n`;
    }
    if (validationResult.status) {
      markdown += `- **Status:** ${validationResult.status}\n`;
    }
    if (validationResult.manualOnly) {
      markdown += `- **Manual Only:** ${validationResult.manualOnly}\n`;
    }
    markdown += `\n`;
    markdown += `**Original Score:** ${validationResult.overallScore}% (${validationResult.scoreCategory.replace('_', ' ').toUpperCase()})\n`;
    markdown += `**Changes Applied:** ${changesApplied ? '✅ Yes' : '❌ No'}\n\n`;
    
    if (improvementResult.canImprove) {
      markdown += `## 🔧 Improvement Analysis\n\n`;
      markdown += `- **Can Improve:** ✅ Yes (Confidence: ${improvementResult.confidence.toUpperCase()})\n`;
      markdown += `- **Requires Human Help:** ${improvementResult.requiresHumanHelp ? '⚠️ Yes' : '✅ No'}\n`;
      markdown += `- **Total Improvements:** ${improvementResult.improvements.length}\n\n`;
      
      if (improvementResult.improvements.length > 0) {
        markdown += `### 📝 Improvement Details\n\n`;
        improvementResult.improvements.forEach((imp: any, index: number) => {
          const icon = imp.type === 'automatic' ? '🤖' : imp.type === 'content' ? '✏️' : '🏗️';
          markdown += `${index + 1}. ${icon} **${imp.category}** [${imp.confidence.toUpperCase()} confidence]\n`;
          markdown += `   - ${imp.description}\n`;
          if (imp.originalValue && imp.suggestedValue) {
            markdown += `   - Original: "${imp.originalValue}"\n`;
            markdown += `   - Improved: "${imp.suggestedValue}"\n`;
          }
          markdown += `   - *${imp.reasoning}*\n\n`;
        });
      }
      
      if (improvementResult.requiresHumanHelp && improvementResult.humanHelpReasons.length > 0) {
        markdown += `### 👤 Requires Human Attention\n\n`;
        improvementResult.humanHelpReasons.forEach((reason: string, index: number) => {
          markdown += `${index + 1}. ${reason}\n`;
        });
        markdown += `\n`;
      }
      
      markdown += `## 📋 ${changesApplied ? 'Improved' : 'Proposed'} Test Case\n\n`;
      markdown += `**Title:** ${finalTestCase.title || 'No title'}\n\n`;
      
      if (finalTestCase.preConditions) {
        markdown += `**Preconditions:**\n${finalTestCase.preConditions}\n\n`;
      }
      
      if (finalTestCase.steps && finalTestCase.steps.length > 0) {
        markdown += `**Steps:**\n`;
        finalTestCase.steps.forEach((step: any, index: number) => {
          const action = step.action || step.step || step.instruction || '';
          const expected = step.expected || step.expectedResult || step.expectedText || step.result || '';
          markdown += `${index + 1}. ${action}\n`;
          if (expected) {
            markdown += `   - **Expected:** ${expected}\n`;
          }
        });
      }
    } else {
      markdown += `## ❌ No Improvements Possible\n\n`;
      markdown += `The test case could not be automatically improved. Manual review and editing is required.\n`;
    }
    
    return markdown;
  }

  /**
   * Format improvement result as string
   */
  private formatImprovementResultAsString(
    validationResult: any, 
    improvementResult: any, 
    finalTestCase: any, 
    changesApplied: boolean
  ): string {
    let output = `TEST CASE IMPROVEMENT REPORT\n`;
    output += `${'='.repeat(50)}\n\n`;
    
    // Test Case Information section
    output += `TEST CASE INFORMATION:\n`;
    output += `Test Case: ${validationResult.testCaseKey} - ${validationResult.testCaseTitle}\n`;
    output += `Automation Status: ${validationResult.automationStatus}\n`;
    if (validationResult.priority) {
      output += `Priority: ${validationResult.priority}\n`;
    }
    if (validationResult.status) {
      output += `Status: ${validationResult.status}\n`;
    }
    if (validationResult.manualOnly) {
      output += `Manual Only: ${validationResult.manualOnly}\n`;
    }
    output += `Original Score: ${validationResult.overallScore}%\n`;
    output += `Changes Applied: ${changesApplied ? 'Yes' : 'No'}\n\n`;
    
    if (improvementResult.canImprove) {
      output += `IMPROVEMENT ANALYSIS:\n`;
      output += `Can Improve: Yes (${improvementResult.confidence.toUpperCase()} confidence)\n`;
      output += `Requires Human Help: ${improvementResult.requiresHumanHelp ? 'Yes' : 'No'}\n`;
      output += `Total Improvements: ${improvementResult.improvements.length}\n\n`;
      
      if (improvementResult.improvements.length > 0) {
        output += `IMPROVEMENTS:\n`;
        improvementResult.improvements.forEach((imp: any, index: number) => {
          output += `${index + 1}. [${imp.type.toUpperCase()}] ${imp.category} (${imp.confidence.toUpperCase()})\n`;
          output += `   ${imp.description}\n`;
          if (imp.suggestedValue) {
            output += `   Suggestion: ${imp.suggestedValue}\n`;
          }
          output += `\n`;
        });
      }
      
      if (improvementResult.humanHelpReasons.length > 0) {
        output += `REQUIRES HUMAN HELP:\n`;
        improvementResult.humanHelpReasons.forEach((reason: string, index: number) => {
          output += `${index + 1}. ${reason}\n`;
        });
        output += `\n`;
      }
    } else {
      output += `IMPROVEMENT ANALYSIS:\n`;
      output += `Can Improve: No\n`;
      output += `Manual review and editing required.\n\n`;
    }
    
    return output;
  }
}
