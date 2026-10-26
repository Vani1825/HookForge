/**
 * Unit tests for JdbcTenantRepository.
 * Tests tenant lookup by API key hash with mocked database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import tenantRepository from '../../src/repositories/jdbc/tenantRepository.js';

// Mock the database query function
vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}));

describe('TenantRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
