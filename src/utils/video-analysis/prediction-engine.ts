import { Prediction, FailureAnalysis, TestCaseComparison, FrameAnalysis } from './types.js';

/**
 * PredictionEngine class
 * Analyzes evidence and predicts if failure is bug or test issue
 */
export class PredictionEngine {
  constructor(private debug: boolean = false) {}

  /**
   * Predict issue type based on all available evidence
   */
  predictIssueType(
    failureAnalysis: FailureAnalysis,
    testCaseComparison: TestCaseComparison | null,
    frames: FrameAnalysis[],
    logs: string
  ): Prediction {
    if (this.debug) {
      console.log('[PredictionEngine] Analyzing evidence to predict issue type');
    }

    const evidenceForBug: string[] = [];
    const evidenceForTestUpdate: string[] = [];
    let bugScore = 0;
    let testScore = 0;

    // Analyze failure type
    const failureType = failureAnalysis.failureType.toLowerCase();
    const errorMessage = failureAnalysis.errorMessage.toLowerCase();

    // Bug indicators
    if (failureType.includes('crash') || failureType.includes('anr') || failureType.includes('freeze')) {
      evidenceForBug.push('Application crashed or became unresponsive');
      bugScore += 30;
    }

    if (errorMessage.includes('nullpointer') || errorMessage.includes('null reference')) {
      evidenceForBug.push('NullPointerException indicates code defect');
      bugScore += 25;
    }

    if (errorMessage.includes('index out of bounds') || errorMessage.includes('array')) {
      evidenceForBug.push('Array/Index error suggests code issue');
      bugScore += 20;
    }

    if (errorMessage.includes('network') || errorMessage.includes('connection') || errorMessage.includes('timeout')) {
      evidenceForBug.push('Network/connection issue detected');
      bugScore += 15;
    }

    if (errorMessage.includes('database') || errorMessage.includes('sql')) {
      evidenceForBug.push('Database error detected');
      bugScore += 15;
    }

    // Test issue indicators
    if (failureType.includes('elementnotfound') || failureType.includes('nosuchelement')) {
      evidenceForTestUpdate.push('Element not found - UI may have changed');
      testScore += 25;
    }

    if (failureType.includes('timeout') || failureType.includes('wait')) {
      evidenceForTestUpdate.push('Wait timeout - may need increased wait time');
      testScore += 20;
    }

    if (failureType.includes('assertion') || failureType.includes('expected')) {
      evidenceForTestUpdate.push('Assertion failure - expected vs actual mismatch');
      testScore += 15;
    }

    if (errorMessage.includes('stale element') || errorMessage.includes('detached')) {
      evidenceForTestUpdate.push('Stale element reference - test needs to re-locate element');
      testScore += 20;
    }

    // Analyze test case comparison
    if (testCaseComparison) {
      const coverage = testCaseComparison.coverageAnalysis.coveragePercentage;

      if (coverage < 50) {
        evidenceForTestUpdate.push(`Low test case coverage (${coverage}%) - test may be outdated`);
        testScore += 20;
      }

      if (testCaseComparison.coverageAnalysis.skippedSteps.length > 0) {
        evidenceForTestUpdate.push(`${testCaseComparison.coverageAnalysis.skippedSteps.length} test case steps were skipped`);
        testScore += 10;
      }

      if (testCaseComparison.coverageAnalysis.extraSteps.length > 3) {
        evidenceForTestUpdate.push(`Test executed ${testCaseComparison.coverageAnalysis.extraSteps.length} extra steps not in test case`);
        testScore += 15;
      }

      // Check for deviations
      const deviations = testCaseComparison.stepByStepComparison.filter(s => !s.match);
      if (deviations.length > 0) {
        evidenceForTestUpdate.push(`${deviations.length} steps deviated from test case`);
        testScore += 10;
      }
    }

    // Analyze visual evidence from frames
    const failureFrames = frames.filter(f => 
      f.anomaliesDetected && f.anomaliesDetected.length > 0
    );

    if (failureFrames.length > 0) {
      for (const frame of failureFrames) {
        for (const anomaly of frame.anomaliesDetected) {
          const anomalyLower = anomaly.toLowerCase();
          
          if (anomalyLower.includes('error dialog') || anomalyLower.includes('crash screen')) {
            evidenceForBug.push(`Visual anomaly detected: ${anomaly}`);
            bugScore += 20;
          }
          
          if (anomalyLower.includes('wrong screen') || anomalyLower.includes('unexpected')) {
            evidenceForTestUpdate.push(`Unexpected UI state: ${anomaly}`);
            testScore += 15;
          }
        }
      }
    }

    // Analyze root cause from failure analysis
    if (failureAnalysis.rootCause.category === 'app_bug') {
      evidenceForBug.push(failureAnalysis.rootCause.reasoning);
      bugScore += failureAnalysis.rootCause.confidence * 0.3;
    } else if (failureAnalysis.rootCause.category === 'test_issue') {
      evidenceForTestUpdate.push(failureAnalysis.rootCause.reasoning);
      testScore += failureAnalysis.rootCause.confidence * 0.3;
    }

    // Make prediction
    const totalScore = bugScore + testScore;
    const verdict = this.determineVerdict(bugScore, testScore, failureAnalysis);
    const confidence = totalScore > 0 
      ? Math.min(100, Math.round((Math.max(bugScore, testScore) / totalScore) * 100))
      : 50;

    // Generate reasoning
    const reasoning = this.generateReasoning(verdict, bugScore, testScore, failureAnalysis);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      verdict,
      failureAnalysis,
      testCaseComparison,
      evidenceForBug,
      evidenceForTestUpdate
    );

    if (this.debug) {
      console.log(`[PredictionEngine] Prediction: ${verdict} (${confidence}% confidence)`);
      console.log(`[PredictionEngine] Bug score: ${bugScore}, Test score: ${testScore}`);
    }

    return {
      verdict,
      confidence,
      reasoning,
      evidenceForBug,
      evidenceForTestUpdate,
      recommendations
    };
  }

  /**
   * Determine final verdict based on scores
   */
  private determineVerdict(
    bugScore: number,
    testScore: number,
    failureAnalysis: FailureAnalysis
  ): 'bug' | 'test_needs_update' | 'infrastructure_issue' | 'data_issue' | 'unclear' {
    const errorMessage = failureAnalysis.errorMessage.toLowerCase();
    const failureType = failureAnalysis.failureType.toLowerCase();

    // Infrastructure indicators
    if (errorMessage.includes('connection refused') || 
        errorMessage.includes('server error') ||
        failureType.includes('infrastructure')) {
      return 'infrastructure_issue';
    }

    // Data issue indicators
    if (errorMessage.includes('invalid data') || 
        errorMessage.includes('data not found') ||
        errorMessage.includes('constraint violation')) {
      return 'data_issue';
    }

    // Compare scores
    const diff = Math.abs(bugScore - testScore);
    
    if (diff < 10) {
      return 'unclear'; // Scores are too close
    }

    if (bugScore > testScore) {
      return bugScore > 30 ? 'bug' : 'unclear';
    } else {
      return testScore > 30 ? 'test_needs_update' : 'unclear';
    }
  }

  /**
   * Generate human-readable reasoning
   */
  private generateReasoning(
    verdict: string,
    bugScore: number,
    testScore: number,
    failureAnalysis: FailureAnalysis
  ): string {
    const parts: string[] = [];

    parts.push(`Based on analysis of the failure evidence (bug score: ${Math.round(bugScore)}, test score: ${Math.round(testScore)}), `);

    switch (verdict) {
      case 'bug':
        parts.push('this appears to be an **application bug**. ');
        parts.push('The failure characteristics, error messages, and visual evidence point to a code defect rather than test automation issues.');
        break;
      case 'test_needs_update':
        parts.push('this appears to be a **test automation issue**. ');
        parts.push('The test likely needs updates to match current application behavior or improved element locators/waits.');
        break;
      case 'infrastructure_issue':
        parts.push('this appears to be an **infrastructure/environment issue**. ');
        parts.push('The failure is likely due to environment instability, network issues, or resource constraints.');
        break;
      case 'data_issue':
        parts.push('this appears to be a **data-related issue**. ');
        parts.push('The test may have encountered invalid, missing, or conflicting data.');
        break;
      case 'unclear':
        parts.push('the root cause is **unclear**. ');
        parts.push('Further investigation is needed as evidence points to multiple possible causes.');
        break;
    }

    if (failureAnalysis.rootCause.reasoning) {
      parts.push(`\n\nAdditional context: ${failureAnalysis.rootCause.reasoning}`);
    }

    return parts.join('');
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(
    verdict: string,
    failureAnalysis: FailureAnalysis,
    testCaseComparison: TestCaseComparison | null,
    evidenceForBug: string[],
    evidenceForTestUpdate: string[]
  ): Array<{
    type: 'bug_report' | 'test_update' | 'infrastructure_fix' | 'investigation';
    priority: 'high' | 'medium' | 'low';
    description: string;
    actionItems: string[];
  }> {
    const recommendations: Array<any> = [];

    switch (verdict) {
      case 'bug':
        recommendations.push({
          type: 'bug_report',
          priority: 'high',
          description: 'Create bug report with evidence',
          actionItems: [
            `Report to development team: ${failureAnalysis.errorMessage}`,
            'Attach video and failure screenshots',
            'Include stack trace and error logs',
            'Specify environment and device details',
            'Document steps to reproduce from test case'
          ]
        });

        if (testCaseComparison && testCaseComparison.coverageAnalysis.coveragePercentage < 100) {
          recommendations.push({
            type: 'test_update',
            priority: 'low',
            description: 'Update test case documentation',
            actionItems: [
              'Verify test case steps match actual execution',
              'Update any outdated step descriptions'
            ]
          });
        }
        break;

      case 'test_needs_update':
        recommendations.push({
          type: 'test_update',
          priority: 'high',
          description: 'Update test automation',
          actionItems: [
            `Fix element locators for: ${failureAnalysis.failureType}`,
            'Add explicit waits or increase timeout values',
            'Update test case steps to match current UI flow',
            'Consider using more robust locator strategies',
            'Re-run test after fixes to verify'
          ]
        });

        if (evidenceForBug.length > 0) {
          recommendations.push({
            type: 'investigation',
            priority: 'medium',
            description: 'Investigate potential app issues',
            actionItems: [
              'Verify if application behavior has changed intentionally',
              'Check with developers if UI changes were planned',
              'Review recent application commits'
            ]
          });
        }
        break;

      case 'infrastructure_issue':
        recommendations.push({
          type: 'infrastructure_fix',
          priority: 'high',
          description: 'Fix environment/infrastructure',
          actionItems: [
            'Check network connectivity and stability',
            'Verify server/API availability',
            'Review resource usage (CPU, memory, disk)',
            'Check for external service dependencies',
            'Re-run test to confirm if issue is transient'
          ]
        });
        break;

      case 'data_issue':
        recommendations.push({
          type: 'test_update',
          priority: 'high',
          description: 'Fix test data issues',
          actionItems: [
            'Verify test data is valid and available',
            'Check data dependencies and prerequisites',
            'Update test data setup/cleanup procedures',
            'Consider using data factories or fixtures'
          ]
        });
        break;

      case 'unclear':
        recommendations.push({
          type: 'investigation',
          priority: 'high',
          description: 'Investigate root cause',
          actionItems: [
            'Review full test execution video carefully',
            'Analyze complete log file for additional clues',
            'Compare with previous successful executions',
            'Try to reproduce failure manually',
            'Consult with development team if needed'
          ]
        });

        if (evidenceForBug.length > 0) {
          recommendations.push({
            type: 'bug_report',
            priority: 'medium',
            description: 'Consider filing bug report',
            actionItems: [
              'Document all observed symptoms',
              'Gather additional evidence',
              'Discuss with team before filing'
            ]
          });
        }

        if (evidenceForTestUpdate.length > 0) {
          recommendations.push({
            type: 'test_update',
            priority: 'medium',
            description: 'Consider test improvements',
            actionItems: [
              'Review test implementation for potential issues',
              'Update element locators if needed',
              'Add better error handling and logging'
            ]
          });
        }
        break;
    }

    return recommendations;
  }
}


