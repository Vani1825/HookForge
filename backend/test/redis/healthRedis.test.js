/**
 * Tests for health check endpoint Redis observability.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import healthRouter from '../../src/routes/health.js';
import pool from '../../src/config/database.js';
import * as redisModule from '../../src/config/redis.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('Health Check Redis Observability', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use('/health', healthRouter);
  });

  it('reports database up and redis up when both are healthy', async () => {
    pool.query.mockResolvedValue({ rows: [{ now: new Date() }] });
    vi.spyOn(redisModule, 'isRedisHealthy').mockResolvedValue({
      status: 'up',
      latencyMs: 2,
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('up');
    expect(res.body.checks.database.status).toBe('up');
    expect(res.body.checks.redis.status).toBe('up');
    expect(res.body.checks.redis.latencyMs).toBe(2);
  });

  it('reports redis as disabled when disabled in configuration', async () => {
    pool.query.mockResolvedValue({ rows: [{ now: new Date() }] });
    vi.spyOn(redisModule, 'isRedisHealthy').mockResolvedValue({
      status: 'disabled',
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('up');
    expect(res.body.checks.database.status).toBe('up');
    expect(res.body.checks.redis.status).toBe('disabled');
  });

  it('reports redis as down when redis is unreachable without breaking overall health endpoint', async () => {
    pool.query.mockResolvedValue({ rows: [{ now: new Date() }] });
    vi.spyOn(redisModule, 'isRedisHealthy').mockResolvedValue({
      status: 'down',
      error: 'ECONNREFUSED 127.0.0.1:6379',
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.checks.database.status).toBe('up');
    expect(res.body.checks.redis.status).toBe('down');
    expect(res.body.checks.redis.error).toContain('ECONNREFUSED');
  });

  it('returns 503 when primary database is down and includes redis status', async () => {
    pool.query.mockRejectedValue(new Error('PostgreSQL connection terminated'));
    vi.spyOn(redisModule, 'isRedisHealthy').mockResolvedValue({
      status: 'up',
      latencyMs: 1,
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('down');
    expect(res.body.checks.database.status).toBe('down');
    expect(res.body.checks.redis).toBeDefined();
  });
});
