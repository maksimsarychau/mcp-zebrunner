import { ZebrunnerTestCase } from '../types/core.js';
import { TestCaseDuplicateAnalyzer, DuplicateAnalysisResult, TestCaseStep, SimilarityScore, TestCaseCluster } from './duplicate-analyzer.js';

export interface SemanticAnalysisOptions {
  stepClusteringThreshold: number; // 0.80-0.90 for step similarity
  testCaseClusteringThreshold: number; // 0.80-0.90 for test case similarity
  useStepClustering: boolean; // Two-phase clustering
  useMedoidSelection: boolean; // Better representative selection
  includeSemanticPatterns: boolean; // Enhanced pattern detection
}

export interface StepCluster {
  id: string;
  representativeStep: string;
  steps: TestCaseStep[];
  semanticSummary: string;
  frequency: number;
}

export interface SemanticSimilarityScore extends SimilarityScore {
  stepClusterOverlap: number;
  semanticConfidence: number;
  clusterBasedSimilarity: number;
}

export interface SemanticTestCaseCluster extends TestCaseCluster {
  stepClusters: string[];
  semanticCoherence: number;
  medoidTestCase: string;
  clusterType: 'exact_match' | 'semantic_similar' | 'pattern_based' | 'hybrid';
}

export interface SemanticDuplicateAnalysisResult extends DuplicateAnalysisResult {
  stepClusters: StepCluster[];
  semanticClusters: SemanticTestCaseCluster[];
  analysisMode: 'basic' | 'semantic' | 'hybrid';
  semanticInsights: {
    commonStepPatterns: string[];
    discoveredWorkflows: string[];
    automationOpportunities: string[];
  };
}

export class SemanticDuplicateAnalyzer extends TestCaseDuplicateAnalyzer {
  private options: SemanticAnalysisOptions;
  
  constructor(similarityThreshold: number = 80, options: Partial<SemanticAnalysisOptions> = {}) {
    super(similarityThreshold);
    
    this.options = {
      stepClusteringThreshold: options.stepClusteringThreshold || 0.85,
      testCaseClusteringThreshold: options.testCaseClusteringThreshold || 0.80,
      useStepClustering: options.useStepClustering || true,
      useMedoidSelection: options.useMedoidSelection || true,
      includeSemanticPatterns: options.includeSemanticPatterns || true,
      ...options
    };
  }

  /**
   * Enhanced semantic analysis using LLM-powered step clustering
   */
  async analyzeSemanticDuplicates(
    testCases: ZebrunnerTestCase[], 
    projectKey: string, 
    suiteId?: number,
    llmAnalysisFunction?: (prompt: string) => Promise<string>
  ): Promise<SemanticDuplicateAnalysisResult> {
    
    console.log(`🧠 Starting semantic analysis of ${testCases.length} test cases...`);
    
    // Phase 1: Extract and normalize all steps
    const allSteps = this.extractAllSteps(testCases);
    console.log(`📝 Extracted ${allSteps.length} total steps`);
    
    // Phase 2: Cluster similar steps (using LLM if available)
    const stepClusters = this.options.useStepClustering 
      ? await this.clusterStepsSemantically(allSteps, llmAnalysisFunction)
      : this.clusterStepsBasic(allSteps);
    
    console.log(`🗂️ Created ${stepClusters.length} step clusters`);
    
    // Phase 3: Represent test cases in step-cluster space
    const testCaseVectors = this.createTestCaseVectors(testCases, stepClusters);
    
    // Phase 4: Compute semantic similarities
    const semanticSimilarities = this.computeSemanticSimilarities(testCases, testCaseVectors, stepClusters);
    
    // Phase 5: Create semantic clusters
    const semanticClusters = this.createSemanticClusters(testCases, semanticSimilarities, stepClusters);
    
    // Phase 6: Generate insights
    const semanticInsights = await this.generateSemanticInsights(
      stepClusters, 
      semanticClusters, 
      llmAnalysisFunction
    );
    
    // Calculate potential savings
    const duplicateTestCases = semanticClusters.reduce((sum, cluster) => sum + cluster.testCases.length - 1, 0);
    const estimatedTimeReduction = this.calculateTimeReduction(duplicateTestCases, testCases.length);
    
    return {
      suiteId,
      projectKey,
      totalTestCases: testCases.length,
      clustersFound: semanticClusters.length,
      potentialSavings: {
        duplicateTestCases,
        estimatedTimeReduction
      },
      clusters: semanticClusters,
      stepClusters,
      semanticClusters,
      analysisMode: llmAnalysisFunction ? 'semantic' : 'hybrid',
      semanticInsights,
      similarityMatrix: semanticSimilarities
    };
  }

  /**
   * Extract all steps from all test cases with metadata
   */
  private extractAllSteps(testCases: ZebrunnerTestCase[]): (TestCaseStep & { testCaseId: string })[] {
    const allSteps: (TestCaseStep & { testCaseId: string })[] = [];
    
    testCases.forEach(testCase => {
      const steps = this.extractSteps(testCase);
      steps.forEach(step => {
        allSteps.push({
          ...step,
          testCaseId: testCase.key || `tc-${testCase.id}`
        });
      });
    });
    
    return allSteps;
  }

  /**
   * Cluster steps using LLM semantic understanding
   */
  private async clusterStepsSemantically(
    allSteps: (TestCaseStep & { testCaseId: string })[], 
    llmAnalysisFunction?: (prompt: string) => Promise<string>
  ): Promise<StepCluster[]> {
    
    if (!llmAnalysisFunction) {
      return this.clusterStepsBasic(allSteps);
    }

    // Group steps by similarity using LLM
    const stepTexts = allSteps.map(step => step.action);
    const uniqueSteps = [...new Set(stepTexts)];
    
    if (uniqueSteps.length > 100) {
      console.log(`⚠️ Large number of unique steps (${uniqueSteps.length}), using basic clustering`);
      return this.clusterStepsBasic(allSteps);
    }

    const prompt = `
Analyze these test steps and group them into semantic clusters. Steps that perform the same logical action should be in the same cluster, even if worded differently.

Steps to cluster:
${uniqueSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

Please respond with JSON in this format:
{
  "clusters": [
    {
      "id": "cluster_1",
      "representative": "most common/clear step text",
      "summary": "what this cluster represents",
      "steps": ["step text 1", "step text 2", ...]
    }
  ]
}

Focus on grouping steps that:
- Perform the same action (click, navigate, verify, etc.)
- Target the same UI element or functionality
- Have the same logical intent

Threshold: Group steps that are at least ${Math.round(this.options.stepClusteringThreshold * 100)}% semantically similar.
`;

    try {
      const response = await llmAnalysisFunction(prompt);
      const parsed = JSON.parse(response);
      
      return parsed.clusters.map((cluster: any, index: number) => ({
        id: cluster.id || `cluster_${index + 1}`,
        representativeStep: cluster.representative,
        steps: cluster.steps.map((stepText: string) => {
          const originalStep = allSteps.find(s => s.action === stepText);
          return originalStep || { action: stepText, stepNumber: 0, testCaseId: 'unknown' };
        }),
        semanticSummary: cluster.summary,
        frequency: cluster.steps.length
      }));
      
    } catch (error) {
      console.log(`⚠️ LLM clustering failed, falling back to basic clustering: ${error}`);
      return this.clusterStepsBasic(allSteps);
    }
  }

  /**
   * Basic step clustering using text similarity (fallback)
   */
  private clusterStepsBasic(allSteps: (TestCaseStep & { testCaseId: string })[]): StepCluster[] {
    const clusters: StepCluster[] = [];
    const processed = new Set<string>();
    
    allSteps.forEach((step, index) => {
      if (processed.has(step.action)) return;
      
      const cluster: StepCluster = {
        id: `cluster_${clusters.length + 1}`,
        representativeStep: step.action,
        steps: [step],
        semanticSummary: `Basic cluster for: ${step.action}`,
        frequency: 1
      };
      
      // Find similar steps
      allSteps.slice(index + 1).forEach(otherStep => {
        if (processed.has(otherStep.action)) return;
        
        const similarity = this.calculateTextSimilarity(step.action, otherStep.action);
        if (similarity >= this.options.stepClusteringThreshold) {
          cluster.steps.push(otherStep);
          cluster.frequency++;
          processed.add(otherStep.action);
        }
      });
      
      processed.add(step.action);
      clusters.push(cluster);
    });
    
    return clusters.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Create test case vectors in step-cluster space
   */
  private createTestCaseVectors(
    testCases: ZebrunnerTestCase[], 
    stepClusters: StepCluster[]
  ): Map<string, Map<string, number>> {
    
    const vectors = new Map<string, Map<string, number>>();
    
    testCases.forEach(testCase => {
      const testCaseId = testCase.key || `tc-${testCase.id}`;
      const vector = new Map<string, number>();
      
      // Initialize vector with all clusters
      stepClusters.forEach(cluster => {
        vector.set(cluster.id, 0);
      });
      
      // Count step cluster occurrences
      const steps = this.extractSteps(testCase);
      steps.forEach(step => {
        // Find which cluster this step belongs to
        const cluster = stepClusters.find(c => 
          c.steps.some(clusterStep => 
            this.calculateTextSimilarity(step.action, clusterStep.action) >= this.options.stepClusteringThreshold
          )
        );
        
        if (cluster) {
          vector.set(cluster.id, (vector.get(cluster.id) || 0) + 1);
        }
      });
      
      vectors.set(testCaseId, vector);
    });
    
    return vectors;
  }

  /**
   * Compute semantic similarities using step-cluster vectors
   */
  private computeSemanticSimilarities(
    testCases: ZebrunnerTestCase[],
    testCaseVectors: Map<string, Map<string, number>>,
    stepClusters: StepCluster[]
  ): SemanticSimilarityScore[] {
    
    const similarities: SemanticSimilarityScore[] = [];
    
    for (let i = 0; i < testCases.length; i++) {
      for (let j = i + 1; j < testCases.length; j++) {
        const testCase1 = testCases[i];
        const testCase2 = testCases[j];
        const key1 = testCase1.key || `tc-${testCase1.id}`;
        const key2 = testCase2.key || `tc-${testCase2.id}`;
        
        const vector1 = testCaseVectors.get(key1);
        const vector2 = testCaseVectors.get(key2);
        
        if (!vector1 || !vector2) continue;
        
        // Calculate Jaccard similarity on step clusters
        const jaccardSimilarity = this.calculateJaccardSimilarity(vector1, vector2);
        
        // Calculate cosine similarity on count vectors
        const cosineSimilarity = this.calculateCosineSimilarity(vector1, vector2);
        
        // Combined similarity score
        const combinedSimilarity = (jaccardSimilarity * 0.6) + (cosineSimilarity * 0.4);
        
        if (combinedSimilarity * 100 >= this.options.testCaseClusteringThreshold * 100) {
          // Get original similarity data for compatibility
          const originalSteps1 = this.extractSteps(testCase1);
          const originalSteps2 = this.extractSteps(testCase2);
          const originalSimilarity = this.calculateStepSimilarity(originalSteps1, originalSteps2);
          
          // Detect pattern
          const pattern = this.detectDuplicationPattern(testCase1, testCase2);
          
          similarities.push({
            testCase1Key: key1,
            testCase2Key: key2,
            similarityPercentage: Math.round(combinedSimilarity * 100 * 100) / 100,
            sharedSteps: originalSimilarity.sharedSteps,
            totalSteps1: originalSteps1.length,
            totalSteps2: originalSteps2.length,
            sharedStepsSummary: originalSimilarity.sharedStepsSummary,
            patternType: pattern.patternType,
            variationDetails: pattern.variationDetails,
            stepClusterOverlap: Math.round(jaccardSimilarity * 100),
            semanticConfidence: Math.round(cosineSimilarity * 100),
            clusterBasedSimilarity: Math.round(combinedSimilarity * 100)
          });
        }
      }
    }
    
    return similarities.sort((a, b) => b.similarityPercentage - a.similarityPercentage);
  }

  /**
   * Calculate Jaccard similarity for step cluster vectors
   */
  private calculateJaccardSimilarity(vector1: Map<string, number>, vector2: Map<string, number>): number {
    const keys1 = new Set([...vector1.keys()].filter(k => (vector1.get(k) || 0) > 0));
    const keys2 = new Set([...vector2.keys()].filter(k => (vector2.get(k) || 0) > 0));
    
    const intersection = new Set([...keys1].filter(k => keys2.has(k)));
    const union = new Set([...keys1, ...keys2]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Calculate cosine similarity for step cluster count vectors
   */
  private calculateCosineSimilarity(vector1: Map<string, number>, vector2: Map<string, number>): number {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    // Get all unique keys
    const allKeys = new Set([...vector1.keys(), ...vector2.keys()]);
    
    allKeys.forEach(key => {
      const val1 = vector1.get(key) || 0;
      const val2 = vector2.get(key) || 0;
      
      dotProduct += val1 * val2;
      norm1 += val1 * val1;
      norm2 += val2 * val2;
    });
    
    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Create semantic clusters with enhanced analysis
   */
  private createSemanticClusters(
    testCases: ZebrunnerTestCase[],
    similarities: SemanticSimilarityScore[],
    stepClusters: StepCluster[]
  ): SemanticTestCaseCluster[] {
    
    const clusters: SemanticTestCaseCluster[] = [];
    const processed = new Set<string>();
    const testCaseMap = new Map(testCases.map(tc => [tc.key || `tc-${tc.id}`, tc]));
    
    for (const similarity of similarities) {
      const key1 = similarity.testCase1Key;
      const key2 = similarity.testCase2Key;
      
      if (processed.has(key1) && processed.has(key2)) continue;
      
      // Find existing cluster
      let existingCluster = clusters.find(cluster => 
        cluster.testCases.some(tc => tc.key === key1 || tc.key === key2)
      );
      
      if (existingCluster) {
        // Add unprocessed test case
        const unprocessedKey = processed.has(key1) ? key2 : key1;
        const testCase = testCaseMap.get(unprocessedKey);
        
        if (testCase && !existingCluster.testCases.some(tc => tc.key === unprocessedKey)) {
          existingCluster.testCases.push({
            key: testCase.key || `tc-${testCase.id}`,
            id: testCase.id,
            title: testCase.title || '',
            automationState: testCase.automationState?.name || 'Unknown',
            stepCount: this.extractSteps(testCase).length
          });
          processed.add(unprocessedKey);
        }
      } else {
        // Create new cluster
        const testCase1 = testCaseMap.get(key1);
        const testCase2 = testCaseMap.get(key2);
        
        if (testCase1 && testCase2) {
          const clusterId = `semantic_cluster_${clusters.length + 1}`;
          
          const newCluster: SemanticTestCaseCluster = {
            clusterId,
            testCases: [
              {
                key: testCase1.key || `tc-${testCase1.id}`,
                id: testCase1.id,
                title: testCase1.title || '',
                automationState: testCase1.automationState?.name || 'Unknown',
                stepCount: this.extractSteps(testCase1).length
              },
              {
                key: testCase2.key || `tc-${testCase2.id}`,
                id: testCase2.id,
                title: testCase2.title || '',
                automationState: testCase2.automationState?.name || 'Unknown',
                stepCount: this.extractSteps(testCase2).length
              }
            ],
            averageSimilarity: similarity.similarityPercentage,
            sharedLogicSummary: similarity.sharedStepsSummary.join('; '),
            automationMix: { manual: 0, automated: 0, mixed: 0 },
            recommendedBase: { testCaseKey: '', reason: '' },
            mergingStrategy: '',
            stepClusters: [],
            semanticCoherence: similarity.semanticConfidence,
            medoidTestCase: '',
            clusterType: similarity.clusterBasedSimilarity > 90 ? 'exact_match' : 'semantic_similar'
          };
          
          clusters.push(newCluster);
          processed.add(key1);
          processed.add(key2);
        }
      }
    }
    
    // Finalize clusters
    return clusters.map(cluster => this.finalizeSemanticCluster(cluster, similarities, stepClusters));
  }

  /**
   * Finalize semantic cluster with enhanced analysis
   */
  private finalizeSemanticCluster(
    cluster: SemanticTestCaseCluster,
    similarities: SemanticSimilarityScore[],
    stepClusters: StepCluster[]
  ): SemanticTestCaseCluster {
    
    // Calculate automation mix
    const automationCounts = { manual: 0, automated: 0, mixed: 0 };
    cluster.testCases.forEach(tc => {
      const state = tc.automationState.toLowerCase();
      if (state.includes('manual') || state.includes('not automated')) {
        automationCounts.manual++;
      } else if (state.includes('automated')) {
        automationCounts.automated++;
      } else {
        automationCounts.mixed++;
      }
    });
    cluster.automationMix = automationCounts;
    
    // Find medoid (most central test case)
    if (this.options.useMedoidSelection) {
      cluster.medoidTestCase = this.findMedoid(cluster, similarities);
      cluster.recommendedBase = {
        testCaseKey: cluster.medoidTestCase,
        reason: 'Medoid test case - most representative of the cluster'
      };
    } else {
      // Use existing logic
      const recommendedBase = this.determineBaseTestCase(cluster);
      cluster.recommendedBase = recommendedBase;
      cluster.medoidTestCase = recommendedBase.testCaseKey;
    }
    
    // Determine pattern type and strategy
    const clusterKeys = cluster.testCases.map(tc => tc.key);
    const clusterSimilarities = similarities.filter(s => 
      clusterKeys.includes(s.testCase1Key) && clusterKeys.includes(s.testCase2Key)
    );
    
    const patternType = clusterSimilarities.length > 0 ? clusterSimilarities[0].patternType : 'other';
    cluster.mergingStrategy = this.suggestMergingStrategy(cluster, patternType);
    
    return cluster;
  }

  /**
   * Find medoid (most central) test case in cluster
   */
  private findMedoid(cluster: SemanticTestCaseCluster, similarities: SemanticSimilarityScore[]): string {
    const testCaseKeys = cluster.testCases.map(tc => tc.key);
    let bestMedoid = testCaseKeys[0];
    let minTotalDistance = Infinity;
    
    testCaseKeys.forEach(candidateKey => {
      let totalDistance = 0;
      let comparisons = 0;
      
      testCaseKeys.forEach(otherKey => {
        if (candidateKey === otherKey) return;
        
        const similarity = similarities.find(s => 
          (s.testCase1Key === candidateKey && s.testCase2Key === otherKey) ||
          (s.testCase1Key === otherKey && s.testCase2Key === candidateKey)
        );
        
        if (similarity) {
          totalDistance += (100 - similarity.similarityPercentage);
          comparisons++;
        }
      });
      
      const avgDistance = comparisons > 0 ? totalDistance / comparisons : Infinity;
      if (avgDistance < minTotalDistance) {
        minTotalDistance = avgDistance;
        bestMedoid = candidateKey;
      }
    });
    
    return bestMedoid;
  }

  /**
   * Generate semantic insights using LLM analysis
   */
  private async generateSemanticInsights(
    stepClusters: StepCluster[],
    semanticClusters: SemanticTestCaseCluster[],
    llmAnalysisFunction?: (prompt: string) => Promise<string>
  ): Promise<{
    commonStepPatterns: string[];
    discoveredWorkflows: string[];
    automationOpportunities: string[];
  }> {
    
    const insights: {
      commonStepPatterns: string[];
      discoveredWorkflows: string[];
      automationOpportunities: string[];
    } = {
      commonStepPatterns: [],
      discoveredWorkflows: [],
      automationOpportunities: []
    };
    
    // Basic insights without LLM
    const topStepClusters = stepClusters
      .filter(c => c.frequency >= 3)
      .slice(0, 10)
      .map(c => c.semanticSummary);
    
    insights.commonStepPatterns = topStepClusters;
    
    const automationCandidates = semanticClusters
      .filter(c => c.automationMix.manual > 1 && c.automationMix.automated === 0)
      .map(c => `Cluster ${c.clusterId}: ${c.testCases.length} manual tests ready for automation`);
    
    insights.automationOpportunities = automationCandidates;
    
    // Enhanced insights with LLM
    if (llmAnalysisFunction && stepClusters.length > 0) {
      try {
        const prompt = `
Analyze these test step clusters and provide insights:

Step Clusters:
${stepClusters.slice(0, 15).map(c => 
  `- ${c.representativeStep} (appears ${c.frequency} times): ${c.semanticSummary}`
).join('\n')}

Test Case Clusters:
${semanticClusters.slice(0, 10).map(c => 
  `- Cluster ${c.clusterId}: ${c.testCases.length} test cases, ${c.averageSimilarity}% similarity`
).join('\n')}

Please provide insights in JSON format:
{
  "discoveredWorkflows": ["workflow pattern 1", "workflow pattern 2", ...],
  "automationOpportunities": ["opportunity 1", "opportunity 2", ...],
  "commonStepPatterns": ["pattern 1", "pattern 2", ...]
}

Focus on identifying:
1. Common user workflows that appear across multiple test cases
2. Opportunities for test automation and parameterization
3. Recurring step patterns that could be optimized
`;

        const response = await llmAnalysisFunction(prompt);
        const parsed = JSON.parse(response);
        
        insights.discoveredWorkflows = parsed.discoveredWorkflows || [];
        insights.automationOpportunities = [
          ...insights.automationOpportunities,
          ...(Array.isArray(parsed.automationOpportunities) ? parsed.automationOpportunities : [])
        ];
        insights.commonStepPatterns = parsed.commonStepPatterns || insights.commonStepPatterns;
        
      } catch (error) {
        console.log(`⚠️ LLM insights generation failed: ${error}`);
      }
    }
    
    return insights;
  }
}
