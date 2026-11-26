import { describe, it, expect } from 'vitest';
import { calculatePercentile, calculateStats } from '../../benchmark/metrics.js';

describe('Benchmark Metrics Utilities', () => {
  describe('calculatePercentile', () => {
    it('returns 0 for empty array', () => {
      expect(calculatePercentile([], 50)).toBe(0);
      expect(calculatePercentile(null, 95)).toBe(0);
    });

    it('returns the single value when array has 1 element', () => {
      expect(calculatePercentile([42.5], 50)).toBe(42.5);
      expect(calculatePercentile([42.5], 99)).toBe(42.5);
      expect(calculatePercentile([42.5], 0)).toBe(42.5);
    });

    it('correctly calculates min (P0) and max (P100)', () => {
      const data = [10, 20, 30, 40, 50];
      expect(calculatePercentile(data, 0)).toBe(10);
      expect(calculatePercentile(data, 100)).toBe(50);
    });

    it('computes exact median (P50) for odd number of items', () => {
      const data = [10, 20, 30, 40, 50];
      expect(calculatePercentile(data, 50)).toBe(30);
    });

    it('computes interpolated median (P50) for even number of items', () => {
      const data = [10, 20, 30, 40];
      // Index for 50% in array of length 4: 0.5 * 3 = 1.5 -> midpoint between 20 and 30 = 25
      expect(calculatePercentile(data, 50)).toBe(25);
    });

    it('accurately computes P90, P95, and P99 percentiles with linear interpolation', () => {
      // 100 samples from 1 to 100
      const samples = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(calculatePercentile(samples, 50)).toBe(50.5);
      expect(calculatePercentile(samples, 90)).toBe(90.1);
      expect(calculatePercentile(samples, 95)).toBe(95.05);
      expect(calculatePercentile(samples, 99)).toBe(99.01);
    });

    it('clamps negative percentiles to 0 and >100 to 100', () => {
      const data = [5, 10, 15];
      expect(calculatePercentile(data, -10)).toBe(5);
      expect(calculatePercentile(data, 150)).toBe(15);
    });
  });

  describe('calculateStats', () => {
    it('handles empty results array gracefully', () => {
      const stats = calculateStats([], 1000);
      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
      expect(stats.throughputRps).toBe(0);
      expect(stats.latencies.avgMs).toBe(0);
      expect(stats.latencies.p50Ms).toBe(0);
    });

    it('aggregates successful, failed, and throttled requests', () => {
      const results = [
        { latencyMs: 10, statusCode: 200, success: true },
        { latencyMs: 20, statusCode: 200, success: true },
        { latencyMs: 30, statusCode: 429, success: false },
        { latencyMs: 40, statusCode: 500, success: false, error: 'InternalServerError: Database fail' },
      ];

      const stats = calculateStats(results, 500); // 500ms duration

      expect(stats.totalRequests).toBe(4);
      expect(stats.successfulRequests).toBe(2);
      expect(stats.failedRequests).toBe(2);
      expect(stats.throttledRequests).toBe(1);
      expect(stats.successRatePct).toBe(50);
      expect(stats.totalDurationMs).toBe(500);
      // Throughput: 4 requests / 0.5 sec = 8 req/sec
      expect(stats.throughputRps).toBe(8);

      expect(stats.statusDistribution).toEqual({
        '200': 2,
        '429': 1,
        '500': 1,
      });

      expect(stats.errorDistribution).toEqual({
        InternalServerError: 1,
      });

      expect(stats.latencies.minMs).toBe(10);
      expect(stats.latencies.maxMs).toBe(40);
      expect(stats.latencies.avgMs).toBe(25);
      expect(stats.latencies.p50Ms).toBe(25);
    });

    it('filters invalid or missing latencies cleanly', () => {
      const results = [
        { latencyMs: -5, statusCode: 200, success: true },
        { latencyMs: NaN, statusCode: 200, success: true },
        { latencyMs: 15, statusCode: 200, success: true },
      ];

      const stats = calculateStats(results, 1000);
      expect(stats.totalRequests).toBe(3);
      expect(stats.latencies.minMs).toBe(0);
      expect(stats.latencies.maxMs).toBe(15);
    });
  });
});
