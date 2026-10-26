/**
 * Health check endpoint.
 * Provides basic health status (mirrors Spring Actuator /health).
 */

import { Router } from 'express';
import pool from '../config/database.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * GET /health
 * Returns health status including database connectivity
 */
router.get('/', async (req, res, next) => {
  try {
    // Check database connection
    const dbResult = await pool.query('SELECT NOW()');
    const dbStatus = dbResult.rows[0] ? 'up' : 'down';

    res.json({
      status: 'up',
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          status: dbStatus,
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
      },
    });
  }
});

export default router;
