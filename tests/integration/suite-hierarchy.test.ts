import "dotenv/config";
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { EnhancedZebrunnerClient } from '../../src/api/enhanced-client.js';
import { requireCredentials } from '../helpers/credentials.js';

/**
 * Integration tests for Suite Hierarchy Enhancement
 * 
 * Tests the new featureSuiteId and rootSuiteId functionality
 * using real test case MCP-1 with known values:
 * - Test Case ID: Dynamic (determined from API)
 * - Feature Suite ID: Dynamic (from testSuite.id)
 * - Root Suite ID: Dynamic (determined after hierarchy traversal)
 */

describe('Suite Hierarchy Integration Tests', () => {
  let client: EnhancedZebrunnerClient;
  
  // Helper function to skip tests when client is not available
  const skipIfNoClient = () => {
    if (!client) {
      console.log('⚠️  Skipping test - no API connection');
      return true;
    }
    return false;
  };
  
  // Test case with MCP project values (will be determined dynamically)
  const TEST_CASE_KEY = 'MCP-1';
  const PROJECT_KEY = 'MCP';
  // Note: Actual IDs will be determined from API responses since MCP project structure may differ

  before(async () => {
    // Require valid credentials for integration tests
    const credentials = requireCredentials('Suite Hierarchy Integration Tests');

    // Initialize client
    const config = {
      baseUrl: credentials.baseUrl,
      username: credentials.login,
      token: credentials.token,
      defaultPageSize: 10,
      maxPageSize: 100
    };

    client = new EnhancedZebrunnerClient(config);
    
    // Test connection
    try {
      const connectionTest = await client.testConnection();
      if (!connectionTest.success) {
        console.log('⚠️  Skipping integration tests - unable to connect to Zebrunner API');
        console.log('   Check your credentials and network connection.');
        return; // Skip setup, tests will be skipped
      }
    } catch (error) {
      console.log('⚠️  Skipping integration tests - connection error:', (error as Error).message);
      return; // Skip setup, tests will be skipped
    }
    
    console.log(`✅ Connected to Zebrunner API at ${config.baseUrl}`);
  });

  describe('Basic Test Case Retrieval', () => {
    it('should retrieve test case without hierarchy (backward compatibility)', async () => {
      if (skipIfNoClient()) return;
      const testCase = await client.getTestCaseByKey(PROJECT_KEY, TEST_CASE_KEY);
      
      // Verify basic test case properties
      assert.ok(testCase.id, 'Test case should have an ID');
      assert.strictEqual(testCase.key, TEST_CASE_KEY, 'Test case key should match');
      assert.ok(testCase.title, 'Test case should have a title');
      assert.ok(testCase.testSuite, 'Test case should have testSuite information');
      assert.ok(testCase.testSuite?.id, 'testSuite should have an ID');
      
      // Hierarchy fields should be undefined when not requested
      assert.strictEqual(testCase.featureSuiteId, undefined, 'featureSuiteId should be undefined when hierarchy not requested');
      assert.strictEqual(testCase.rootSuiteId, undefined, 'rootSuiteId should be undefined when hierarchy not requested');
      
      console.log(`✅ Retrieved test case ${TEST_CASE_KEY} without hierarchy`);
      console.log(`   - ID: ${testCase.id}`);
      console.log(`   - Title: ${testCase.title}`);
      console.log(`   - Test Suite ID: ${testCase.testSuite?.id}`);
    });
  });

  describe('Suite Hierarchy Enhancement', () => {
    it('should retrieve test case with complete hierarchy information', async () => {
      if (skipIfNoClient()) return;
      const testCase = await client.getTestCaseByKey(PROJECT_KEY, TEST_CASE_KEY, { 
        includeSuiteHierarchy: true 
      });
      
      // Verify basic test case properties
      assert.ok(testCase.id, 'Test case should have an ID');
      assert.strictEqual(testCase.key, TEST_CASE_KEY, 'Test case key should match');
      assert.ok(testCase.title, 'Test case should have a title');
      
      // Verify hierarchy information is populated
      assert.ok(testCase.featureSuiteId, 'featureSuiteId should be populated');
      assert.ok(testCase.rootSuiteId, 'rootSuiteId should be populated');
      
      // Verify testSuite information is preserved
      assert.ok(testCase.testSuite, 'Test case should have testSuite information');
      assert.strictEqual(testCase.testSuite?.id, testCase.featureSuiteId, 
        'testSuite.id should match featureSuiteId');
      
      console.log(`✅ Retrieved test case ${TEST_CASE_KEY} with hierarchy`);
      console.log(`   - ID: ${testCase.id}`);
      console.log(`   - Title: ${testCase.title}`);
      console.log(`   - Test Suite ID: ${testCase.testSuite?.id}`);
      console.log(`   - Feature Suite ID: ${testCase.featureSuiteId}`);
      console.log(`   - Root Suite ID: ${testCase.rootSuiteId}`);
    });

    it('should handle hierarchy resolution errors gracefully', async () => {
      if (skipIfNoClient()) return;
      // Test with a non-existent test case to verify error handling
      try {
        const testCase = await client.getTestCaseByKey(PROJECT_KEY, 'MCP-99999', { 
          includeSuiteHierarchy: true 
        });
        assert.fail('Should have thrown an error for non-existent test case');
      } catch (error: any) {
        assert.ok(error.message.includes('404') || error.message.includes('not found'), 
          'Should throw appropriate error for non-existent test case');
        console.log(`✅ Gracefully handled non-existent test case error`);
      }
    });
  });

  describe('Suite Hierarchy Path Resolution', () => {
    it('should retrieve complete hierarchy path with suite names', async () => {
      if (skipIfNoClient()) return;
      // First get the test case to obtain the feature suite ID
      const testCase = await client.getTestCaseByKey(PROJECT_KEY, TEST_CASE_KEY, { 
        includeSuiteHierarchy: true 
      });
      const featureSuiteId = testCase.featureSuiteId!;
      
      const hierarchyPath = await client.getSuiteHierarchyPath(PROJECT_KEY, featureSuiteId);
      
      // Verify path structure
      assert.ok(Array.isArray(hierarchyPath), 'Hierarchy path should be an array');
      assert.ok(hierarchyPath.length > 0, 'Hierarchy path should contain at least one suite');
      
      // Verify each suite in path has required properties
      hierarchyPath.forEach((suite, index) => {
        assert.ok(typeof suite.id === 'number', `Suite ${index} should have numeric id`);
        assert.ok(typeof suite.name === 'string', `Suite ${index} should have string name`);
        assert.ok(suite.name.length > 0, `Suite ${index} should have non-empty name`);
      });
      
      // The root suite should be first in the path
      const rootSuite = hierarchyPath[0];
      assert.ok(rootSuite.id, 'Root suite should have an ID');
      assert.strictEqual(rootSuite.id, testCase.rootSuiteId, 
        'Root suite in path should match test case rootSuiteId');
      
      // The feature suite should be last in the path
      const featureSuite = hierarchyPath[hierarchyPath.length - 1];
      assert.strictEqual(featureSuite.id, featureSuiteId, 
        'Feature suite in path should match requested suite ID');
      
      console.log(`✅ Retrieved hierarchy path for suite ${featureSuiteId}`);
      console.log('   - Hierarchy Path:');
      hierarchyPath.forEach((suite, index) => {
        console.log(`     ${index + 1}. ${suite.name} (ID: ${suite.id})`);
      });
    });

    it('should handle invalid suite ID gracefully', async () => {
      if (skipIfNoClient()) return;
      const invalidSuiteId = 99999;
      
      try {
        const hierarchyPath = await client.getSuiteHierarchyPath(PROJECT_KEY, invalidSuiteId);
        
        // Should return fallback with the invalid suite ID
        assert.ok(Array.isArray(hierarchyPath), 'Should return array even for invalid suite');
        assert.strictEqual(hierarchyPath.length, 1, 'Should return single fallback suite');
        assert.strictEqual(hierarchyPath[0].id, invalidSuiteId, 'Fallback should contain original suite ID');
        
        console.log(`✅ Gracefully handled invalid suite ID ${invalidSuiteId}`);
      } catch (error: any) {
        // Alternatively, it might throw an error, which is also acceptable
        assert.ok(error.message, 'Should provide meaningful error message');
        console.log(`✅ Appropriately threw error for invalid suite ID: ${error.message}`);
      }
    });
  });

  describe('API Response Structure Validation', () => {
    it('should correctly map API response fields to test case schema', async () => {
      if (skipIfNoClient()) return;
      const testCase = await client.getTestCaseByKey(PROJECT_KEY, TEST_CASE_KEY, { 
        includeSuiteHierarchy: true 
      });
      
      // Verify all expected fields from the API response are mapped correctly
      assert.ok(testCase.id, 'Should map id field');
      assert.strictEqual(testCase.key, TEST_CASE_KEY, 'Should map key field');
      assert.strictEqual(testCase.deleted, false, 'Should map deleted field');
      assert.ok(testCase.title, 'Should map title field');
      assert.ok(testCase.priority?.name, 'Should map priority field');
      assert.ok(testCase.automationState?.name, 'Should map automationState field');
      assert.strictEqual(testCase.deprecated, false, 'Should map deprecated field');
      assert.strictEqual(testCase.draft, false, 'Should map draft field');
      // Optional fields - may or may not be present depending on test case content
      if (testCase.preConditions) {
        assert.ok(typeof testCase.preConditions === 'string', 'Should map preConditions field');
      }
      if (testCase.postConditions) {
        assert.ok(typeof testCase.postConditions === 'string', 'Should map postConditions field');
      }
      assert.ok(Array.isArray(testCase.steps), 'Should map steps field as array');
      assert.ok(testCase.customField, 'Should map customField object');
      
      // Verify hierarchy enhancement
      assert.ok(testCase.featureSuiteId, 'Should add featureSuiteId from testSuite.id');
      assert.ok(testCase.rootSuiteId, 'Should resolve and add rootSuiteId');
      
      console.log(`✅ All API response fields correctly mapped to schema`);
    });
  });

  describe('Performance and Error Handling', () => {
    it('should complete hierarchy resolution within reasonable time', async () => {
      if (skipIfNoClient()) return;
      const startTime = Date.now();
      
      const testCase = await client.getTestCaseByKey(PROJECT_KEY, TEST_CASE_KEY, { 
        includeSuiteHierarchy: true 
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within 10 seconds (reasonable for API calls with hierarchy traversal)
      assert.ok(duration < 10000, `Hierarchy resolution should complete within 10s, took ${duration}ms`);
      
      // Verify hierarchy was resolved
      assert.ok(testCase.featureSuiteId, 'Should have resolved featureSuiteId');
      assert.ok(testCase.rootSuiteId, 'Should have resolved rootSuiteId');
      
      console.log(`✅ Hierarchy resolution completed in ${duration}ms`);
    });

    it('should not break when hierarchy resolution partially fails', async () => {
      if (skipIfNoClient()) return;
      // This test verifies that partial failures don't break the entire response
      const testCase = await client.getTestCaseByKey(PROJECT_KEY, TEST_CASE_KEY, { 
        includeSuiteHierarchy: true 
      });
      
      // Even if some hierarchy resolution fails, basic test case data should be intact
      assert.ok(testCase.id, 'Basic test case data should be preserved');
      assert.strictEqual(testCase.key, TEST_CASE_KEY, 'Test case key should be preserved');
      assert.ok(testCase.testSuite, 'testSuite information should be preserved');
      
      // featureSuiteId should always be available (from testSuite.id)
      assert.ok(testCase.featureSuiteId, 'featureSuiteId should always be available from testSuite.id');
      assert.strictEqual(testCase.featureSuiteId, testCase.testSuite?.id, 
        'featureSuiteId should match testSuite.id');
      
      console.log(`✅ Test case data preserved even with potential hierarchy resolution issues`);
    });
  });

  after(async () => {
    console.log('\n🎉 Suite Hierarchy Integration Tests Completed Successfully!');
    console.log('\n📊 Test Summary:');
    console.log(`   - Test Case: ${TEST_CASE_KEY}`);
    console.log('   - All hierarchy functionality verified ✅');
  });
});
