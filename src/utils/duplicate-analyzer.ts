import { ZebrunnerTestCase } from '../types/core.js';

export interface TestCaseStep {
  action: string;
  expectedResult?: string;
  stepNumber?: number;
}

export interface SimilarityScore {
  testCase1Key: string;
  testCase2Key: string;
  similarityPercentage: number;
  sharedSteps: number;
  totalSteps1: number;
  totalSteps2: number;
  sharedStepsSummary: string[];
  patternType?: 'user_type' | 'theme' | 'entry_point' | 'component' | 'permission' | 'other';
  variationDetails?: {
    userTypes?: string[];
    themes?: string[];
    entryPoints?: string[];
    components?: string[];
  };
}

export interface TestCaseCluster {
  clusterId: string;
  testCases: {
    key: string;
    id: number;
    title: string;
    automationState: string;
    stepCount: number;
  }[];
  averageSimilarity: number;
  sharedLogicSummary: string;
  automationMix: {
    manual: number;
    automated: number;
    mixed: number;
  };
  recommendedBase: {
    testCaseKey: string;
    reason: string;
  };
  mergingStrategy: string;
}

export interface DuplicateAnalysisResult {
  suiteId?: number;
  projectKey: string;
  totalTestCases: number;
  clustersFound: number;
  potentialSavings: {
    duplicateTestCases: number;
    estimatedTimeReduction: string;
  };
  clusters: TestCaseCluster[];
  similarityMatrix?: SimilarityScore[];
}

export class TestCaseDuplicateAnalyzer {
  private similarityThreshold: number;
  
  constructor(similarityThreshold: number = 80) {
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Extract and normalize test steps from a test case
   */
  extractSteps(testCase: ZebrunnerTestCase): TestCaseStep[] {
    if (!testCase.steps || testCase.steps.length === 0) {
      return [];
    }

    return testCase.steps.map((step, index) => ({
      action: this.normalizeText(step.action || ''),
      expectedResult: step.expectedResult ? this.normalizeText(step.expectedResult) : undefined,
      stepNumber: index + 1
    })).filter(step => step.action.length > 0);
  }

  /**
   * Normalize text for better comparison
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .replace(/\s+/g, ' ')     // Collapse multiple spaces
      .trim();
  }

  /**
   * Calculate similarity between two sets of test steps
   */
  calculateStepSimilarity(steps1: TestCaseStep[], steps2: TestCaseStep[]): {
    similarity: number;
    sharedSteps: number;
    sharedStepsSummary: string[];
  } {
    if (steps1.length === 0 && steps2.length === 0) {
      return { similarity: 100, sharedSteps: 0, sharedStepsSummary: [] };
    }
    
    if (steps1.length === 0 || steps2.length === 0) {
      return { similarity: 0, sharedSteps: 0, sharedStepsSummary: [] };
    }

    const sharedSteps: string[] = [];
    let matchedSteps = 0;

    // Compare each step from steps1 with all steps in steps2
    for (const step1 of steps1) {
      let bestMatch = 0;
      let bestMatchText = '';

      for (const step2 of steps2) {
        const actionSimilarity = this.calculateTextSimilarity(step1.action, step2.action);
        
        // Also consider expected results if both exist
        let resultSimilarity = 0;
        if (step1.expectedResult && step2.expectedResult) {
          resultSimilarity = this.calculateTextSimilarity(step1.expectedResult, step2.expectedResult);
        }

        // Combined similarity (action weighted more heavily)
        const combinedSimilarity = (actionSimilarity * 0.7) + (resultSimilarity * 0.3);
        
        if (combinedSimilarity > bestMatch && combinedSimilarity > 0.5) {
          bestMatch = combinedSimilarity;
          bestMatchText = step1.action;
        }
      }

      if (bestMatch > 0.5) {
        matchedSteps++;
        if (bestMatchText) {
          sharedSteps.push(bestMatchText);
        }
      }
    }

    // Calculate similarity as percentage
    const maxSteps = Math.max(steps1.length, steps2.length);
    const similarity = (matchedSteps / maxSteps) * 100;

    return {
      similarity: Math.round(similarity * 100) / 100, // Round to 2 decimal places
      sharedSteps: matchedSteps,
      sharedStepsSummary: sharedSteps.slice(0, 5) // Limit to first 5 shared steps
    };
  }

  /**
   * Detect common duplication patterns based on Claude's analysis
   */
  protected detectDuplicationPattern(testCase1: ZebrunnerTestCase, testCase2: ZebrunnerTestCase): {
    patternType: 'user_type' | 'theme' | 'entry_point' | 'component' | 'permission' | 'other';
    variationDetails: any;
  } {
    const title1 = (testCase1.title || '').toLowerCase();
    const title2 = (testCase2.title || '').toLowerCase();
    
    // User Type Pattern (Free vs Premium)
    const userTypeKeywords = ['free', 'premium', 'paid'];
    const hasUserType1 = userTypeKeywords.some(keyword => title1.includes(keyword));
    const hasUserType2 = userTypeKeywords.some(keyword => title2.includes(keyword));
    
    if (hasUserType1 && hasUserType2) {
      const userTypes = [];
      if (title1.includes('free')) userTypes.push('Free');
      if (title1.includes('premium')) userTypes.push('Premium');
      if (title2.includes('free') && !userTypes.includes('Free')) userTypes.push('Free');
      if (title2.includes('premium') && !userTypes.includes('Premium')) userTypes.push('Premium');
      
      return {
        patternType: 'user_type',
        variationDetails: { userTypes }
      };
    }
    
    // Theme Pattern (Dark vs Light mode)
    const themeKeywords = ['dark mode', 'light mode', 'dark', 'light'];
    const hasTheme1 = themeKeywords.some(keyword => title1.includes(keyword));
    const hasTheme2 = themeKeywords.some(keyword => title2.includes(keyword));
    
    if (hasTheme1 && hasTheme2) {
      const themes = [];
      if (title1.includes('dark')) themes.push('Dark');
      if (title1.includes('light')) themes.push('Light');
      if (title2.includes('dark') && !themes.includes('Dark')) themes.push('Dark');
      if (title2.includes('light') && !themes.includes('Light')) themes.push('Light');
      
      return {
        patternType: 'theme',
        variationDetails: { themes }
      };
    }
    
    // Entry Point Pattern (More menu, Dashboard, Search, Widget)
    const entryPointKeywords = ['more menu', 'dashboard', 'search', 'widget', 'via'];
    const hasEntryPoint1 = entryPointKeywords.some(keyword => title1.includes(keyword));
    const hasEntryPoint2 = entryPointKeywords.some(keyword => title2.includes(keyword));
    
    if (hasEntryPoint1 && hasEntryPoint2) {
      const entryPoints = [];
      if (title1.includes('more menu')) entryPoints.push('More Menu');
      if (title1.includes('dashboard')) entryPoints.push('Dashboard');
      if (title1.includes('search')) entryPoints.push('Search');
      if (title1.includes('widget')) entryPoints.push('Widget');
      if (title2.includes('more menu') && !entryPoints.includes('More Menu')) entryPoints.push('More Menu');
      if (title2.includes('dashboard') && !entryPoints.includes('Dashboard')) entryPoints.push('Dashboard');
      if (title2.includes('search') && !entryPoints.includes('Search')) entryPoints.push('Search');
      if (title2.includes('widget') && !entryPoints.includes('Widget')) entryPoints.push('Widget');
      
      return {
        patternType: 'entry_point',
        variationDetails: { entryPoints }
      };
    }
    
    // Component Pattern (Fiber, Steps, Protein cards)
    const componentKeywords = ['fiber', 'steps', 'protein', 'card'];
    const hasComponent1 = componentKeywords.some(keyword => title1.includes(keyword));
    const hasComponent2 = componentKeywords.some(keyword => title2.includes(keyword));
    
    if (hasComponent1 && hasComponent2 && title1.includes('card') && title2.includes('card')) {
      const components = [];
      if (title1.includes('fiber')) components.push('Fiber');
      if (title1.includes('steps')) components.push('Steps');
      if (title1.includes('protein')) components.push('Protein');
      if (title2.includes('fiber') && !components.includes('Fiber')) components.push('Fiber');
      if (title2.includes('steps') && !components.includes('Steps')) components.push('Steps');
      if (title2.includes('protein') && !components.includes('Protein')) components.push('Protein');
      
      return {
        patternType: 'component',
        variationDetails: { components }
      };
    }
    
    // Permission Pattern (camera, permissions)
    const permissionKeywords = ['permission', 'camera', 'access'];
    const hasPermission1 = permissionKeywords.some(keyword => title1.includes(keyword));
    const hasPermission2 = permissionKeywords.some(keyword => title2.includes(keyword));
    
    if (hasPermission1 && hasPermission2) {
      return {
        patternType: 'permission',
        variationDetails: {}
      };
    }
    
    return {
      patternType: 'other',
      variationDetails: {}
    };
  }
  /**
   * Calculate text similarity using simple word overlap
   */
  protected calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(' ').filter(w => w.length > 2));
    const words2 = new Set(text2.split(' ').filter(w => w.length > 2));
    
    if (words1.size === 0 && words2.size === 0) return 1;
    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    // Use Jaccard similarity but with a minimum threshold
    const jaccardSimilarity = intersection.size / union.size;
    
    // Also check for partial word matches (more lenient)
    let partialMatches = 0;
    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1.includes(word2) || word2.includes(word1)) {
          partialMatches++;
          break;
        }
      }
    }
    
    const partialSimilarity = partialMatches / Math.max(words1.size, words2.size);
    
    // Return the higher of the two similarities
    return Math.max(jaccardSimilarity, partialSimilarity * 0.8);
  }

  /**
   * Calculate pairwise similarities between all test cases
   */
  calculateSimilarityMatrix(testCases: ZebrunnerTestCase[]): SimilarityScore[] {
    const similarities: SimilarityScore[] = [];
    
    for (let i = 0; i < testCases.length; i++) {
      for (let j = i + 1; j < testCases.length; j++) {
        const testCase1 = testCases[i];
        const testCase2 = testCases[j];
        
        const steps1 = this.extractSteps(testCase1);
        const steps2 = this.extractSteps(testCase2);
        
        const result = this.calculateStepSimilarity(steps1, steps2);
        
        if (result.similarity >= this.similarityThreshold) {
          // Detect duplication pattern
          const pattern = this.detectDuplicationPattern(testCase1, testCase2);
          
          similarities.push({
            testCase1Key: testCase1.key || `tc-${testCase1.id}`,
            testCase2Key: testCase2.key || `tc-${testCase2.id}`,
            similarityPercentage: result.similarity,
            sharedSteps: result.sharedSteps,
            totalSteps1: steps1.length,
            totalSteps2: steps2.length,
            sharedStepsSummary: result.sharedStepsSummary,
            patternType: pattern.patternType,
            variationDetails: pattern.variationDetails
          });
        }
      }
    }

    return similarities.sort((a, b) => b.similarityPercentage - a.similarityPercentage);
  }

  /**
   * Group similar test cases into clusters
   */
  createClusters(testCases: ZebrunnerTestCase[], similarities: SimilarityScore[]): TestCaseCluster[] {
    const clusters: TestCaseCluster[] = [];
    const processed = new Set<string>();
    
    // Create a map for quick test case lookup
    const testCaseMap = new Map(testCases.map(tc => [tc.key, tc]));
    
    for (const similarity of similarities) {
      const key1 = similarity.testCase1Key;
      const key2 = similarity.testCase2Key;
      
      // Skip if both test cases are already in clusters
      if (processed.has(key1) && processed.has(key2)) {
        continue;
      }
      
      // Find existing cluster for either test case
      let existingCluster = clusters.find(cluster => 
        cluster.testCases.some(tc => tc.key === key1 || tc.key === key2)
      );
      
      if (existingCluster) {
        // Add the unprocessed test case to existing cluster
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
          const clusterId = `cluster_${clusters.length + 1}`;
          
          const newCluster: TestCaseCluster = {
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
            mergingStrategy: ''
          };
          
          clusters.push(newCluster);
          processed.add(key1);
          processed.add(key2);
        }
      }
    }
    
    // Finalize clusters with analysis
    return clusters.map(cluster => this.finalizeCluster(cluster, similarities));
  }

  /**
   * Finalize cluster with automation analysis and recommendations
   */
  private finalizeCluster(cluster: TestCaseCluster, similarities: SimilarityScore[]): TestCaseCluster {
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
    
    // Recalculate average similarity for this cluster
    const clusterKeys = cluster.testCases.map(tc => tc.key);
    const clusterSimilarities = similarities.filter(s => 
      clusterKeys.includes(s.testCase1Key) && clusterKeys.includes(s.testCase2Key)
    );
    
    if (clusterSimilarities.length > 0) {
      cluster.averageSimilarity = Math.round(
        (clusterSimilarities.reduce((sum, s) => sum + s.similarityPercentage, 0) / clusterSimilarities.length) * 100
      ) / 100;
    }
    
    // Determine recommended base test case
    const recommendedBase = this.determineBaseTestCase(cluster);
    cluster.recommendedBase = recommendedBase;
    
    // Detect pattern type from similarities
    const patternType = clusterSimilarities.length > 0 ? clusterSimilarities[0].patternType : 'other';
    
    // Suggest merging strategy with pattern awareness
    cluster.mergingStrategy = this.suggestMergingStrategy(cluster, patternType);
    
    return cluster;
  }

  /**
   * Determine which test case should be used as the base for merging
   */
  protected determineBaseTestCase(cluster: TestCaseCluster): { testCaseKey: string; reason: string } {
    const testCases = cluster.testCases;
    
    // Prefer automated test cases
    const automatedTests = testCases.filter(tc => 
      tc.automationState.toLowerCase().includes('automated')
    );
    
    if (automatedTests.length > 0) {
      // Choose the automated test with most steps
      const bestAutomated = automatedTests.reduce((best, current) => 
        current.stepCount > best.stepCount ? current : best
      );
      return {
        testCaseKey: bestAutomated.key,
        reason: `Automated test case with ${bestAutomated.stepCount} steps - best foundation for parameterization`
      };
    }
    
    // If no automated tests, choose the one with most comprehensive steps
    const mostComprehensive = testCases.reduce((best, current) => 
      current.stepCount > best.stepCount ? current : best
    );
    
    return {
      testCaseKey: mostComprehensive.key,
      reason: `Most comprehensive test case with ${mostComprehensive.stepCount} steps`
    };
  }

  /**
   * Suggest merging strategy based on cluster characteristics and patterns
   */
  protected suggestMergingStrategy(cluster: TestCaseCluster, patternType?: string): string {
    const { manual, automated, mixed } = cluster.automationMix;
    const totalTests = cluster.testCases.length;
    
    // Pattern-specific strategies based on Claude's analysis
    switch (patternType) {
      case 'user_type':
        if (automated > 0) {
          return `Parameterize automated test with userType parameter (Free/Premium) and retire ${manual + mixed} manual duplicates`;
        }
        return `Create single parameterized test with userType parameter (Free/Premium) - consolidate ${totalTests} tests into 1`;
        
      case 'theme':
        if (automated > 0) {
          return `Parameterize automated test with theme parameter (Dark/Light) and retire ${manual + mixed} manual duplicates`;
        }
        return `Create single parameterized test with theme parameter (Dark/Light) - consolidate ${totalTests} tests into 1`;
        
      case 'entry_point':
        if (automated > 0) {
          return `Parameterize automated test with entryPoint parameter and retire ${manual + mixed} manual duplicates`;
        }
        return `Create single parameterized test with entryPoint parameter (Dashboard/Search/Widget/More Menu) - consolidate ${totalTests} tests into 1`;
        
      case 'component':
        if (automated > 0) {
          return `Create component-based parameterized test for card interactions and retire ${manual + mixed} manual duplicates`;
        }
        return `Create single component-based test with card parameter (Fiber/Steps/Protein) - consolidate ${totalTests} tests into 1`;
        
      case 'permission':
        return `Create single permission flow test with theme/state parameters - consolidate ${totalTests} tests into 1`;
        
      default:
        // Original logic for unknown patterns
        if (automated > 0 && manual > 0) {
          return `Parameterize automated test case and retire ${manual} manual duplicate${manual > 1 ? 's' : ''}`;
        } else if (automated > 1) {
          return `Consolidate ${automated} automated tests into single parameterized test`;
        } else if (manual > 1) {
          return `Merge ${manual} manual tests and consider automation as single comprehensive test`;
        } else {
          return `Review ${totalTests} similar tests for consolidation opportunities`;
        }
    }
  }

  /**
   * Main analysis method
   */
  analyzeDuplicates(
    testCases: ZebrunnerTestCase[], 
    projectKey: string, 
    suiteId?: number
  ): DuplicateAnalysisResult {
    console.log(`🔍 Analyzing ${testCases.length} test cases for duplicates...`);
    
    // Calculate similarity matrix
    const similarities = this.calculateSimilarityMatrix(testCases);
    console.log(`📊 Found ${similarities.length} similar pairs above ${this.similarityThreshold}% threshold`);
    
    // Create clusters
    const clusters = this.createClusters(testCases, similarities);
    console.log(`🗂️ Created ${clusters.length} clusters of similar test cases`);
    
    // Calculate potential savings
    const duplicateTestCases = clusters.reduce((sum, cluster) => sum + cluster.testCases.length - 1, 0);
    const estimatedTimeReduction = this.calculateTimeReduction(duplicateTestCases, testCases.length);
    
    return {
      suiteId,
      projectKey,
      totalTestCases: testCases.length,
      clustersFound: clusters.length,
      potentialSavings: {
        duplicateTestCases,
        estimatedTimeReduction
      },
      clusters: clusters.sort((a, b) => b.averageSimilarity - a.averageSimilarity),
      similarityMatrix: similarities
    };
  }

  /**
   * Calculate estimated time reduction from removing duplicates
   */
  protected calculateTimeReduction(duplicates: number, total: number): string {
    const reductionPercentage = Math.round((duplicates / total) * 100);
    const timeCategories = [
      { threshold: 30, time: '2-4 hours' },
      { threshold: 20, time: '1-2 hours' },
      { threshold: 10, time: '30-60 minutes' },
      { threshold: 5, time: '15-30 minutes' }
    ];
    
    const category = timeCategories.find(cat => reductionPercentage >= cat.threshold);
    return category ? `${reductionPercentage}% (${category.time} estimated)` : `${reductionPercentage}% (minimal impact)`;
  }
}
