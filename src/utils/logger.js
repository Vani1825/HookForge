/**
 * Logger configuration using Pino.
 * Provides structured logging with appropriate levels.
 */

import pino from 'pino';
import config from '../config/index.js';

const logLevel = config.nodeEnv === 'production' ? 'info' : 'debug';

const logger = pino({
  level: logLevel,
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  serializers: {
    error: pino.stdSerializers.err,
  },
  base: {
    env: config.nodeEnv,
  },
});

export default logger;
