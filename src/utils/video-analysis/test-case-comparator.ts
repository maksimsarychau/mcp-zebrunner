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

      return {
        testCaseKey,
        testCaseTitle: testCase.name,
        testCaseSteps,
        coverageAnalysis,
        stepByStepComparison
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
}

