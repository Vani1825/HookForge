/**
 * Health check endpoint.
 * Provides basic health status and worker telemetry (mirrors Spring Actuator /health).
 */

import { Router } from 'express';
import pool from '../config/database.js';
import logger from '../utils/logger.js';
import { getWorkerStatus } from '../services/delivery/dispatcher.js';
import { isRedisHealthy } from '../config/redis.js';

const router = Router();

/**
 * GET /health
 * Returns health status including database connectivity, Redis, and worker status
 */
router.get('/', async (req, res, next) => {
  try {
    // Check database connection and Redis status in parallel
    const [dbResult, redisCheck] = await Promise.all([
      pool.query('SELECT NOW()'),
      isRedisHealthy().catch((err) => ({ status: 'down', error: err?.message })),
    ]);

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
        redis: redisCheck,
      },
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    const redisCheck = await isRedisHealthy().catch(() => ({ status: 'down' }));
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
        redis: redisCheck,
      },
    });
  }
});

export default router;
