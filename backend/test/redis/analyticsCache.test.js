/**
 * Tests for AnalyticsService caching and tenant isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as analyticsService from '../../src/services/analytics/analyticsService.js';
import analyticsRepository from '../../src/repositories/jdbc/analyticsRepository.js';
import cacheService from '../../src/services/cache/cacheService.js';

vi.mock('../../src/repositories/jdbc/analyticsRepository.js', () => ({
  default: {
    getOverviewMetrics: vi.fn(),
  },
}));

describe('Analytics Caching & Tenant Isolation', () => {
  const tenant1 = '11111111-1111-1111-1111-111111111111';
  const tenant2 = '22222222-2222-2222-2222-222222222222';

  const mockMetrics = {
    totalDeliveries: 1500,
    successfulDeliveries: 1450,
    failedDeliveries: 50,
    successRate: 0.9667,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches overview metrics on first call and serves from cache on subsequent call', async () => {
    analyticsRepository.getOverviewMetrics.mockResolvedValue(mockMetrics);
    vi.spyOn(cacheService, 'get').mockResolvedValueOnce(null).mockResolvedValueOnce(mockMetrics);
    vi.spyOn(cacheService, 'set').mockResolvedValue(true);

    const first = await analyticsService.getOverviewMetrics(tenant1, {});
    expect(first).toEqual(mockMetrics);
    expect(analyticsRepository.getOverviewMetrics).toHaveBeenCalledTimes(1);
    expect(cacheService.set).toHaveBeenCalledWith(
      `tenant:${tenant1}:analytics:overview:all:all`,
      mockMetrics,
      expect.any(Number)
    );

    const second = await analyticsService.getOverviewMetrics(tenant1, {});
    expect(second).toEqual(mockMetrics);
    expect(analyticsRepository.getOverviewMetrics).toHaveBeenCalledTimes(1); // Cached!
  });

  it('differentiates cache keys by tenant ID and date boundaries', async () => {
    analyticsRepository.getOverviewMetrics.mockResolvedValue(mockMetrics);
    vi.spyOn(cacheService, 'get').mockResolvedValue(null);
    vi.spyOn(cacheService, 'set').mockResolvedValue(true);

    const startDate = '2026-11-01T00:00:00.000Z';
    const endDate = '2026-11-20T00:00:00.000Z';

    await analyticsService.getOverviewMetrics(tenant1, { startDate, endDate });
    await analyticsService.getOverviewMetrics(tenant2, { startDate, endDate });

    expect(cacheService.set).toHaveBeenCalledWith(
      `tenant:${tenant1}:analytics:overview:${new Date(startDate).toISOString()}:${new Date(endDate).toISOString()}`,
      mockMetrics,
      expect.any(Number)
    );

    expect(cacheService.set).toHaveBeenCalledWith(
      `tenant:${tenant2}:analytics:overview:${new Date(startDate).toISOString()}:${new Date(endDate).toISOString()}`,
      mockMetrics,
      expect.any(Number)
    );
  });
});
