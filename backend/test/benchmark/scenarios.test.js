import { describe, it, expect, vi } from 'vitest';
import { runScenario, runColdVsWarmComparison, SCENARIO_NAMES } from '../../benchmark/scenarios.js';
import { BenchmarkEngine } from '../../benchmark/engine.js';

describe('Benchmark Scenarios', () => {
  it('exposes defined scenario names', () => {
    expect(SCENARIO_NAMES.HEALTH).toBe('health');
    expect(SCENARIO_NAMES.ENDPOINTS_LIST).toBe('endpoints_list');
    expect(SCENARIO_NAMES.ANALYTICS_OVERVIEW).toBe('analytics_overview');
    expect(SCENARIO_NAMES.RATE_LIMIT_PROBE).toBe('rate_limit_probe');
    expect(SCENARIO_NAMES.COLD_VS_WARM).toBe('cold_vs_warm_cache');
  });

  it('throws an error for unrecognized scenario names', async () => {
    await expect(runScenario('nonexistent_scenario')).rejects.toThrow(
      /Unknown benchmark scenario: "nonexistent_scenario"/
    );
  });

  it('runs cold vs warm cache comparison with calculated speedup ratio', async () => {
    let callCount = 0;
    vi.spyOn(BenchmarkEngine.prototype, 'run').mockImplementation(async function () {
      callCount++;
      if (callCount === 1) {
        // Cold single request
        return {
          timestamp: new Date().toISOString(),
          target: { url: 'http://127.0.0.1:8081/health', method: 'GET' },
          configuration: { requests: 1, concurrency: 1 },
          stats: {
            totalRequests: 1,
            successfulRequests: 1,
            latencies: { avgMs: 50, p50Ms: 50 },
            throughputRps: 20,
            statusDistribution: { '200': 1 },
          },
          sampleResults: [{ latencyMs: 50, statusCode: 200, success: true }],
        };
      }
      // Warm repeated requests
      return {
        timestamp: new Date().toISOString(),
        target: { url: 'http://127.0.0.1:8081/health', method: 'GET' },
        configuration: { requests: 10, concurrency: 2 },
        stats: {
          totalRequests: 10,
          successfulRequests: 10,
          latencies: { avgMs: 5, p50Ms: 4.5, p95Ms: 8 },
          throughputRps: 200,
          statusDistribution: { '200': 10 },
        },
        sampleResults: [{ latencyMs: 5, statusCode: 200, success: true }],
      };
    });

    const result = await runColdVsWarmComparison({
      path: '/health',
      requests: 10,
      concurrency: 2,
    });

    expect(result.scenario).toBe(SCENARIO_NAMES.COLD_VS_WARM);
    expect(result.coldRequest.latencyMs).toBe(50);
    expect(result.warmBenchmark.avgLatencyMs).toBe(5);
    // Speedup: 50 / 5 = 10x
    expect(result.comparison.speedupRatio).toBe(10);
    // Latency reduction: (50 - 5) / 50 = 90%
    expect(result.comparison.latencyReductionPct).toBe(90);

    vi.restoreAllMocks();
  });

  it('dispatches scenario with appropriate path and default headers', async () => {
    const runSpy = vi.spyOn(BenchmarkEngine.prototype, 'run').mockResolvedValue({
      timestamp: new Date().toISOString(),
      target: { url: 'http://127.0.0.1:8081/api/v1/endpoints', method: 'GET' },
      configuration: { requests: 20, concurrency: 2 },
      stats: { totalRequests: 20, successfulRequests: 20, throughputRps: 100, latencies: { avgMs: 10 } },
      sampleResults: [],
    });

    const result = await runScenario(SCENARIO_NAMES.ENDPOINTS_LIST, {
      apiKey: 'test-api-key',
      requests: 20,
      concurrency: 2,
    });

    expect(result.scenario).toBe(SCENARIO_NAMES.ENDPOINTS_LIST);
    expect(runSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
