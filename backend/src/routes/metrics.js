/**
<<<<<<< HEAD
 * Metrics routes - Telemetry, delivery analytics, and KPI endpoints.
 *
 * GET /metrics - Overview KPIs (compatible with frontend OverviewMetrics)
 * GET /metrics/overview - Alias for /metrics
 * GET /metrics/timeseries - Bucketed time series data points
 * GET /metrics/distribution - Status distribution breakdown
 * GET /metrics/endpoints - Per-endpoint reliability breakdown
=======
 * Metrics routes - REST API for system telemetry and operational metrics.
 * GET /metrics - Overview metrics with time-series and status distribution
 * GET /metrics/timeseries - Time-series throughput metrics
 * GET /metrics/distribution - Delivery status distribution
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
 */

import express from 'express';
import { query, validationResult } from 'express-validator';
<<<<<<< HEAD
import analyticsService from '../services/analytics/analyticsService.js';
import { TENANT_ID_ATTRIBUTE } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Common date range validators
const rangeValidators = [
=======
import { apiKeyAuth, TENANT_ID_ATTRIBUTE } from '../middleware/auth.js';
import metricsService from '../services/metrics/metricsService.js';

const router = express.Router();

/**
 * Validation rules for date-range metrics queries.
 * Supports explicit ISO 8601 timestamps (created_after/created_before and aliases)
 * as well as range presets (24h, 7d, 30d).
 */
const metricsQueryValidators = [
  query('created_after')
    .optional()
    .isISO8601()
    .withMessage('created_after must be a valid ISO 8601 date'),
  query('created_before')
    .optional()
    .isISO8601()
    .withMessage('created_before must be a valid ISO 8601 date')
    .custom((value, { req }) => {
      const afterStr = req.query.created_after || req.query.startDate || req.query.from;
      if (afterStr) {
        const after = new Date(afterStr).getTime();
        const before = new Date(value).getTime();
        if (!isNaN(after) && !isNaN(before) && after > before) {
          throw new Error('created_after cannot be later than created_before');
        }
      }
      return true;
    }),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate must be a valid ISO 8601 date'),
  query('from')
    .optional()
    .isISO8601()
    .withMessage('from must be a valid ISO 8601 date'),
  query('to')
    .optional()
    .isISO8601()
    .withMessage('to must be a valid ISO 8601 date'),
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
  query('range')
    .optional()
    .isIn(['24h', '7d', '30d'])
    .withMessage('range must be one of: 24h, 7d, 30d'),
<<<<<<< HEAD
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
=======
];

/**
 * Helper to extract and normalize date boundary filters from query parameters.
 */
function extractDateFilters(req) {
  let created_after = req.query.created_after || req.query.startDate || req.query.from;
  let created_before = req.query.created_before || req.query.endDate || req.query.to;
  const range = req.query.range;

  if (!created_after && range) {
    const now = new Date();
    if (range === '24h') {
      created_after = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    } else if (range === '7d') {
      created_after = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (range === '30d') {
      created_after = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }
    if (!created_before) {
      created_before = now.toISOString();
    }
  }

  return {
    created_after,
    created_before,
    range,
  };
}

/**
 * GET /metrics
 * System overview metrics for the authenticated tenant with consistent date boundaries.
 */
router.get('/', apiKeyAuth, metricsQueryValidators, async (req, res, next) => {
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.array().map((e) => e.msg).join(', '),
<<<<<<< HEAD
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
=======
        errors: errors.array(),
      });
    }

    const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
    const filters = extractDateFilters(req);

    const [overview, timeSeries, statusDistribution] = await Promise.all([
      metricsService.getOverview(tenantId, filters),
      metricsService.getTimeSeries(tenantId, filters).catch(() => []),
      metricsService.getStatusDistribution(tenantId, filters).catch(() => []),
    ]);

    res.status(200).json({
      ...overview,
      timeSeries,
      statusDistribution,
    });
  } catch (error) {
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
    next(error);
  }
});

/**
<<<<<<< HEAD
 * GET /metrics/endpoints
 * Per-endpoint reliability breakdown.
 */
router.get('/endpoints', async (req, res, next) => {
  try {
    const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];
    const endpoints = await analyticsService.getEndpointBreakdown(tenantId);
    res.json(endpoints);
=======
 * GET /metrics/timeseries
 * Time-series throughput metrics for the authenticated tenant.
 */
router.get('/timeseries', apiKeyAuth, metricsQueryValidators, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.array().map((e) => e.msg).join(', '),
        errors: errors.array(),
      });
    }

    const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
    const filters = extractDateFilters(req);
    const timeSeries = await metricsService.getTimeSeries(tenantId, filters);
    res.status(200).json(timeSeries);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /metrics/distribution
 * Delivery status distribution for the authenticated tenant.
 */
router.get('/distribution', apiKeyAuth, metricsQueryValidators, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.array().map((e) => e.msg).join(', '),
        errors: errors.array(),
      });
    }

    const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
    const filters = extractDateFilters(req);
    const distribution = await metricsService.getStatusDistribution(tenantId, filters);
    res.status(200).json(distribution);
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
  } catch (error) {
    next(error);
  }
});

export default router;
<<<<<<< HEAD

=======
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
