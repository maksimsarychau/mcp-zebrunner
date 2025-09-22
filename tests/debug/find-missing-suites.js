#!/usr/bin/env node

import "dotenv/config";
import { EnhancedZebrunnerClient } from '../../dist/api/enhanced-client.js';

async function findMissingSuites() {
  const config = {
    baseUrl: process.env.ZEBRUNNER_URL,
    username: process.env.ZEBRUNNER_LOGIN,
    token: process.env.ZEBRUNNER_TOKEN,
    defaultPageSize: 10,
    maxPageSize: 100
  };

  console.log('🔍 Searching for Missing Suites: 605, 609, 657, 736');
  const client = new EnhancedZebrunnerClient(config);

  try {
    // First, let's check if MFPAND-917 test case actually belongs to MFPAND project
    console.log('📋 Verifying test case project...');
    try {
      const testCase = await client.getTestCaseByKey('MFPAND', 'MFPAND-917');
      console.log(`✅ Found MFPAND-917 in MFPAND project`);
      console.log(`   Test Suite ID: ${testCase.testSuite?.id}`);
      console.log(`   Project Key from test case: ${testCase.projectKey || 'Not specified'}`);
    } catch (error) {
      console.log(`❌ MFPAND-917 not found in MFPAND: ${error.message}`);
      
      // Try other common project keys
      const projectsToTry = ['MFPIOS', 'MFP', 'TEST'];
      for (const projectKey of projectsToTry) {
        try {
          console.log(`   Trying project ${projectKey}...`);
          const testCase = await client.getTestCaseByKey(projectKey, 'MFPAND-917');
          console.log(`   ✅ Found MFPAND-917 in ${projectKey} project!`);
          console.log(`      Test Suite ID: ${testCase.testSuite?.id}`);
          return; // Exit early if found
        } catch (e) {
          console.log(`   ❌ Not in ${projectKey}`);
        }
      }
    }
    console.log('');

    // Get more pages from MFPAND to see if suites are further down
    console.log('📁 Searching through more MFPAND suites...');
    let allSuites = [];
    let page = 0;
    let hasMore = true;
    const pageSize = 100;
    const targetSuites = [605, 609, 657, 736];
    const foundSuites = new Map();

    while (hasMore && page < 50) { // Search up to 5000 suites
      const result = await client.getTestSuites('MFPAND', {
        size: pageSize,
        page: page
      });

      allSuites.push(...result.items);
      
      // Check if we found any target suites in this page
      result.items.forEach(suite => {
        if (targetSuites.includes(suite.id)) {
          foundSuites.set(suite.id, suite);
          console.log(`   ✅ Found suite ${suite.id}: "${suite.name || suite.title}" (Parent: ${suite.parentSuiteId || 'None'})`);
        }
      });

      hasMore = result.items.length === pageSize;
      console.log(`   Page ${page}: ${result.items.length} suites (total: ${allSuites.length}, found: ${foundSuites.size}/${targetSuites.length})`);
      
      // If we found all target suites, we can stop
      if (foundSuites.size === targetSuites.length) {
        console.log(`   ✅ Found all target suites! Stopping search.`);
        break;
      }
      
      page++;
    }

    console.log('');
    console.log('📊 Search Results:');
    console.log(`   Total suites searched: ${allSuites.length}`);
    console.log(`   Target suites found: ${foundSuites.size}/${targetSuites.length}`);
    console.log('');

    if (foundSuites.size > 0) {
      console.log('✅ Found Suites:');
      targetSuites.forEach(id => {
        const suite = foundSuites.get(id);
        if (suite) {
          console.log(`   Suite ${id}: "${suite.name || suite.title}"`);
          console.log(`      Parent ID: ${suite.parentSuiteId || 'None'}`);
          console.log(`      Project ID: ${suite.projectId || 'None'}`);
        }
      });
      
      // If we found some suites, test the hierarchy
      console.log('');
      console.log('🌳 Testing hierarchy with found suites...');
      const { HierarchyProcessor } = await import('../../dist/utils/hierarchy.js');
      
      // Find suite 736 (the feature suite)
      const suite736 = foundSuites.get(736);
      if (suite736) {
        const rootId = HierarchyProcessor.getRootId(allSuites, 736);
        console.log(`   Root ID for suite 736: ${rootId}`);
        
        // Build the hierarchy path manually
        console.log('   Hierarchy path:');
        let currentId = 736;
        let depth = 0;
        const visited = new Set();
        
        while (currentId && !visited.has(currentId) && depth < 10) {
          visited.add(currentId);
          const currentSuite = allSuites.find(s => s.id === currentId);
          
          if (currentSuite) {
            console.log(`     ${depth}: Suite ${currentId} "${currentSuite.name || currentSuite.title}" → Parent: ${currentSuite.parentSuiteId || 'None'}`);
            currentId = currentSuite.parentSuiteId;
          } else {
            console.log(`     ${depth}: Suite ${currentId} NOT FOUND`);
            break;
          }
          depth++;
        }
      }
      
    } else {
      console.log('❌ None of the target suites found in MFPAND project');
      console.log('   This suggests the test case might be in a different project');
      console.log('   or the suites might have been deleted/moved.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

findMissingSuites().catch(console.error);
