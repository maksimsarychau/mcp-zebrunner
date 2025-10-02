import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TestCaseDuplicateAnalyzer } from '../../src/utils/duplicate-analyzer.js';
import { ZebrunnerTestCase } from '../../src/types/core.js';

describe('TestCaseDuplicateAnalyzer', () => {
  const analyzer = new TestCaseDuplicateAnalyzer(80);

  it('should extract steps from test case', () => {
    const testCase: ZebrunnerTestCase = {
      id: 1,
      key: 'TEST-1',
      title: 'Login Test',
      steps: [
        { id: 1, action: 'Open login page', expectedResult: 'Login page displays' },
        { id: 2, action: 'Enter username', expectedResult: 'Username field is filled' },
        { id: 3, action: 'Enter password', expectedResult: 'Password field is filled' },
        { id: 4, action: 'Click login button', expectedResult: 'User is logged in' }
      ]
    };

    const steps = analyzer.extractSteps(testCase);
    assert.strictEqual(steps.length, 4);
    assert.strictEqual(steps[0].action, 'open login page');
    assert.strictEqual(steps[0].expectedResult, 'login page displays');
  });

  it('should calculate similarity between similar test cases', () => {
    const testCase1: ZebrunnerTestCase = {
      id: 1,
      key: 'TEST-1',
      title: 'Login Test 1',
      steps: [
        { id: 1, action: 'Open login page', expectedResult: 'Login page displays' },
        { id: 2, action: 'Enter username and password', expectedResult: 'Credentials are entered' },
        { id: 3, action: 'Click login button', expectedResult: 'User is logged in' }
      ]
    };

    const testCase2: ZebrunnerTestCase = {
      id: 2,
      key: 'TEST-2',
      title: 'Login Test 2',
      steps: [
        { id: 1, action: 'Navigate to login page', expectedResult: 'Login page is shown' },
        { id: 2, action: 'Fill username and password', expectedResult: 'User credentials filled' },
        { id: 3, action: 'Press login button', expectedResult: 'User successfully logged in' }
      ]
    };

    const steps1 = analyzer.extractSteps(testCase1);
    const steps2 = analyzer.extractSteps(testCase2);
    
    const result = analyzer.calculateStepSimilarity(steps1, steps2);
    
    assert.ok(result.similarity > 50, `Similarity should be > 50%, got ${result.similarity}%`);
    assert.ok(result.sharedSteps >= 2, `Should have at least 2 shared steps, got ${result.sharedSteps}`);
    assert.ok(result.sharedStepsSummary.length > 0);
  });

  it('should create clusters from similar test cases', () => {
    const testCases: ZebrunnerTestCase[] = [
      {
        id: 1,
        key: 'TEST-1',
        title: 'Login Test 1',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Open login page', expectedResult: 'Login page displays' },
          { id: 2, action: 'Enter credentials', expectedResult: 'Credentials entered' },
          { id: 3, action: 'Click login', expectedResult: 'User logged in' }
        ]
      },
      {
        id: 2,
        key: 'TEST-2',
        title: 'Login Test 2',
        automationState: { id: 2, name: 'Automated' },
        steps: [
          { id: 1, action: 'Navigate to login page', expectedResult: 'Login page shown' },
          { id: 2, action: 'Fill credentials', expectedResult: 'Credentials filled' },
          { id: 3, action: 'Press login button', expectedResult: 'User successfully logged in' }
        ]
      },
      {
        id: 3,
        key: 'TEST-3',
        title: 'Logout Test',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Click logout button', expectedResult: 'User logged out' }
        ]
      }
    ];

    const result = analyzer.analyzeDuplicates(testCases, 'TEST');
    
    assert.strictEqual(result.totalTestCases, 3);
    assert.strictEqual(result.projectKey, 'TEST');
    assert.ok(result.clustersFound >= 0);
    
    if (result.clustersFound > 0) {
      const cluster = result.clusters[0];
      assert.ok(cluster.testCases.length >= 2);
      assert.ok(cluster.averageSimilarity > 0);
      assert.ok(cluster.recommendedBase.testCaseKey.length > 0);
      assert.ok(cluster.mergingStrategy.length > 0);
    }
  });

  it('should handle test cases without steps', () => {
    const testCase: ZebrunnerTestCase = {
      id: 1,
      key: 'TEST-1',
      title: 'Empty Test',
      steps: []
    };

    const steps = analyzer.extractSteps(testCase);
    assert.strictEqual(steps.length, 0);
  });

  it('should detect user type patterns', () => {
    const testCases: ZebrunnerTestCase[] = [
      {
        id: 1,
        key: 'TEST-1',
        title: 'Login test for Free user',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Open login page', expectedResult: 'Login page displays' },
          { id: 2, action: 'Enter credentials', expectedResult: 'Credentials entered' }
        ]
      },
      {
        id: 2,
        key: 'TEST-2',
        title: 'Login test for Premium user',
        automationState: { id: 2, name: 'Automated' },
        steps: [
          { id: 1, action: 'Open login page', expectedResult: 'Login page displays' },
          { id: 2, action: 'Enter credentials', expectedResult: 'Credentials entered' }
        ]
      }
    ];

    const analyzer = new TestCaseDuplicateAnalyzer(70);
    const similarities = analyzer.calculateSimilarityMatrix(testCases);
    
    assert.ok(similarities.length > 0);
    assert.strictEqual(similarities[0].patternType, 'user_type');
    assert.ok(similarities[0].variationDetails?.userTypes?.includes('Free'));
    assert.ok(similarities[0].variationDetails?.userTypes?.includes('Premium'));
  });

  it('should detect theme patterns', () => {
    const testCases: ZebrunnerTestCase[] = [
      {
        id: 1,
        key: 'TEST-1',
        title: 'Verify card display in Dark mode',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Open app', expectedResult: 'App opens' },
          { id: 2, action: 'Check card display', expectedResult: 'Card visible' }
        ]
      },
      {
        id: 2,
        key: 'TEST-2',
        title: 'Verify card display in Light mode',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Open app', expectedResult: 'App opens' },
          { id: 2, action: 'Check card display', expectedResult: 'Card visible' }
        ]
      }
    ];

    const analyzer = new TestCaseDuplicateAnalyzer(70);
    const similarities = analyzer.calculateSimilarityMatrix(testCases);
    
    assert.ok(similarities.length > 0);
    assert.strictEqual(similarities[0].patternType, 'theme');
    assert.ok(similarities[0].variationDetails?.themes?.includes('Dark'));
    assert.ok(similarities[0].variationDetails?.themes?.includes('Light'));
  });

  it('should provide pattern-specific merging strategies', () => {
    const testCases: ZebrunnerTestCase[] = [
      {
        id: 1,
        key: 'TEST-1',
        title: 'Test for Free user',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Perform action', expectedResult: 'Action completed' }
        ]
      },
      {
        id: 2,
        key: 'TEST-2',
        title: 'Test for Premium user',
        automationState: { id: 2, name: 'Automated' },
        steps: [
          { id: 1, action: 'Perform action', expectedResult: 'Action completed' }
        ]
      }
    ];

    const analyzer = new TestCaseDuplicateAnalyzer(70);
    const result = analyzer.analyzeDuplicates(testCases, 'TEST');
    
    if (result.clustersFound > 0) {
      const cluster = result.clusters[0];
      assert.ok(cluster.mergingStrategy.includes('userType parameter'));
      assert.ok(cluster.mergingStrategy.includes('Free/Premium'));
    }
  });
});
