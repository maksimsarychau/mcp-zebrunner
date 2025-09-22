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

async function testSuite605Hierarchy() {
  try {
    console.log('🧪 Testing Suite 605 hierarchy and test case collection...\n');
    console.log('📊 Expected: 493 test cases in total\n');
    
    const startTime = Date.now();
    
    // Step 1: Get all suites for the project
    console.log('1️⃣ Fetching all suites for MFPAND project...');
    const allSuites = await client.getAllSuitesWithCache('MFPAND');
    console.log(`   ✅ Total suites in project: ${allSuites.length}`);
    
    // Step 2: Find suite 605 and verify it exists
    console.log('\n2️⃣ Locating root suite 605...');
    const rootSuite = allSuites.find(s => s.id === 605);
    if (!rootSuite) {
      throw new Error('Suite 605 not found in project!');
    }
    console.log(`   ✅ Found suite 605: "${rootSuite.name || rootSuite.title}"`);
    console.log(`   📋 Description: ${rootSuite.description || 'No description'}`);
    console.log(`   👆 Parent Suite ID: ${rootSuite.parentSuiteId || 'null (root level)'}`);
    
    // Step 3: Find all subsuites of suite 605 (recursive)
    console.log('\n3️⃣ Finding all subsuites of suite 605...');
    const subsuites = findAllSubsuites(allSuites, 605);
    console.log(`   ✅ Found ${subsuites.length} subsuites (including root 605)`);
    
    // Display the hierarchy tree
    console.log('\n📊 Suite Hierarchy Tree:');
    displaySuiteTree(allSuites, 605, 0);
    
    // Step 4: Use Java approach to get all test cases for root suite 605
    console.log('\n4️⃣ Using Java approach to get test cases for root suite 605...');
    const suite605TestCases = await client.getAllTCMTestCasesBySuiteId('MFPAND', 605, true); // basedOnRootSuites = true
    const totalTestCases = suite605TestCases.length;
    
    const endTime = Date.now();
    
    // Step 5: Display results
    console.log('\n📊 FINAL RESULTS:');
    console.log(`   🎯 Total test cases found: ${totalTestCases}`);
    console.log(`   📈 Expected test cases: 493`);
    console.log(`   ⏱️  Total processing time: ${endTime - startTime}ms`);
    
    // Accuracy check
    if (totalTestCases === 493) {
      console.log('   ✅ PERFECT MATCH! Test case count matches expectation exactly.');
    } else if (Math.abs(totalTestCases - 493) <= 10) {
      console.log(`   ✅ CLOSE MATCH! Within 10 test cases of expectation (difference: ${Math.abs(totalTestCases - 493)})`);
    } else {
      console.log(`   ⚠️  MISMATCH! Expected 493, found ${totalTestCases} (difference: ${Math.abs(totalTestCases - 493)})`);
    }
    
    // Display sample test cases
    if (suite605TestCases.length > 0) {
      console.log('\n📋 Sample test cases from suite 605:');
      suite605TestCases.slice(0, 10).forEach((tc, i) => {
        console.log(`   ${i + 1}. ${tc.key}: "${tc.title || 'No title'}" (Suite: ${tc.testSuite?.id})`);
      });
      
      if (suite605TestCases.length > 10) {
        console.log(`   ... and ${suite605TestCases.length - 10} more test cases`);
      }
    }
    
    console.log('\n✅ Suite 605 hierarchy test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   API Response:', error.response.status, error.response.statusText);
    }
    process.exit(1);
  }
}

/**
 * Recursively find all subsuites of a given parent suite
 */
function findAllSubsuites(allSuites, parentSuiteId) {
  const result = [];
  const visited = new Set(); // Prevent infinite loops
  
  function collectSubsuites(suiteId) {
    if (visited.has(suiteId)) return;
    visited.add(suiteId);
    
    const suite = allSuites.find(s => s.id === suiteId);
    if (suite) {
      result.push(suite);
      
      // Find direct children
      const children = allSuites.filter(s => s.parentSuiteId === suiteId);
      for (const child of children) {
        collectSubsuites(child.id);
      }
    }
  }
  
  collectSubsuites(parentSuiteId);
  return result;
}

/**
 * Display suite tree structure
 */
function displaySuiteTree(allSuites, suiteId, depth = 0) {
  const suite = allSuites.find(s => s.id === suiteId);
  if (!suite) return;
  
  const indent = '  '.repeat(depth);
  const suiteName = suite.name || suite.title || 'Unknown';
  console.log(`${indent}├─ ${suite.id}: "${suiteName}"`);
  
  // Find and display children (limit depth to prevent excessive output)
  if (depth < 3) {
    const children = allSuites.filter(s => s.parentSuiteId === suiteId);
    for (const child of children) {
      displaySuiteTree(allSuites, child.id, depth + 1);
    }
  } else if (depth === 3) {
    const childCount = allSuites.filter(s => s.parentSuiteId === suiteId).length;
    if (childCount > 0) {
      console.log(`${indent}  └─ ... (${childCount} more subsuites)`);
    }
  }
}

testSuite605Hierarchy();
