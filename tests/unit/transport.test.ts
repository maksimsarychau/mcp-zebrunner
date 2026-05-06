import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveTransportMode, resolveAuthMode, hasStrategy } from '../../src/config/transport.js';

describe('resolveTransportMode', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MCP_TRANSPORT;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns stdio when MCP_TRANSPORT=stdio regardless of PORT', () => {
    process.env.MCP_TRANSPORT = 'stdio';
    process.env.PORT = '3000';
    assert.equal(resolveTransportMode(), 'stdio');
  });

  it('returns http when MCP_TRANSPORT=http and PORT is set', () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.PORT = '3000';
    assert.equal(resolveTransportMode(), 'http');
  });

  it('throws when MCP_TRANSPORT=http but PORT is missing', () => {
    process.env.MCP_TRANSPORT = 'http';
    assert.throws(() => resolveTransportMode(), /PORT to be set/);
  });

  it('auto-detects http when PORT is set and MCP_TRANSPORT is auto', () => {
    process.env.MCP_TRANSPORT = 'auto';
    process.env.PORT = '8080';
    assert.equal(resolveTransportMode(), 'http');
  });

  it('auto-detects stdio when PORT is not set and MCP_TRANSPORT is auto', () => {
    process.env.MCP_TRANSPORT = 'auto';
    assert.equal(resolveTransportMode(), 'stdio');
  });

  it('auto-detects http when PORT is set and MCP_TRANSPORT is not set', () => {
    process.env.PORT = '3000';
    assert.equal(resolveTransportMode(), 'http');
  });

  it('auto-detects stdio when neither PORT nor MCP_TRANSPORT is set', () => {
    assert.equal(resolveTransportMode(), 'stdio');
  });

  it('throws for invalid MCP_TRANSPORT value', () => {
    process.env.MCP_TRANSPORT = 'websocket';
    assert.throws(() => resolveTransportMode(), /Invalid MCP_TRANSPORT/);
  });

  it('accepts streamablehttp as alias for http', () => {
    process.env.MCP_TRANSPORT = 'streamablehttp';
    process.env.PORT = '3000';
    assert.equal(resolveTransportMode(), 'http');
  });
});

describe('resolveAuthMode', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MCP_AUTH_MODE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to headers when MCP_AUTH_MODE is not set', () => {
    assert.equal(resolveAuthMode(), 'headers');
  });

  it('returns selfauth when MCP_AUTH_MODE=selfauth', () => {
    process.env.MCP_AUTH_MODE = 'selfauth';
    assert.equal(resolveAuthMode(), 'selfauth');
  });

  it('returns okta when MCP_AUTH_MODE=okta', () => {
    process.env.MCP_AUTH_MODE = 'okta';
    assert.equal(resolveAuthMode(), 'okta');
  });

  it('returns okta for legacy MCP_AUTH_MODE=oauth', () => {
    process.env.MCP_AUTH_MODE = 'oauth';
    assert.equal(resolveAuthMode(), 'okta');
  });

  it('returns headers,okta for legacy MCP_AUTH_MODE=both', () => {
    process.env.MCP_AUTH_MODE = 'both';
    assert.equal(resolveAuthMode(), 'headers,okta');
  });

  it('returns headers,selfauth when MCP_AUTH_MODE=headers,selfauth', () => {
    process.env.MCP_AUTH_MODE = 'headers,selfauth';
    assert.equal(resolveAuthMode(), 'headers,selfauth');
  });

  it('returns headers,okta when MCP_AUTH_MODE=headers,okta', () => {
    process.env.MCP_AUTH_MODE = 'headers,okta';
    assert.equal(resolveAuthMode(), 'headers,okta');
  });

  it('normalizes order: okta,headers → headers,okta', () => {
    process.env.MCP_AUTH_MODE = 'okta,headers';
    assert.equal(resolveAuthMode(), 'headers,okta');
  });

  it('handles whitespace in comma-separated values', () => {
    process.env.MCP_AUTH_MODE = ' headers , selfauth ';
    assert.equal(resolveAuthMode(), 'headers,selfauth');
  });

  it('throws for invalid values', () => {
    process.env.MCP_AUTH_MODE = 'saml';
    assert.throws(() => resolveAuthMode(), /Invalid MCP_AUTH_MODE/);
  });

  it('throws for invalid combinations', () => {
    process.env.MCP_AUTH_MODE = 'selfauth,okta';
    assert.throws(() => resolveAuthMode(), /Invalid MCP_AUTH_MODE/);
  });
});

describe('hasStrategy', () => {
  it('returns true for exact match', () => {
    assert.ok(hasStrategy('headers', 'headers'));
    assert.ok(hasStrategy('selfauth', 'selfauth'));
    assert.ok(hasStrategy('okta', 'okta'));
  });

  it('returns true for strategy in combo', () => {
    assert.ok(hasStrategy('headers,okta', 'headers'));
    assert.ok(hasStrategy('headers,okta', 'okta'));
    assert.ok(hasStrategy('headers,selfauth', 'headers'));
    assert.ok(hasStrategy('headers,selfauth', 'selfauth'));
  });

  it('returns false when strategy is not in mode', () => {
    assert.ok(!hasStrategy('headers', 'okta'));
    assert.ok(!hasStrategy('selfauth', 'headers'));
    assert.ok(!hasStrategy('headers,okta', 'selfauth'));
  });
});
