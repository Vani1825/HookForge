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
    it('should insert endpoint with encrypted secret and return created object', async () => {
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
        [
          mockTenantId,
          'https://example.com/webhook',
          null,
          10,
          expect.any(String), // secret_ciphertext
          expect.any(String), // secret_iv
          expect.any(String), // secret_tag
          1,                  // secret_version
        ]
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

    it('should decrypt encrypted secret columns when present', async () => {
      const { query } = await import('../../src/config/database.js');
      const { encryptSecret } = await import('../../src/utils/secretEncryption.js');

      const expectedSecret = 'whsec_encrypted_test_value_789';
      const encrypted = encryptSecret(expectedSecret);

      const mockRow = {
        id: mockEndpointId,
        tenant_id: mockTenantId,
        url: 'https://example.com/webhook',
        secret: null, // encrypted in separate columns
        secret_ciphertext: encrypted.ciphertext,
        secret_iv: encrypted.iv,
        secret_tag: encrypted.tag,
        secret_version: encrypted.version,
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

      expect(result).toBeDefined();
      expect(result.secret).toBe(expectedSecret);
      expect(result.secretCiphertext).toBe(encrypted.ciphertext);
      expect(result.secretIv).toBe(encrypted.iv);
      expect(result.secretTag).toBe(encrypted.tag);
    });

    it('should fall back to legacy plaintext secret when secret_ciphertext is null', async () => {
      const { query } = await import('../../src/config/database.js');
      const legacySecret = 'whsec_legacy_plaintext_secret_456';

      const mockRow = {
        id: mockEndpointId,
        tenant_id: mockTenantId,
        url: 'https://example.com/webhook',
        secret: legacySecret,
        secret_ciphertext: null,
        secret_iv: null,
        secret_tag: null,
        secret_version: null,
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

      expect(result).toBeDefined();
      expect(result.secret).toBe(legacySecret);
    });

    it('should fail closed when ciphertext is corrupted or tampered (do not fall back to plaintext)', async () => {
      const { query } = await import('../../src/config/database.js');
      const { DecryptionError } = await import('../../src/utils/secretEncryption.js');

      const mockRow = {
        id: mockEndpointId,
        tenant_id: mockTenantId,
        url: 'https://example.com/webhook',
        secret: 'plaintext_that_must_never_be_returned',
        secret_ciphertext: Buffer.from('corrupted_ciphertext').toString('base64'),
        secret_iv: Buffer.from('123456789012').toString('base64'), // 12 bytes
        secret_tag: Buffer.from('1234567890123456').toString('base64'), // 16 bytes
        secret_version: 1,
        active: true,
        rate_limit_rps: 10,
        next_seq: 1,
        circuit_state: 'CLOSED',
        circuit_until: null,
        consecutive_failures: 0,
        created_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      await expect(
        endpointRepository.findByIdAndTenant(mockEndpointId, mockTenantId)
      ).rejects.toThrow(DecryptionError);
    });

    it('should fail closed when secret_version is missing from encrypted row', async () => {
      const { query } = await import('../../src/config/database.js');
      const { encryptSecret, DecryptionError } = await import('../../src/utils/secretEncryption.js');

      const encrypted = encryptSecret('whsec_version_test');
      const mockRow = {
        id: mockEndpointId,
        tenant_id: mockTenantId,
        url: 'https://example.com/webhook',
        secret: null,
        secret_ciphertext: encrypted.ciphertext,
        secret_iv: encrypted.iv,
        secret_tag: encrypted.tag,
        secret_version: null, // missing version
        active: true,
        rate_limit_rps: 10,
        next_seq: 1,
        circuit_state: 'CLOSED',
        circuit_until: null,
        consecutive_failures: 0,
        created_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      await expect(
        endpointRepository.findByIdAndTenant(mockEndpointId, mockTenantId)
      ).rejects.toThrow(DecryptionError);
    });

    it('should fail closed when secret_version is unsupported', async () => {
      const { query } = await import('../../src/config/database.js');
      const { encryptSecret, DecryptionError } = await import('../../src/utils/secretEncryption.js');

      const encrypted = encryptSecret('whsec_version_test');
      const mockRow = {
        id: mockEndpointId,
        tenant_id: mockTenantId,
        url: 'https://example.com/webhook',
        secret: null,
        secret_ciphertext: encrypted.ciphertext,
        secret_iv: encrypted.iv,
        secret_tag: encrypted.tag,
        secret_version: 99, // unsupported version
        active: true,
        rate_limit_rps: 10,
        next_seq: 1,
        circuit_state: 'CLOSED',
        circuit_until: null,
        consecutive_failures: 0,
        created_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      await expect(
        endpointRepository.findByIdAndTenant(mockEndpointId, mockTenantId)
      ).rejects.toThrow(DecryptionError);
    });

    it('should throw error when row has neither encrypted nor legacy secret', async () => {
      const { query } = await import('../../src/config/database.js');

      const mockRow = {
        id: mockEndpointId,
        tenant_id: mockTenantId,
        url: 'https://example.com/webhook',
        secret: null,
        secret_ciphertext: null,
        active: true,
        rate_limit_rps: 10,
        next_seq: 1,
        circuit_state: 'CLOSED',
        circuit_until: null,
        consecutive_failures: 0,
        created_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      await expect(
        endpointRepository.findByIdAndTenant(mockEndpointId, mockTenantId)
      ).rejects.toThrow(/has no secret configured/i);
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

  describe('findById', () => {
    it('should return endpoint when found', async () => {
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

      const result = await endpointRepository.findById(mockEndpointId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('FROM endpoints\n    WHERE id = $1'),
        [mockEndpointId]
      );
      expect(result).toHaveProperty('id', mockEndpointId);
      expect(result).toHaveProperty('secret', 'whsec_test123');
    });

    it('should return null when endpoint not found', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rows: [] });

      const result = await endpointRepository.findById(mockEndpointId);

      expect(result).toBeNull();
    });

    it('should propagate database error', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockRejectedValue(new Error('Connection failure'));

      await expect(endpointRepository.findById(mockEndpointId)).rejects.toThrow('Connection failure');
    });
  });

  describe('findDueEndpoints', () => {
    it('should query due endpoints ordered by earliest_due with limit', async () => {
      const { query } = await import('../../src/config/database.js');
      const mockRow = {
        id: mockEndpointId,
        tenant_id: mockTenantId,
        url: 'https://example.com/webhook',
        secret: 'whsec_test123',
        active: true,
        rate_limit_rps: 10,
        next_seq: 2,
        circuit_state: 'CLOSED',
        circuit_until: null,
        consecutive_failures: 0,
        created_at: new Date(),
        earliest_due: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const results = await endpointRepository.findDueEndpoints(25);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT\n      e.*,\n      MIN(d.next_attempt_at) AS earliest_due'),
        [25]
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE d.state IN (\'PENDING\', \'RETRYING\')'),
        [25]
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY earliest_due ASC'),
        [25]
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(mockEndpointId);
      expect(results[0].secret).toBe('whsec_test123');
    });

    it('should return empty array when no endpoints have due deliveries', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockResolvedValue({ rows: [] });

      const results = await endpointRepository.findDueEndpoints(50);

      expect(results).toEqual([]);
    });

    it('should pass client when client is provided', async () => {
      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };

      const results = await endpointRepository.findDueEndpoints(50, mockClient);

      expect(mockClient.query).toHaveBeenCalledWith(expect.any(String), [50]);
      expect(results).toEqual([]);
    });

    it('should propagate error on database failure', async () => {
      const { query } = await import('../../src/config/database.js');
      query.mockRejectedValueOnce(new Error('DB failure'));

      await expect(endpointRepository.findDueEndpoints(50)).rejects.toThrow('DB failure');
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
