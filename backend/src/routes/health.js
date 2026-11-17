/**
 * Health check endpoint.
 * Provides basic health status and worker telemetry (mirrors Spring Actuator /health).
 */

import { Router } from 'express';
import pool from '../config/database.js';
import logger from '../utils/logger.js';
import { getWorkerStatus } from '../services/delivery/dispatcher.js';

const router = Router();

/**
 * GET /health
 * Returns health status including database connectivity and worker status
 */
router.get('/', async (req, res, next) => {
  try {
    // Check database connection
    const dbResult = await pool.query('SELECT NOW()');
    const dbStatus = dbResult.rows[0] ? 'up' : 'down';

    // Query active in-flight deliveries count from PostgreSQL queue
    let inFlightCount = 0;
    try {
      const inFlightRes = await pool.query(
        "SELECT count(*)::int AS count FROM deliveries WHERE state = 'IN_FLIGHT'"
      );
      inFlightCount = inFlightRes.rows[0]?.count ?? 0;
    } catch {
      // Table may not yet be initialized
    }

    const workerTelemetry = typeof getWorkerStatus === 'function' ? getWorkerStatus() : null;
    const isWorkerRunning = Boolean(workerTelemetry?.isRunning);

    // If dispatcher is running and DB is up, worker is healthy
    const workerHealthStatus = isWorkerRunning && dbStatus === 'up' ? 'up' : isWorkerRunning ? 'degraded' : 'down';

    res.json({
      status: 'up',
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          status: dbStatus,
        },
        worker: {
          status: workerHealthStatus,
          activeWorkers: isWorkerRunning ? (workerTelemetry?.activeWorkers ?? null) : 0,
          currentlyProcessing: Math.max(inFlightCount, workerTelemetry?.currentlyProcessing ?? 0),
          lastHeartbeat: workerTelemetry?.lastHeartbeat ?? null,
        },
      },
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'down',
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          status: 'down',
          error: error.message,
        },
        worker: {
          status: 'down',
          error: error.message,
          activeWorkers: 0,
          currentlyProcessing: 0,
          lastHeartbeat: null,
        },
      },
    });
  }
});

export default router;
