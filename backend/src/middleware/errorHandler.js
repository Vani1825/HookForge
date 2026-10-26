/**
 * Global error handling middleware.
 * Mirrors the reference GlobalExceptionHandler.java.
 */

import logger from '../utils/logger.js';

/**
 * Custom error classes
 */
export class ApiError extends Error {
  constructor(type, message, statusCode = 500) {
    super(message);
    this.name = 'ApiError';
    this.type = type;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found') {
    super('not_found', message, 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super('unauthorized', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Resource conflict') {
    super('conflict', message, 409);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'Validation failed') {
    super('validation_error', message, 400);
    this.name = 'ValidationError';
  }
}

/**
 * Error handler middleware
 */
export function errorHandler(err, req, res, next) {
  // Log the error
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Determine status code
  const statusCode = err.statusCode || 500;

  // Determine error type
  const type = err.type || 'internal_error';

  // Determine message (don't expose internal errors in production)
  const isDevelopment = process.env.NODE_ENV === 'development';
  const message = statusCode === 500 && !isDevelopment ? 'Internal server error' : err.message;

  // Send error response
  res.status(statusCode).json({
    error: {
      type,
      message,
    },
  });
}

/**
 * 404 handler
 */
export function notFoundHandler(req, res, next) {
  next(new NotFoundError(`Path ${req.path} not found`));
}

/**
 * Async handler wrapper to catch async errors
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
