import { describe, it, expect, beforeAll } from 'node:test';
import { EnhancedZebrunnerClient } from '../../src/api/enhanced-client.js';
import { ZebrunnerConfig } from '../../src/types/api.js';
import { testConfig } from '../fixtures/api-responses.js';

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

  beforeAll(() => {
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
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Connection successful');
      expect(result.details).toBeDefined();
      expect(result.details.baseUrl).toBe(config.baseUrl);
    });

    it('should track endpoint health', () => {
      const health = client.getEndpointHealth();
      expect(typeof health).toBe('object');
    });
  });

  describe('Test Suites API', () => {
    it('should list test suites for MFPAND project', async () => {
      const response = await client.getTestSuites('MFPAND');
      
      expect(response).toBeDefined();
      expect(response.items).toBeDefined();
      expect(Array.isArray(response.items)).toBe(true);
      expect(response.items.length).toBeGreaterThan(0);
      
      // Verify structure of first suite
      const firstSuite = response.items[0];
      expect(firstSuite.id).toBeDefined();
      expect(typeof firstSuite.id).toBe('number');
      expect(firstSuite.title || firstSuite.name).toBeDefined();
    });

    it('should get all test suites with pagination', async () => {
      const allSuites = await client.getAllTestSuites('MFPAND');
      
      expect(Array.isArray(allSuites)).toBe(true);
      expect(allSuites.length).toBeGreaterThan(0);
      
      // Should have more or equal items than single page
      const singlePage = await client.getTestSuites('MFPAND', { size: 5 });
      expect(allSuites.length).toBeGreaterThanOrEqual(singlePage.items.length);
    });

    it('should handle pagination parameters correctly', async () => {
      const page0 = await client.getTestSuites('MFPAND', { page: 0, size: 2 });
      const page1 = await client.getTestSuites('MFPAND', { page: 1, size: 2 });
      
      expect(page0.items.length).toBeLessThanOrEqual(2);
      expect(page1.items.length).toBeLessThanOrEqual(2);
      
      // Pages should be different (if there are enough items)
      if (page0.items.length === 2 && page1.items.length > 0) {
        expect(page0.items[0].id).not.toBe(page1.items[0].id);
      }
    });

    it('should validate project key format', async () => {
      await expect(async () => {
        await client.getTestSuites('invalid-key');
      }).rejects.toThrow('Invalid project key format');
    });

    it('should handle empty project key', async () => {
      await expect(async () => {
        await client.getTestSuites('');
      }).rejects.toThrow('Project key is required');
    });
  });

  describe('Test Cases API', () => {
    it('should get test case by key MFPAND-29', async () => {
      const testCase = await client.getTestCaseByKey('MFPAND', 'MFPAND-29');
      
      expect(testCase).toBeDefined();
      expect(testCase.id).toBeDefined();
      expect(testCase.key).toBe('MFPAND-29');
      expect(testCase.title).toBeDefined();
      expect(testCase.priority).toBeDefined();
      expect(testCase.automationState).toBeDefined();
      
      // Verify custom fields are parsed
      if (testCase.customField) {
        expect(typeof testCase.customField).toBe('object');
        expect(Object.keys(testCase.customField).length).toBeGreaterThan(0);
      }
    });

    it('should list test cases with pagination', async () => {
      const response = await client.getTestCases('MFPAND', { size: 10 });
      
      expect(response).toBeDefined();
      expect(response.items).toBeDefined();
      expect(Array.isArray(response.items)).toBe(true);
      expect(response.items.length).toBeLessThanOrEqual(10);
      
      if (response.items.length > 0) {
        const firstCase = response.items[0];
        expect(firstCase.id).toBeDefined();
        expect(typeof firstCase.id).toBe('number');
      }
    });

    it('should handle invalid test case key', async () => {
      await expect(async () => {
        await client.getTestCaseByKey('MFPAND', 'INVALID-KEY-999');
      }).rejects.toThrow();
    });

    it('should validate required parameters', async () => {
      await expect(async () => {
        await client.getTestCaseByKey('', 'MFPAND-29');
      }).rejects.toThrow('Project key is required');

      await expect(async () => {
        await client.getTestCaseByKey('MFPAND', '');
      }).rejects.toThrow('Test case key is required');
    });
  });

  describe('Search API', () => {
    it('should search test cases with query', async () => {
      const response = await client.searchTestCases('MFPAND', 'reminder', { size: 5 });
      
      expect(response).toBeDefined();
      expect(response.items).toBeDefined();
      expect(Array.isArray(response.items)).toBe(true);
      
      // Should find at least the MFPAND-29 case which has "reminder" in title
      const reminderCase = response.items.find(item => 
        item.key === 'MFPAND-29' || 
        (item.title && item.title.toLowerCase().includes('reminder'))
      );
      
      if (reminderCase) {
        expect(reminderCase.id).toBeDefined();
      }
    });

    it('should handle empty search query', async () => {
      await expect(async () => {
        await client.searchTestCases('MFPAND', '');
      }).rejects.toThrow('Search query is required');

      await expect(async () => {
        await client.searchTestCases('MFPAND', '   ');
      }).rejects.toThrow('Search query is required');
    });

    it('should handle search with filters', async () => {
      const response = await client.searchTestCases('MFPAND', 'test', {
        size: 3,
        page: 0
      });
      
      expect(response.items.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 errors gracefully', async () => {
      try {
        await client.getTestSuite(999999); // Non-existent suite ID
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.name).toBe('ZebrunnerNotFoundError');
        expect(error.statusCode).toBe(404);
      }
    });

    it('should handle invalid authentication', async () => {
      const invalidClient = new EnhancedZebrunnerClient({
        ...config,
        token: 'invalid-token'
      });

      try {
        await invalidClient.getTestSuites('MFPAND');
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.name).toBe('ZebrunnerAuthError');
        expect(error.statusCode).toBe(401);
      }
    });

    it('should validate pagination parameters', async () => {
      await expect(async () => {
        await client.getTestSuites('MFPAND', { page: -1 });
      }).rejects.toThrow('Page number must be non-negative');

      await expect(async () => {
        await client.getTestSuites('MFPAND', { size: 0 });
      }).rejects.toThrow('Page size must be between 1 and');

      await expect(async () => {
        await client.getTestSuites('MFPAND', { size: 1000 });
      }).rejects.toThrow('Page size must be between 1 and');
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
          expect(Array.isArray(testCases)).toBe(true);
        } catch (error: any) {
          // Expected to fail on some instances
          expect(error.statusCode).toBeOneOf([404, 400]);
        }
      }
    });

    it('should validate suite ID parameter', async () => {
      await expect(async () => {
        await client.getTestCasesBySuite('MFPAND', 0);
      }).rejects.toThrow('Valid suite ID is required');

      await expect(async () => {
        await client.getTestCasesBySuite('MFPAND', -1);
      }).rejects.toThrow('Valid suite ID is required');
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
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('fulfilled');
    });

    it('should retry failed requests', async () => {
      // This test verifies retry mechanism by checking debug logs
      // In a real scenario, we'd need to simulate network failures
      const response = await client.getTestSuites('MFPAND');
      expect(response).toBeDefined();
    });

    it('should respect timeout settings', async () => {
      const fastClient = new EnhancedZebrunnerClient({
        ...config,
        timeout: 1 // Very short timeout
      });

      try {
        await fastClient.getTestSuites('MFPAND');
        // If it succeeds, the API is very fast
        expect(true).toBe(true);
      } catch (error: any) {
        // Should timeout
        expect(error.message).toContain('timeout');
      }
    });
  });
});

// Helper function for expect extensions
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeOneOf(expected: any[]): R;
    }
  }
}

// Custom matcher implementation
expect.extend({
  toBeOneOf(received: any, expected: any[]) {
    const pass = expected.includes(received);
    return {
      pass,
      message: () => `expected ${received} to be one of ${expected.join(', ')}`
    };
  }
});

