/**
 * Express application setup.
 * Wires together middleware, routes, and error handling.
 */

import express from 'express';
import config from './config/index.js';
import logger from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiKeyAuth } from './middleware/auth.js';
import { corsMiddleware } from './middleware/cors.js';
import {
  authRateLimiter,
  tenantRateLimiter,
  healthRateLimiter,
} from './middleware/rateLimiter.js';
import healthRouter from './routes/health.js';
import endpointsRouter from './routes/endpoints.js';
import eventsRouter from './routes/events.js';
import deliveriesRouter from './routes/deliveries.js';
import metricsRouter from './routes/metrics.js';

const app = express();

// Trust proxy (safe proxy resolution; default is false unless TRUST_PROXY is configured)
app.set('trust proxy', config.trustProxy);

// Request logging middleware
app.use((req, res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// CORS middleware
app.use(corsMiddleware);

// Health check route (no authentication required; rate-limited per IP before database access)
app.use('/health', healthRateLimiter(), healthRouter);

// JSON body parser with configured maximum payload size limit
const jsonParser = express.json({ limit: config.ingest.maxPayloadBytes });

// API routes with rate limiting, JSON body parsing, and authentication:
// Execution order:
// 1. authRateLimiter: IP-based pre-auth protection (rejects abusive IPs BEFORE parsing JSON bodies)
// 2. jsonParser: Express JSON body parsing and payload size validation (HTTP 413)
// 3. apiKeyAuth: API key authentication and failed attempt tracking
// 4. tenantRateLimiter: Per-tenant rate limiting on authenticated tenantId (HTTP 429)
// 5. Route handlers: Business logic
const apiChain = [authRateLimiter(), jsonParser, apiKeyAuth, tenantRateLimiter()];

app.use('/endpoints', apiChain, endpointsRouter);
app.use('/events', apiChain, eventsRouter);
app.use('/deliveries', apiChain, deliveriesRouter);
app.use('/metrics', apiChain, metricsRouter);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

export default app;
