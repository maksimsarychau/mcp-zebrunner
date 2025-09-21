import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { FormatProcessor } from '../../src/utils/formatter.js';

describe('FormatProcessor', () => {
  describe('format method', () => {
    const testData = {
      id: 123,
      title: 'Test Case',
      description: 'A test case for testing'
    };

    it('should return data as-is for dto format', () => {
      const result = FormatProcessor.format(testData, 'dto');
      assert.deepEqual(result, testData);
    });

    it('should return JSON string for json format', () => {
      const result = FormatProcessor.format(testData, 'json');
      assert.equal(typeof result, 'string');
      assert.equal(result, JSON.stringify(testData, null, 2));
    });

    it('should return readable string for string format', () => {
      const result = FormatProcessor.format(testData, 'string');
      assert.equal(typeof result, 'string');
      const resultStr = result as string;
      assert.ok(resultStr.includes('123'));
      assert.ok(resultStr.includes('Test Case'));
    });

    it('should handle arrays', () => {
      const arrayData = [testData, { ...testData, id: 456 }];
      const result = FormatProcessor.format(arrayData, 'json');
      assert.equal(typeof result, 'string');
      const parsed = JSON.parse(result as string);
      assert.equal(parsed.length, 2);
    });
  });

  describe('formatTestCaseMarkdown', () => {
    const testCase = {
      id: 12345,
      key: 'MFPAND-29',
      title: 'User Login Test',
      description: 'Test user login functionality',
      priority: { id: 1, name: 'High' },
      automationState: { id: 2, name: 'Automated' },
      createdBy: { id: 1, username: 'john.doe', email: 'john@example.com' },
      lastModifiedBy: { id: 2, username: 'jane.smith', email: 'jane@example.com' },
      customField: {
        'Test Type': 'Functional',
        'Component': 'Authentication',
        'Browser': 'Chrome'
      },
      steps: [
        {
          stepNumber: 1,
          action: 'Navigate to login page',
          expected: 'Login form is displayed'
        },
        {
          stepNumber: 2,
          action: 'Enter valid credentials',
          expected: 'User is logged in successfully'
        }
      ]
    };

    it('should generate markdown with basic test case info', () => {
      const markdown = FormatProcessor.formatTestCaseMarkdown(testCase);
      
      assert.ok(markdown.includes('# Test Case: User Login Test'));
      assert.ok(markdown.includes('**ID:** 12345'));
      assert.ok(markdown.includes('**Key:** MFPAND-29'));
      assert.ok(markdown.includes('**Priority:** High'));
      assert.ok(markdown.includes('**Automation State:** Automated'));
    });

    it('should include description section', () => {
      const markdown = FormatProcessor.formatTestCaseMarkdown(testCase);
      
      assert.ok(markdown.includes('## Description'));
      assert.ok(markdown.includes('Test user login functionality'));
    });

    it('should include custom fields section', () => {
      const markdown = FormatProcessor.formatTestCaseMarkdown(testCase);
      
      assert.ok(markdown.includes('## Custom Fields'));
      assert.ok(markdown.includes('**Test Type:** Functional'));
      assert.ok(markdown.includes('**Component:** Authentication'));
      assert.ok(markdown.includes('**Browser:** Chrome'));
    });

    it('should include steps section', () => {
      const markdown = FormatProcessor.formatTestCaseMarkdown(testCase);
      
      assert.ok(markdown.includes('## Steps'));
      assert.ok(markdown.includes('### Step 1'));
      assert.ok(markdown.includes('**Action:** Navigate to login page'));
      assert.ok(markdown.includes('**Expected:** Login form is displayed'));
      assert.ok(markdown.includes('### Step 2'));
      assert.ok(markdown.includes('**Action:** Enter valid credentials'));
      assert.ok(markdown.includes('**Expected:** User is logged in successfully'));
    });

    it('should handle test case without steps', () => {
      const testCaseNoSteps = { ...testCase, steps: [] };
      const markdown = FormatProcessor.formatTestCaseMarkdown(testCaseNoSteps);
      
      assert.ok(markdown.includes('## Steps'));
      assert.ok(markdown.includes('_No explicit steps provided._'));
    });

    it('should handle test case without custom fields', () => {
      const testCaseNoCustomFields = { ...testCase, customField: {} };
      const markdown = FormatProcessor.formatTestCaseMarkdown(testCaseNoCustomFields);
      
      assert.ok(!markdown.includes('## Custom Fields'));
    });

    it('should handle minimal test case data', () => {
      const minimalTestCase = {
        id: 999,
        title: 'Minimal Test'
      };
      const markdown = FormatProcessor.formatTestCaseMarkdown(minimalTestCase);
      
      assert.ok(markdown.includes('# Test Case: Minimal Test'));
      assert.ok(markdown.includes('**ID:** 999'));
      assert.ok(markdown.includes('**Key:** N/A'));
      assert.ok(markdown.includes('**Priority:** N/A'));
    });

    it('should handle steps with different field names', () => {
      const testCaseVariedSteps = {
        ...testCase,
        steps: [
          {
            number: 1,
            actionText: 'Click login button',
            expectedResult: 'Button is clicked'
          },
          {
            index: 2,
            instruction: 'Fill username field',
            expectedText: 'Username is entered'
          }
        ]
      };
      
      const markdown = FormatProcessor.formatTestCaseMarkdown(testCaseVariedSteps);
      
      assert.ok(markdown.includes('**Action:** Click login button'));
      assert.ok(markdown.includes('**Expected:** Button is clicked'));
      assert.ok(markdown.includes('**Action:** Fill username field'));
      assert.ok(markdown.includes('**Expected:** Username is entered'));
    });

    it('should handle steps with data payload', () => {
      const testCaseWithData = {
        ...testCase,
        steps: [
          {
            stepNumber: 1,
            action: 'Submit form',
            expected: 'Form is submitted',
            data: {
              username: 'testuser',
              password: 'testpass'
            }
          }
        ]
      };
      
      const markdown = FormatProcessor.formatTestCaseMarkdown(testCaseWithData);
      
      assert.ok(markdown.includes('**Data:**'));
      assert.ok(markdown.includes('```json'));
      assert.ok(markdown.includes('"username": "testuser"'));
      assert.ok(markdown.includes('"password": "testpass"'));
    });
  });

  describe('type guards', () => {
    it('should identify test case objects', () => {
      const testCase = {
        id: 123,
        title: 'Test Case',
        key: 'TC-123'
      };
      
      // Test the private method indirectly through format
      const result = FormatProcessor.format(testCase, 'string');
      const resultStr = result as string;
      assert.ok(resultStr.includes('=== Test Case:'));
    });

    it('should identify test suite objects', () => {
      const testSuite = {
        id: 456,
        title: 'Test Suite',
        relativePosition: 1
      };
      
      const result = FormatProcessor.format(testSuite, 'string');
      const resultStr = result as string;
      assert.ok(resultStr.includes('=== Test Suite:'));
    });

    it('should identify test run objects', () => {
      const testRun = {
        id: 789,
        name: 'Test Run',
        status: 'PASSED'
      };
      
      const result = FormatProcessor.format(testRun, 'string');
      const resultStr = result as string;
      assert.ok(resultStr.includes('=== Test Run:'));
    });

    it('should identify test result objects', () => {
      const testResult = {
        testCaseId: 123,
        status: 'PASSED'
      };
      
      const result = FormatProcessor.format(testResult, 'string');
      const resultStr = result as string;
      assert.ok(resultStr.includes('=== Test Result'));
    });

    it('should fallback to JSON for unknown objects', () => {
      const unknownObject = {
        someField: 'someValue',
        anotherField: 42
      };
      
      const result = FormatProcessor.format(unknownObject, 'string');
      const parsed = JSON.parse(result as string);
      assert.deepEqual(parsed, unknownObject);
    });
  });
});
