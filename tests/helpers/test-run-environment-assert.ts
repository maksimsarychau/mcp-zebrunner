/**
 * Validates Public API test-run JSON against MCP Zod schemas and reports environment.key shape.
 * Used by tests/api-verify.sh (P6b).
 *
 * Usage:
 *   echo "$BODY" | npx tsx tests/helpers/test-run-environment-assert.ts list
 *   echo "$BODY" | npx tsx tests/helpers/test-run-environment-assert.ts single
 *   echo "$BODY" | npx tsx tests/helpers/test-run-environment-assert.ts single --require-environment
 */
import { readFileSync } from 'node:fs';
import {
  PublicTestRunResponseSchema,
  PublicTestRunsResponseSchema,
} from '../../src/types/core.js';

const argv = process.argv.slice(2);
const mode = argv.find((a) => a === 'list' || a === 'single') || 'list';
const requireEnvironment = argv.includes('--require-environment');
const rawStr = readFileSync(0, 'utf8');

function reportRawEnvironmentKeys(items: Array<{ id?: number; environment?: unknown }>): string {
  let withEnv = 0;
  let missingRawKey = 0;
  for (const run of items) {
    const env = run.environment as Record<string, unknown> | null | undefined;
    if (!env || typeof env !== 'object') continue;
    withEnv += 1;
    const hasRawKey =
      Object.prototype.hasOwnProperty.call(env, 'key') &&
      env.key != null &&
      String(env.key).length > 0;
    if (!hasRawKey) missingRawKey += 1;
  }
  if (withEnv === 0) {
    return 'no runs with environment in this page';
  }
  if (missingRawKey === 0) {
    return `${withEnv} run(s) with environment; all include API key`;
  }
  return `${withEnv} run(s) with environment; ${missingRawKey} missing raw API key (MCP uses name fallback)`;
}

try {
  const parsed = JSON.parse(rawStr);

  if (mode === 'single') {
    const validated = PublicTestRunResponseSchema.parse(parsed);
    const run = validated.data ?? parsed.data ?? parsed;
    if (requireEnvironment && !run.environment) {
      process.stderr.write('Test run has no environment object (set Environment in TCM UI or pick another run id)\n');
      process.exit(1);
    }
    const detail = reportRawEnvironmentKeys([run]);
    process.stdout.write(`OK: single test run — ${detail}\n`);
    process.exit(0);
  }

  PublicTestRunsResponseSchema.parse(parsed);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const detail = reportRawEnvironmentKeys(items);
  process.stdout.write(`OK: test-runs list — ${detail}\n`);
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(message.slice(0, 500) + '\n');
  process.exit(1);
}
