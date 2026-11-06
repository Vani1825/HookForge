/**
 * Metrics routes - Telemetry, delivery analytics, and KPI endpoints.
 *
 * GET /metrics - Overview KPIs (compatible with frontend OverviewMetrics)
 * GET /metrics/overview - Alias for /metrics
 * GET /metrics/timeseries - Bucketed time series data points
 * GET /metrics/distribution - Status distribution breakdown
 * GET /metrics/endpoints - Per-endpoint reliability breakdown
 */

import express from 'express';
import { query, validationResult } from 'express-validator';
import analyticsService from '../services/analytics/analyticsService.js';
import { TENANT_ID_ATTRIBUTE } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Common date range validators
const rangeValidators = [
  query('range')
    .optional()
    .isIn(['24h', '7d', '30d'])
    .withMessage('range must be one of: 24h, 7d, 30d'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate must be a valid ISO 8601 date string'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate must be a valid ISO 8601 date string'),
];

/**
 * GET /metrics & GET /metrics/overview
 * Overview metrics for dashboard and analytics page.
 */
async function handleOverviewMetrics(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.array().map((e) => e.msg).join(', '),
      });
    }

    const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];
    const { range, startDate, endDate } = req.query;

    const metrics = await analyticsService.getOverviewMetrics(tenantId, {
      range,
      startDate,
      endDate,
    });

    res.json(metrics);
  } catch (error) {
    if (error.message.includes('startDate') || error.message.includes('Invalid')) {
      return res.status(400).json({
        error: 'Bad Request',
        message: error.message,
      });
    }
    next(error);
  }
}

router.get('/', rangeValidators, handleOverviewMetrics);
router.get('/overview', rangeValidators, handleOverviewMetrics);

/**
 * GET /metrics/timeseries
 * Bucketed time-series metrics for throughput and outcome charts.
 */
router.get(
  '/timeseries',
  [
    ...rangeValidators,
    query('interval')
      .optional()
      .isIn(['hour', 'day'])
      .withMessage('interval must be either "hour" or "day"'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation Error',
          message: errors.array().map((e) => e.msg).join(', '),
        });
      }

      const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];
      const { range, startDate, endDate, interval } = req.query;

      const data = await analyticsService.getTimeSeriesMetrics(tenantId, {
        range,
        startDate,
        endDate,
        interval,
      });

      res.json(data);
    } catch (error) {
      if (error.message.includes('startDate') || error.message.includes('Invalid')) {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message,
        });
      }
      next(error);
    }
  }
);

/**
 * GET /metrics/distribution
 * Delivery status breakdown for pie and donut charts.
 */
router.get('/distribution', rangeValidators, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.array().map((e) => e.msg).join(', '),
      });
    }

    const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];
    const { range, startDate, endDate } = req.query;

    const distribution = await analyticsService.getStatusDistribution(tenantId, {
      range,
      startDate,
      endDate,
    });

    res.json(distribution);
  } catch (error) {
    if (error.message.includes('startDate') || error.message.includes('Invalid')) {
      return res.status(400).json({
        error: 'Bad Request',
        message: error.message,
      });
    }
    next(error);
  }
});

/**
 * GET /metrics/endpoints
 * Per-endpoint reliability breakdown.
 */
router.get('/endpoints', async (req, res, next) => {
  try {
    const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];
    const endpoints = await analyticsService.getEndpointBreakdown(tenantId);
    res.json(endpoints);
  } catch (error) {
    next(error);
  }
});

export default router;

