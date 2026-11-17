/**
 * Integration tests for metrics routes with date-range integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import metricsRouter from '../../src/routes/metrics.js';
import metricsService from '../../src/services/metrics/metricsService.js';
import analyticsService from '../../src/services/analytics/analyticsService.js';

vi.mock('../../src/services/metrics/metricsService.js', () => ({
  default: {
    getOverview: vi.fn(),
    getTimeSeries: vi.fn(),
    getStatusDistribution: vi.fn(),
  },
}));

vi.mock('../../src/services/analytics/analyticsService.js', () => ({
  default: {
    getEndpointBreakdown: vi.fn(),
  },
}));

const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';

vi.mock('../../src/middleware/auth.js', () => ({
  apiKeyAuth: (req, res, next) => {
    req.tenantId = mockTenantId;
    next();
  },
  TENANT_ID_ATTRIBUTE: 'tenantId',
}));

describe('Metrics Routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.tenantId = mockTenantId;
      next();
    });
    app.use('/metrics', metricsRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockOverview = {
    totalEvents: 10,
    totalDeliveries: 20,
    succeededDeliveries: 18,
    failedDeliveries: 1,
    pendingDeliveries: 1,
    successRate: 90.0,
    averageLatencyMs: 45,
    activeEndpoints: 2,
    totalEndpoints: 3,
    openCircuits: 0,
  };

  const mockTimeSeries = [
    { timestamp: '12:00', label: '12 PM', total: 5, succeeded: 5, failed: 0, pending: 0 },
  ];

  const mockDistribution = [
    { name: 'Succeeded', value: 18, color: '#10b981' },
  ];

  describe('GET /metrics', () => {
    it('should return overview metrics with timeseries and status distribution without date filters', async () => {
      metricsService.getOverview.mockResolvedValue(mockOverview);
      metricsService.getTimeSeries.mockResolvedValue(mockTimeSeries);
      metricsService.getStatusDistribution.mockResolvedValue(mockDistribution);

      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.body.totalEvents).toBe(10);
      expect(response.body.totalDeliveries).toBe(20);
      expect(response.body.averageLatencyMs).toBe(45);
      expect(response.body.timeSeries).toEqual(mockTimeSeries);
      expect(response.body.statusDistribution).toEqual(mockDistribution);
      expect(metricsService.getOverview).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ created_after: undefined, created_before: undefined })
      );
    });

    it('should support /metrics/overview alias', async () => {
      metricsService.getOverview.mockResolvedValue(mockOverview);
      metricsService.getTimeSeries.mockResolvedValue(mockTimeSeries);
      metricsService.getStatusDistribution.mockResolvedValue(mockDistribution);

      const response = await request(app)
        .get('/metrics/overview')
        .expect(200);

      expect(response.body.totalEvents).toBe(10);
      expect(response.body.totalDeliveries).toBe(20);
    });

    it('should pass explicit ISO 8601 date boundaries to all metrics services', async () => {
      metricsService.getOverview.mockResolvedValue(mockOverview);
      metricsService.getTimeSeries.mockResolvedValue(mockTimeSeries);
      metricsService.getStatusDistribution.mockResolvedValue(mockDistribution);

      const after = '2026-11-01T00:00:00.000Z';
      const before = '2026-11-15T23:59:59.999Z';

      await request(app)
        .get('/metrics')
        .query({ created_after: after, created_before: before })
        .expect(200);

      const expectedFilters = expect.objectContaining({
        created_after: after,
        created_before: before,
      });

      expect(metricsService.getOverview).toHaveBeenCalledWith(mockTenantId, expectedFilters);
      expect(metricsService.getTimeSeries).toHaveBeenCalledWith(mockTenantId, expectedFilters);
      expect(metricsService.getStatusDistribution).toHaveBeenCalledWith(mockTenantId, expectedFilters);
    });

    it('should support range parameter preset (7d)', async () => {
      metricsService.getOverview.mockResolvedValue(mockOverview);
      metricsService.getTimeSeries.mockResolvedValue(mockTimeSeries);
      metricsService.getStatusDistribution.mockResolvedValue(mockDistribution);

      await request(app)
        .get('/metrics')
        .query({ range: '7d' })
        .expect(200);

      expect(metricsService.getOverview).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          range: '7d',
          created_after: expect.any(String),
          created_before: expect.any(String),
        })
      );
    });

    it('should return 400 when created_after is later than created_before', async () => {
      const response = await request(app)
        .get('/metrics')
        .query({
          created_after: '2026-11-20T00:00:00.000Z',
          created_before: '2026-11-10T00:00:00.000Z',
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('created_after cannot be later than created_before');
    });

    it('should return 400 for invalid range value', async () => {
      const response = await request(app)
        .get('/metrics')
        .query({ range: 'invalid' })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('range must be one of: 24h, 7d, 30d');
    });

    it('should return 400 for invalid date format', async () => {
      const response = await request(app)
        .get('/metrics')
        .query({ created_after: 'not-a-valid-date' })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('created_after must be a valid ISO 8601 date');
    });
  });

  describe('GET /metrics/timeseries', () => {
    it('should return time-series array for authenticated tenant', async () => {
      metricsService.getTimeSeries.mockResolvedValue(mockTimeSeries);

      const response = await request(app)
        .get('/metrics/timeseries')
        .expect(200);

      expect(response.body).toEqual(mockTimeSeries);
      expect(metricsService.getTimeSeries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ range: undefined })
      );
    });

    it('should forward date filters to time-series service', async () => {
      metricsService.getTimeSeries.mockResolvedValue(mockTimeSeries);

      await request(app)
        .get('/metrics/timeseries')
        .query({ range: '24h' })
        .expect(200);

      expect(metricsService.getTimeSeries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ range: '24h' })
      );
    });
  });

  describe('GET /metrics/distribution', () => {
    it('should return status distribution for authenticated tenant', async () => {
      metricsService.getStatusDistribution.mockResolvedValue(mockDistribution);

      const response = await request(app)
        .get('/metrics/distribution')
        .expect(200);

      expect(response.body).toEqual(mockDistribution);
      expect(metricsService.getStatusDistribution).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ range: undefined })
      );
    });
  });

  describe('GET /metrics/endpoints', () => {
    it('should return endpoint breakdown for authenticated tenant', async () => {
      const mockEndpoints = [{ endpointId: 'ep-1', url: 'https://example.com', total: 10 }];
      analyticsService.getEndpointBreakdown.mockResolvedValue(mockEndpoints);

      const response = await request(app)
        .get('/metrics/endpoints')
        .expect(200);

      expect(response.body).toEqual(mockEndpoints);
    });
  });
});
