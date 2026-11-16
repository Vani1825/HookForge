import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { initDevTenant } from '../scripts/seed.js';

describe('Development Tenant Initialization (seed.js)', () => {
  let mockClient;
  let mockPool;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      end: vi.fn().mockResolvedValue(),
    };
  });

  it('should refuse to run in production mode', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await expect(
        initDevTenant({ pool: mockPool, skipEnvCheck: false, silent: true })
      ).rejects.toThrow('Refusing to run development tenant initialization in production');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('should create a new development tenant when none exists', async () => {
    const tenantId = 'test-uuid-123';
    // First query: check existing -> returns 0 rows
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // Second query: insert -> returns new tenant
    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: tenantId,
          name: 'Default Dev Tenant',
          created_at: new Date().toISOString(),
        },
      ],
    });

    const result = await initDevTenant({
      pool: mockPool,
      skipEnvCheck: true,
      tenantName: 'Default Dev Tenant',
    });

    expect(result.created).toBe(true);
    expect(result.tenant.id).toBe(tenantId);
    expect(result.apiKey).toMatch(/^whkey_[a-f0-9]{48}$/);

    // Verify SHA-256 hash was passed to insert query
    const insertCall = mockClient.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO tenants');
    const insertedHash = insertCall[1][1];
    const expectedHash = crypto.createHash('sha256').update(result.apiKey).digest('hex');
    expect(insertedHash).toBe(expectedHash);
  });

  it('should prevent accidental duplicates if tenant already exists', async () => {
    const existingTenant = {
      id: 'existing-uuid-456',
      name: 'Default Dev Tenant',
      created_at: '2026-10-27T00:00:00Z',
    };

    // First query: check existing -> returns existing tenant
    mockClient.query.mockResolvedValueOnce({ rows: [existingTenant] });

    const result = await initDevTenant({
      pool: mockPool,
      skipEnvCheck: true,
      tenantName: 'Default Dev Tenant',
    });

    expect(result.created).toBe(false);
    expect(result.tenant.id).toBe(existingTenant.id);
    // Verify NO insert query was made
    expect(mockClient.query).toHaveBeenCalledTimes(1);
  });
});
