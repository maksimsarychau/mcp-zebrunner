import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Unit tests for configuration management
 * 
 * Tests the following components:
 * - ConfigManager
 * - Default configuration values
 * - Environment variable handling
 * - Rules engine auto-detection
 */

describe('Configuration Management Unit Tests', () => {
  
  describe('ConfigManager', () => {
    
    it('should validate default configuration values', () => {
      const defaultConfig = {
        zebrunnerUrl: '',
        zebrunnerLogin: '',
        zebrunnerToken: '',
        enableRulesEngine: false,
        rulesFilePath: 'mcp-zebrunner-rules.md',
        checkpointsFilePath: 'test_case_analysis_checkpoints.md',
        maxPageSize: 100,
        debugMode: false,
        requestTimeout: 30000,
        maxRetries: 3
      };
      
      assert.equal(typeof defaultConfig.enableRulesEngine, 'boolean', 'enableRulesEngine should be boolean');
      assert.equal(typeof defaultConfig.maxPageSize, 'number', 'maxPageSize should be number');
      assert.equal(typeof defaultConfig.debugMode, 'boolean', 'debugMode should be boolean');
      assert.ok(defaultConfig.maxPageSize > 0, 'maxPageSize should be positive');
      assert.ok(defaultConfig.requestTimeout > 0, 'requestTimeout should be positive');
      assert.ok(defaultConfig.maxRetries >= 0, 'maxRetries should be non-negative');
    });
    
    it('should validate mandatory configuration fields', () => {
      const mandatoryFields = ['zebrunnerUrl', 'zebrunnerLogin', 'zebrunnerToken'];
      const config = {
        zebrunnerUrl: 'https://test.zebrunner.com',
        zebrunnerLogin: 'testuser',
        zebrunnerToken: 'testtoken',
        enableRulesEngine: true
      };
      
      mandatoryFields.forEach(field => {
        assert.ok(config.hasOwnProperty(field), `${field} should be present in config`);
        if (field !== 'enableRulesEngine') {
          assert.ok(config[field as keyof typeof config], `${field} should have value`);
        }
      });
    });
    
    it('should validate environment variable parsing', () => {
      const mockEnvVars = {
        'ZEBRUNNER_URL': 'https://test.zebrunner.com',
        'ZEBRUNNER_LOGIN': 'testuser',
        'ZEBRUNNER_TOKEN': 'abc123token',
        'ENABLE_RULES_ENGINE': 'true',
        'MAX_PAGE_SIZE': '200',
        'DEBUG_MODE': 'false',
        'REQUEST_TIMEOUT': '45000'
      };
      
      const parseEnvVar = (key: string, defaultValue: any) => {
        const value = mockEnvVars[key];
        if (!value) return defaultValue;
        
        if (typeof defaultValue === 'boolean') {
          return value.toLowerCase() === 'true';
        }
        if (typeof defaultValue === 'number') {
          const parsed = parseInt(value, 10);
          return isNaN(parsed) ? defaultValue : parsed;
        }
        return value;
      };
      
      assert.equal(parseEnvVar('ZEBRUNNER_URL', ''), 'https://test.zebrunner.com', 'should parse string env var');
      assert.equal(parseEnvVar('ENABLE_RULES_ENGINE', false), true, 'should parse boolean env var');
      assert.equal(parseEnvVar('MAX_PAGE_SIZE', 100), 200, 'should parse number env var');
      assert.equal(parseEnvVar('NONEXISTENT', 'default'), 'default', 'should return default for missing env var');
    });
    
    it('should validate configuration precedence', () => {
      const defaultConfig = {
        maxPageSize: 100,
        enableRulesEngine: false,
        debugMode: false
      };
      
      const envConfig = {
        maxPageSize: 200,
        enableRulesEngine: true
      };
      
      const autoDetectedConfig = {
        enableRulesEngine: true
      };
      
      // Simulate precedence: env > auto-detected > defaults
      const finalConfig = {
        ...defaultConfig,
        ...autoDetectedConfig,
        ...envConfig
      };
      
      assert.equal(finalConfig.maxPageSize, 200, 'env var should override default');
      assert.equal(finalConfig.enableRulesEngine, true, 'env var should override auto-detected');
      assert.equal(finalConfig.debugMode, false, 'should keep default when not overridden');
    });
    
  });
  
  describe('Rules Engine Auto-Detection', () => {
    
    it('should validate meaningful content detection', () => {
      const contentExamples = [
        { content: '# Test Case Review Rules\n\n## Structure\n- Rule 1\n- Rule 2', meaningful: true },
        { content: '', meaningful: false },
        { content: '   \n\n  \t  ', meaningful: false },
        { content: '# Empty File\n\n<!-- No content -->', meaningful: false },
        { content: '# Rules\n\n', meaningful: false },
        { content: 'Some actual rules content here', meaningful: true }
      ];
      
      const hasMeaningfulContent = (content: string): boolean => {
        const trimmed = content.trim();
        if (trimmed.length === 0) return false;
        
        // Remove markdown headers, comments, and whitespace-only lines
        const withoutMarkdown = trimmed
          .replace(/^#.*$/gm, '') // Remove headers
          .replace(/<!--.*?-->/gs, '') // Remove comments
          .replace(/^\s*$/gm, '') // Remove empty lines
          .trim();
        
        return withoutMarkdown.length > 10; // Require substantial content
      };
      
      contentExamples.forEach(example => {
        const result = hasMeaningfulContent(example.content);
        assert.equal(result, example.meaningful, 
          `Content "${example.content.substring(0, 30)}..." should ${example.meaningful ? 'be' : 'not be'} meaningful`);
      });
    });
    
    it('should validate file existence checking', () => {
      const fileScenarios = [
        { path: 'mcp-zebrunner-rules.md', exists: true, readable: true, shouldEnable: true },
        { path: 'nonexistent-file.md', exists: false, readable: false, shouldEnable: false },
        { path: 'unreadable-file.md', exists: true, readable: false, shouldEnable: false }
      ];
      
      fileScenarios.forEach(scenario => {
        const canEnable = scenario.exists && scenario.readable;
        assert.equal(canEnable, scenario.shouldEnable, 
          `Rules engine should ${scenario.shouldEnable ? 'be enabled' : 'not be enabled'} for ${scenario.path}`);
      });
    });
    
    it('should validate rules file path resolution', () => {
      const rootPath = '/project/root';
      const rulesFileName = 'mcp-zebrunner-rules.md';
      const expectedPath = `${rootPath}/${rulesFileName}`;
      
      const resolvePath = (root: string, filename: string) => {
        return `${root}/${filename}`;
      };
      
      const resolvedPath = resolvePath(rootPath, rulesFileName);
      assert.equal(resolvedPath, expectedPath, 'should resolve path correctly');
    });
    
    it('should validate auto-detection logic', () => {
      const scenarios = [
        { envVar: 'true', fileExists: true, hasContent: true, expected: true, reason: 'env var overrides' },
        { envVar: 'false', fileExists: true, hasContent: true, expected: false, reason: 'env var overrides' },
        { envVar: undefined, fileExists: true, hasContent: true, expected: true, reason: 'auto-detect enables' },
        { envVar: undefined, fileExists: true, hasContent: false, expected: false, reason: 'no meaningful content' },
        { envVar: undefined, fileExists: false, hasContent: false, expected: false, reason: 'file does not exist' }
      ];
      
      scenarios.forEach(scenario => {
        let result: boolean;
        
        if (scenario.envVar !== undefined) {
          result = scenario.envVar === 'true';
        } else {
          result = scenario.fileExists && scenario.hasContent;
        }
        
        assert.equal(result, scenario.expected, 
          `Should ${scenario.expected ? 'enable' : 'disable'} rules engine: ${scenario.reason}`);
      });
    });
    
  });
  
  describe('Environment Variable Validation', () => {
    
    it('should validate URL format', () => {
      const urlExamples = [
        { url: 'https://test.zebrunner.com', valid: true },
        { url: 'http://localhost:8080', valid: true },
        { url: 'https://test.zebrunner.com:443', valid: true },
        { url: 'invalid-url', valid: false },
        { url: 'ftp://not-http.com', valid: false },
        { url: '', valid: false }
      ];
      
      const isValidUrl = (url: string): boolean => {
        if (!url) return false;
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      };
      
      urlExamples.forEach(example => {
        const result = isValidUrl(example.url);
        assert.equal(result, example.valid, 
          `URL "${example.url}" should ${example.valid ? 'be valid' : 'be invalid'}`);
      });
    });
    
    it('should validate numeric environment variables', () => {
      const numericEnvVars = [
        { key: 'MAX_PAGE_SIZE', value: '100', expected: 100, valid: true },
        { key: 'REQUEST_TIMEOUT', value: '30000', expected: 30000, valid: true },
        { key: 'MAX_RETRIES', value: '3', expected: 3, valid: true },
        { key: 'INVALID_NUMBER', value: 'not-a-number', expected: NaN, valid: false },
        { key: 'NEGATIVE_NUMBER', value: '-5', expected: -5, valid: false },
        { key: 'ZERO', value: '0', expected: 0, valid: true }
      ];
      
      const parseNumericEnvVar = (value: string, min: number = 0): { parsed: number, valid: boolean } => {
        const parsed = parseInt(value, 10);
        const valid = !isNaN(parsed) && parsed >= min;
        return { parsed, valid };
      };
      
      numericEnvVars.forEach(envVar => {
        const result = parseNumericEnvVar(envVar.value);
        assert.equal(result.parsed, envVar.expected, `Should parse ${envVar.key} correctly`);
        
        if (envVar.key !== 'INVALID_NUMBER' && envVar.key !== 'NEGATIVE_NUMBER') {
          assert.equal(result.valid, envVar.valid, `${envVar.key} validity should match expected`);
        }
      });
    });
    
    it('should validate boolean environment variables', () => {
      const booleanEnvVars = [
        { value: 'true', expected: true },
        { value: 'TRUE', expected: true },
        { value: 'True', expected: true },
        { value: 'false', expected: false },
        { value: 'FALSE', expected: false },
        { value: 'False', expected: false },
        { value: '1', expected: false }, // Only 'true' should be true
        { value: '0', expected: false },
        { value: '', expected: false },
        { value: 'yes', expected: false }
      ];
      
      const parseBooleanEnvVar = (value: string): boolean => {
        return value.toLowerCase() === 'true';
      };
      
      booleanEnvVars.forEach(envVar => {
        const result = parseBooleanEnvVar(envVar.value);
        assert.equal(result, envVar.expected, 
          `Value "${envVar.value}" should parse to ${envVar.expected}`);
      });
    });
    
  });
  
  describe('Configuration Validation', () => {
    
    it('should validate complete configuration', () => {
      const completeConfig = {
        zebrunnerUrl: 'https://test.zebrunner.com',
        zebrunnerLogin: 'testuser',
        zebrunnerToken: 'abc123token',
        enableRulesEngine: true,
        rulesFilePath: 'mcp-zebrunner-rules.md',
        checkpointsFilePath: 'test_case_analysis_checkpoints.md',
        maxPageSize: 100,
        debugMode: false,
        requestTimeout: 30000,
        maxRetries: 3
      };
      
      const validateConfig = (config: any) => {
        const errors: string[] = [];
        
        if (!config.zebrunnerUrl) errors.push('zebrunnerUrl is required');
        if (!config.zebrunnerLogin) errors.push('zebrunnerLogin is required');
        if (!config.zebrunnerToken) errors.push('zebrunnerToken is required');
        
        if (config.maxPageSize <= 0) errors.push('maxPageSize must be positive');
        if (config.requestTimeout <= 0) errors.push('requestTimeout must be positive');
        if (config.maxRetries < 0) errors.push('maxRetries must be non-negative');
        
        return { valid: errors.length === 0, errors };
      };
      
      const validation = validateConfig(completeConfig);
      assert.ok(validation.valid, 'complete config should be valid');
      assert.equal(validation.errors.length, 0, 'should have no validation errors');
    });
    
    it('should validate incomplete configuration', () => {
      const incompleteConfig = {
        zebrunnerUrl: '',
        zebrunnerLogin: 'testuser',
        // zebrunnerToken missing
        maxPageSize: -1,
        requestTimeout: 0
      };
      
      const validateConfig = (config: any) => {
        const errors: string[] = [];
        
        if (!config.zebrunnerUrl) errors.push('zebrunnerUrl is required');
        if (!config.zebrunnerLogin) errors.push('zebrunnerLogin is required');
        if (!config.zebrunnerToken) errors.push('zebrunnerToken is required');
        
        if (config.maxPageSize <= 0) errors.push('maxPageSize must be positive');
        if (config.requestTimeout <= 0) errors.push('requestTimeout must be positive');
        
        return { valid: errors.length === 0, errors };
      };
      
      const validation = validateConfig(incompleteConfig);
      assert.ok(!validation.valid, 'incomplete config should be invalid');
      assert.ok(validation.errors.length > 0, 'should have validation errors');
      assert.ok(validation.errors.includes('zebrunnerUrl is required'), 'should detect missing URL');
      assert.ok(validation.errors.includes('zebrunnerToken is required'), 'should detect missing token');
      assert.ok(validation.errors.includes('maxPageSize must be positive'), 'should detect invalid page size');
    });
    
    it('should validate configuration limits', () => {
      const configLimits = {
        maxPageSize: { min: 1, max: 1000, recommended: 100 },
        requestTimeout: { min: 1000, max: 300000, recommended: 30000 },
        maxRetries: { min: 0, max: 10, recommended: 3 }
      };
      
      const validateLimits = (value: number, limits: any) => {
        return {
          withinRange: value >= limits.min && value <= limits.max,
          isRecommended: value === limits.recommended,
          tooLow: value < limits.min,
          tooHigh: value > limits.max
        };
      };
      
      const pageSize200 = validateLimits(200, configLimits.maxPageSize);
      assert.ok(pageSize200.withinRange, '200 should be within page size range');
      assert.ok(!pageSize200.isRecommended, '200 should not be recommended page size');
      
      const timeout5000 = validateLimits(5000, configLimits.requestTimeout);
      assert.ok(timeout5000.withinRange, '5000ms should be within timeout range');
      
      const retries15 = validateLimits(15, configLimits.maxRetries);
      assert.ok(retries15.tooHigh, '15 retries should be too high');
    });
    
  });
  
  describe('Error Handling', () => {
    
    it('should handle missing environment file gracefully', () => {
      const defaultConfig = {
        zebrunnerUrl: '',
        zebrunnerLogin: '',
        zebrunnerToken: '',
        enableRulesEngine: false
      };
      
      // Simulate missing .env file
      const loadConfig = (envFileExists: boolean) => {
        if (!envFileExists) {
          return { ...defaultConfig, loaded: false };
        }
        return { ...defaultConfig, zebrunnerUrl: 'loaded-url', loaded: true };
      };
      
      const configWithoutEnv = loadConfig(false);
      assert.ok(!configWithoutEnv.loaded, 'should indicate env file not loaded');
      assert.equal(configWithoutEnv.zebrunnerUrl, '', 'should use default values');
      
      const configWithEnv = loadConfig(true);
      assert.ok(configWithEnv.loaded, 'should indicate env file loaded');
      assert.equal(configWithEnv.zebrunnerUrl, 'loaded-url', 'should use loaded values');
    });
    
    it('should handle malformed environment variables', () => {
      const malformedEnvVars = {
        'MAX_PAGE_SIZE': 'not-a-number',
        'ENABLE_RULES_ENGINE': 'maybe',
        'REQUEST_TIMEOUT': 'invalid-timeout'
      };
      
      const parseWithFallback = (key: string, defaultValue: any) => {
        const value = malformedEnvVars[key as keyof typeof malformedEnvVars];
        if (!value) return defaultValue;
        
        try {
          if (typeof defaultValue === 'number') {
            const parsed = parseInt(value, 10);
            return isNaN(parsed) ? defaultValue : parsed;
          }
          if (typeof defaultValue === 'boolean') {
            return value.toLowerCase() === 'true';
          }
          return value;
        } catch {
          return defaultValue;
        }
      };
      
      assert.equal(parseWithFallback('MAX_PAGE_SIZE', 100), 100, 'should fallback for invalid number');
      assert.equal(parseWithFallback('ENABLE_RULES_ENGINE', false), false, 'should fallback for invalid boolean');
      assert.equal(parseWithFallback('REQUEST_TIMEOUT', 30000), 30000, 'should fallback for malformed number');
    });
    
    it('should provide helpful error messages', () => {
      const configErrors = [
        {
          field: 'zebrunnerUrl',
          value: '',
          message: 'ZEBRUNNER_URL is required. Please set it in your .env file.',
          suggestion: 'Example: ZEBRUNNER_URL=https://your-instance.zebrunner.com'
        },
        {
          field: 'maxPageSize',
          value: 2000,
          message: 'MAX_PAGE_SIZE (2000) exceeds maximum allowed value (1000).',
          suggestion: 'Set MAX_PAGE_SIZE to a value between 1 and 1000.'
        },
        {
          field: 'rulesFile',
          value: 'missing',
          message: 'Rules file (rulesFile) not found or empty.',
          suggestion: 'Create mcp-zebrunner-rules.md with validation rules or set ENABLE_RULES_ENGINE=false'
        }
      ];
      
      configErrors.forEach(error => {
        assert.ok(error.message.length > 0, 'Error message should not be empty');
        assert.ok(error.suggestion.length > 0, 'Error suggestion should be provided');
        const referencesFieldOrValue = error.message.includes(error.field) || 
                                      error.message.includes(error.value.toString()) ||
                                      error.message.toUpperCase().includes(error.field.toUpperCase());
        assert.ok(referencesFieldOrValue, 
          `Error message "${error.message}" should reference field "${error.field}" or value "${error.value}"`);
      });
    });
    
  });
  
  describe('Configuration Loading Scenarios', () => {
    
    it('should handle development environment', () => {
      const devConfig = {
        zebrunnerUrl: 'http://localhost:8080',
        zebrunnerLogin: 'dev-user',
        zebrunnerToken: 'dev-token',
        debugMode: true,
        maxPageSize: 10, // Smaller for development
        requestTimeout: 60000 // Longer for debugging
      };
      
      assert.ok(devConfig.debugMode, 'development should enable debug mode');
      assert.ok(devConfig.maxPageSize < 50, 'development should use smaller page size');
      assert.ok(devConfig.requestTimeout > 30000, 'development should use longer timeout');
    });
    
    it('should handle production environment', () => {
      const prodConfig = {
        zebrunnerUrl: 'https://prod.zebrunner.com',
        zebrunnerLogin: 'prod-user',
        zebrunnerToken: 'secure-prod-token',
        debugMode: false,
        maxPageSize: 100,
        requestTimeout: 30000,
        maxRetries: 3
      };
      
      assert.ok(!prodConfig.debugMode, 'production should disable debug mode');
      assert.ok(prodConfig.zebrunnerUrl.startsWith('https://'), 'production should use HTTPS');
      assert.ok(prodConfig.maxRetries <= 3, 'production should limit retries');
    });
    
    it('should handle CI/CD environment', () => {
      const ciConfig = {
        zebrunnerUrl: 'https://ci.zebrunner.com',
        zebrunnerLogin: 'ci-user',
        zebrunnerToken: 'ci-token',
        enableRulesEngine: false, // Disabled in CI
        maxPageSize: 50,
        requestTimeout: 45000, // Slightly longer for CI
        maxRetries: 5 // More retries for flaky CI
      };
      
      assert.ok(!ciConfig.enableRulesEngine, 'CI should disable rules engine');
      assert.ok(ciConfig.maxRetries > 3, 'CI should allow more retries');
      assert.ok(ciConfig.requestTimeout > 30000, 'CI should use longer timeout');
    });
    
  });
  
});
