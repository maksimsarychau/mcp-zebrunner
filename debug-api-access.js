#!/usr/bin/env node

import "dotenv/config";
import { EnhancedZebrunnerClient } from './dist/api/enhanced-client.js';

async function debugApiAccess() {
  const config = {
    baseUrl: process.env.ZEBRUNNER_URL,
    username: process.env.ZEBRUNNER_LOGIN,
    token: process.env.ZEBRUNNER_TOKEN,
    defaultPageSize: 10,
    maxPageSize: 100
  };

  console.log('🔍 Debugging API Access');
  console.log('Base URL:', config.baseUrl);
  console.log('Username:', config.username);

  const client = new EnhancedZebrunnerClient(config);

  try {
    // Test connection
    console.log('\n📡 Testing connection...');
    const connection = await client.testConnection();
    console.log('Connection:', connection.success ? '✅ Success' : '❌ Failed');

    // Try to get some test cases from MFPAND project
    console.log('\n🔍 Getting test cases from MFPAND project...');
    const testCases = await client.getTestCases('MFPAND', { size: 5 });
    console.log(`Found ${testCases.items.length} test cases:`);
    
    testCases.items.forEach((testCase, index) => {
      console.log(`  ${index + 1}. ${testCase.key} - ${testCase.title || 'No title'}`);
      if (testCase.testSuite) {
        console.log(`     Suite ID: ${testCase.testSuite.id}`);
      }
    });

    // Try to get test case MFPAND-6013 specifically
    console.log('\n🎯 Trying to get MFPAND-6013...');
    try {
      const specificCase = await client.getTestCaseByKey('MFPAND', 'MFPAND-6013');
      console.log('✅ Found test case:', specificCase.key);
      console.log('   ID:', specificCase.id);
      console.log('   Title:', specificCase.title);
      console.log('   Test Suite ID:', specificCase.testSuite?.id);
    } catch (error) {
      console.log('❌ Failed to get MFPAND-6013:', error.message);
    }

    // Try to get suite 18667 directly
    console.log('\n🗂️  Trying to get suite 18667...');
    try {
      const suiteResponse = await client.http.get('/test-suites/18667', {
        params: { projectKey: 'MFPAND' }
      });
      console.log('✅ Found suite 18667:', suiteResponse.data?.data?.name || 'No name');
    } catch (error) {
      console.log('❌ Failed to get suite 18667:', error.message);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

debugApiAccess().catch(console.error);
