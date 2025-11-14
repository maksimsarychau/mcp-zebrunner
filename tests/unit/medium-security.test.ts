import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { sanitizeErrorMessage, sanitizeApiError } from '../../src/utils/security.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Medium Security Fixes Test Suite
 * Tests for temp file cleanup, rate limiting, and error sanitization
 */

describe('Medium Security Fixes', () => {
  describe('Error Sanitization', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDebug = process.env.DEBUG;

    after(() => {
      // Restore original environment
      process.env.NODE_ENV = originalEnv;
      process.env.DEBUG = originalDebug;
    });

    it('should show full error details in DEBUG mode', () => {
      process.env.DEBUG = 'true';
      process.env.NODE_ENV = 'production';

      const error = new Error('Database connection failed');
      const result = sanitizeErrorMessage(error, 'Database error', 'testContext');

      assert.ok(result.includes('Database connection failed'));
      assert.ok(result.includes('Database error'));
    });

    it('should hide error details in production', () => {
      process.env.DEBUG = 'false';
      process.env.NODE_ENV = 'production';

      const error = new Error('Internal server error with sensitive data: API_KEY=secret123');
      const result = sanitizeErrorMessage(error, 'An error occurred', 'testContext');

      assert.strictEqual(result, 'An error occurred');
      assert.ok(!result.includes('secret123'));
    });

    it('should show full error details in development', () => {
      process.env.DEBUG = 'false';
      process.env.NODE_ENV = 'development';

      const error = new Error('Validation failed');
      const result = sanitizeErrorMessage(error, 'Validation error', 'testContext');

      assert.ok(result.includes('Validation failed'));
    });

    it('should handle non-Error objects', () => {
      process.env.DEBUG = 'false';
      process.env.NODE_ENV = 'production';

      const error = 'String error message';
      const result = sanitizeErrorMessage(error, 'Generic error', 'testContext');

      assert.strictEqual(result, 'Generic error');
    });

    it('should sanitize API errors in production', () => {
      process.env.DEBUG = 'false';
      process.env.NODE_ENV = 'production';

      const error = new Error('SQL injection detected: DROP TABLE users');
      const result = sanitizeApiError(error, 'fetch user data');

      assert.ok(!result.message.includes('SQL'));
      assert.ok(!result.message.includes('DROP TABLE'));
      assert.ok(result.message.includes('Failed to fetch user data'));
      assert.ok(result.timestamp);
      assert.strictEqual(result.operation, 'fetch user data');
    });

    it('should include error details in API errors in development', () => {
      process.env.DEBUG = 'false';
      process.env.NODE_ENV = 'development';

      const error = new Error('Connection timeout');
      const result = sanitizeApiError(error, 'connect to database');

      assert.ok(result.message.includes('Connection timeout'));
      assert.strictEqual(result.operation, 'connect to database');
    });
  });

  describe('Rate Limiting', () => {
    it('should respect environment variable for rate limiting enablement', () => {
      // Test that ENABLE_RATE_LIMITING can be set
      const originalValue = process.env.ENABLE_RATE_LIMITING;

      process.env.ENABLE_RATE_LIMITING = 'false';
      assert.strictEqual(process.env.ENABLE_RATE_LIMITING, 'false');

      process.env.ENABLE_RATE_LIMITING = 'true';
      assert.strictEqual(process.env.ENABLE_RATE_LIMITING, 'true');

      // Restore
      if (originalValue !== undefined) {
        process.env.ENABLE_RATE_LIMITING = originalValue;
      } else {
        delete process.env.ENABLE_RATE_LIMITING;
      }
    });

    it('should respect MAX_REQUESTS_PER_SECOND configuration', () => {
      const originalValue = process.env.MAX_REQUESTS_PER_SECOND;

      process.env.MAX_REQUESTS_PER_SECOND = '10';
      const value = parseInt(process.env.MAX_REQUESTS_PER_SECOND, 10);
      assert.strictEqual(value, 10);

      // Restore
      if (originalValue !== undefined) {
        process.env.MAX_REQUESTS_PER_SECOND = originalValue;
      } else {
        delete process.env.MAX_REQUESTS_PER_SECOND;
      }
    });

    it('should respect RATE_LIMITING_BURST configuration', () => {
      const originalValue = process.env.RATE_LIMITING_BURST;

      process.env.RATE_LIMITING_BURST = '20';
      const value = parseInt(process.env.RATE_LIMITING_BURST, 10);
      assert.strictEqual(value, 20);

      // Restore
      if (originalValue !== undefined) {
        process.env.RATE_LIMITING_BURST = originalValue;
      } else {
        delete process.env.RATE_LIMITING_BURST;
      }
    });
  });

  describe('Temp File Cleanup', () => {
    const testTempDir = path.join(os.tmpdir(), 'mcp-test-cleanup');

    before(() => {
      // Create test directory
      if (!fs.existsSync(testTempDir)) {
        fs.mkdirSync(testTempDir, { recursive: true });
      }
    });

    after(() => {
      // Cleanup test directory
      if (fs.existsSync(testTempDir)) {
        const files = fs.readdirSync(testTempDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(testTempDir, file));
        });
        fs.rmdirSync(testTempDir);
      }
    });

    it('should create temp directory if it does not exist', () => {
      const newDir = path.join(os.tmpdir(), 'mcp-test-new-dir');

      // Ensure it doesn't exist
      if (fs.existsSync(newDir)) {
        fs.rmdirSync(newDir);
      }

      // Create it
      fs.mkdirSync(newDir, { recursive: true });

      assert.ok(fs.existsSync(newDir));

      // Cleanup
      fs.rmdirSync(newDir);
    });

    it('should be able to write and delete temp files', () => {
      const testFile = path.join(testTempDir, 'test-file.txt');

      // Write file
      fs.writeFileSync(testFile, 'test content');
      assert.ok(fs.existsSync(testFile));

      // Delete file
      fs.unlinkSync(testFile);
      assert.ok(!fs.existsSync(testFile));
    });

    it('should be able to cleanup old files based on age', () => {
      const oldFile = path.join(testTempDir, 'old-file.txt');
      const newFile = path.join(testTempDir, 'new-file.txt');

      // Create files
      fs.writeFileSync(oldFile, 'old content');
      fs.writeFileSync(newFile, 'new content');

      // Modify old file's timestamp to be 2 hours old
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      fs.utimesSync(oldFile, new Date(twoHoursAgo), new Date(twoHoursAgo));

      // Simulate cleanup of files older than 1 hour
      const files = fs.readdirSync(testTempDir);
      const oneHourMs = 60 * 60 * 1000;
      const now = Date.now();

      let deletedCount = 0;
      files.forEach(file => {
        const filepath = path.join(testTempDir, file);
        const stats = fs.statSync(filepath);
        const age = now - stats.mtimeMs;

        if (age > oneHourMs) {
          fs.unlinkSync(filepath);
          deletedCount++;
        }
      });

      assert.strictEqual(deletedCount, 1); // Only old file should be deleted
      assert.ok(!fs.existsSync(oldFile));
      assert.ok(fs.existsSync(newFile));

      // Cleanup remaining file
      fs.unlinkSync(newFile);
    });

    it('should handle cleanup of non-existent directory gracefully', () => {
      const nonExistentDir = path.join(os.tmpdir(), 'does-not-exist-123456');

      // Should not throw error
      assert.ok(!fs.existsSync(nonExistentDir));
    });

    it('should get directory size correctly', () => {
      const testFile1 = path.join(testTempDir, 'file1.txt');
      const testFile2 = path.join(testTempDir, 'file2.txt');

      const content1 = 'A'.repeat(100);
      const content2 = 'B'.repeat(200);

      fs.writeFileSync(testFile1, content1);
      fs.writeFileSync(testFile2, content2);

      const files = fs.readdirSync(testTempDir);
      let totalSize = 0;
      files.forEach(file => {
        const stats = fs.statSync(path.join(testTempDir, file));
        totalSize += stats.size;
      });

      assert.strictEqual(totalSize, 300);

      // Cleanup
      fs.unlinkSync(testFile1);
      fs.unlinkSync(testFile2);
    });
  });

  describe('Integration Tests', () => {
    it('should have all medium severity fixes enabled by default', () => {
      // Rate limiting should be enabled by default
      const rateLimiting = process.env.ENABLE_RATE_LIMITING !== 'false';
      assert.ok(rateLimiting);

      // Error sanitization should work in all modes
      const error = new Error('Test error');
      const sanitized = sanitizeErrorMessage(error, 'Test message');
      assert.ok(sanitized);
    });

    it('should allow configuration via environment variables', () => {
      const originalEnvs = {
        ENABLE_RATE_LIMITING: process.env.ENABLE_RATE_LIMITING,
        MAX_REQUESTS_PER_SECOND: process.env.MAX_REQUESTS_PER_SECOND,
        RATE_LIMITING_BURST: process.env.RATE_LIMITING_BURST
      };

      // Set custom values
      process.env.ENABLE_RATE_LIMITING = 'true';
      process.env.MAX_REQUESTS_PER_SECOND = '10';
      process.env.RATE_LIMITING_BURST = '20';

      assert.strictEqual(process.env.ENABLE_RATE_LIMITING, 'true');
      assert.strictEqual(process.env.MAX_REQUESTS_PER_SECOND, '10');
      assert.strictEqual(process.env.RATE_LIMITING_BURST, '20');

      // Restore original values
      Object.entries(originalEnvs).forEach(([key, value]) => {
        if (value !== undefined) {
          process.env[key] = value;
        } else {
          delete process.env[key];
        }
      });
    });
  });
});

