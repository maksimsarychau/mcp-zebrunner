import { ZebrunnerTestSuite, ZebrunnerTestCase } from "../types/core.js";

/**
 * Utility class for processing test suite hierarchies
 * Enhanced with comprehensive Java methodology from Zebrunner_MCP_API.md
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
      if (!suite || !suite.parentSuiteId || !suiteMap.has(suite.parentSuiteId)) {
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

    const buildPath = (id: number, visited: Set<number> = new Set()): string[] => {
      const suite = suiteMap.get(id);
      if (!suite) return [`Unknown Suite (${id})`];

      // Circular reference detection
      if (visited.has(id)) {
        return [`Suite ${id} (circular)`];
      }

      const name = suite.title || suite.name || `Suite ${suite.id}`;

      if (!suite.parentSuiteId) {
        return [name];
      }

      visited.add(id);
      const parentPath = buildPath(suite.parentSuiteId, visited);
      return [...parentPath, name];
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

    const calculateLevel = (suiteId: number, visited: Set<number> = new Set()): number => {
      if (levelMap.has(suiteId)) {
        return levelMap.get(suiteId)!;
      }

      // Circular reference detection
      if (visited.has(suiteId)) {
        levelMap.set(suiteId, 0); // Treat circular references as root level
        return 0;
      }

      const suite = suiteMap.get(suiteId);
      if (!suite || !suite.parentSuiteId || !suiteMap.has(suite.parentSuiteId)) {
        levelMap.set(suiteId, 0);
        return 0;
      }

      visited.add(suiteId);
      const level = calculateLevel(suite.parentSuiteId, visited) + 1;
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
    const visited = new Set<number>(); // Prevent infinite loops
    let currentSuite = suiteMap.get(suiteId);

    // Skip the suite itself, start with its parent
    if (currentSuite && currentSuite.parentSuiteId) {
      currentSuite = suiteMap.get(currentSuite.parentSuiteId);
    } else {
      currentSuite = undefined;
    }

    while (currentSuite && !visited.has(currentSuite.id)) {
      visited.add(currentSuite.id);
      ancestors.unshift(currentSuite);
      currentSuite = currentSuite.parentSuiteId ? suiteMap.get(currentSuite.parentSuiteId) : undefined;
    }

    return ancestors;
  }

  // ===== COMPREHENSIVE JAVA METHODOLOGY METHODS =====
  // Based on Zebrunner_MCP_API.md implementation guide

  /**
   * Builds a parent-child mapping for efficient hierarchy traversal
   * Equivalent to: TCMTestSuites.buildParentChildMap(List<TCMTestSuite> list)
   */
  static buildParentChildMap(suites: ZebrunnerTestSuite[]): Map<number, number> {
    const parentChildMap = new Map<number, number>();

    for (const suite of suites) {
      if (suite.parentSuiteId !== null && suite.parentSuiteId !== undefined) {
        parentChildMap.set(suite.id, suite.parentSuiteId);
      }
    }

    return parentChildMap;
  }

  /**
   * Finds root suite ID by traversing up the hierarchy
   * Equivalent to: TCMTestSuites.getRoot(Map<Integer, Integer> parentChildMap, int id)
   */
  static getRoot(parentChildMap: Map<number, number>, id: number): number {
    let currentId = id;
    const visited = new Set<number>(); // Prevent infinite loops

    while (parentChildMap.has(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      currentId = parentChildMap.get(currentId)!;
    }

    return currentId;
  }

  /**
   * Convenience method to get root ID directly from suite list
   * Equivalent to: TCMTestSuites.getRootId(List<TCMTestSuite> list, int idToFindRootFor)
   */
  static getRootId(suites: ZebrunnerTestSuite[], idToFindRootFor: number): number {
    const parentChildMap = this.buildParentChildMap(suites);
    return this.getRoot(parentChildMap, idToFindRootFor);
  }

  /**
   * Finds suite name by ID
   * Equivalent to: TCMTestSuites.getSuiteNameById(List<TCMTestSuite> itemList, Integer id)
   */
  static getSuiteNameById(suites: ZebrunnerTestSuite[], id: number): string {
    const suite = suites.find(s => s.id === id);
    return suite?.name || suite?.title || '';
  }

  /**
   * Finds suite object by ID
   * Equivalent to: TCMTestSuites.getTCMTestSuiteById(List<TCMTestSuite> itemList, Integer id)
   */
  static getTCMTestSuiteById(suites: ZebrunnerTestSuite[], id: number): ZebrunnerTestSuite | null {
    return suites.find(s => s.id === id) || null;
  }

  /**
   * Filters test suites to return only root suites (parentSuiteId === null)
   * Equivalent to: getRootSuites(List<TCMTestSuite> list)
   */
  static getRootSuites(suites: ZebrunnerTestSuite[]): ZebrunnerTestSuite[] {
    return suites.filter(suite => suite.parentSuiteId === null || suite.parentSuiteId === undefined);
  }

  /**
   * Sets root parent information for all suites in the list
   * Equivalent to: TCMTestSuites.setRootParentsToSuites(List<TCMTestSuite> itemList)
   */
  static setRootParentsToSuites(suites: ZebrunnerTestSuite[]): ZebrunnerTestSuite[] {
    const processedSuites: ZebrunnerTestSuite[] = [];

    for (const suite of suites) {
      const rootId = this.getRootId(suites, suite.id);
      const enhancedSuite = { ...suite };
      
      enhancedSuite.rootSuiteId = rootId;
      enhancedSuite.rootSuiteName = this.getSuiteNameById(suites, rootId);

      if (suite.parentSuiteId !== null && suite.parentSuiteId !== undefined) {
        enhancedSuite.parentSuiteName = this.getSuiteNameById(suites, suite.parentSuiteId);
      }

      enhancedSuite.treeNames = this.getSectionTree(suites, enhancedSuite);
      processedSuites.push(enhancedSuite);
    }

    return this.updateSuitesSectionsTree(processedSuites);
  }

  /**
   * Helper function to get root ID for a specific suite ID
   * Equivalent to: getRootIdBySuiteId(List<TCMTestSuite> allSuites, int id)
   */
  static getRootIdBySuiteId(allSuites: ZebrunnerTestSuite[], id: number): number {
    const suite = allSuites.find(s => s.id === id);
    if (suite?.rootSuiteId) {
      return suite.rootSuiteId;
    }
    // If rootSuiteId is not set, calculate it
    return this.getRootId(allSuites, id);
  }

  /**
   * Generates basic section tree path
   */
  private static getSectionTree(suites: ZebrunnerTestSuite[], suite: ZebrunnerTestSuite): string {
    const rootName = suite.rootSuiteName || this.getSuiteNameById(suites, suite.rootSuiteId || suite.id);
    const parentName = suite.parentSuiteName || (suite.parentSuiteId ? this.getSuiteNameById(suites, suite.parentSuiteId) : null);
    const suiteName = suite.name || suite.title || '';

    if (!rootName) {
      return suiteName;
    }

    if (!parentName || rootName === parentName) {
      return `${rootName} > ${suiteName}`;
    } else {
      return `${rootName} > .. > ${parentName} > ${suiteName}`;
    }
  }

  /**
   * Updates complete section tree for all suites
   */
  private static updateSuitesSectionsTree(suites: ZebrunnerTestSuite[]): ZebrunnerTestSuite[] {
    const processedSuites: ZebrunnerTestSuite[] = [];

    for (const suite of suites) {
      const enhancedSuite = { ...suite };
      let treePath = suite.rootSuiteName || '';
      const pathParts: string[] = [];

      if (suite.parentSuiteId !== null && suite.parentSuiteId !== undefined) {
        let currentSuite = suite;

        // Build path by traversing up the hierarchy
        const visited = new Set<number>(); // Prevent infinite loops
        while (currentSuite.parentSuiteId !== null &&
               currentSuite.parentSuiteId !== undefined &&
               currentSuite.parentSuiteId !== currentSuite.rootSuiteId &&
               !visited.has(currentSuite.parentSuiteId)) {

          visited.add(currentSuite.parentSuiteId);
          
          if (currentSuite.parentSuiteName) {
            pathParts.push(currentSuite.parentSuiteName);
          }

          const parentSuite = this.getTCMTestSuiteById(suites, currentSuite.parentSuiteId);
          if (!parentSuite) break;
          currentSuite = parentSuite;
        }

        // Reverse to get correct order (root to leaf)
        pathParts.reverse();

        for (const part of pathParts) {
          treePath += ` > ${part}`;
        }
      }

      treePath += ` > ${suite.name || suite.title || ''}`;
      enhancedSuite.treeNames = treePath;

      processedSuites.push(enhancedSuite);
    }

    console.log(`Updated tree in suites: ${processedSuites.length}`);
    return processedSuites;
  }
}
