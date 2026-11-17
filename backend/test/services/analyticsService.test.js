/**
 * Unit tests for AnalyticsService.
 * Tests KPI calculations, date boundaries, zero states, and tenant isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/jdbc/analyticsRepository.js', () => ({
  default: {
    getOverviewMetrics: vi.fn(),
    getTimeSeriesMetrics: vi.fn(),
    getStatusDistribution: vi.fn(),
    getEndpointBreakdown: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AnalyticsService', () => {
  let analyticsService;
  let analyticsRepository;

  const mockTenantId = '9dab7ae1-7999-4e0d-a2f9-c47fcfda7b4c';
  const otherTenantId = 'a1771db1-f635-4c08-933c-b08d6049b176';

  beforeEach(async () => {
    vi.clearAllMocks();
    analyticsService = (await import('../../src/services/analytics/analyticsService.js')).default;
    analyticsRepository = (await import('../../src/repositories/jdbc/analyticsRepository.js')).default;
  });

  describe('resolveDateRange', () => {
    it('should resolve "24h" to hourly interval over past 24 hours', () => {
      const res = analyticsService.resolveDateRange({ range: '24h' });
      expect(res.interval).toBe('hour');
      expect(res.startDate).toBeInstanceOf(Date);
      expect(res.endDate).toBeInstanceOf(Date);
      const diffHours = (res.endDate.getTime() - res.startDate.getTime()) / (1000 * 60 * 60);
      expect(Math.round(diffHours)).toBe(23);
    });

    it('should resolve "7d" to daily interval over past 7 days', () => {
      const res = analyticsService.resolveDateRange({ range: '7d' });
      expect(res.interval).toBe('day');
      const diffDays = (res.endDate.getTime() - res.startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(Math.round(diffDays)).toBe(6);
    });

    it('should resolve "30d" to daily interval over past 30 days', () => {
      const res = analyticsService.resolveDateRange({ range: '30d' });
      expect(res.interval).toBe('day');
      const diffDays = (res.endDate.getTime() - res.startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(Math.round(diffDays)).toBe(29);
    });

    it('should handle custom ISO startDate and endDate', () => {
      const start = '2026-11-01T00:00:00.000Z';
      const end = '2026-11-02T12:00:00.000Z';
      const res = analyticsService.resolveDateRange({ startDate: start, endDate: end });
      expect(res.startDate.toISOString()).toBe(start);
      expect(res.endDate.toISOString()).toBe(end);
      expect(res.interval).toBe('hour'); // <= 48h
    });

    it('should throw when startDate is after endDate', () => {
      expect(() => {
        analyticsService.resolveDateRange({
          startDate: '2026-11-05T00:00:00.000Z',
          endDate: '2026-11-01T00:00:00.000Z',
        });
      }).toThrow('startDate must be before or equal to endDate');
    });

    it('should throw on invalid date string', () => {
      expect(() => {
        analyticsService.resolveDateRange({ startDate: 'not-a-date' });
      }).toThrow('Invalid startDate format');
    });
  });

  describe('getOverviewMetrics', () => {
    it('should return calculated overview metrics for tenant', async () => {
      const mockResult = {
        totalEvents: 10,
        totalDeliveries: 10,
        succeededDeliveries: 9,
        failedDeliveries: 1,
        pendingDeliveries: 0,
        retryingDeliveries: 0,
        deadLetterDeliveries: 1,
        successRate: 90.0,
        averageLatencyMs: 45,
        activeEndpoints: 2,
        totalEndpoints: 2,
        openCircuits: 0,
      };

      analyticsRepository.getOverviewMetrics.mockResolvedValue(mockResult);

      const metrics = await analyticsService.getOverviewMetrics(mockTenantId);

      expect(metrics).toEqual(mockResult);
      expect(analyticsRepository.getOverviewMetrics).toHaveBeenCalledWith(mockTenantId, {
        startDate: null,
        endDate: null,
      });
    });

    it('should pass date range parameters when range is provided', async () => {
      analyticsRepository.getOverviewMetrics.mockResolvedValue({});

      await analyticsService.getOverviewMetrics(mockTenantId, { range: '7d' });

      expect(analyticsRepository.getOverviewMetrics).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          startDate: expect.any(Date),
          endDate: expect.any(Date),
        })
      );
    });

    it('should throw when tenantId is missing', async () => {
      await expect(analyticsService.getOverviewMetrics(null)).rejects.toThrow('tenantId is required');
    });

    it('should enforce tenant isolation (calling with different tenantId passes it to repository)', async () => {
      analyticsRepository.getOverviewMetrics.mockResolvedValue({ totalEvents: 0 });

      await analyticsService.getOverviewMetrics(otherTenantId);

      expect(analyticsRepository.getOverviewMetrics).toHaveBeenCalledWith(otherTenantId, expect.any(Object));
      expect(analyticsRepository.getOverviewMetrics).not.toHaveBeenCalledWith(mockTenantId, expect.any(Object));
    });
  });

  describe('getTimeSeriesMetrics', () => {
    it('should return bucketed data points with 24h default', async () => {
      const mockTimeSeries = [
        { timestamp: '2026-11-06T00:00:00.000Z', label: '00:00', total: 5, succeeded: 5, failed: 0, pending: 0 },
        { timestamp: '2026-11-06T01:00:00.000Z', label: '01:00', total: 3, succeeded: 2, failed: 1, pending: 0 },
      ];

      analyticsRepository.getTimeSeriesMetrics.mockResolvedValue(mockTimeSeries);

      const result = await analyticsService.getTimeSeriesMetrics(mockTenantId);

      expect(result).toEqual(mockTimeSeries);
      expect(analyticsRepository.getTimeSeriesMetrics).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          interval: 'hour',
          startDate: expect.any(Date),
          endDate: expect.any(Date),
        })
      );
    });

    it('should use day interval when range is 7d or 30d', async () => {
      analyticsRepository.getTimeSeriesMetrics.mockResolvedValue([]);

      await analyticsService.getTimeSeriesMetrics(mockTenantId, { range: '7d' });

      expect(analyticsRepository.getTimeSeriesMetrics).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          interval: 'day',
        })
      );
    });
  });

  describe('getStatusDistribution', () => {
    it('should return distribution array for pie charts', async () => {
      const mockDistribution = [
        { name: 'Succeeded', value: 8, color: '#10b981' },
        { name: 'Retrying', value: 1, color: '#f59e0b' },
        { name: 'Dead Letter', value: 1, color: '#ef4444' },
        { name: 'In Flight', value: 0, color: '#6366f1' },
        { name: 'Pending', value: 0, color: '#3b82f6' },
      ];

      analyticsRepository.getStatusDistribution.mockResolvedValue(mockDistribution);

      const result = await analyticsService.getStatusDistribution(mockTenantId);

      expect(result).toEqual(mockDistribution);
      expect(analyticsRepository.getStatusDistribution).toHaveBeenCalledWith(mockTenantId, {
        startDate: null,
        endDate: null,
      });
    });
  });

  describe('getEndpointBreakdown', () => {
    it('should return per-endpoint reliability data', async () => {
      const mockEndpoints = [
        {
          id: 'endpoint-1',
          url: 'https://example.com/webhook',
          circuitState: 'CLOSED',
          totalDeliveries: 10,
          succeededDeliveries: 10,
          failedDeliveries: 0,
          successRate: 100.0,
          averageLatencyMs: 42,
        },
      ];

      analyticsRepository.getEndpointBreakdown.mockResolvedValue(mockEndpoints);

      const result = await analyticsService.getEndpointBreakdown(mockTenantId);

      expect(result).toEqual(mockEndpoints);
      expect(analyticsRepository.getEndpointBreakdown).toHaveBeenCalledWith(mockTenantId);
    });
  });
});

