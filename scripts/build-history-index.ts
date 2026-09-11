#!/usr/bin/env tsx
/**
 * CLI: build local TCM history index (Option 1) without MCP timeout limits.
 *
 * Usage:
 *   ZEBRUNNER_URL=... ZEBRUNNER_TOKEN=... ZEBRUNNER_LOGIN=... \
 *     npx tsx scripts/build-history-index.ts MFPAND
 *
 * Options via env:
 *   HISTORY_INDEX_BATCH=150
 *   HISTORY_INDEX_CONCURRENCY=10
 */

import { EnhancedZebrunnerClient } from '../src/api/enhanced-client.js';
import { ZebrunnerReportingClient } from '../src/api/reporting-client.js';
import { buildHistoryIndexBatch } from '../src/utils/history-index/builder.js';
import { getHistoryIndexRoot } from '../src/utils/history-index/paths.js';

async function main(): Promise<void> {
  const projectKey = process.argv[2]?.trim();
  if (!projectKey) {
    console.error('Usage: tsx scripts/build-history-index.ts <PROJECT_KEY>');
    process.exit(2);
  }

  const batchSize = Number(process.env.HISTORY_INDEX_BATCH ?? 150);
  const concurrency = Number(process.env.HISTORY_INDEX_CONCURRENCY ?? 10);

  const client = new EnhancedZebrunnerClient({ debug: false });
  const reportingClient = new ZebrunnerReportingClient({ debug: false });
  const projectId = await reportingClient.getProjectId(projectKey);

  console.log(`Building history index for ${projectKey} (id=${projectId})`);
  console.log(`Storage: ${getHistoryIndexRoot()}/${projectKey}/index.json`);

  let complete = false;
  let rounds = 0;

  while (!complete) {
    rounds++;
    const result = await buildHistoryIndexBatch(
      { client, reportingClient, debugLog: (msg, data) => console.log(msg, data ?? '') },
      {
        projectKey,
        projectId,
        maxCasesPerBatch: batchSize,
        historyConcurrency: concurrency,
        continueBuild: true,
      },
    );

    console.log(
      `Round ${rounds}: batch=${result.casesProcessedThisBatch} total=${result.totalCasesIndexed} ` +
      `complete=${result.complete} (${result.durationMs}ms)`,
    );
    for (const note of result.notes) {
      console.log(`  → ${note}`);
    }

    complete = result.complete;
    if (rounds > 500) {
      console.error('Abort — too many rounds');
      process.exit(1);
    }
  }

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
