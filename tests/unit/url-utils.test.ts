import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeZebrunnerUrl, toWebUrl } from '../../src/http/url-utils.js';

describe('normalizeZebrunnerUrl', () => {
  it('appends /api/public/v1 to a bare HTTPS URL', () => {
    assert.equal(
      normalizeZebrunnerUrl('https://mcp.zebrunner.com'),
      'https://mcp.zebrunner.com/api/public/v1',
    );
  });

  it('strips trailing slash before appending', () => {
    assert.equal(
      normalizeZebrunnerUrl('https://mcp.zebrunner.com/'),
      'https://mcp.zebrunner.com/api/public/v1',
    );
  });

  it('keeps URL unchanged if it already ends with /api/public/v1', () => {
    assert.equal(
      normalizeZebrunnerUrl('https://mcp.zebrunner.com/api/public/v1'),
      'https://mcp.zebrunner.com/api/public/v1',
    );
  });

  it('handles URL with trailing slash after /api/public/v1', () => {
    assert.equal(
      normalizeZebrunnerUrl('https://mcp.zebrunner.com/api/public/v1/'),
      'https://mcp.zebrunner.com/api/public/v1',
    );
  });

  it('handles HTTP URLs in non-production', () => {
    assert.equal(
      normalizeZebrunnerUrl('http://localhost:8080'),
      'http://localhost:8080/api/public/v1',
    );
  });

  it('trims whitespace', () => {
    assert.equal(
      normalizeZebrunnerUrl('  https://mcp.zebrunner.com  '),
      'https://mcp.zebrunner.com/api/public/v1',
    );
  });

  it('throws on empty string', () => {
    assert.throws(() => normalizeZebrunnerUrl(''), /required/i);
  });

  it('throws on null/undefined input', () => {
    assert.throws(() => normalizeZebrunnerUrl(undefined as any), /required/i);
    assert.throws(() => normalizeZebrunnerUrl(null as any), /required/i);
  });

  it('throws on invalid URL format', () => {
    assert.throws(() => normalizeZebrunnerUrl('not-a-url'), /Invalid URL/i);
  });

  it('throws on unsupported protocol', () => {
    assert.throws(() => normalizeZebrunnerUrl('ftp://zebrunner.com'), /Unsupported protocol/i);
  });

  it('handles URLs with port numbers', () => {
    assert.equal(
      normalizeZebrunnerUrl('https://zebrunner.internal:9443'),
      'https://zebrunner.internal:9443/api/public/v1',
    );
  });

  it('handles URLs with subpaths', () => {
    assert.equal(
      normalizeZebrunnerUrl('https://proxy.company.com/zebrunner'),
      'https://proxy.company.com/zebrunner/api/public/v1',
    );
  });
});

describe('toWebUrl', () => {
  it('strips /api/public/v1 suffix', () => {
    assert.equal(
      toWebUrl('https://mcp.zebrunner.com/api/public/v1'),
      'https://mcp.zebrunner.com',
    );
  });

  it('returns URL unchanged if no suffix present', () => {
    assert.equal(
      toWebUrl('https://mcp.zebrunner.com'),
      'https://mcp.zebrunner.com',
    );
  });
});
