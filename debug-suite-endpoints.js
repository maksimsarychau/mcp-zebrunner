#!/usr/bin/env node

import "dotenv/config";
import { EnhancedZebrunnerClient } from './dist/api/enhanced-client.js';

async function debugSuiteEndpoints() {
  const config = {
    baseUrl: process.env.ZEBRUNNER_URL,
    username: process.env.ZEBRUNNER_LOGIN,
    token: process.env.ZEBRUNNER_TOKEN,
    defaultPageSize: 10,
    maxPageSize: 100
  };

  console.log('🔍 Testing Suite Endpoints');
  const client = new EnhancedZebrunnerClient(config);

  try {
    // Try to get test suites from MFPAND project
    console.log('\n📁 Getting test suites from MFPAND project...');
    const suites = await client.getTestSuites('MFPAND', { size: 10 });
    console.log(`Found ${suites.items.length} suites:`);
    
    suites.items.forEach((suite, index) => {
      console.log(`  ${index + 1}. Suite ID: ${suite.id} - ${suite.name || suite.title || 'No name'}`);
      console.log(`     Parent Suite ID: ${suite.parentSuiteId || 'None'}`);
      console.log(`     Root Suite ID: ${suite.rootSuiteId || 'None'}`);
      console.log('');
    });

    // Check if suite 18667 is in the list
    const suite18667 = suites.items.find(s => s.id === 18667);
    if (suite18667) {
      console.log('✅ Found suite 18667 in the list:', suite18667);
    } else {
      console.log('❌ Suite 18667 not found in first 10 suites');
      
      // Try to get more suites
      console.log('\n🔍 Searching through more suites...');
      const allSuites = await client.getTestSuites('MFPAND', { size: 100 });
      const found = allSuites.items.find(s => s.id === 18667);
      if (found) {
        console.log('✅ Found suite 18667 in extended search:', found);
      } else {
        console.log('❌ Suite 18667 still not found in 100 suites');
      }
    }

    // Try different API patterns
    console.log('\n🔧 Testing different API patterns...');
    
    // Pattern 1: test-suites with projectKey param
    try {
      const response1 = await client.http.get('/test-suites', {
        params: { projectKey: 'MFPAND', size: 10 }
      });
      console.log('✅ Pattern 1 (/test-suites with projectKey) works');
      console.log(`   Found ${response1.data?.items?.length || 0} suites`);
    } catch (error) {
      console.log('❌ Pattern 1 failed:', error.message);
    }

    // Pattern 2: Direct suite ID access
    try {
      const response2 = await client.http.get('/test-suites/64'); // Use suite ID we know exists
      console.log('✅ Pattern 2 (/test-suites/ID) works for suite 64');
    } catch (error) {
      console.log('❌ Pattern 2 failed for suite 64:', error.message);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

debugSuiteEndpoints().catch(console.error);
