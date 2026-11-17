/**
 * AnalyticsService - Business logic for system telemetry, KPIs, and reporting.
 * Handles date-range resolution, boundary validations, and tenant isolation.
 */

import analyticsRepository from '../../repositories/jdbc/analyticsRepository.js';
import logger from '../../utils/logger.js';

/**
 * Helper to parse and resolve date range boundaries.
 *
 * @param {Object} options
 * @param {string} [options.range] - '24h' | '7d' | '30d'
 * @param {string} [options.startDate] - ISO timestamp
 * @param {string} [options.endDate] - ISO timestamp
 * @param {string} [defaultRange] - Fallback range ('24h' or null for all-time)
 * @returns {{ startDate: Date|null, endDate: Date|null, interval: 'hour'|'day' }}
 */
export function resolveDateRange(options = {}, defaultRange = null) {
  const { range, startDate: rawStart, endDate: rawEnd } = options;
  const now = new Date();

  // 1. Explicit start and/or end dates provided
  if (rawStart || rawEnd) {
    let startDate = null;
    let endDate = null;

    if (rawStart) {
      startDate = new Date(rawStart);
      if (isNaN(startDate.getTime())) {
        throw new Error(`Invalid startDate format: ${rawStart}`);
      }
    }

    if (rawEnd) {
      endDate = new Date(rawEnd);
      if (isNaN(endDate.getTime())) {
        throw new Error(`Invalid endDate format: ${rawEnd}`);
      }
    }

    if (startDate && endDate && startDate > endDate) {
      throw new Error('startDate must be before or equal to endDate');
    }

    // Determine interval: hourly if range <= 48 hours, daily otherwise
    const durationMs = (endDate ? endDate.getTime() : now.getTime()) - (startDate ? startDate.getTime() : 0);
    const interval = durationMs <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';

    return { startDate, endDate, interval };
  }

  // 2. Predefined range presets
  const selectedRange = range || defaultRange;

  if (selectedRange === '24h') {
    const startDate = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    return { startDate, endDate: now, interval: 'hour' };
  }

  if (selectedRange === '7d') {
    const startDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    return { startDate, endDate: now, interval: 'day' };
  }

  if (selectedRange === '30d') {
    const startDate = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    return { startDate, endDate: now, interval: 'day' };
  }

  // 3. All-time / no filter
  return { startDate: null, endDate: null, interval: 'day' };
}

/**
 * Get overview KPIs for a tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [queryOptions]
 * @returns {Promise<Object>} Overview metrics
 */
export async function getOverviewMetrics(tenantId, queryOptions = {}) {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }

  const { startDate, endDate } = resolveDateRange(queryOptions, null);

  logger.debug('Fetching overview metrics', {
    tenantId,
    startDate: startDate?.toISOString(),
    endDate: endDate?.toISOString(),
  });

  return analyticsRepository.getOverviewMetrics(tenantId, { startDate, endDate });
}

/**
 * Get time-series metrics bucketed by hour or day.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [queryOptions]
 * @returns {Promise<Array>} Time-series data points
 */
export async function getTimeSeriesMetrics(tenantId, queryOptions = {}) {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }

  // Default to 24h for time-series charts if unspecified
  const { startDate, endDate, interval } = resolveDateRange(queryOptions, '24h');

  logger.debug('Fetching time-series metrics', {
    tenantId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    interval,
  });

  return analyticsRepository.getTimeSeriesMetrics(tenantId, {
    startDate,
    endDate,
    interval,
  });
}

/**
 * Get delivery status distribution for tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [queryOptions]
 * @returns {Promise<Array>} Status distribution array
 */
export async function getStatusDistribution(tenantId, queryOptions = {}) {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }

  const { startDate, endDate } = resolveDateRange(queryOptions, null);

  logger.debug('Fetching status distribution', {
    tenantId,
    startDate: startDate?.toISOString(),
    endDate: endDate?.toISOString(),
  });

  return analyticsRepository.getStatusDistribution(tenantId, { startDate, endDate });
}

/**
 * Get endpoint reliability breakdown for tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array>}
 */
export async function getEndpointBreakdown(tenantId) {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }

  return analyticsRepository.getEndpointBreakdown(tenantId);
}

export default {
  resolveDateRange,
  getOverviewMetrics,
  getTimeSeriesMetrics,
  getStatusDistribution,
  getEndpointBreakdown,
};

