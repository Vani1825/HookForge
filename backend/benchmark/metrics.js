/**
 * Pure statistical calculation and percentile aggregation utilities
 * for HookForge Performance Benchmarking.
 */

/**
 * Calculate accurate percentile using linear interpolation between nearest ranks.
 * This corresponds to the standard NIST / R Type-7 percentile algorithm.
 *
 * @param {number[]} sortedValues - Array of numeric values sorted ascending
 * @param {number} percentile - Percentile to calculate (0 - 100)
 * @returns {number} Interpolated percentile value rounded to 2 decimal places
 */
export function calculatePercentile(sortedValues, percentile) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return 0;
  }

  const p = Math.max(0, Math.min(100, Number(percentile) || 0));

  if (sortedValues.length === 1 || p === 0) {
    return Math.round(sortedValues[0] * 100) / 100;
  }
  if (p === 100) {
    return Math.round(sortedValues[sortedValues.length - 1] * 100) / 100;
  }

  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  const result = sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  return Math.round(result * 100) / 100;
}

/**
 * Aggregate benchmark results and compute performance metrics.
 *
 * @param {Array<{ latencyMs: number, statusCode?: number, success: boolean, error?: string }>} results
 * @param {number} totalDurationMs - Total wall-clock duration of the benchmark run
 * @returns {Object} Structured statistical metrics
 */
export function calculateStats(results = [], totalDurationMs = 0) {
  const totalRequests = results.length;
  if (totalRequests === 0) {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      throttledRequests: 0,
      successRatePct: 0,
      totalDurationMs: 0,
      throughputRps: 0,
      latencies: {
        minMs: 0,
        maxMs: 0,
        avgMs: 0,
        p50Ms: 0,
        p90Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
      },
      statusDistribution: {},
      errorDistribution: {},
    };
  }

  let successfulRequests = 0;
  let failedRequests = 0;
  let throttledRequests = 0;
  const statusDistribution = {};
  const errorDistribution = {};
  const latencies = [];

  for (const item of results) {
    const lat = typeof item.latencyMs === 'number' && !isNaN(item.latencyMs) && item.latencyMs >= 0
      ? item.latencyMs
      : 0;
    latencies.push(lat);

    if (item.success) {
      successfulRequests++;
    } else {
      failedRequests++;
    }

    if (item.statusCode) {
      const codeStr = String(item.statusCode);
      statusDistribution[codeStr] = (statusDistribution[codeStr] || 0) + 1;
      if (item.statusCode === 429) {
        throttledRequests++;
      }
    }

    if (item.error) {
      const errKey = String(item.error).split(':')[0].trim() || 'UnknownError';
      errorDistribution[errKey] = (errorDistribution[errKey] || 0) + 1;
    }
  }

  // Sort latencies ascending for percentile computation
  latencies.sort((a, b) => a - b);

  const sumLatencies = latencies.reduce((acc, val) => acc + val, 0);
  const avgMs = Math.round((sumLatencies / totalRequests) * 100) / 100;
  const minMs = Math.round(latencies[0] * 100) / 100;
  const maxMs = Math.round(latencies[latencies.length - 1] * 100) / 100;

  const durationSec = Math.max(0.001, totalDurationMs / 1000);
  const throughputRps = Math.round((totalRequests / durationSec) * 100) / 100;
  const successRatePct = Math.round((successfulRequests / totalRequests) * 10000) / 100;

  return {
    totalRequests,
    successfulRequests,
    failedRequests,
    throttledRequests,
    successRatePct,
    totalDurationMs: Math.round(totalDurationMs * 100) / 100,
    throughputRps,
    latencies: {
      minMs,
      maxMs,
      avgMs,
      p50Ms: calculatePercentile(latencies, 50),
      p90Ms: calculatePercentile(latencies, 90),
      p95Ms: calculatePercentile(latencies, 95),
      p99Ms: calculatePercentile(latencies, 99),
    },
    statusDistribution,
    errorDistribution,
  };
}

export default {
  calculatePercentile,
  calculateStats,
};
