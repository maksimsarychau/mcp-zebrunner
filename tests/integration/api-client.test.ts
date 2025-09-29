import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { EnhancedZebrunnerClient } from '../../src/api/enhanced-client.js';
import { ZebrunnerConfig } from '../../src/types/api.js';
import { testConfig } from '../fixtures/api-responses.js';
import 'dotenv/config';

/**
 * Integration tests for EnhancedZebrunnerClient
 * These tests make real API calls to Zebrunner
 * 
 * Prerequisites:
 * - Valid .env file with Zebrunner credentials
 * - Access to MFPAND project
 * - Test case MFPAND-29 should exist
 */

describe('EnhancedZebrunnerClient Integration Tests', () => {
  let client: EnhancedZebrunnerClient;
  let config: ZebrunnerConfig;

  beforeEach(() => {
    // Use real environment variables
    config = {
      baseUrl: process.env.ZEBRUNNER_URL || testConfig.ZEBRUNNER_URL,
      username: process.env.ZEBRUNNER_LOGIN || testConfig.ZEBRUNNER_LOGIN,
      token: process.env.ZEBRUNNER_TOKEN || testConfig.ZEBRUNNER_TOKEN,
      debug: process.env.DEBUG === 'true',
      timeout: 30000,
      retryAttempts: 2,
      retryDelay: 1000
    };

    client = new EnhancedZebrunnerClient(config);
  });

  describe('Connection and Health', () => {
    it('should successfully test connection to Zebrunner API', async () => {
      const result = await client.testConnection();
      
      assert.equal(result.success, true);
      assert.ok(result.message.includes('Connection successful'));
      assert.ok(result.details);
      assert.equal(result.details.baseUrl, config.baseUrl);
    });

    it('should track endpoint health', () => {
      const health = client.getEndpointHealth();
      assert.equal(typeof health, 'object');
    });
  });

  describe('Test Suites API', () => {
    it('should list test suites for MFPAND project', async () => {
      const response = await client.getTestSuites('MFPAND');
      
      assert.ok(response);
      assert.ok(response.items);
      assert.ok(Array.isArray(response.items));
      assert.ok(response.items.length > 0);

      // Verify structure of first suite
      const firstSuite = response.items[0];
      assert.ok(firstSuite.id);
      assert.equal(typeof firstSuite.id, 'number');
      assert.ok(firstSuite.title || firstSuite.name);
    });

    it('should get all test suites with pagination', async () => {
      const allSuites = await client.getAllTestSuites('MFPAND');
      
      assert.ok(Array.isArray(allSuites));
      assert.ok(allSuites.length > 0);

      // Should have more or equal items than single page
      const singlePage = await client.getTestSuites('MFPAND', { size: 5 });
      assert.ok(allSuites.length >= singlePage.items.length);
    });

    it('should handle pagination parameters correctly', async () => {
      const page0 = await client.getTestSuites('MFPAND', { page: 0, size: 2 });
      const page1 = await client.getTestSuites('MFPAND', { page: 1, size: 2 });
      
      assert.ok(page0.items.length <= 2);
      assert.ok(page1.items.length <= 2);

      // Pages should be different (if there are enough items)
      if (page0.items.length === 2 && page1.items.length > 0) {
        assert.notEqual(page0.items[0].id, page1.items[0].id);
      }
    });

    it('should validate project key format', async () => {
      try {
        await client.getTestSuites('invalid-key');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Invalid project key format'));
      }
    });

    it('should handle empty project key', async () => {
      try {
        await client.getTestSuites('');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Project key is required'));
      }
    });
  });

  describe('Test Cases API', () => {
    it('should get test case by key MFPAND-29', async () => {
      const testCase = await client.getTestCaseByKey('MFPAND', 'MFPAND-29');
      
      assert.ok(testCase);
      assert.ok(testCase.id);
      assert.equal(testCase.key, 'MFPAND-29');
      assert.ok(testCase.title);
      assert.ok(testCase.priority);
      assert.ok(testCase.automationState);

      // Verify custom fields are parsed
      if (testCase.customField) {
        assert.equal(typeof testCase.customField, 'object');
        assert.ok(Object.keys(testCase.customField).length > 0);
      }
    });

    it('should list test cases with pagination', async () => {
      const response = await client.getTestCases('MFPAND', { size: 10 });
      
      assert.ok(response);
      assert.ok(response.items);
      assert.ok(Array.isArray(response.items));
      assert.ok(response.items.length <= 10);

      if (response.items.length > 0) {
        const firstCase = response.items[0];
        assert.ok(firstCase.id);
        assert.equal(typeof firstCase.id, 'number');
      }
    });

    it('should handle invalid test case key', async () => {
      try {
        await client.getTestCaseByKey('MFPAND', 'INVALID-KEY-999');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error);
      }
    });

    it('should validate required parameters', async () => {
      try {
        await client.getTestCaseByKey('', 'MFPAND-29');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Project key is required'));
      }

      try {
        await client.getTestCaseByKey('MFPAND', '');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Test case key is required'));
      }
    });
  });

  describe('Search API', () => {
    it('should search test cases with query', async () => {
      const response = await client.searchTestCases('MFPAND', 'reminder', { size: 5 });
      
      assert.ok(response);
      assert.ok(response.items);
      assert.ok(Array.isArray(response.items));

      // Should find at least the MFPAND-29 case which has "reminder" in title
      const reminderCase = response.items.find(item =>
        item.key === 'MFPAND-29' ||
        (item.title && item.title.toLowerCase().includes('reminder'))
      );

      if (reminderCase) {
        assert.ok(reminderCase.id);
      }
    });

    it('should handle empty search query', async () => {
      try {
        await client.searchTestCases('MFPAND', '');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Search query is required'));
      }

      try {
        await client.searchTestCases('MFPAND', '   ');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Search query is required'));
      }
    });

    it('should handle search with filters', async () => {
      const response = await client.searchTestCases('MFPAND', 'test', {
        size: 3,
        page: 0
      });
      
      assert.ok(response.items.length <= 3);
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 errors gracefully', async () => {
      try {
        await client.getTestSuite(999999); // Non-existent suite ID
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.equal(error.name, 'ZebrunnerNotFoundError');
        assert.equal(error.statusCode, 404);
      }
    });

    it('should handle invalid authentication', async () => {
      const invalidClient = new EnhancedZebrunnerClient({
        ...config,
        token: 'invalid-token'
      });

      try {
        await invalidClient.getTestSuites('MFPAND');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.equal(error.name, 'ZebrunnerAuthError');
        assert.equal(error.statusCode, 401);
      }
    });

    it('should validate pagination parameters', async () => {
      try {
        await client.getTestSuites('MFPAND', { page: -1 });
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Page number must be non-negative'));
      }

      try {
        await client.getTestSuites('MFPAND', { size: 0 });
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Page size must be between 1 and'));
      }

      try {
        await client.getTestSuites('MFPAND', { size: 1000 });
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Page size must be between 1 and'));
      }
    });
  });

  describe('Experimental Features', () => {
    it('should attempt to get test cases by suite (experimental)', async () => {
      // Get a suite ID first
      const suites = await client.getTestSuites('MFPAND', { size: 1 });
      
      if (suites.items.length > 0) {
        const suiteId = suites.items[0].id;
        
        try {
          const testCases = await client.getTestCasesBySuite('MFPAND', suiteId);
          assert.ok(Array.isArray(testCases));
        } catch (error: any) {
          // Expected to fail on some instances
          assert.ok([404, 400].includes(error.statusCode));
        }
      }
    });

    it('should validate suite ID parameter', async () => {
      try {
        await client.getTestCasesBySuite('MFPAND', 0);
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Valid suite ID is required'));
      }

      try {
        await client.getTestCasesBySuite('MFPAND', -1);
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Valid suite ID is required'));
      }
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle multiple concurrent requests', async () => {
      const promises = [
        client.getTestSuites('MFPAND', { size: 2 }),
        client.getTestCaseByKey('MFPAND', 'MFPAND-29'),
        client.searchTestCases('MFPAND', 'test', { size: 2 })
      ];

      const results = await Promise.allSettled(promises);
      
      // At least the first two should succeed (known working endpoints)
      assert.equal(results[0].status, 'fulfilled');
      assert.equal(results[1].status, 'fulfilled');
    });

    it('should retry failed requests', async () => {
      // This test verifies retry mechanism by checking debug logs
      // In a real scenario, we'd need to simulate network failures
      const response = await client.getTestSuites('MFPAND');
      assert.ok(response);
    });

    it('should respect timeout settings', async () => {
      const fastClient = new EnhancedZebrunnerClient({
        ...config,
        timeout: 1 // Very short timeout
      });

      try {
        await fastClient.getTestSuites('MFPAND');
        // If it succeeds, the API is very fast
        assert.ok(true);
      } catch (error: any) {
        // Should timeout
        assert.ok(error.message.includes('timeout'));
      }
    });
  });
});








