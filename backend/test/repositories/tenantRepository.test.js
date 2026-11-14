/**
 * Unit tests for JdbcTenantRepository.
 * Tests tenant lookup by API key hash with mocked database and in-memory TTL caching.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import tenantRepository from '../../src/repositories/jdbc/tenantRepository.js';
import config from '../../src/config/index.js';

// Mock the database query function
vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}));

describe('TenantRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantRepository.clearCache();
    config.authCache.enabled = true;
  });

  describe('findByApiKeyHash', () => {
    it('should return tenant when found by API key hash', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockTenant = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Tenant',
      };

      query.mockResolvedValue({
        rows: [mockTenant],
      });

      const result = await tenantRepository.findByApiKeyHash(
        'abcdef1234567890'
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, name'),
        ['abcdef1234567890']
      );
      expect(result).toEqual({
        id: mockTenant.id,
        name: mockTenant.name,
      });
    });

    it('should return null when tenant not found', async () => {
      const { query } = await import('../../src/config/database.js');

      query.mockResolvedValue({
        rows: [],
      });

      const result = await tenantRepository.findByApiKeyHash(
        'nonexistent123'
      );

      expect(query).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should throw error when database query fails', async () => {
      const { query } = await import('../../src/config/database.js');

      query.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        tenantRepository.findByApiKeyHash('test123')
      ).rejects.toThrow('Database connection failed');
    });

    it('should use parameterized query to prevent SQL injection', async () => {
      const { query } = await import('../../src/config/database.js');

      query.mockResolvedValue({ rows: [] });

      const maliciousInput = "'; DROP TABLE tenants; --";
      await tenantRepository.findByApiKeyHash(maliciousInput);

      // Verify the input is passed as a parameter, not interpolated
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE api_key_hash = $1'),
        [maliciousInput]
      );
    });

    it('should serve subsequent requests from cache without querying database', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockTenant = {
        id: 'tenant-cache-123',
        name: 'Cached Tenant',
      };
      query.mockResolvedValue({ rows: [mockTenant] });

      const hash = 'cache_hit_hash_001';

      // First call: cache miss, queries database
      const first = await tenantRepository.findByApiKeyHash(hash);
      expect(first).toEqual({ id: mockTenant.id, name: mockTenant.name });
      expect(query).toHaveBeenCalledTimes(1);

      // Second call: cache hit, zero database queries
      const second = await tenantRepository.findByApiKeyHash(hash);
      expect(second).toEqual({ id: mockTenant.id, name: mockTenant.name });
      expect(query).toHaveBeenCalledTimes(1);

      // Third call: cache hit, zero database queries
      const third = await tenantRepository.findByApiKeyHash(hash);
      expect(third).toEqual({ id: mockTenant.id, name: mockTenant.name });
      expect(query).toHaveBeenCalledTimes(1);

      const stats = tenantRepository.getCacheStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should NOT cache negative (null) lookups', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rows: [] });

      const hash = 'missing_tenant_hash';

      // First call: returns null, queries DB
      const first = await tenantRepository.findByApiKeyHash(hash);
      expect(first).toBeNull();
      expect(query).toHaveBeenCalledTimes(1);

      // Second call: still queries DB because null is never cached
      const second = await tenantRepository.findByApiKeyHash(hash);
      expect(second).toBeNull();
      expect(query).toHaveBeenCalledTimes(2);

      const stats = tenantRepository.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should NOT cache database errors and allow subsequent retry', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockRejectedValueOnce(new Error('Connection transient drop'));

      const hash = 'retry_tenant_hash';

      // First call: fails with error
      await expect(tenantRepository.findByApiKeyHash(hash)).rejects.toThrow(
        'Connection transient drop'
      );
      expect(query).toHaveBeenCalledTimes(1);

      // Second call: database recovered, succeeds and caches positive result
      const mockTenant = { id: 'recovered-tenant', name: 'Recovered' };
      query.mockResolvedValueOnce({ rows: [mockTenant] });

      const result = await tenantRepository.findByApiKeyHash(hash);
      expect(result).toEqual({ id: mockTenant.id, name: mockTenant.name });
      expect(query).toHaveBeenCalledTimes(2);

      // Third call: served from cache
      const cached = await tenantRepository.findByApiKeyHash(hash);
      expect(cached).toEqual({ id: mockTenant.id, name: mockTenant.name });
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('should bypass cache when authCache.enabled is false', async () => {
      const { query } = await import('../../src/config/database.js');
      config.authCache.enabled = false;

      const mockTenant = { id: 'tenant-no-cache', name: 'No Cache Tenant' };
      query.mockResolvedValue({ rows: [mockTenant] });

      const hash = 'direct_db_hash';

      await tenantRepository.findByApiKeyHash(hash);
      await tenantRepository.findByApiKeyHash(hash);

      // In disabled mode, database is queried every time
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('should invalidate specific cached entry on invalidateCache()', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockTenant = { id: 'tenant-inval', name: 'Tenant Inval' };
      query.mockResolvedValue({ rows: [mockTenant] });

      const hash = 'hash_to_invalidate';

      await tenantRepository.findByApiKeyHash(hash);
      expect(query).toHaveBeenCalledTimes(1);

      // Invalidate
      const invalidated = tenantRepository.invalidateCache(hash);
      expect(invalidated).toBe(true);

      // Next query must hit database again
      await tenantRepository.findByApiKeyHash(hash);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('should clear all entries on clearCache()', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rows: [{ id: 't1', name: 'Tenant 1' }] });

      await tenantRepository.findByApiKeyHash('hash_1');
      await tenantRepository.findByApiKeyHash('hash_2');
      expect(query).toHaveBeenCalledTimes(2);

      tenantRepository.clearCache();
      expect(tenantRepository.getCacheStats().size).toBe(0);

      // After clear, both should query database again
      await tenantRepository.findByApiKeyHash('hash_1');
      expect(query).toHaveBeenCalledTimes(3);
    });

    it('should coalesce concurrent queries for the same hash into a single database lookup', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockTenant = { id: 'single-flight-tenant', name: 'SF Tenant' };

      // Simulate a database query that takes 30ms
      query.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { rows: [mockTenant] };
      });

      const hash = 'concurrent_hash_123';

      // Launch 10 concurrent requests for the exact same hash
      const promises = Array.from({ length: 10 }, () =>
        tenantRepository.findByApiKeyHash(hash)
      );

      const results = await Promise.all(promises);

      // All 10 callers should receive the exact same tenant
      for (const res of results) {
        expect(res).toEqual({ id: mockTenant.id, name: mockTenant.name });
      }

      // CRITICAL: Database must have been queried exactly once!
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('should run concurrent lookups for different hashes independently without blocking', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockImplementation(async (sql, params) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { rows: [{ id: `tenant-${params[0]}`, name: `Name-${params[0]}` }] };
      });

      const [resA, resB] = await Promise.all([
        tenantRepository.findByApiKeyHash('hash_alpha'),
        tenantRepository.findByApiKeyHash('hash_beta'),
      ]);

      expect(resA.id).toBe('tenant-hash_alpha');
      expect(resB.id).toBe('tenant-hash_beta');
      expect(query).toHaveBeenCalledTimes(2);
    });
  });
});
