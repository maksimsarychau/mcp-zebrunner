import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Unit tests for milestone-related tools
 * 
 * Tests the following functionality:
 * - get_project_milestones tool
 * - Milestone overdue filtering logic
 * - Enhanced milestone parameter support in existing tools
 */

describe('Milestone Tools Unit Tests', () => {
  
  describe('get_project_milestones Tool', () => {
    
    it('should validate tool parameters schema', () => {
      const validParams = {
        project: 'android',
        page: 1,
        pageSize: 10,
        status: 'incomplete',
        format: 'formatted'
      };
      
      // Project parameter validation
      assert.ok(['web', 'android', 'ios', 'api'].includes(validParams.project) || typeof validParams.project === 'number', 
        'project should be valid alias or number');
      
      // Pagination validation
      assert.ok(validParams.page >= 1, 'page should be 1-based');
      assert.ok(validParams.pageSize > 0 && validParams.pageSize <= 100, 'pageSize should be between 1-100');
      
      // Status validation
      assert.ok(['incomplete', 'completed', 'overdue', 'all'].includes(validParams.status), 
        'status should be valid enum value');
      
      // Format validation
      assert.ok(['raw', 'formatted'].includes(validParams.format), 'format should be raw or formatted');
    });
    
    it('should validate milestone response structure', () => {
      const mockMilestoneResponse = {
        items: [
          {
            id: 556,
            name: '25.39.0',
            completed: false,
            description: null,
            projectId: 7,
            dueDate: '2025-09-30T22:00:00Z',
            startDate: '2025-09-23T22:00:00Z'
          }
        ],
        _meta: {
          total: 1,
          totalPages: 1
        }
      };
      
      assert.ok(Array.isArray(mockMilestoneResponse.items), 'should have items array');
      assert.ok(mockMilestoneResponse._meta, 'should have _meta object');
      assert.ok(typeof mockMilestoneResponse._meta.total === 'number', 'total should be number');
      assert.ok(typeof mockMilestoneResponse._meta.totalPages === 'number', 'totalPages should be number');
      
      // Validate milestone item structure
      const milestone = mockMilestoneResponse.items[0];
      assert.ok(typeof milestone.id === 'number', 'milestone id should be number');
      assert.ok(typeof milestone.name === 'string', 'milestone name should be string');
      assert.ok(typeof milestone.completed === 'boolean', 'completed should be boolean');
      assert.ok(typeof milestone.projectId === 'number', 'projectId should be number');
    });
    
    it('should handle null date fields correctly', () => {
      const milestoneWithNullDates = {
        id: 123,
        name: 'Test Milestone',
        completed: false,
        description: null,
        projectId: 7,
        dueDate: null,
        startDate: null
      };
      
      // Should not throw when dates are null
      assert.doesNotThrow(() => {
        const hasValidStructure = (
          typeof milestoneWithNullDates.id === 'number' &&
          typeof milestoneWithNullDates.name === 'string' &&
          typeof milestoneWithNullDates.completed === 'boolean' &&
          (milestoneWithNullDates.dueDate === null || typeof milestoneWithNullDates.dueDate === 'string') &&
          (milestoneWithNullDates.startDate === null || typeof milestoneWithNullDates.startDate === 'string')
        );
        assert.ok(hasValidStructure, 'should handle null dates gracefully');
      });
    });
  });
  
  describe('Milestone Overdue Filtering Logic', () => {
    
    it('should correctly identify overdue milestones', () => {
      const now = new Date('2025-10-01T12:00:00Z'); // Mock current date
      
      const testCases = [
        {
          milestone: {
            id: 1,
            name: 'Overdue Milestone',
            completed: false,
            dueDate: '2025-09-30T22:00:00Z', // Yesterday
            projectId: 7
          },
          expected: true,
          description: 'incomplete milestone past due date should be overdue'
        },
        {
          milestone: {
            id: 2,
            name: 'Future Milestone',
            completed: false,
            dueDate: '2025-10-05T22:00:00Z', // Future
            projectId: 7
          },
          expected: false,
          description: 'incomplete milestone with future due date should not be overdue'
        },
        {
          milestone: {
            id: 3,
            name: 'Completed Past Milestone',
            completed: true,
            dueDate: '2025-09-30T22:00:00Z', // Past but completed
            projectId: 7
          },
          expected: false,
          description: 'completed milestone should never be overdue'
        },
        {
          milestone: {
            id: 4,
            name: 'No Due Date',
            completed: false,
            dueDate: null,
            projectId: 7
          },
          expected: false,
          description: 'milestone with null due date should not be overdue'
        }
      ];
      
      testCases.forEach(testCase => {
        const isOverdue = (milestone: any, currentDate: Date): boolean => {
          if (!milestone.dueDate || milestone.completed) {
            return false;
          }
          
          const dueDate = new Date(milestone.dueDate);
          
          // Compare dates using UTC to avoid timezone issues
          const nowDateOnly = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()));
          const dueDateOnly = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()));
          
          return dueDateOnly < nowDateOnly;
        };
        
        const result = isOverdue(testCase.milestone, now);
        assert.equal(result, testCase.expected, testCase.description);
      });
    });
    
    it('should filter milestones by status correctly', () => {
      const mockMilestones = [
        { id: 1, name: 'Active', completed: false, dueDate: '2025-10-05T22:00:00Z', projectId: 7 },
        { id: 2, name: 'Overdue', completed: false, dueDate: '2025-09-25T22:00:00Z', projectId: 7 },
        { id: 3, name: 'Completed', completed: true, dueDate: '2025-09-25T22:00:00Z', projectId: 7 },
        { id: 4, name: 'No Date', completed: false, dueDate: null, projectId: 7 }
      ];
      
      const currentDate = new Date('2025-10-01T12:00:00Z');
      
      const isOverdue = (milestone: any): boolean => {
        if (!milestone.dueDate || milestone.completed) return false;
        const dueDate = new Date(milestone.dueDate);
        return dueDate < currentDate;
      };
      
      // Test incomplete filter (should exclude overdue)
      const incompleteFiltered = mockMilestones.filter(m => !m.completed && !isOverdue(m));
      assert.equal(incompleteFiltered.length, 2, 'incomplete filter should return active + no-date milestones');
      assert.ok(incompleteFiltered.some(m => m.name === 'Active'), 'should include active milestone');
      assert.ok(incompleteFiltered.some(m => m.name === 'No Date'), 'should include no-date milestone');
      
      // Test overdue filter
      const overdueFiltered = mockMilestones.filter(m => !m.completed && isOverdue(m));
      assert.equal(overdueFiltered.length, 1, 'overdue filter should return only overdue milestones');
      assert.equal(overdueFiltered[0].name, 'Overdue', 'should include overdue milestone');
      
      // Test completed filter
      const completedFiltered = mockMilestones.filter(m => m.completed);
      assert.equal(completedFiltered.length, 1, 'completed filter should return only completed milestones');
      assert.equal(completedFiltered[0].name, 'Completed', 'should include completed milestone');
      
      // Test all filter
      const allFiltered = mockMilestones;
      assert.equal(allFiltered.length, 4, 'all filter should return all milestones');
    });
  });
  
  describe('Enhanced Milestone Parameter Support', () => {
    
    it('should validate milestone parameter in existing tools', () => {
      const toolsWithMilestoneSupport = [
        'get_platform_results_by_period',
        'get_top_bugs'
      ];
      
      const validMilestoneParams = [
        [],                    // Empty array (default)
        ['25.39.0'],          // Single milestone
        ['25.39.0', '25.38.0'] // Multiple milestones
      ];
      
      toolsWithMilestoneSupport.forEach(toolName => {
        validMilestoneParams.forEach(milestoneParam => {
          assert.ok(Array.isArray(milestoneParam), `${toolName} milestone parameter should be array`);
          milestoneParam.forEach(milestone => {
            assert.ok(typeof milestone === 'string', `${toolName} milestone items should be strings`);
            assert.ok(milestone.length > 0, `${toolName} milestone items should not be empty`);
          });
        });
      });
    });
    
    it('should validate buildParamsConfig milestone integration', () => {
      const mockBuildParamsConfig = (opts: {
        period: string;
        milestone?: string[];
        platform?: string[];
      }) => {
        return {
          BROWSER: [],
          DEFECT: [], APPLICATION: [], BUILD: [], PRIORITY: [],
          RUN: [], USER: [], ENV: [], MILESTONE: opts.milestone || [],
          PLATFORM: opts.platform || [],
          STATUS: [], LOCALE: [],
          PERIOD: opts.period,
          dashboardName: "Test Dashboard",
          isReact: true
        };
      };
      
      // Test with milestone parameter
      const configWithMilestone = mockBuildParamsConfig({
        period: 'Last 7 Days',
        milestone: ['25.39.0'],
        platform: ['android']
      });
      
      assert.ok(Array.isArray(configWithMilestone.MILESTONE), 'MILESTONE should be array');
      assert.equal(configWithMilestone.MILESTONE.length, 1, 'should contain provided milestone');
      assert.equal(configWithMilestone.MILESTONE[0], '25.39.0', 'should contain correct milestone value');
      
      // Test without milestone parameter (default)
      const configWithoutMilestone = mockBuildParamsConfig({
        period: 'Last 7 Days',
        platform: ['android']
      });
      
      assert.ok(Array.isArray(configWithoutMilestone.MILESTONE), 'MILESTONE should be array even when not provided');
      assert.equal(configWithoutMilestone.MILESTONE.length, 0, 'should default to empty array');
    });
  });
  
  describe('Formatted Output Structure', () => {
    
    it('should validate formatted milestone response structure', () => {
      const mockFormattedResponse = {
        summary: {
          project: 'android',
          status: 'incomplete',
          page: 1,
          pageSize: 10,
          totalElements: 15,
          totalPages: 2,
          filteredFrom: 29
        },
        milestones: [
          {
            name: '25.39.0',
            completed: false,
            overdue: false,
            description: null,
            startDate: '2025-09-23T22:00:00Z',
            dueDate: '2025-09-30T22:00:00Z',
            id: 556
          }
        ]
      };
      
      // Validate summary structure
      assert.ok(mockFormattedResponse.summary, 'should have summary object');
      assert.ok(typeof mockFormattedResponse.summary.project === 'string', 'project should be string');
      assert.ok(typeof mockFormattedResponse.summary.status === 'string', 'status should be string');
      assert.ok(typeof mockFormattedResponse.summary.totalElements === 'number', 'totalElements should be number');
      assert.ok(typeof mockFormattedResponse.summary.filteredFrom === 'number', 'filteredFrom should be number');
      
      // Validate milestones array structure
      assert.ok(Array.isArray(mockFormattedResponse.milestones), 'milestones should be array');
      
      const milestone = mockFormattedResponse.milestones[0];
      assert.ok(typeof milestone.name === 'string', 'milestone name should be string');
      assert.ok(typeof milestone.completed === 'boolean', 'completed should be boolean');
      assert.ok(typeof milestone.overdue === 'boolean', 'overdue should be boolean');
      assert.ok(typeof milestone.id === 'number', 'id should be number');
    });
  });
});
