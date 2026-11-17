/**
 * JdbcMetricsRepository - Database queries for tenant-scoped metrics.
 * Strictly enforces tenant isolation on all queries and supports
 * dynamic date filtering across overview, time-series, and distribution metrics.
 */

import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

/**
 * Get aggregated overview metrics for a tenant with optional date filtering.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [filters={}] - Date filters
 * @param {string} [filters.created_after] - Start ISO date
 * @param {string} [filters.created_before] - End ISO date
 * @returns {Promise<Object>} Aggregated overview metrics
 */
export async function getOverview(tenantId, filters = {}) {
  try {
    // 1. Events count (tenant-scoped)
    const eventConditions = ['tenant_id = $1'];
    const eventParams = [tenantId];
    let eIdx = 2;
    if (filters.created_after) {
      eventConditions.push(`created_at >= $${eIdx++}`);
      eventParams.push(filters.created_after);
    }
    if (filters.created_before) {
      eventConditions.push(`created_at <= $${eIdx++}`);
      eventParams.push(filters.created_before);
    }

    const eventsResult = await query(
      `SELECT count(*)::int AS count FROM events WHERE ${eventConditions.join(' AND ')}`,
      eventParams
    );
    const totalEvents = eventsResult.rows[0]?.count || 0;

    // 2. Deliveries count and states (tenant-scoped via endpoints join)
    const delConditions = ['ep.tenant_id = $1'];
    const delParams = [tenantId];
    let dIdx = 2;
    if (filters.created_after) {
      delConditions.push(`d.created_at >= $${dIdx++}`);
      delParams.push(filters.created_after);
    }
    if (filters.created_before) {
      delConditions.push(`d.created_at <= $${dIdx++}`);
      delParams.push(filters.created_before);
    }

    const deliveriesResult = await query(
      `SELECT
         count(*)::int AS total,
         count(CASE WHEN d.state = 'SUCCEEDED' THEN 1 END)::int AS succeeded,
         count(CASE WHEN d.state = 'DEAD' THEN 1 END)::int AS failed,
         count(CASE WHEN d.state IN ('PENDING', 'IN_FLIGHT', 'RETRYING') THEN 1 END)::int AS pending,
         count(CASE WHEN d.state = 'PENDING' THEN 1 END)::int AS pending_only,
         count(CASE WHEN d.state = 'IN_FLIGHT' THEN 1 END)::int AS in_flight,
         count(CASE WHEN d.state = 'RETRYING' THEN 1 END)::int AS retrying
       FROM deliveries d
       JOIN endpoints ep ON d.endpoint_id = ep.id
       WHERE ${delConditions.join(' AND ')}`,
      delParams
    );
    const delRow = deliveriesResult.rows[0] || {};
    const totalDeliveries = delRow.total || 0;
    const succeededDeliveries = delRow.succeeded || 0;
    const failedDeliveries = delRow.failed || 0;
    const pendingDeliveries = delRow.pending || 0;
    const pendingCount = delRow.pending_only !== undefined ? delRow.pending_only : pendingDeliveries;
    const inFlightCount = delRow.in_flight !== undefined ? delRow.in_flight : 0;
    const retryingCount = delRow.retrying !== undefined ? delRow.retrying : 0;
    const queueBacklog = pendingCount + retryingCount;
    const currentlyProcessing = inFlightCount;
    const successRate = totalDeliveries > 0
      ? Math.round((succeededDeliveries / totalDeliveries) * 1000) / 10
      : 100;

    // 3. Average latency (tenant-scoped via deliveries -> endpoints)
    const latConditions = ['ep.tenant_id = $1'];
    const latParams = [tenantId];
    let lIdx = 2;
    if (filters.created_after) {
      latConditions.push(`d.created_at >= $${lIdx++}`);
      latParams.push(filters.created_after);
    }
    if (filters.created_before) {
      latConditions.push(`d.created_at <= $${lIdx++}`);
      latParams.push(filters.created_before);
    }

    const latencyResult = await query(
      `SELECT COALESCE(ROUND(AVG(da.latency_ms)), 0)::int AS avg_latency
       FROM delivery_attempts da
       JOIN deliveries d ON da.delivery_id = d.id
       JOIN endpoints ep ON d.endpoint_id = ep.id
       WHERE ${latConditions.join(' AND ')}`,
      latParams
    );
    const averageLatencyMs = latencyResult.rows[0]?.avg_latency || 0;

    // 4. Endpoints summary (tenant-scoped inventory)
    const endpointsResult = await query(
      `SELECT
         count(*)::int AS total,
         count(CASE WHEN active = true THEN 1 END)::int AS active,
         count(CASE WHEN circuit_state = 'OPEN' THEN 1 END)::int AS open_circuits
       FROM endpoints
       WHERE tenant_id = $1`,
      [tenantId]
    );
    const epRow = endpointsResult.rows[0] || {};
    const totalEndpoints = epRow.total || 0;
    const activeEndpoints = epRow.active || 0;
    const openCircuits = epRow.open_circuits || 0;

    return {
      totalEvents,
      totalDeliveries,
      succeededDeliveries,
      failedDeliveries,
      pendingDeliveries,
      pendingCount,
      inFlightCount,
      retryingCount,
      queueBacklog,
      currentlyProcessing,
      deadLetterCount: failedDeliveries,
      successRate,
      averageLatencyMs,
      activeEndpoints,
      totalEndpoints,
      openCircuits,
    };
  } catch (error) {
    logger.error('Failed to get overview metrics', { tenantId, error: error.message });
    throw error;
  }
}

/**
 * Get time-series throughput with consistent date boundaries and gap-filling
 * for empty periods.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [filters={}] - Date filters
 * @param {string} [filters.created_after] - Start ISO date
 * @param {string} [filters.created_before] - End ISO date
 * @param {string} [filters.range] - Preset range (24h, 7d, 30d)
 * @returns {Promise<Array>} Time-series data points
 */
export async function getTimeSeries(tenantId, filters = {}) {
  try {
    const conditions = ['ep.tenant_id = $1'];
    const params = [tenantId];
    let idx = 2;

    let startDate;
    let endDate;

    if (filters.created_after) {
      startDate = new Date(filters.created_after);
      conditions.push(`d.created_at >= $${idx++}`);
      params.push(filters.created_after);
    } else if (filters.range === '7d') {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      conditions.push(`d.created_at >= $${idx++}`);
      params.push(startDate.toISOString());
    } else if (filters.range === '30d') {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      conditions.push(`d.created_at >= $${idx++}`);
      params.push(startDate.toISOString());
    } else {
      // Default: last 24 hours
      startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      conditions.push(`d.created_at >= $${idx++}`);
      params.push(startDate.toISOString());
    }

    if (filters.created_before) {
      endDate = new Date(filters.created_before);
      conditions.push(`d.created_at <= $${idx++}`);
      params.push(filters.created_before);
    } else {
      endDate = new Date();
    }

    const spanMs = endDate.getTime() - startDate.getTime();
    const isDaily = spanMs > 25 * 60 * 60 * 1000;
    const truncUnit = isDaily ? 'day' : 'hour';

    const sql = `SELECT
         date_trunc('${truncUnit}', d.created_at) AS bucket_time,
         count(*)::int AS total,
         count(CASE WHEN d.state = 'SUCCEEDED' THEN 1 END)::int AS succeeded,
         count(CASE WHEN d.state = 'DEAD' THEN 1 END)::int AS failed,
         count(CASE WHEN d.state IN ('PENDING', 'IN_FLIGHT', 'RETRYING') THEN 1 END)::int AS pending
       FROM deliveries d
       JOIN endpoints ep ON d.endpoint_id = ep.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY date_trunc('${truncUnit}', d.created_at)
       ORDER BY date_trunc('${truncUnit}', d.created_at) ASC`;

    const result = await query(sql, params);

    // Map queried rows by time key
    const rowMap = new Map();
    for (const row of result.rows) {
      const bDate = new Date(row.bucket_time);
      if (!isNaN(bDate.getTime())) {
        const key = isDaily
          ? bDate.toISOString().slice(0, 10)
          : bDate.toISOString().slice(0, 13);
        rowMap.set(key, {
          total: Number(row.total) || 0,
          succeeded: Number(row.succeeded) || 0,
          failed: Number(row.failed) || 0,
          pending: Number(row.pending) || 0,
        });
      }
    }

    // Generate unbroken sequence of buckets so empty periods display accurately
    const buckets = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    if (isDaily) {
      const numDays = Math.max(1, Math.ceil(spanMs / (24 * 60 * 60 * 1000)));
      for (let i = numDays - 1; i >= 0; i--) {
        const d = new Date(endDate.getTime() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().slice(0, 10);
        const label = `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}`;
        const data = rowMap.get(key) || { total: 0, succeeded: 0, failed: 0, pending: 0 };
        buckets.push({
          timestamp: key,
          label,
          total: data.total,
          succeeded: data.succeeded,
          failed: data.failed,
          pending: data.pending,
        });
      }
    } else {
      const numHours = 24;
      for (let i = numHours - 1; i >= 0; i--) {
        const d = new Date(endDate.getTime() - i * 60 * 60 * 1000);
        const key = d.toISOString().slice(0, 13);
        let h = d.getUTCHours();
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12;
        const label = `${h} ${ampm}`;
        const timestamp = `${String(d.getUTCHours()).padStart(2, '0')}:00`;
        const data = rowMap.get(key) || { total: 0, succeeded: 0, failed: 0, pending: 0 };
        buckets.push({
          timestamp,
          label,
          total: data.total,
          succeeded: data.succeeded,
          failed: data.failed,
          pending: data.pending,
        });
      }
    }

    return buckets;
  } catch (error) {
    logger.error('Failed to get time series metrics', { tenantId, error: error.message });
    throw error;
  }
}

/**
 * Get delivery status distribution for a tenant with optional date filtering.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [filters={}] - Date filters
 * @param {string} [filters.created_after] - Start ISO date
 * @param {string} [filters.created_before] - End ISO date
 * @returns {Promise<Array>} Status distribution array
 */
export async function getStatusDistribution(tenantId, filters = {}) {
  try {
    const conditions = ['ep.tenant_id = $1'];
    const params = [tenantId];
    let idx = 2;
    if (filters.created_after) {
      conditions.push(`d.created_at >= $${idx++}`);
      params.push(filters.created_after);
    }
    if (filters.created_before) {
      conditions.push(`d.created_at <= $${idx++}`);
      params.push(filters.created_before);
    }

    const result = await query(
      `SELECT
         d.state,
         count(*)::int AS count
       FROM deliveries d
       JOIN endpoints ep ON d.endpoint_id = ep.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY d.state`,
      params
    );

    const counts = {
      SUCCEEDED: 0,
      RETRYING: 0,
      DEAD: 0,
      IN_FLIGHT: 0,
      PENDING: 0,
    };

    for (const row of result.rows) {
      if (counts[row.state] !== undefined) {
        counts[row.state] = Number(row.count) || 0;
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
    logger.error('Failed to get status distribution', { tenantId, error: error.message });
    throw error;
  }
}

export default {
  getOverview,
  getTimeSeries,
  getStatusDistribution,
};
