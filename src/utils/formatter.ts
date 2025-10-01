import { OutputFormat } from "../types/api.js";
import { ZebrunnerTestCase, ZebrunnerTestSuite, ZebrunnerTestRun, ZebrunnerTestResultResponse } from "../types/core.js";

/**
 * Utility class for formatting output in different formats
 */
export class FormatProcessor {
  /**
   * Format data according to specified output format
   */
  static format<T>(data: T, format: OutputFormat): string | T {
    switch (format) {
      case 'dto':
        return data; // Return as TypeScript object
      case 'json':
        return JSON.stringify(data, null, 2) as any;
      case 'string':
        return this.convertToReadableString(data) as any;
      default:
        return data;
    }
  }

  /**
   * Format test case as markdown (public method for server use)
   */
  static formatTestCaseMarkdown(testCase: any): string {
    const id = testCase?.id ?? "N/A";
    const key = testCase?.key ?? "N/A";
    const title = testCase?.title ?? "(no title)";
    const description = testCase?.description || "";
    const priority = testCase?.priority?.name ?? "N/A";
    const automationState = testCase?.automationState?.name ?? "N/A";
    const createdBy = testCase?.createdBy?.username ?? "N/A";
    const lastModifiedBy = testCase?.lastModifiedBy?.username ?? "N/A";

    const header = `# Test Case: ${title}\n\n- **ID:** ${id}\n- **Key:** ${key}\n- **Priority:** ${priority}\n- **Automation State:** ${automationState}\n- **Created By:** ${createdBy}\n- **Last Modified By:** ${lastModifiedBy}\n\n`;
    const descBlock = description ? `## Description\n\n${description}\n\n` : "";

    // Handle custom fields
    let customFieldsBlock = "";
    if (testCase?.customField && typeof testCase.customField === 'object') {
      const fields = Object.entries(testCase.customField)
        .filter(([key, value]) => value !== null && value !== undefined && value !== "")
        .map(([key, value]) => `- **${key}:** ${value}`)
        .join('\n');
      if (fields) {
        customFieldsBlock = `## Custom Fields\n\n${fields}\n\n`;
      }
    }

    const steps = Array.isArray(testCase?.steps) ? testCase.steps : [];

    if (!steps.length) {
      return `${header}${descBlock}${customFieldsBlock}## Steps\n\n_No explicit steps provided._\n`;
    }

    const lines: string[] = [];
    lines.push(`${header}${descBlock}${customFieldsBlock}## Steps\n`);

    const pick = (obj: any, keys: string[], fallback?: any) => {
      for (const k of keys) {
        if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) {
          return obj[k];
        }
      }
      return fallback;
    };

    steps.forEach((s: any, idx: number) => {
      const num = pick(s, ["stepNumber", "number", "index", "order"], idx + 1);
      const action = pick(s, ["action", "actual", "step", "actionText", "instruction", "name"]);
      const expected = pick(s, ["expected", "expectedResult", "expectedText", "result"]);
      const data = pick(s, ["data", "inputs", "parameters", "payload"]);

      lines.push(`### Step ${num}`);
      if (action) lines.push(`- **Action:** ${action}`);
      if (expected) lines.push(`- **Expected:** ${expected}`);
      if (data !== undefined) {
        if (typeof data === "object") {
          lines.push(`- **Data:**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
        } else {
          lines.push(`- **Data:** ${String(data)}`);
        }
      }
      if (!action && !expected) {
        lines.push(`- **Raw step:**\n\`\`\`json\n${JSON.stringify(s, null, 2)}\n\`\`\``);
      }
      lines.push("");
    });

    return lines.join("\n");
  }

  /**
   * Convert data to human-readable string format
   */
  private static convertToReadableString(data: any): string {
    if (Array.isArray(data)) {
      return data.map(item => this.convertToReadableString(item)).join('\n\n');
    }

    // Check most specific types first
    if (this.isTestSuite(data)) {
      return this.formatTestSuite(data);
    }

    if (this.isTestRun(data)) {
      return this.formatTestRun(data);
    }

    if (this.isTestResult(data)) {
      return this.formatTestResult(data);
    }

    if (this.isTestCase(data)) {
      return this.formatTestCase(data);
    }

    // Fallback to JSON for unknown types
    return JSON.stringify(data, null, 2);
  }

  /**
   * Format test case as readable string
   */
  private static formatTestCase(testCase: ZebrunnerTestCase): string {
    const lines: string[] = [];
    
    lines.push(`=== Test Case: ${testCase.title || 'Untitled'} ===`);
    lines.push(`ID: ${testCase.id}`);
    
    if (testCase.key) {
      lines.push(`Key: ${testCase.key}`);
    }
    
    if (testCase.description) {
      lines.push(`Description: ${testCase.description}`);
    }
    
    if (testCase.priority) {
      lines.push(`Priority: ${testCase.priority.name}`);
    }
    
    if (testCase.automationState) {
      lines.push(`Automation: ${testCase.automationState.name}`);
    }
    
    if (testCase.createdBy) {
      lines.push(`Created by: ${testCase.createdBy.username} (${testCase.createdAt})`);
    }
    
    if (testCase.lastModifiedBy) {
      lines.push(`Last modified by: ${testCase.lastModifiedBy.username} (${testCase.lastModifiedAt})`);
    }

    // Format steps
    if (testCase.steps && testCase.steps.length > 0) {
      lines.push('\n--- Steps ---');
      testCase.steps.forEach((step: any, index: number) => {
        const stepNum = step.stepNumber || step.number || step.index || (index + 1);
        lines.push(`Step ${stepNum}:`);
        
        if (step.action || step.actionText || step.instruction) {
          lines.push(`  Action: ${step.action || step.actionText || step.instruction}`);
        }
        
        if (step.expected || step.expectedResult || step.expectedText) {
          lines.push(`  Expected: ${step.expected || step.expectedResult || step.expectedText}`);
        }
        
        if (step.data || step.inputs || step.parameters) {
          const data = step.data || step.inputs || step.parameters;
          lines.push(`  Data: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
        }
      });
    }

    // Format custom fields
    if (testCase.customField && Object.keys(testCase.customField).length > 0) {
      lines.push('\n--- Custom Fields ---');
      Object.entries(testCase.customField).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          lines.push(`${key}: ${value}`);
        }
      });
    }

    return lines.join('\n');
  }

  /**
   * Format test suite as readable string
   */
  private static formatTestSuite(suite: ZebrunnerTestSuite): string {
    const lines: string[] = [];
    
    lines.push(`=== Test Suite: ${suite.title || suite.name || 'Untitled'} ===`);
    lines.push(`ID: ${suite.id}`);
    
    if (suite.description) {
      lines.push(`Description: ${suite.description}`);
    }
    
    if (suite.parentSuiteId) {
      lines.push(`Parent Suite ID: ${suite.parentSuiteId}`);
    }
    
    if (suite.rootSuiteId) {
      lines.push(`Root Suite ID: ${suite.rootSuiteId}`);
    }
    
    if (suite.path) {
      lines.push(`Path: ${suite.path}`);
    }
    
    if (suite.level !== undefined) {
      lines.push(`Level: ${suite.level}`);
    }
    
    lines.push(`Position: ${suite.relativePosition || 0}`);
    
    if (suite.children && suite.children.length > 0) {
      lines.push(`Children: ${suite.children.length} suites`);
    }

    return lines.join('\n');
  }

  /**
   * Format test run as readable string
   */
  private static formatTestRun(run: ZebrunnerTestRun): string {
    const lines: string[] = [];
    
    lines.push(`=== Test Run: ${run.name} ===`);
    lines.push(`ID: ${run.id}`);
    lines.push(`Status: ${run.status}`);
    
    if (run.description) {
      lines.push(`Description: ${run.description}`);
    }
    
    if (run.startedAt) {
      lines.push(`Started: ${run.startedAt}`);
    }
    
    if (run.endedAt) {
      lines.push(`Ended: ${run.endedAt}`);
    }
    
    if (run.milestone) {
      lines.push(`Milestone: ${run.milestone}`);
    }
    
    if (run.build) {
      lines.push(`Build: ${run.build}`);
    }
    
    if (run.environment) {
      lines.push(`Environment: ${run.environment}`);
    }

    // Test statistics
    if (run.totalTests !== undefined) {
      lines.push('\n--- Test Statistics ---');
      lines.push(`Total: ${run.totalTests}`);
      lines.push(`Passed: ${run.passedTests || 0}`);
      lines.push(`Failed: ${run.failedTests || 0}`);
      lines.push(`Skipped: ${run.skippedTests || 0}`);
    }

    return lines.join('\n');
  }

  /**
   * Format test result as readable string
   */
  private static formatTestResult(result: ZebrunnerTestResultResponse): string {
    const lines: string[] = [];
    
    lines.push(`=== Test Result ===`);
    lines.push(`Test Case: ${result.testCaseTitle || result.testCaseKey || result.testCaseId}`);
    lines.push(`Status: ${result.status}`);
    
    if (result.executedAt) {
      lines.push(`Executed: ${result.executedAt}`);
    }
    
    if (result.duration) {
      lines.push(`Duration: ${result.duration}ms`);
    }
    
    if (result.message) {
      lines.push(`Message: ${result.message}`);
    }
    
    if (result.stackTrace) {
      lines.push('\n--- Stack Trace ---');
      lines.push(result.stackTrace);
    }
    
    if (result.issues && result.issues.length > 0) {
      lines.push('\n--- Issues ---');
      result.issues.forEach((issue: string) => {
        lines.push(`- ${issue}`);
      });
    }

    return lines.join('\n');
  }

  // Type guards
  private static isTestCase(obj: any): obj is ZebrunnerTestCase {
    return obj && typeof obj.id === 'number' && (obj.title || obj.key);
  }

  private static isTestSuite(obj: any): obj is ZebrunnerTestSuite {
    return obj && typeof obj.id === 'number' && (obj.title || obj.name) && obj.relativePosition !== undefined;
  }

  private static isTestRun(obj: any): obj is ZebrunnerTestRun {
    return obj && typeof obj.id === 'number' && obj.name && obj.status;
  }

  private static isTestResult(obj: any): obj is ZebrunnerTestResultResponse {
    return obj && obj.testCaseId && obj.status;
  }

  /**
   * Extracts project key from a test case key
   * @param testCaseKey - Test case key like "IOS-2", "ANDROID-123", etc.
   * @returns Project key like "IOS", "ANDROID", etc.
   */
  static extractProjectKeyFromTestCaseKey(testCaseKey: string): string {
    if (!testCaseKey || typeof testCaseKey !== 'string') {
      throw new Error('Test case key must be a non-empty string');
    }

    const match = testCaseKey.match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
    
    if (!match) {
      throw new Error(`Invalid test case key format: "${testCaseKey}". Expected format: PROJECT_KEY-NUMBER (e.g., IOS-2)`);
    }

    return match[1];
  }

  /**
   * Resolves project key from arguments, auto-detecting from case_key if needed
   */
  static resolveProjectKey(args: { 
    project_key?: string; 
    case_key?: string; 
    [key: string]: any 
  }): { project_key: string; [key: string]: any } {
    let resolvedProjectKey = args.project_key;

    if (!resolvedProjectKey && args.case_key) {
      try {
        resolvedProjectKey = this.extractProjectKeyFromTestCaseKey(args.case_key);
        console.error(`🔍 Auto-detected project key "${resolvedProjectKey}" from test case key "${args.case_key}"`);
      } catch (error) {
        throw new Error(`Cannot auto-detect project key from case_key "${args.case_key}": ${(error as Error).message}`);
      }
    }

    if (!resolvedProjectKey) {
      throw new Error('Either project_key must be provided or case_key must be in valid format (PROJECT_KEY-NUMBER)');
    }

    return { ...args, project_key: resolvedProjectKey };
  }

}
