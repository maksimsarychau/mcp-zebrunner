#!/usr/bin/env node

import "dotenv/config";
import { EnhancedZebrunnerClient } from './dist/api/enhanced-client.js';

async function testOrphanedFix() {
  const config = {
    baseUrl: process.env.ZEBRUNNER_URL,
    username: process.env.ZEBRUNNER_LOGIN,
    token: process.env.ZEBRUNNER_TOKEN,
    defaultPageSize: 10,
    maxPageSize: 100
  };

  console.log('🧪 Testing Orphaned Suite Fix for MFPAND-917');
  const client = new EnhancedZebrunnerClient(config);

  try {
    // Test the fix with MFPAND-917
    console.log('📋 Getting MFPAND-917 with hierarchy enhancement...');
    const testCase = await client.getTestCaseByKey('MFPAND', 'MFPAND-917', { includeSuiteHierarchy: true });
    
    console.log('✅ Results:');
    console.log(`   Test Case: ${testCase.title}`);
    console.log(`   Test Case ID: ${testCase.id}`);
    console.log(`   Test Suite ID: ${testCase.testSuite?.id}`);
    console.log(`   Feature Suite ID: ${testCase.featureSuiteId || 'undefined (orphaned)'}`);
    console.log(`   Root Suite ID: ${testCase.rootSuiteId || 'undefined (orphaned)'}`);
    console.log('');

    // Also test with a known working test case for comparison
    console.log('📋 Comparing with working test case MFPAND-6013...');
    const workingTestCase = await client.getTestCaseByKey('MFPAND', 'MFPAND-6013', { includeSuiteHierarchy: true });
    
    console.log('✅ Working test case results:');
    console.log(`   Test Case: ${workingTestCase.title}`);
    console.log(`   Test Case ID: ${workingTestCase.id}`);
    console.log(`   Test Suite ID: ${workingTestCase.testSuite?.id}`);
    console.log(`   Feature Suite ID: ${workingTestCase.featureSuiteId}`);
    console.log(`   Root Suite ID: ${workingTestCase.rootSuiteId}`);
    console.log('');

    console.log('🎯 Summary:');
    console.log(`   MFPAND-917 (orphaned): Feature=${testCase.featureSuiteId || 'undefined'}, Root=${testCase.rootSuiteId || 'undefined'}`);
    console.log(`   MFPAND-6013 (working): Feature=${workingTestCase.featureSuiteId}, Root=${workingTestCase.rootSuiteId}`);
    
    if (testCase.featureSuiteId === undefined && testCase.rootSuiteId === undefined) {
      console.log('✅ Fix working: Orphaned suite properly handled with undefined values');
    } else {
      console.log('❌ Fix not working: Orphaned suite still showing incorrect hierarchy');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testOrphanedFix().catch(console.error);
