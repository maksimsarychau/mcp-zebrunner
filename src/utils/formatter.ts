import { OutputFormat } from "../types/api.js";
import { ZebrunnerTestCase, ZebrunnerTestSuite, ZebrunnerTestRun, ZebrunnerTestResultResponse } from "../types/core.js";
import type { FieldsLayout, FieldLayoutItem, TestCaseExecution } from "../api/reporting-client.js";

/**
 * Utility class for formatting output in different formats
 */
export class FormatProcessor {
  /**
   * Format data according to specified output format
   */
  static format<T>(data: T, format: OutputFormat, fieldsLayout?: FieldsLayout): string | T {
    switch (format) {
      case 'dto':
        return data;
      case 'json':
        return JSON.stringify(data, null, 2) as any;
      case 'string':
        return this.convertToReadableString(data, fieldsLayout) as any;
      default:
        return data;
    }
  }

  /**
   * Format test case as markdown (public method for server use)
   */
  /**
   * Build a lookup from customField API key → display name using fields layout.
   * The API uses camelCase keys (e.g., "manualOnly") while the layout has display names ("Manual Only").
   */
  private static buildCustomFieldDisplayMap(fieldsLayout?: FieldsLayout): Map<string, FieldLayoutItem> {
    if (!fieldsLayout) return new Map();

    const map = new Map<string, FieldLayoutItem>();
    for (const field of fieldsLayout.fields) {
      if (field.type !== 'CUSTOM') continue;
      // API key is typically camelCase of display name; build several candidate keys
      const candidates = [
        field.name,
        field.name.replace(/\s+/g, ''),
        field.name.charAt(0).toLowerCase() + field.name.slice(1).replace(/\s+(.)/g, (_, c) => c.toUpperCase()),
        field.name.toLowerCase().replace(/\s+/g, '_'),
        field.name.replace(/\s+/g, '_'),
      ];
      map.set(field.name, field);
      for (const c of candidates) {
        map.set(c, field);
      }
    }
    return map;
  }

  static formatExecutionHistoryMarkdown(executions: TestCaseExecution[]): string {
    if (!executions || executions.length === 0) {
      return '## Execution History\n\nNo executions found.\n';
    }

    const lines: string[] = ['## Execution History\n'];
    lines.push(`| # | Date | Status | Type | Environment | Configurations |`);
    lines.push(`|---|------|--------|------|-------------|----------------|`);

    executions.forEach((exec, idx) => {
      const date = exec.trackedAt ? new Date(exec.trackedAt).toISOString().replace('T', ' ').slice(0, 19) : 'N/A';
      const status = exec.status?.name || 'Unknown';
      const type = exec.type || 'N/A';
      const env = exec.environment?.name || '—';
      const configs = exec.configurations
        ?.map(c => `${c.groupName}: ${c.optionName}`)
        .join(', ') || '—';
      lines.push(`| ${idx + 1} | ${date} | ${status} | ${type} | ${env} | ${configs} |`);
    });

    const passCount = executions.filter(e => e.status?.name === 'Passed').length;
    const failCount = executions.filter(e => e.status?.name === 'Failed').length;
    const total = executions.length;
    const passRate = total > 0 ? Math.round((passCount / total) * 100) : 0;
    lines.push('');
    lines.push(`**Summary:** ${total} execution(s) shown — ${passCount} passed, ${failCount} failed (${passRate}% pass rate)`);
    lines.push('');

    return lines.join('\n');
  }

  static formatTestCaseMarkdown(testCase: any, fieldsLayout?: FieldsLayout): string {
    const id = testCase?.id ?? "N/A";
    const key = testCase?.key ?? "N/A";
    const title = testCase?.title ?? "(no title)";
    const description = testCase?.description || "";
    const priority = testCase?.priority?.name ?? "N/A";
    const automationState = testCase?.automationState?.name ?? "N/A";
    const deprecated = testCase?.deprecated === true ? "Yes" : testCase?.deprecated === false ? "No" : "N/A";
    const draft = testCase?.draft === true ? "Yes" : testCase?.draft === false ? "No" : "N/A";
    const createdBy = testCase?.createdBy?.username ?? "N/A";
    const createdAt = testCase?.createdAt ?? "";
    const lastModifiedBy = testCase?.lastModifiedBy?.username ?? "N/A";
    const lastModifiedAt = testCase?.lastModifiedAt ?? "";

    let header = `# Test Case: ${title}\n\n`;
    header += `## System Properties\n\n`;
    header += `- **ID:** ${id}\n`;
    header += `- **Key:** ${key}\n`;
    header += `- **Priority:** ${priority}\n`;
    header += `- **Automation State:** ${automationState}\n`;
    header += `- **Deprecated:** ${deprecated}\n`;
    header += `- **Draft:** ${draft}\n`;
    header += `- **Created By:** ${createdBy}${createdAt ? ` (${createdAt})` : ''}\n`;
    header += `- **Last Modified By:** ${lastModifiedBy}${lastModifiedAt ? ` (${lastModifiedAt})` : ''}\n`;
    header += `\n`;

    const descBlock = description ? `## Description\n\n${description}\n\n` : "";

    let customFieldsBlock = "";
    if (testCase?.customField && typeof testCase.customField === 'object') {
      const displayMap = this.buildCustomFieldDisplayMap(fieldsLayout);

      // System field names that custom fields must never visually override
      const systemFieldNames = ['deprecated', 'draft', 'priority', 'automationstate', 'automation state'];

      const entries = Object.entries(testCase.customField)
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([apiKey, value]) => {
          const meta = displayMap.get(apiKey);
          const displayName = meta?.name || apiKey;
          const position = meta?.relativePosition ?? 999;

          // Detect if this custom field name collides with a system property
          const nameNorm = displayName.toLowerCase().replace(/[_\-\s\d]+/g, '');
          const isSystemOverlap = systemFieldNames.some(s => s.replace(/\s+/g, '') === nameNorm || nameNorm.startsWith(s.replace(/\s+/g, '')));

          return { displayName, value, position, isSystemOverlap };
        })
        .sort((a, b) => a.position - b.position);

      const fields = entries
        .map(({ displayName, value, isSystemOverlap }) => {
          if (isSystemOverlap) {
            return `- **${displayName}:** ${value} _(custom field — does NOT override the system "${displayName.replace(/[_\d]+$/g, '').trim()}" property above)_`;
          }
          return `- **${displayName}:** ${value}`;
        })
        .join('\n');

      if (fields) {
        customFieldsBlock = `## Custom Fields (project-specific, not system properties)\n\nThese are project-specific metadata fields. The authoritative system properties (Deprecated, Draft, Priority, etc.) are listed above.\n\n${fields}\n\n`;
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
  private static convertToReadableString(data: any, fieldsLayout?: FieldsLayout): string {
    if (Array.isArray(data)) {
      return data.map(item => this.convertToReadableString(item, fieldsLayout)).join('\n\n');
    }

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
      return this.formatTestCase(data, fieldsLayout);
    }

    return JSON.stringify(data, null, 2);
  }

  /**
   * Format test case as readable string
   */
  private static formatTestCase(testCase: ZebrunnerTestCase, fieldsLayout?: FieldsLayout): string {
    const lines: string[] = [];
    
    lines.push(`=== Test Case: ${testCase.title || 'Untitled'} ===`);
    lines.push('');
    lines.push('--- System Properties ---');
    lines.push(`ID: ${testCase.id}`);
    
    if (testCase.key) {
      lines.push(`Key: ${testCase.key}`);
    }
    
    if (testCase.priority) {
      lines.push(`Priority: ${testCase.priority.name}`);
    }
    
    if (testCase.automationState) {
      lines.push(`Automation State: ${testCase.automationState.name}`);
    }

    lines.push(`Deprecated: ${testCase.deprecated === true ? 'Yes' : testCase.deprecated === false ? 'No' : 'N/A'}`);
    lines.push(`Draft: ${testCase.draft === true ? 'Yes' : testCase.draft === false ? 'No' : 'N/A'}`);
    
    if (testCase.createdBy) {
      lines.push(`Created by: ${testCase.createdBy.username} (${testCase.createdAt})`);
    }
    
    if (testCase.lastModifiedBy) {
      lines.push(`Last modified by: ${testCase.lastModifiedBy.username} (${testCase.lastModifiedAt})`);
    }

    if (testCase.description) {
      lines.push('');
      lines.push('--- Description ---');
      lines.push(testCase.description);
    }

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

    if (testCase.customField && Object.keys(testCase.customField).length > 0) {
      const displayMap = this.buildCustomFieldDisplayMap(fieldsLayout);
      const systemFieldNames = ['deprecated', 'draft', 'priority', 'automationstate', 'automation state'];

      const entries = Object.entries(testCase.customField)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([apiKey, value]) => {
          const meta = displayMap.get(apiKey);
          const displayName = meta?.name || apiKey;
          const position = meta?.relativePosition ?? 999;
          const nameNorm = displayName.toLowerCase().replace(/[_\-\s\d]+/g, '');
          const isSystemOverlap = systemFieldNames.some(s => s.replace(/\s+/g, '') === nameNorm || nameNorm.startsWith(s.replace(/\s+/g, '')));
          return { displayName, value, position, isSystemOverlap };
        })
        .sort((a, b) => a.position - b.position);

      lines.push('\n--- Custom Fields (project-specific, NOT system properties) ---');
      lines.push('Note: These do NOT override the system properties above.');
      entries.forEach(({ displayName, value, isSystemOverlap }) => {
        if (isSystemOverlap) {
          lines.push(`${displayName}: ${value} (custom field — does NOT override system "${displayName.replace(/[_\d]+$/g, '').trim()}")`);
        } else {
          lines.push(`${displayName}: ${value}`);
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
