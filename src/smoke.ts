import "dotenv/config";
import { ZebrunnerClient } from "./zebrunnerClient.js";

/** Smoke test for Zebrunner API client (without MCP) */

const ZEBRUNNER_URL = process.env.ZEBRUNNER_URL?.replace(/\/+$/, "");
const ZEBRUNNER_LOGIN = process.env.ZEBRUNNER_LOGIN;
const ZEBRUNNER_TOKEN = process.env.ZEBRUNNER_TOKEN;

if (!ZEBRUNNER_URL || !ZEBRUNNER_LOGIN || !ZEBRUNNER_TOKEN) {
  console.error("Missing env: ZEBRUNNER_URL / ZEBRUNNER_LOGIN / ZEBRUNNER_TOKEN");
  process.exit(1);
}

const client = new ZebrunnerClient({
  baseUrl: ZEBRUNNER_URL,
  username: ZEBRUNNER_LOGIN,
  token: ZEBRUNNER_TOKEN
});

async function smokeTest() {
  try {
    console.log("🔍 Testing Zebrunner API connection...\n");

    // Test 1: List test suites for MFPAND project
    console.log("1. Listing test suites for project MFPAND...");
    const testSuites = await client.listTestSuites({ projectKey: "MFPAND" });
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

    // Test 2: Get details of first test suite
    const firstSuite = testSuites[0];
    console.log(`\n2. Getting details for test suite ${firstSuite.id}...`);
    try {
      const suiteDetails = await client.getTestSuite(firstSuite.id);
      console.log(`   Title: ${suiteDetails.title || 'N/A'}`);
      console.log(`   Description: ${suiteDetails.description || 'N/A'}`);
      console.log(`   Project ID: ${suiteDetails.projectId || 'N/A'}`);
      console.log(`   Project Key: ${suiteDetails.projectKey || 'N/A'}`);
    } catch (err: any) {
      console.log(`   ⚠️  Failed to get test suite details: ${err.message}`);
    }

    // Test 3: List test cases for first test suite
    console.log(`\n3. Listing test cases for test suite ${firstSuite.id}...`);
    try {
      const testCases = await client.listTestCases(firstSuite.id);
      console.log(`   Found ${testCases.length} test cases`);
      testCases.slice(0, 3).forEach((tc: any) => {
        console.log(`   - ID: ${tc.id}, Title: ${tc.title || 'N/A'}, Status: ${tc.status || 'N/A'}`);
      });
      if (testCases.length > 3) {
        console.log(`   ... and ${testCases.length - 3} more`);
      }

      // Test 4: Get details of first test case (if any)
      if (testCases.length > 0) {
        const firstCase = testCases[0];
        console.log(`\n4. Getting details for test case ${firstCase.id}...`);
        try {
          const details = await client.getTestCase(firstCase.id);
          console.log(`   Title: ${details.title || 'N/A'}`);
          console.log(`   Status: ${details.status || 'N/A'}`);
          console.log(`   Description: ${details.description ? details.description.substring(0, 100) + '...' : 'N/A'}`);
          console.log(`   Steps: ${Array.isArray(details.steps) ? details.steps.length : 'N/A'}`);
        } catch (err: any) {
          console.log(`   ⚠️  Failed to get test case details: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.log(`   ⚠️  Failed to list test cases: ${err.message}`);
    }

    // Test 5: Get test case by key (MFPAND-29)
    console.log(`\n5. Getting test case MFPAND-29 details...`);
    try {
      const testCase = await client.getTestCaseByKey("MFPAND-29", "MFPAND");
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

    // Test 6: Search test cases
    console.log(`\n6. Searching test cases in project MFPAND for 'test'...`);
    try {
      const searchResults = await client.searchTestCases({ 
        projectKey: "MFPAND",
        query: 'test', 
        page: 0, 
        size: 5 
      });
      const items = Array.isArray(searchResults) ? searchResults : 
                   (Array.isArray(searchResults?.content) ? searchResults.content : []);
      console.log(`   Found ${items.length} results`);
      items.forEach((tc: any) => {
        console.log(`   - ID: ${tc.id}, Title: ${tc.title || 'N/A'}`);
      });
    } catch (err: any) {
      console.log(`   ⚠️  Search failed: ${err.message}`);
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
