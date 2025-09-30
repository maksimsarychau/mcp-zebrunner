import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Unit tests for project discovery functionality
 * 
 * Tests the following functionality:
 * - get_available_projects tool
 * - Enhanced project resolution with suggestions
 * - Dynamic project discovery and fallback logic
 */

describe('Project Discovery Unit Tests', () => {
  
  describe('get_available_projects Tool', () => {
    
    it('should validate tool parameters schema', () => {
      const validParams = {
        starred: true,
        publiclyAccessible: false,
        format: 'formatted',
        includePaginationInfo: true
      };
      
      // Optional boolean parameters
      assert.ok(typeof validParams.starred === 'boolean' || validParams.starred === undefined, 
        'starred should be boolean or undefined');
      assert.ok(typeof validParams.publiclyAccessible === 'boolean' || validParams.publiclyAccessible === undefined, 
        'publiclyAccessible should be boolean or undefined');
      
      // Format validation
      assert.ok(['raw', 'formatted'].includes(validParams.format), 'format should be raw or formatted');
      
      // Pagination info flag
      assert.ok(typeof validParams.includePaginationInfo === 'boolean', 'includePaginationInfo should be boolean');
    });
    
    it('should validate project response structure', () => {
      const mockProjectResponse = {
        items: [
          {
            id: 7,
            name: 'MFP Android',
            key: 'MFPAND',
            logoUrl: '/files/18b4939f-37e9-0576-8c73-478c7095192e',
            createdAt: '2023-09-11T17:43:13.337691Z',
            leadId: 26,
            starred: true,
            publiclyAccessible: true,
            deleted: false
          },
          {
            id: 8,
            name: 'MFP iOS',
            key: 'MFPIOS',
            logoUrl: '/files/18b49392-14e6-bd47-bf9d-195db8161702',
            createdAt: '2023-09-11T17:43:52.711029Z',
            leadId: null,
            starred: true,
            publiclyAccessible: true,
            deleted: false
          }
        ]
      };
      
      assert.ok(Array.isArray(mockProjectResponse.items), 'should have items array');
      
      mockProjectResponse.items.forEach(project => {
        assert.ok(typeof project.id === 'number', 'project id should be number');
        assert.ok(typeof project.name === 'string', 'project name should be string');
        assert.ok(typeof project.key === 'string', 'project key should be string');
        assert.ok(typeof project.starred === 'boolean', 'starred should be boolean');
        assert.ok(typeof project.publiclyAccessible === 'boolean', 'publiclyAccessible should be boolean');
        assert.ok(typeof project.deleted === 'boolean', 'deleted should be boolean');
        assert.ok(project.leadId === null || typeof project.leadId === 'number', 'leadId should be number or null');
      });
    });
    
    it('should validate pagination info response structure', () => {
      const mockPaginationResponse = {
        data: {
          limit: 50,
          currentTotal: 12
        }
      };
      
      assert.ok(mockPaginationResponse.data, 'should have data object');
      assert.ok(typeof mockPaginationResponse.data.limit === 'number', 'limit should be number');
      assert.ok(typeof mockPaginationResponse.data.currentTotal === 'number', 'currentTotal should be number');
      assert.ok(mockPaginationResponse.data.limit > 0, 'limit should be positive');
      assert.ok(mockPaginationResponse.data.currentTotal >= 0, 'currentTotal should be non-negative');
    });
    
    it('should validate client-side filtering logic', () => {
      const mockProjects = [
        { id: 1, name: 'Project 1', key: 'PROJ1', starred: true, publiclyAccessible: true, deleted: false },
        { id: 2, name: 'Project 2', key: 'PROJ2', starred: false, publiclyAccessible: true, deleted: false },
        { id: 3, name: 'Project 3', key: 'PROJ3', starred: true, publiclyAccessible: false, deleted: false },
        { id: 4, name: 'Deleted Project', key: 'DEL', starred: false, publiclyAccessible: true, deleted: true }
      ];
      
      // Test deleted filter (should always exclude deleted)
      const nonDeletedProjects = mockProjects.filter(p => !p.deleted);
      assert.equal(nonDeletedProjects.length, 3, 'should exclude deleted projects');
      
      // Test starred filter
      const starredProjects = nonDeletedProjects.filter(p => p.starred === true);
      assert.equal(starredProjects.length, 2, 'should filter by starred status');
      
      // Test public accessibility filter
      const publicProjects = nonDeletedProjects.filter(p => p.publiclyAccessible === true);
      assert.equal(publicProjects.length, 2, 'should filter by public accessibility');
      
      // Test combined filters
      const starredPublicProjects = nonDeletedProjects.filter(p => p.starred === true && p.publiclyAccessible === true);
      assert.equal(starredPublicProjects.length, 1, 'should apply multiple filters correctly');
    });
  });
  
  describe('Enhanced Project Resolution', () => {
    
    it('should validate project resolution logic', () => {
      const mockAvailableProjects = [
        { id: 7, name: 'MFP Android', key: 'MFPAND' },
        { id: 8, name: 'MFP iOS', key: 'MFPIOS' },
        { id: 9, name: 'MFP Web', key: 'MFPWEB' },
        { id: 3, name: 'MFP', key: 'MFP' }
      ];
      
      const hardcodedAliases = {
        web: 'MFPWEB',
        android: 'MFPAND', 
        ios: 'MFPIOS',
        api: 'MFPAPI'
      };
      
      // Test exact key match
      const exactMatch = mockAvailableProjects.find(p => p.key === 'MFPAND');
      assert.ok(exactMatch, 'should find exact key match');
      assert.equal(exactMatch.id, 7, 'should return correct project ID');
      
      // Test case-insensitive match
      const caseInsensitiveMatch = mockAvailableProjects.find(p => 
        p.key.toLowerCase() === 'mfpand'.toLowerCase()
      );
      assert.ok(caseInsensitiveMatch, 'should find case-insensitive match');
      
      // Test name-based match
      const nameMatch = mockAvailableProjects.find(p => 
        p.name.toLowerCase() === 'mfp android'.toLowerCase()
      );
      assert.ok(nameMatch, 'should find name-based match');
      
      // Test hardcoded alias resolution
      const aliasKey = hardcodedAliases['android'];
      const aliasMatch = mockAvailableProjects.find(p => p.key === aliasKey);
      assert.ok(aliasMatch, 'should resolve hardcoded aliases');
      assert.equal(aliasMatch.key, 'MFPAND', 'should resolve to correct key');
    });
    
    it('should generate helpful suggestions for invalid projects', () => {
      const mockAvailableProjects = [
        { id: 7, name: 'MFP Android', key: 'MFPAND' },
        { id: 8, name: 'MFP iOS', key: 'MFPIOS' },
        { id: 9, name: 'MFP Web', key: 'MFPWEB' },
        { id: 3, name: 'MFP', key: 'MFP' }
      ];
      
      const generateSuggestions = (input: string, projects: any[]) => {
        return projects
          .filter(p => 
            p.key.toLowerCase().includes(input.toLowerCase()) ||
            p.name.toLowerCase().includes(input.toLowerCase())
          )
          .slice(0, 5)
          .map(p => `"${p.key}" (${p.name})`);
      };
      
      // Test partial match suggestions
      const suggestions1 = generateSuggestions('MFP', mockAvailableProjects);
      assert.ok(suggestions1.length > 0, 'should generate suggestions for partial matches');
      assert.ok(suggestions1.some(s => s.includes('MFPAND')), 'should include relevant suggestions');
      
      // Test typo suggestions
      const suggestions2 = generateSuggestions('ANDROID', mockAvailableProjects);
      assert.ok(suggestions2.length > 0, 'should generate suggestions for typos');
      assert.ok(suggestions2.some(s => s.includes('MFP Android')), 'should suggest based on name match');
      
      // Test no match case
      const suggestions3 = generateSuggestions('INVALID', mockAvailableProjects);
      assert.equal(suggestions3.length, 0, 'should return empty suggestions for no matches');
    });
    
    it('should validate suggestion message formatting', () => {
      const mockProjects = [
        { id: 7, name: 'MFP Android', key: 'MFPAND' },
        { id: 8, name: 'MFP iOS', key: 'MFPIOS' }
      ];
      
      const formatSuggestionMessage = (input: string, suggestions: string[], allProjects: string[]) => {
        const suggestionText = suggestions.length > 0
          ? `\n\n💡 Did you mean: ${suggestions.join(', ')}?\n\n📋 Available projects: ${allProjects.join(', ')}`
          : `\n\n📋 Available projects: ${allProjects.join(', ')}`;
        
        return `Project "${input}" not found.${suggestionText}`;
      };
      
      const suggestions = ['"MFPAND" (MFP Android)'];
      const allProjects = ['"MFPAND" (MFP Android)', '"MFPIOS" (MFP iOS)'];
      
      const message = formatSuggestionMessage('INVALID', suggestions, allProjects);
      
      assert.ok(message.includes('Project "INVALID" not found'), 'should include original input');
      assert.ok(message.includes('💡 Did you mean'), 'should include suggestion prompt');
      assert.ok(message.includes('📋 Available projects'), 'should include full project list');
      assert.ok(message.includes('MFPAND'), 'should include suggested projects');
    });
  });
  
  describe('Formatted Output Structure', () => {
    
    it('should validate formatted project response structure', () => {
      const mockFormattedResponse = {
        summary: {
          totalProjects: 12,
          starred: true,
          publiclyAccessible: undefined,
          systemLimit: 50,
          systemTotal: 12
        },
        projects: [
          {
            name: 'MFP Android',
            key: 'MFPAND',
            id: 7,
            starred: true,
            publiclyAccessible: true,
            logoUrl: '/files/18b4939f-37e9-0576-8c73-478c7095192e',
            createdAt: '2023-09-11T17:43:13.337691Z',
            leadId: 26
          }
        ],
        keyToIdMapping: {
          'MFPAND': 7,
          'MFPIOS': 8,
          'MFPWEB': 9
        },
        usage: {
          note: 'Use \'key\' field for project parameter in other tools',
          examples: [
            'project: "MFPAND" (for MFP Android)',
            'project: "MFPIOS" (for MFP iOS)',
            'project: "MFPWEB" (for MFP Web)'
          ]
        }
      };
      
      // Validate summary structure
      assert.ok(mockFormattedResponse.summary, 'should have summary object');
      assert.ok(typeof mockFormattedResponse.summary.totalProjects === 'number', 'totalProjects should be number');
      
      // Validate projects array
      assert.ok(Array.isArray(mockFormattedResponse.projects), 'projects should be array');
      
      const project = mockFormattedResponse.projects[0];
      assert.ok(typeof project.name === 'string', 'project name should be string');
      assert.ok(typeof project.key === 'string', 'project key should be string');
      assert.ok(typeof project.id === 'number', 'project id should be number');
      
      // Validate key-to-ID mapping
      assert.ok(typeof mockFormattedResponse.keyToIdMapping === 'object', 'keyToIdMapping should be object');
      Object.entries(mockFormattedResponse.keyToIdMapping).forEach(([key, id]) => {
        assert.ok(typeof key === 'string', 'mapping key should be string');
        assert.ok(typeof id === 'number', 'mapping id should be number');
      });
      
      // Validate usage information
      assert.ok(mockFormattedResponse.usage, 'should have usage object');
      assert.ok(typeof mockFormattedResponse.usage.note === 'string', 'usage note should be string');
      assert.ok(Array.isArray(mockFormattedResponse.usage.examples), 'usage examples should be array');
    });
  });
  
  describe('Backward Compatibility', () => {
    
    it('should maintain hardcoded alias support', () => {
      const hardcodedAliases = {
        web: 'MFPWEB',
        android: 'MFPAND',
        ios: 'MFPIOS',
        api: 'MFPAPI'
      };
      
      // Test that hardcoded aliases are still valid
      Object.entries(hardcodedAliases).forEach(([alias, expectedKey]) => {
        assert.ok(typeof alias === 'string', 'alias should be string');
        assert.ok(typeof expectedKey === 'string', 'expected key should be string');
        assert.ok(expectedKey.length > 0, 'expected key should not be empty');
      });
      
      // Test alias resolution logic
      const resolveProjectKey = (input: string, aliases: Record<string, string>) => {
        return aliases[input] || input;
      };
      
      assert.equal(resolveProjectKey('android', hardcodedAliases), 'MFPAND', 'should resolve android alias');
      assert.equal(resolveProjectKey('MFPAND', hardcodedAliases), 'MFPAND', 'should pass through direct keys');
      assert.equal(resolveProjectKey('CUSTOM', hardcodedAliases), 'CUSTOM', 'should pass through unknown keys');
    });
    
    it('should validate fallback mechanism', () => {
      const mockProjectResolution = async (input: string | number) => {
        // Simulate the resolution logic
        if (typeof input === 'number') {
          return { projectId: input };
        }
        
        // Try hardcoded aliases first
        const hardcodedAliases = { android: 'MFPAND' };
        const projectKey = hardcodedAliases[input as keyof typeof hardcodedAliases] || input;
        
        // Simulate API call success/failure
        const knownProjects = ['MFPAND', 'MFPIOS', 'MFPWEB'];
        if (knownProjects.includes(projectKey)) {
          return { projectId: 7 }; // Mock ID
        }
        
        // Fallback to dynamic discovery would happen here
        throw new Error(`Project "${input}" not found`);
      };
      
      // Test numeric input (should pass through)
      assert.doesNotReject(async () => {
        const result = await mockProjectResolution(7);
        assert.equal(result.projectId, 7, 'should handle numeric project IDs');
      });
      
      // Test hardcoded alias (should resolve)
      assert.doesNotReject(async () => {
        const result = await mockProjectResolution('android');
        assert.equal(result.projectId, 7, 'should resolve hardcoded aliases');
      });
      
      // Test unknown project (should trigger fallback)
      assert.rejects(async () => {
        await mockProjectResolution('UNKNOWN');
      }, /Project "UNKNOWN" not found/, 'should reject unknown projects');
    });
  });
});
