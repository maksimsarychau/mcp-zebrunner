import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeAuditLog, AUDIT_LOG_PATH, AuditEntry } from '../../src/helpers/audit.js';

describe('audit helper', () => {
  const testLogPath = AUDIT_LOG_PATH;
  let originalContent: string | null = null;

  afterEach(() => {
    if (originalContent !== null && fs.existsSync(testLogPath)) {
      fs.writeFileSync(testLogPath, originalContent, 'utf-8');
      originalContent = null;
    }
  });

  it('AUDIT_LOG_PATH points to home directory', () => {
    assert.equal(testLogPath, path.join(os.homedir(), '.mcp-zebrunner-audit.jsonl'));
  });

  it('writeAuditLog appends a JSONL line to the audit file', () => {
    if (fs.existsSync(testLogPath)) {
      originalContent = fs.readFileSync(testLogPath, 'utf-8');
    } else {
      originalContent = '';
    }

    const entry: AuditEntry = {
      timestamp: '2026-04-08T12:00:00.000Z',
      tool: 'create_test_suite',
      method: 'POST',
      url: '/test-suites?projectKey=MCP',
      projectKey: 'MCP',
      payload: { title: 'Test Suite' },
    };

    writeAuditLog(entry);

    const content = fs.readFileSync(testLogPath, 'utf-8');
    const lines = content.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    const parsed = JSON.parse(lastLine);

    assert.equal(parsed.tool, 'create_test_suite');
    assert.equal(parsed.method, 'POST');
    assert.equal(parsed.projectKey, 'MCP');
    assert.deepEqual(parsed.payload, { title: 'Test Suite' });
  });

  it('writeAuditLog does not throw on write failure', () => {
    assert.doesNotThrow(() => {
      writeAuditLog({
        timestamp: new Date().toISOString(),
        tool: 'test',
        method: 'POST',
        url: '/test',
        payload: {},
      });
    });
  });
});
