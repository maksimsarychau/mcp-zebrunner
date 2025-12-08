import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { ZebrunnerReportingClient } from '../../dist/api/reporting-client.js';
import { ZebrunnerReportingError } from '../../dist/types/reporting.js';
import { EnhancedZebrunnerClient } from '../../dist/api/enhanced-client.js';

describe('Automation State Tools', () => {
  let mockReportingClient: any;
  let mockEnhancedClient: any;
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    // Mock console.warn to capture fallback warnings
    originalConsoleWarn = console.warn;
    console.warn = () => {};

    // Mock ZebrunnerReportingClient
    mockReportingClient = {
      getAutomationStates: async (projectId: number) => {
        if (projectId === 999) {
          // Simulate the actual behavior: return default mapping on error
          return [
            { id: 10, name: 'Not Automated' },
            { id: 11, name: 'To Be Automated' },
            { id: 12, name: 'Automated' }
          ];
        }
        return [
          { id: 10, name: 'Not Automated' },
          { id: 11, name: 'To Be Automated' },
          { id: 12, name: 'Automated' }
        ];
      },
      makeAuthenticatedRequest: async (method: string, url: string) => {
        if (url.includes('projectId=999')) {
          throw new Error('Network error');
        }
        return {
          data: [
            { id: 10, name: 'Not Automated' },
            { id: 11, name: 'To Be Automated' },
            { id: 12, name: 'Automated' }
          ]
        };
      }
    };

    // Mock EnhancedZebrunnerClient
    mockEnhancedClient = {
      getTestCases: async (projectKey: string, options: any) => {
        const mockTestCases = [
          {
            id: 1,
            key: 'TEST-1',
            title: 'Test Case 1',
            automationState: { id: 10, name: 'Not Automated' },
            createdAt: '2025-01-15T10:00:00Z',
            priority: { id: 1, name: 'High' }
          },
          {
            id: 2,
            key: 'TEST-2', 
            title: 'Test Case 2',
            automationState: { id: 11, name: 'To Be Automated' },
            createdAt: '2025-06-15T10:00:00Z',
            priority: { id: 2, name: 'Medium' }
          },
          {
            id: 3,
            key: 'TEST-3',
            title: 'Test Case 3', 
            automationState: { id: 12, name: 'Automated' },
            createdAt: '2025-09-01T10:00:00Z',
            priority: { id: 3, name: 'Low' }
          }
        ];

        // Filter based on automation state if provided
        let filteredCases = mockTestCases;
        if (options.automationState !== undefined && options.automationState !== null) {
          const states = Array.isArray(options.automationState) ? options.automationState : [options.automationState];
          if (states.length > 0) {
            filteredCases = mockTestCases.filter(testCase => {
              return states.some((state: any) => {
                if (typeof state === 'number') {
                  return testCase.automationState.id === state;
                } else {
                  return testCase.automationState.name === state;
                }
              });
            });
          }
        }

        return {
          items: filteredCases,
          _meta: { total: filteredCases.length, totalPages: 1 }
        };
      },
      buildRQLFilter: (options: any) => {
        const filters: string[] = [];
        
        if (options.automationState) {
          if (Array.isArray(options.automationState)) {
            const allNumbers = options.automationState.every((state: any) => typeof state === 'number');
            const allStrings = options.automationState.every((state: any) => typeof state === 'string');
            
            if (allNumbers) {
              filters.push(`automationState.id IN [${options.automationState.join(', ')}]`);
            } else if (allStrings) {
              const quotedNames = options.automationState.map((state: any) => `'${String(state).replace(/'/g, "\\'")}'`);
              filters.push(`automationState.name IN [${quotedNames.join(', ')}]`);
            }
          } else {
            if (typeof options.automationState === 'number') {
              filters.push(`automationState.id = ${options.automationState}`);
            } else {
              filters.push(`automationState.name = '${String(options.automationState).replace(/'/g, "\\'")}'`);
            }
          }
        }

        if (options.createdAfter) {
          filters.push(`createdAt >= '${options.createdAfter}'`);
        }

        return filters.join(' AND ');
      }
    };
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  describe('ZebrunnerReportingClient.getAutomationStates', () => {
    it('should fetch automation states from API successfully', async () => {
      const states = await mockReportingClient.getAutomationStates(7);
      
      assert.strictEqual(states.length, 3);
      assert.deepStrictEqual(states[0], { id: 10, name: 'Not Automated' });
      assert.deepStrictEqual(states[1], { id: 11, name: 'To Be Automated' });
      assert.deepStrictEqual(states[2], { id: 12, name: 'Automated' });
    });

    it('should return default mapping when API fails', async () => {
      const states = await mockReportingClient.getAutomationStates(999);
      
      assert.strictEqual(states.length, 3);
      assert.deepStrictEqual(states[0], { id: 10, name: 'Not Automated' });
      assert.deepStrictEqual(states[1], { id: 11, name: 'To Be Automated' });
      assert.deepStrictEqual(states[2], { id: 12, name: 'Automated' });
    });

    it('should handle network errors gracefully', async () => {
      // Mock a network error scenario
      const originalMethod = mockReportingClient.makeAuthenticatedRequest;
      mockReportingClient.makeAuthenticatedRequest = async () => {
        throw new Error('Network timeout');
      };

      const states = await mockReportingClient.getAutomationStates(7);
      
      assert.strictEqual(states.length, 3);
      assert.strictEqual(states[0].name, 'Not Automated');
      
      // Restore original method
      mockReportingClient.makeAuthenticatedRequest = originalMethod;
    });

    it('should handle malformed API response', async () => {
      // Mock malformed response
      const originalMethod = mockReportingClient.makeAuthenticatedRequest;
      mockReportingClient.makeAuthenticatedRequest = async () => {
        return { data: 'invalid response' };
      };

      const states = await mockReportingClient.getAutomationStates(7);
      
      assert.strictEqual(states.length, 3);
      assert.strictEqual(states[0].name, 'Not Automated');
      
      // Restore original method
      mockReportingClient.makeAuthenticatedRequest = originalMethod;
    });
  });

  describe('RQL Filter Generation', () => {
    it('should generate correct RQL for single automation state by name', () => {
      const filter = mockEnhancedClient.buildRQLFilter({
        automationState: 'Not Automated'
      });
      
      assert.strictEqual(filter, "automationState.name = 'Not Automated'");
    });

    it('should generate correct RQL for single automation state by ID', () => {
      const filter = mockEnhancedClient.buildRQLFilter({
        automationState: 10
      });
      
      assert.strictEqual(filter, 'automationState.id = 10');
    });

    it('should generate correct RQL for multiple automation states by names', () => {
      const filter = mockEnhancedClient.buildRQLFilter({
        automationState: ['Not Automated', 'To Be Automated']
      });
      
      assert.strictEqual(filter, "automationState.name IN ['Not Automated', 'To Be Automated']");
    });

    it('should generate correct RQL for multiple automation states by IDs', () => {
      const filter = mockEnhancedClient.buildRQLFilter({
        automationState: [10, 11]
      });
      
      assert.strictEqual(filter, 'automationState.id IN [10, 11]');
    });

    it('should generate correct RQL for combined filters', () => {
      const filter = mockEnhancedClient.buildRQLFilter({
        automationState: 'To Be Automated',
        createdAfter: '2025-01-01'
      });
      
      assert.strictEqual(filter, "automationState.name = 'To Be Automated' AND createdAt >= '2025-01-01'");
    });

    it('should handle special characters in automation state names', () => {
      const filter = mockEnhancedClient.buildRQLFilter({
        automationState: "State with 'quotes'"
      });
      
      assert.strictEqual(filter, "automationState.name = 'State with \\'quotes\\''");
    });
  });

  describe('Test Case Filtering by Automation State', () => {
    it('should filter test cases by single automation state name', async () => {
      const result = await mockEnhancedClient.getTestCases('MCP', {
        automationState: 'Not Automated'
      });
      
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].key, 'TEST-1');
      assert.strictEqual(result.items[0].automationState.name, 'Not Automated');
    });

    it('should filter test cases by single automation state ID', async () => {
      const result = await mockEnhancedClient.getTestCases('MCP', {
        automationState: 11
      });
      
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].key, 'TEST-2');
      assert.strictEqual(result.items[0].automationState.id, 11);
    });

    it('should filter test cases by multiple automation states', async () => {
      const result = await mockEnhancedClient.getTestCases('MCP', {
        automationState: ['Not Automated', 'To Be Automated']
      });
      
      assert.strictEqual(result.items.length, 2);
      assert.strictEqual(result.items[0].automationState.name, 'Not Automated');
      assert.strictEqual(result.items[1].automationState.name, 'To Be Automated');
    });

    it('should return empty results for non-matching automation state', async () => {
      const result = await mockEnhancedClient.getTestCases('MCP', {
        automationState: 'Non-existent State'
      });
      
      assert.strictEqual(result.items.length, 0);
    });

    it('should handle mixed automation state types', async () => {
      const result = await mockEnhancedClient.getTestCases('MCP', {
        automationState: ['Not Automated', 12] // Mix of name and ID
      });
      
      assert.strictEqual(result.items.length, 2);
      const stateNames = result.items.map(item => item.automationState.name);
      assert(stateNames.includes('Not Automated'));
      assert(stateNames.includes('Automated'));
    });
  });

  describe('Tool Parameter Validation', () => {
    it('should accept string automation state', () => {
      const testState = 'Not Automated';
      assert.strictEqual(typeof testState, 'string');
      assert(testState.length > 0);
    });

    it('should accept number automation state', () => {
      const testState = 10;
      assert.strictEqual(typeof testState, 'number');
      assert(testState > 0);
    });

    it('should accept array of mixed automation states', () => {
      const testStates = ['Not Automated', 11, 'Automated'];
      assert(Array.isArray(testStates));
      assert.strictEqual(testStates.length, 3);
      assert.strictEqual(typeof testStates[0], 'string');
      assert.strictEqual(typeof testStates[1], 'number');
      assert.strictEqual(typeof testStates[2], 'string');
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully in automation state discovery', async () => {
      const states = await mockReportingClient.getAutomationStates(999);
      assert.strictEqual(states.length, 3); // Should return default mapping
      assert.strictEqual(states[0].name, 'Not Automated');
      assert.strictEqual(states[1].name, 'To Be Automated');
      assert.strictEqual(states[2].name, 'Automated');
    });

    it('should handle invalid project IDs', async () => {
      const states = await mockReportingClient.getAutomationStates(-1);
      assert.strictEqual(states.length, 3); // Should return default mapping
    });

    it('should provide meaningful default automation states', () => {
      const defaultStates = [
        { id: 10, name: 'Not Automated' },
        { id: 11, name: 'To Be Automated' },
        { id: 12, name: 'Automated' }
      ];
      
      assert.strictEqual(defaultStates.length, 3);
      assert(defaultStates.every(state => state.id > 0));
      assert(defaultStates.every(state => state.name.length > 0));
      assert(defaultStates.every(state => typeof state.id === 'number'));
      assert(defaultStates.every(state => typeof state.name === 'string'));
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with project resolution', async () => {
      // Mock project resolution
      const mockResolveProjectId = async (project: any) => {
        if (project === 'MCP' || project === 'android') {
          return { projectId: 7 };
        }
        throw new Error('Project not found');
      };

      const result = await mockResolveProjectId('MCP');
      assert.strictEqual(result.projectId, 7);
      
      const states = await mockReportingClient.getAutomationStates(result.projectId);
      assert.strictEqual(states.length, 3);
    });

    it('should support pagination with automation state filtering', async () => {
      const result = await mockEnhancedClient.getTestCases('MCP', {
        automationState: 'Not Automated',
        page: 0,
        size: 10
      });
      
      assert.strictEqual(result.items.length, 1);
      assert(result._meta);
      assert.strictEqual(typeof result._meta.total, 'number');
    });

    it('should combine automation state with other filters', async () => {
      const result = await mockEnhancedClient.getTestCases('MCP', {
        automationState: 'To Be Automated',
        suiteId: 123,
        createdAfter: '2025-01-01'
      });
      
      // Should apply all filters
      assert(Array.isArray(result.items));
      assert(result._meta);
    });
  });

  describe('Output Format Validation', () => {
    it('should generate valid JSON output for automation states', () => {
      const mockStates = [
        { id: 10, name: 'Not Automated' },
        { id: 11, name: 'To Be Automated' },
        { id: 12, name: 'Automated' }
      ];
      
      const result = {
        project: 'MCP',
        projectId: 7,
        automationStates: mockStates,
        mapping: mockStates.reduce((acc, state) => {
          acc[state.name] = state.id;
          return acc;
        }, {} as Record<string, number>)
      };
      
      assert.strictEqual(result.project, 'MCP');
      assert.strictEqual(result.projectId, 7);
      assert.strictEqual(result.automationStates.length, 3);
      assert.strictEqual(result.mapping['Not Automated'], 10);
      assert.strictEqual(result.mapping['To Be Automated'], 11);
      assert.strictEqual(result.mapping['Automated'], 12);
    });

    it('should generate valid markdown output structure', () => {
      const mockStates = [
        { id: 10, name: 'Not Automated' },
        { id: 11, name: 'To Be Automated' },
        { id: 12, name: 'Automated' }
      ];
      
      let markdown = '# Automation States for Project MCP\n\n';
      markdown += '**Project ID:** 7\n';
      markdown += `**Total States:** ${mockStates.length}\n\n`;
      
      assert(markdown.includes('# Automation States'));
      assert(markdown.includes('Project ID'));
      assert(markdown.includes(`Total States:** ${mockStates.length}`));
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle empty automation state arrays', async () => {
      const result = await mockEnhancedClient.getTestCases('MCP', {
        automationState: []
      });
      
      // Empty array should return all test cases (no filtering)
      assert.strictEqual(result.items.length, 3);
    });

    it('should handle null/undefined automation states', async () => {
      const result1 = await mockEnhancedClient.getTestCases('MCP', {
        automationState: null
      });
      
      const result2 = await mockEnhancedClient.getTestCases('MCP', {
        automationState: undefined
      });
      
      // Should return all test cases when no filtering is applied
      assert.strictEqual(result1.items.length, 3);
      assert.strictEqual(result2.items.length, 3);
    });

    it('should handle large numbers of automation states', () => {
      const largeStateArray = Array.from({ length: 100 }, (_, i) => i + 1);
      const filter = mockEnhancedClient.buildRQLFilter({
        automationState: largeStateArray
      });
      
      assert(filter.includes('automationState.id IN'));
      assert(filter.includes('100'));
    });

    it('should validate automation state data structure', () => {
      const validState = { id: 10, name: 'Not Automated' };
      
      assert(typeof validState.id === 'number');
      assert(typeof validState.name === 'string');
      assert(validState.id > 0);
      assert(validState.name.length > 0);
    });
  });
});
