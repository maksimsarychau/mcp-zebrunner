import "dotenv/config";
import { EnhancedZebrunnerClient } from "../../src/api/enhanced-client.js";

/** Smoke test for Zebrunner API client (without MCP) */

const ZEBRUNNER_URL = process.env.ZEBRUNNER_URL?.replace(/\/+$/, "");
const ZEBRUNNER_LOGIN = process.env.ZEBRUNNER_LOGIN;
const ZEBRUNNER_TOKEN = process.env.ZEBRUNNER_TOKEN;

if (!ZEBRUNNER_URL || !ZEBRUNNER_LOGIN || !ZEBRUNNER_TOKEN) {
  console.error("Missing env: ZEBRUNNER_URL / ZEBRUNNER_LOGIN / ZEBRUNNER_TOKEN");
  process.exit(1);
}

const client = new EnhancedZebrunnerClient({
  baseUrl: ZEBRUNNER_URL,
  username: ZEBRUNNER_LOGIN,
  token: ZEBRUNNER_TOKEN,
  defaultPageSize: 50,
  retryAttempts: 3,
  retryDelay: 1000,
  debug: false
});

async function smokeTest() {
  try {
    console.log("🔍 Testing Zebrunner API connection...\n");

    // Test 0: Test connection using project key like test 1
    console.log("0. Testing API connection...");
    try {
      const connectionTest = await client.getTestSuites("MCP", { size: 1 });
      if (connectionTest.items && connectionTest.items.length >= 0) {
        console.log("   ✅ Connection successful!");
      } else {
        console.log("   ⚠️  Connection test failed: No response data");
      }
    } catch (err: any) {
      console.log(`   ⚠️  Connection test error: ${err.message}`);
    }

    // Test 1: List test suites for MCP project
    console.log("\n1. Listing test suites for project MCP...");
    const testSuitesResponse = await client.getTestSuites("MCP", { size: 10 });
    const testSuites = testSuitesResponse.items || [];
    console.log(`   Found ${testSuites.length} test suites:`);
    testSuites.slice(0, 3).forEach((s: any) => {
      console.log(`   - ID: ${s.id}, Title: ${s.title || 'N/A'}, Description: ${s.description || 'N/A'}`);
    });
    if (testSuites.length > 3) {
      console.log(`   ... and ${testSuites.length - 3} more`);
    }

    if (testSuites.length === 0) {
      console.log("❌ No test suites found. Check your credentials or permissions.");
      return;
    }

    // Test 2: Demonstrate test suite hierarchy
    console.log(`\n2. Demonstrating test suite hierarchy...`);
    const rootSuites = testSuites.filter(suite => suite.parentSuiteId === null);
    const childSuites = testSuites.filter(suite => suite.parentSuiteId !== null);
    
    console.log(`   Found ${rootSuites.length} root suites:`);
    rootSuites.forEach(suite => {
      console.log(`   📁 Root: ${suite.title} (ID: ${suite.id})`);
      const children = childSuites.filter(child => child.parentSuiteId === suite.id);
      children.forEach(child => {
        console.log(`      └── Child: ${child.title} (ID: ${child.id})`);
      });
    });
    
    if (childSuites.length > 0) {
      console.log(`   Total child suites: ${childSuites.length}`);
    }

    // Test 3: List test cases for first test suite
    const firstSuite = testSuites[0];
    console.log(`\n3. Listing test cases for test suite ${firstSuite.id}...`);
    try {
      const testCasesResponse = await client.getTestCases("MCP", { suiteId: firstSuite.id, size: 5 });
      const testCases = testCasesResponse.items || [];
      console.log(`   Found ${testCases.length} test cases`);
      testCases.slice(0, 3).forEach((tc: any) => {
        console.log(`   - Key: ${tc.key || 'N/A'}, Title: ${tc.title || 'N/A'}`);
      });
      if (testCases.length > 3) {
        console.log(`   ... and ${testCases.length - 3} more`);
      }

      // Test 4: Get details of first test case using key-based retrieval
      if (testCases.length > 0) {
        const firstCase = testCases[0];
        console.log(`\n4. Getting details for test case ${firstCase.key || firstCase.id}...`);
        try {
          if (firstCase.key) {
            const details = await client.getTestCaseByKey("MCP", firstCase.key);
            console.log(`   ✅ Success! Test case details:`);
            console.log(`   Key: ${details.key || 'N/A'}`);
            console.log(`   Title: ${details.title || 'N/A'}`);
            console.log(`   Priority: ${details.priority?.name || 'N/A'}`);
            console.log(`   Automation State: ${details.automationState?.name || 'N/A'}`);
            console.log(`   Description: ${details.description ? details.description.substring(0, 100) + '...' : 'N/A'}`);
            console.log(`   Steps: ${Array.isArray(details.steps) ? details.steps.length : 'N/A'}`);
          } else {
            console.log(`   ⚠️  Test case has no key, cannot retrieve detailed information`);
            console.log(`   Basic info - Title: ${firstCase.title || 'N/A'}`);
          }
        } catch (err: any) {
          console.log(`   ⚠️  Failed to get test case details: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.log(`   ⚠️  Failed to list test cases: ${err.message}`);
    }

    // Test 5: Get test case by key (MCP-1)
    console.log(`\n5. Getting test case MCP-1 details...`);
    try {
      const testCase = await client.getTestCaseByKey("MCP", "MCP-1");
      console.log(`   ✅ Success! Test case details:`);
      console.log(`   Key: ${testCase.key || 'N/A'}`);
      console.log(`   Title: ${testCase.title || 'N/A'}`);
      console.log(`   Priority: ${testCase.priority?.name || 'N/A'}`);
      console.log(`   Automation State: ${testCase.automationState?.name || 'N/A'}`);
      console.log(`   Created By: ${testCase.createdBy?.username || 'N/A'}`);
      console.log(`   Steps: ${Array.isArray(testCase.steps) ? testCase.steps.length : 'N/A'}`);
      console.log(`   Custom Fields: ${testCase.customField ? Object.keys(testCase.customField).length + ' fields' : 'N/A'}`);
    } catch (err: any) {
      console.log(`   ⚠️  Failed to get test case by key: ${err.message}`);
    }

    // Test 6: Get all test cases for project (limited sample)
    console.log(`\n6. Getting all test cases for project MCP (sample)...`);
    try {
      const allTestCasesResponse = await client.getTestCases("MCP", { size: 5 });
      const allTestCases = allTestCasesResponse.items || [];
      console.log(`   Found ${allTestCases.length} test cases (showing first 5):`);
      allTestCases.forEach((tc: any) => {
        console.log(`   - Key: ${tc.key || 'N/A'}, Title: ${tc.title || 'N/A'}, Priority: ${tc.priority?.name || 'N/A'}`);
      });
    } catch (err: any) {
      console.log(`   ⚠️  Failed to get test cases: ${err.message}`);
    }

    console.log("\n✅ Smoke test completed!");
    
  } catch (error: any) {
    console.error("❌ Smoke test failed:", error.message);
    if (error.response) {
      console.error("   Status:", error.response.status);
      console.error("   Data:", error.response.data);
    }
    process.exit(1);
  }
}

smokeTest();

