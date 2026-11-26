/**
 * Predefined benchmark scenarios for HookForge.
 *
 * Targets actual HookForge routes:
 * - /health (unauthenticated, Redis & Postgres observability)
 * - /api/v1/endpoints (Redis cached endpoint list, TTL 300s)
 * - /api/v1/metrics/overview (Redis cached analytics, TTL 60s)
 * - Rate limiting evaluation & burst probe
 * - Cold vs Warm cache performance comparison
 */

import { BenchmarkEngine } from './engine.js';

export const SCENARIO_NAMES = {
  HEALTH: 'health',
  ENDPOINTS_LIST: 'endpoints_list',
  ANALYTICS_OVERVIEW: 'analytics_overview',
  RATE_LIMIT_PROBE: 'rate_limit_probe',
  COLD_VS_WARM: 'cold_vs_warm_cache',
};

/**
 * Run a benchmark scenario by name.
 *
 * @param {string} scenarioName
 * @param {Object} [overrides]
 * @returns {Promise<Object>}
 */
export async function runScenario(scenarioName, overrides = {}) {
  const apiKey = overrides.apiKey || process.env.BENCHMARK_API_KEY || '';
  const defaultHeaders = apiKey ? { 'X-API-Key': apiKey } : {};

  switch (scenarioName) {
    case SCENARIO_NAMES.HEALTH: {
      const engine = new BenchmarkEngine({
        path: '/health',
        method: 'GET',
        requests: overrides.requests || 50,
        concurrency: overrides.concurrency || 5,
        ...overrides,
      });
      const result = await engine.run();
      return {
        scenario: SCENARIO_NAMES.HEALTH,
        description: 'Health check endpoint latency and throughput (DB + Redis connectivity)',
        ...result,
      };
    }

    case SCENARIO_NAMES.ENDPOINTS_LIST: {
      const engine = new BenchmarkEngine({
        path: overrides.path || '/endpoints',
        method: 'GET',
        headers: { ...defaultHeaders, ...overrides.headers },
        requests: overrides.requests || 50,
        concurrency: overrides.concurrency || 5,
        ...overrides,
      });
      const result = await engine.run();
      return {
        scenario: SCENARIO_NAMES.ENDPOINTS_LIST,
        description: 'Tenant endpoints listing endpoint (Redis cache-enabled, 300s TTL)',
        ...result,
      };
    }

    case SCENARIO_NAMES.ANALYTICS_OVERVIEW: {
      const engine = new BenchmarkEngine({
        path: overrides.path || '/metrics/overview',
        method: 'GET',
        headers: { ...defaultHeaders, ...overrides.headers },
        requests: overrides.requests || 50,
        concurrency: overrides.concurrency || 5,
        ...overrides,
      });
      const result = await engine.run();
      return {
        scenario: SCENARIO_NAMES.ANALYTICS_OVERVIEW,
        description: 'Analytics overview endpoint (Redis cache-enabled, 60s TTL)',
        ...result,
      };
    }

    case SCENARIO_NAMES.RATE_LIMIT_PROBE: {
      // Intentionally exceeds health rate limit (default 30/min) to evaluate limiter behavior
      const engine = new BenchmarkEngine({
        path: '/health',
        method: 'GET',
        requests: overrides.requests || 45,
        concurrency: overrides.concurrency || 10,
        ...overrides,
      });
      const result = await engine.run();
      return {
        scenario: SCENARIO_NAMES.RATE_LIMIT_PROBE,
        description: 'Rate limiting burst evaluation measuring HTTP 429 throttling & latency under load',
        ...result,
      };
    }

    case SCENARIO_NAMES.COLD_VS_WARM: {
      return runColdVsWarmComparison(overrides);
    }

    default:
      throw new Error(
        `Unknown benchmark scenario: "${scenarioName}". Available scenarios: ${Object.values(SCENARIO_NAMES).join(', ')}`
      );
  }
}

/**
 * Compare cold cache latency against warm cache performance.
 *
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function runColdVsWarmComparison(options = {}) {
  const path = options.path || '/health';
  const apiKey = options.apiKey || process.env.BENCHMARK_API_KEY || '';
  const headers = apiKey ? { 'X-API-Key': apiKey, ...options.headers } : { ...options.headers };

  // Step 1: Cold request (single probe)
  const coldEngine = new BenchmarkEngine({
    path,
    requests: 1,
    concurrency: 1,
    headers,
    ...options,
  });
  const coldResult = await coldEngine.run();
  const coldLatencyMs = coldResult.stats.latencies.avgMs || 0;

  // Step 2: Warm requests (concurrent repeated probes against populated cache)
  const warmRequests = options.requests || 30;
  const warmEngine = new BenchmarkEngine({
    path,
    requests: warmRequests,
    concurrency: options.concurrency || 5,
    headers,
    ...options,
  });
  const warmResult = await warmEngine.run();
  const warmAvgMs = warmResult.stats.latencies.avgMs || 0;
  const warmP50Ms = warmResult.stats.latencies.p50Ms || 0;

  const speedupRatio = warmAvgMs > 0 ? Math.round((coldLatencyMs / warmAvgMs) * 100) / 100 : 1;

  return {
    scenario: SCENARIO_NAMES.COLD_VS_WARM,
    description: `Cold vs Warm Cache comparison for ${path}`,
    timestamp: new Date().toISOString(),
    target: coldResult.target,
    stats: warmResult.stats,
    coldRequest: {
      latencyMs: coldLatencyMs,
      statusCode: coldResult.sampleResults[0]?.statusCode || null,
      success: coldResult.sampleResults[0]?.success || false,
    },
    warmBenchmark: {
      requests: warmRequests,
      concurrency: options.concurrency || 5,
      avgLatencyMs: warmAvgMs,
      p50LatencyMs: warmP50Ms,
      p95LatencyMs: warmResult.stats.latencies.p95Ms,
      throughputRps: warmResult.stats.throughputRps,
      statusDistribution: warmResult.stats.statusDistribution,
    },
    comparison: {
      coldLatencyMs,
      warmAvgLatencyMs: warmAvgMs,
      speedupRatio,
      latencyReductionPct: coldLatencyMs > 0 ? Math.round(((coldLatencyMs - warmAvgMs) / coldLatencyMs) * 10000) / 100 : 0,
    },
  };
}

export default {
  SCENARIO_NAMES,
  runScenario,
  runColdVsWarmComparison,
};
