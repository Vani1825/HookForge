/**
 * Health check endpoint.
 * Provides basic health status (mirrors Spring Actuator /health).
 */

import { Router } from 'express';
import pool from '../config/database.js';
import logger from '../utils/logger.js';
import { isRedisHealthy } from '../config/redis.js';

const router = Router();

/**
 * GET /health
 * Returns health status including database and Redis connectivity
 */
router.get('/', async (req, res, next) => {
  try {
    // Check database connection and Redis status in parallel
    const [dbResult, redisCheck] = await Promise.all([
      pool.query('SELECT NOW()'),
      isRedisHealthy().catch((err) => ({ status: 'down', error: err?.message })),
    ]);

    const dbStatus = dbResult.rows[0] ? 'up' : 'down';

    res.json({
      status: 'up',
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          status: dbStatus,
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
        redis: redisCheck,
      },
    });
  }
});

export default router;
