/**
 * Tests for error handling middleware
 */

import { describe, it, expect } from 'vitest';
import {
  ApiError,
  NotFoundError,
  UnauthorizedError,
  ConflictError,
  ValidationError,
  PayloadTooLargeError,
  errorHandler,
} from '../src/middleware/errorHandler.js';

describe('Error Classes', () => {
  it('should create ApiError with correct properties', () => {
    const error = new ApiError('test_type', 'test message', 500);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.type).toBe('test_type');
    expect(error.message).toBe('test message');
    expect(error.statusCode).toBe(500);
  });

  it('should create NotFoundError with 404 status', () => {
    const error = new NotFoundError('Resource not found');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('NotFoundError');
    expect(error.type).toBe('not_found');
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('Resource not found');
  });

  it('should create NotFoundError with default message', () => {
    const error = new NotFoundError();
    expect(error.message).toBe('Resource not found');
  });

  it('should create UnauthorizedError with 401 status', () => {
    const error = new UnauthorizedError('Not authorized');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('UnauthorizedError');
    expect(error.type).toBe('unauthorized');
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Not authorized');
  });

  it('should create ConflictError with 409 status', () => {
    const error = new ConflictError('Conflict occurred');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('ConflictError');
    expect(error.type).toBe('conflict');
    expect(error.statusCode).toBe(409);
  });

  it('should create ValidationError with 400 status', () => {
    const error = new ValidationError('Invalid input');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('ValidationError');
    expect(error.type).toBe('validation_error');
    expect(error.statusCode).toBe(400);
  });

  it('should create PayloadTooLargeError with 413 status', () => {
    const error = new PayloadTooLargeError('Payload exceeds maximum allowed bytes');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('PayloadTooLargeError');
    expect(error.type).toBe('payload_too_large');
    expect(error.statusCode).toBe(413);
    expect(error.message).toBe('Payload exceeds maximum allowed bytes');
  });

  it('should create PayloadTooLargeError with default message', () => {
    const error = new PayloadTooLargeError();
    expect(error.message).toBe('Payload too large');
    expect(error.statusCode).toBe(413);
  });

  it('should format 413 response in errorHandler without leaking stack trace', () => {
    const error = new PayloadTooLargeError('Payload too large (300000 bytes)');
    const req = { path: '/events', method: 'POST' };
    let capturedStatus = null;
    let capturedBody = null;
    const res = {
      status(code) {
        capturedStatus = code;
        return this;
      },
      json(body) {
        capturedBody = body;
        return this;
      },
    };
    const next = () => {};

    errorHandler(error, req, res, next);

    expect(capturedStatus).toBe(413);
    expect(capturedBody).toEqual({
      error: {
        type: 'payload_too_large',
        message: 'Payload too large (300000 bytes)',
      },
    });
    expect(capturedBody.stack).toBeUndefined();
  });
});
