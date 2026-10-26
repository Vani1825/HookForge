/**
 * PostgreSQL connection pool configuration.
 * Uses pg library with connection pooling.
 */

import pg from 'pg';
import config from './index.js';
import logger from '../utils/logger.js';

const { Pool } = pg;

// Create connection pool
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: config.database.poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Log pool errors
pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Test database connection
 */
export async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    logger.info('Database connection successful', { timestamp: result.rows[0].now });
    return true;
  } catch (error) {
    logger.error('Database connection failed', { error: error.message });
    throw error;
  }
}

/**
 * Get a client from the pool for transactional operations
 */
export async function getClient() {
  return await pool.connect();
}

/**
 * Execute a query with the pool
 */
export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { duration, rows: result.rowCount });
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('Query failed', { duration, error: error.message });
    throw error;
  }
}

/**
 * Execute a transaction with a callback
 * The callback receives a client and should return a result
 */
export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close the pool gracefully
 */
export async function closePool() {
  try {
    await pool.end();
    logger.info('Database pool closed');
  } catch (error) {
    logger.error('Error closing database pool', { error: error.message });
    throw error;
  }
}

export default pool;
