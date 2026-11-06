/**
/**
 * JdbcAnalyticsRepository - PostgreSQL adapter for operational analytics and metrics.
 * Queries aggregated telemetry, delivery outcomes, and time-series distributions with strict tenant scoping.
 */

import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

/**
 * Fetch overview metrics for a tenant, optionally filtered by a time window.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [options]
 * @param {Date|null} [options.startDate] - Start timestamp boundary
 * @param {Date|null} [options.endDate] - End timestamp boundary
 * @returns {Promise<Object>} Aggregated overview metrics
 */
export async function getOverviewMetrics(tenantId, options = {}) {
  const { startDate = null, endDate = null } = options;

  try {
    // 1. Total events for tenant within time window
    const eventsSql = `
      SELECT COUNT(*)::bigint AS count
      FROM events
      WHERE tenant_id = $1
        AND ($2::timestamptz IS NULL OR created_at >= $2)
        AND ($3::timestamptz IS NULL OR created_at <= $3)
    `;
    const eventsPromise = query(eventsSql, [tenantId, startDate, endDate]);

    // 2. Deliveries grouped by state for tenant within time window
    const deliveriesSql = `
      SELECT
        d.state,
        COUNT(*)::bigint AS count
      FROM deliveries d
      JOIN endpoints ep ON d.endpoint_id = ep.id
      WHERE ep.tenant_id = $1
        AND ($2::timestamptz IS NULL OR d.created_at >= $2)
        AND ($3::timestamptz IS NULL OR d.created_at <= $3)
      GROUP BY d.state
    `;
    const deliveriesPromise = query(deliveriesSql, [tenantId, startDate, endDate]);

    // 3. Average delivery latency from recorded delivery attempts within time window
    const latencySql = `
      SELECT
        COALESCE(ROUND(AVG(a.latency_ms)), 0)::bigint AS avg_latency
      FROM delivery_attempts a
      JOIN deliveries d ON d.id = a.delivery_id
      JOIN endpoints ep ON d.endpoint_id = ep.id
      WHERE ep.tenant_id = $1
        AND ($2::timestamptz IS NULL OR a.started_at >= $2)
        AND ($3::timestamptz IS NULL OR a.started_at <= $3)
    `;
    const latencyPromise = query(latencySql, [tenantId, startDate, endDate]);

    // 4. Endpoint counts and circuit status for tenant
    const endpointsSql = `
      SELECT
        COUNT(*)::bigint AS total_endpoints,
        COUNT(*) FILTER (WHERE active = TRUE)::bigint AS active_endpoints,
        COUNT(*) FILTER (WHERE circuit_state = 'OPEN')::bigint AS open_circuits
      FROM endpoints
      WHERE tenant_id = $1
    `;
    const endpointsPromise = query(endpointsSql, [tenantId]);

    const [eventsRes, deliveriesRes, latencyRes, endpointsRes] = await Promise.all([
      eventsPromise,
      deliveriesPromise,
      latencyPromise,
      endpointsPromise,
    ]);

    const totalEvents = Number(eventsRes.rows[0]?.count || 0);

    // Parse state counts
    let succeededDeliveries = 0;
    let failedDeliveries = 0;
    let retryingDeliveries = 0;
    let inFlightDeliveries = 0;
    let pendingStateDeliveries = 0;
    let totalDeliveries = 0;

    for (const row of deliveriesRes.rows) {
      const count = Number(row.count);
      totalDeliveries += count;

      switch (row.state) {
        case 'SUCCEEDED':
          succeededDeliveries += count;
          break;
        case 'DEAD':
          failedDeliveries += count;
          break;
        case 'RETRYING':
          retryingDeliveries += count;
          break;
        case 'IN_FLIGHT':
          inFlightDeliveries += count;
          break;
        case 'PENDING':
          pendingStateDeliveries += count;
          break;
        default:
          break;
      }
    }

    const pendingDeliveries = pendingStateDeliveries + inFlightDeliveries + retryingDeliveries;

    // Success rate formula: percentage of total deliveries that completed successfully.
    // When no deliveries exist, return 100.0 (clean baseline) rather than NaN or 0.
    const successRate =
      totalDeliveries > 0
        ? Math.round((succeededDeliveries / totalDeliveries) * 1000) / 10
        : 100.0;

    const averageLatencyMs = Number(latencyRes.rows[0]?.avg_latency || 0);
    const totalEndpoints = Number(endpointsRes.rows[0]?.total_endpoints || 0);
    const activeEndpoints = Number(endpointsRes.rows[0]?.active_endpoints || 0);
    const openCircuits = Number(endpointsRes.rows[0]?.open_circuits || 0);

    return {
      totalEvents,
      totalDeliveries,
      succeededDeliveries,
      failedDeliveries,
      pendingDeliveries,
      retryingDeliveries,
      deadLetterDeliveries: failedDeliveries,
      successRate,
      averageLatencyMs,
      activeEndpoints,
      totalEndpoints,
      openCircuits,
    };
  } catch (error) {
    logger.error('Failed to get overview metrics', {
      error: error.message,
      tenantId,
    });
    throw error;
  }
}

/**
 * Fetch contiguous time-series telemetry bucketed by hour or day.
 * Uses PostgreSQL generate_series to ensure continuous, gap-free buckets even when traffic is sparse.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} options
 * @param {Date} options.startDate - Start boundary
 * @param {Date} options.endDate - End boundary
 * @param {'hour'|'day'} [options.interval='hour'] - Bucket resolution
 * @returns {Promise<Array<{timestamp: string, label: string, total: number, succeeded: number, failed: number, pending: number}>>}
 */
export async function getTimeSeriesMetrics(tenantId, options) {
  const { startDate, endDate, interval = 'hour' } = options;

  try {
    let sql;
    if (interval === 'hour') {
      sql = `
        WITH time_slots AS (
          SELECT generate_series(
            date_trunc('hour', $2::timestamptz),
            date_trunc('hour', $3::timestamptz),
            interval '1 hour'
          ) AS slot
        ),
        bucketed_deliveries AS (
          SELECT
            date_trunc('hour', d.created_at) AS slot,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE d.state = 'SUCCEEDED')::int AS succeeded,
            COUNT(*) FILTER (WHERE d.state = 'DEAD')::int AS failed,
            COUNT(*) FILTER (WHERE d.state IN ('PENDING', 'IN_FLIGHT', 'RETRYING'))::int AS pending
          FROM deliveries d
          JOIN endpoints ep ON d.endpoint_id = ep.id
          WHERE ep.tenant_id = $1
            AND d.created_at >= $2::timestamptz
            AND d.created_at <= $3::timestamptz
          GROUP BY 1
        )
        SELECT
          ts.slot AS timestamp,
          to_char(ts.slot, 'HH24:00') AS label,
          COALESCE(bd.total, 0) AS total,
          COALESCE(bd.succeeded, 0) AS succeeded,
          COALESCE(bd.failed, 0) AS failed,
          COALESCE(bd.pending, 0) AS pending
        FROM time_slots ts
        LEFT JOIN bucketed_deliveries bd ON ts.slot = bd.slot
        ORDER BY ts.slot ASC;
      `;
    } else {
      sql = `
        WITH time_slots AS (
          SELECT generate_series(
            date_trunc('day', $2::timestamptz),
            date_trunc('day', $3::timestamptz),
            interval '1 day'
          ) AS slot
        ),
        bucketed_deliveries AS (
          SELECT
            date_trunc('day', d.created_at) AS slot,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE d.state = 'SUCCEEDED')::int AS succeeded,
            COUNT(*) FILTER (WHERE d.state = 'DEAD')::int AS failed,
            COUNT(*) FILTER (WHERE d.state IN ('PENDING', 'IN_FLIGHT', 'RETRYING'))::int AS pending
          FROM deliveries d
          JOIN endpoints ep ON d.endpoint_id = ep.id
          WHERE ep.tenant_id = $1
            AND d.created_at >= $2::timestamptz
            AND d.created_at <= $3::timestamptz
          GROUP BY 1
        )
        SELECT
          ts.slot AS timestamp,
          to_char(ts.slot, 'Mon DD') AS label,
          COALESCE(bd.total, 0) AS total,
          COALESCE(bd.succeeded, 0) AS succeeded,
          COALESCE(bd.failed, 0) AS failed,
          COALESCE(bd.pending, 0) AS pending
        FROM time_slots ts
        LEFT JOIN bucketed_deliveries bd ON ts.slot = bd.slot
        ORDER BY ts.slot ASC;
      `;
    }

    const result = await query(sql, [tenantId, startDate, endDate]);

    return result.rows.map((row) => ({
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : new Date(row.timestamp).toISOString(),
      label: row.label,
      total: Number(row.total),
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
      pending: Number(row.pending),
    }));
  } catch (error) {
    logger.error('Failed to get time series metrics', {
      error: error.message,
      tenantId,
    });
    throw error;
  }
}

/**
 * Fetch delivery status distribution for tenant charts.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [options]
 * @param {Date|null} [options.startDate]
 * @param {Date|null} [options.endDate]
 * @returns {Promise<Array<{name: string, value: number, color: string}>>}
 */
export async function getStatusDistribution(tenantId, options = {}) {
  const { startDate = null, endDate = null } = options;

  try {
    const sql = `
      SELECT
        d.state,
        COUNT(*)::bigint AS count
      FROM deliveries d
      JOIN endpoints ep ON d.endpoint_id = ep.id
      WHERE ep.tenant_id = $1
        AND ($2::timestamptz IS NULL OR d.created_at >= $2)
        AND ($3::timestamptz IS NULL OR d.created_at <= $3)
      GROUP BY d.state
    `;

    const result = await query(sql, [tenantId, startDate, endDate]);

    const counts = {
      SUCCEEDED: 0,
      RETRYING: 0,
      DEAD: 0,
      IN_FLIGHT: 0,
      PENDING: 0,
    };

    for (const row of result.rows) {
      if (counts[row.state] !== undefined) {
        counts[row.state] = Number(row.count);
      }
    }

    return [
      { name: 'Succeeded', value: counts.SUCCEEDED, color: '#10b981' },
      { name: 'Retrying', value: counts.RETRYING, color: '#f59e0b' },
      { name: 'Dead Letter', value: counts.DEAD, color: '#ef4444' },
      { name: 'In Flight', value: counts.IN_FLIGHT, color: '#6366f1' },
      { name: 'Pending', value: counts.PENDING, color: '#3b82f6' },
    ];
  } catch (error) {
    logger.error('Failed to get status distribution', {
      error: error.message,
      tenantId,
    });
    throw error;
  }
}

/**
 * Fetch per-endpoint reliability breakdown.
 *
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array>}
 */
export async function getEndpointBreakdown(tenantId) {
  try {
    const sql = `
      SELECT
        ep.id,
        ep.url,
        ep.circuit_state,
        ep.consecutive_failures,
        ep.rate_limit_rps,
        COUNT(d.id)::bigint AS total_deliveries,
        COUNT(d.id) FILTER (WHERE d.state = 'SUCCEEDED')::bigint AS succeeded_deliveries,
        COUNT(d.id) FILTER (WHERE d.state = 'DEAD')::bigint AS failed_deliveries,
        COALESCE(ROUND(AVG(a.latency_ms)), 0)::bigint AS average_latency_ms
      FROM endpoints ep
      LEFT JOIN deliveries d ON d.endpoint_id = ep.id
      LEFT JOIN delivery_attempts a ON a.delivery_id = d.id
      WHERE ep.tenant_id = $1
      GROUP BY ep.id
      ORDER BY ep.created_at DESC
    `;

    const result = await query(sql, [tenantId]);

    return result.rows.map((row) => {
      const total = Number(row.total_deliveries);
      const succeeded = Number(row.succeeded_deliveries);
      const failed = Number(row.failed_deliveries);
      const successRate = total > 0 ? Math.round((succeeded / total) * 1000) / 10 : 100.0;

      return {
        id: row.id,
        url: row.url,
        circuitState: row.circuit_state,
        circuit_state: row.circuit_state,
        consecutiveFailures: Number(row.consecutive_failures),
        consecutive_failures: Number(row.consecutive_failures),
        rateLimitRps: Number(row.rate_limit_rps),
        rate_limit_rps: Number(row.rate_limit_rps),
        totalDeliveries: total,
        total_deliveries: total,
        succeededDeliveries: succeeded,
        succeeded_deliveries: succeeded,
        failedDeliveries: failed,
        failed_deliveries: failed,
        successRate,
        success_rate: successRate,
        averageLatencyMs: Number(row.average_latency_ms),
        average_latency_ms: Number(row.average_latency_ms),
      };
    });
  } catch (error) {
    logger.error('Failed to get endpoint breakdown', {
      error: error.message,
      tenantId,
    });
    throw error;
  }
}

export default {
  getOverviewMetrics,
  getTimeSeriesMetrics,
  getStatusDistribution,
  getEndpointBreakdown,
};
