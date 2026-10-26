/**
 * Server entry point.
 * Starts the Express server and handles graceful shutdown.
 */

import app from './app.js';
import config from './config/index.js';
import logger from './utils/logger.js';
import { testConnection, closePool } from './config/database.js';
import { start as startDispatcher, stop as stopDispatcher } from './services/delivery/dispatcher.js';

let server;

async function startServer() {
  try {
    // Test database connection
    logger.info('Testing database connection...');
    await testConnection();

    // Start HTTP server
    server = app.listen(config.port, () => {
      logger.info(`HookForge server started`, {
        port: config.port,
        env: config.nodeEnv,
      });
    });

    // Start delivery dispatcher
    logger.info('Starting delivery dispatcher...');
    startDispatcher();

    // Handle graceful shutdown
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', { error: err.message, stack: err.stack });
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason });
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  // Stop dispatcher
  logger.info('Stopping delivery dispatcher...');
  stopDispatcher();

  // Stop accepting new connections
  if (server) {
    server.close(async (err) => {
      if (err) {
        logger.error('Error closing HTTP server', { error: err.message });
      } else {
        logger.info('HTTP server closed');
      }

      // Close database connections
      try {
        await closePool();
        logger.info('Database pool closed');
      } catch (error) {
        logger.error('Error closing database pool', { error: error.message });
      }

      process.exit(err ? 1 : 0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

startServer();
