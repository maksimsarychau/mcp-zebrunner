import fs from 'fs';
import path from 'path';
import { DEFAULT_CONFIG, REQUIRED_ENV_VARS, ZebrunnerDefaults } from './defaults.js';

/**
 * Configuration Manager for Zebrunner MCP Server
 * 
 * Handles:
 * - Environment variable loading with defaults
 * - Auto-detection of rules engine based on rules file
 * - Validation of required configuration
 * - Graceful handling of missing/malformed files
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private config: any = {};
  private warnings: string[] = [];

  private constructor() {
    this.loadConfiguration();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Get the complete configuration object
   */
  public getConfig(): any {
    return { ...this.config };
  }

  /**
   * Get configuration warnings (e.g., malformed rules file)
   */
  public getWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * Get a specific configuration value
   */
  public get<K extends keyof ZebrunnerDefaults>(key: K): ZebrunnerDefaults[K] {
    return this.config[key] ?? DEFAULT_CONFIG[key];
  }

  /**
   * Check if rules engine should be enabled
   */
  public isRulesEngineEnabled(): boolean {
    // If explicitly set in environment, respect that setting
    const envValue = process.env.ENABLE_RULES_ENGINE;
    if (envValue !== undefined) {
      return envValue.toLowerCase() === 'true';
    }

    // Otherwise, auto-detect based on rules file
    return this.detectRulesFile();
  }

  /**
   * Load and process all configuration
   */
  private loadConfiguration(): void {
    // Start with defaults
    this.config = { ...DEFAULT_CONFIG };

    // Load environment variables
    this.loadEnvironmentVariables();

    // Validate required variables
    this.validateRequiredVariables();

    // Handle rules engine auto-detection
    this.handleRulesEngineDetection();
  }

  /**
   * Load environment variables with type conversion
   */
  private loadEnvironmentVariables(): void {
    // Load string values
    if (process.env.ZEBRUNNER_URL) this.config.baseUrl = process.env.ZEBRUNNER_URL;
    if (process.env.ZEBRUNNER_LOGIN) this.config.login = process.env.ZEBRUNNER_LOGIN;
    if (process.env.ZEBRUNNER_TOKEN) this.config.authToken = process.env.ZEBRUNNER_TOKEN;

    // Load numeric values with validation
    if (process.env.TIMEOUT) {
      const timeout = parseInt(process.env.TIMEOUT, 10);
      if (!isNaN(timeout) && timeout > 0) {
        this.config.timeout = timeout;
      }
    }

    if (process.env.RETRY_ATTEMPTS) {
      const retryAttempts = parseInt(process.env.RETRY_ATTEMPTS, 10);
      if (!isNaN(retryAttempts) && retryAttempts >= 0) {
        this.config.retryAttempts = retryAttempts;
      }
    }

    if (process.env.RETRY_DELAY) {
      const retryDelay = parseInt(process.env.RETRY_DELAY, 10);
      if (!isNaN(retryDelay) && retryDelay >= 0) {
        this.config.retryDelay = retryDelay;
      }
    }

    if (process.env.MAX_PAGE_SIZE) {
      const maxPageSize = parseInt(process.env.MAX_PAGE_SIZE, 10);
      if (!isNaN(maxPageSize) && maxPageSize > 0 && maxPageSize <= 1000) {
        this.config.maxPageSize = maxPageSize;
      }
    }

    if (process.env.DEFAULT_PAGE_SIZE) {
      const defaultPageSize = parseInt(process.env.DEFAULT_PAGE_SIZE, 10);
      if (!isNaN(defaultPageSize) && defaultPageSize > 0) {
        this.config.defaultPageSize = defaultPageSize;
      }
    }

    // Load boolean values
    if (process.env.DEBUG !== undefined) {
      this.config.debug = process.env.DEBUG.toLowerCase() === 'true';
    }

    if (process.env.STRICT_URL_VALIDATION !== undefined) {
      this.config.strictUrlValidation = process.env.STRICT_URL_VALIDATION.toLowerCase() === 'true';
    }

    if (process.env.SKIP_URL_VALIDATION_ON_ERROR !== undefined) {
      this.config.skipUrlValidationOnError = process.env.SKIP_URL_VALIDATION_ON_ERROR.toLowerCase() === 'true';
    }

    if (process.env.ENABLE_RATE_LIMITING !== undefined) {
      this.config.enableRateLimiting = process.env.ENABLE_RATE_LIMITING.toLowerCase() === 'true';
    }

    // Load numeric rate limiting values
    if (process.env.MAX_REQUESTS_PER_SECOND) {
      const maxRps = parseInt(process.env.MAX_REQUESTS_PER_SECOND, 10);
      if (!isNaN(maxRps) && maxRps > 0 && maxRps <= 100) {
        this.config.maxRequestsPerSecond = maxRps;
      }
    }

    if (process.env.RATE_LIMITING_BURST) {
      const burst = parseInt(process.env.RATE_LIMITING_BURST, 10);
      if (!isNaN(burst) && burst > 0 && burst <= 200) {
        this.config.rateLimitingBurst = burst;
      }
    }

    // ENABLE_RULES_ENGINE is handled separately in handleRulesEngineDetection
  }

  /**
   * Validate that required environment variables are set
   */
  private validateRequiredVariables(): void {
    const missing = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      throw new Error(
        `❌ Missing required environment variables: ${missing.join(', ')}\\n` +
        `Please set these variables in your .env file or environment.`
      );
    }
  }

  /**
   * Handle rules engine detection logic
   */
  private handleRulesEngineDetection(): void {
    // If explicitly set in environment, use that value
    if (process.env.ENABLE_RULES_ENGINE !== undefined) {
      this.config.enableRulesEngine = process.env.ENABLE_RULES_ENGINE.toLowerCase() === 'true';
      return;
    }

    // Otherwise, auto-detect based on rules file
    this.config.enableRulesEngine = this.detectRulesFile();
  }

  /**
   * Detect if rules file exists and has meaningful content
   */
  private detectRulesFile(): boolean {
    try {
      const rulesFilePath = path.resolve(process.cwd(), DEFAULT_CONFIG.rulesFileName);
      
      // Check if file exists
      if (!fs.existsSync(rulesFilePath)) {
        return false;
      }

      // Read file content
      const content = fs.readFileSync(rulesFilePath, 'utf-8');
      
      // Check if content is meaningful (not just whitespace/comments)
      const meaningfulContent = this.extractMeaningfulContent(content);
      
      if (meaningfulContent.length < DEFAULT_CONFIG.rulesFileMinContentLength) {
        this.warnings.push(
          `⚠️  Rules file '${DEFAULT_CONFIG.rulesFileName}' exists but appears to have insufficient content. ` +
          `Rules engine disabled. Minimum meaningful content: ${DEFAULT_CONFIG.rulesFileMinContentLength} characters.`
        );
        return false;
      }

      // File exists and has meaningful content
      console.log(`✅ Auto-detected rules file '${DEFAULT_CONFIG.rulesFileName}' - Rules engine enabled`);
      return true;

    } catch (error: any) {
      this.warnings.push(
        `⚠️  Error reading rules file '${DEFAULT_CONFIG.rulesFileName}': ${error.message}. ` +
        `Rules engine disabled.`
      );
      return false;
    }
  }

  /**
   * Extract meaningful content from rules file (excluding comments, whitespace)
   */
  private extractMeaningfulContent(content: string): string {
    return content
      // Remove HTML/Markdown comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // Remove empty lines and excessive whitespace
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        // Keep lines that have content, including markdown headers and list items
        return trimmed.length > 0 && 
               // Don't exclude markdown headers (they are meaningful)
               !trimmed.startsWith('//') && 
               !trimmed.startsWith('<!--') &&
               // Keep meaningful markdown content
               (trimmed.includes(':') || trimmed.includes('-') || trimmed.length > 10);
      })
      .join('\n')
      .trim();
  }

  /**
   * Print configuration summary (for debugging)
   */
  public printConfigSummary(): void {
    if (this.config.debug) {
      console.log('🔧 Zebrunner MCP Configuration:');
      console.log(`   - Base URL: ${this.config.baseUrl ? 'Set' : 'Not set'}`);
      console.log(`   - Login: ${this.config.login ? 'Set' : 'Not set'}`);
      console.log(`   - Token: ${this.config.authToken ? 'Set' : 'Not set'}`);
      console.log(`   - Debug Mode: ${this.config.debug}`);
      console.log(`   - Rules Engine: ${this.config.enableRulesEngine} ${process.env.ENABLE_RULES_ENGINE ? '(explicit)' : '(auto-detected)'}`);
      console.log(`   - Max Page Size: ${this.config.maxPageSize}`);
      console.log(`   - Default Page Size: ${this.config.defaultPageSize}`);
      
      if (this.warnings.length > 0) {
        console.log('⚠️  Configuration Warnings:');
        this.warnings.forEach(warning => console.log(`   ${warning}`));
      }
    }
  }
}
