import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { queryParamString } from '../../src/http/query-params.js';
import { sanitizeOAuthStoreKey } from '../../src/http/oauth-flow-store.js';

describe('queryParamString', () => {
  it('returns string values', () => {
    assert.equal(queryParamString({ code: 'abc', state: 'xyz' }, 'code'), 'abc');
  });

  it('returns undefined for missing keys', () => {
    assert.equal(queryParamString({}, 'state'), undefined);
  });

  it('returns undefined for array values (duplicate query params)', () => {
    assert.equal(queryParamString({ state: ['a', 'b'] }, 'state'), undefined);
  });

  it('returns undefined for non-string values', () => {
    assert.equal(queryParamString({ state: { nested: true } }, 'state'), undefined);
  });
});

describe('sanitizeOAuthStoreKey runtime type guard', () => {
  it('rejects non-string keys', () => {
    assert.throws(() => sanitizeOAuthStoreKey(['array-key']), /Invalid OAuth flow store key/);
    assert.throws(() => sanitizeOAuthStoreKey(123), /Invalid OAuth flow store key/);
  });
});
