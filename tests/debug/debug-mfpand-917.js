#!/usr/bin/env node

import "dotenv/config";
import { EnhancedZebrunnerClient } from '../../dist/api/enhanced-client.js';
import { HierarchyProcessor } from '../../dist/utils/hierarchy.js';

async function debugMFPAND917() {
  const config = {
    baseUrl: process.env.ZEBRUNNER_URL,
    username: process.env.ZEBRUNNER_LOGIN,
    token: process.env.ZEBRUNNER_TOKEN,
    defaultPageSize: 10,
    maxPageSize: 100
  };

  console.log('🔍 Debugging Hierarchy for MFPAND-917');
  console.log('Expected: Test Case → 736 → 657 → 609 → Root(605)');
  console.log('');

  const client = new EnhancedZebrunnerClient(config);

  try {
    // Get the test case first
    console.log('📋 Getting test case MFPAND-917...');
    const testCase = await client.getTestCaseByKey('MFPAND', 'MFPAND-917', { includeSuiteHierarchy: true });
    console.log(`✅ Test Case: ${testCase.title}`);
    console.log(`   Test Case ID: ${testCase.id}`);
    console.log(`   Test Suite ID: ${testCase.testSuite?.id}`);
    console.log(`   Feature Suite ID: ${testCase.featureSuiteId}`);
    console.log(`   Root Suite ID: ${testCase.rootSuiteId}`);
    console.log('');

    // Get all suites and find the specific ones in the hierarchy
    console.log('📁 Getting all suites for hierarchy analysis...');
    let allSuites = [];
    let page = 0;
    let hasMore = true;
    const pageSize = 100;

    while (hasMore && page < 20) { // Increase limit to ensure we get all suites
      const result = await client.getTestSuites('MFPAND', {
        size: pageSize,
        page: page
      });

      allSuites.push(...result.items);
      hasMore = result.items.length === pageSize;
      console.log(`   Page ${page}: ${result.items.length} suites (total: ${allSuites.length})`);
      page++;
    }

    console.log(`✅ Total suites: ${allSuites.length}`);
    console.log('');

    // Find the specific suites in the expected hierarchy
    const suite736 = allSuites.find(s => s.id === 736);
    const suite657 = allSuites.find(s => s.id === 657);
    const suite609 = allSuites.find(s => s.id === 609);
    const suite605 = allSuites.find(s => s.id === 605);

    console.log('🔍 Expected Suite Details:');
    [
      { id: 605, name: 'Root Suite', suite: suite605 },
      { id: 609, name: 'Suite 609', suite: suite609 },
      { id: 657, name: 'Suite 657', suite: suite657 },
      { id: 736, name: 'Feature Suite', suite: suite736 }
    ].forEach(({ id, name, suite }) => {
      if (suite) {
        console.log(`   ${name} (${id}): "${suite.name || suite.title}"`);
        console.log(`      Parent ID: ${suite.parentSuiteId || 'None'}`);
      } else {
        console.log(`   ❌ ${name} (${id}) not found`);
      }
    });
    console.log('');

    // Test hierarchy processing
    console.log('🌳 Testing hierarchy processing...');
    const processedSuites = HierarchyProcessor.setRootParentsToSuites(allSuites);
    
    const processedSuite736 = processedSuites.find(s => s.id === 736);
    if (processedSuite736) {
      console.log(`✅ Processed Suite 736:`);
      console.log(`   Name: ${processedSuite736.name || processedSuite736.title}`);
      console.log(`   Parent Suite ID: ${processedSuite736.parentSuiteId}`);
      console.log(`   Parent Suite Name: ${processedSuite736.parentSuiteName}`);
      console.log(`   Root Suite ID: ${processedSuite736.rootSuiteId}`);
      console.log(`   Root Suite Name: ${processedSuite736.rootSuiteName}`);
      console.log(`   Tree Names: ${processedSuite736.treeNames}`);
    }
    console.log('');

    // Test manual root finding
    console.log('🔧 Manual Root Finding for Suite 736:');
    const rootId = HierarchyProcessor.getRootId(allSuites, 736);
    console.log(`   Calculated Root ID: ${rootId}`);
    
    // Trace the parent chain manually
    console.log('   Parent Chain:');
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
    console.log('');

    // Test getSuiteHierarchyPath
    console.log('📍 Testing getSuiteHierarchyPath for suite 736...');
    const hierarchyPath = await client.getSuiteHierarchyPath('MFPAND', 736);
    console.log(`✅ Hierarchy Path (${hierarchyPath.length} levels):`);
    hierarchyPath.forEach((suite, index) => {
      console.log(`   ${index + 1}. ${suite.name} (ID: ${suite.id})`);
    });
    console.log('');

    // Verify against expected path
    const expectedPath = [605, 609, 657, 736];
    console.log('🎯 Expected vs Actual Path:');
    expectedPath.forEach((expectedId, index) => {
      const actual = hierarchyPath[index];
      if (actual && actual.id === expectedId) {
        console.log(`   ✅ Level ${index + 1}: ${actual.name} (ID: ${actual.id})`);
      } else {
        console.log(`   ❌ Level ${index + 1}: Expected ID ${expectedId}, got ${actual ? `${actual.name} (${actual.id})` : 'missing'}`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  }
}

debugMFPAND917().catch(console.error);
