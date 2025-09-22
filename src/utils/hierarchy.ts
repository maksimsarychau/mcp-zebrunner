import { ZebrunnerTestSuite } from "../types/core.js";

/**
 * Utility class for processing test suite hierarchies
 */
export class HierarchyProcessor {
  /**
   * Enrich suites with hierarchy information (alias for backward compatibility)
   */
  static enrichSuitesWithHierarchy(suites: ZebrunnerTestSuite[]): ZebrunnerTestSuite[] {
    const rootSuiteMap = this.calculateRootSuiteIds(suites);
    const levelMap = this.calculateSuiteLevels(suites);

    return suites.map(suite => ({
      ...suite,
      rootSuiteId: rootSuiteMap.get(suite.id) || suite.id,
      level: levelMap.get(suite.id) || 0,
      path: this.generateSuitePath(suite.id, suites)
    }));
  }

  /**
   * Build a hierarchical tree from flat suite list
   */
  static buildSuiteTree(suites: ZebrunnerTestSuite[]): ZebrunnerTestSuite[] {
    const suiteMap = new Map<number, ZebrunnerTestSuite>();
    const rootSuites: ZebrunnerTestSuite[] = [];

    // First pass: create map and initialize children arrays
    suites.forEach(suite => {
      suiteMap.set(suite.id, { ...suite, children: [] });
    });

    // Second pass: build parent-child relationships
    suites.forEach(suite => {
      const suiteWithChildren = suiteMap.get(suite.id)!;
      
      if (suite.parentSuiteId && suiteMap.has(suite.parentSuiteId)) {
        const parent = suiteMap.get(suite.parentSuiteId)!;
        parent.children = parent.children || [];
        parent.children.push(suiteWithChildren);
      } else {
        rootSuites.push(suiteWithChildren);
      }
    });

    return rootSuites;
  }

  /**
   * Calculate root suite IDs for all suites
   */
  static calculateRootSuiteIds(suites: ZebrunnerTestSuite[]): Map<number, number> {
    const rootSuiteMap = new Map<number, number>();
    const suiteMap = new Map<number, ZebrunnerTestSuite>();

    // Build suite map
    suites.forEach(suite => {
      suiteMap.set(suite.id, suite);
    });

    // Calculate root suite for each suite with circular reference protection
    const findRootSuite = (suiteId: number, visited: Set<number> = new Set()): number => {
      if (rootSuiteMap.has(suiteId)) {
        return rootSuiteMap.get(suiteId)!;
      }

      // Circular reference detection
      if (visited.has(suiteId)) {
        rootSuiteMap.set(suiteId, suiteId);
        return suiteId;
      }

      const suite = suiteMap.get(suiteId);
      if (!suite || !suite.parentSuiteId) {
        rootSuiteMap.set(suiteId, suiteId);
        return suiteId;
      }

      visited.add(suiteId);
      const rootId = findRootSuite(suite.parentSuiteId, visited);
      rootSuiteMap.set(suiteId, rootId);
      return rootId;
    };

    suites.forEach(suite => {
      findRootSuite(suite.id);
    });

    return rootSuiteMap;
  }

  /**
   * Generate full path for a suite (e.g., "Root > Parent > Child")
   */
  static generateSuitePath(
    suiteId: number, 
    suites: ZebrunnerTestSuite[], 
    separator: string = " > "
  ): string {
    const suiteMap = new Map<number, ZebrunnerTestSuite>();
    suites.forEach(suite => {
      suiteMap.set(suite.id, suite);
    });

    const buildPath = (id: number): string[] => {
      const suite = suiteMap.get(id);
      if (!suite) return [];

      const name = suite.title || suite.name || `Suite ${suite.id}`;
      
      if (!suite.parentSuiteId) {
        return [name];
      }

      return [...buildPath(suite.parentSuiteId), name];
    };

    return buildPath(suiteId).join(separator);
  }

  /**
   * Calculate depth level for each suite
   */
  static calculateSuiteLevels(suites: ZebrunnerTestSuite[]): Map<number, number> {
    const levelMap = new Map<number, number>();
    const suiteMap = new Map<number, ZebrunnerTestSuite>();

    suites.forEach(suite => {
      suiteMap.set(suite.id, suite);
    });

    const calculateLevel = (suiteId: number): number => {
      if (levelMap.has(suiteId)) {
        return levelMap.get(suiteId)!;
      }

      const suite = suiteMap.get(suiteId);
      if (!suite || !suite.parentSuiteId) {
        levelMap.set(suiteId, 0);
        return 0;
      }

      const level = calculateLevel(suite.parentSuiteId) + 1;
      levelMap.set(suiteId, level);
      return level;
    };

    suites.forEach(suite => {
      calculateLevel(suite.id);
    });

    return levelMap;
  }


  /**
   * Flatten hierarchical tree back to list
   */
  static flattenSuiteTree(rootSuites: ZebrunnerTestSuite[]): ZebrunnerTestSuite[] {
    const flattened: ZebrunnerTestSuite[] = [];
    const visited = new Set<number>(); // Prevent infinite loops from circular references

    const traverse = (suite: ZebrunnerTestSuite) => {
      if (visited.has(suite.id)) {
        console.warn(`⚠️  Circular reference detected in suite hierarchy: ${suite.id}`);
        return;
      }

      visited.add(suite.id);
      flattened.push(suite);

      if (suite.children && Array.isArray(suite.children)) {
        suite.children.forEach((child: ZebrunnerTestSuite) => {
          if (child && typeof child.id === 'number') {
            traverse(child);
          }
        });
      }

      visited.delete(suite.id); // Allow revisiting in different branches
    };

    rootSuites.forEach(suite => {
      if (suite && typeof suite.id === 'number') {
        traverse(suite);
      }
    });

    return flattened;
  }

  /**
   * Get all descendants of a suite
   */
  static getSuiteDescendants(
    parentSuiteId: number,
    suites: ZebrunnerTestSuite[]
  ): ZebrunnerTestSuite[] {
    if (!Number.isInteger(parentSuiteId) || parentSuiteId <= 0) {
      throw new Error('Parent suite ID must be a positive integer');
    }

    const descendants: ZebrunnerTestSuite[] = [];
    const visited = new Set<number>(); // Prevent infinite recursion

    const collectDescendants = (currentParentId: number) => {
      if (visited.has(currentParentId)) {
        return; // Avoid circular references
      }

      visited.add(currentParentId);
      const children = suites.filter((suite: ZebrunnerTestSuite) =>
        suite && suite.parentSuiteId === currentParentId
      );

      children.forEach((child: ZebrunnerTestSuite) => {
        if (child && typeof child.id === 'number') {
          descendants.push(child);
          collectDescendants(child.id);
        }
      });

      visited.delete(currentParentId);
    };

    collectDescendants(parentSuiteId);
    return descendants;
  }

  /**
   * Get path from root to specific suite
   */
  static getSuiteAncestors(
    suiteId: number, 
    suites: ZebrunnerTestSuite[]
  ): ZebrunnerTestSuite[] {
    const suiteMap = new Map<number, ZebrunnerTestSuite>();
    suites.forEach(suite => {
      suiteMap.set(suite.id, suite);
    });

    const ancestors: ZebrunnerTestSuite[] = [];
    let currentSuite = suiteMap.get(suiteId);

    while (currentSuite) {
      ancestors.unshift(currentSuite);
      currentSuite = currentSuite.parentSuiteId ? suiteMap.get(currentSuite.parentSuiteId) : undefined;
    }

    return ancestors;
  }
}
