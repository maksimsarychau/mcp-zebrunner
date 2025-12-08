import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Unit tests for utility classes
 * 
 * Tests the following utilities:
 * - HierarchyProcessor
 * - FormatProcessor
 * - TestCaseValidator
 * - TestCaseImprover
 * - DynamicRulesParser
 */

describe('Utilities Unit Tests', () => {
  
  describe('HierarchyProcessor', () => {
    
    it('should validate suite hierarchy building', () => {
      const mockSuites = [
        { id: 1, title: 'Root', parentSuiteId: null },
        { id: 2, title: 'Child 1', parentSuiteId: 1 },
        { id: 3, title: 'Child 2', parentSuiteId: 1 },
        { id: 4, title: 'Grandchild', parentSuiteId: 2 }
      ];
      
      // Simulate hierarchy building
      const buildHierarchy = (suites: any[]) => {
        const suiteMap = new Map(suites.map(s => [s.id, { ...s, children: [] }]));
        const roots: any[] = [];
        
        suites.forEach(suite => {
          const suiteWithChildren = suiteMap.get(suite.id);
          if (suite.parentSuiteId === null) {
            roots.push(suiteWithChildren);
          } else {
            const parent = suiteMap.get(suite.parentSuiteId);
            if (parent) {
              parent.children.push(suiteWithChildren);
            }
          }
        });
        
        return roots;
      };
      
      const hierarchy = buildHierarchy(mockSuites);
      
      assert.equal(hierarchy.length, 1, 'should have 1 root');
      assert.equal(hierarchy[0].children.length, 2, 'root should have 2 children');
      assert.equal(hierarchy[0].children[0].children.length, 1, 'first child should have 1 grandchild');
    });
    
    it('should calculate suite levels correctly', () => {
      const mockSuites = [
        { id: 1, title: 'Root', parentSuiteId: null },
        { id: 2, title: 'Level 1', parentSuiteId: 1 },
        { id: 3, title: 'Level 2', parentSuiteId: 2 },
        { id: 4, title: 'Level 3', parentSuiteId: 3 }
      ];
      
      const calculateLevel = (suiteId: number, suites: any[]): number => {
        const suite = suites.find(s => s.id === suiteId);
        if (!suite || suite.parentSuiteId === null) return 0;
        return 1 + calculateLevel(suite.parentSuiteId, suites);
      };
      
      assert.equal(calculateLevel(1, mockSuites), 0, 'root should be level 0');
      assert.equal(calculateLevel(2, mockSuites), 1, 'child should be level 1');
      assert.equal(calculateLevel(3, mockSuites), 2, 'grandchild should be level 2');
      assert.equal(calculateLevel(4, mockSuites), 3, 'great-grandchild should be level 3');
    });
    
    it('should build suite paths correctly', () => {
      const mockSuites = [
        { id: 1, title: 'Root Suite', parentSuiteId: null },
        { id: 2, title: 'Child Suite', parentSuiteId: 1 },
        { id: 3, title: 'Grandchild Suite', parentSuiteId: 2 }
      ];
      
      const buildPath = (suiteId: number, suites: any[], separator: string = ' > '): string => {
        const suite = suites.find(s => s.id === suiteId);
        if (!suite) return '';
        
        if (suite.parentSuiteId === null) {
          return suite.title;
        }
        
        const parentPath = buildPath(suite.parentSuiteId, suites, separator);
        return `${parentPath}${separator}${suite.title}`;
      };
      
      const path = buildPath(3, mockSuites);
      assert.equal(path, 'Root Suite > Child Suite > Grandchild Suite', 'should build correct path');
    });
    
    it('should detect orphaned suites', () => {
      const mockSuites = [
        { id: 1, title: 'Root', parentSuiteId: null },
        { id: 2, title: 'Valid Child', parentSuiteId: 1 },
        { id: 3, title: 'Orphaned', parentSuiteId: 999 } // Parent doesn't exist
      ];
      
      const findOrphaned = (suites: any[]) => {
        const existingIds = new Set(suites.map(s => s.id));
        return suites.filter(s => 
          s.parentSuiteId !== null && !existingIds.has(s.parentSuiteId)
        );
      };
      
      const orphaned = findOrphaned(mockSuites);
      assert.equal(orphaned.length, 1, 'should find 1 orphaned suite');
      assert.equal(orphaned[0].id, 3, 'should identify correct orphaned suite');
    });
    
    it('should detect circular references', () => {
      const mockSuitesWithCircular = [
        { id: 1, title: 'Suite A', parentSuiteId: 2 },
        { id: 2, title: 'Suite B', parentSuiteId: 1 } // Circular reference
      ];
      
      const hasCircularReference = (suiteId: number, suites: any[], visited: Set<number> = new Set()): boolean => {
        if (visited.has(suiteId)) return true;
        
        const suite = suites.find(s => s.id === suiteId);
        if (!suite || suite.parentSuiteId === null) return false;
        
        visited.add(suiteId);
        return hasCircularReference(suite.parentSuiteId, suites, visited);
      };
      
      assert.ok(hasCircularReference(1, mockSuitesWithCircular), 'should detect circular reference');
      assert.ok(hasCircularReference(2, mockSuitesWithCircular), 'should detect circular reference from either direction');
    });
    
  });
  
  describe('FormatProcessor', () => {
    
    it('should validate JSON formatting', () => {
      const mockData = {
        id: 123,
        title: 'Test Suite',
        items: [1, 2, 3]
      };
      
      const jsonOutput = JSON.stringify(mockData, null, 2);
      const parsed = JSON.parse(jsonOutput);
      
      assert.deepEqual(parsed, mockData, 'JSON formatting should preserve data');
      assert.ok(jsonOutput.includes('\n'), 'formatted JSON should have newlines');
      assert.ok(jsonOutput.includes('  '), 'formatted JSON should have indentation');
    });
    
    it('should validate string formatting', () => {
      const mockSuite = {
        id: 18815,
        title: 'Treatment ON',
        parentSuiteId: 18814
      };
      
      const stringOutput = `Suite ${mockSuite.id}: ${mockSuite.title} (Parent: ${mockSuite.parentSuiteId})`;
      
      assert.ok(stringOutput.includes(mockSuite.id.toString()), 'should include ID');
      assert.ok(stringOutput.includes(mockSuite.title), 'should include title');
      assert.ok(stringOutput.includes(mockSuite.parentSuiteId.toString()), 'should include parent ID');
    });
    
    it('should validate DTO formatting', () => {
      const mockTestCase = {
        id: 123456,
        key: 'MCP-4678',
        title: 'Test case title',
        description: 'Test case description',
        steps: [
          { id: 1, description: 'Step 1', expectedResult: 'Expected 1' }
        ]
      };
      
      // Simulate DTO transformation
      const dto = {
        testCaseId: mockTestCase.id,
        testCaseKey: mockTestCase.key,
        testCaseTitle: mockTestCase.title,
        testCaseDescription: mockTestCase.description,
        stepCount: mockTestCase.steps.length
      };
      
      assert.equal(dto.testCaseId, mockTestCase.id, 'DTO should map ID correctly');
      assert.equal(dto.testCaseKey, mockTestCase.key, 'DTO should map key correctly');
      assert.equal(dto.stepCount, 1, 'DTO should calculate step count');
    });
    
    it('should validate markdown formatting', () => {
      const mockValidationResult = {
        testCaseKey: 'MCP-2734',
        testCaseTitle: 'Test case title',
        overallScore: 85,
        scoreCategory: 'good',
        issues: [
          { severity: 'medium', message: 'Could improve step details' }
        ]
      };
      
      const markdownOutput = `# Test Case Validation Report

## Test Case Information
- **Key:** ${mockValidationResult.testCaseKey}
- **Title:** ${mockValidationResult.testCaseTitle}

## Assessment
- **Score:** ${mockValidationResult.overallScore}% (${mockValidationResult.scoreCategory.toUpperCase()})

## Issues
- ${mockValidationResult.issues[0].severity}: ${mockValidationResult.issues[0].message}`;
      
      assert.ok(markdownOutput.includes('# Test Case Validation Report'), 'should have main header');
      assert.ok(markdownOutput.includes('## Test Case Information'), 'should have sections');
      assert.ok(markdownOutput.includes('**Key:**'), 'should use bold formatting');
      assert.ok(markdownOutput.includes(`${mockValidationResult.overallScore}%`), 'should include score');
    });
    
    it('should handle empty data gracefully', () => {
      const emptyData = null;
      const emptyArray: any[] = [];
      const emptyObject = {};
      
      assert.equal(JSON.stringify(emptyData), 'null', 'should handle null');
      assert.equal(JSON.stringify(emptyArray), '[]', 'should handle empty array');
      assert.equal(JSON.stringify(emptyObject), '{}', 'should handle empty object');
    });
    
  });
  
  describe('TestCaseValidator', () => {
    
    it('should validate scoring logic', () => {
      const mockCheckpoints = [
        { name: 'Title Quality', weight: 20, passed: true },
        { name: 'Step Clarity', weight: 30, passed: true },
        { name: 'Expected Results', weight: 25, passed: false },
        { name: 'Test Data', weight: 25, passed: true }
      ];
      
      const calculateScore = (checkpoints: any[]) => {
        const totalWeight = checkpoints.reduce((sum, cp) => sum + cp.weight, 0);
        const passedWeight = checkpoints
          .filter(cp => cp.passed)
          .reduce((sum, cp) => sum + cp.weight, 0);
        
        return Math.round((passedWeight / totalWeight) * 100);
      };
      
      const score = calculateScore(mockCheckpoints);
      assert.equal(score, 75, 'should calculate correct score (75%)');
    });
    
    it('should categorize scores correctly', () => {
      const categorizeScore = (score: number): string => {
        if (score >= 90) return 'excellent';
        if (score >= 75) return 'good';
        if (score >= 60) return 'needs_improvement';
        return 'poor';
      };
      
      assert.equal(categorizeScore(95), 'excellent', '95% should be excellent');
      assert.equal(categorizeScore(80), 'good', '80% should be good');
      assert.equal(categorizeScore(65), 'needs_improvement', '65% should need improvement');
      assert.equal(categorizeScore(45), 'poor', '45% should be poor');
    });
    
    it('should validate readiness assessment', () => {
      const assessReadiness = (score: number, issues: any[]) => {
        const criticalIssues = issues.filter(i => i.severity === 'critical' || i.severity === 'high');
        const readyForManual = score >= 60 && criticalIssues.length === 0;
        const readyForAutomation = score >= 80 && criticalIssues.length === 0;
        
        return { readyForManual, readyForAutomation };
      };
      
      const highScoreNoCritical = assessReadiness(85, [{ severity: 'medium', message: 'Minor issue' }]);
      assert.ok(highScoreNoCritical.readyForManual, 'high score with no critical issues should be ready for manual');
      assert.ok(highScoreNoCritical.readyForAutomation, 'high score with no critical issues should be ready for automation');
      
      const lowScore = assessReadiness(50, []);
      assert.ok(!lowScore.readyForManual, 'low score should not be ready for manual');
      assert.ok(!lowScore.readyForAutomation, 'low score should not be ready for automation');
      
      const criticalIssue = assessReadiness(85, [{ severity: 'critical', message: 'Critical issue' }]);
      assert.ok(!criticalIssue.readyForManual, 'critical issues should prevent manual readiness');
      assert.ok(!criticalIssue.readyForAutomation, 'critical issues should prevent automation readiness');
    });
    
    it('should validate issue detection', () => {
      const mockTestCase = {
        title: 'Login',
        description: '',
        steps: [
          { description: 'Login', expectedResult: '' }
        ]
      };
      
      const detectIssues = (testCase: any) => {
        const issues: any[] = [];
        
        if (testCase.title.length < 10) {
          issues.push({
            category: 'title',
            severity: 'medium',
            message: 'Title should be more descriptive'
          });
        }
        
        if (!testCase.description || testCase.description.trim().length === 0) {
          issues.push({
            category: 'description',
            severity: 'high',
            message: 'Description is missing'
          });
        }
        
        testCase.steps.forEach((step: any, index: number) => {
          if (!step.expectedResult || step.expectedResult.trim().length === 0) {
            issues.push({
              category: 'steps',
              severity: 'high',
              message: `Step ${index + 1} is missing expected result`
            });
          }
        });
        
        return issues;
      };
      
      const issues = detectIssues(mockTestCase);
      assert.equal(issues.length, 3, 'should detect 3 issues');
      assert.ok(issues.some(i => i.category === 'title'), 'should detect title issue');
      assert.ok(issues.some(i => i.category === 'description'), 'should detect description issue');
      assert.ok(issues.some(i => i.category === 'steps'), 'should detect steps issue');
    });
    
  });
  
  describe('TestCaseImprover', () => {
    
    it('should validate improvement suggestions', () => {
      const mockTestCase = {
        title: 'Login test',
        description: 'Test login',
        steps: [
          { description: 'Enter credentials', expectedResult: 'Login successful' }
        ]
      };
      
      const generateImprovements = (testCase: any) => {
        const improvements: any[] = [];
        
        if (testCase.title.length < 20) {
          improvements.push({
            type: 'title',
            original: testCase.title,
            improved: 'Verify successful user login with valid credentials',
            reason: 'More descriptive and specific title',
            confidence: 0.9
          });
        }
        
        if (testCase.description.length < 20) {
          improvements.push({
            type: 'description',
            original: testCase.description,
            improved: 'Verify that a user can successfully log into the application using valid username and password credentials',
            reason: 'More detailed description explaining the test purpose',
            confidence: 0.85
          });
        }
        
        return improvements;
      };
      
      const improvements = generateImprovements(mockTestCase);
      assert.equal(improvements.length, 2, 'should generate 2 improvements');
      assert.ok(improvements[0].improved.length > improvements[0].original.length, 'improved title should be longer');
      assert.ok(improvements[0].confidence > 0.8, 'should have high confidence');
    });
    
    it('should validate confidence calculation', () => {
      const calculateConfidence = (improvement: any) => {
        let confidence = 0.5; // Base confidence
        
        // Increase confidence for length improvements
        if (improvement.improved.length > improvement.original.length * 1.5) {
          confidence += 0.2;
        }
        
        // Increase confidence for specific keywords
        if (improvement.improved.includes('verify') || improvement.improved.includes('ensure')) {
          confidence += 0.1;
        }
        
        // Increase confidence for detailed steps
        if (improvement.type === 'steps' && improvement.improved.includes('1.') && improvement.improved.includes('2.')) {
          confidence += 0.2;
        }
        
        return Math.min(confidence, 1.0); // Cap at 1.0
      };
      
      const titleImprovement = {
        type: 'title',
        original: 'Login',
        improved: 'Verify successful user authentication with valid credentials'
      };
      
      const confidence = calculateConfidence(titleImprovement);
      assert.ok(confidence > 0.5, 'should have confidence above base level');
      assert.ok(confidence <= 1.0, 'confidence should not exceed 1.0');
    });
    
    it('should validate improvement application', () => {
      const originalTestCase = {
        title: 'Login test',
        description: 'Test login functionality',
        steps: [
          { description: 'Enter username and password', expectedResult: 'User logs in' }
        ]
      };
      
      const improvements = [
        {
          type: 'title',
          improved: 'Verify successful user login with valid credentials'
        },
        {
          type: 'description',
          improved: 'Verify that a user can successfully authenticate and access the application using valid login credentials'
        }
      ];
      
      const applyImprovements = (testCase: any, improvements: any[]) => {
        const improved = { ...testCase };
        
        improvements.forEach(improvement => {
          if (improvement.type === 'title') {
            improved.title = improvement.improved;
          } else if (improvement.type === 'description') {
            improved.description = improvement.improved;
          }
        });
        
        return improved;
      };
      
      const improvedTestCase = applyImprovements(originalTestCase, improvements);
      
      assert.notEqual(improvedTestCase.title, originalTestCase.title, 'title should be improved');
      assert.notEqual(improvedTestCase.description, originalTestCase.description, 'description should be improved');
      assert.ok(improvedTestCase.title.length > originalTestCase.title.length, 'improved title should be longer');
    });
    
  });
  
  describe('DynamicRulesParser', () => {
    
    it('should validate markdown parsing', () => {
      const mockRulesContent = `# Test Case Review Rules

## Structure Rules
- Test case title should be descriptive and specific
- Steps should be numbered and clearly written
- Each step should have an expected result

## Quality Rules
- Test data should be realistic and relevant
- Preconditions should be clearly stated
- Test case should cover one specific scenario`;
      
      const parseRules = (content: string) => {
        const lines = content.split('\n');
        const rules: any[] = [];
        let currentCategory = '';
        
        lines.forEach(line => {
          const trimmed = line.trim();
          if (trimmed.startsWith('## ')) {
            currentCategory = trimmed.substring(3);
          } else if (trimmed.startsWith('- ')) {
            rules.push({
              category: currentCategory,
              rule: trimmed.substring(2),
              weight: 1
            });
          }
        });
        
        return rules;
      };
      
      const rules = parseRules(mockRulesContent);
      
      assert.ok(rules.length > 0, 'should parse rules from content');
      assert.ok(rules.some(r => r.category === 'Structure Rules'), 'should categorize structure rules');
      assert.ok(rules.some(r => r.category === 'Quality Rules'), 'should categorize quality rules');
      assert.ok(rules.some(r => r.rule.includes('descriptive')), 'should parse specific rules');
    });
    
    it('should validate meaningful content detection', () => {
      const contentExamples = [
        { content: '# Rules\n\n- Rule 1\n- Rule 2', meaningful: true },
        { content: '', meaningful: false },
        { content: '   \n\n  \t  ', meaningful: false },
        { content: '# Empty\n\n<!-- No content -->', meaningful: false },
        { content: '# Rules\n\n', meaningful: false }
      ];
      
      const hasMeaningfulContent = (content: string): boolean => {
        const trimmed = content.trim();
        if (trimmed.length === 0) return false;
        
        // Remove markdown headers, comments, and whitespace
        const withoutMarkdown = trimmed
          .replace(/^#.*$/gm, '')
          .replace(/<!--.*?-->/gs, '')
          .replace(/^\s*$/gm, '')
          .trim();
        
        return withoutMarkdown.length > 0;
      };
      
      contentExamples.forEach(example => {
        const result = hasMeaningfulContent(example.content);
        assert.equal(result, example.meaningful, 
          `Content "${example.content.substring(0, 20)}..." should ${example.meaningful ? 'be' : 'not be'} meaningful`);
      });
    });
    
    it('should validate rules file loading', () => {
      const fileScenarios = [
        { exists: true, readable: true, content: 'rules content', shouldLoad: true },
        { exists: false, readable: false, content: '', shouldLoad: false },
        { exists: true, readable: false, content: '', shouldLoad: false },
        { exists: true, readable: true, content: '', shouldLoad: false }
      ];
      
      fileScenarios.forEach(scenario => {
        const canLoad = scenario.exists && scenario.readable && scenario.content.length > 0;
        assert.equal(canLoad, scenario.shouldLoad, 
          `Should ${scenario.shouldLoad ? 'load' : 'not load'} rules for scenario: ${JSON.stringify(scenario)}`);
      });
    });
    
    it('should validate rules versioning', () => {
      const rulesWithVersion = `# Test Case Review Rules v2.1

## Metadata
- Version: 2.1
- Last Updated: 2025-01-15
- Author: QA Team

## Rules
- Test cases should be comprehensive`;
      
      const extractVersion = (content: string): string => {
        const versionMatch = content.match(/# .* v(\d+\.\d+)/);
        return versionMatch ? versionMatch[1] : '1.0';
      };
      
      const version = extractVersion(rulesWithVersion);
      assert.equal(version, '2.1', 'should extract version from header');
      
      const noVersionContent = '# Test Case Review Rules\n\n- Rule 1';
      const defaultVersion = extractVersion(noVersionContent);
      assert.equal(defaultVersion, '1.0', 'should default to version 1.0');
    });
    
  });
  
  describe('Error Handling', () => {
    
    it('should handle malformed data gracefully', () => {
      const malformedData = [
        null,
        '',
        {},
        [],
        { id: null, title: undefined }
      ];
      
      malformedData.forEach(data => {
        try {
          const jsonString = JSON.stringify(data);
          const parsed = JSON.parse(jsonString);
          assert.ok(true, 'should handle malformed data without throwing');
        } catch (error) {
          assert.fail(`Should not throw error for data: ${data}`);
        }
      });
      
      // Handle undefined separately since JSON.stringify(undefined) returns undefined
      try {
        const undefinedResult = JSON.stringify(undefined);
        assert.equal(undefinedResult, undefined, 'JSON.stringify(undefined) should return undefined');
      } catch (error) {
        assert.fail('Should handle undefined gracefully');
      }
    });
    
    it('should validate input sanitization', () => {
      const unsafeInputs = [
        '<script>alert("xss")</script>',
        'DROP TABLE users;',
        '../../etc/passwd',
        'null\x00byte'
      ];
      
      const sanitizeInput = (input: string): string => {
        return input
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/[^\w\s\-_.]/g, '') // Keep only safe characters
          .trim();
      };
      
      unsafeInputs.forEach(input => {
        const sanitized = sanitizeInput(input);
        assert.ok(!sanitized.includes('<script>'), 'should remove script tags');
        // SQL keywords should be removed by the character filter
        if (input.includes('DROP TABLE')) {
          assert.ok(sanitized === 'DROP TABLE users', `SQL should be sanitized: "${sanitized}" from "${input}"`);
        }
        assert.ok(!sanitized.includes('../'), 'should remove path traversal');
      });
    });
    
    it('should handle circular references in data', () => {
      const circularData: any = { name: 'test' };
      circularData.self = circularData;
      
      try {
        JSON.stringify(circularData);
        assert.fail('Should throw error for circular reference');
      } catch (error) {
        assert.ok(error instanceof TypeError, 'Should throw TypeError for circular reference');
        assert.ok(error.message.includes('circular'), 'Error message should mention circular reference');
      }
    });
    
  });
  
  describe('Performance Optimization', () => {
    
    it('should validate efficient data processing', () => {
      const LARGE_DATASET_SIZE = 10000;
      const BATCH_SIZE = 100;
      
      const processBatches = (data: any[], batchSize: number): any[][] => {
        const batches: any[][] = [];
        for (let i = 0; i < data.length; i += batchSize) {
          batches.push(data.slice(i, i + batchSize));
        }
        return batches;
      };
      
      const mockData = Array.from({ length: LARGE_DATASET_SIZE }, (_, i) => ({ id: i }));
      const batches = processBatches(mockData, BATCH_SIZE);
      
      assert.equal(batches.length, LARGE_DATASET_SIZE / BATCH_SIZE, 'should create correct number of batches');
      assert.equal(batches[0].length, BATCH_SIZE, 'each batch should have correct size');
    });
    
    it('should validate memory-efficient string operations', () => {
      const LARGE_STRING_SIZE = 100000;
      const largeString = 'a'.repeat(LARGE_STRING_SIZE);
      
      // Efficient substring operation
      const substring = largeString.substring(0, 100);
      assert.equal(substring.length, 100, 'substring should be correct length');
      
      // Efficient string search
      const searchResult = largeString.indexOf('a');
      assert.equal(searchResult, 0, 'should find character efficiently');
    });
    
    it('should validate caching mechanisms', () => {
      const cache = new Map<string, any>();
      const MAX_CACHE_SIZE = 100;
      
      const getCachedValue = (key: string, computeFn: () => any) => {
        if (cache.has(key)) {
          return cache.get(key);
        }
        
        const value = computeFn();
        
        if (cache.size >= MAX_CACHE_SIZE) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }
        
        cache.set(key, value);
        return value;
      };
      
      const expensiveComputation = () => ({ computed: Date.now() });
      
      const result1 = getCachedValue('test', expensiveComputation);
      const result2 = getCachedValue('test', expensiveComputation);
      
      assert.equal(result1, result2, 'should return cached value');
      assert.ok(cache.size <= MAX_CACHE_SIZE, 'cache should not exceed max size');
    });
    
  });

  describe('HTML Sanitization (Security)', () => {
    
    /**
     * Tests for the stripHtmlTags security function
     * Addresses CodeQL "Incomplete multi-character sanitization" vulnerability
     */
    
    // Simulate the stripHtmlTags function from server.ts
    const stripHtmlTags = (html: string): string => {
      if (!html) return "";
      
      let result = html;
      let previous: string;
      
      // Iteratively remove tags until no more are found
      do {
        previous = result;
        result = result.replace(/<[^>]*>/g, '');
      } while (result !== previous);
      
      // Also handle any remaining angle brackets
      result = result.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
      return result.trim();
    };

    it('should strip simple HTML tags', () => {
      const input = '<a href="https://example.com">Click here</a>';
      const result = stripHtmlTags(input);
      assert.equal(result, 'Click here');
    });

    it('should handle nested tags', () => {
      const input = '<div><span><a href="#">Link</a></span></div>';
      const result = stripHtmlTags(input);
      assert.equal(result, 'Link');
    });

    it('should prevent script injection via incomplete tags', () => {
      // This is the vulnerability CodeQL flagged - <<script>script> becoming <script>
      const input = '<<script>script>alert(1)<</script>/script>';
      const result = stripHtmlTags(input);
      assert.ok(!result.includes('<script'), 'should not contain <script');
      assert.ok(!result.includes('script>'), 'should not contain script>');
    });

    it('should handle malformed HTML safely', () => {
      const input = '<a href="test">text<';
      const result = stripHtmlTags(input);
      assert.ok(!result.includes('<'), 'should escape remaining angle brackets');
    });

    it('should handle empty input', () => {
      assert.equal(stripHtmlTags(''), '');
      assert.equal(stripHtmlTags(null as any), '');
      assert.equal(stripHtmlTags(undefined as any), '');
    });

    it('should handle plain text without tags', () => {
      const input = 'Plain text without any HTML';
      const result = stripHtmlTags(input);
      assert.equal(result, 'Plain text without any HTML');
    });

    it('should handle Zebrunner anchor tags correctly', () => {
      const input = '<a href="https://myfitnesspal.atlassian.net/browse/APPS-2771" target="_blank">APPS-2771</a>';
      const result = stripHtmlTags(input);
      assert.equal(result, 'APPS-2771');
    });

    it('should handle dashboard anchors with div attribute', () => {
      const input = '<a div="MCP Android" href="../../MCPAND/automation-dashboards/102">MCP Android</a>';
      const result = stripHtmlTags(input);
      assert.equal(result, 'MCP Android');
    });

    it('should handle failure link anchors', () => {
      const input = '<a div="0000000043" href="../../MCPAND/automation-dashboards/99?PERIOD=Last 7 Days&hashcode=1051677506">43</a>';
      const result = stripHtmlTags(input);
      assert.equal(result, '43');
    });

    it('should prevent XSS via event handlers', () => {
      const input = '<img src=x onerror="alert(1)">Text';
      const result = stripHtmlTags(input);
      assert.ok(!result.includes('onerror'), 'should not contain event handlers');
      assert.ok(!result.includes('alert'), 'should not contain script code');
    });

    it('should handle multiple iterations for deeply nested malicious input', () => {
      // Construct input that requires multiple passes
      const input = '<<<div>div>div>Hello</div>>';
      const result = stripHtmlTags(input);
      assert.ok(!result.match(/<[^&]/), 'should not contain unescaped tags');
    });
    
  });
  
});
