/**
 * Unit tests for MetricsService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/jdbc/metricsRepository.js', () => ({
  default: {
    getOverview: vi.fn(),
    getTimeSeries: vi.fn(),
    getStatusDistribution: vi.fn(),
  },
}));

describe('MetricsService', () => {
  let metricsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    metricsService = (await import('../../src/services/metrics/metricsService.js')).default;
  });

  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';

  it('should return overview metrics for tenant without filters', async () => {
    const metricsRepository = (await import('../../src/repositories/jdbc/metricsRepository.js')).default;
    const mockOverview = {
      totalEvents: 42,
      totalDeliveries: 100,
      succeededDeliveries: 95,
      failedDeliveries: 3,
      pendingDeliveries: 2,
      successRate: 95.0,
      averageLatencyMs: 52,
      activeEndpoints: 4,
      totalEndpoints: 5,
      openCircuits: 0,
    };
    metricsRepository.getOverview.mockResolvedValue(mockOverview);

    const result = await metricsService.getOverview(mockTenantId);

    expect(metricsRepository.getOverview).toHaveBeenCalledWith(mockTenantId);
    expect(result).toEqual(mockOverview);
    expect(result.averageLatencyMs).toBe(52);
  });

  it('should pass date filters to overview metrics when provided', async () => {
    const metricsRepository = (await import('../../src/repositories/jdbc/metricsRepository.js')).default;
    metricsRepository.getOverview.mockResolvedValue({ totalDeliveries: 10 });

    const filters = { range: '7d', created_after: '2026-11-09T00:00:00.000Z' };
    await metricsService.getOverview(mockTenantId, filters);

    expect(metricsRepository.getOverview).toHaveBeenCalledWith(mockTenantId, filters);
  });

  it('should return time-series metrics for tenant', async () => {
    const metricsRepository = (await import('../../src/repositories/jdbc/metricsRepository.js')).default;
    const mockTimeSeries = [
      { timestamp: '12:00', label: '12 PM', total: 10, succeeded: 9, failed: 1, pending: 0 },
    ];
    metricsRepository.getTimeSeries.mockResolvedValue(mockTimeSeries);

    const result = await metricsService.getTimeSeries(mockTenantId);

    expect(metricsRepository.getTimeSeries).toHaveBeenCalledWith(mockTenantId);
    expect(result).toEqual(mockTimeSeries);
  });

  it('should pass date filters to time-series metrics when provided', async () => {
    const metricsRepository = (await import('../../src/repositories/jdbc/metricsRepository.js')).default;
    metricsRepository.getTimeSeries.mockResolvedValue([]);

    const filters = { range: '24h' };
    await metricsService.getTimeSeries(mockTenantId, filters);

    expect(metricsRepository.getTimeSeries).toHaveBeenCalledWith(mockTenantId, filters);
  });

  it('should return status distribution for tenant', async () => {
    const metricsRepository = (await import('../../src/repositories/jdbc/metricsRepository.js')).default;
    const mockDistribution = [
      { name: 'Succeeded', value: 95, color: '#10b981' },
    ];
    metricsRepository.getStatusDistribution.mockResolvedValue(mockDistribution);

    const result = await metricsService.getStatusDistribution(mockTenantId);

    expect(metricsRepository.getStatusDistribution).toHaveBeenCalledWith(mockTenantId);
    expect(result).toEqual(mockDistribution);
  });

  it('should pass date filters to status distribution when provided', async () => {
    const metricsRepository = (await import('../../src/repositories/jdbc/metricsRepository.js')).default;
    metricsRepository.getStatusDistribution.mockResolvedValue([]);

    const filters = { created_after: '2026-11-01T00:00:00.000Z' };
    await metricsService.getStatusDistribution(mockTenantId, filters);

    expect(metricsRepository.getStatusDistribution).toHaveBeenCalledWith(mockTenantId, filters);
  });
});
