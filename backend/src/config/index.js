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
 * Parse positive safe integer from string/number.
 */
function parsePositiveSafeInt(val, defaultVal, varName) {
  if (val === undefined || val === null || val === '') {
    return defaultVal;
  }
  const parsed = Number(val);
  if (!Number.isInteger(parsed) || parsed <= 0 || !Number.isSafeInteger(parsed)) {
    throw new Error(`${varName} must be a positive safe integer`);
  }
  return parsed;
}

/**
 * Parse timeout in milliseconds (supports duration string like "3s", "10s" or integer ms).
 */
function parseTimeoutMs(val, defaultMs, varName) {
  if (val === undefined || val === null || val === '') {
    return defaultMs;
  }
  const ms = parseDuration(val);
  if (!Number.isInteger(ms) || ms <= 0 || !Number.isSafeInteger(ms)) {
    throw new Error(`${varName} must be a positive safe integer`);
  }
  return ms;
}

/**
 * Parse trust proxy configuration.
 *
 * SECURITY INVARIANT:
 * Default MUST remain false so HookForge never trusts arbitrary client-supplied
 * X-Forwarded-For headers. Setting trust proxy to true is safe ONLY when HookForge is
 * deployed directly behind a trusted reverse proxy (e.g. AWS ALB, Cloudflare, NGINX)
 * that is guaranteed to sanitize or overwrite inbound X-Forwarded-For headers.
 * When false, Express sets req.ip exclusively from the direct TCP socket remoteAddress.
 */
function parseTrustProxy(val) {
  if (val === undefined || val === null || val === '') {
    return false;
  }
  const str = String(val).trim().toLowerCase();
  if (str === 'false') return false;
  if (str === 'true') return true;
  const num = Number(val);
  if (Number.isInteger(num) && num >= 0) return num;
  return String(val).trim();
}

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

  // HTTP (timeouts and response limits)
  http: {
    connectTimeoutMs: parseTimeoutMs(
      process.env.HTTP_CONNECT_TIMEOUT,
      3000,
      'HTTP_CONNECT_TIMEOUT'
    ),
    readTimeoutMs: parseTimeoutMs(
      process.env.HTTP_READ_TIMEOUT,
      10000,
      'HTTP_READ_TIMEOUT'
    ),
    maxResponseBytes: parsePositiveSafeInt(
      process.env.HTTP_RESPONSE_MAX_BYTES,
      1048576, // 1MB default (1024 * 1024 bytes)
      'HTTP_RESPONSE_MAX_BYTES'
    ),
  },

  // Ingest
  ingest: {
    maxPayloadBytes: parsePositiveSafeInt(
      process.env.INGEST_MAX_PAYLOAD_BYTES,
      262144,
      'INGEST_MAX_PAYLOAD_BYTES'
    ), // default 256KB
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

  // Security & Encryption configuration
  security: {
    webhookSecretEncryptionKey: process.env.WEBHOOK_SECRET_ENCRYPTION_KEY,
  },
  webhookSecretEncryptionKey: process.env.WEBHOOK_SECRET_ENCRYPTION_KEY,

  // Inbound API Rate Limiting configuration
  rateLimit: {
    authFail: {
      limit: parsePositiveSafeInt(
        process.env.RATE_LIMIT_AUTH_FAIL_LIMIT,
        10,
        'RATE_LIMIT_AUTH_FAIL_LIMIT'
      ),
      windowMs: parsePositiveSafeInt(
        process.env.RATE_LIMIT_AUTH_FAIL_WINDOW_MS,
        60000,
        'RATE_LIMIT_AUTH_FAIL_WINDOW_MS'
      ),
    },
    tenant: {
      limit: parsePositiveSafeInt(
        process.env.RATE_LIMIT_TENANT_LIMIT,
        100,
        'RATE_LIMIT_TENANT_LIMIT'
      ),
      windowMs: parsePositiveSafeInt(
        process.env.RATE_LIMIT_TENANT_WINDOW_MS,
        1000,
        'RATE_LIMIT_TENANT_WINDOW_MS'
      ),
    },
    health: {
      limit: parsePositiveSafeInt(
        process.env.RATE_LIMIT_HEALTH_LIMIT,
        30,
        'RATE_LIMIT_HEALTH_LIMIT'
      ),
      windowMs: parsePositiveSafeInt(
        process.env.RATE_LIMIT_HEALTH_WINDOW_MS,
        60000,
        'RATE_LIMIT_HEALTH_WINDOW_MS'
      ),
    },
  },

  // Tenant API-Key Authentication Cache
  authCache: {
    enabled: process.env.AUTH_CACHE_ENABLED !== 'false',
    ttlMs: parsePositiveSafeInt(
      process.env.AUTH_CACHE_TTL_MS,
      60000,
      'AUTH_CACHE_TTL_MS'
    ),
    maxEntries: parsePositiveSafeInt(
      process.env.AUTH_CACHE_MAX_ENTRIES,
      10000,
      'AUTH_CACHE_MAX_ENTRIES'
    ),
  },

  // Trust proxy configuration (defaults to false to prevent spoofed X-Forwarded-For headers)
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
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
if (
  !Number.isInteger(config.ingest.maxPayloadBytes) ||
  config.ingest.maxPayloadBytes <= 0 ||
  !Number.isSafeInteger(config.ingest.maxPayloadBytes)
) {
  throw new Error('INGEST_MAX_PAYLOAD_BYTES must be a positive safe integer');
}
for (const [name, cfg] of Object.entries(config.rateLimit)) {
  if (!Number.isInteger(cfg.limit) || cfg.limit <= 0 || !Number.isSafeInteger(cfg.limit)) {
    throw new Error(`RATE_LIMIT_${name.toUpperCase()}_LIMIT must be a positive safe integer`);
  }
  if (!Number.isInteger(cfg.windowMs) || cfg.windowMs <= 0 || !Number.isSafeInteger(cfg.windowMs)) {
    throw new Error(`RATE_LIMIT_${name.toUpperCase()}_WINDOW_MS must be a positive safe integer`);
  }
}
if (
  !Number.isInteger(config.http.connectTimeoutMs) ||
  config.http.connectTimeoutMs <= 0 ||
  !Number.isSafeInteger(config.http.connectTimeoutMs)
) {
  throw new Error('HTTP_CONNECT_TIMEOUT must be a positive safe integer');
}
if (
  !Number.isInteger(config.http.readTimeoutMs) ||
  config.http.readTimeoutMs <= 0 ||
  !Number.isSafeInteger(config.http.readTimeoutMs)
) {
  throw new Error('HTTP_READ_TIMEOUT must be a positive safe integer');
}
if (
  !Number.isInteger(config.http.maxResponseBytes) ||
  config.http.maxResponseBytes <= 0 ||
  !Number.isSafeInteger(config.http.maxResponseBytes)
) {
  throw new Error('HTTP_RESPONSE_MAX_BYTES must be a positive safe integer');
}
if (
  !Number.isInteger(config.authCache.ttlMs) ||
  config.authCache.ttlMs <= 0 ||
  !Number.isSafeInteger(config.authCache.ttlMs)
) {
  throw new Error('AUTH_CACHE_TTL_MS must be a positive safe integer');
}
if (
  !Number.isInteger(config.authCache.maxEntries) ||
  config.authCache.maxEntries <= 0 ||
  !Number.isSafeInteger(config.authCache.maxEntries)
) {
  throw new Error('AUTH_CACHE_MAX_ENTRIES must be a positive safe integer');
}

export default config;
