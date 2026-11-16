/**
 * Tests for JdbcMetricsRepository.
 * Verifies tenant isolation, date boundary filtering, and gap-filling for empty periods.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import metricsRepository from '../../src/repositories/jdbc/metricsRepository.js';
import { query } from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}));

describe('JdbcMetricsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const tenantId = '018f23a1-9a72-7c89-a21b-4395018e69d1';

  describe('getOverview', () => {
    it('should query events, deliveries, latency, and endpoints with tenant isolation', async () => {
      // Mock queries: events, deliveries, latency, endpoints
      query
        .mockResolvedValueOnce({ rows: [{ count: 15 }] }) // events
        .mockResolvedValueOnce({ rows: [{ total: 25, succeeded: 23, failed: 1, pending: 1 }] }) // deliveries
        .mockResolvedValueOnce({ rows: [{ avg_latency: 55 }] }) // latency
        .mockResolvedValueOnce({ rows: [{ total: 3, active: 3, open_circuits: 0 }] }); // endpoints

      const result = await metricsRepository.getOverview(tenantId);

      expect(query).toHaveBeenCalledTimes(4);
      // Check tenant isolation on every query
      expect(query.mock.calls[0][1][0]).toBe(tenantId);
      expect(query.mock.calls[1][1][0]).toBe(tenantId);
      expect(query.mock.calls[2][1][0]).toBe(tenantId);
      expect(query.mock.calls[3][1][0]).toBe(tenantId);

      expect(result.totalEvents).toBe(15);
      expect(result.totalDeliveries).toBe(25);
      expect(result.succeededDeliveries).toBe(23);
      expect(result.failedDeliveries).toBe(1);
      expect(result.pendingDeliveries).toBe(1);
      expect(result.successRate).toBe(92.0);
      expect(result.averageLatencyMs).toBe(55);
      expect(result.totalEndpoints).toBe(3);
    });

    it('should append date boundary parameters when filters are provided', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })
        .mockResolvedValueOnce({ rows: [{ total: 10, succeeded: 10, failed: 0, pending: 0 }] })
        .mockResolvedValueOnce({ rows: [{ avg_latency: 35 }] })
        .mockResolvedValueOnce({ rows: [{ total: 2, active: 2, open_circuits: 0 }] });

      const filters = {
        created_after: '2026-11-01T00:00:00.000Z',
        created_before: '2026-11-15T23:59:59.999Z',
      };

      await metricsRepository.getOverview(tenantId, filters);

      // Verify events query includes date boundaries
      expect(query.mock.calls[0][0]).toContain('created_at >= $2');
      expect(query.mock.calls[0][0]).toContain('created_at <= $3');
      expect(query.mock.calls[0][1]).toEqual([tenantId, filters.created_after, filters.created_before]);

      // Verify deliveries query includes date boundaries with endpoint tenant join
      expect(query.mock.calls[1][0]).toContain('d.created_at >= $2');
      expect(query.mock.calls[1][0]).toContain('d.created_at <= $3');
      expect(query.mock.calls[1][1]).toEqual([tenantId, filters.created_after, filters.created_before]);
    });

    it('should return genuine zero metrics when no deliveries exist in range', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ total: 0, succeeded: 0, failed: 0, pending: 0 }] })
        .mockResolvedValueOnce({ rows: [{ avg_latency: 0 }] })
        .mockResolvedValueOnce({ rows: [{ total: 1, active: 1, open_circuits: 0 }] });

      const result = await metricsRepository.getOverview(tenantId, { range: '24h' });

      expect(result.totalDeliveries).toBe(0);
      expect(result.succeededDeliveries).toBe(0);
      expect(result.failedDeliveries).toBe(0);
      expect(result.averageLatencyMs).toBe(0);
      expect(result.successRate).toBe(100);
    });
  });

  describe('getStatusDistribution', () => {
    it('should aggregate delivery status counts with tenant isolation', async () => {
      query.mockResolvedValueOnce({
        rows: [
          { state: 'SUCCEEDED', count: 50 },
          { state: 'DEAD', count: 2 },
          { state: 'RETRYING', count: 1 },
        ],
      });

      const result = await metricsRepository.getStatusDistribution(tenantId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('ep.tenant_id = $1'),
        [tenantId]
      );
      expect(result).toEqual([
        { name: 'Succeeded', value: 50, color: '#10b981' },
        { name: 'Retrying', value: 1, color: '#f59e0b' },
        { name: 'Dead Letter', value: 2, color: '#ef4444' },
        { name: 'In Flight', value: 0, color: '#6366f1' },
        { name: 'Pending', value: 0, color: '#3b82f6' },
      ]);
    });
  });

  describe('getTimeSeries', () => {
    it('should generate 24 hourly buckets and fill empty periods with genuine 0s', async () => {
      const now = new Date('2026-11-16T12:00:00.000Z');
      const start = new Date(now.getTime() - 24 * 3600000);

      // Suppose DB returns activity for only 1 hour
      query.mockResolvedValueOnce({
        rows: [
          {
            bucket_time: '2026-11-16T10:00:00.000Z',
            total: 10,
            succeeded: 9,
            failed: 1,
            pending: 0,
          },
        ],
      });

      const result = await metricsRepository.getTimeSeries(tenantId, {
        created_after: start.toISOString(),
        created_before: now.toISOString(),
      });

      expect(result).toHaveLength(24);
      // The 10 AM bucket should have data
      const matched = result.find((b) => b.label === '10 AM');
      expect(matched).toBeDefined();
      expect(matched?.total).toBe(10);
      expect(matched?.succeeded).toBe(9);

      // Other buckets should display 0 accurately
      const zeroBucket = result.find((b) => b.label === '2 AM');
      expect(zeroBucket).toBeDefined();
      expect(zeroBucket?.total).toBe(0);
      expect(zeroBucket?.succeeded).toBe(0);
    });

    it('should generate daily buckets for 7d range', async () => {
      const now = new Date('2026-11-16T12:00:00.000Z');
      const start = new Date(now.getTime() - 7 * 86400000);

      query.mockResolvedValueOnce({
        rows: [
          {
            bucket_time: '2026-11-15T00:00:00.000Z',
            total: 42,
            succeeded: 40,
            failed: 2,
            pending: 0,
          },
        ],
      });

      const result = await metricsRepository.getTimeSeries(tenantId, {
        created_after: start.toISOString(),
        created_before: now.toISOString(),
        range: '7d',
      });

      expect(result.length).toBeGreaterThanOrEqual(7);
      expect(result[0]).toHaveProperty('label');
      expect(result[0]).toHaveProperty('timestamp');
      expect(result[0]).toHaveProperty('total');
    });
  });
});
