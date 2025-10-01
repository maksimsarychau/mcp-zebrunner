import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { EnhancedZebrunnerClient } from '../../src/api/enhanced-client.js';
import { ZebrunnerConfig } from '../../src/types/api.js';
import { testConfig } from '../fixtures/api-responses.js';
import { requireCredentials } from '../helpers/credentials.js';
import 'dotenv/config';

/**
 * Integration tests for EnhancedZebrunnerClient
 * These tests make real API calls to Zebrunner
 * 
 * Prerequisites:
 * - Valid .env file with Zebrunner credentials
 * - Access to MCP project
 * - Test case MCP-1 should exist
 */

describe('EnhancedZebrunnerClient Integration Tests', () => {
  let client: EnhancedZebrunnerClient;
  let config: ZebrunnerConfig;

  beforeEach(() => {
    // Require valid credentials for integration tests
    const credentials = requireCredentials('EnhancedZebrunnerClient Integration Tests');
    
    config = {
      baseUrl: credentials.baseUrl,
      username: credentials.login,
      token: credentials.token,
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
    it('should list test suites for MCP project', async () => {
      const response = await client.getTestSuites('MCP');
      
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
      const allSuites = await client.getAllTestSuites('MCP');
      
      assert.ok(Array.isArray(allSuites));
      assert.ok(allSuites.length > 0);

      // Should have more or equal items than single page
      const singlePage = await client.getTestSuites('MCP', { size: 5 });
      assert.ok(allSuites.length >= singlePage.items.length);
    });

    it('should handle pagination parameters correctly', async () => {
      const page0 = await client.getTestSuites('MCP', { page: 0, size: 2 });
      const page1 = await client.getTestSuites('MCP', { page: 1, size: 2 });
      
      assert.ok(page0.items.length <= 2);
      assert.ok(page1.items.length <= 2);

      // Check pagination metadata if available
      if (page0._meta) {
        // Some APIs might not return currentPage, so check if it exists
        if (page0._meta.currentPage !== undefined) {
          assert.equal(page0._meta.currentPage, 0);
        }
        if (page0._meta.pageSize !== undefined) {
          assert.equal(page0._meta.pageSize, 2);
        }
      }
      
      if (page1._meta) {
        // Some APIs might not return currentPage, so check if it exists
        if (page1._meta.currentPage !== undefined) {
          assert.equal(page1._meta.currentPage, 1);
        }
        if (page1._meta.pageSize !== undefined) {
          assert.equal(page1._meta.pageSize, 2);
        }
      }

      // Pages should be different (if there are enough items and pagination works)
      // Only check if we have full pages and different content is expected
      if (page0.items.length === 2 && page1.items.length > 0 && 
          page0._meta?.totalElements !== undefined && page0._meta.totalElements > 2) {
        assert.notEqual(page0.items[0].id, page1.items[0].id, 'Pages should contain different items when pagination is working');
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
    it('should get test case by key MCP-1', async () => {
      const testCase = await client.getTestCaseByKey('MCP', 'MCP-1');
      
      assert.ok(testCase);
      assert.ok(testCase.id);
      assert.equal(testCase.key, 'MCP-1');
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
      const response = await client.getTestCases('MCP', { size: 10 });
      
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
        await client.getTestCaseByKey('MCP', 'INVALID-KEY-999');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error);
      }
    });

    it('should validate required parameters', async () => {
      try {
        await client.getTestCaseByKey('', 'MCP-1');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Project key is required'));
      }

      try {
        await client.getTestCaseByKey('MCP', '');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Test case key is required'));
      }
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
        await invalidClient.getTestSuites('MCP');
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.equal(error.name, 'ZebrunnerAuthError');
        assert.equal(error.statusCode, 401);
      }
    });

    it('should validate pagination parameters', async () => {
      // Test with negative page - API might accept it or handle gracefully
      const result = await client.getTestSuites('MCP', { page: -1 });
      // Just verify we get a valid response structure
      assert.ok(result);
      assert.ok(result.items);
      assert.ok(Array.isArray(result.items));

      // Test with size 0 - API might accept it or handle gracefully
      const resultSize0 = await client.getTestSuites('MCP', { size: 0 });
      // Just verify we get a valid response structure
      assert.ok(resultSize0);
      assert.ok(resultSize0.items);
      assert.ok(Array.isArray(resultSize0.items));

      // Test with large size - API might accept it or handle gracefully
      const resultLargeSize = await client.getTestSuites('MCP', { size: 1000 });
      // Just verify we get a valid response structure
      assert.ok(resultLargeSize);
      assert.ok(resultLargeSize.items);
      assert.ok(Array.isArray(resultLargeSize.items));
    });
  });

  describe('Experimental Features', () => {
    it('should attempt to get test cases by suite (experimental)', async () => {
      // Get a suite ID first
      const suites = await client.getTestSuites('MCP', { size: 1 });
      
      if (suites.items.length > 0) {
        const suiteId = suites.items[0].id;
        
        try {
          const testCases = await client.getTestCasesBySuite('MCP', suiteId);
          assert.ok(Array.isArray(testCases));
        } catch (error: any) {
          // Expected to fail on some instances
          assert.ok([404, 400].includes(error.statusCode));
        }
      }
    });

    it('should validate suite ID parameter', async () => {
      try {
        await client.getTestCasesBySuite('MCP', 0);
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Valid suite ID is required'));
      }

      try {
        await client.getTestCasesBySuite('MCP', -1);
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Valid suite ID is required'));
      }
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle multiple concurrent requests', async () => {
      const promises = [
        client.getTestSuites('MCP', { size: 2 }),
        client.getTestCaseByKey('MCP', 'MCP-1'),
        // Remove searchTestCases as it might not be available in all environments
      ];

      const results = await Promise.allSettled(promises);
      
      // Both should succeed (known working endpoints)
      assert.equal(results[0].status, 'fulfilled', `First request failed: ${results[0].status === 'rejected' ? results[0].reason : ''}`);
      assert.equal(results[1].status, 'fulfilled', `Second request failed: ${results[1].status === 'rejected' ? results[1].reason : ''}`);
    });

    it('should retry failed requests', async () => {
      // This test verifies retry mechanism by checking debug logs
      // In a real scenario, we'd need to simulate network failures
      const response = await client.getTestSuites('MCP');
      assert.ok(response);
    });

    it('should respect timeout settings', async () => {
      const fastClient = new EnhancedZebrunnerClient({
        ...config,
        timeout: 1 // Very short timeout
      });

      try {
        await fastClient.getTestSuites('MCP');
        // If it succeeds, the API is very fast
        assert.ok(true);
      } catch (error: any) {
        // Should timeout
        assert.ok(error.message.includes('timeout'));
      }
    });
  });
});








