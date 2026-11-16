/**
<<<<<<< HEAD
 * Tests for metrics routes.
 * Validates GET /metrics, /metrics/timeseries, /metrics/distribution, and /metrics/endpoints.
=======
 * Integration tests for metrics routes with date-range integration.
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import metricsRouter from '../../src/routes/metrics.js';
<<<<<<< HEAD
import analyticsService from '../../src/services/analytics/analyticsService.js';

vi.mock('../../src/services/analytics/analyticsService.js', () => ({
  default: {
    getOverviewMetrics: vi.fn(),
    getTimeSeriesMetrics: vi.fn(),
    getStatusDistribution: vi.fn(),
    getEndpointBreakdown: vi.fn(),
=======

vi.mock('../../src/services/metrics/metricsService.js', () => ({
  default: {
    getOverview: vi.fn(),
    getTimeSeries: vi.fn(),
    getStatusDistribution: vi.fn(),
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  apiKeyAuth: (req, res, next) => {
<<<<<<< HEAD
    req.tenantId = '9dab7ae1-7999-4e0d-a2f9-c47fcfda7b4c';
=======
    req.tenantId = '123e4567-e89b-12d3-a456-426614174000';
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
    next();
  },
  TENANT_ID_ATTRIBUTE: 'tenantId',
}));

describe('Metrics Routes', () => {
  let app;
<<<<<<< HEAD
  const mockTenantId = '9dab7ae1-7999-4e0d-a2f9-c47fcfda7b4c';
=======
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
<<<<<<< HEAD
    // Attach mock tenant ID
    app.use((req, res, next) => {
      req.tenantId = mockTenantId;
      next();
    });
=======
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
    app.use('/metrics', metricsRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

<<<<<<< HEAD
  describe('GET /metrics', () => {
    it('should return 200 with OverviewMetrics', async () => {
      const mockMetrics = {
        totalEvents: 42,
        totalDeliveries: 50,
        succeededDeliveries: 48,
        failedDeliveries: 2,
        pendingDeliveries: 0,
        retryingDeliveries: 0,
        deadLetterDeliveries: 2,
        successRate: 96.0,
        averageLatencyMs: 68,
        activeEndpoints: 3,
        totalEndpoints: 3,
        openCircuits: 0,
      };

      analyticsService.getOverviewMetrics.mockResolvedValue(mockMetrics);

      const res = await request(app).get('/metrics');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockMetrics);
      expect(analyticsService.getOverviewMetrics).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({})
      );
    });

    it('should support /metrics/overview alias', async () => {
      analyticsService.getOverviewMetrics.mockResolvedValue({ totalEvents: 1 });

      const res = await request(app).get('/metrics/overview');

      expect(res.status).toBe(200);
      expect(res.body.totalEvents).toBe(1);
    });

    it('should accept valid range filter', async () => {
      analyticsService.getOverviewMetrics.mockResolvedValue({});

      const res = await request(app).get('/metrics?range=7d');

      expect(res.status).toBe(200);
      expect(analyticsService.getOverviewMetrics).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ range: '7d' })
      );
    });

    it('should reject invalid range filter with 400', async () => {
      const res = await request(app).get('/metrics?range=invalid-range');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
      expect(res.body.message).toContain('range must be one of: 24h, 7d, 30d');
    });

    it('should reject invalid startDate with 400', async () => {
      const res = await request(app).get('/metrics?startDate=not-a-date');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
=======
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
      const metricsService = (await import('../../src/services/metrics/metricsService.js')).default;
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
        '123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({ created_after: undefined, created_before: undefined })
      );
    });

    it('should pass explicit ISO 8601 date boundaries to all metrics services', async () => {
      const metricsService = (await import('../../src/services/metrics/metricsService.js')).default;
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

      expect(metricsService.getOverview).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000', expectedFilters);
      expect(metricsService.getTimeSeries).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000', expectedFilters);
      expect(metricsService.getStatusDistribution).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000', expectedFilters);
    });

    it('should support range parameter preset (7d)', async () => {
      const metricsService = (await import('../../src/services/metrics/metricsService.js')).default;
      metricsService.getOverview.mockResolvedValue(mockOverview);
      metricsService.getTimeSeries.mockResolvedValue(mockTimeSeries);
      metricsService.getStatusDistribution.mockResolvedValue(mockDistribution);

      await request(app)
        .get('/metrics')
        .query({ range: '7d' })
        .expect(200);

      expect(metricsService.getOverview).toHaveBeenCalledWith(
        '123e4567-e89b-12d3-a456-426614174000',
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
        .query({ range: 'invalid-range' })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('range must be one of: 24h, 7d, 30d');
    });

    it('should return 400 for malformed ISO 8601 date', async () => {
      const response = await request(app)
        .get('/metrics')
        .query({ created_after: 'not-a-date' })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('created_after must be a valid ISO 8601 date');
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
    });
  });

  describe('GET /metrics/timeseries', () => {
<<<<<<< HEAD
    it('should return 200 with time series array', async () => {
      const mockTimeSeries = [
        { timestamp: '2026-11-06T10:00:00.000Z', label: '10:00', total: 5, succeeded: 4, failed: 1, pending: 0 },
      ];

      analyticsService.getTimeSeriesMetrics.mockResolvedValue(mockTimeSeries);

      const res = await request(app).get('/metrics/timeseries?range=24h');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockTimeSeries);
      expect(analyticsService.getTimeSeriesMetrics).toHaveBeenCalledWith(
        mockTenantId,
=======
    it('should return time series data with date filters', async () => {
      const metricsService = (await import('../../src/services/metrics/metricsService.js')).default;
      metricsService.getTimeSeries.mockResolvedValue(mockTimeSeries);

      const response = await request(app)
        .get('/metrics/timeseries')
        .query({ range: '24h' })
        .expect(200);

      expect(response.body).toEqual(mockTimeSeries);
      expect(metricsService.getTimeSeries).toHaveBeenCalledWith(
        '123e4567-e89b-12d3-a456-426614174000',
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
        expect.objectContaining({ range: '24h' })
      );
    });

<<<<<<< HEAD
    it('should reject invalid interval with 400', async () => {
      const res = await request(app).get('/metrics/timeseries?interval=invalid');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
=======
    it('should reject reversed dates with 400', async () => {
      await request(app)
        .get('/metrics/timeseries')
        .query({
          created_after: '2026-11-15T00:00:00.000Z',
          created_before: '2026-11-01T00:00:00.000Z',
        })
        .expect(400);
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
    });
  });

  describe('GET /metrics/distribution', () => {
<<<<<<< HEAD
    it('should return 200 with status distribution array', async () => {
      const mockDistribution = [
        { name: 'Succeeded', value: 45, color: '#10b981' },
        { name: 'Retrying', value: 2, color: '#f59e0b' },
        { name: 'Dead Letter', value: 3, color: '#ef4444' },
        { name: 'In Flight', value: 0, color: '#6366f1' },
        { name: 'Pending', value: 0, color: '#3b82f6' },
      ];

      analyticsService.getStatusDistribution.mockResolvedValue(mockDistribution);

      const res = await request(app).get('/metrics/distribution');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockDistribution);
    });
  });

  describe('GET /metrics/endpoints', () => {
    it('should return 200 with endpoint breakdown', async () => {
      const mockEndpoints = [
        { id: 'ep-1', url: 'https://test.com/hook', totalDeliveries: 10, successRate: 100 },
      ];

      analyticsService.getEndpointBreakdown.mockResolvedValue(mockEndpoints);

      const res = await request(app).get('/metrics/endpoints');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockEndpoints);
    });
  });
});

=======
    it('should return status distribution data with date filters', async () => {
      const metricsService = (await import('../../src/services/metrics/metricsService.js')).default;
      metricsService.getStatusDistribution.mockResolvedValue(mockDistribution);

      const response = await request(app)
        .get('/metrics/distribution')
        .query({ range: '30d' })
        .expect(200);

      expect(response.body).toEqual(mockDistribution);
      expect(metricsService.getStatusDistribution).toHaveBeenCalledWith(
        '123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({ range: '30d' })
      );
    });
  });
});
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
