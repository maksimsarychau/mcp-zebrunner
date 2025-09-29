import { ZebrunnerTestCase, ZebrunnerCaseStep } from "../types/core.js";
import { DynamicRulesParser, ValidationRuleSet, ValidationRule } from "./dynamic-rules-parser.js";

/**
 * Test Case Validation Results
 */
export interface ValidationIssue {
  category: string;
  severity: 'critical' | 'major' | 'minor';
  checkpoint: string;
  description: string;
  suggestion?: string;
  ruleId?: string;
}

export interface ValidationResult {
  testCaseKey: string;
  testCaseTitle: string;
  automationStatus: string; // Current automation status from Zebrunner
  priority?: string; // Test case priority
  status?: string; // Test case status (draft, deprecated, etc.)
  manualOnly?: string; // Manual Only flag from custom fields
  overallScore: number;
  scoreCategory: 'excellent' | 'good' | 'needs_improvement' | 'poor';
  issues: ValidationIssue[];
  passedCheckpoints: string[];
  summary: string;
  readyForAutomation: boolean;
  readyForManualExecution: boolean;
  rulesUsed: string; // Name and version of rules used
}

/**
 * Validation result interface for individual checks
 */
interface ValidationCheckResult {
  passed: boolean;
  message?: string;
  suggestion?: string;
}

/**
 * Dynamic Test Case Validator based on configurable rules and checkpoints
 */
export class TestCaseValidator {
  private ruleSet: ValidationRuleSet;
  private validationFunctions: Map<string, Function>;

  constructor(ruleSet?: ValidationRuleSet) {
    this.ruleSet = ruleSet || DynamicRulesParser.getDefaultRuleSet();
    this.validationFunctions = new Map();
    this.initializeValidationFunctions();
  }

  /**
   * Loads rules from markdown files
   */
  static async fromMarkdownFiles(rulesFilePath: string, checkpointsFilePath: string): Promise<TestCaseValidator> {
    const ruleSet = await DynamicRulesParser.loadRulesFromFiles(rulesFilePath, checkpointsFilePath);
    return new TestCaseValidator(ruleSet);
  }

  /**
   * Updates the rule set dynamically
   */
  updateRuleSet(ruleSet: ValidationRuleSet): void {
    this.ruleSet = DynamicRulesParser.validateRuleSet(ruleSet);
  }

  /**
   * Initializes validation functions map
   */
  private initializeValidationFunctions(): void {
    this.validationFunctions.set('validateTitle', this.validateTitle.bind(this));
    this.validationFunctions.set('validatePreconditions', this.validatePreconditions.bind(this));
    this.validationFunctions.set('validateSteps', this.validateSteps.bind(this));
    this.validationFunctions.set('validateExpectedResults', this.validateExpectedResults.bind(this));
    this.validationFunctions.set('validateIndependence', this.validateIndependence.bind(this));
    this.validationFunctions.set('validateSingleResponsibility', this.validateSingleResponsibility.bind(this));
    this.validationFunctions.set('validateAutomationReadiness', this.validateAutomationReadiness.bind(this));
    this.validationFunctions.set('validateCompleteness', this.validateCompleteness.bind(this));
    this.validationFunctions.set('validateLanguageClarity', this.validateLanguageClarity.bind(this));
    this.validationFunctions.set('validateGeneral', this.validateGeneral.bind(this));
  }

  /**
   * Validates a test case against the dynamic rule set
   */
  async validateTestCase(testCase: ZebrunnerTestCase): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const passedCheckpoints: string[] = [];

    // Run validation based on enabled rules
    for (const rule of this.ruleSet.rules.filter(r => r.enabled)) {
      const validationFunction = this.validationFunctions.get(rule.checkFunction);
      if (validationFunction) {
        try {
          const result = validationFunction(testCase, rule);
          if (result.passed) {
            passedCheckpoints.push(rule.name);
          } else {
            issues.push({
              category: rule.category,
              severity: rule.severity,
              checkpoint: rule.name,
              description: result.message || rule.description,
              suggestion: result.suggestion || rule.suggestion,
              ruleId: rule.id
            });
          }
        } catch (error) {
          console.warn(`Error executing validation rule ${rule.id}: ${error}`);
        }
      }
    }

    // Calculate score
    const totalCheckpoints = issues.length + passedCheckpoints.length;
    const score = totalCheckpoints > 0 ? Math.round((passedCheckpoints.length / totalCheckpoints) * 100) : 0;
    
    const scoreCategory = this.getScoreCategory(score);
    const readyForAutomation = score >= this.ruleSet.scoreThresholds.good && !this.hasAutomationBlockers(issues);
    const readyForManualExecution = score >= this.ruleSet.scoreThresholds.needs_improvement;

    // Extract automation status, priority, and status
    const automationStatus = testCase.automationState?.name || 'Unknown';
    const priority = testCase.priority?.name || undefined;
    
    // Construct status from available boolean fields
    let status: string | undefined;
    if (testCase.draft) {
      status = 'Draft';
    } else if (testCase.deprecated) {
      status = 'Deprecated';
    } else {
      // If neither draft nor deprecated, it's likely active
      status = 'Active';
    }
    
    // Extract Manual Only from custom fields
    const manualOnly = testCase.customField?.manualOnly || undefined;

    return {
      testCaseKey: testCase.key || 'Unknown',
      testCaseTitle: testCase.title || 'Untitled',
      automationStatus,
      priority,
      status,
      manualOnly,
      overallScore: score,
      scoreCategory,
      issues,
      passedCheckpoints,
      summary: this.generateSummary(score, issues, readyForAutomation, readyForManualExecution, automationStatus),
      readyForAutomation,
      readyForManualExecution,
      rulesUsed: `${this.ruleSet.name} v${this.ruleSet.version}`
    };
  }

  /**
   * General validation function for simple checks
   */
  private validateGeneral(testCase: ZebrunnerTestCase, rule: ValidationRule): ValidationCheckResult {
    // This is a placeholder for rules that don't have specific validation logic
    return { passed: true, message: `General validation passed for ${rule.name}` };
  }

  /**
   * Validates test case title according to standards
   */
  private validateTitle(testCase: ZebrunnerTestCase, rule: ValidationRule): ValidationCheckResult {
    const title = testCase.title?.trim();
    
    if (!title) {
      return {
        passed: false,
        message: 'Test case must have a title',
        suggestion: 'Add a clear, descriptive title that explains what is being tested'
      };
    }

    // Check title length and clarity based on rule parameters or defaults
    const minLength = rule.parameters?.minLength || 10;
    const maxLength = rule.parameters?.maxLength || 150;
    
    if (title.length < minLength) {
      return {
        passed: false,
        message: `Title is too short (${title.length} chars, minimum ${minLength})`,
        suggestion: 'Expand title to clearly communicate the test objective'
      };
    }
    
    if (title.length > maxLength) {
      return {
        passed: false,
        message: `Title is too long (${title.length} chars, maximum ${maxLength})`,
        suggestion: 'Shorten title while maintaining clarity'
      };
    }

    // Check for vague words if specified in rule
    const vaguePhrases = rule.parameters?.vaguePhrases || ['verify', 'check', 'ensure', 'test that', 'make sure'];
    const hasVaguePhrase = vaguePhrases.some((phrase: string) => title.toLowerCase().includes(phrase.toLowerCase()));
    
    if (hasVaguePhrase) {
      return {
        passed: false,
        message: 'Title contains vague phrases that should be more specific',
        suggestion: 'Replace vague terms with specific actions or expected outcomes'
      };
    }

    // Check format requirements
    const startsWithCapital = title.charAt(0) === title.charAt(0).toUpperCase();
    if (!startsWithCapital) {
      return {
        passed: false,
        message: 'Title should start with a capital letter',
        suggestion: 'Capitalize the first letter of the title'
      };
    }

    return { passed: true };
  }

  /**
   * Validates preconditions completeness
   */
  private validatePreconditions(testCase: ZebrunnerTestCase, rule: ValidationRule): ValidationCheckResult {
    const preconditions = testCase.preConditions?.trim();
    
    if (!preconditions) {
      return {
        passed: false,
        message: 'Test case must have explicit preconditions',
        suggestion: 'Add preconditions including: user state, environment settings, data requirements, feature flags'
      };
    }

    // Check minimum length
    const minLength = rule.parameters?.minLength || 20;
    if (preconditions.length < minLength) {
      return {
        passed: false,
        message: `Preconditions too brief (${preconditions.length} chars, minimum ${minLength})`,
        suggestion: 'Add more detailed preconditions including user state, environment, and data requirements'
      };
    }

    return { passed: true };
  }

  /**
   * Validates test case steps
   */
  private validateSteps(testCase: ZebrunnerTestCase, rule: ValidationRule): ValidationCheckResult {
    const steps = testCase.steps || [];
    
    if (steps.length === 0) {
      return {
        passed: false,
        message: 'Test case must have test steps',
        suggestion: 'Add detailed steps from beginning to end of the test scenario'
      };
    }

    const minSteps = rule.parameters?.minSteps || 3;
    if (steps.length < minSteps) {
      return {
        passed: false,
        message: `Too few steps (${steps.length}, minimum ${minSteps})`,
        suggestion: 'Ensure all necessary steps are included from app launch to final validation'
      };
    }

    return { passed: true };
  }

  /**
   * Validates expected results
   */
  private validateExpectedResults(testCase: ZebrunnerTestCase, rule: ValidationRule): ValidationCheckResult {
    const steps = testCase.steps || [];
    const stepsWithResults = steps.filter(step => 
      (step.expected || step.expectedResult || step.expectedText || step.result || '').trim()
    );

    if (stepsWithResults.length === 0) {
      return {
        passed: false,
        message: 'No expected results defined in any steps',
        suggestion: 'Add specific, measurable expected results for validation steps'
      };
    }

    return { passed: true };
  }

  /**
   * Validates test case independence
   */
  private validateIndependence(testCase: ZebrunnerTestCase, rule: ValidationRule): ValidationCheckResult {
    const title = testCase.title?.toLowerCase() || '';
    const preconditions = testCase.preConditions?.toLowerCase() || '';
    
    const dependencyIndicators = rule.parameters?.dependencyIndicators || [
      'previous test', 'after', 'before', 'from previous', 'continue from', 'already', 'existing'
    ];
    
    const hasDependencies = dependencyIndicators.some((indicator: string) => 
      title.includes(indicator) || preconditions.includes(indicator)
    );

    if (hasDependencies) {
      return {
        passed: false,
        message: 'Test case appears to depend on other test cases or external state',
        suggestion: 'Make test case completely self-contained with all necessary setup'
      };
    }

    return { passed: true };
  }

  /**
   * Validates single responsibility principle
   */
  private validateSingleResponsibility(testCase: ZebrunnerTestCase, rule: ValidationRule): ValidationCheckResult {
    const title = testCase.title || '';
    const multipleObjectiveIndicators = rule.parameters?.multipleIndicators || [' and ', ' or ', ' then ', ', '];
    
    const hasMultipleObjectives = multipleObjectiveIndicators.some((indicator: string) => 
      title.toLowerCase().includes(indicator)
    );

    if (hasMultipleObjectives) {
      return {
        passed: false,
        message: 'Title suggests multiple test objectives that should be separate test cases',
        suggestion: 'Split into separate test cases, each focusing on one specific scenario'
      };
    }

    return { passed: true };
  }

  /**
   * Validates automation readiness
   */
  private validateAutomationReadiness(testCase: ZebrunnerTestCase, rule: ValidationRule): ValidationCheckResult {
    const steps = testCase.steps || [];
    const humanJudgmentIndicators = rule.parameters?.humanJudgmentIndicators || [
      'visually verify', 'looks good', 'appears correct', 'manually check'
    ];
    
    const requiresHumanJudgment = steps.some(step => {
      const action = (step.action || step.step || step.instruction || '').toLowerCase();
      const expected = (step.expected || step.expectedResult || step.expectedText || step.result || '').toLowerCase();
      
      return humanJudgmentIndicators.some((indicator: string) => 
        action.includes(indicator) || expected.includes(indicator)
      );
    });

    if (requiresHumanJudgment) {
      return {
        passed: false,
        message: 'Test case requires human judgment that cannot be automated',
        suggestion: 'Replace subjective validations with specific, measurable criteria'
      };
    }

    return { passed: true };
  }

  /**
   * Validates completeness
   */
  private validateCompleteness(testCase: ZebrunnerTestCase, rule: ValidationRule): ValidationCheckResult {
    const steps = testCase.steps || [];
    
    if (steps.length === 0) {
      return {
        passed: false,
        message: 'Test case has no steps',
        suggestion: 'Add complete test steps from setup to validation'
      };
    }

    return { passed: true };
  }

  /**
   * Validates language and clarity
   */
  private validateLanguageClarity(testCase: ZebrunnerTestCase, rule: ValidationRule): ValidationCheckResult {
    const title = testCase.title || '';
    const steps = testCase.steps || [];
    
    const vaguePhrases = rule.parameters?.vaguePhrases || ['somehow', 'usually', 'normally', 'properly'];
    const allText = [title, ...steps.map(s => 
      (s.action || s.step || s.instruction || '') + ' ' + 
      (s.expected || s.expectedResult || s.expectedText || s.result || '')
    )].join(' ').toLowerCase();
    
    const hasVagueLanguage = vaguePhrases.some((phrase: string) => allText.includes(phrase));

    if (hasVagueLanguage) {
      return {
        passed: false,
        message: 'Test case contains vague language that could cause confusion',
        suggestion: 'Use specific, clear terminology throughout the test case'
      };
    }

    return { passed: true };
  }

  /**
   * Determines score category based on percentage
   */
  private getScoreCategory(score: number): 'excellent' | 'good' | 'needs_improvement' | 'poor' {
    if (score >= this.ruleSet.scoreThresholds.excellent) return 'excellent';
    if (score >= this.ruleSet.scoreThresholds.good) return 'good';
    if (score >= this.ruleSet.scoreThresholds.needs_improvement) return 'needs_improvement';
    return 'poor';
  }

  /**
   * Checks if there are automation-blocking issues
   */
  private hasAutomationBlockers(issues: ValidationIssue[]): boolean {
    return issues.some(issue => 
      issue.category === 'Automation Readiness' && 
      (issue.severity === 'critical' || issue.severity === 'major')
    );
  }

  /**
   * Generates summary based on validation results
   */
  private generateSummary(
    score: number, 
    issues: ValidationIssue[], 
    readyForAutomation: boolean, 
    readyForManualExecution: boolean,
    automationStatus: string
  ): string {
    const category = this.getScoreCategory(score);
    const criticalIssues = issues.filter(i => i.severity === 'critical').length;
    const majorIssues = issues.filter(i => i.severity === 'major').length;
    const minorIssues = issues.filter(i => i.severity === 'minor').length;

    let summary = `[${automationStatus}] Overall Score: ${score}% (${category.replace('_', ' ').toUpperCase()})`;
    
    if (criticalIssues > 0) {
      summary += ` | ${criticalIssues} critical issue${criticalIssues > 1 ? 's' : ''}`;
    }
    if (majorIssues > 0) {
      summary += ` | ${majorIssues} major issue${majorIssues > 1 ? 's' : ''}`;
    }
    if (minorIssues > 0) {
      summary += ` | ${minorIssues} minor issue${minorIssues > 1 ? 's' : ''}`;
    }

    summary += ` | Manual: ${readyForManualExecution ? 'Ready' : 'Not Ready'}`;
    summary += ` | Automation: ${readyForAutomation ? 'Ready' : 'Not Ready'}`;

    return summary;
  }
}
