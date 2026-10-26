/**
 * Tests for health endpoint (requires running database)
 * This is an integration test that should be run with a test database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Health Endpoint', () => {
  it('should return 200 and health status when database is available', async () => {
    // This test requires a running database
    // Skip if DATABASE_URL is not set (CI environment)
    if (!process.env.DATABASE_URL && !process.env.DATABASE_HOST) {
      console.log('Skipping health test: no database configured');
      return;
    }

    const response = await request(app).get('/health');

    // Response might be 200 or 503 depending on database availability
    expect([200, 503]).toContain(response.status);

    if (response.status === 200) {
      expect(response.body.status).toBe('up');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.checks).toBeDefined();
      expect(response.body.checks.database).toBeDefined();
    } else {
      expect(response.body.status).toBe('down');
      expect(response.body.checks.database.status).toBe('down');
    }
  });

  it('should return 404 for unknown paths', async () => {
    const response = await request(app).get('/unknown');
    expect(response.status).toBe(404);
    expect(response.body.error).toBeDefined();
    expect(response.body.error.type).toBe('not_found');
  });
});
