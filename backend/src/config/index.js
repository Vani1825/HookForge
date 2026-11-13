/**
 * Configuration loader for HookForge.
 * All tunables live here with defaults from the reference implementation.
 * Environment variables override defaults.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables with fallback search paths:
// 1. Current working directory .env
dotenv.config();
// 2. backend/.env (if executed from project root)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// 3. Root .env (if executed from backend directory)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Parse duration string (ISO-8601 format like "PT5S", "PT1H") to milliseconds.
 * Reference uses ISO-8601 durations; we'll support a simpler format for Node.js.
 * Format: "5s", "1m", "1h", "500ms", "0.5s"
 */
function parseDuration(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;

  const match = str.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!match) throw new Error(`Invalid duration format: ${str}`);

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Webhook Properties - mirrors the reference WebhookProperties.java
 */
const config = {
  // Server
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  database: {
    url:
      process.env.DATABASE_URL ||
      `postgresql://${process.env.DATABASE_USER || 'webhooks'}:${process.env.DATABASE_PASSWORD || 'webhooks'}@${process.env.DATABASE_HOST || 'localhost'}:${process.env.DATABASE_PORT || '5434'}/${process.env.DATABASE_NAME || 'webhooks'}`,
    user: process.env.DATABASE_USER || 'webhooks',
    password: process.env.DATABASE_PASSWORD || 'webhooks',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5434', 10),
    database: process.env.DATABASE_NAME || 'webhooks',
    poolMax: parseInt(process.env.DATABASE_POOL_MAX || '20', 10),
  },

  // Retry policy (from reference: maxAttempts=8, baseDelay=5s, maxDelay=1h)
  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '8', 10),
    baseDelayMs: parseDuration(process.env.RETRY_BASE_DELAY || '5s'),
    maxDelayMs: parseDuration(process.env.RETRY_MAX_DELAY || '1h'),
  },

  // Dispatcher (from reference: pollInterval=1s, batchSize=50, workerConcurrency=50, leaseMargin=30s, reaperInterval=60s)
  dispatcher: {
    pollIntervalMs: parseDuration(process.env.DISPATCHER_POLL_INTERVAL || '1s'),
    batchSize: parseInt(process.env.DISPATCHER_BATCH_SIZE || '50', 10),
    workerConcurrency: parseInt(process.env.DISPATCHER_WORKER_CONCURRENCY || '50', 10),
    leaseMarginMs: parseDuration(process.env.DISPATCHER_LEASE_MARGIN || '30s'),
    reaperIntervalMs: parseDuration(process.env.DISPATCHER_REAPER_INTERVAL || '60s'),
  },

  // Circuit breaker (from reference: failureThreshold=5, openDuration=1m)
  circuit: {
    failureThreshold: parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD || '5', 10),
    openDurationMs: parseDuration(process.env.CIRCUIT_OPEN_DURATION || '1m'),
  },

  // HTTP (from reference: connectTimeout=3s, readTimeout=10s)
  http: {
    connectTimeoutMs: parseDuration(process.env.HTTP_CONNECT_TIMEOUT || '3s'),
    readTimeoutMs: parseDuration(process.env.HTTP_READ_TIMEOUT || '10s'),
  },

  // Ingest
  ingest: {
    maxPayloadBytes: parseInt(process.env.INGEST_MAX_PAYLOAD_BYTES || '262144', 10), // 256KB
  },

  // SSRF protection configuration
  ssrf: {
    allowLocal:
      (process.env.NODE_ENV || 'development') !== 'production' &&
      (process.env.SSRF_ALLOW_LOCAL === 'true' || process.env.ALLOW_LOCAL_WEBHOOKS === 'true'),
    enforceDns: process.env.SSRF_ENFORCE_DNS !== 'false',
  },

  // CORS configuration
  cors: {
    allowedOrigins: parseAllowedOrigins(
      process.env.ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS,
      process.env.NODE_ENV || 'development'
    ),
  },
};

/**
 * Parse allowed origins for CORS.
 * In production, unrestricted '*' is strictly disallowed.
 */
function parseAllowedOrigins(originsStr, nodeEnv) {
  if (originsStr) {
    const list = originsStr.split(',').map((s) => s.trim()).filter(Boolean);
    if (nodeEnv === 'production') {
      return list.filter((origin) => origin !== '*');
    }
    return list;
  }
  if (nodeEnv === 'production') {
    return [];
  }
  return [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
}

// Validate critical configuration
if (config.retry.maxAttempts < 1) {
  throw new Error('RETRY_MAX_ATTEMPTS must be at least 1');
}
if (config.dispatcher.batchSize < 1) {
  throw new Error('DISPATCHER_BATCH_SIZE must be at least 1');
}
if (config.dispatcher.workerConcurrency < 1) {
  throw new Error('DISPATCHER_WORKER_CONCURRENCY must be at least 1');
}
if (config.circuit.failureThreshold < 1) {
  throw new Error('CIRCUIT_FAILURE_THRESHOLD must be at least 1');
}

export default config;
