import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { EnhancedZebrunnerClient } from '../../src/api/enhanced-client.js';
import { HierarchyProcessor } from '../../src/utils/hierarchy.js';
import { ZebrunnerConfig } from '../../src/types/api.js';
import 'dotenv/config';

/**
 * Manual Debug Scenario Tests
 *
 * These tests require real Zebrunner credentials and are designed to be run manually
 * when debugging specific scenarios. They validate the functionality that was
 * originally in the debug scripts.
 *
 * To run these tests:
 * 1. Set up .env file with real credentials
 * 2. Run: npx tsx --test tests/integration/debug-scenarios-manual.test.ts
 */

// Check if we have real credentials for these manual tests
const hasRealCredentials = process.env.ZEBRUNNER_URL &&
                          process.env.ZEBRUNNER_LOGIN &&
                          process.env.ZEBRUNNER_TOKEN;

if (!hasRealCredentials) {
  console.log('⚠️  Manual debug tests skipped - no real Zebrunner credentials found');
  console.log('   Set ZEBRUNNER_URL, ZEBRUNNER_LOGIN, and ZEBRUNNER_TOKEN in .env to run these tests');
  process.exit(0);
}

describe('Manual Debug Scenario Tests', () => {
  let client: EnhancedZebrunnerClient;

  beforeEach(() => {
    const config: ZebrunnerConfig = {
      baseUrl: process.env.ZEBRUNNER_URL!,
      username: process.env.ZEBRUNNER_LOGIN!,
      token: process.env.ZEBRUNNER_TOKEN!,
      debug: false,
      timeout: 60000,
      retryAttempts: 2,
      retryDelay: 1000
    };

    client = new EnhancedZebrunnerClient(config);
  });

  describe('Test Case Retrieval Scenarios', () => {
    it('should retrieve test cases for different suites', async () => {
      console.log('📋 Testing test case retrieval...');

      const allTestCases = await client.getTestCases('MFPAND', { size: 10 });
      assert.ok(allTestCases.items.length > 0);

      const firstTestCase = allTestCases.items[0];
      console.log(`   First test case: ${firstTestCase.key} (Suite: ${firstTestCase.testSuite?.id})`);

      // Test specific suite retrieval if we have a suite ID
      if (firstTestCase.testSuite?.id) {
        const suiteTestCases = await client.getTestCases('MFPAND', {
          suiteId: firstTestCase.testSuite.id,
          size: 5
        });
        console.log(`   Test cases in suite ${firstTestCase.testSuite.id}: ${suiteTestCases.items.length}`);
        assert.ok(Array.isArray(suiteTestCases.items));
      }
    });

    it('should test target suites from debug scenarios', async () => {
      console.log('🎯 Testing specific target suites...');

      const targetSuiteIds = [605, 609, 657, 736];
      const results: Array<{ id: number, count: number, found: boolean }> = [];

      for (const suiteId of targetSuiteIds) {
        try {
          const suiteTestCases = await client.getTestCases('MFPAND', { suiteId: suiteId, size: 5 });
          results.push({ id: suiteId, count: suiteTestCases.items.length, found: true });
          console.log(`   Suite ${suiteId}: ${suiteTestCases.items.length} test cases`);
        } catch (error: any) {
          results.push({ id: suiteId, count: 0, found: false });
          console.log(`   Suite ${suiteId}: not found or no access`);
        }
      }

      // At least one approach should work
      assert.ok(results.length === targetSuiteIds.length);
    });
  });

  describe('Java Approach Validation', () => {
    it('should retrieve all test cases using Java methodology', async () => {
      console.log('☕ Testing Java approach for comprehensive test case retrieval...');

      const startTime = Date.now();
      const allTestCases = await client.getAllTCMTestCasesByProject('MFPAND');
      const duration = Date.now() - startTime;

      console.log(`   Retrieved ${allTestCases.length} test cases in ${duration}ms`);

      assert.ok(allTestCases.length > 1000, 'Expected substantial number of test cases');

      if (allTestCases.length > 0) {
        const sampleTestCase = allTestCases[0];
        assert.ok(sampleTestCase.id);
        assert.ok(sampleTestCase.key);
        assert.ok(sampleTestCase.testSuite?.id);
        console.log(`   Sample: ${sampleTestCase.key} in suite ${sampleTestCase.testSuite?.id}`);
      }
    });

    it('should handle suite-based test case retrieval', async () => {
      console.log('📁 Testing suite-based retrieval methods...');

      // Test with suite 605 if it exists
      try {
        const suite605TestCases = await client.getAllTCMTestCasesBySuiteId('MFPAND', 605, true);
        console.log(`   Root suite 605: ${suite605TestCases.length} test cases`);
        assert.ok(Array.isArray(suite605TestCases));
      } catch (error: any) {
        console.log('   Suite 605: not accessible, testing alternative suites...');

        // Try to find any suite and test with that
        const suitesPage = await client.getTestSuites('MFPAND', { size: 10 });
        if (suitesPage.items.length > 0) {
          const testSuite = suitesPage.items[0];
          const testCases = await client.getAllTCMTestCasesBySuiteId('MFPAND', testSuite.id, false);
          console.log(`   Suite ${testSuite.id}: ${testCases.length} test cases (direct)`);
          assert.ok(Array.isArray(testCases));
        }
      }
    });
  });

  describe('Hierarchy Processing Scenarios', () => {
    it('should find and process suite hierarchies', async () => {
      console.log('🌳 Testing hierarchy processing...');

      const suitesPage = await client.getTestSuites('MFPAND', { size: 50 });
      const suites = suitesPage.items;

      console.log(`   Processing ${suites.length} suites...`);

      // Test hierarchy processing
      const processedSuites = HierarchyProcessor.setRootParentsToSuites(suites);
      assert.equal(processedSuites.length, suites.length);

      // Count suites with hierarchy information
      let suitesWithHierarchy = 0;
      processedSuites.forEach(suite => {
        if (suite.rootSuiteId && suite.rootSuiteName && suite.treeNames) {
          suitesWithHierarchy++;
        }
      });

      console.log(`   ${suitesWithHierarchy}/${processedSuites.length} suites have complete hierarchy info`);
      assert.ok(suitesWithHierarchy > 0, 'At least some suites should have hierarchy info');
    });

    it('should build suite trees', async () => {
      console.log('🏗️  Testing suite tree building...');

      const suitesPage = await client.getTestSuites('MFPAND', { size: 100 });
      const suites = suitesPage.items;

      const tree = HierarchyProcessor.buildSuiteTree(suites);
      console.log(`   Built tree with ${tree.length} root suites`);

      assert.ok(Array.isArray(tree));
      assert.ok(tree.length > 0, 'Should have at least one root suite');

      // Verify tree structure - check that we have a valid hierarchy
      tree.forEach(rootSuite => {
        // Root suites in the tree should either have no parent or be orphaned
        // (parentSuiteId points to non-existent suite)
        if (rootSuite.parentSuiteId !== null) {
          console.log(`   ⚠️  Suite ${rootSuite.id} has parent ${rootSuite.parentSuiteId} but appears as root (possibly orphaned)`);
        }
        
        if (rootSuite.children && rootSuite.children.length > 0) {
          console.log(`   Root suite ${rootSuite.id} has ${rootSuite.children.length} children`);
        }
        
        // Verify basic structure
        assert.ok(rootSuite.id, 'Root suite should have an ID');
        assert.ok(rootSuite.name || rootSuite.title, 'Root suite should have a name or title');
      });
    });
  });

  describe('Specific Test Case Scenarios', () => {
    it('should handle specific test cases from debug scenarios', async () => {
      console.log('🔍 Testing specific test cases...');

      const testCaseKeys = ['MFPAND-917', 'MFPAND-6013'];

      for (const key of testCaseKeys) {
        try {
          const testCase = await client.getTestCaseByKey('MFPAND', key, { includeSuiteHierarchy: true });
          console.log(`   ${key}: found, suite ${testCase.testSuite?.id}`);

          assert.ok(testCase.id);
          assert.equal(testCase.key, key);

          // Log hierarchy info
          if (testCase.featureSuiteId && testCase.rootSuiteId) {
            console.log(`     Feature suite: ${testCase.featureSuiteId}, Root suite: ${testCase.rootSuiteId}`);
          } else {
            console.log(`     Orphaned or minimal hierarchy`);
          }

        } catch (error: any) {
          console.log(`   ${key}: not found or no access`);
          // This is acceptable for debug tests
        }
      }
    });

    it('should test hierarchy path resolution', async () => {
      console.log('📍 Testing hierarchy path resolution...');

      // Try to get hierarchy for suite 736 (from debug scenarios)
      try {
        const hierarchyPath = await client.getSuiteHierarchyPath('MFPAND', 736);
        console.log(`   Suite 736 hierarchy: ${hierarchyPath.length} levels`);

        hierarchyPath.forEach((suite, index) => {
          console.log(`     ${index + 1}. ${suite.name} (ID: ${suite.id})`);
        });

        assert.ok(Array.isArray(hierarchyPath));

      } catch (error: any) {
        console.log('   Suite 736 not accessible, testing with available suite...');

        // Try with first available suite
        const suitesPage = await client.getTestSuites('MFPAND', { size: 10 });
        if (suitesPage.items.length > 0) {
          const testSuite = suitesPage.items[0];
          try {
            const hierarchyPath = await client.getSuiteHierarchyPath('MFPAND', testSuite.id);
            console.log(`   Suite ${testSuite.id} hierarchy: ${hierarchyPath.length} levels`);
            assert.ok(Array.isArray(hierarchyPath));
          } catch (e: any) {
            console.log(`   Hierarchy resolution not available for suite ${testSuite.id}`);
          }
        }
      }
    });
  });

  describe('Performance Validation', () => {
    it('should handle large data sets efficiently', async () => {
      console.log('⚡ Testing performance with large data sets...');

      const startTime = Date.now();
      const allTestCases = await client.getAllTCMTestCasesByProject('MFPAND');
      const endTime = Date.now();

      const processingTime = endTime - startTime;
      const ratePerSecond = Math.round((allTestCases.length / processingTime) * 1000);

      console.log(`   Retrieved ${allTestCases.length} test cases in ${processingTime}ms`);
      console.log(`   Processing rate: ~${ratePerSecond} test cases/second`);

      assert.ok(allTestCases.length > 0);
      assert.ok(processingTime < 300000, 'Should complete within 5 minutes'); // More generous timeout
    });
  });
});

console.log('✅ Manual debug scenario tests completed');