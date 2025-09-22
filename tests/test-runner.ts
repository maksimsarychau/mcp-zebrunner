#!/usr/bin/env tsx

/**
 * Comprehensive test runner for Zebrunner MCP Server
 * 
 * Usage:
 *   npm run test           # Run all tests
 *   npm run test:unit      # Run only unit tests
 *   npm run test:integration # Run only integration tests
 *   npm run test:e2e       # Run only end-to-end tests
 *   npm run test:watch     # Run tests in watch mode
 */

import "dotenv/config";
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

interface TestConfig {
  name: string;
  pattern: string;
  description: string;
  requiresBuild?: boolean;
  requiresEnv?: boolean;
}

const testConfigs: Record<string, TestConfig> = {
  unit: {
    name: 'Unit Tests',
    pattern: 'tests/unit/**/*.test.ts',
    description: 'Fast isolated tests for individual components',
    requiresBuild: false,
    requiresEnv: false
  },
  integration: {
    name: 'Integration Tests',
    pattern: 'tests/integration/**/*.test.ts',
    description: 'Tests with real API calls to Zebrunner (includes suite hierarchy tests)',
    requiresBuild: false,
    requiresEnv: true
  },
  e2e: {
    name: 'End-to-End Tests',
    pattern: 'tests/e2e/**/*.test.ts',
    description: 'Full server tests with MCP protocol',
    requiresBuild: true,
    requiresEnv: true
  },
  all: {
    name: 'All Tests',
    pattern: 'tests/**/*.test.ts',
    description: 'Complete test suite',
    requiresBuild: true,
    requiresEnv: true
  }
};

class TestRunner {
  private verbose: boolean = false;
  private watch: boolean = false;
  private coverage: boolean = false;

  constructor() {
    this.parseArgs();
  }

  private parseArgs(): void {
    const args = process.argv.slice(2);
    this.verbose = args.includes('--verbose') || args.includes('-v');
    this.watch = args.includes('--watch') || args.includes('-w');
    this.coverage = args.includes('--coverage') || args.includes('-c');
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const prefix = {
      info: '🔍',
      warn: '⚠️ ',
      error: '❌'
    }[level];
    
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  private async checkPrerequisites(config: TestConfig): Promise<boolean> {
    let allGood = true;

    // Check if build is required and exists
    if (config.requiresBuild) {
      const distExists = existsSync(join(process.cwd(), 'dist'));
      if (!distExists) {
        this.log('Build required but dist/ directory not found. Run: npm run build', 'error');
        allGood = false;
      } else {
        this.log('✅ Build artifacts found');
      }
    }

    // Check if environment variables are required
    if (config.requiresEnv) {
      const requiredVars = ['ZEBRUNNER_URL', 'ZEBRUNNER_LOGIN', 'ZEBRUNNER_TOKEN'];
      const missingVars = requiredVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        this.log(`Missing required environment variables: ${missingVars.join(', ')}`, 'error');
        this.log('Create .env file with your Zebrunner credentials', 'error');
        allGood = false;
      } else {
        this.log('✅ Environment variables found');
      }
    }

    return allGood;
  }

  private async runNodeTest(pattern: string): Promise<boolean> {
    return new Promise((resolve) => {
      const args = [
        '--test',
        '--test-reporter=spec',
        '--import=tsx',
        pattern
      ];

      if (this.watch) {
        args.push('--watch');
      }

      if (this.verbose) {
        args.push('--test-reporter-destination=stdout');
      }

      this.log(`Running: node ${args.join(' ')}`);

      const testProcess = spawn('node', args, {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_OPTIONS: '--import=tsx --no-warnings'
        }
      });

      testProcess.on('close', (code) => {
        resolve(code === 0);
      });

      testProcess.on('error', (error) => {
        this.log(`Test process error: ${error.message}`, 'error');
        resolve(false);
      });
    });
  }

  async runTests(testType: string = 'all'): Promise<boolean> {
    const config = testConfigs[testType];
    if (!config) {
      this.log(`Unknown test type: ${testType}. Available: ${Object.keys(testConfigs).join(', ')}`, 'error');
      return false;
    }

    this.log(`🚀 Starting ${config.name}`);
    this.log(`📝 ${config.description}`);

    // Check prerequisites
    const prereqsOk = await this.checkPrerequisites(config);
    if (!prereqsOk) {
      this.log('Prerequisites not met. Aborting tests.', 'error');
      return false;
    }

    // Run tests
    const startTime = Date.now();
    const success = await this.runNodeTest(config.pattern);
    const duration = Date.now() - startTime;

    if (success) {
      this.log(`✅ ${config.name} completed successfully in ${duration}ms`);
    } else {
      this.log(`❌ ${config.name} failed after ${duration}ms`, 'error');
    }

    return success;
  }

  async runHealthCheck(): Promise<boolean> {
    this.log('🏥 Running health check...');

    // Check Node.js version
    const nodeVersion = process.version;
    this.log(`Node.js version: ${nodeVersion}`);

    // Check if tsx is available
    try {
      const { execSync } = await import('child_process');
      const tsxVersion = execSync('npx tsx --version', { encoding: 'utf8' }).trim();
      this.log(`tsx version: ${tsxVersion}`);
    } catch (error) {
      this.log('tsx not available. Install with: npm install', 'error');
      return false;
    }

    // Check if .env file exists
    const envExists = existsSync(join(process.cwd(), '.env'));
    if (envExists) {
      this.log('✅ .env file found');
    } else {
      this.log('⚠️  .env file not found. Copy .env.example to .env', 'warn');
    }

    // Test Zebrunner connection
    if (process.env.ZEBRUNNER_URL && process.env.ZEBRUNNER_LOGIN && process.env.ZEBRUNNER_TOKEN) {
      this.log('🔗 Testing Zebrunner connection...');
      try {
        const { EnhancedZebrunnerClient } = await import('../src/api/enhanced-client.js');
        const client = new EnhancedZebrunnerClient({
          baseUrl: process.env.ZEBRUNNER_URL,
          username: process.env.ZEBRUNNER_LOGIN,
          token: process.env.ZEBRUNNER_TOKEN,
          timeout: 10000
        });

        const result = await client.testConnection();
        if (result.success) {
          this.log('✅ Zebrunner connection successful');
        } else {
          this.log(`⚠️  Zebrunner connection failed: ${result.message}`, 'warn');
        }
      } catch (error: any) {
        this.log(`⚠️  Zebrunner connection test failed: ${error.message}`, 'warn');
      }
    }

    this.log('🏥 Health check completed');
    return true;
  }

  printUsage(): void {
    console.log(`
🧪 Zebrunner MCP Server Test Runner

Usage:
  npm run test [type] [options]

Test Types:
${Object.entries(testConfigs).map(([key, config]) => 
  `  ${key.padEnd(12)} - ${config.description}`
).join('\n')}

Options:
  --verbose, -v    Verbose output
  --watch, -w      Watch mode (for development)
  --coverage, -c   Generate coverage report
  --health         Run health check only

Examples:
  npm run test                    # Run all tests
  npm run test unit               # Run unit tests only
  npm run test integration -- -v  # Run integration tests with verbose output
  npm run test -- --health        # Run health check

Prerequisites:
  - Unit tests: None
  - Integration tests: .env file with Zebrunner credentials
  - E2E tests: Built server (npm run build) + credentials
`);
  }
}

// Main execution
async function main() {
  const runner = new TestRunner();
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    runner.printUsage();
    process.exit(0);
  }

  if (args.includes('--health')) {
    const success = await runner.runHealthCheck();
    process.exit(success ? 0 : 1);
  }

  const testType = args.find(arg => !arg.startsWith('-')) || 'all';
  const success = await runner.runTests(testType);
  
  process.exit(success ? 0 : 1);
}

// ES module entry point check
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

export { TestRunner };
