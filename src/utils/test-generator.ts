import { ZebrunnerTestCase } from '../types/core.js';
import { RulesParser, FrameworkConfig, RulesConfig } from './rules-parser.js';

/**
 * Template variables for test generation
 */
export interface TemplateVariables {
  TEST_DESCRIPTION: string;
  TEST_METHOD_NAME: string;
  TEST_SUITE_NAME: string;
  SETUP_CODE: string;
  TEARDOWN_CODE: string;
  STEPS: Array<{
    index: number;
    action: string;
    expectedResult: string;
    stepCode: string;
    validationCode: string;
  }>;
  [key: string]: any;
}

/**
 * Test generation options
 */
export interface TestGenerationOptions {
  framework?: string; // Force specific framework
  outputFormat: 'code' | 'markdown' | 'comments' | 'all';
  includeSetupTeardown: boolean;
  includeAssertionTemplates: boolean;
  generatePageObjects: boolean;
  includeDataProviders: boolean;
  customVariables?: { [key: string]: any };
}

/**
 * Generated test result
 */
export interface GeneratedTest {
  framework: string;
  testCode: string;
  setupCode?: string;
  teardownCode?: string;
  pageObjectCode?: string;
  dataProviderCode?: string;
  imports: string[];
  recommendations: string[];
  qualityScore: number;
}

/**
 * Test generator utility for creating draft tests from Zebrunner test cases
 */
export class TestGenerator {
  private rulesParser: RulesParser;

  constructor() {
    this.rulesParser = RulesParser.getInstance();
  }

  /**
   * Generates draft test code based on test case and implementation context
   */
  public async generateTest(
    testCase: ZebrunnerTestCase,
    implementationContext: string,
    options: TestGenerationOptions
  ): Promise<GeneratedTest> {
    const rules = await this.rulesParser.getRules();
    
    // Detect or use specified framework
    let framework: FrameworkConfig | null = null;
    if (options.framework) {
      framework = rules.frameworks.find(f => f.name === options.framework) || null;
    } else {
      framework = await this.rulesParser.detectFramework(implementationContext);
    }

    if (!framework) {
      // Default to Java/Carina if no framework detected
      framework = rules.frameworks.find(f => f.name === 'java-carina') || rules.frameworks[0];
    }

    // Generate template variables
    const templateVars = await this.generateTemplateVariables(
      testCase,
      implementationContext,
      framework,
      rules,
      options
    );

    // Generate test code
    const testCode = this.renderTemplate(
      framework.templates.testMethod || framework.templates.testSuite || '',
      templateVars
    );

    // Generate additional components
    const setupCode = options.includeSetupTeardown ? 
      this.generateSetupCode(framework, implementationContext, rules) : undefined;
    
    const teardownCode = options.includeSetupTeardown ? 
      this.generateTeardownCode(framework, implementationContext, rules) : undefined;

    const pageObjectCode = options.generatePageObjects ? 
      this.generatePageObjectCode(testCase, framework, implementationContext) : undefined;

    const dataProviderCode = options.includeDataProviders ? 
      this.generateDataProviderCode(testCase, framework) : undefined;

    // Generate imports
    const imports = this.generateImports(framework, implementationContext, options);

    // Generate recommendations
    const recommendations = this.generateRecommendations(testCase, framework, rules, implementationContext);

    // Calculate quality score
    const qualityScore = this.calculateQualityScore(testCode, framework, rules);

    return {
      framework: framework.name,
      testCode,
      setupCode,
      teardownCode,
      pageObjectCode,
      dataProviderCode,
      imports,
      recommendations,
      qualityScore,
    };
  }

  /**
   * Generates template variables from test case and context
   */
  private async generateTemplateVariables(
    testCase: ZebrunnerTestCase,
    implementationContext: string,
    framework: FrameworkConfig,
    rules: RulesConfig,
    options: TestGenerationOptions
  ): Promise<TemplateVariables> {
    const testMethodName = this.generateTestMethodName(testCase.title || testCase.key || 'UnknownTest');
    const testSuiteName = this.generateTestSuiteName(testCase.testSuite?.name || 'TestSuite');

    const steps = testCase.steps?.map((step, index) => ({
      index: index + 1,
      action: step.action || '',
      expectedResult: step.expectedResult || '',
      stepCode: this.generateStepCode(step.action || '', framework, implementationContext, rules),
      validationCode: this.generateValidationCode(step.expectedResult || '', framework, implementationContext, rules),
    })) || [];

    const setupCode = this.generateSetupCode(framework, implementationContext, rules);
    const teardownCode = this.generateTeardownCode(framework, implementationContext, rules);

    return {
      TEST_DESCRIPTION: testCase.title || testCase.key || 'Unknown Test',
      TEST_METHOD_NAME: testMethodName,
      TEST_SUITE_NAME: testSuiteName,
      SETUP_CODE: setupCode,
      TEARDOWN_CODE: teardownCode,
      STEPS: steps,
      ...options.customVariables,
    };
  }

  /**
   * Generates test method name from title
   */
  private generateTestMethodName(title: string): string {
    return title
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(' ')
      .map((word, index) => 
        index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join('')
      .replace(/^/, 'test');
  }

  /**
   * Generates test suite name from suite name
   */
  private generateTestSuiteName(suiteName: string): string {
    return suiteName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Generates step implementation code
   */
  private generateStepCode(
    action: string,
    framework: FrameworkConfig,
    implementationContext: string,
    rules: RulesConfig
  ): string {
    const actionLower = action.toLowerCase();

    // Check for common patterns
    for (const [patternName, pattern] of Object.entries(rules.quality.patterns)) {
      if (this.matchesPattern(actionLower, patternName)) {
        return this.applyPattern(action, pattern.pattern, framework);
      }
    }

    // Framework-specific generation
    if (framework.name.includes('java')) {
      return this.generateJavaStepCode(action, implementationContext);
    } else if (framework.name.includes('javascript')) {
      return this.generateJavaScriptStepCode(action, implementationContext);
    }

    return `// TODO: Implement step: ${action}`;
  }

  /**
   * Generates validation code for expected results
   */
  private generateValidationCode(
    expectedResult: string,
    framework: FrameworkConfig,
    implementationContext: string,
    rules: RulesConfig
  ): string {
    const expectedLower = expectedResult.toLowerCase();

    // Check for common validation patterns
    for (const [patternName, pattern] of Object.entries(rules.quality.patterns)) {
      if (this.matchesValidationPattern(expectedLower, patternName)) {
        return this.applyPattern(expectedResult, pattern.validation, framework);
      }
    }

    // Framework-specific validation
    if (framework.name.includes('java')) {
      return this.generateJavaValidationCode(expectedResult, implementationContext);
    } else if (framework.name.includes('javascript')) {
      return this.generateJavaScriptValidationCode(expectedResult, implementationContext);
    }

    return `// TODO: Validate: ${expectedResult}`;
  }

  /**
   * Generates setup code
   */
  private generateSetupCode(
    framework: FrameworkConfig,
    implementationContext: string,
    rules: RulesConfig
  ): string {
    if (framework.name.includes('java')) {
      return `// Test setup
WebDriver driver = getDriver();
HomePage homePage = new HomePage(driver);`;
    } else if (framework.name.includes('javascript')) {
      return `// Test setup
const page = await browser.newPage();
await page.goto(process.env.BASE_URL);`;
    }
    return '// TODO: Add test setup';
  }

  /**
   * Generates teardown code
   */
  private generateTeardownCode(
    framework: FrameworkConfig,
    implementationContext: string,
    rules: RulesConfig
  ): string {
    if (framework.name.includes('java')) {
      return `// Test cleanup
// Driver cleanup handled by framework`;
    } else if (framework.name.includes('javascript')) {
      return `// Test cleanup
await page.close();`;
    }
    return '// TODO: Add test cleanup';
  }

  /**
   * Generates Java-specific step code
   */
  private generateJavaStepCode(action: string, implementationContext: string): string {
    const actionLower = action.toLowerCase();

    if (actionLower.includes('login')) {
      return `LoginPage loginPage = new LoginPage(driver);
loginPage.login(testUser.getUsername(), testUser.getPassword());`;
    }

    if (actionLower.includes('tap') || actionLower.includes('click')) {
      const elementName = this.extractElementName(action);
      return `${elementName}Element.click();`;
    }

    if (actionLower.includes('navigate') || actionLower.includes('go to')) {
      const screenName = this.extractScreenName(action);
      return `${screenName}Page ${screenName.toLowerCase()}Page = new ${screenName}Page(driver);
${screenName.toLowerCase()}Page.open();`;
    }

    return `// TODO: Implement Java action: ${action}`;
  }

  /**
   * Generates JavaScript-specific step code
   */
  private generateJavaScriptStepCode(action: string, implementationContext: string): string {
    const actionLower = action.toLowerCase();

    if (actionLower.includes('login')) {
      return `await loginPage.login(testData.username, testData.password);`;
    }

    if (actionLower.includes('click') || actionLower.includes('tap')) {
      const elementName = this.extractElementName(action);
      return `await page.click('[data-testid="${elementName.toLowerCase()}"]');`;
    }

    if (actionLower.includes('navigate') || actionLower.includes('go to')) {
      const screenName = this.extractScreenName(action);
      return `await page.goto('/screens/${screenName.toLowerCase()}');`;
    }

    return `// TODO: Implement JavaScript action: ${action}`;
  }

  /**
   * Generates Java-specific validation code
   */
  private generateJavaValidationCode(expectedResult: string, implementationContext: string): string {
    const expectedLower = expectedResult.toLowerCase();

    if (expectedLower.includes('screen') || expectedLower.includes('page')) {
      const screenName = this.extractScreenName(expectedResult);
      return `Assert.assertTrue(${screenName.toLowerCase()}Page.isOpened(), "Expected ${screenName} page to be displayed");`;
    }

    if (expectedLower.includes('visible') || expectedLower.includes('displayed')) {
      const elementName = this.extractElementName(expectedResult);
      return `Assert.assertTrue(${elementName}Element.isDisplayed(), "Expected ${elementName} element to be visible");`;
    }

    return `// TODO: Implement Java validation: ${expectedResult}`;
  }

  /**
   * Generates JavaScript-specific validation code
   */
  private generateJavaScriptValidationCode(expectedResult: string, implementationContext: string): string {
    const expectedLower = expectedResult.toLowerCase();

    if (expectedLower.includes('screen') || expectedLower.includes('page')) {
      const screenName = this.extractScreenName(expectedResult);
      return `expect(page.url()).toContain('/${screenName.toLowerCase()}');`;
    }

    if (expectedLower.includes('visible') || expectedLower.includes('displayed')) {
      const elementName = this.extractElementName(expectedResult);
      return `await expect(page.locator('[data-testid="${elementName.toLowerCase()}"]')).toBeVisible();`;
    }

    return `// TODO: Implement JavaScript validation: ${expectedResult}`;
  }

  /**
   * Extracts element name from text
   */
  private extractElementName(text: string): string {
    const matches = text.match(/"([^"]+)"/);
    if (matches) {
      return matches[1].replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    }
    return 'element';
  }

  /**
   * Extracts screen name from text
   */
  private extractScreenName(text: string): string {
    const matches = text.match(/"([^"]+)"/);
    if (matches) {
      return matches[1].replace(/\s+/g, '');
    }
    return 'Screen';
  }

  /**
   * Renders template with variables
   */
  private renderTemplate(template: string, variables: TemplateVariables): string {
    let result = template;

    // Replace simple variables
    for (const [key, value] of Object.entries(variables)) {
      if (typeof value === 'string') {
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
    }

    // Handle each loops
    const eachRegex = /{{#each\s+(\w+)}}([\s\S]*?){{\/each}}/g;
    result = result.replace(eachRegex, (match, arrayName, loopTemplate) => {
      const array = variables[arrayName];
      if (Array.isArray(array)) {
        return array.map((item, index) => {
          let itemTemplate = loopTemplate;
          itemTemplate = itemTemplate.replace(/{{@index}}/g, index.toString());
          for (const [key, value] of Object.entries(item)) {
            itemTemplate = itemTemplate.replace(new RegExp(`{{this\\.${key}}}`, 'g'), String(value));
          }
          return itemTemplate;
        }).join('\n');
      }
      return '';
    });

    return result;
  }

  /**
   * Generates imports based on framework and context
   */
  private generateImports(
    framework: FrameworkConfig,
    implementationContext: string,
    options: TestGenerationOptions
  ): string[] {
    const imports: string[] = [];

    if (framework.name.includes('java')) {
      imports.push(
        'import org.testng.Assert;',
        'import org.testng.annotations.Test;',
        'import com.qaprosoft.carina.core.foundation.AbstractTest;',
        'import org.openqa.selenium.WebDriver;'
      );
    } else if (framework.name.includes('javascript')) {
      imports.push(
        "import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';",
        "import { Page } from 'playwright';"
      );
    }

    return imports;
  }

  /**
   * Generates page object code
   */
  private generatePageObjectCode(
    testCase: ZebrunnerTestCase,
    framework: FrameworkConfig,
    implementationContext: string
  ): string {
    const className = `${testCase.testSuite?.name || 'Test'}Page`;

    if (framework.name.includes('java')) {
      return `public class ${className} extends AbstractPage {
    public ${className}(WebDriver driver) {
        super(driver);
    }
    
    // TODO: Add page elements and methods
}`;
    } else if (framework.name.includes('javascript')) {
      return `class ${className} {
    constructor(page) {
        this.page = page;
    }
    
    // TODO: Add page methods
}

export default ${className};`;
    }

    return `// TODO: Generate page object for ${className}`;
  }

  /**
   * Generates data provider code
   */
  private generateDataProviderCode(testCase: ZebrunnerTestCase, framework: FrameworkConfig): string {
    if (framework.name.includes('java')) {
      return `@DataProvider(name = "testData")
public Object[][] testDataProvider() {
    return new Object[][] {
        // TODO: Add test data
    };
}`;
    } else if (framework.name.includes('javascript')) {
      return `const testData = [
    // TODO: Add test data
];

export default testData;`;
    }

    return '// TODO: Generate data provider';
  }

  /**
   * Generates recommendations for the generated test
   */
  private generateRecommendations(
    testCase: ZebrunnerTestCase,
    framework: FrameworkConfig,
    rules: RulesConfig,
    implementationContext: string
  ): string[] {
    const recommendations: string[] = [];

    if (testCase.steps && testCase.steps.length > 5) {
      recommendations.push('📋 Consider breaking this test into smaller, more focused tests');
    }

    if (rules.coverage.required.errorHandling) {
      recommendations.push('⚠️ Add error handling and negative test scenarios');
    }

    if (rules.coverage.required.uiElements) {
      recommendations.push('🎯 Ensure all UI interactions have proper element validations');
    }

    if (rules.coverage.required.apiCalls) {
      recommendations.push('🔗 Add API response validations where applicable');
    }

    recommendations.push('🧪 Review generated code and customize for your specific implementation');
    recommendations.push('📝 Add meaningful assertions and error messages');
    recommendations.push('🔧 Consider adding test data management and cleanup');

    return recommendations;
  }

  /**
   * Calculates quality score for generated test
   */
  private calculateQualityScore(testCode: string, framework: FrameworkConfig, rules: RulesConfig): number {
    let score = 50; // Base score

    // Check for assertions
    const assertionCount = (testCode.match(/Assert\.|expect\(/g) || []).length;
    score += Math.min(assertionCount * 10, 30);

    // Check for proper setup/teardown
    if (testCode.includes('setUp') || testCode.includes('beforeEach')) score += 10;
    if (testCode.includes('tearDown') || testCode.includes('afterEach')) score += 10;

    // Check for meaningful names
    if (testCode.includes('TODO')) score -= 10;

    // Check for error handling
    if (testCode.includes('try') || testCode.includes('catch')) score += 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Helper methods for pattern matching
   */
  private matchesPattern(text: string, patternName: string): boolean {
    const patterns = {
      login: ['login', 'sign in', 'authenticate'],
      navigation: ['navigate', 'go to', 'open', 'tap'],
      formInteraction: ['fill', 'enter', 'input', 'type'],
    };

    const keywords = patterns[patternName as keyof typeof patterns] || [];
    return keywords.some(keyword => text.includes(keyword));
  }

  private matchesValidationPattern(text: string, patternName: string): boolean {
    const patterns = {
      login: ['authenticated', 'logged in', 'user'],
      navigation: ['screen', 'page', 'displayed', 'visible'],
      formInteraction: ['value', 'filled', 'entered'],
    };

    const keywords = patterns[patternName as keyof typeof patterns] || [];
    return keywords.some(keyword => text.includes(keyword));
  }

  private applyPattern(text: string, pattern: string, framework: FrameworkConfig): string {
    // Simple pattern application - could be enhanced with more sophisticated templating
    return pattern.replace(/{{(\w+)}}/g, (match, variable) => {
      if (variable === 'UserType') return 'Premium';
      if (variable === 'ScreenName') return this.extractScreenName(text);
      if (variable === 'FieldName') return this.extractElementName(text);
      return variable;
    });
  }
}

export default TestGenerator;
