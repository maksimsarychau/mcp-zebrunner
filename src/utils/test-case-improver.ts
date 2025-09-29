import { ZebrunnerTestCase, ZebrunnerCaseStep } from "../types/core.js";
import { ValidationResult, ValidationIssue } from "./test-case-validator.js";

/**
 * Improvement suggestion with confidence level
 */
export interface ImprovementSuggestion {
  type: 'automatic' | 'content' | 'structure';
  confidence: 'high' | 'medium' | 'low';
  category: string;
  description: string;
  originalValue?: string;
  suggestedValue?: string;
  reasoning: string;
}

/**
 * Test case improvement result
 */
export interface ImprovementResult {
  canImprove: boolean;
  requiresHumanHelp: boolean;
  confidence: 'high' | 'medium' | 'low';
  improvements: ImprovementSuggestion[];
  improvedTestCase?: ZebrunnerTestCase;
  humanHelpReasons: string[];
}

/**
 * Test Case Improver - Attempts to automatically fix test case issues
 */
export class TestCaseImprover {
  
  /**
   * Attempts to improve a test case based on validation results
   */
  async improveTestCase(
    originalTestCase: ZebrunnerTestCase, 
    validationResult: ValidationResult
  ): Promise<ImprovementResult> {
    const improvements: ImprovementSuggestion[] = [];
    const humanHelpReasons: string[] = [];
    let improvedTestCase = JSON.parse(JSON.stringify(originalTestCase)); // Deep clone
    let canImprove = false;
    let requiresHumanHelp = false;

    // Process each validation issue
    for (const issue of validationResult.issues) {
      const improvement = await this.processIssue(issue, originalTestCase, improvedTestCase);
      
      if (improvement) {
        improvements.push(improvement);
        canImprove = true;
        
        // Apply the improvement if it's automatic or high confidence
        if (improvement.type === 'automatic' || improvement.confidence === 'high') {
          this.applyImprovement(improvement, improvedTestCase);
        }
      } else {
        // Issue requires human help
        requiresHumanHelp = true;
        humanHelpReasons.push(`${issue.category}: ${issue.description}`);
      }
    }

    // Additional structural improvements
    const structuralImprovements = this.suggestStructuralImprovements(originalTestCase);
    improvements.push(...structuralImprovements);
    
    if (structuralImprovements.length > 0) {
      canImprove = true;
      // Apply high-confidence structural improvements
      structuralImprovements
        .filter(imp => imp.confidence === 'high')
        .forEach(imp => this.applyImprovement(imp, improvedTestCase));
    }

    // Determine overall confidence
    const overallConfidence = this.calculateOverallConfidence(improvements);

    return {
      canImprove,
      requiresHumanHelp,
      confidence: overallConfidence,
      improvements,
      improvedTestCase: canImprove ? improvedTestCase : undefined,
      humanHelpReasons
    };
  }

  /**
   * Process individual validation issue and suggest improvement
   */
  private async processIssue(
    issue: ValidationIssue, 
    originalTestCase: ZebrunnerTestCase,
    improvedTestCase: ZebrunnerTestCase
  ): Promise<ImprovementSuggestion | null> {
    
    switch (issue.checkpoint) {
      case 'Title Presence':
        return this.improveTitlePresence(issue, originalTestCase);
      
      case 'Title Format':
        return this.improveTitleFormat(issue, originalTestCase);
      
      case 'Preconditions Presence':
        return this.improvePreconditionsPresence(issue, originalTestCase);
      
      case 'Steps Presence':
        return this.improveStepsPresence(issue, originalTestCase);
      
      case 'Expected Results':
        return this.improveExpectedResults(issue, originalTestCase);
      
      case 'Language Clarity':
        return this.improveLanguageClarity(issue, originalTestCase);
      
      case 'Single Objective':
        return this.improveSingleObjective(issue, originalTestCase);
      
      default:
        // Complex issues that require human intervention
        return null;
    }
  }

  /**
   * Improve missing title
   */
  private improveTitlePresence(issue: ValidationIssue, testCase: ZebrunnerTestCase): ImprovementSuggestion {
    let suggestedTitle = 'Untitled Test Case';
    
    // Try to generate title from first step or preconditions
    if (testCase.steps && testCase.steps.length > 0) {
      const firstStep = testCase.steps[0];
      const action = firstStep.action || firstStep.step || firstStep.instruction || '';
      if (action.length > 10) {
        suggestedTitle = action.charAt(0).toUpperCase() + action.slice(1);
        if (!suggestedTitle.endsWith('.')) {
          suggestedTitle += ' test';
        }
      }
    }

    return {
      type: 'content',
      confidence: 'medium',
      category: 'Title Quality',
      description: 'Generate title based on test content',
      originalValue: testCase.title || '',
      suggestedValue: suggestedTitle,
      reasoning: 'Generated title from first test step to provide basic identification'
    };
  }

  /**
   * Improve title format
   */
  private improveTitleFormat(issue: ValidationIssue, testCase: ZebrunnerTestCase): ImprovementSuggestion {
    const title = testCase.title || '';
    let improvedTitle = title;

    // Capitalize first letter
    if (title.length > 0 && title.charAt(0) !== title.charAt(0).toUpperCase()) {
      improvedTitle = title.charAt(0).toUpperCase() + title.slice(1);
    }

    // Remove redundant words
    const redundantPhrases = ['test case', 'test that', 'verify that', 'check that'];
    redundantPhrases.forEach(phrase => {
      const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
      improvedTitle = improvedTitle.replace(regex, '').trim();
    });

    // Clean up multiple spaces
    improvedTitle = improvedTitle.replace(/\s+/g, ' ').trim();

    return {
      type: 'automatic',
      confidence: 'high',
      category: 'Title Quality',
      description: 'Fix title formatting and remove redundant phrases',
      originalValue: title,
      suggestedValue: improvedTitle,
      reasoning: 'Applied standard title formatting rules'
    };
  }

  /**
   * Improve missing preconditions
   */
  private improvePreconditionsPresence(issue: ValidationIssue, testCase: ZebrunnerTestCase): ImprovementSuggestion {
    const suggestedPreconditions = this.generateBasicPreconditions(testCase);

    return {
      type: 'structure',
      confidence: 'medium',
      category: 'Preconditions',
      description: 'Generate basic preconditions template',
      originalValue: testCase.preConditions || '',
      suggestedValue: suggestedPreconditions,
      reasoning: 'Generated standard preconditions template based on test content'
    };
  }

  /**
   * Improve missing steps
   */
  private improveStepsPresence(issue: ValidationIssue, testCase: ZebrunnerTestCase): ImprovementSuggestion | null {
    // Cannot automatically generate meaningful test steps - requires human help
    return null;
  }

  /**
   * Improve missing expected results
   */
  private improveExpectedResults(issue: ValidationIssue, testCase: ZebrunnerTestCase): ImprovementSuggestion {
    const steps = testCase.steps || [];
    let improvementCount = 0;

    steps.forEach((step, index) => {
      const hasExpected = (step.expected || step.expectedResult || step.expectedText || step.result || '').trim();
      if (!hasExpected) {
        // Add basic expected result template
        const action = step.action || step.step || step.instruction || '';
        if (action.toLowerCase().includes('click') || action.toLowerCase().includes('tap')) {
          step.expected = 'Action is performed successfully';
        } else if (action.toLowerCase().includes('enter') || action.toLowerCase().includes('input')) {
          step.expected = 'Data is entered correctly';
        } else if (action.toLowerCase().includes('open') || action.toLowerCase().includes('launch')) {
          step.expected = 'Screen/page opens successfully';
        } else {
          step.expected = 'Step completes as expected';
        }
        improvementCount++;
      }
    });

    return {
      type: 'structure',
      confidence: 'medium',
      category: 'Expected Results',
      description: `Add basic expected results to ${improvementCount} steps`,
      suggestedValue: `Added expected results templates to ${improvementCount} steps`,
      reasoning: 'Added generic expected result templates based on action types'
    };
  }

  /**
   * Improve language clarity
   */
  private improveLanguageClarity(issue: ValidationIssue, testCase: ZebrunnerTestCase): ImprovementSuggestion {
    const improvements: string[] = [];
    
    // Fix common vague terms
    const vagueTermReplacements: Record<string, string> = {
      'the button': 'the [Button Name] button',
      'the field': 'the [Field Name] field',
      'the link': 'the [Link Text] link',
      'the item': 'the [Item Name] item',
      'somehow': 'by [specific method]',
      'usually': 'typically',
      'normally': 'in standard cases',
      'properly': 'correctly'
    };

    let hasImprovements = false;
    Object.entries(vagueTermReplacements).forEach(([vague, specific]) => {
      if (testCase.title?.toLowerCase().includes(vague.toLowerCase())) {
        hasImprovements = true;
        improvements.push(`Title: "${vague}" → "${specific}"`);
      }
    });

    return {
      type: 'content',
      confidence: 'high',
      category: 'Language Clarity',
      description: 'Replace vague terms with specific placeholders',
      suggestedValue: improvements.join('; '),
      reasoning: 'Replaced vague language with specific placeholders that need to be filled in'
    };
  }

  /**
   * Improve single objective issues
   */
  private improveSingleObjective(issue: ValidationIssue, testCase: ZebrunnerTestCase): ImprovementSuggestion | null {
    // Complex structural issue - requires human help to split test case
    return null;
  }

  /**
   * Suggest structural improvements
   */
  private suggestStructuralImprovements(testCase: ZebrunnerTestCase): ImprovementSuggestion[] {
    const improvements: ImprovementSuggestion[] = [];

    // Check if steps need better structure
    const steps = testCase.steps || [];
    if (steps.length > 0) {
      let needsSetupStep = true;
      let needsValidationStep = true;

      steps.forEach(step => {
        const action = (step.action || step.step || step.instruction || '').toLowerCase();
        if (action.includes('open') || action.includes('launch') || action.includes('start')) {
          needsSetupStep = false;
        }
        if (step.expected || step.expectedResult || step.expectedText || step.result) {
          needsValidationStep = false;
        }
      });

      if (needsSetupStep) {
        improvements.push({
          type: 'structure',
          confidence: 'medium',
          category: 'Test Structure',
          description: 'Add initial setup step',
          suggestedValue: 'Add step: "Open the application and navigate to [relevant section]"',
          reasoning: 'Test cases should start with clear setup steps'
        });
      }

      if (needsValidationStep && steps.length > 0) {
        improvements.push({
          type: 'structure',
          confidence: 'medium',
          category: 'Test Structure',
          description: 'Add final validation step',
          suggestedValue: 'Add final step with specific expected result',
          reasoning: 'Test cases should end with clear validation of the expected outcome'
        });
      }
    }

    return improvements;
  }

  /**
   * Generate basic preconditions template
   */
  private generateBasicPreconditions(testCase: ZebrunnerTestCase): string {
    const preconditions = [];
    
    // Standard preconditions
    preconditions.push('- User has access to the application');
    preconditions.push('- Application is installed and functional');
    
    // Analyze steps to suggest specific preconditions
    const steps = testCase.steps || [];
    let needsLogin = false;
    let needsData = false;
    
    steps.forEach(step => {
      const action = (step.action || step.step || step.instruction || '').toLowerCase();
      if (action.includes('login') || action.includes('sign in') || action.includes('authenticate')) {
        needsLogin = true;
      }
      if (action.includes('data') || action.includes('information') || action.includes('content')) {
        needsData = true;
      }
    });

    if (needsLogin) {
      preconditions.push('- Valid user credentials are available');
    }
    if (needsData) {
      preconditions.push('- Required test data is prepared');
    }

    preconditions.push('- Device/browser meets system requirements');
    
    return preconditions.join('\n');
  }

  /**
   * Apply improvement to test case
   */
  private applyImprovement(improvement: ImprovementSuggestion, testCase: ZebrunnerTestCase): void {
    switch (improvement.category) {
      case 'Title Quality':
        if (improvement.suggestedValue) {
          testCase.title = improvement.suggestedValue;
        }
        break;
      
      case 'Preconditions':
        if (improvement.suggestedValue) {
          testCase.preConditions = improvement.suggestedValue;
        }
        break;
      
      // Note: Steps improvements are applied directly in improveExpectedResults
      default:
        break;
    }
  }

  /**
   * Calculate overall confidence based on individual improvements
   */
  private calculateOverallConfidence(improvements: ImprovementSuggestion[]): 'high' | 'medium' | 'low' {
    if (improvements.length === 0) return 'low';
    
    const confidenceScores = improvements.map(imp => {
      switch (imp.confidence) {
        case 'high': return 3;
        case 'medium': return 2;
        case 'low': return 1;
      }
    });
    
    const averageScore = confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;
    
    if (averageScore >= 2.5) return 'high';
    if (averageScore >= 1.5) return 'medium';
    return 'low';
  }
}
