import { describe, it, expect } from 'vitest';
import { formatJsonReport, formatCliSummary } from '../../benchmark/reporter.js';

describe('Benchmark Reporter & Sensitive Data Redaction', () => {
  const sampleResult = {
    scenario: 'health',
    description: 'Health check probe',
    timestamp: '2026-11-26T12:00:00.000Z',
    target: {
      url: 'http://127.0.0.1:8081/health',
      path: '/health',
      method: 'GET',
      headers: {
        'x-api-key': 'whkey_supersecrettoken',
        'authorization': 'Bearer myjwttoken',
        'accept': 'application/json',
      },
    },
    configuration: {
      requests: 50,
      concurrency: 5,
    },
    stats: {
      totalRequests: 50,
      successfulRequests: 48,
      failedRequests: 2,
      throttledRequests: 1,
      successRatePct: 96,
      totalDurationMs: 250.5,
      throughputRps: 199.6,
      latencies: {
        minMs: 2.1,
        avgMs: 5.4,
        p50Ms: 4.8,
        p90Ms: 8.2,
        p95Ms: 10.5,
        p99Ms: 14.1,
        maxMs: 18.2,
      },
      statusDistribution: {
        '200': 48,
        '429': 1,
        '500': 1,
      },
      errorDistribution: {
        InternalServerError: 1,
      },
    },
  };

  it('redacts sensitive headers in formatJsonReport', () => {
    const jsonStr = formatJsonReport(sampleResult);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.target.headers['x-api-key']).toBe('[REDACTED]');
    expect(parsed.target.headers['authorization']).toBe('[REDACTED]');
    expect(parsed.target.headers['accept']).toBe('application/json');
    expect(jsonStr).not.toContain('whkey_supersecrettoken');
    expect(jsonStr).not.toContain('myjwttoken');
  });

  it('formats human-readable CLI summary table with percentiles and throughput', () => {
    const summary = formatCliSummary(sampleResult);

    expect(summary).toContain('HOOKFORGE PERFORMANCE BENCHMARK');
    expect(summary).toContain('Scenario:      HEALTH');
    expect(summary).toContain('Target URL:    GET http://127.0.0.1:8081/health');
    expect(summary).toContain('Total Requests:      50');
    expect(summary).toContain('Throughput:          199.6 req/sec');
    expect(summary).toContain('Success Rate:        96% (48 / 50)');
    expect(summary).toContain('Rate Limited (429):  1 requests');
    expect(summary).toContain('Min:      2.10 ms');
    expect(summary).toContain('P50:      4.80 ms');
    expect(summary).toContain('P95:      10.50 ms');
    expect(summary).toContain('P99:      14.10 ms');
    expect(summary).toContain('HTTP 200:   48 (96%)');
  });

  it('formats cold vs warm cache comparison section', () => {
    const comparisonResult = {
      scenario: 'cold_vs_warm_cache',
      description: 'Cold vs warm cache comparison',
      timestamp: '2026-11-26T12:00:00.000Z',
      target: { url: 'http://127.0.0.1:8081/api/v1/endpoints' },
      coldRequest: {
        latencyMs: 45.2,
        statusCode: 200,
        success: true,
      },
      warmBenchmark: {
        requests: 50,
        concurrency: 5,
        avgLatencyMs: 4.5,
        p50LatencyMs: 3.8,
        p95LatencyMs: 7.2,
        throughputRps: 220,
        statusDistribution: { '200': 50 },
      },
      comparison: {
        coldLatencyMs: 45.2,
        warmAvgLatencyMs: 4.5,
        speedupRatio: 10.04,
        latencyReductionPct: 90.04,
      },
    };

    const summary = formatCliSummary(comparisonResult);
    expect(summary).toContain('COLD VS WARM CACHE COMPARISON');
    expect(summary).toContain('Cold Request Latency:   45.20 ms');
    expect(summary).toContain('Warm Avg Latency:       4.50 ms');
    expect(summary).toContain('Speedup Factor:         10.04x');
    expect(summary).toContain('Latency Reduction:      90.04%');
  });
});
