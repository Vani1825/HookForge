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
import healthRouter from './routes/health.js';
import endpointsRouter from './routes/endpoints.js';
import eventsRouter from './routes/events.js';
import deliveriesRouter from './routes/deliveries.js';
import metricsRouter from './routes/metrics.js';

const app = express();

// Trust proxy (for proper X-Forwarded-* headers behind reverse proxy)
app.set('trust proxy', true);

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

// Parse JSON bodies
app.use(express.json({ limit: config.ingest.maxPayloadBytes }));

// Health check route (no authentication required)
app.use('/health', healthRouter);

// API routes with authentication
app.use('/endpoints', apiKeyAuth, endpointsRouter);
app.use('/events', apiKeyAuth, eventsRouter);
app.use('/deliveries', apiKeyAuth, deliveriesRouter);
app.use('/metrics', apiKeyAuth, metricsRouter);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

export default app;
