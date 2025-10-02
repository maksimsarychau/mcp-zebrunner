import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SemanticDuplicateAnalyzer } from '../../src/utils/semantic-duplicate-analyzer.js';
import { ZebrunnerTestCase } from '../../src/types/core.js';

describe('SemanticDuplicateAnalyzer', () => {
  const options = {
    stepClusteringThreshold: 0.85,
    testCaseClusteringThreshold: 0.80,
    useStepClustering: true,
    useMedoidSelection: true,
    includeSemanticPatterns: true
  };
  
  const analyzer = new SemanticDuplicateAnalyzer(80, options);

  it('should perform basic semantic analysis without LLM', async () => {
    const testCases: ZebrunnerTestCase[] = [
      {
        id: 1,
        key: 'TEST-1',
        title: 'Login test for Free user',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Open login page', expectedResult: 'Login page displays' },
          { id: 2, action: 'Enter credentials', expectedResult: 'Credentials entered' },
          { id: 3, action: 'Click login button', expectedResult: 'User logged in' }
        ]
      },
      {
        id: 2,
        key: 'TEST-2',
        title: 'Login test for Premium user',
        automationState: { id: 2, name: 'Automated' },
        steps: [
          { id: 1, action: 'Open login page', expectedResult: 'Login page displays' },
          { id: 2, action: 'Enter credentials', expectedResult: 'Credentials entered' },
          { id: 3, action: 'Click login button', expectedResult: 'User logged in' }
        ]
      }
    ];

    const result = await analyzer.analyzeSemanticDuplicates(testCases, 'TEST');
    
    assert.strictEqual(result.projectKey, 'TEST');
    assert.strictEqual(result.totalTestCases, 2);
    assert.strictEqual(result.analysisMode, 'hybrid');
    assert.ok(result.stepClusters);
    assert.ok(result.semanticInsights);
    
    // Should have step clusters
    assert.ok(result.stepClusters.length > 0);
    
    // Should have basic insights
    assert.ok(Array.isArray(result.semanticInsights.commonStepPatterns));
    assert.ok(Array.isArray(result.semanticInsights.discoveredWorkflows));
    assert.ok(Array.isArray(result.semanticInsights.automationOpportunities));
  });

  it('should create step clusters correctly', async () => {
    const testCases: ZebrunnerTestCase[] = [
      {
        id: 1,
        key: 'TEST-1',
        title: 'Test 1',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Open application', expectedResult: 'App opens' },
          { id: 2, action: 'Navigate to settings', expectedResult: 'Settings page shown' }
        ]
      },
      {
        id: 2,
        key: 'TEST-2',
        title: 'Test 2',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Launch application', expectedResult: 'Application starts' },
          { id: 2, action: 'Go to settings menu', expectedResult: 'Settings displayed' }
        ]
      }
    ];

    const result = await analyzer.analyzeSemanticDuplicates(testCases, 'TEST');
    
    // Should create step clusters for similar actions
    assert.ok(result.stepClusters.length > 0);
    
    // Each step cluster should have proper structure
    result.stepClusters.forEach(cluster => {
      assert.ok(cluster.id);
      assert.ok(cluster.representativeStep);
      assert.ok(typeof cluster.frequency === 'number');
      assert.ok(cluster.semanticSummary);
      assert.ok(Array.isArray(cluster.steps));
    });
  });

  it('should use medoid selection when enabled', async () => {
    const testCases: ZebrunnerTestCase[] = [
      {
        id: 1,
        key: 'TEST-1',
        title: 'Similar test 1',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Step A', expectedResult: 'Result A' },
          { id: 2, action: 'Step B', expectedResult: 'Result B' }
        ]
      },
      {
        id: 2,
        key: 'TEST-2',
        title: 'Similar test 2',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Step A', expectedResult: 'Result A' },
          { id: 2, action: 'Step B', expectedResult: 'Result B' }
        ]
      },
      {
        id: 3,
        key: 'TEST-3',
        title: 'Similar test 3',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Step A', expectedResult: 'Result A' },
          { id: 2, action: 'Step B', expectedResult: 'Result B' }
        ]
      }
    ];

    const result = await analyzer.analyzeSemanticDuplicates(testCases, 'TEST');
    
    if (result.clustersFound > 0) {
      const cluster = result.semanticClusters?.[0] || result.clusters[0];
      assert.ok(cluster.medoidTestCase || cluster.recommendedBase.testCaseKey);
    }
  });

  it('should handle empty test cases gracefully', async () => {
    const testCases: ZebrunnerTestCase[] = [];
    
    const result = await analyzer.analyzeSemanticDuplicates(testCases, 'TEST');
    
    assert.strictEqual(result.totalTestCases, 0);
    assert.strictEqual(result.clustersFound, 0);
    assert.strictEqual(result.potentialSavings.duplicateTestCases, 0);
  });

  it('should provide semantic insights', async () => {
    const testCases: ZebrunnerTestCase[] = [
      {
        id: 1,
        key: 'TEST-1',
        title: 'Manual test case',
        automationState: { id: 1, name: 'Not Automated' },
        steps: [
          { id: 1, action: 'Common action', expectedResult: 'Common result' }
        ]
      },
      {
        id: 2,
        key: 'TEST-2',
        title: 'Another manual test',
        automationState: { id: 1, name: 'Not Automated' },
        steps: [
          { id: 1, action: 'Common action', expectedResult: 'Common result' }
        ]
      }
    ];

    const result = await analyzer.analyzeSemanticDuplicates(testCases, 'TEST');
    
    assert.ok(result.semanticInsights);
    assert.ok(Array.isArray(result.semanticInsights.commonStepPatterns));
    assert.ok(Array.isArray(result.semanticInsights.discoveredWorkflows));
    assert.ok(Array.isArray(result.semanticInsights.automationOpportunities));
    
    // Should identify automation opportunities for manual tests
    if (result.clustersFound > 0) {
      assert.ok(result.semanticInsights.automationOpportunities.length > 0);
    }
  });

  it('should calculate Jaccard and cosine similarities', async () => {
    const testCases: ZebrunnerTestCase[] = [
      {
        id: 1,
        key: 'TEST-1',
        title: 'Test with specific steps',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Unique step A', expectedResult: 'Result A' },
          { id: 2, action: 'Common step', expectedResult: 'Common result' },
          { id: 3, action: 'Unique step B', expectedResult: 'Result B' }
        ]
      },
      {
        id: 2,
        key: 'TEST-2',
        title: 'Test with overlapping steps',
        automationState: { id: 1, name: 'Manual' },
        steps: [
          { id: 1, action: 'Common step', expectedResult: 'Common result' },
          { id: 2, action: 'Different step', expectedResult: 'Different result' }
        ]
      }
    ];

    const result = await analyzer.analyzeSemanticDuplicates(testCases, 'TEST');
    
    if (result.similarityMatrix && result.similarityMatrix.length > 0) {
      const similarity = result.similarityMatrix[0];
      assert.ok('stepClusterOverlap' in similarity);
      assert.ok('semanticConfidence' in similarity);
      assert.ok('clusterBasedSimilarity' in similarity);
    }
  });
});
