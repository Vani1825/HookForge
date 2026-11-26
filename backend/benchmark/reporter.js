/**
 * Benchmark Report Formatting and Sensitive Data Redaction.
 * Produces structured JSON reports and clean CLI terminal summaries.
 */

import { sanitizeReportHeaders } from './config.js';
import { redactSensitiveData } from '../src/utils/redaction.js';

/**
 * Format a benchmark result object as a structured JSON report.
 * Guaranteed to redact sensitive keys, tokens, or credentials.
 *
 * @param {Object} rawResult
 * @returns {string} Formatted JSON string
 */
export function formatJsonReport(rawResult) {
  const sanitized = { ...rawResult };

  if (sanitized.target && sanitized.target.headers) {
    sanitized.target.headers = sanitizeReportHeaders(sanitized.target.headers);
  }

  // Redact any nested sensitive credentials
  const fullyRedacted = redactSensitiveData(sanitized);
  return `${JSON.stringify(fullyRedacted, null, 2)}\n`;
}

/**
 * Format a human-readable CLI summary table for terminal display.
 *
 * @param {Object} result
 * @returns {string} Formatted terminal output
 */
export function formatCliSummary(result) {
  const { scenario, description, target, configuration, stats, comparison, coldRequest, warmBenchmark } = result;

  const lines = [];
  lines.push('=============================================================================');
  lines.push('                      HOOKFORGE PERFORMANCE BENCHMARK                        ');
  lines.push('=============================================================================');
  if (scenario) lines.push(`Scenario:      ${scenario.toUpperCase()}`);
  if (description) lines.push(`Description:   ${description}`);
  if (target?.url) lines.push(`Target URL:    ${target.method || 'GET'} ${target.url}`);
  lines.push(`Timestamp:     ${result.timestamp || new Date().toISOString()}`);
  lines.push('-----------------------------------------------------------------------------');

  if (stats) {
    lines.push(`Total Requests:      ${stats.totalRequests}`);
    lines.push(`Concurrency Level:   ${configuration?.concurrency || 1}`);
    lines.push(`Total Duration:      ${stats.totalDurationMs} ms`);
    lines.push(`Throughput:          ${stats.throughputRps} req/sec`);
    lines.push(`Success Rate:        ${stats.successRatePct}% (${stats.successfulRequests} / ${stats.totalRequests})`);
    if (stats.throttledRequests > 0) {
      lines.push(`Rate Limited (429):  ${stats.throttledRequests} requests`);
    }
    if (stats.failedRequests > 0) {
      lines.push(`Failed Requests:     ${stats.failedRequests}`);
    }

    lines.push('-----------------------------------------------------------------------------');
    lines.push('LATENCY PERCENTILES:');
    lines.push(`  Min:      ${stats.latencies.minMs.toFixed(2)} ms`);
    lines.push(`  Avg:      ${stats.latencies.avgMs.toFixed(2)} ms`);
    lines.push(`  P50:      ${stats.latencies.p50Ms.toFixed(2)} ms`);
    lines.push(`  P90:      ${stats.latencies.p90Ms.toFixed(2)} ms`);
    lines.push(`  P95:      ${stats.latencies.p95Ms.toFixed(2)} ms`);
    lines.push(`  P99:      ${stats.latencies.p99Ms.toFixed(2)} ms`);
    lines.push(`  Max:      ${stats.latencies.maxMs.toFixed(2)} ms`);

    lines.push('-----------------------------------------------------------------------------');
    lines.push('HTTP STATUS CODE DISTRIBUTION:');
    for (const [code, count] of Object.entries(stats.statusDistribution || {})) {
      const pct = Math.round((count / stats.totalRequests) * 1000) / 10;
      lines.push(`  HTTP ${code}:   ${count} (${pct}%)`);
    }

    if (stats.errorDistribution && Object.keys(stats.errorDistribution).length > 0) {
      lines.push('ERROR CLASSIFICATION:');
      for (const [err, count] of Object.entries(stats.errorDistribution)) {
        lines.push(`  ${err}: ${count}`);
      }
    }
  }

  if (comparison && coldRequest && warmBenchmark) {
    lines.push('-----------------------------------------------------------------------------');
    lines.push('COLD VS WARM CACHE COMPARISON:');
    lines.push(`  Cold Request Latency:   ${coldRequest.latencyMs.toFixed(2)} ms (HTTP ${coldRequest.statusCode})`);
    lines.push(`  Warm Avg Latency:       ${warmBenchmark.avgLatencyMs.toFixed(2)} ms`);
    lines.push(`  Warm P50 (Median):      ${warmBenchmark.p50LatencyMs.toFixed(2)} ms`);
    lines.push(`  Throughput (Warm):      ${warmBenchmark.throughputRps} req/sec`);
    lines.push(`  Speedup Factor:         ${comparison.speedupRatio}x`);
    lines.push(`  Latency Reduction:      ${comparison.latencyReductionPct}%`);
  }

  lines.push('=============================================================================');
  return lines.join('\n');
}

export default {
  formatJsonReport,
  formatCliSummary,
};
