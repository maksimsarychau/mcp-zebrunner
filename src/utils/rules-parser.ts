import fs from 'fs';
import path from 'path';
import { validateFilePath } from './security.js';

/**
 * Configuration for test coverage rules and quality standards
 */
export interface CoverageRules {
  thresholds: {
    overall: number;
    criticalSteps: number;
    uiValidation: number;
    apiValidation: number;
  };
  required: {
    uiElements: boolean;
    apiCalls: boolean;
    errorHandling: boolean;
    dataValidation: boolean;
  };
  quality: {
    minAssertionsPerStep: number;
    requireSetupTeardown: boolean;
    requireTestIsolation: boolean;
    followNamingConventions: boolean;
  };
}

/**
 * Framework detection patterns and templates
 */
export interface FrameworkConfig {
  name: string;
  filePatterns: string[];
  keywords: string[];
  imports: string[];
  templates: {
    testMethod?: string;
    testSuite?: string;
    setup?: string;
    teardown?: string;
    assertion?: string;
  };
}

/**
 * Code quality patterns and standards
 */
export interface QualityRules {
  naming: {
    testMethods: string;
    variables: string;
    assertions: string;
  };
  patterns: {
    [key: string]: {
      pattern: string;
      validation: string;
      description?: string;
    };
  };
  errorHandling: {
    apiErrors: string[];
    uiErrors: string[];
    validationRules: string[];
  };
}

/**
 * Complete rules configuration parsed from markdown file
 */
export interface RulesConfig {
  coverage: CoverageRules;
  frameworks: FrameworkConfig[];
  quality: QualityRules;
  customRules: { [key: string]: any };
}

/**
 * Default rules configuration
 */
const DEFAULT_RULES: RulesConfig = {
  coverage: {
    thresholds: {
      overall: 70,
      criticalSteps: 90,
      uiValidation: 80,
      apiValidation: 85,
    },
    required: {
      uiElements: true,
      apiCalls: true,
      errorHandling: false,
      dataValidation: true,
    },
    quality: {
      minAssertionsPerStep: 1,
      requireSetupTeardown: true,
      requireTestIsolation: true,
      followNamingConventions: true,
    },
  },
  frameworks: [
    {
      name: 'java-carina',
      filePatterns: ['*.java', '*Test.java', '*Tests.java'],
      keywords: ['@Test', 'extends AbstractTest', 'WebDriver', 'MobileDriver'],
      imports: ['com.qaprosoft.carina', 'org.testng', 'org.junit'],
      templates: {
        testMethod: `@Test(description = "{{TEST_DESCRIPTION}}")
public void {{TEST_METHOD_NAME}}() {
    // Setup
    {{SETUP_CODE}}
    
    // Test Steps
    {{#each STEPS}}
    // Step {{@index}}: {{this.action}}
    {{STEP_CODE}}
    // Validation: {{this.expectedResult}}
    {{VALIDATION_CODE}}
    {{/each}}
    
    // Cleanup
    {{TEARDOWN_CODE}}
}`,
      },
    },
    {
      name: 'javascript-jest',
      filePatterns: ['*.test.js', '*.spec.js', '*.test.ts'],
      keywords: ['describe', 'it', 'expect', 'jest'],
      imports: ['@testing-library', 'jest', 'cypress'],
      templates: {
        testSuite: `describe('{{TEST_SUITE_NAME}}', () => {
    beforeEach(() => {
        {{SETUP_CODE}}
    });
    
    it('{{TEST_DESCRIPTION}}', async () => {
        {{#each STEPS}}
        // Step {{@index}}: {{this.action}}
        {{STEP_CODE}}
        // Validation: {{this.expectedResult}}
        {{VALIDATION_CODE}}
        {{/each}}
    });
    
    afterEach(() => {
        {{TEARDOWN_CODE}}
    });
});`,
      },
    },
  ],
  quality: {
    naming: {
      testMethods: 'Should describe the business scenario',
      variables: 'Use descriptive names matching domain language',
      assertions: 'Should have meaningful error messages',
    },
    patterns: {
      login: {
        pattern: 'loginAs{{UserType}}User()',
        validation: 'expect(user.isAuthenticated()).toBe(true)',
        description: 'Standard login pattern with user type',
      },
      navigation: {
        pattern: 'navigateTo{{ScreenName}}()',
        validation: 'expect({{screenName}}Page.isDisplayed()).toBe(true)',
        description: 'Standard navigation pattern',
      },
      formInteraction: {
        pattern: 'fill{{FieldName}}(value)',
        validation: 'expect({{fieldName}}Field.getValue()).toBe(expectedValue)',
        description: 'Standard form interaction pattern',
      },
    },
    errorHandling: {
      apiErrors: [
        'Always check response status codes',
        'Validate error messages match expected format',
        'Test both success and failure scenarios',
      ],
      uiErrors: [
        'Validate error messages are displayed',
        'Check form validation behavior',
        'Test edge cases and boundary conditions',
      ],
      validationRules: [
        'Use explicit waits instead of Thread.sleep',
        'Implement proper timeout handling',
        'Validate both positive and negative scenarios',
      ],
    },
  },
  customRules: {},
};

/**
 * Parses markdown rules file and extracts configuration
 */
export class RulesParser {
  private static instance: RulesParser;
  private cachedRules: RulesConfig | null = null;
  private rulesFilePath: string;

  private constructor() {
    // Get rules file path from environment or use default
    const rulesFileName = process.env.MCP_RULES_FILE || 'mcp-zebrunner-rules.md';
    
    try {
      // Validate path to prevent traversal attacks
      this.rulesFilePath = validateFilePath(rulesFileName, process.cwd());
    } catch (error) {
      // If validation fails, fall back to safe default in current directory
      console.warn(`[RulesParser] Invalid rules file path, using default: ${error instanceof Error ? error.message : error}`);
      this.rulesFilePath = path.resolve(process.cwd(), 'mcp-zebrunner-rules.md');
    }
  }

  public static getInstance(): RulesParser {
    if (!RulesParser.instance) {
      RulesParser.instance = new RulesParser();
    }
    return RulesParser.instance;
  }

  /**
   * Gets the complete rules configuration
   */
  public async getRules(): Promise<RulesConfig> {
    if (this.cachedRules) {
      return this.cachedRules;
    }

    try {
      if (fs.existsSync(this.rulesFilePath)) {
        const content = fs.readFileSync(this.rulesFilePath, 'utf-8');
        this.cachedRules = await this.parseMarkdownRules(content);
        console.error(`📋 Loaded rules from: ${this.rulesFilePath}`);
      } else {
        console.error(`📋 Rules file not found at: ${this.rulesFilePath}, using defaults`);
        this.cachedRules = DEFAULT_RULES;
      }
    } catch (error) {
      console.error(`⚠️ Error loading rules file: ${(error as Error).message}, using defaults`);
      this.cachedRules = DEFAULT_RULES;
    }

    return this.cachedRules;
  }

  /**
   * Parses markdown content and extracts rules configuration
   */
  private async parseMarkdownRules(content: string): Promise<RulesConfig> {
    const rules = JSON.parse(JSON.stringify(DEFAULT_RULES)); // Deep clone defaults

    try {
      // Parse coverage thresholds
      const thresholdMatches = content.match(/\*\*Overall Coverage\*\*:\s*(\d+)%/);
      if (thresholdMatches) {
        rules.coverage.thresholds.overall = parseInt(thresholdMatches[1], 10);
      }

      const criticalMatches = content.match(/\*\*Critical Steps\*\*:\s*(\d+)%/);
      if (criticalMatches) {
        rules.coverage.thresholds.criticalSteps = parseInt(criticalMatches[1], 10);
      }

      const uiMatches = content.match(/\*\*UI Validation Steps\*\*:\s*(\d+)%/);
      if (uiMatches) {
        rules.coverage.thresholds.uiValidation = parseInt(uiMatches[1], 10);
      }

      const apiMatches = content.match(/\*\*API Validation Steps\*\*:\s*(\d+)%/);
      if (apiMatches) {
        rules.coverage.thresholds.apiValidation = parseInt(apiMatches[1], 10);
      }

      // Parse framework templates
      const javaTemplateMatch = content.match(/#### Java\/Carina Template\s*```java\s*([\s\S]*?)\s*```/);
      if (javaTemplateMatch) {
        const javaFramework = (rules.frameworks as FrameworkConfig[]).find((f: FrameworkConfig) => f.name === 'java-carina');
        if (javaFramework) {
          javaFramework.templates.testMethod = javaTemplateMatch[1].trim();
        }
      }

      const jsTemplateMatch = content.match(/#### JavaScript\/Jest Template\s*```javascript\s*([\s\S]*?)\s*```/);
      if (jsTemplateMatch) {
        const jsFramework = (rules.frameworks as FrameworkConfig[]).find((f: FrameworkConfig) => f.name === 'javascript-jest');
        if (jsFramework) {
          jsFramework.templates.testSuite = jsTemplateMatch[1].trim();
        }
      }

      // Parse quality patterns
      const loginPatternMatch = content.match(/\*\*Login Actions\*\*:\s*\n-\s*Pattern:\s*`([^`]+)`\s*\n-\s*Validation:\s*`([^`]+)`/);
      if (loginPatternMatch) {
        rules.quality.patterns.login = {
          pattern: loginPatternMatch[1],
          validation: loginPatternMatch[2],
          description: 'Standard login pattern with user type',
        };
      }

      // Parse custom environment-based overrides
      const minCoverage = process.env.MIN_COVERAGE_THRESHOLD;
      if (minCoverage) {
        rules.coverage.thresholds.overall = parseInt(minCoverage, 10);
      }

      const requireUI = process.env.REQUIRE_UI_VALIDATION;
      if (requireUI !== undefined) {
        rules.coverage.required.uiElements = requireUI.toLowerCase() === 'true';
      }

      const requireAPI = process.env.REQUIRE_API_VALIDATION;
      if (requireAPI !== undefined) {
        rules.coverage.required.apiCalls = requireAPI.toLowerCase() === 'true';
      }

      const requireError = process.env.REQUIRE_ERROR_HANDLING;
      if (requireError !== undefined) {
        rules.coverage.required.errorHandling = requireError.toLowerCase() === 'true';
      }

    } catch (error) {
      console.error(`⚠️ Error parsing rules content: ${(error as Error).message}`);
    }

    return rules;
  }

  /**
   * Detects the most likely framework based on context
   */
  public async detectFramework(implementationContext: string): Promise<FrameworkConfig | null> {
    const rules = await this.getRules();
    
    let bestMatch: { framework: FrameworkConfig; score: number } | null = null;

    for (const framework of rules.frameworks as FrameworkConfig[]) {
      let score = 0;

      // Check keywords
      for (const keyword of framework.keywords) {
        const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = implementationContext.match(regex);
        if (matches) {
          score += matches.length * 2; // Keywords are weighted more
        }
      }

      // Check imports
      for (const importPattern of framework.imports) {
        const regex = new RegExp(importPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = implementationContext.match(regex);
        if (matches) {
          score += matches.length;
        }
      }

      // Check file patterns (if context includes file paths)
      for (const pattern of framework.filePatterns) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\./g, '\\.'), 'gi');
        const matches = implementationContext.match(regex);
        if (matches) {
          score += matches.length;
        }
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { framework, score };
      }
    }

    return bestMatch?.framework || null;
  }

  /**
   * Validates coverage against rules
   */
  public async validateCoverage(
    stepCoverages: Array<{ step: number; coverage: number; isUI: boolean; isAPI: boolean; isCritical: boolean }>,
    overallCoverage: number
  ): Promise<{
    passed: boolean;
    violations: string[];
    recommendations: string[];
  }> {
    const rules = await this.getRules();
    const violations: string[] = [];
    const recommendations: string[] = [];

    // Check overall coverage
    if (overallCoverage < rules.coverage.thresholds.overall) {
      violations.push(
        `Overall coverage ${overallCoverage}% is below minimum threshold ${rules.coverage.thresholds.overall}%`
      );
    }

    // Check step-specific coverage
    for (const stepCoverage of stepCoverages) {
      if (stepCoverage.isCritical && stepCoverage.coverage < rules.coverage.thresholds.criticalSteps) {
        violations.push(
          `Critical step ${stepCoverage.step} coverage ${stepCoverage.coverage}% is below threshold ${rules.coverage.thresholds.criticalSteps}%`
        );
      }

      if (stepCoverage.isUI && stepCoverage.coverage < rules.coverage.thresholds.uiValidation) {
        violations.push(
          `UI validation step ${stepCoverage.step} coverage ${stepCoverage.coverage}% is below threshold ${rules.coverage.thresholds.uiValidation}%`
        );
      }

      if (stepCoverage.isAPI && stepCoverage.coverage < rules.coverage.thresholds.apiValidation) {
        violations.push(
          `API validation step ${stepCoverage.step} coverage ${stepCoverage.coverage}% is below threshold ${rules.coverage.thresholds.apiValidation}%`
        );
      }
    }

    // Generate recommendations
    if (overallCoverage >= rules.coverage.thresholds.overall * 0.9) {
      recommendations.push('🟢 Good coverage overall. Consider fine-tuning specific steps.');
    } else if (overallCoverage >= rules.coverage.thresholds.overall * 0.7) {
      recommendations.push('🟡 Moderate coverage. Focus on improving critical and UI validation steps.');
    } else {
      recommendations.push('🔴 Low coverage. Significant improvements needed across all test steps.');
    }

    if (rules.coverage.required.uiElements) {
      const uiSteps = stepCoverages.filter(s => s.isUI);
      if (uiSteps.length === 0) {
        recommendations.push('💡 Consider adding UI element validations to improve test reliability.');
      }
    }

    if (rules.coverage.required.apiCalls) {
      const apiSteps = stepCoverages.filter(s => s.isAPI);
      if (apiSteps.length === 0) {
        recommendations.push('💡 Consider adding API response validations to ensure data integrity.');
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      recommendations,
    };
  }

  /**
   * Clears the cached rules (useful for testing or when rules file changes)
   */
  public clearCache(): void {
    this.cachedRules = null;
  }

  /**
   * Gets the current rules file path
   */
  public getRulesFilePath(): string {
    return this.rulesFilePath;
  }
}

export default RulesParser;
