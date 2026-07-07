const DUP_CLUSTER_CAP = 20;
const DUP_MATRIX_CAP = 20;

/**
 * Cap duplicate-analysis JSON/dto payloads: top-20 clusters, optional matrix cap,
 * collapse steps[] to stepCount.
 */
export function capDuplicateAnalysisJson(result: any, includeSimilarityMatrix: boolean): any {
  const capCluster = (c: any) => ({
    ...c,
    testCases: Array.isArray(c?.testCases)
      ? c.testCases.map((tc: any) => {
          if (tc && Array.isArray(tc.steps)) {
            const { steps, ...rest } = tc;
            return { ...rest, stepCount: steps.length };
          }
          return tc;
        })
      : c?.testCases,
  });

  const out: any = { ...result };
  for (const key of ['clusters', 'semanticClusters', 'stepClusters']) {
    if (Array.isArray(out[key])) {
      const full = out[key];
      out[key] = full.slice(0, DUP_CLUSTER_CAP).map(capCluster);
      if (full.length > DUP_CLUSTER_CAP) {
        out[`${key}Truncated`] = { shown: DUP_CLUSTER_CAP, total: full.length };
      }
    }
  }

  if (Array.isArray(out.similarityMatrix)) {
    const total = out.similarityMatrix.length;
    if (!includeSimilarityMatrix) {
      delete out.similarityMatrix;
      out.similarityMatrixOmitted = {
        reason: 'Set include_similarity_matrix=true to include (large payload)',
        totalPairs: total,
      };
    } else if (total > DUP_MATRIX_CAP) {
      out.similarityMatrix = out.similarityMatrix.slice(0, DUP_MATRIX_CAP);
      out.similarityMatrixTruncated = { shown: DUP_MATRIX_CAP, total };
    }
  }

  return out;
}
