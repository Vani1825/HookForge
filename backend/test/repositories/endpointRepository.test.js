/**
 * Unit tests for JdbcEndpointRepository.
 * Tests endpoint repository with mocked database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}));

describe('EndpointRepository', () => {
  let endpointRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Import after mock is set up
    endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
  });

  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockEndpointId = '987e6543-e89b-12d3-a456-426614174999';

  describe('insert', () => {
    it('should insert endpoint and return created object', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockRow = {
        id: mockEndpointId,
        tenant_id: mockTenantId,
        url: 'https://example.com/webhook',
        secret: 'whsec_test123',
        active: true,
        rate_limit_rps: 10,
        next_seq: 1,
        circuit_state: 'CLOSED',
        circuit_until: null,
        consecutive_failures: 0,
        created_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const result = await endpointRepository.insert(
        mockTenantId,
        'https://example.com/webhook',
        'whsec_test123',
        10
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO endpoints'),
        [mockTenantId, 'https://example.com/webhook', 'whsec_test123', 10]
      );
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('tenantId', mockTenantId);
      expect(result).toHaveProperty('url', 'https://example.com/webhook');
      expect(result).toHaveProperty('secret', 'whsec_test123');
    });

    it('should throw error on database failure', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockRejectedValue(new Error('Database error'));

      await expect(
        endpointRepository.insert(mockTenantId, 'https://example.com', 'secret', 10)
      ).rejects.toThrow('Database error');
    });
  });

  describe('findByIdAndTenant', () => {
    it('should return endpoint when found for correct tenant', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockRow = {
        id: mockEndpointId,
        tenant_id: mockTenantId,
        url: 'https://example.com/webhook',
        secret: 'whsec_test123',
        active: true,
        rate_limit_rps: 10,
        next_seq: 1,
        circuit_state: 'CLOSED',
        circuit_until: null,
        consecutive_failures: 0,
        created_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const result = await endpointRepository.findByIdAndTenant(
        mockEndpointId,
        mockTenantId
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND tenant_id = $2'),
        [mockEndpointId, mockTenantId]
      );
      expect(result).toHaveProperty('id', mockEndpointId);
    });

    it('should return null when endpoint not found', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rows: [] });

      const result = await endpointRepository.findByIdAndTenant(
        mockEndpointId,
        mockTenantId
      );

      expect(result).toBeNull();
    });

    it('should return null when endpoint belongs to different tenant (tenant isolation)', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rows: [] });

      const otherTenantId = '999e4567-e89b-12d3-a456-426614174000';
      const result = await endpointRepository.findByIdAndTenant(
        mockEndpointId,
        otherTenantId
      );

      expect(result).toBeNull();
    });
  });

  describe('findAllByTenant', () => {
    it('should return all endpoints for tenant', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockRows = [
        {
          id: mockEndpointId,
          tenant_id: mockTenantId,
          url: 'https://example.com/webhook',
          secret: 'whsec_test123',
          active: true,
          rate_limit_rps: 10,
          next_seq: 1,
          circuit_state: 'CLOSED',
          circuit_until: null,
          consecutive_failures: 0,
          created_at: new Date(),
        },
      ];

      query.mockResolvedValue({ rows: mockRows });

      const result = await endpointRepository.findAllByTenant(mockTenantId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tenant_id = $1'),
        [mockTenantId]
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('tenantId', mockTenantId);
    });
  });

  describe('findActiveByTenant', () => {
    it('should return only active endpoints', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockRows = [
        {
          id: mockEndpointId,
          tenant_id: mockTenantId,
          url: 'https://example.com/webhook',
          secret: 'whsec_test123',
          active: true,
          rate_limit_rps: 10,
          next_seq: 1,
          circuit_state: 'CLOSED',
          circuit_until: null,
          consecutive_failures: 0,
          created_at: new Date(),
        },
      ];

      query.mockResolvedValue({ rows: mockRows });

      const result = await endpointRepository.findActiveByTenant(mockTenantId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tenant_id = $1 AND active = true'),
        [mockTenantId]
      );
      expect(result).toHaveLength(1);
      expect(result[0].active).toBe(true);
    });

    it('should order by id for stable lock order', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rows: [] });

      await endpointRepository.findActiveByTenant(mockTenantId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY id'),
        [mockTenantId]
      );
    });
  });

  describe('update', () => {
    it('should update endpoint and return updated object', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockRow = {
        id: mockEndpointId,
        tenant_id: mockTenantId,
        url: 'https://example.com/new-url',
        secret: 'whsec_test123',
        active: false,
        rate_limit_rps: 20,
        next_seq: 5,
        circuit_state: 'CLOSED',
        circuit_until: null,
        consecutive_failures: 0,
        created_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const endpoint = {
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/new-url',
        active: false,
        rateLimitRps: 20,
        circuitState: 'CLOSED',
        circuitUntil: null,
        consecutiveFailures: 0,
      };

      const result = await endpointRepository.update(endpoint);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE endpoints'),
        expect.arrayContaining([
          'https://example.com/new-url',
          false,
          20,
          'CLOSED',
          null,
          0,
          mockEndpointId,
          mockTenantId,
        ])
      );
      expect(result).toHaveProperty('url', 'https://example.com/new-url');
      expect(result).toHaveProperty('active', false);
    });

    it('should return null when endpoint not found or wrong tenant', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rows: [] });

      const endpoint = {
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/new-url',
        active: false,
        rateLimitRps: 20,
        circuitState: 'CLOSED',
        circuitUntil: null,
        consecutiveFailures: 0,
      };

      const result = await endpointRepository.update(endpoint);

      expect(result).toBeNull();
    });
  });

  describe('allocate (SequenceAllocator)', () => {
    it('should increment and return sequence number', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({
        rows: [{ allocated_seq: 1 }],
      });

      const result = await endpointRepository.allocate(mockEndpointId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE endpoints'),
        [mockEndpointId]
      );
      expect(result).toBe(1);
    });

    it('should return value BEFORE increment', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({
        rows: [{ allocated_seq: 5 }],
      });

      const result = await endpointRepository.allocate(mockEndpointId);

      expect(result).toBe(5);
    });

    it('should throw error when endpoint not found', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rows: [] });

      await expect(
        endpointRepository.allocate(mockEndpointId)
      ).rejects.toThrow('Endpoint not found');
    });
  });

  describe('EndpointHealthStore stubs', () => {
    it('saveCircuit should be no-op stub', async () => {
      await expect(
        endpointRepository.saveCircuit(mockEndpointId, {
          circuitState: 'OPEN',
          circuitUntil: new Date(),
        })
      ).resolves.not.toThrow();
    });

    it('deactivate should be no-op stub', async () => {
      await expect(
        endpointRepository.deactivate(mockEndpointId)
      ).resolves.not.toThrow();
    });
  });
});
