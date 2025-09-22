#!/usr/bin/env node

import "dotenv/config";
import { EnhancedZebrunnerClient } from './dist/api/enhanced-client.js';

const config = {
  baseUrl: process.env.ZEBRUNNER_URL,
  username: process.env.ZEBRUNNER_LOGIN,
  token: process.env.ZEBRUNNER_TOKEN,
  defaultPageSize: 50,
  maxPageSize: 100,
  debug: true // Enable debug to see API calls
};

const client = new EnhancedZebrunnerClient(config);

async function debugTestCases() {
  try {
    console.log('🔍 Debugging test case retrieval...\n');
    
    // Test 1: Get all test cases without filtering
    console.log('1️⃣ Getting ALL test cases for MFPAND (first page)...');
    const allTestCases = await client.getTestCases('MFPAND', { size: 10 });
    console.log(`   Total test cases found: ${allTestCases.items.length}`);
    
    if (allTestCases.items.length > 0) {
      const firstTestCase = allTestCases.items[0];
      console.log(`   First test case: ${firstTestCase.key}`);
      console.log(`   Suite ID: ${firstTestCase.testSuite?.id || firstTestCase.suiteId || 'Unknown'}`);
      
      // Test 2: Try to get test cases for the suite of the first test case
      const firstSuiteId = firstTestCase.testSuite?.id || firstTestCase.suiteId;
      if (firstSuiteId) {
        console.log(`\n2️⃣ Getting test cases specifically for suite ${firstSuiteId}...`);
        const suiteTestCases = await client.getTestCases('MFPAND', { suiteId: firstSuiteId, size: 10 });
        console.log(`   Test cases in suite ${firstSuiteId}: ${suiteTestCases.items.length}`);
        
        if (suiteTestCases.items.length > 0) {
          console.log(`   Keys: ${suiteTestCases.items.map(tc => tc.key).join(', ')}`);
        }
      }
    }
    
    // Test 3: Check specific suites from our hierarchy (736, 657, 609, 605)
    console.log('\n3️⃣ Testing specific suites from MFPAND-917 hierarchy...');
    const testSuiteIds = [736, 657, 609, 605];
    
    for (const suiteId of testSuiteIds) {
      console.log(`\n   Testing suite ${suiteId}:`);
      const suiteTestCases = await client.getTestCases('MFPAND', { suiteId: suiteId, size: 5 });
      console.log(`   → ${suiteTestCases.items.length} test cases`);
      
      if (suiteTestCases.items.length > 0) {
        console.log(`   → Keys: ${suiteTestCases.items.map(tc => tc.key).slice(0, 3).join(', ')}${suiteTestCases.items.length > 3 ? '...' : ''}`);
      }
    }
    
    console.log('\n✅ Debug completed!');
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    if (error.response) {
      console.error('   API Response:', error.response.status, error.response.statusText);
    }
    process.exit(1);
  }
}

debugTestCases();
