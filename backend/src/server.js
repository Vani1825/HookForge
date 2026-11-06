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
let isShuttingDown = false;

async function startServer() {
  try {
    // Test database connection
    logger.info('Testing database connection...');
    await testConnection();

    // Start HTTP server and wait until port is listening
    await new Promise((resolve, reject) => {
      server = app.listen(config.port, config.host || '0.0.0.0', () => {
        const addr = server.address();
        logger.info('HookForge server started', {
          port: typeof addr === 'object' && addr ? addr.port : config.port,
          host: typeof addr === 'object' && addr ? addr.address : (config.host || '0.0.0.0'),
          env: config.nodeEnv,
        });
        resolve(server);
      });

      server.on('error', (err) => {
        reject(err);
      });
    });

    // Start delivery dispatcher after successful server & DB initialization
    logger.info('Starting delivery dispatcher...');
    startDispatcher();

    // Handle graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', { error: err.message, stack: err.stack });
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      logger.error('Unhandled rejection', { error: message });
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);

  // Stop dispatcher
  logger.info('Stopping delivery dispatcher...');
  try {
    stopDispatcher();
  } catch (error) {
    logger.error('Error stopping delivery dispatcher', { error: error.message });
  }

  // Force shutdown after 10 seconds if graceful close hangs
  const forceTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  if (forceTimer.unref) {
    forceTimer.unref();
  }

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
  } else {
    try {
      await closePool();
      logger.info('Database pool closed');
    } catch (error) {
      logger.error('Error closing database pool', { error: error.message });
    }
    process.exit(0);
  }
}

startServer();
