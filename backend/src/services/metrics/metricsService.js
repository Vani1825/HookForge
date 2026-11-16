/**
 * MetricsService - Business logic for system metrics and telemetry.
 * Provides tenant-isolated aggregation of events, deliveries, latency, and endpoints
 * supporting explicit date ranges and standardized intervals.
 */

import metricsRepository from '../../repositories/jdbc/metricsRepository.js';

/**
 * Get overview metrics for a tenant with optional date filtering.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [filters] - Optional date filters
 * @returns {Promise<Object>} Overview metrics
 */
export async function getOverview(tenantId, filters) {
  return filters !== undefined
    ? metricsRepository.getOverview(tenantId, filters)
    : metricsRepository.getOverview(tenantId);
}

/**
 * Get time-series metrics for a tenant with optional date filtering.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [filters] - Optional date filters
 * @returns {Promise<Array>} Time-series data points
 */
export async function getTimeSeries(tenantId, filters) {
  return filters !== undefined
    ? metricsRepository.getTimeSeries(tenantId, filters)
    : metricsRepository.getTimeSeries(tenantId);
}

/**
 * Get status distribution for a tenant with optional date filtering.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [filters] - Optional date filters
 * @returns {Promise<Array>} Status distribution entries
 */
export async function getStatusDistribution(tenantId, filters) {
  return filters !== undefined
    ? metricsRepository.getStatusDistribution(tenantId, filters)
    : metricsRepository.getStatusDistribution(tenantId);
}

export default {
  getOverview,
  getTimeSeries,
  getStatusDistribution,
};
