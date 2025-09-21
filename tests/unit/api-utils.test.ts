import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  ZebrunnerApiError,
  ZebrunnerAuthError,
  ZebrunnerNotFoundError,
  ZebrunnerRateLimitError
} from '../../src/types/api.js';

describe('API Error Classes', () => {
  describe('ZebrunnerApiError', () => {
    it('should create basic API error', () => {
      const error = new ZebrunnerApiError('Test error message');
      
      assert.equal(error.name, 'ZebrunnerApiError');
      assert.equal(error.message, 'Test error message');
      assert.equal(error.statusCode, undefined);
      assert.equal(error.response, undefined);
      assert.equal(error.endpoint, undefined);
    });

    it('should create API error with all properties', () => {
      const response = { error: 'Bad request' };
      const error = new ZebrunnerApiError(
        'Request failed',
        400,
        response,
        '/api/test-cases'
      );
      
      assert.equal(error.name, 'ZebrunnerApiError');
      assert.equal(error.message, 'Request failed');
      assert.equal(error.statusCode, 400);
      assert.deepEqual(error.response, response);
      assert.equal(error.endpoint, '/api/test-cases');
    });

    it('should be instance of Error', () => {
      const error = new ZebrunnerApiError('Test error');
      assert.ok(error instanceof Error);
      assert.ok(error instanceof ZebrunnerApiError);
    });

    it('should have proper stack trace', () => {
      const error = new ZebrunnerApiError('Test error');
      assert.ok(error.stack);
      assert.ok(error.stack.includes('ZebrunnerApiError'));
    });
  });

  describe('ZebrunnerAuthError', () => {
    it('should create auth error with default message', () => {
      const error = new ZebrunnerAuthError();
      
      assert.equal(error.name, 'ZebrunnerAuthError');
      assert.equal(error.message, 'Authentication failed');
      assert.equal(error.statusCode, 401);
    });

    it('should create auth error with custom message', () => {
      const error = new ZebrunnerAuthError('Invalid token');
      
      assert.equal(error.name, 'ZebrunnerAuthError');
      assert.equal(error.message, 'Invalid token');
      assert.equal(error.statusCode, 401);
    });

    it('should be instance of ZebrunnerApiError', () => {
      const error = new ZebrunnerAuthError();
      assert.ok(error instanceof Error);
      assert.ok(error instanceof ZebrunnerApiError);
      assert.ok(error instanceof ZebrunnerAuthError);
    });
  });

  describe('ZebrunnerNotFoundError', () => {
    it('should create not found error with string identifier', () => {
      const error = new ZebrunnerNotFoundError('Test Case', 'TC-123');
      
      assert.equal(error.name, 'ZebrunnerNotFoundError');
      assert.equal(error.message, 'Test Case not found: TC-123');
      assert.equal(error.statusCode, 404);
    });

    it('should create not found error with numeric identifier', () => {
      const error = new ZebrunnerNotFoundError('Test Suite', 456);
      
      assert.equal(error.name, 'ZebrunnerNotFoundError');
      assert.equal(error.message, 'Test Suite not found: 456');
      assert.equal(error.statusCode, 404);
    });

    it('should be instance of ZebrunnerApiError', () => {
      const error = new ZebrunnerNotFoundError('Resource', 123);
      assert.ok(error instanceof Error);
      assert.ok(error instanceof ZebrunnerApiError);
      assert.ok(error instanceof ZebrunnerNotFoundError);
    });
  });

  describe('ZebrunnerRateLimitError', () => {
    it('should create rate limit error without retry after', () => {
      const error = new ZebrunnerRateLimitError();
      
      assert.equal(error.name, 'ZebrunnerRateLimitError');
      assert.equal(error.message, 'Rate limit exceeded');
      assert.equal(error.statusCode, 429);
    });

    it('should create rate limit error with retry after', () => {
      const error = new ZebrunnerRateLimitError(60);
      
      assert.equal(error.name, 'ZebrunnerRateLimitError');
      assert.equal(error.message, 'Rate limit exceeded, retry after 60s');
      assert.equal(error.statusCode, 429);
    });

    it('should be instance of ZebrunnerApiError', () => {
      const error = new ZebrunnerRateLimitError();
      assert.ok(error instanceof Error);
      assert.ok(error instanceof ZebrunnerApiError);
      assert.ok(error instanceof ZebrunnerRateLimitError);
    });
  });

  describe('Error Serialization', () => {
    it('should serialize API error to JSON', () => {
      const error = new ZebrunnerApiError(
        'Test error',
        400,
        { details: 'Bad request' },
        '/api/test'
      );
      
      const serialized = JSON.stringify(error);
      const parsed = JSON.parse(serialized);
      
      assert.equal(parsed.name, 'ZebrunnerApiError');
      assert.equal(parsed.message, 'Test error');
      assert.equal(parsed.statusCode, 400);
      assert.deepEqual(parsed.response, { details: 'Bad request' });
      assert.equal(parsed.endpoint, '/api/test');
    });

    it('should handle error without optional properties', () => {
      const error = new ZebrunnerApiError('Simple error');
      
      const serialized = JSON.stringify(error);
      const parsed = JSON.parse(serialized);
      
      assert.equal(parsed.name, 'ZebrunnerApiError');
      assert.equal(parsed.message, 'Simple error');
      assert.equal(parsed.statusCode, undefined);
    });
  });

  describe('Error Inheritance Chain', () => {
    it('should maintain proper inheritance for all error types', () => {
      const apiError = new ZebrunnerApiError('API error');
      const authError = new ZebrunnerAuthError('Auth error');
      const notFoundError = new ZebrunnerNotFoundError('Resource', 123);
      const rateLimitError = new ZebrunnerRateLimitError(30);
      
      // All should be instances of Error
      assert.ok(apiError instanceof Error);
      assert.ok(authError instanceof Error);
      assert.ok(notFoundError instanceof Error);
      assert.ok(rateLimitError instanceof Error);
      
      // All should be instances of ZebrunnerApiError
      assert.ok(apiError instanceof ZebrunnerApiError);
      assert.ok(authError instanceof ZebrunnerApiError);
      assert.ok(notFoundError instanceof ZebrunnerApiError);
      assert.ok(rateLimitError instanceof ZebrunnerApiError);
      
      // Specific type checks
      assert.ok(authError instanceof ZebrunnerAuthError);
      assert.ok(notFoundError instanceof ZebrunnerNotFoundError);
      assert.ok(rateLimitError instanceof ZebrunnerRateLimitError);
      
      // Cross-type checks (should be false)
      assert.ok(!(apiError instanceof ZebrunnerAuthError));
      assert.ok(!(authError instanceof ZebrunnerNotFoundError));
      assert.ok(!(notFoundError instanceof ZebrunnerRateLimitError));
    });
  });

  describe('Error Message Formatting', () => {
    it('should format error messages consistently', () => {
      const errors = [
        new ZebrunnerApiError('Generic API error'),
        new ZebrunnerAuthError('Custom auth message'),
        new ZebrunnerNotFoundError('Test Case', 'TC-123'),
        new ZebrunnerRateLimitError(120)
      ];
      
      errors.forEach(error => {
        assert.ok(error.message.length > 0);
        assert.equal(typeof error.message, 'string');
        assert.ok(!error.message.includes('undefined'));
        assert.ok(!error.message.includes('null'));
      });
    });

    it('should handle edge cases in error construction', () => {
      // Empty string message
      const emptyError = new ZebrunnerApiError('');
      assert.equal(emptyError.message, '');
      
      // Zero retry after
      const zeroRetryError = new ZebrunnerRateLimitError(0);
      assert.ok(zeroRetryError.message.includes('retry after 0s'));
      
      // Empty resource name
      const emptyResourceError = new ZebrunnerNotFoundError('', 123);
      assert.equal(emptyResourceError.message, ' not found: 123');
    });
  });
});
