/**
 * Tests for metrics routes.
 * Validates GET /metrics, /metrics/timeseries, /metrics/distribution, and /metrics/endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import metricsRouter from '../../src/routes/metrics.js';
import analyticsService from '../../src/services/analytics/analyticsService.js';

vi.mock('../../src/services/analytics/analyticsService.js', () => ({
  default: {
    getOverviewMetrics: vi.fn(),
    getTimeSeriesMetrics: vi.fn(),
    getStatusDistribution: vi.fn(),
    getEndpointBreakdown: vi.fn(),
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  apiKeyAuth: (req, res, next) => {
    req.tenantId = '9dab7ae1-7999-4e0d-a2f9-c47fcfda7b4c';
    next();
  },
  TENANT_ID_ATTRIBUTE: 'tenantId',
}));

describe('Metrics Routes', () => {
  let app;
  const mockTenantId = '9dab7ae1-7999-4e0d-a2f9-c47fcfda7b4c';

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    // Attach mock tenant ID
    app.use((req, res, next) => {
      req.tenantId = mockTenantId;
      next();
    });
    app.use('/metrics', metricsRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    });
  });

  describe('GET /metrics/timeseries', () => {
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
        expect.objectContaining({ range: '24h' })
      );
    });

    it('should reject invalid interval with 400', async () => {
      const res = await request(app).get('/metrics/timeseries?interval=invalid');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation Error');
    });
  });

  describe('GET /metrics/distribution', () => {
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

