import { EnhancedZebrunnerClient } from '../../api/enhanced-client.js';
import { TestCaseComparison, TestCaseStep, LogStep, MultiTestCaseComparison } from './types.js';

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
   * Compare video execution with MULTIPLE test cases (intelligent merging)
   * This is the main method for tests with multiple TCs assigned
   */
  async compareWithMultipleTestCases(
    testCaseKeys: string[],
    projectKey: string,
    executedSteps: LogStep[],
    videoFrames: Array<any>,
    baseUrl?: string  // NEW: For building clickable URLs
  ): Promise<MultiTestCaseComparison | null> {
    if (testCaseKeys.length === 0) {
      return null;
    }

    if (this.debug) {
      console.log(`[TestCaseComparator] Analyzing ${testCaseKeys.length} test cases: ${testCaseKeys.join(', ')}`);
    }

    // Step 1: Analyze each test case individually AND fetch URLs
    const individualComparisons: TestCaseComparison[] = [];
    const testCaseUrls: Map<string, string> = new Map();
    
    for (const tcKey of testCaseKeys) {
      const comparison = await this.compareWithTestCase(tcKey, projectKey, executedSteps, videoFrames);
      if (comparison) {
        individualComparisons.push(comparison);
        
        // Fetch URL for this test case
        if (baseUrl) {
          try {
            const url = await this.buildTestCaseUrl(tcKey, projectKey, baseUrl);
            testCaseUrls.set(tcKey, url);
          } catch (error) {
            if (this.debug) {
              console.warn(`[TestCaseComparator] Failed to build URL for ${tcKey}:`, error);
            }
          }
        }
      }
    }

    if (individualComparisons.length === 0) {
      if (this.debug) {
        console.log('[TestCaseComparator] No test cases could be analyzed');
      }
      return null;
    }

    // Step 2: Calculate visual confidence averages and rank TCs
    const rankedTestCases = individualComparisons.map(tc => {
      // Calculate average visual confidence (convert to 0-100 scale)
      const visualConfidenceScores = tc.stepByStepComparison.map(step => {
        switch (step.visualConfidence) {
          case 'high': return 90;
          case 'medium': return 60;
          case 'low': return 30;
          default: return 0;
        }
      });
      
      const avgConfidence = visualConfidenceScores.length > 0
        ? (visualConfidenceScores.reduce((sum: number, score: number) => sum + score, 0 as number) / visualConfidenceScores.length)
        : 0;

      // Determine match quality based on coverage + visual confidence
      const coverage = tc.coverageAnalysis.coveragePercentage;
      let matchQuality: 'excellent' | 'good' | 'moderate' | 'poor';
      
      if (coverage >= 70 && avgConfidence >= 70) {
        matchQuality = 'excellent';
      } else if (coverage >= 50 && avgConfidence >= 50) {
        matchQuality = 'good';
      } else if (coverage >= 30 || avgConfidence >= 40) {
        matchQuality = 'moderate';
      } else {
        matchQuality = 'poor';
      }

      return {
        ...tc,
        matchQuality,
        rank: 0, // Will be set after sorting
        averageVisualConfidence: Math.round(avgConfidence),
        testCaseUrl: testCaseUrls.get(tc.testCaseKey)  // Add URL
      };
    });

    // Sort by coverage (primary) and visual confidence (secondary)
    rankedTestCases.sort((a, b) => {
      if (Math.abs(a.coverageAnalysis.coveragePercentage - b.coverageAnalysis.coveragePercentage) > 10) {
        return b.coverageAnalysis.coveragePercentage - a.coverageAnalysis.coveragePercentage;
      }
      return b.averageVisualConfidence - a.averageVisualConfidence;
    });

    // Assign ranks
    rankedTestCases.forEach((tc, index) => {
      tc.rank = index + 1;
    });

    // Step 3: Merge steps intelligently
    const mergedSteps = this.mergeTestCaseSteps(individualComparisons);

    // Step 4: Calculate combined coverage
    const combinedCoverage = this.calculateCombinedCoverage(mergedSteps, executedSteps);

    // Step 5: Build combined step-by-step comparison
    const combinedStepComparison = this.buildCombinedStepComparison(
      mergedSteps,
      executedSteps,
      videoFrames,
      individualComparisons
    );

    // Step 6: Identify best match
    const bestMatch = rankedTestCases[0];

    if (this.debug) {
      console.log(`[TestCaseComparator] Best match: ${bestMatch.testCaseKey} (${bestMatch.coverageAnalysis.coveragePercentage}% coverage, ${bestMatch.averageVisualConfidence}% visual confidence)`);
      console.log(`[TestCaseComparator] Combined coverage: ${combinedCoverage}% (${mergedSteps.length} merged steps)`);
    }

    return {
      testCases: rankedTestCases,
      combinedAnalysis: {
        totalTestCases: rankedTestCases.length,
        totalSteps: mergedSteps.length,
        combinedCoverage,
        bestMatch: {
          testCaseKey: bestMatch.testCaseKey,
          coverage: bestMatch.coverageAnalysis.coveragePercentage,
          reasoning: `Best coverage (${bestMatch.coverageAnalysis.coveragePercentage}%) with ${bestMatch.matchQuality} match quality and ${bestMatch.averageVisualConfidence}% average visual confidence`
        },
        mergedSteps
      },
      stepByStepComparison: combinedStepComparison
    };
  }

  /**
   * Compare video execution with test case steps (with visual verification)
   * For single test case analysis
   */
  async compareWithTestCase(
    testCaseKey: string,
    projectKey: string,
    executedSteps: LogStep[],
    videoFrames: Array<any> // FrameAnalysis objects with timestamp, visualAnalysis, ocrText, etc.
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
        console.log(`[TestCaseComparator] Analyzing ${videoFrames.length} video frames for visual verification`);
      }

      // Parse test case steps
      const testCaseSteps = this.parseTestCaseSteps(testCase.steps);

      // Analyze coverage
      const coverageAnalysis = this.analyzeCoverage(
        testCaseSteps,
        executedSteps,
        videoFrames
      );

      // Compare step by step WITH VISUAL VERIFICATION
      const stepByStepComparison = this.compareStepsWithVisualVerification(
        testCaseSteps,
        executedSteps,
        videoFrames
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
   * Analyze test case coverage (with visual frame data)
   */
  private analyzeCoverage(
    testCaseSteps: TestCaseStep[],
    executedSteps: LogStep[],
    videoFrames: Array<any>
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
   * Compare steps one by one WITH VISUAL VERIFICATION
   * This is the core of Phase 3B - analyzing frames to verify if actions actually happened
   */
  private compareStepsWithVisualVerification(
    testCaseSteps: TestCaseStep[],
    executedSteps: LogStep[],
    videoFrames: Array<any>
  ): Array<{
    testCaseStep: number;
    expectedAction: string;
    actualExecution: string;
    videoTimestamp?: number;
    logReference?: string;
    match: boolean;
    deviation?: string;
    visualConfidence?: 'high' | 'medium' | 'low' | 'not_verified';
  }> {
    const comparison: Array<any> = [];

    if (this.debug) {
      console.log(`[TestCaseComparator] Starting visual verification for ${testCaseSteps.length} test case steps against ${videoFrames.length} frames`);
    }

    for (const tcStep of testCaseSteps) {
      // Step 1: Try to find matching executed step in logs
      let matchedExecStep: LogStep | undefined;
      let matchedVideoFrame: any = undefined;

      for (const execStep of executedSteps) {
        if (this.stepsMatch(execStep.action, tcStep.expectedAction)) {
          matchedExecStep = execStep;
          break;
        }
      }

      // Step 2: Visual verification - check if action is visible in video frames
      const visualVerification = this.verifyStepInFrames(
        tcStep.expectedAction,
        matchedExecStep,
        videoFrames
      );

      matchedVideoFrame = visualVerification.frame;

      // Step 3: Detect discrepancies between logs and frames
      const discrepancy = this.detectDiscrepancy(
        matchedExecStep,
        visualVerification
      );

      // Step 4: Build comparison entry
      if (matchedExecStep) {
        comparison.push({
          testCaseStep: tcStep.stepNumber,
          expectedAction: tcStep.expectedAction,
          actualExecution: matchedExecStep.action,
          videoTimestamp: matchedVideoFrame?.timestamp,
          logReference: matchedExecStep.timestamp,
          match: !discrepancy.hasDiscrepancy,
          deviation: discrepancy.hasDiscrepancy ? discrepancy.reason : undefined,
          visualConfidence: visualVerification.confidence
        });
      } else {
        // No log entry found - check if visually present anyway
        comparison.push({
          testCaseStep: tcStep.stepNumber,
          expectedAction: tcStep.expectedAction,
          actualExecution: visualVerification.visuallyDetected 
            ? `Detected visually (no log entry)` 
            : 'Not executed or not found in logs',
          videoTimestamp: matchedVideoFrame?.timestamp,
          match: visualVerification.visuallyDetected,
          deviation: visualVerification.visuallyDetected 
            ? 'Action visible in video but not logged' 
            : 'Step was not executed or could not be matched in logs/video',
          visualConfidence: visualVerification.confidence
        });
      }
    }

    if (this.debug) {
      const highConfidence = comparison.filter(c => c.visualConfidence === 'high').length;
      const mediumConfidence = comparison.filter(c => c.visualConfidence === 'medium').length;
      const lowConfidence = comparison.filter(c => c.visualConfidence === 'low').length;
      console.log(`[TestCaseComparator] Visual verification complete: ${highConfidence} high, ${mediumConfidence} medium, ${lowConfidence} low confidence`);
    }

    return comparison;
  }

  /**
   * ENHANCED step matching with 5 improvements:
   * 1. Better synonym matching
   * 2. Key term extraction (nouns)
   * 3. Fuzzy action matching
   * 4. UI element name matching
   * 5. Hierarchical matching support
   */
  private stepsMatch(executedAction: string, expectedAction: string): boolean {
    const exec = executedAction.toLowerCase();
    const expected = expectedAction.toLowerCase();

    if (this.debug) {
      console.log(`[TestCaseComparator] Matching: "${expectedAction}" vs "${executedAction}"`);
    }

    // FIX 1: Better synonym matching for common phrases
    const synonymGroups = [
      ['log in', 'login', 'sign in', 'signin', 'authenticate', 'authentication'],
      ['log out', 'logout', 'sign out', 'signout'],
      ['go to', 'navigate', 'open', 'access', 'visit'],
      ['tap', 'click', 'press', 'select', 'touch'],
      ['enter', 'type', 'input', 'fill', 'provide'],
      ['verify', 'check', 'confirm', 'validate', 'assert'],
      ['export', 'download', 'save'],
      ['import', 'upload', 'load'],
      ['menu', 'navigation', 'nav'],
      ['button', 'btn', 'link'],
      ['information', 'info', 'data'],
      ['progress', 'stats', 'statistics']
    ];

    // Check if both contain synonyms from same group
    for (const group of synonymGroups) {
      const execHas = group.some(syn => exec.includes(syn));
      const expectedHas = group.some(syn => expected.includes(syn));
      if (execHas && expectedHas) {
        if (this.debug) {
          console.log(`[TestCaseComparator] ✓ Synonym match: ${group.find(s => exec.includes(s))} ≈ ${group.find(s => expected.includes(s))}`);
        }
        // Continue to check for more evidence, don't return immediately
      }
    }

    // FIX 2 & 5: Extract key terms (nouns/UI elements) from both sides
    const execKeyTerms = this.extractKeyTermsEnhanced(exec);
    const expectedKeyTerms = this.extractKeyTermsEnhanced(expected);

    if (this.debug) {
      console.log(`[TestCaseComparator]   Exec terms: [${execKeyTerms.join(', ')}]`);
      console.log(`[TestCaseComparator]   Expected terms: [${expectedKeyTerms.join(', ')}]`);
    }

    // Match if they share 2+ key terms
    const sharedKeyTerms = execKeyTerms.filter(term => 
      expectedKeyTerms.some(expTerm => 
        term.includes(expTerm) || expTerm.includes(term) || this.areSynonyms(term, expTerm, synonymGroups)
      )
    );

    if (sharedKeyTerms.length >= 2) {
      if (this.debug) {
        console.log(`[TestCaseComparator] ✓ Key term match: [${sharedKeyTerms.join(', ')}]`);
      }
      return true;
    }

    // FIX 3: Fuzzy action matching - normalize actions
    const execActionNorm = this.normalizeAction(exec);
    const expectedActionNorm = this.normalizeAction(expected);

    if (execActionNorm && expectedActionNorm && execActionNorm === expectedActionNorm) {
      // Same action type - check if they target similar elements
      const execTarget = this.extractTargetElement(exec);
      const expectedTarget = this.extractTargetElement(expected);
      
      if (execTarget && expectedTarget) {
        // Check if targets are similar
        if (execTarget.includes(expectedTarget) || expectedTarget.includes(execTarget)) {
          if (this.debug) {
            console.log(`[TestCaseComparator] ✓ Action+Target match: ${execActionNorm} ${execTarget} ≈ ${expectedActionNorm} ${expectedTarget}`);
          }
          return true;
        }
      }
    }

    // FIX 4: UI element name matching - extract screen/menu/button names
    const execElements = this.extractUIElements(exec);
    const expectedElements = this.extractUIElements(expected);

    const sharedElements = execElements.filter(elem => 
      expectedElements.some(expElem => 
        elem === expElem || elem.includes(expElem) || expElem.includes(elem)
      )
    );

    if (sharedElements.length >= 1) {
      if (this.debug) {
        console.log(`[TestCaseComparator] ✓ UI element match: [${sharedElements.join(', ')}]`);
      }
      return true;
    }

    // Substring match (at least 60% of expected action in executed)
    if (exec.includes(expected)) {
      if (this.debug) {
        console.log(`[TestCaseComparator] ✓ Substring match`);
      }
      return true;
    }

    // Word overlap percentage (lowered threshold to 30% for better matching)
    const execWords = exec.split(/\s+/).filter(w => w.length > 2);
    const expectedWords = expected.split(/\s+/).filter(w => w.length > 2);
    const intersection = execWords.filter(w => expectedWords.includes(w));
    const union = [...new Set([...execWords, ...expectedWords])];
    const overlap = union.length > 0 ? intersection.length / union.length : 0;

    if (overlap >= 0.3) { // Lowered from 0.4 to 0.3
      if (this.debug) {
        console.log(`[TestCaseComparator] ✓ Word overlap: ${Math.round(overlap * 100)}%`);
      }
      return true;
    }

    if (this.debug) {
      console.log(`[TestCaseComparator] ✗ No match found`);
    }
    return false;
  }

  /**
   * Extract key terms with better noun/UI element detection
   */
  private extractKeyTermsEnhanced(text: string): string[] {
    const terms: string[] = [];
    
    // UI elements and screens
    const uiKeywords = ['button', 'menu', 'screen', 'tab', 'page', 'dialog', 'modal', 
                        'field', 'input', 'search', 'login', 'diary', 'food', 'progress',
                        'export', 'information', 'more', 'settings', 'profile', 'home'];
    
    for (const keyword of uiKeywords) {
      if (text.includes(keyword)) {
        terms.push(keyword);
      }
    }

    // Extract quoted text (e.g., "Export My Information")
    const quoted = text.match(/'([^']+)'|"([^"]+)"/g);
    if (quoted) {
      for (const match of quoted) {
        terms.push(match.replace(/['"]/g, '').toLowerCase());
      }
    }

    // Extract arrow notation (e.g., "More -> Progress")
    const arrows = text.match(/(\w+)\s*-+>\s*(\w+)/g);
    if (arrows) {
      for (const match of arrows) {
        const parts = match.split(/\s*-+>\s*/);
        terms.push(...parts.map(p => p.toLowerCase()));
      }
    }

    // Extract capitalized words (likely proper nouns)
    const words = text.split(/\s+/);
    for (const word of words) {
      if (word.length > 3 && !uiKeywords.includes(word.toLowerCase())) {
        terms.push(word.toLowerCase());
      }
    }

    return [...new Set(terms)]; // Remove duplicates
  }

  /**
   * Normalize action verbs to canonical form
   */
  private normalizeAction(text: string): string | null {
    if (text.match(/\b(click|tap|press|select|touch)\b/)) return 'interact';
    if (text.match(/\b(log\s*in|login|sign\s*in|signin|authenticate)\b/)) return 'login';
    if (text.match(/\b(log\s*out|logout|sign\s*out|signout)\b/)) return 'logout';
    if (text.match(/\b(go\s*to|navigate|open|access|visit)\b/)) return 'navigate';
    if (text.match(/\b(enter|type|input|fill|provide)\b/)) return 'input';
    if (text.match(/\b(verify|check|confirm|validate|assert|see)\b/)) return 'verify';
    if (text.match(/\b(scroll|swipe|drag)\b/)) return 'scroll';
    if (text.match(/\b(export|download|save)\b/)) return 'export';
    return null;
  }

  /**
   * Extract target element from action text
   */
  private extractTargetElement(text: string): string | null {
    // Match patterns like "click login button", "tap on Export", "go to More menu"
    const patterns = [
      /(?:click|tap|press|select)\s+(?:on\s+)?(.+?)(?:\s+button|\s+btn|$)/,
      /(?:go\s*to|navigate\s*to|open)\s+(.+?)(?:\s+menu|\s+screen|\s+page|$)/,
      /(?:enter|type|input)\s+(.+?)(?:\s+in|\s+into|$)/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * Extract UI element names (buttons, menus, screens)
   */
  private extractUIElements(text: string): string[] {
    const elements: string[] = [];

    // Pattern: word followed by UI element type
    const patterns = [
      /(\w+)\s+(button|btn)/g,
      /(\w+)\s+(menu|screen|page|dialog|modal)/g,
      /'([^']+)'\s+(button|menu|item)/g,
      /"([^"]+)"\s+(button|menu|item)/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        elements.push(match[1].toLowerCase());
      }
    }

    // Extract words that are likely UI elements (capitalized or in quotes)
    const uiTerms = ['more', 'progress', 'export', 'information', 'diary', 'home', 'settings'];
    for (const term of uiTerms) {
      if (text.includes(term)) {
        elements.push(term);
      }
    }

    return [...new Set(elements)];
  }

  /**
   * Check if two terms are synonyms based on synonym groups
   */
  private areSynonyms(term1: string, term2: string, synonymGroups: string[][]): boolean {
    for (const group of synonymGroups) {
      if (group.includes(term1) && group.includes(term2)) {
        return true;
      }
    }
    return false;
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

  /**
   * PHASE 3B: Verify if a test step is visible in video frames
   * Returns confidence score based on visual evidence
   */
  private verifyStepInFrames(
    expectedAction: string,
    matchedLogStep: LogStep | undefined,
    videoFrames: Array<any>
  ): {
    visuallyDetected: boolean;
    confidence: 'high' | 'medium' | 'low' | 'not_verified';
    frame?: any;
    evidence?: string;
  } {
    if (videoFrames.length === 0) {
      return {
        visuallyDetected: false,
        confidence: 'not_verified',
        evidence: 'No video frames available for verification'
      };
    }

    const actionLower = expectedAction.toLowerCase();
    
    // Extract key terms from expected action
    const keyTerms = this.extractKeyTerms(actionLower);
    
    if (this.debug) {
      console.log(`[TestCaseComparator] Verifying step "${expectedAction}" (key terms: ${keyTerms.join(', ')})`);
    }

    // Search through frames for visual evidence
    let bestMatch: { frame: any; score: number; evidence: string } | null = null;

    for (const frame of videoFrames) {
      const visualAnalysis = (frame.visualAnalysis || '').toLowerCase();
      const ocrText = (frame.ocrText || '').toLowerCase();
      const appState = (frame.appState || '').toLowerCase();
      
      let score = 0;
      const evidence: string[] = [];

      // Check for key terms in visual analysis
      for (const term of keyTerms) {
        if (visualAnalysis.includes(term)) {
          score += 3;
          evidence.push(`Visual: "${term}"`);
        }
        if (ocrText.includes(term)) {
          score += 2;
          evidence.push(`OCR: "${term}"`);
        }
        if (appState.includes(term)) {
          score += 1;
          evidence.push(`State: "${term}"`);
        }
      }

      // Action-specific matching
      if (actionLower.includes('click') || actionLower.includes('tap')) {
        if (visualAnalysis.includes('button') || visualAnalysis.includes('tapped')) {
          score += 2;
          evidence.push('Button/tap detected');
        }
      }
      
      if (actionLower.includes('search')) {
        if (visualAnalysis.includes('search') || ocrText.includes('search')) {
          score += 3;
          evidence.push('Search UI detected');
        }
      }

      if (actionLower.includes('login') || actionLower.includes('sign in')) {
        if (visualAnalysis.includes('login') || ocrText.includes('password') || ocrText.includes('username')) {
          score += 3;
          evidence.push('Login screen detected');
        }
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = {
          frame,
          score,
          evidence: evidence.join(', ')
        };
      }
    }

    // Determine confidence based on score and whether log step exists
    if (!bestMatch || bestMatch.score === 0) {
      return {
        visuallyDetected: false,
        confidence: matchedLogStep ? 'low' : 'not_verified',
        evidence: matchedLogStep 
          ? 'Step logged but not visually confirmed in video' 
          : 'No visual or log evidence found'
      };
    }

    // Score interpretation
    let confidence: 'high' | 'medium' | 'low';
    if (bestMatch.score >= 5 && matchedLogStep) {
      confidence = 'high'; // Strong visual + log evidence
    } else if (bestMatch.score >= 3 || matchedLogStep) {
      confidence = 'medium'; // Moderate visual or log evidence
    } else {
      confidence = 'low'; // Weak visual evidence, no log
    }

    if (this.debug) {
      console.log(`[TestCaseComparator] Found visual evidence: score=${bestMatch.score}, confidence=${confidence}, frame=${bestMatch.frame.timestamp}s`);
    }

    return {
      visuallyDetected: true,
      confidence,
      frame: bestMatch.frame,
      evidence: bestMatch.evidence
    };
  }

  /**
   * PHASE 3B: Detect discrepancies between logs and visual frames
   */
  private detectDiscrepancy(
    logStep: LogStep | undefined,
    visualVerification: { visuallyDetected: boolean; confidence: string; evidence?: string }
  ): {
    hasDiscrepancy: boolean;
    reason?: string;
  } {
    // Case 1: Logged but not visually confirmed (suspicious)
    if (logStep && !visualVerification.visuallyDetected) {
      return {
        hasDiscrepancy: true,
        reason: '⚠️ Action logged but not visible in video - possible logging error or action didn\'t execute visually'
      };
    }

    // Case 2: Visually present but not logged (warning)
    if (!logStep && visualVerification.visuallyDetected && visualVerification.confidence !== 'low') {
      return {
        hasDiscrepancy: true,
        reason: '⚠️ Action visible in video but not logged - possible logging gap'
      };
    }

    // Case 3: Low confidence visual match with log (questionable)
    if (logStep && visualVerification.visuallyDetected && visualVerification.confidence === 'low') {
      return {
        hasDiscrepancy: true,
        reason: '⚠️ Logged action has weak visual confirmation - verify execution'
      };
    }

    // No discrepancy detected
    return {
      hasDiscrepancy: false
    };
  }

  /**
   * Extract key terms from an action description for matching
   */
  private extractKeyTerms(text: string): string[] {
    const terms: string[] = [];
    
    // Common UI elements
    const uiElements = ['button', 'menu', 'tab', 'screen', 'dialog', 'modal', 'field', 'input', 'search', 'login', 'diary', 'food', 'profile', 'settings'];
    for (const element of uiElements) {
      if (text.includes(element)) {
        terms.push(element);
      }
    }

    // Actions
    const actions = ['click', 'tap', 'select', 'enter', 'type', 'search', 'open', 'close', 'verify', 'check'];
    for (const action of actions) {
      if (text.includes(action)) {
        terms.push(action);
      }
    }

    // Extract quoted words (e.g., "Add Food", "Diary")
    const quoted = text.match(/"([^"]+)"/g);
    if (quoted) {
      for (const match of quoted) {
        terms.push(match.replace(/"/g, '').toLowerCase());
      }
    }

    // Extract capitalized words (likely proper nouns or UI element names)
    const words = text.split(/\s+/);
    for (const word of words) {
      if (word.length > 3 && /^[A-Z]/.test(word)) {
        terms.push(word.toLowerCase());
      }
    }

    return [...new Set(terms)]; // Remove duplicates
  }

  /**
   * MULTI-TC: Intelligently merge steps from multiple test cases
   * Handles duplicates, overlaps, and different test parts
   */
  private mergeTestCaseSteps(testCases: TestCaseComparison[]): Array<TestCaseStep & { sourceTestCase: string }> {
    const mergedSteps: Array<TestCaseStep & { sourceTestCase: string }> = [];
    const seenSteps = new Map<string, TestCaseStep & { sourceTestCase: string }>();

    if (this.debug) {
      console.log(`[TestCaseComparator] Merging steps from ${testCases.length} test cases`);
    }

    for (const tc of testCases) {
      for (const step of tc.testCaseSteps) {
        // Create a signature for duplicate detection
        const signature = this.normalizeStepSignature(step.expectedAction);

        if (seenSteps.has(signature)) {
          // Duplicate detected - keep the more detailed one
          const existing = seenSteps.get(signature)!;
          if (step.expectedAction.length > existing.expectedAction.length) {
            if (this.debug) {
              console.log(`[TestCaseComparator] Replacing duplicate step with more detailed version: "${existing.expectedAction}" → "${step.expectedAction}"`);
            }
            seenSteps.set(signature, { ...step, sourceTestCase: tc.testCaseKey });
          } else {
            if (this.debug) {
              console.log(`[TestCaseComparator] Skipping duplicate step: "${step.expectedAction}" (already have: "${existing.expectedAction}")`);
            }
          }
        } else {
          // New step - add it
          seenSteps.set(signature, { ...step, sourceTestCase: tc.testCaseKey });
        }
      }
    }

    // Convert map to array and re-number steps
    let stepNumber = 1;
    for (const step of seenSteps.values()) {
      mergedSteps.push({
        ...step,
        stepNumber: stepNumber++
      });
    }

    if (this.debug) {
      console.log(`[TestCaseComparator] Merged ${seenSteps.size} unique steps from ${testCases.reduce((sum, tc) => sum + tc.testCaseSteps.length, 0)} total steps`);
    }

    return mergedSteps;
  }

  /**
   * Normalize step text for duplicate detection
   */
  private normalizeStepSignature(action: string): string {
    return action
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')     // Normalize whitespace
      .trim();
  }

  /**
   * MULTI-TC: Calculate combined coverage across all test cases
   */
  private calculateCombinedCoverage(
    mergedSteps: Array<TestCaseStep & { sourceTestCase: string }>,
    executedSteps: LogStep[]
  ): number {
    if (mergedSteps.length === 0) {
      return 0;
    }

    let matchedSteps = 0;
    for (const tcStep of mergedSteps) {
      for (const execStep of executedSteps) {
        if (this.stepsMatch(execStep.action, tcStep.expectedAction)) {
          matchedSteps++;
          break;
        }
      }
    }

    return Math.round((matchedSteps / mergedSteps.length) * 100);
  }

  /**
   * MULTI-TC: Build step-by-step comparison for merged test cases
   */
  private buildCombinedStepComparison(
    mergedSteps: Array<TestCaseStep & { sourceTestCase: string }>,
    executedSteps: LogStep[],
    videoFrames: Array<any>,
    originalComparisons: TestCaseComparison[]
  ): Array<{
    testCaseStep: number;
    expectedAction: string;
    sourceTestCase: string;
    actualExecution: string;
    videoTimestamp?: number;
    logReference?: string;
    match: boolean;
    deviation?: string;
    visualConfidence?: 'high' | 'medium' | 'low' | 'not_verified';
  }> {
    const comparison: Array<any> = [];

    for (const tcStep of mergedSteps) {
      // Try to find matching executed step
      let matchedExecStep: LogStep | undefined;

      for (const execStep of executedSteps) {
        if (this.stepsMatch(execStep.action, tcStep.expectedAction)) {
          matchedExecStep = execStep;
          break;
        }
      }

      // Visual verification
      const visualVerification = this.verifyStepInFrames(
        tcStep.expectedAction,
        matchedExecStep,
        videoFrames
      );

      const matchedVideoFrame = visualVerification.frame;

      // Detect discrepancy
      const discrepancy = this.detectDiscrepancy(
        matchedExecStep,
        visualVerification
      );

      // Build comparison entry
      if (matchedExecStep) {
        comparison.push({
          testCaseStep: tcStep.stepNumber,
          expectedAction: tcStep.expectedAction,
          sourceTestCase: tcStep.sourceTestCase,
          actualExecution: matchedExecStep.action,
          videoTimestamp: matchedVideoFrame?.timestamp,
          logReference: matchedExecStep.timestamp,
          match: !discrepancy.hasDiscrepancy,
          deviation: discrepancy.hasDiscrepancy ? discrepancy.reason : undefined,
          visualConfidence: visualVerification.confidence
        });
      } else {
        comparison.push({
          testCaseStep: tcStep.stepNumber,
          expectedAction: tcStep.expectedAction,
          sourceTestCase: tcStep.sourceTestCase,
          actualExecution: visualVerification.visuallyDetected 
            ? `Detected visually (no log entry)` 
            : 'Not executed or not found in logs',
          videoTimestamp: matchedVideoFrame?.timestamp,
          match: visualVerification.visuallyDetected,
          deviation: visualVerification.visuallyDetected 
            ? 'Action visible in video but not logged' 
            : 'Step was not executed or could not be matched in logs/video',
          visualConfidence: visualVerification.confidence
        });
      }
    }

    return comparison;
  }

  /**
   * Build clickable URL for a test case
   * Replicates logic from analyse_launch_failures tool
   */
  private async buildTestCaseUrl(testCaseId: string, projectKey: string, baseUrl: string): Promise<string> {
    try {
      // Use TCM client to resolve test case key to numeric ID
      const testCase = await this.tcmClient.getTestCaseByKey(projectKey, testCaseId);
      return `${baseUrl}/projects/${projectKey}/test-cases/${testCase.id}`;
    } catch (error) {
      // If lookup fails, fallback to project test cases page
      if (this.debug) {
        console.warn(`[TestCaseComparator] Failed to build URL for ${testCaseId}:`, error);
      }
      return `${baseUrl}/projects/${projectKey}/test-cases`;
    }
  }
}

