import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateFilePath, maskToken, maskAuthHeader, validateFileUrl } from '../../src/utils/security.js';

/**
 * Security Utilities Test Suite
 * Tests for path validation, token masking, and URL validation
 */

describe('Security Utilities', () => {
  describe('validateFilePath', () => {
    it('should allow safe paths in current directory', () => {
      const safePath = 'test-file.md';
      const result = validateFilePath(safePath, process.cwd());
      assert.ok(result.includes('test-file.md'));
    });

    it('should allow paths in subdirectories', () => {
      const safePath = 'docs/test.md';
      const result = validateFilePath(safePath, process.cwd());
      assert.ok(result.includes('docs/test.md'));
    });

    it('should block /etc/passwd', () => {
      assert.throws(
        () => validateFilePath('/etc/passwd', process.cwd()),
        /Security: Access denied - path in sensitive directory/
      );
    });

    it('should block path traversal with ../../../etc/passwd', () => {
      assert.throws(
        () => validateFilePath('../../../etc/passwd', process.cwd()),
        /Security: Invalid path - path traversal detected/
      );
    });

    it('should block /home/user/.ssh/id_rsa', () => {
      assert.throws(
        () => validateFilePath('/home/user/.ssh/id_rsa', process.cwd()),
        /Security: Access denied - path in sensitive directory/
      );
    });

    it('should block /root directory access', () => {
      assert.throws(
        () => validateFilePath('/root/secret.txt', process.cwd()),
        /Security: Access denied - path in sensitive directory/
      );
    });

    it('should block /var directory access', () => {
      assert.throws(
        () => validateFilePath('/var/log/system.log', process.cwd()),
        /Security: Access denied - path in sensitive directory/
      );
    });

    it('should block paths with null bytes', () => {
      assert.throws(
        () => validateFilePath('test\x00file.txt', process.cwd()),
        /Security: Invalid path - contains null byte/
      );
    });

    it('should block relative path traversal', () => {
      assert.throws(
        () => validateFilePath('../../secrets.txt', process.cwd()),
        /Security: Invalid path - path traversal detected/
      );
    });
  });

  describe('maskToken', () => {
    it('should mask tokens correctly (first 4 + last 4)', () => {
      const token = 'dWhA61LFi4fDyT1srtjmzVYSJ6FqN89LQj7f07nNwBdLrPXjkX';
      const masked = maskToken(token);
      // Last 4 chars of this token are 'XjkX'
      assert.strictEqual(masked, 'dWhA...XjkX');
    });

    it('should handle short tokens gracefully', () => {
      const token = 'short';
      const masked = maskToken(token);
      assert.strictEqual(masked, '****');
    });

    it('should handle empty tokens', () => {
      const masked = maskToken('');
      assert.strictEqual(masked, '[empty token]');
    });

    it('should handle medium-length tokens', () => {
      const token = 'abcd12345'; // 9 chars, just over the threshold
      const masked = maskToken(token);
      assert.strictEqual(masked, 'abcd...2345');
    });
  });

  describe('maskAuthHeader', () => {
    it('should mask Bearer tokens', () => {
      const header = 'Bearer dWhA61LFi4fDyT1srtjmzVYSJ6FqN89LQj7f07nNwBdLrPXjkX';
      const masked = maskAuthHeader(header);
      assert.ok(masked.startsWith('Bearer '));
      assert.ok(masked.includes('...'));
    });

    it('should mask Basic tokens', () => {
      const header = 'Basic YWRtaW46cGFzc3dvcmQ=';
      const masked = maskAuthHeader(header);
      assert.ok(masked.startsWith('Basic '));
      assert.ok(masked.includes('...'));
    });

    it('should handle invalid format', () => {
      const header = 'InvalidHeader';
      const masked = maskAuthHeader(header);
      assert.strictEqual(masked, '[invalid format]');
    });

    it('should handle empty header', () => {
      const masked = maskAuthHeader('');
      assert.strictEqual(masked, '[no auth]');
    });
  });

  describe('validateFileUrl', () => {
    it('should allow valid /files/ paths', () => {
      const url = '/files/abc123';
      const result = validateFileUrl(url, { strictMode: true });
      assert.strictEqual(result, '/files/abc123');
    });

    it('should allow /files/ paths with dashes and underscores', () => {
      const url = '/files/test_file-123';
      const result = validateFileUrl(url, { strictMode: true });
      assert.strictEqual(result, '/files/test_file-123');
    });

    it('should allow /files/ paths with subdirectories', () => {
      const url = '/files/subfolder/file123';
      const result = validateFileUrl(url, { strictMode: true });
      assert.strictEqual(result, '/files/subfolder/file123');
    });

    it('should block file:// protocol', () => {
      assert.throws(
        () => validateFileUrl('file:///etc/passwd', { strictMode: true }),
        /Security: Invalid URL - dangerous protocol detected/
      );
    });

    it('should block ftp:// protocol', () => {
      assert.throws(
        () => validateFileUrl('ftp://example.com/file', { strictMode: true }),
        /Security: Invalid URL - dangerous protocol detected/
      );
    });

    it('should block javascript: protocol', () => {
      assert.throws(
        () => validateFileUrl('javascript:alert(1)', { strictMode: true }),
        /Security: Invalid URL - dangerous protocol detected/
      );
    });

    it('should allow https:// URLs in strict mode', () => {
      const url = 'https://example.com/files/test.jpg';
      const result = validateFileUrl(url, { strictMode: true });
      assert.strictEqual(result, url);
    });

    it('should allow http:// URLs in strict mode (non-production)', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      const url = 'http://localhost:3000/files/test.jpg';
      const result = validateFileUrl(url, { strictMode: true });
      assert.strictEqual(result, url);
      
      process.env.NODE_ENV = originalEnv;
    });

    it('should block invalid characters in /files/ paths', () => {
      assert.throws(
        () => validateFileUrl('/files/test<script>', { strictMode: true }),
        /Security: Invalid URL - contains disallowed characters/
      );
    });

    it('should block paths with null bytes', () => {
      assert.throws(
        () => validateFileUrl('/files/test\x00file', { strictMode: true }),
        /Security: Invalid URL - contains null byte/
      );
    });

    it('should respect skipOnError config - allow invalid URL with warning', () => {
      const url = 'invalid://url';
      // Should not throw, should return the URL with a warning logged
      const result = validateFileUrl(url, { 
        strictMode: true, 
        skipOnError: true 
      });
      assert.strictEqual(result, url);
    });

    it('should throw error when skipOnError is false (default)', () => {
      assert.throws(
        () => validateFileUrl('invalid://url', { 
          strictMode: true, 
          skipOnError: false 
        }),
        /Security: Invalid URL/
      );
    });

    it('should be less strict when strictMode is false', () => {
      const url = 'any-custom-path';
      const result = validateFileUrl(url, { strictMode: false });
      assert.strictEqual(result, url);
    });

    it('should still block dangerous protocols even in non-strict mode', () => {
      assert.throws(
        () => validateFileUrl('file:///etc/passwd', { strictMode: false }),
        /Security: Invalid URL - dangerous protocol detected/
      );
    });
  });

  describe('Integration scenarios', () => {
    it('should validate file paths for rules loading', () => {
      // Simulating rules file path validation
      const rulesPath = 'test_case_review_rules.md';
      const result = validateFilePath(rulesPath, process.cwd());
      assert.ok(result.endsWith('test_case_review_rules.md'));
    });

    it('should mask tokens in debug logs', () => {
      // Simulating authentication logging
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ';
      const masked = maskToken(token);
      
      // Should show only first and last 4 chars
      assert.ok(masked.length < token.length);
      assert.ok(masked.includes('...'));
    });

    it('should validate screenshot URLs before download', () => {
      // Simulating screenshot download URL validation
      const screenshotUrl = '/files/screenshots/test-123.png';
      const result = validateFileUrl(screenshotUrl, { 
        strictMode: true,
        skipOnError: false
      });
      assert.strictEqual(result, screenshotUrl);
    });

    it('should validate video artifact URLs', () => {
      // Simulating video artifact URL validation
      const videoUrl = '/files/videos/session-456.mp4';
      const result = validateFileUrl(videoUrl, {
        strictMode: true,
        skipOnError: false
      });
      assert.strictEqual(result, videoUrl);
    });

    it('should validate Zebrunner artifact paths', () => {
      // Simulating Zebrunner video artifact path
      const artifactPath = 'artifacts/esg-test-sessions/d7493c8e-2f36-44ea-bef3-c416499e6cec/video?projectId=7';
      const result = validateFileUrl(artifactPath, {
        strictMode: true,
        skipOnError: false
      });
      assert.strictEqual(result, artifactPath);
    });

    it('should validate Zebrunner artifact paths with leading slash', () => {
      // Simulating Zebrunner screenshot artifact path with leading slash
      const artifactPath = '/artifacts/esg-test-sessions/abc123/screenshot.png?projectId=10';
      const result = validateFileUrl(artifactPath, {
        strictMode: true,
        skipOnError: false
      });
      assert.strictEqual(result, artifactPath);
    });

    it('should reject invalid artifact paths with dangerous characters', () => {
      // Should reject artifact paths with script injection attempts
      assert.throws(
        () => validateFileUrl('artifacts/test<script>alert(1)</script>', { strictMode: true }),
        /Invalid URL - contains disallowed characters in artifacts path/
      );
    });
  });
});

