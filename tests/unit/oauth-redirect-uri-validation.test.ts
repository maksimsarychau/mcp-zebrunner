import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  isAllowedMcpRedirectUri,
  filterAllowedMcpRedirectUris,
} from '../../src/http/oauth-redirect-uri-validation.js';

describe('oauth-redirect-uri-validation', () => {
  it('allows loopback http callbacks and cursor scheme', () => {
    assert.ok(isAllowedMcpRedirectUri('http://127.0.0.1/oauth/callback'));
    assert.ok(isAllowedMcpRedirectUri('http://localhost/callback'));
    assert.ok(isAllowedMcpRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback'));
    assert.ok(isAllowedMcpRedirectUri('myapp://cb'));
  });

  it('rejects remote https and dangerous schemes', () => {
    assert.ok(!isAllowedMcpRedirectUri('https://example.com/cb'));
    assert.ok(!isAllowedMcpRedirectUri('javascript:alert(1)'));
    assert.ok(!isAllowedMcpRedirectUri('http://evil.com/oauth/callback'));
  });

  it('filterAllowedMcpRedirectUris keeps only allowed entries', () => {
    const filtered = filterAllowedMcpRedirectUris([
      'myapp://cb',
      'https://example.com/cb',
      'http://127.0.0.1/oauth/callback',
    ]);
    assert.deepEqual(filtered, ['myapp://cb', 'http://127.0.0.1/oauth/callback']);
  });
});
