/**
 * Dynamic Rules Parser for Test Case Validation
 * Parses validation rules from markdown documents like test_case_review_rules.md
 */

export interface ValidationRule {
  id: string;
  category: string;
  name: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  checkFunction: string; // Function name to execute
  parameters?: Record<string, any>;
  suggestion?: string;
  enabled: boolean;
}

export interface ValidationCheckpoint {
  id: string;
  category: string;
  name: string;
  description: string;
  rules: string[]; // Rule IDs that belong to this checkpoint
}

export interface ValidationRuleSet {
  name: string;
  version: string;
  description: string;
  scoreThresholds: {
    excellent: number;
    good: number;
    needs_improvement: number;
  };
  rules: ValidationRule[];
  checkpoints: ValidationCheckpoint[];
  customChecks?: Record<string, string>; // Custom validation functions
}

export class DynamicRulesParser {
  /**
   * Parses validation rules from markdown content
   */
  static parseRulesFromMarkdown(
    rulesContent: string, 
    checkpointsContent: string
  ): ValidationRuleSet {
    const rules = this.extractRulesFromMarkdown(rulesContent);
    const checkpoints = this.extractCheckpointsFromMarkdown(checkpointsContent);
    
    return {
      name: "Test Case Validation Rules",
      version: "1.0.0",
      description: "Dynamic validation rules parsed from project documentation",
      scoreThresholds: {
        excellent: 90,
        good: 80,
        needs_improvement: 60
      },
      rules,
      checkpoints
    };
  }

  /**
   * Extracts rules from the review rules markdown
   */
  private static extractRulesFromMarkdown(content: string): ValidationRule[] {
    const rules: ValidationRule[] = [];
    const lines = content.split('\n');
    
    let currentCategory = '';
    let currentRule: Partial<ValidationRule> = {};
    let ruleCounter = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Detect category headers (## or ###)
      if (line.match(/^##\s+(.+)/)) {
        currentCategory = line.replace(/^##\s+/, '').trim();
        continue;
      }
      
      if (line.match(/^###\s+(.+)/)) {
        currentCategory = line.replace(/^###\s+/, '').trim();
        continue;
      }

      // Detect rule definitions
      if (line.match(/^\d+\.\s+(.+)/)) {
        // Save previous rule if exists
        if (currentRule.name) {
          rules.push(this.completeRule(currentRule, currentCategory, ruleCounter++));
          currentRule = {};
        }
        
        currentRule.name = line.replace(/^\d+\.\s+/, '').trim();
        continue;
      }

      // Extract rule details
      if (line.startsWith('- **Rule**:')) {
        currentRule.description = line.replace('- **Rule**:', '').trim();
      } else if (line.startsWith('- **Purpose**:')) {
        // Additional context for the rule
        currentRule.description = (currentRule.description || '') + ' ' + line.replace('- **Purpose**:', '').trim();
      } else if (line.startsWith('- **Review Check**:')) {
        currentRule.suggestion = line.replace('- **Review Check**:', '').trim();
      } else if (line.startsWith('- **Critical**:')) {
        currentRule.severity = 'critical';
        currentRule.description = (currentRule.description || '') + ' ' + line.replace('- **Critical**:', '').trim();
      } else if (line.startsWith('- **Anti-pattern**:')) {
        currentRule.suggestion = 'Avoid: ' + line.replace('- **Anti-pattern**:', '').trim();
      } else if (line.startsWith('- **Required**:') || line.startsWith('- **Required Elements**:')) {
        currentRule.parameters = { required: line.replace(/- \*\*Required.*?:\*\*/, '').trim() };
      }
    }

    // Add the last rule
    if (currentRule.name) {
      rules.push(this.completeRule(currentRule, currentCategory, ruleCounter));
    }

    return rules;
  }

  /**
   * Extracts checkpoints from the analysis checkpoints markdown
   */
  private static extractCheckpointsFromMarkdown(content: string): ValidationCheckpoint[] {
    const checkpoints: ValidationCheckpoint[] = [];
    const lines = content.split('\n');
    
    let currentCategory = '';
    let currentCheckpoint: Partial<ValidationCheckpoint> = {};
    let checkpointCounter = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Detect category headers
      if (line.match(/^###\s+☐\s+(.+)/)) {
        // Save previous checkpoint if exists
        if (currentCheckpoint.name) {
          checkpoints.push(this.completeCheckpoint(currentCheckpoint, currentCategory, checkpointCounter++));
          currentCheckpoint = {};
        }
        
        currentCategory = line.replace(/^###\s+☐\s+/, '').trim();
        currentCheckpoint.name = currentCategory;
        currentCheckpoint.rules = [];
        continue;
      }

      // Extract individual checks
      if (line.match(/^-\s+\[\s+\]\s+\*\*(.+?)\*\*:/)) {
        const checkName = line.match(/\*\*(.+?)\*\*/)?.[1] || '';
        const checkDescription = line.replace(/^-\s+\[\s+\]\s+\*\*(.+?)\*\*:\s*/, '').trim();
        
        if (currentCheckpoint.rules) {
          currentCheckpoint.rules.push(`${currentCategory.toLowerCase().replace(/\s+/g, '_')}_${checkName.toLowerCase().replace(/\s+/g, '_')}`);
        }
      }
    }

    // Add the last checkpoint
    if (currentCheckpoint.name) {
      checkpoints.push(this.completeCheckpoint(currentCheckpoint, currentCategory, checkpointCounter));
    }

    return checkpoints;
  }

  /**
   * Completes a rule with default values and mappings
   */
  private static completeRule(rule: Partial<ValidationRule>, category: string, id: number): ValidationRule {
    const severity = this.determineSeverity(rule.description || '', category);
    const checkFunction = this.mapToCheckFunction(rule.name || '', category);
    
    return {
      id: `rule_${id}`,
      category: category || 'General',
      name: rule.name || `Rule ${id}`,
      description: rule.description || '',
      severity,
      checkFunction,
      parameters: rule.parameters || {},
      suggestion: rule.suggestion || '',
      enabled: true
    };
  }

  /**
   * Completes a checkpoint with default values
   */
  private static completeCheckpoint(checkpoint: Partial<ValidationCheckpoint>, category: string, id: number): ValidationCheckpoint {
    return {
      id: `checkpoint_${id}`,
      category: category || 'General',
      name: checkpoint.name || `Checkpoint ${id}`,
      description: checkpoint.description || '',
      rules: checkpoint.rules || []
    };
  }

  /**
   * Determines severity based on rule content and category
   */
  private static determineSeverity(description: string, category: string): 'critical' | 'major' | 'minor' {
    const descLower = description.toLowerCase();
    const categoryLower = category.toLowerCase();
    
    // Critical indicators
    if (descLower.includes('must') || descLower.includes('required') || 
        descLower.includes('never') || descLower.includes('critical') ||
        categoryLower.includes('core') || categoryLower.includes('independence')) {
      return 'critical';
    }
    
    // Major indicators
    if (descLower.includes('should') || descLower.includes('important') || 
        descLower.includes('always') || descLower.includes('ensure') ||
        categoryLower.includes('automation') || categoryLower.includes('quality')) {
      return 'major';
    }
    
    // Default to minor
    return 'minor';
  }

  /**
   * Maps rule names to validation check functions
   */
  private static mapToCheckFunction(ruleName: string, category: string): string {
    const nameLower = ruleName.toLowerCase();
    const categoryLower = category.toLowerCase();
    
    // Title-related checks
    if (nameLower.includes('title') || nameLower.includes('naming')) {
      return 'validateTitle';
    }
    
    // Precondition checks
    if (nameLower.includes('precondition') || nameLower.includes('setup')) {
      return 'validatePreconditions';
    }
    
    // Step-related checks
    if (nameLower.includes('step') || nameLower.includes('action') || nameLower.includes('instruction')) {
      return 'validateSteps';
    }
    
    // Independence checks
    if (nameLower.includes('independence') || nameLower.includes('standalone') || categoryLower.includes('independence')) {
      return 'validateIndependence';
    }
    
    // Single responsibility checks
    if (nameLower.includes('responsibility') || nameLower.includes('single') || nameLower.includes('focus')) {
      return 'validateSingleResponsibility';
    }
    
    // Automation readiness
    if (nameLower.includes('automation') || categoryLower.includes('automation')) {
      return 'validateAutomationReadiness';
    }
    
    // Expected results
    if (nameLower.includes('result') || nameLower.includes('expected') || nameLower.includes('validation')) {
      return 'validateExpectedResults';
    }
    
    // Completeness
    if (nameLower.includes('complete') || nameLower.includes('coverage') || nameLower.includes('end-to-end')) {
      return 'validateCompleteness';
    }
    
    // Language and clarity
    if (nameLower.includes('language') || nameLower.includes('clarity') || nameLower.includes('terminology')) {
      return 'validateLanguageClarity';
    }
    
    // Default general validation
    return 'validateGeneral';
  }

  /**
   * Loads rules from file paths
   */
  static async loadRulesFromFiles(rulesFilePath: string, checkpointsFilePath: string): Promise<ValidationRuleSet> {
    try {
      const fs = await import('fs/promises');
      const rulesContent = await fs.readFile(rulesFilePath, 'utf-8');
      const checkpointsContent = await fs.readFile(checkpointsFilePath, 'utf-8');
      
      return this.parseRulesFromMarkdown(rulesContent, checkpointsContent);
    } catch (error) {
      console.warn(`Failed to load rules from files: ${error}`);
      return this.getDefaultRuleSet();
    }
  }

  /**
   * Returns a default rule set if parsing fails
   */
  static getDefaultRuleSet(): ValidationRuleSet {
    return {
      name: "Default Test Case Validation Rules",
      version: "1.0.0",
      description: "Default validation rules for test cases",
      scoreThresholds: {
        excellent: 90,
        good: 80,
        needs_improvement: 60
      },
      rules: [
        {
          id: "title_presence",
          category: "Title Quality",
          name: "Title Presence",
          description: "Test case must have a descriptive title",
          severity: "critical",
          checkFunction: "validateTitle",
          suggestion: "Add a clear, descriptive title",
          enabled: true
        },
        {
          id: "preconditions_presence",
          category: "Preconditions",
          name: "Preconditions Presence",
          description: "Test case must have explicit preconditions",
          severity: "critical",
          checkFunction: "validatePreconditions",
          suggestion: "Add detailed preconditions including user state, environment, and data requirements",
          enabled: true
        },
        {
          id: "steps_presence",
          category: "Steps",
          name: "Steps Presence",
          description: "Test case must have detailed test steps",
          severity: "critical",
          checkFunction: "validateSteps",
          suggestion: "Add step-by-step instructions from beginning to end",
          enabled: true
        }
      ],
      checkpoints: [
        {
          id: "basic_structure",
          category: "Basic Structure",
          name: "Basic Structure Validation",
          description: "Validates basic test case structure",
          rules: ["title_presence", "preconditions_presence", "steps_presence"]
        }
      ]
    };
  }

  /**
   * Validates and sanitizes a rule set
   */
  static validateRuleSet(ruleSet: ValidationRuleSet): ValidationRuleSet {
    // Ensure all required properties exist
    const validated: ValidationRuleSet = {
      name: ruleSet.name || "Unnamed Rule Set",
      version: ruleSet.version || "1.0.0",
      description: ruleSet.description || "",
      scoreThresholds: {
        excellent: ruleSet.scoreThresholds?.excellent || 90,
        good: ruleSet.scoreThresholds?.good || 80,
        needs_improvement: ruleSet.scoreThresholds?.needs_improvement || 60
      },
      rules: ruleSet.rules?.filter(rule => rule.id && rule.name && rule.checkFunction) || [],
      checkpoints: ruleSet.checkpoints || [],
      customChecks: ruleSet.customChecks || {}
    };

    // Ensure rule IDs are unique
    const seenIds = new Set<string>();
    validated.rules = validated.rules.filter(rule => {
      if (seenIds.has(rule.id)) {
        return false;
      }
      seenIds.add(rule.id);
      return true;
    });

    return validated;
  }
}

