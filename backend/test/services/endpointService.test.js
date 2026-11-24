/**
 * Unit tests for EndpointService.
 * Tests endpoint business logic with mocked repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dns', () => {
  const mockLookup = vi.fn().mockImplementation(async (hostname) => {
    return [{ address: '93.184.216.34', family: 4 }];
  });
  return {
    default: {
      promises: {
        lookup: mockLookup,
      },
    },
    promises: {
      lookup: mockLookup,
    },
  };
});

vi.mock('../../src/repositories/jdbc/endpointRepository.js', () => ({
  default: {
    insert: vi.fn(),
    findByIdAndTenant: vi.fn(),
    findAllByTenant: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/services/template/templateService.js', () => ({
  default: {
    getById: vi.fn(),
    applyTemplate: vi.fn(),
  },
}));

describe('EndpointService', () => {
  let endpointService;

  beforeEach(async () => {
    vi.clearAllMocks();
    endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
  });

  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockEndpointId = '987e6543-e89b-12d3-a456-426614174999';

  describe('create', () => {
    it('should generate secret and create endpoint', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      const mockEndpoint = {
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/webhook',
        secret: 'whsec_test123',
        active: true,
        rateLimitRps: 10,
        nextSeq: 1,
        circuitState: 'CLOSED',
        circuitUntil: null,
        consecutiveFailures: 0,
        createdAt: new Date().toISOString(),
      };

      endpointRepository.insert.mockResolvedValue(mockEndpoint);

      const result = await endpointService.create(mockTenantId, {
        url: 'https://example.com/webhook',
      });

      expect(endpointRepository.insert).toHaveBeenCalledWith(
        mockTenantId,
        'https://example.com/webhook',
        expect.stringMatching(/^whsec_/),
        10
      );
      expect(result).toHaveProperty('secret');
      expect(result.secret).toMatch(/^whsec_/);
    });

    it('should use provided rateLimitRps', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      endpointRepository.insert.mockResolvedValue({});

      await endpointService.create(mockTenantId, {
        url: 'https://example.com/webhook',
        rateLimitRps: 20,
      });

      expect(endpointRepository.insert).toHaveBeenCalledWith(
        mockTenantId,
        'https://example.com/webhook',
        expect.any(String),
        20
      );
    });

    it('should default rateLimitRps to 10', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      endpointRepository.insert.mockResolvedValue({});

      await endpointService.create(mockTenantId, {
        url: 'https://example.com/webhook',
      });

      expect(endpointRepository.insert).toHaveBeenCalledWith(
        mockTenantId,
        'https://example.com/webhook',
        expect.any(String),
        10
      );
    });

    it('should prefill endpoint settings from templateId if provided', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      const templateService = (await import('../../src/services/template/templateService.js')).default;

      templateService.applyTemplate.mockResolvedValue({
        templateId: 'template-uuid-1',
        url: 'https://template.example.com/hook',
        rateLimitRps: 25,
        retryStrategy: 'FIXED',
        retryMaxAttempts: 4,
        retryBaseDelayMs: 2500,
        retryMaxDelayMs: 2500,
        retryBackoffMultiplier: 1.0,
      });

      endpointRepository.insert.mockResolvedValue({});

      await endpointService.create(mockTenantId, {
        templateId: 'template-uuid-1',
      });

      expect(templateService.applyTemplate).toHaveBeenCalledWith(
        mockTenantId,
        'template-uuid-1',
        expect.objectContaining({ templateId: 'template-uuid-1' })
      );
      expect(endpointRepository.insert).toHaveBeenCalledWith(
        mockTenantId,
        'https://template.example.com/hook',
        expect.any(String),
        25,
        expect.objectContaining({
          retryStrategy: 'FIXED',
          retryMaxAttempts: 4,
          retryBaseDelayMs: 2500,
        })
      );
    });

    it('should reject SSRF destination URL on create', async () => {
      await expect(
        endpointService.create(mockTenantId, {
          url: 'http://169.254.169.254/latest/meta-data/',
        })
      ).rejects.toThrow('cloud metadata');
    });

    it('should reject private IP destination URL on create', async () => {
      await expect(
        endpointService.create(mockTenantId, {
          url: 'http://10.0.0.1/webhook',
        })
      ).rejects.toThrow('private or reserved');
    });

    it('should pass custom retry policy to repository insert', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      endpointRepository.insert.mockResolvedValue({ id: mockEndpointId });

      await endpointService.create(mockTenantId, {
        url: 'https://example.com/webhook',
        rateLimitRps: 15,
        retryStrategy: 'FIXED',
        retryMaxAttempts: 5,
        retryBaseDelayMs: 3000,
      });

      expect(endpointRepository.insert).toHaveBeenCalledWith(
        mockTenantId,
        'https://example.com/webhook',
        expect.any(String),
        15,
        expect.objectContaining({
          retryStrategy: 'FIXED',
          retryMaxAttempts: 5,
          retryBaseDelayMs: 3000,
        })
      );
    });

    it('should reject invalid retryStrategy on create', async () => {
      await expect(
        endpointService.create(mockTenantId, {
          url: 'https://example.com/webhook',
          retryStrategy: 'INVALID_STRATEGY',
        })
      ).rejects.toThrow("retryStrategy must be 'EXPONENTIAL' or 'FIXED'");
    });

    it('should reject retryMaxDelayMs less than retryBaseDelayMs on create', async () => {
      await expect(
        endpointService.create(mockTenantId, {
          url: 'https://example.com/webhook',
          retryBaseDelayMs: 10000,
          retryMaxDelayMs: 5000,
        })
      ).rejects.toThrow('retryMaxDelayMs must be greater than or equal to retryBaseDelayMs');
    });

    it('should reject out-of-range retryMaxAttempts on create', async () => {
      await expect(
        endpointService.create(mockTenantId, {
          url: 'https://example.com/webhook',
          retryMaxAttempts: 100,
        })
      ).rejects.toThrow('retryMaxAttempts must be an integer between 1 and 50');
    });
  });

  describe('list', () => {
    it('should return endpoints without secret', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      const mockEndpoints = [
        {
          id: mockEndpointId,
          tenantId: mockTenantId,
          url: 'https://example.com/webhook',
          secret: 'whsec_secret123',
          active: true,
          rateLimitRps: 10,
          nextSeq: 1,
          circuitState: 'CLOSED',
          circuitUntil: null,
          consecutiveFailures: 0,
          createdAt: new Date().toISOString(),
        },
      ];

      endpointRepository.findAllByTenant.mockResolvedValue(mockEndpoints);

      const result = await endpointService.list(mockTenantId);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('url');
      expect(result[0]).not.toHaveProperty('secret');
      expect(result[0]).not.toHaveProperty('secretCiphertext');
      expect(result[0]).not.toHaveProperty('secretIv');
      expect(result[0]).not.toHaveProperty('secretTag');
      expect(result[0]).not.toHaveProperty('secretVersion');
    });
  });

  describe('getById', () => {
    it('should return endpoint DTO without secret when found', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      const mockEndpoint = {
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/webhook',
        secret: 'whsec_secret123',
        active: true,
        rateLimitRps: 10,
        nextSeq: 1,
        circuitState: 'CLOSED',
        circuitUntil: null,
        consecutiveFailures: 0,
        createdAt: new Date().toISOString(),
      };

      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);

      const result = await endpointService.getById(mockTenantId, mockEndpointId);

      expect(endpointRepository.findByIdAndTenant).toHaveBeenCalledWith(
        mockEndpointId,
        mockTenantId
      );
      expect(result).toHaveProperty('id', mockEndpointId);
      expect(result).toHaveProperty('url', 'https://example.com/webhook');
      expect(result).not.toHaveProperty('secret');
    });

    it('should return null when endpoint not found or cross-tenant', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      endpointRepository.findByIdAndTenant.mockResolvedValue(null);

      const result = await endpointService.getById(mockTenantId, mockEndpointId);

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update endpoint and validate ownership', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      const existing = {
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/webhook',
        secret: 'whsec_secret123',
        active: true,
        rateLimitRps: 10,
        nextSeq: 1,
        circuitState: 'CLOSED',
        circuitUntil: null,
        consecutiveFailures: 0,
        createdAt: new Date().toISOString(),
      };

      const updated = {
        ...existing,
        url: 'https://example.com/new-url',
        active: false,
      };

      endpointRepository.findByIdAndTenant.mockResolvedValue(existing);
      endpointRepository.update.mockResolvedValue(updated);

      const result = await endpointService.update(mockTenantId, mockEndpointId, {
        url: 'https://example.com/new-url',
        active: false,
      });

      expect(endpointRepository.findByIdAndTenant).toHaveBeenCalledWith(
        mockEndpointId,
        mockTenantId
      );
      expect(result).toHaveProperty('url', 'https://example.com/new-url');
      expect(result).toHaveProperty('active', false);
      expect(result).not.toHaveProperty('secret');
    });

    it('should return null when endpoint not found', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      endpointRepository.findByIdAndTenant.mockResolvedValue(null);

      const result = await endpointService.update(mockTenantId, mockEndpointId, {
        url: 'https://example.com/new-url',
      });

      expect(result).toBeNull();
      expect(endpointRepository.update).not.toHaveBeenCalled();
    });

    it('should patch only provided fields', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      const existing = {
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/webhook',
        secret: 'whsec_secret123',
        active: true,
        rateLimitRps: 10,
        nextSeq: 1,
        circuitState: 'CLOSED',
        circuitUntil: null,
        consecutiveFailures: 0,
        createdAt: new Date().toISOString(),
      };

      endpointRepository.findByIdAndTenant.mockResolvedValue(existing);
      endpointRepository.update.mockResolvedValue(existing);

      await endpointService.update(mockTenantId, mockEndpointId, {
        url: 'https://example.com/new-url',
      });

      expect(endpointRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/new-url',
          active: true, // unchanged
          rateLimitRps: 10, // unchanged
        })
      );
    });

    it('should reject SSRF destination URL on update', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      endpointRepository.findByIdAndTenant.mockResolvedValue({
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/webhook',
        active: true,
      });

      await expect(
        endpointService.update(mockTenantId, mockEndpointId, {
          url: 'http://169.254.169.254/webhook',
        })
      ).rejects.toThrow('cloud metadata');
    });

    it('should update retry policy parameters', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      const existing = {
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/webhook',
        secret: 'whsec_secret123',
        active: true,
        rateLimitRps: 10,
        circuitState: 'CLOSED',
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 8,
      };

      endpointRepository.findByIdAndTenant.mockResolvedValue(existing);
      endpointRepository.update.mockResolvedValue({
        ...existing,
        retryStrategy: 'FIXED',
        retryMaxAttempts: 3,
        retryBaseDelayMs: 2000,
      });

      const result = await endpointService.update(mockTenantId, mockEndpointId, {
        retryStrategy: 'FIXED',
        retryMaxAttempts: 3,
        retryBaseDelayMs: 2000,
      });

      expect(endpointRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          retryStrategy: 'FIXED',
          retryMaxAttempts: 3,
          retryBaseDelayMs: 2000,
        })
      );
      expect(result.retryStrategy).toBe('FIXED');
      expect(result.retryMaxAttempts).toBe(3);
    });
  });

  describe('get', () => {
    it('should return endpoint DTO without secret when found', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      const mockEndpoint = {
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/webhook',
        secret: 'whsec_secret123',
        active: true,
        rateLimitRps: 10,
        nextSeq: 1,
        circuitState: 'CLOSED',
        circuitUntil: null,
        consecutiveFailures: 0,
        createdAt: new Date().toISOString(),
      };
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);

      const result = await endpointService.get(mockTenantId, mockEndpointId);
      expect(result).toBeDefined();
      expect(result.id).toBe(mockEndpointId);
      expect(result).not.toHaveProperty('secret');
    });

    it('should return null when endpoint not found', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      endpointRepository.findByIdAndTenant.mockResolvedValue(null);

      const result = await endpointService.get(mockTenantId, mockEndpointId);
      expect(result).toBeNull();
    });
  });

  describe('remove', () => {
    it('should deactivate endpoint when found', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      const mockEndpoint = { id: mockEndpointId, tenantId: mockTenantId };
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);
      endpointRepository.deactivate.mockResolvedValue();

      const result = await endpointService.remove(mockTenantId, mockEndpointId);
      expect(result).toEqual({ success: true, id: mockEndpointId, active: false });
      expect(endpointRepository.deactivate).toHaveBeenCalledWith(mockEndpointId);
    });

    it('should return null when endpoint not found for removal', async () => {
      const endpointRepository = (await import('../../src/repositories/jdbc/endpointRepository.js')).default;
      endpointRepository.findByIdAndTenant.mockResolvedValue(null);

      const result = await endpointService.remove(mockTenantId, mockEndpointId);
      expect(result).toBeNull();
    });
  });
});
