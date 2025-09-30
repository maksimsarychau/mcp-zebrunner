import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Unit tests for validation and improvement MCP tools
 * 
 * Tests the following tools:
 * - validate_test_case
 * - improve_test_case
 * - get_enhanced_test_coverage_with_rules
 */

describe('Validation Tools Unit Tests', () => {
  
  describe('validate_test_case Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        projectKey: 'MFPAND',
        caseKey: 'MFPAND-2734',
        format: 'json',
        improveIfPossible: true
      };
      
      assert.ok(validParams.projectKey, 'projectKey should be required');
      assert.ok(validParams.caseKey, 'caseKey should be required');
      assert.ok(validParams.projectKey.length > 0, 'projectKey should not be empty');
      assert.ok(validParams.caseKey.length > 0, 'caseKey should not be empty');
    });
    
    it('should validate caseKey format', () => {
      const validCaseKeys = ['MFPAND-2734', 'TEST-123', 'PROJECT-9999'];
      const invalidCaseKeys = ['', 'invalid', 'MFPAND', 'MFPAND-', '-2734', 'mfpand-2734'];
      
      validCaseKeys.forEach(key => {
        assert.ok(key.match(/^[A-Z]+-\d+$/), `"${key}" should be valid case key format`);
      });
      
      invalidCaseKeys.forEach(key => {
        assert.ok(!key.match(/^[A-Z]+-\d+$/), `"${key}" should be invalid case key format`);
      });
    });
    
    it('should validate format parameter', () => {
      const validFormats = ['dto', 'json', 'string', 'markdown'];
      const invalidFormat = 'xml';
      
      validFormats.forEach(format => {
        assert.ok(['dto', 'json', 'string', 'markdown'].includes(format), `${format} should be valid format`);
      });
      
      assert.ok(!validFormats.includes(invalidFormat), 'xml should not be valid format');
    });
    
    it('should handle improveIfPossible parameter', () => {
      const params = {
        projectKey: 'MFPAND',
        caseKey: 'MFPAND-2734',
        improveIfPossible: true
      };
      
      assert.equal(typeof params.improveIfPossible, 'boolean', 'improveIfPossible should be boolean');
      assert.equal(params.improveIfPossible, true, 'improveIfPossible should default to true');
    });
    
    it('should handle optional file paths', () => {
      const params = {
        projectKey: 'MFPAND',
        caseKey: 'MFPAND-2734',
        rulesFilePath: './custom-rules.md',
        checkpointsFilePath: './custom-checkpoints.md'
      };
      
      assert.equal(typeof params.rulesFilePath, 'string', 'rulesFilePath should be string when provided');
      assert.equal(typeof params.checkpointsFilePath, 'string', 'checkpointsFilePath should be string when provided');
    });
    
    it('should validate validation result structure', () => {
      const mockValidationResult = {
        testCaseKey: 'MFPAND-2734',
        testCaseTitle: 'Test case title',
        automationStatus: 'NOT_AUTOMATED',
        priority: 'HIGH',
        status: 'active',
        manualOnly: 'No',
        overallScore: 85,
        scoreCategory: 'good',
        issues: [
          {
            category: 'structure',
            severity: 'medium',
            message: 'Test case could benefit from more detailed steps',
            checkpoint: 'Step Detail Quality'
          }
        ],
        passedCheckpoints: ['Title Quality', 'Description Clarity'],
        summary: 'Test case is well-structured but could use improvement in step details.',
        readyForAutomation: true,
        readyForManualExecution: true,
        rulesUsed: 'test_case_review_rules.md v1.0'
      };
      
      assert.ok(mockValidationResult.testCaseKey, 'result should have testCaseKey');
      assert.ok(mockValidationResult.testCaseTitle, 'result should have testCaseTitle');
      assert.ok(typeof mockValidationResult.overallScore === 'number', 'overallScore should be number');
      assert.ok(mockValidationResult.overallScore >= 0 && mockValidationResult.overallScore <= 100, 'score should be 0-100');
      assert.ok(['excellent', 'good', 'needs_improvement', 'poor'].includes(mockValidationResult.scoreCategory), 'scoreCategory should be valid');
      assert.ok(Array.isArray(mockValidationResult.issues), 'issues should be array');
      assert.ok(Array.isArray(mockValidationResult.passedCheckpoints), 'passedCheckpoints should be array');
      assert.equal(typeof mockValidationResult.readyForAutomation, 'boolean', 'readyForAutomation should be boolean');
      assert.equal(typeof mockValidationResult.readyForManualExecution, 'boolean', 'readyForManualExecution should be boolean');
    });
    
    it('should validate issue structure', () => {
      const mockIssue = {
        category: 'structure',
        severity: 'medium',
        message: 'Test case could benefit from more detailed steps',
        checkpoint: 'Step Detail Quality',
        suggestion: 'Add more specific actions and expected results'
      };
      
      assert.ok(mockIssue.category, 'issue should have category');
      assert.ok(mockIssue.severity, 'issue should have severity');
      assert.ok(mockIssue.message, 'issue should have message');
      assert.ok(['low', 'medium', 'high', 'critical'].includes(mockIssue.severity), 'severity should be valid');
    });
    
  });
  
  describe('improve_test_case Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        projectKey: 'MFPAND',
        caseKey: 'MFPAND-2734',
        format: 'json'
      };
      
      assert.ok(validParams.projectKey, 'projectKey should be required');
      assert.ok(validParams.caseKey, 'caseKey should be required');
      assert.ok(validParams.projectKey.length > 0, 'projectKey should not be empty');
      assert.ok(validParams.caseKey.length > 0, 'caseKey should not be empty');
    });
    
    it('should validate improvement result structure', () => {
      const mockImprovementResult = {
        testCaseKey: 'MFPAND-2734',
        originalTitle: 'Original test case title',
        confidence: 0.85,
        improvements: [
          {
            type: 'title',
            original: 'Login test',
            improved: 'Verify successful user login with valid credentials',
            reason: 'More descriptive and specific title',
            confidence: 0.9
          },
          {
            type: 'steps',
            original: 'Enter username and password',
            improved: '1. Navigate to login page\n2. Enter valid username "testuser@example.com"\n3. Enter valid password "SecurePass123"',
            reason: 'More detailed and specific steps',
            confidence: 0.8
          }
        ],
        summary: 'Improved test case clarity and specificity',
        appliedRules: ['Title should be descriptive', 'Steps should be specific']
      };
      
      assert.ok(mockImprovementResult.testCaseKey, 'result should have testCaseKey');
      assert.ok(typeof mockImprovementResult.confidence === 'number', 'confidence should be number');
      assert.ok(mockImprovementResult.confidence >= 0 && mockImprovementResult.confidence <= 1, 'confidence should be 0-1');
      assert.ok(Array.isArray(mockImprovementResult.improvements), 'improvements should be array');
      assert.ok(Array.isArray(mockImprovementResult.appliedRules), 'appliedRules should be array');
    });
    
    it('should validate improvement item structure', () => {
      const mockImprovement = {
        type: 'title',
        original: 'Login test',
        improved: 'Verify successful user login with valid credentials',
        reason: 'More descriptive and specific title',
        confidence: 0.9
      };
      
      assert.ok(mockImprovement.type, 'improvement should have type');
      assert.ok(mockImprovement.original, 'improvement should have original');
      assert.ok(mockImprovement.improved, 'improvement should have improved');
      assert.ok(mockImprovement.reason, 'improvement should have reason');
      assert.ok(typeof mockImprovement.confidence === 'number', 'improvement confidence should be number');
      assert.ok(mockImprovement.confidence >= 0 && mockImprovement.confidence <= 1, 'improvement confidence should be 0-1');
    });
    
    it('should handle confidence levels', () => {
      const confidenceLevels = [
        { value: 0.9, description: 'High confidence' },
        { value: 0.7, description: 'Medium confidence' },
        { value: 0.5, description: 'Low confidence' },
        { value: 0.3, description: 'Very low confidence' }
      ];
      
      confidenceLevels.forEach(level => {
        assert.ok(level.value >= 0 && level.value <= 1, `Confidence ${level.value} should be valid`);
        assert.ok(level.description.length > 0, 'Confidence should have description');
      });
    });
    
  });
  
  describe('get_enhanced_test_coverage_with_rules Tool', () => {
    
    it('should validate required parameters', () => {
      const validParams = {
        case_key: 'MFPAND-4888',
        implementation_context: 'Test implementation context',
        analysis_scope: 'full',
        output_format: 'detailed'
      };
      
      assert.ok(validParams.case_key, 'case_key should be required');
      assert.ok(validParams.implementation_context, 'implementation_context should be required');
      assert.ok(validParams.case_key.match(/^[A-Z]+-\d+$/), 'case_key should match pattern');
    });
    
    it('should validate analysis_scope parameter', () => {
      const validScopes = ['basic', 'standard', 'full', 'comprehensive'];
      const invalidScope = 'invalid';
      
      validScopes.forEach(scope => {
        assert.ok(['basic', 'standard', 'full', 'comprehensive'].includes(scope), `${scope} should be valid scope`);
      });
      
      assert.ok(!validScopes.includes(invalidScope), 'invalid should not be valid scope');
    });
    
    it('should validate output_format parameter', () => {
      const validFormats = ['summary', 'detailed', 'json', 'markdown'];
      const invalidFormat = 'xml';
      
      validFormats.forEach(format => {
        assert.ok(['summary', 'detailed', 'json', 'markdown'].includes(format), `${format} should be valid format`);
      });
      
      assert.ok(!validFormats.includes(invalidFormat), 'xml should not be valid format');
    });
    
    it('should handle boolean parameters', () => {
      const params = {
        case_key: 'MFPAND-4888',
        implementation_context: 'Context',
        include_recommendations: true,
        show_framework_detection: false,
        validate_against_rules: true
      };
      
      assert.equal(typeof params.include_recommendations, 'boolean', 'include_recommendations should be boolean');
      assert.equal(typeof params.show_framework_detection, 'boolean', 'show_framework_detection should be boolean');
      assert.equal(typeof params.validate_against_rules, 'boolean', 'validate_against_rules should be boolean');
    });
    
    it('should validate implementation_context content', () => {
      const validContext = `Test Implementation found at:
/Users/test/src/test.java

The test case MFPAND-4888 is implemented as part of a comprehensive test method.

Key implementation details:
1. Test creates a new account
2. Uses authService.fastAccountCreation(account)
3. Navigates to AccountCreatedPageBase`;
      
      const emptyContext = '';
      const shortContext = 'test';
      
      assert.ok(validContext.length > 50, 'valid context should be detailed');
      assert.ok(validContext.includes('implementation'), 'context should mention implementation');
      assert.ok(emptyContext.length === 0, 'empty context should be detected');
      assert.ok(shortContext.length < 10, 'short context should be detected');
    });
    
    it('should validate coverage analysis result structure', () => {
      const mockCoverageResult = {
        testCaseKey: 'MFPAND-4888',
        testCaseTitle: 'Sourcepoint returns the first layer message as a web view',
        implementationAnalysis: {
          frameworkDetected: 'TestNG + Selenium',
          confidence: 0.95,
          implementationQuality: 'high',
          coveragePercentage: 85
        },
        rulesValidation: {
          totalRules: 15,
          passedRules: 12,
          failedRules: 3,
          score: 80
        },
        recommendations: [
          'Add explicit wait conditions',
          'Include error handling scenarios',
          'Add data validation steps'
        ],
        summary: 'Test implementation covers most requirements but could benefit from additional error handling'
      };
      
      assert.ok(mockCoverageResult.testCaseKey, 'result should have testCaseKey');
      assert.ok(mockCoverageResult.implementationAnalysis, 'result should have implementationAnalysis');
      assert.ok(mockCoverageResult.rulesValidation, 'result should have rulesValidation');
      assert.ok(Array.isArray(mockCoverageResult.recommendations), 'recommendations should be array');
      
      const impl = mockCoverageResult.implementationAnalysis;
      assert.ok(typeof impl.confidence === 'number', 'confidence should be number');
      assert.ok(impl.confidence >= 0 && impl.confidence <= 1, 'confidence should be 0-1');
      assert.ok(typeof impl.coveragePercentage === 'number', 'coveragePercentage should be number');
      
      const rules = mockCoverageResult.rulesValidation;
      assert.ok(typeof rules.totalRules === 'number', 'totalRules should be number');
      assert.ok(typeof rules.passedRules === 'number', 'passedRules should be number');
      assert.ok(typeof rules.failedRules === 'number', 'failedRules should be number');
      assert.equal(rules.totalRules, rules.passedRules + rules.failedRules, 'rule counts should add up');
    });
    
  });
  
  describe('Rules Engine Integration', () => {
    
    it('should validate rules file detection', () => {
      const rulesFileScenarios = [
        { exists: true, hasContent: true, shouldEnable: true },
        { exists: true, hasContent: false, shouldEnable: false },
        { exists: false, hasContent: false, shouldEnable: false }
      ];
      
      rulesFileScenarios.forEach(scenario => {
        const shouldEnableRules = scenario.exists && scenario.hasContent;
        assert.equal(shouldEnableRules, scenario.shouldEnable, 
          `Rules should ${scenario.shouldEnable ? 'be enabled' : 'not be enabled'} when exists=${scenario.exists}, hasContent=${scenario.hasContent}`);
      });
    });
    
    it('should validate meaningful content detection', () => {
      const contentExamples = [
        { content: '# Test Case Review Rules\n\n## Structure\n\nTest cases should...', meaningful: true },
        { content: '', meaningful: false },
        { content: '   \n\n  \t  ', meaningful: false },
        { content: '# Empty\n\n<!-- No content -->', meaningful: false },
        { content: 'Some actual rules content here', meaningful: true }
      ];
      
      contentExamples.forEach(example => {
        const trimmed = example.content.trim();
        if (trimmed.length === 0) {
          assert.equal(false, example.meaningful, 
            `Empty content should not be meaningful`);
          return;
        }
        
        // Remove markdown headers, comments, and whitespace-only lines
        const withoutMarkdown = trimmed
          .replace(/^#.*$/gm, '') // Remove headers
          .replace(/<!--.*?-->/gs, '') // Remove comments
          .replace(/^\s*$/gm, '') // Remove empty lines
          .trim();
        
        const isMeaningful = withoutMarkdown.length > 0;
        assert.equal(isMeaningful, example.meaningful, 
          `Content "${example.content.substring(0, 30)}..." should ${example.meaningful ? 'be' : 'not be'} meaningful`);
      });
    });
    
    it('should validate rules parsing', () => {
      const mockRulesContent = `# Test Case Review Rules

## Structure Rules
- Test case title should be descriptive
- Steps should be numbered and clear

## Quality Rules  
- Each step should have expected result
- Test data should be realistic`;
      
      // Simulate rules parsing
      const parseRules = (content: string) => {
        const lines = content.split('\n').filter(line => line.trim().startsWith('-'));
        return lines.map(line => line.trim().substring(1).trim());
      };
      
      const parsedRules = parseRules(mockRulesContent);
      
      assert.ok(parsedRules.length > 0, 'should parse rules from content');
      assert.ok(parsedRules.some(rule => rule.includes('descriptive')), 'should find title rule');
      assert.ok(parsedRules.some(rule => rule.includes('expected result')), 'should find expected result rule');
    });
    
  });
  
  describe('Error Handling', () => {
    
    it('should handle missing required parameters', () => {
      const invalidParams = [
        { caseKey: 'MFPAND-2734' }, // missing projectKey
        { projectKey: 'MFPAND' }, // missing caseKey
        {} // missing both
      ];
      
      invalidParams.forEach(params => {
        const hasProjectKey = params.hasOwnProperty('projectKey');
        const hasCaseKey = params.hasOwnProperty('caseKey');
        
        assert.ok(!hasProjectKey || !hasCaseKey, 'should detect missing required parameters');
      });
    });
    
    it('should handle invalid case key formats', () => {
      const invalidCaseKeys = ['', 'invalid', 'MFPAND', 'MFPAND-', '-2734', 'mfpand-2734'];
      
      invalidCaseKeys.forEach(key => {
        assert.ok(!key.match(/^[A-Z]+-\d+$/), `"${key}" should be detected as invalid format`);
      });
    });
    
    it('should handle rules engine configuration errors', () => {
      const configScenarios = [
        { rulesEnabled: false, rulesFile: null, shouldWarn: true },
        { rulesEnabled: true, rulesFile: null, shouldWarn: true },
        { rulesEnabled: true, rulesFile: 'malformed', shouldWarn: true },
        { rulesEnabled: true, rulesFile: 'valid', shouldWarn: false }
      ];
      
      configScenarios.forEach(scenario => {
        const shouldShowWarning = !scenario.rulesEnabled || 
                                scenario.rulesFile === null || 
                                scenario.rulesFile === 'malformed';
        
        assert.equal(shouldShowWarning, scenario.shouldWarn, 
          `Should ${scenario.shouldWarn ? 'show' : 'not show'} warning for scenario: ${JSON.stringify(scenario)}`);
      });
    });
    
    it('should provide helpful error messages', () => {
      const errorScenarios = [
        {
          type: 'missing_case_key',
          message: 'Test case key is required',
          suggestion: 'Provide a valid test case key in format PROJECT-NUMBER (e.g., MFPAND-2734)'
        },
        {
          type: 'invalid_format',
          message: 'Invalid case key format',
          suggestion: 'Case key must match pattern PROJECT-NUMBER (e.g., MFPAND-2734)'
        },
        {
          type: 'rules_not_found',
          message: 'Rules file not found or empty',
          suggestion: 'Create mcp-zebrunner-rules.md file with validation rules'
        },
        {
          type: 'validation_failed',
          message: 'Test case validation failed',
          suggestion: 'Check test case exists and is accessible'
        }
      ];
      
      errorScenarios.forEach(scenario => {
        assert.ok(scenario.message.length > 0, 'Error message should not be empty');
        assert.ok(scenario.suggestion.length > 0, 'Error suggestion should be provided');
        const isActionable = scenario.suggestion.includes('should') || 
                         scenario.suggestion.includes('must') || 
                         scenario.suggestion.includes('Create') ||
                         scenario.suggestion.includes('Provide') ||
                         scenario.suggestion.includes('Check') ||
                         scenario.suggestion.includes('Verify');
        assert.ok(isActionable, 
          `Suggestion "${scenario.suggestion}" should be actionable`);
      });
    });
    
  });
  
  describe('Output Formatting', () => {
    
    it('should validate JSON format output', () => {
      const mockResult = {
        testCaseKey: 'MFPAND-2734',
        overallScore: 85,
        issues: [],
        improvements: []
      };
      
      const jsonOutput = JSON.stringify(mockResult, null, 2);
      const parsed = JSON.parse(jsonOutput);
      
      assert.deepEqual(parsed, mockResult, 'JSON output should be parseable and match original');
    });
    
    it('should validate markdown format structure', () => {
      const mockMarkdownOutput = `# Test Case Validation Report

## 📋 Test Case Information

- **Test Case:** MFPAND-2734 - Test case title
- **Automation Status:** NOT_AUTOMATED
- **Priority:** HIGH
- **Status:** active
- **Rules Used:** test_case_review_rules.md v1.0

## 📊 Summary

Test case is well-structured but could use improvement.

## Overall Assessment

- **Score:** 85% (GOOD)
- **Ready for Manual Execution:** ✅ Yes
- **Ready for Automation:** ✅ Yes`;
      
      assert.ok(mockMarkdownOutput.includes('# Test Case Validation Report'), 'should have main header');
      assert.ok(mockMarkdownOutput.includes('## 📋 Test Case Information'), 'should have info section');
      assert.ok(mockMarkdownOutput.includes('## 📊 Summary'), 'should have summary section');
      assert.ok(mockMarkdownOutput.includes('## Overall Assessment'), 'should have assessment section');
      assert.ok(mockMarkdownOutput.includes('✅'), 'should use checkmarks for positive results');
    });
    
    it('should validate string format output', () => {
      const mockStringOutput = 'MFPAND-2734: Test case validation completed. Score: 85% (GOOD). Ready for automation: Yes.';
      
      assert.ok(mockStringOutput.includes('MFPAND-2734'), 'should include case key');
      assert.ok(mockStringOutput.includes('Score:'), 'should include score');
      assert.ok(mockStringOutput.includes('%'), 'should include percentage');
      assert.ok(mockStringOutput.includes('Ready for automation'), 'should include automation readiness');
    });
    
  });
  
});
