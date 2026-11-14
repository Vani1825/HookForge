/**
 * Tests for JdbcAnalyticsRepository.
 * Validates aggregation queries, formulas, zero-data safety, and tenant isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import analyticsRepository from '../../src/repositories/jdbc/analyticsRepository.js';
import { query } from '../../src/config/database.js';

// Mock database
vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

describe('JdbcAnalyticsRepository', () => {
  const mockTenantId = '9dab7ae1-7999-4e0d-a2f9-c47fcfda7b4c';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOverviewMetrics', () => {
    it('should aggregate metrics with accurate calculations and success rate', async () => {
      // 1. events
      query.mockResolvedValueOnce({ rows: [{ count: '10' }] });
      // 2. deliveries by state
      query.mockResolvedValueOnce({
        rows: [
          { state: 'SUCCEEDED', count: '8' },
          { state: 'DEAD', count: '1' },
          { state: 'RETRYING', count: '1' },
          { state: 'PENDING', count: '2' },
        ],
      });
      // 3. average latency
      query.mockResolvedValueOnce({ rows: [{ avg_latency: '52' }] });
      // 4. endpoints
      query.mockResolvedValueOnce({
        rows: [{ total_endpoints: '3', active_endpoints: '2', open_circuits: '1' }],
      });

      const metrics = await analyticsRepository.getOverviewMetrics(mockTenantId);

      expect(metrics.totalEvents).toBe(10);
      expect(metrics.totalDeliveries).toBe(12); // 8 + 1 + 1 + 2
      expect(metrics.succeededDeliveries).toBe(8);
      expect(metrics.failedDeliveries).toBe(1);
      expect(metrics.deadLetterDeliveries).toBe(1);
      expect(metrics.pendingDeliveries).toBe(3); // 2 pending + 1 retrying
      expect(metrics.retryingDeliveries).toBe(1);
      // Success rate: (8 / 12) * 100 = 66.666... -> 66.7
      expect(metrics.successRate).toBe(66.7);
      expect(metrics.averageLatencyMs).toBe(52);
      expect(metrics.totalEndpoints).toBe(3);
      expect(metrics.activeEndpoints).toBe(2);
      expect(metrics.openCircuits).toBe(1);

      // Verify tenant isolation in all queries
      expect(query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('WHERE tenant_id = $1'),
        expect.arrayContaining([mockTenantId])
      );
      expect(query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('WHERE ep.tenant_id = $1'),
        expect.arrayContaining([mockTenantId])
      );
      expect(query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('WHERE ep.tenant_id = $1'),
        expect.arrayContaining([mockTenantId])
      );
      expect(query).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('WHERE tenant_id = $1'),
        expect.arrayContaining([mockTenantId])
      );
    });

    it('should handle zero-event and empty database scenarios gracefully (no NaN)', async () => {
      // 1. events
      query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      // 2. deliveries
      query.mockResolvedValueOnce({ rows: [] });
      // 3. latency
      query.mockResolvedValueOnce({ rows: [{ avg_latency: '0' }] });
      // 4. endpoints
      query.mockResolvedValueOnce({
        rows: [{ total_endpoints: '0', active_endpoints: '0', open_circuits: '0' }],
      });

      const metrics = await analyticsRepository.getOverviewMetrics(mockTenantId);

      expect(metrics.totalEvents).toBe(0);
      expect(metrics.totalDeliveries).toBe(0);
      expect(metrics.succeededDeliveries).toBe(0);
      expect(metrics.failedDeliveries).toBe(0);
      expect(metrics.pendingDeliveries).toBe(0);
      expect(metrics.retryingDeliveries).toBe(0);
      expect(metrics.deadLetterDeliveries).toBe(0);
      expect(metrics.successRate).toBe(100.0); // Baseline, not NaN!
      expect(metrics.averageLatencyMs).toBe(0);
      expect(metrics.totalEndpoints).toBe(0);
      expect(metrics.activeEndpoints).toBe(0);
      expect(metrics.openCircuits).toBe(0);
    });
  });

  describe('getTimeSeriesMetrics', () => {
    it('should query hourly time series and format outputs', async () => {
      const mockTime = new Date('2026-11-06T12:00:00.000Z');
      query.mockResolvedValueOnce({
        rows: [
          {
            timestamp: mockTime,
            label: '12:00',
            total: 10,
            succeeded: 8,
            failed: 1,
            pending: 1,
          },
        ],
      });

      const start = new Date('2026-11-05T12:00:00.000Z');
      const end = new Date('2026-11-06T12:00:00.000Z');

      const series = await analyticsRepository.getTimeSeriesMetrics(mockTenantId, {
        startDate: start,
        endDate: end,
        interval: 'hour',
      });

      expect(series).toHaveLength(1);
      expect(series[0]).toEqual({
        timestamp: mockTime.toISOString(),
        label: '12:00',
        total: 10,
        succeeded: 8,
        failed: 1,
        pending: 1,
      });

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("date_trunc('hour'"),
        [mockTenantId, start, end]
      );
    });

    it('should query daily time series for 7d/30d intervals', async () => {
      const mockTime = new Date('2026-11-06T00:00:00.000Z');
      query.mockResolvedValueOnce({
        rows: [
          {
            timestamp: mockTime,
            label: 'Nov 06',
            total: 25,
            succeeded: 24,
            failed: 1,
            pending: 0,
          },
        ],
      });

      const start = new Date('2026-10-31T00:00:00.000Z');
      const end = new Date('2026-11-06T00:00:00.000Z');

      const series = await analyticsRepository.getTimeSeriesMetrics(mockTenantId, {
        startDate: start,
        endDate: end,
        interval: 'day',
      });

      expect(series).toHaveLength(1);
      expect(series[0].label).toBe('Nov 06');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("date_trunc('day'"),
        [mockTenantId, start, end]
      );
    });
  });

  describe('getStatusDistribution', () => {
    it('should map deliveries counts into complete 5-category chart distribution', async () => {
      query.mockResolvedValueOnce({
        rows: [
          { state: 'SUCCEEDED', count: '15' },
          { state: 'DEAD', count: '3' },
        ],
      });

      const distribution = await analyticsRepository.getStatusDistribution(mockTenantId);

      expect(distribution).toEqual([
        { name: 'Succeeded', value: 15, color: '#10b981' },
        { name: 'Retrying', value: 0, color: '#f59e0b' },
        { name: 'Dead Letter', value: 3, color: '#ef4444' },
        { name: 'In Flight', value: 0, color: '#6366f1' },
        { name: 'Pending', value: 0, color: '#3b82f6' },
      ]);
    });
  });

  describe('getEndpointBreakdown', () => {
    it('should map per-endpoint statistics', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 'ep-1',
            url: 'https://api.test.com/hook',
            circuit_state: 'CLOSED',
            consecutive_failures: 0,
            rate_limit_rps: 20,
            total_deliveries: '50',
            succeeded_deliveries: '48',
            failed_deliveries: '2',
            average_latency_ms: '64',
          },
        ],
      });

      const result = await analyticsRepository.getEndpointBreakdown(mockTenantId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ep-1');
      expect(result[0].totalDeliveries).toBe(50);
      expect(result[0].successRate).toBe(96.0); // (48 / 50) * 100
      expect(result[0].averageLatencyMs).toBe(64);
    });

    it('should prevent join fan-out using separate pre-aggregated delivery_stats and attempt_stats CTEs', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      await analyticsRepository.getEndpointBreakdown(mockTenantId);

      const executedSql = query.mock.calls[0][0];

      // Verifies separate CTEs exist
      expect(executedSql).toContain('WITH delivery_stats AS');
      expect(executedSql).toContain('attempt_stats AS');

      // Verifies delivery_stats groups by d.endpoint_id without joining delivery_attempts
      const deliveryStatsCte = executedSql.substring(
        executedSql.indexOf('WITH delivery_stats AS'),
        executedSql.indexOf('attempt_stats AS')
      );
      expect(deliveryStatsCte).not.toContain('delivery_attempts');
      expect(deliveryStatsCte).toContain('COUNT(*)::bigint AS total_deliveries');
      expect(deliveryStatsCte).toContain('WHERE ep.tenant_id = $1');

      // Verifies attempt_stats calculates AVG(a.latency_ms) separately
      const attemptStatsCte = executedSql.substring(
        executedSql.indexOf('attempt_stats AS'),
        executedSql.indexOf('SELECT\n        ep.id')
      );
      expect(attemptStatsCte).toContain('delivery_attempts a');
      expect(attemptStatsCte).toContain('COALESCE(ROUND(AVG(a.latency_ms)), 0)::bigint AS average_latency_ms');

      // Verifies outer query joins pre-aggregated CTEs using LEFT JOIN and COALESCE
      expect(executedSql).toContain('LEFT JOIN delivery_stats ds ON ds.endpoint_id = ep.id');
      expect(executedSql).toContain('LEFT JOIN attempt_stats ast ON ast.endpoint_id = ep.id');
      expect(executedSql).toContain('COALESCE(ds.total_deliveries, 0)::bigint AS total_deliveries');
      expect(query.mock.calls[0][1]).toEqual([mockTenantId]);
    });

    it('should handle zero-delivery and zero-attempt endpoints with clean baseline values', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 'ep-empty',
            url: 'https://api.test.com/idle',
            circuit_state: 'CLOSED',
            consecutive_failures: 0,
            rate_limit_rps: 10,
            total_deliveries: '0',
            succeeded_deliveries: '0',
            failed_deliveries: '0',
            average_latency_ms: '0',
          },
        ],
      });

      const result = await analyticsRepository.getEndpointBreakdown(mockTenantId);

      expect(result).toHaveLength(1);
      expect(result[0].totalDeliveries).toBe(0);
      expect(result[0].succeededDeliveries).toBe(0);
      expect(result[0].failedDeliveries).toBe(0);
      expect(result[0].averageLatencyMs).toBe(0);
      expect(result[0].successRate).toBe(100.0); // Baseline, not NaN or 0
    });
  });
});

