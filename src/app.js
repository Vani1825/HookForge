/**
 * Express application setup.
 * Wires together middleware, routes, and error handling.
 */

import express from 'express';
import config from './config/index.js';
import logger from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';

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

// Parse JSON bodies
app.use(express.json());

// Health check route (no authentication required)
app.use('/health', healthRouter);

// API routes will be added here in later phases
// app.use('/endpoints', endpointsRouter);
// app.use('/events', eventsRouter);
// app.use('/deliveries', deliveriesRouter);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

export default app;
