#!/usr/bin/env node

import "dotenv/config";
import { EnhancedZebrunnerClient } from './dist/api/enhanced-client.js';

const config = {
  baseUrl: process.env.ZEBRUNNER_URL,
  username: process.env.ZEBRUNNER_LOGIN,
  token: process.env.ZEBRUNNER_TOKEN,
  defaultPageSize: 50,
  maxPageSize: 100,
  debug: false
};

const client = new EnhancedZebrunnerClient(config);

async function testJavaApproach() {
  try {
    console.log('🧪 Testing Java approach implementation...\n');
    console.log('📊 Expected: 4,548 total test cases for MFPAND project');
    console.log('📊 Expected: 493 test cases for suite 605 (root suite based)\n');
    
    const startTime = Date.now();
    
    // Test 1: Get ALL test cases for the project (Java: getAllTCMTestCasesByProject)
    console.log('1️⃣ Getting ALL test cases for MFPAND project...');
    const allTestCases = await client.getAllTCMTestCasesByProject('MFPAND');
    console.log(`   ✅ Total test cases found: ${allTestCases.length}`);
    console.log(`   🎯 Expected: 4,548 test cases`);
    
    if (allTestCases.length === 4548) {
      console.log('   🎉 PERFECT MATCH! Test case count matches Java implementation exactly.');
    } else if (Math.abs(allTestCases.length - 4548) <= 50) {
      console.log(`   ✅ CLOSE MATCH! Within 50 test cases (difference: ${Math.abs(allTestCases.length - 4548)})`);
    } else {
      console.log(`   ⚠️  MISMATCH! Expected 4,548, found ${allTestCases.length} (difference: ${Math.abs(allTestCases.length - 4548)})`);
    }
    
    // Test 2: Get test cases for suite 605 using root suite filtering (Java: getAllTCMTestCasesBySuiteId with basedOnRootSuites=true)
    console.log('\n2️⃣ Getting test cases for suite 605 (root suite based)...');
    const suite605TestCases = await client.getAllTCMTestCasesBySuiteId('MFPAND', 605, true);
    console.log(`   ✅ Test cases in root suite 605: ${suite605TestCases.length}`);
    console.log(`   🎯 Expected: 493 test cases`);
    
    if (suite605TestCases.length === 493) {
      console.log('   🎉 PERFECT MATCH! Suite 605 test case count matches expectation exactly.');
    } else if (Math.abs(suite605TestCases.length - 493) <= 10) {
      console.log(`   ✅ CLOSE MATCH! Within 10 test cases (difference: ${Math.abs(suite605TestCases.length - 493)})`);
    } else {
      console.log(`   ⚠️  MISMATCH! Expected 493, found ${suite605TestCases.length} (difference: ${Math.abs(suite605TestCases.length - 493)})`);
    }
    
    // Test 3: Get test cases for suite 605 using direct suite filtering (Java: getAllTCMTestCasesBySuiteId with basedOnRootSuites=false)
    console.log('\n3️⃣ Getting test cases directly in suite 605 (direct suite based)...');
    const suite605DirectTestCases = await client.getAllTCMTestCasesBySuiteId('MFPAND', 605, false);
    console.log(`   ✅ Test cases directly in suite 605: ${suite605DirectTestCases.length}`);
    
    // Test 4: Test a specific subsuite (736 from MFPAND-917)
    console.log('\n4️⃣ Getting test cases for suite 736 (direct suite based)...');
    const suite736TestCases = await client.getAllTCMTestCasesBySuiteId('MFPAND', 736, false);
    console.log(`   ✅ Test cases in suite 736: ${suite736TestCases.length}`);
    
    if (suite736TestCases.length > 0) {
      console.log(`   📋 Sample test cases: ${suite736TestCases.slice(0, 3).map(tc => tc.key).join(', ')}`);
    }
    
    const endTime = Date.now();
    
    // Summary
    console.log('\n📊 FINAL SUMMARY:');
    console.log(`   🔢 Total test cases in project: ${allTestCases.length} (expected: 4,548)`);
    console.log(`   🌳 Root suite 605 test cases: ${suite605TestCases.length} (expected: 493)`);
    console.log(`   📁 Direct suite 605 test cases: ${suite605DirectTestCases.length}`);
    console.log(`   📁 Direct suite 736 test cases: ${suite736TestCases.length}`);
    console.log(`   ⏱️  Total processing time: ${endTime - startTime}ms`);
    
    // Verify hierarchy is working
    if (suite605TestCases.length > 0) {
      const sampleTC = suite605TestCases[0];
      console.log('\n🔍 Sample test case hierarchy:');
      console.log(`   Key: ${sampleTC.key}`);
      console.log(`   Suite ID: ${sampleTC.testSuite?.id}`);
      console.log(`   Root Suite ID: ${sampleTC.rootSuiteId}`);
    }
    
    console.log('\n✅ Java approach test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   API Response:', error.response.status, error.response.statusText);
    }
    process.exit(1);
  }
}

testJavaApproach();
