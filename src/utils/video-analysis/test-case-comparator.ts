import { EnhancedZebrunnerClient } from '../../api/enhanced-client.js';
import { TestCaseComparison, TestCaseStep, LogStep } from './types.js';

/**
 * TestCaseComparator class
 * Compares video execution with test case definition
 */
export class TestCaseComparator {
  constructor(
    private tcmClient: EnhancedZebrunnerClient,
    private debug: boolean = false
  ) {}

  /**
   * Compare video execution with test case steps
   */
  async compareWithTestCase(
    testCaseKey: string,
    projectKey: string,
    executedSteps: LogStep[],
    videoTimestamps: Array<{ timestamp: number; action: string }>
  ): Promise<TestCaseComparison | null> {
    try {
      if (this.debug) {
        console.log(`[TestCaseComparator] Fetching test case: ${testCaseKey}`);
      }

      // Fetch test case from TCM
      const testCase = await this.fetchTestCase(testCaseKey, projectKey);

      if (!testCase) {
        if (this.debug) {
          console.log('[TestCaseComparator] Test case not found');
        }
        return null;
      }

      if (this.debug) {
        console.log(`[TestCaseComparator] Test case has ${testCase.steps.length} steps`);
      }

      // Parse test case steps
      const testCaseSteps = this.parseTestCaseSteps(testCase.steps);

      // Analyze coverage
      const coverageAnalysis = this.analyzeCoverage(
        testCaseSteps,
        executedSteps,
        videoTimestamps
      );

      // Compare step by step
      const stepByStepComparison = this.compareSteps(
        testCaseSteps,
        executedSteps,
        videoTimestamps
      );

      // Assess test case quality (is it outdated/incomplete?)
      const testCaseQuality = this.assessTestCaseQuality(
        testCaseSteps,
        executedSteps,
        coverageAnalysis
      );

      return {
        testCaseKey,
        testCaseTitle: testCase.name,
        testCaseSteps,
        coverageAnalysis,
        stepByStepComparison,
        testCaseQuality
      };

    } catch (error) {
      if (this.debug) {
        console.error('[TestCaseComparator] Error comparing with test case:', error);
      }
      return null;
    }
  }

  /**
   * Fetch test case from TCM API
   */
  private async fetchTestCase(
    testCaseKey: string,
    projectKey: string
  ): Promise<{ name: string; steps: string[] } | null> {
    try {
      // Use the TCM client to fetch test case
      const testCase = await this.tcmClient.getTestCaseByKey(projectKey, testCaseKey);

      if (!testCase) {
        return null;
      }

      // Extract steps from test case
      // Steps are typically in the 'steps' field as an array of step objects
      const steps: string[] = [];
      
      if (Array.isArray(testCase.steps)) {
        for (const step of testCase.steps) {
          if (typeof step === 'string') {
            steps.push(step);
          } else if (step.action) {
            steps.push(step.action);
          } else if (step.name) {
            steps.push(step.name);
          }
        }
      } else if (typeof testCase.steps === 'string') {
        // Steps might be a single string with numbered steps
        const stepLines = (testCase.steps as string).split('\n').filter((line: string) => line.trim());
        steps.push(...stepLines);
      }

      return {
        name: testCase.title || 'Untitled Test Case',
        steps: steps.length > 0 ? steps : ['No steps defined']
      };

    } catch (error) {
      if (this.debug) {
        console.warn('[TestCaseComparator] Failed to fetch test case:', error);
      }
      return null;
    }
  }

  /**
   * Parse test case steps into structured format
   */
  private parseTestCaseSteps(steps: string[]): TestCaseStep[] {
    return steps.map((step, index) => {
      // Try to parse step format: "action | expected result"
      const parts = step.split('|').map(s => s.trim());
      
      if (parts.length >= 2) {
        return {
          stepNumber: index + 1,
          expectedAction: parts[0],
          expectedResult: parts[1]
        };
      }
      
      // Single part - use as action, no expected result
      return {
        stepNumber: index + 1,
        expectedAction: step,
        expectedResult: ''
      };
    });
  }

  /**
   * Analyze test case coverage
   */
  private analyzeCoverage(
    testCaseSteps: TestCaseStep[],
    executedSteps: LogStep[],
    videoTimestamps: Array<{ timestamp: number; action: string }>
  ): {
    totalSteps: number;
    executedSteps: number;
    skippedSteps: number[];
    extraSteps: number[];
    coveragePercentage: number;
  } {
    const totalSteps = testCaseSteps.length;
    const executed = new Set<number>();
    const extraSteps: number[] = [];

    // Match executed steps with test case steps (simple keyword matching)
    for (let i = 0; i < executedSteps.length; i++) {
      const execStep = executedSteps[i];
      let matched = false;

      for (const tcStep of testCaseSteps) {
        if (this.stepsMatch(execStep.action, tcStep.expectedAction)) {
          executed.add(tcStep.stepNumber);
          matched = true;
          break;
        }
      }

      if (!matched) {
        extraSteps.push(i + 1);
      }
    }

    // Find skipped steps
    const skippedSteps: number[] = [];
    for (let i = 1; i <= totalSteps; i++) {
      if (!executed.has(i)) {
        skippedSteps.push(i);
      }
    }

    const coveragePercentage = totalSteps > 0 
      ? Math.round((executed.size / totalSteps) * 100) 
      : 0;

    return {
      totalSteps,
      executedSteps: executed.size,
      skippedSteps,
      extraSteps,
      coveragePercentage
    };
  }

  /**
   * Compare steps one by one
   */
  private compareSteps(
    testCaseSteps: TestCaseStep[],
    executedSteps: LogStep[],
    videoTimestamps: Array<{ timestamp: number; action: string }>
  ): Array<{
    testCaseStep: number;
    expectedAction: string;
    actualExecution: string;
    videoTimestamp?: number;
    logReference?: string;
    match: boolean;
    deviation?: string;
  }> {
    const comparison: Array<any> = [];

    for (const tcStep of testCaseSteps) {
      // Try to find matching executed step
      let matchedExecStep: LogStep | undefined;
      let matchedVideoTimestamp: number | undefined;

      for (const execStep of executedSteps) {
        if (this.stepsMatch(execStep.action, tcStep.expectedAction)) {
          matchedExecStep = execStep;
          
          // Try to find video timestamp close to log timestamp
          const logTime = new Date(execStep.timestamp).getTime() / 1000;
          const closestVideo = videoTimestamps.find(vt => 
            Math.abs(vt.timestamp - logTime) < 5
          );
          
          if (closestVideo) {
            matchedVideoTimestamp = closestVideo.timestamp;
          }
          
          break;
        }
      }

      if (matchedExecStep) {
        comparison.push({
          testCaseStep: tcStep.stepNumber,
          expectedAction: tcStep.expectedAction,
          actualExecution: matchedExecStep.action,
          videoTimestamp: matchedVideoTimestamp,
          logReference: matchedExecStep.timestamp,
          match: true
        });
      } else {
        comparison.push({
          testCaseStep: tcStep.stepNumber,
          expectedAction: tcStep.expectedAction,
          actualExecution: 'Not executed or not found in logs',
          match: false,
          deviation: 'Step was not executed or could not be matched in logs'
        });
      }
    }

    return comparison;
  }

  /**
   * Simple keyword matching for steps
   */
  private stepsMatch(executedAction: string, expectedAction: string): boolean {
    const exec = executedAction.toLowerCase();
    const expected = expectedAction.toLowerCase();

    // Extract key action words
    const actionWords = ['click', 'tap', 'enter', 'type', 'select', 'open', 'close', 
                         'verify', 'check', 'wait', 'scroll', 'swipe', 'navigate'];
    
    const execWords = exec.split(/\s+/);
    const expectedWords = expected.split(/\s+/);

    // Check if they share action words
    for (const word of actionWords) {
      if (exec.includes(word) && expected.includes(word)) {
        // Both contain same action word - check for other common words
        const commonWords = execWords.filter(w => expectedWords.includes(w));
        if (commonWords.length >= 2) {
          return true;
        }
      }
    }

    // Check for substring match (at least 50% overlap)
    if (exec.includes(expected) || expected.includes(exec)) {
      return true;
    }

    // Calculate word overlap percentage
    const intersection = execWords.filter(w => expectedWords.includes(w));
    const union = [...new Set([...execWords, ...expectedWords])];
    const overlap = intersection.length / union.length;

    return overlap >= 0.4; // 40% word overlap threshold
  }

  /**
   * Assess test case quality - determine if test case describes what automation does
   * Focus: Semantic coverage, not step count ratio (automation can have 100x more steps - that's normal!)
   */
  private assessTestCaseQuality(
    testCaseSteps: TestCaseStep[],
    executedSteps: LogStep[],
    coverageAnalysis: any
  ): {
    isOutdated: boolean;
    confidence: number;
    reasoning: string;
    recommendation: string;
  } {
    const tcStepCount = testCaseSteps.length;
    const execStepCount = executedSteps.length;
    const coveragePercentage = coverageAnalysis.coveragePercentage;

    // Analyze semantic coverage: do test case steps describe what automation does?
    const semanticAnalysis = this.analyzeSemanticCoverage(testCaseSteps, executedSteps);

    // Red flags for test case quality issues:
    const redFlags = {
      // Test case is just placeholder text or no meaningful steps
      placeholderSteps: testCaseSteps.some(step => 
        step.expectedAction.toLowerCase().includes('no steps') ||
        step.expectedAction.toLowerCase().includes('undefined') ||
        step.expectedAction.trim().length < 10
      ),
      
      // Test case steps don't match any automation actions (semantic mismatch)
      semanticMismatch: semanticAnalysis.matchedSteps < testCaseSteps.length * 0.5,
      
      // Automation performs actions not described anywhere in test case
      hasUndocumentedActions: semanticAnalysis.undocumentedActionTypes.length > 0,
      
      // Test case is extremely vague (very short, no specifics)
      veryVague: testCaseSteps.length === 1 && testCaseSteps[0].expectedAction.length < 30,
    };

    const undocumentedCount = semanticAnalysis.undocumentedActionTypes.length;

    // Note: It's NORMAL for automation to have many more steps than test case
    // (e.g., test case: "Login" → automation: 15 steps to implement login)
    // This is NOT a quality issue!

    // Build assessment
    let isOutdated = false;
    let confidence = 0;
    let reasoning = '';
    let recommendation = '';

    if (redFlags.placeholderSteps) {
      isOutdated = true;
      confidence = 95;
      reasoning = `Test case contains placeholder text or no meaningful steps. Test case needs to be properly documented.`;
      recommendation = `🔴 **HIGH PRIORITY**: Add actual test case steps describing the expected behavior and actions.`;
    } else if (redFlags.semanticMismatch && undocumentedCount >= 3) {
      isOutdated = true;
      confidence = 70;
      reasoning = `Test case describes "${testCaseSteps.map(s => s.expectedAction.substring(0, 30)).join(', ')}" but automation performs undocumented actions: ${semanticAnalysis.undocumentedActionTypes.slice(0, 3).join(', ')}. `;
      reasoning += `The test case may not accurately describe what the automation does.`;
      recommendation = `🟡 **MEDIUM PRIORITY**: Review if test case accurately describes automation behavior. Consider updating test case to include: ${semanticAnalysis.undocumentedActionTypes.slice(0, 3).join(', ')}.`;
    } else if (redFlags.veryVague && undocumentedCount > 0) {
      isOutdated = true;
      confidence = 60;
      reasoning = `Test case has only 1 very brief step: "${testCaseSteps[0].expectedAction}". While automation has ${execStepCount} steps, test case should provide more context about expected behavior.`;
      recommendation = `🟡 **MEDIUM PRIORITY**: Expand test case to describe key expected outcomes and main user flows (can still be high-level, but needs more detail than "${testCaseSteps[0].expectedAction.substring(0, 40)}").`;
    } else {
      // Test case is OK - it describes what automation does (even if at high level)
      isOutdated = false;
      confidence = 80;
      reasoning = `Test case provides adequate high-level description of automation behavior. `;
      reasoning += `Note: Automation has ${execStepCount} detailed steps vs ${tcStepCount} test case step(s) - this is normal and expected. `;
      reasoning += `Test cases are high-level descriptions; automation is detailed implementation.`;
      recommendation = `✅ Test case documentation is adequate. Focus on investigating the actual test failure root cause (likely an automation issue, not documentation).`;
    }

    if (this.debug) {
      console.log(`[TestCaseComparator] Quality Assessment: isOutdated=${isOutdated}, confidence=${confidence}%, semanticMatch=${semanticAnalysis.matchedSteps}/${tcStepCount}`);
    }

    return {
      isOutdated,
      confidence,
      reasoning,
      recommendation
    };
  }

  /**
   * Analyze if test case steps semantically describe what automation does
   */
  private analyzeSemanticCoverage(
    testCaseSteps: TestCaseStep[],
    executedSteps: LogStep[]
  ): {
    matchedSteps: number;
    undocumentedActionTypes: string[];
  } {
    // Extract action types from executed steps
    const automationActions = new Set<string>();
    for (const execStep of executedSteps) {
      const action = execStep.action.toLowerCase();
      
      // Categorize actions
      if (action.includes('login') || action.includes('sign in')) automationActions.add('login');
      if (action.includes('click') || action.includes('tap')) automationActions.add('UI interactions');
      if (action.includes('enter') || action.includes('type') || action.includes('input')) automationActions.add('text input');
      if (action.includes('verify') || action.includes('check') || action.includes('assert')) automationActions.add('verification');
      if (action.includes('navigate') || action.includes('open')) automationActions.add('navigation');
      if (action.includes('search')) automationActions.add('search');
      if (action.includes('select') || action.includes('choose')) automationActions.add('selection');
      if (action.includes('scroll') || action.includes('swipe')) automationActions.add('scrolling');
      if (action.includes('wait') || action.includes('loading')) automationActions.add('waiting');
      if (action.includes('close') || action.includes('dismiss')) automationActions.add('dismiss/close');
    }

    // Check which test case steps are covered by automation actions
    let matchedSteps = 0;
    for (const tcStep of testCaseSteps) {
      const stepText = tcStep.expectedAction.toLowerCase();
      
      // Check if any automation action type is mentioned in test case step
      for (const actionType of automationActions) {
        if (stepText.includes(actionType) || this.semanticMatch(stepText, actionType)) {
          matchedSteps++;
          automationActions.delete(actionType); // Remove matched action
          break;
        }
      }
    }

    // Remaining actions are not documented in test case
    const undocumentedActionTypes = Array.from(automationActions);

    return {
      matchedSteps,
      undocumentedActionTypes
    };
  }

  /**
   * Check if two terms are semantically related
   */
  private semanticMatch(text: string, actionType: string): boolean {
    const synonyms: { [key: string]: string[] } = {
      'login': ['sign in', 'authenticate', 'log in', 'credentials'],
      'navigation': ['open', 'go to', 'navigate', 'access', 'menu'],
      'search': ['find', 'look for', 'query'],
      'UI interactions': ['click', 'tap', 'press', 'button', 'select'],
      'text input': ['enter', 'type', 'input', 'fill', 'provide'],
      'verification': ['verify', 'check', 'confirm', 'see', 'expect', 'assert'],
      'selection': ['choose', 'pick', 'select'],
      'scrolling': ['scroll', 'swipe', 'move'],
      'dismiss/close': ['close', 'dismiss', 'exit', 'cancel']
    };

    const relatedTerms = synonyms[actionType] || [];
    return relatedTerms.some(term => text.includes(term));
  }
}

