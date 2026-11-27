/**
 * Express application setup.
 * Wires together middleware, routes, and error handling.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import config from './config/index.js';
import logger from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiKeyAuth } from './middleware/auth.js';
import { optionalSessionAuth } from './middleware/sessionAuth.js';
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
import templatesRouter from './routes/templates.js';
import authRouter from './routes/auth.js';

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

// Cookie parser for browser sessions
app.use(cookieParser());

// Health check route (no authentication required; rate-limited per IP before database access)
app.use('/health', healthRateLimiter(), healthRouter);

// JSON body parser with configured maximum payload size limit
const jsonParser = express.json({ limit: config.ingest.maxPayloadBytes });

// SaaS Authentication and Account Lifecycle Routes
app.use('/auth', jsonParser, authRouter);
app.use('/api/v1/auth', jsonParser, authRouter);
app.use('/api/auth', jsonParser, authRouter);

// API routes with rate limiting, JSON body parsing, session or API key authentication:
// Execution order:
// 1. authRateLimiter: IP-based pre-auth protection (rejects abusive IPs BEFORE parsing JSON bodies)
// 2. jsonParser: Express JSON body parsing and payload size validation (HTTP 413)
// 3. optionalSessionAuth: Authenticates browser session cookies/headers and establishes tenantId
// 4. apiKeyAuth: API key authentication (passes through if already authenticated by session)
// 5. tenantRateLimiter: Per-tenant rate limiting on authenticated tenantId (HTTP 429)
// 6. Route handlers: Business logic
const apiChain = [authRateLimiter(), jsonParser, optionalSessionAuth, apiKeyAuth, tenantRateLimiter()];

app.use('/endpoints', apiChain, endpointsRouter);
app.use('/events', apiChain, eventsRouter);
app.use('/deliveries', apiChain, deliveriesRouter);
app.use('/metrics', apiChain, metricsRouter);
app.use('/templates', apiChain, templatesRouter);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

export default app;
