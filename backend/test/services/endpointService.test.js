/**
 * Unit tests for EndpointService.
 * Tests endpoint business logic with mocked repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/repositories/jdbc/endpointRepository.js', () => ({
  default: {
    insert: vi.fn(),
    findByIdAndTenant: vi.fn(),
    findAllByTenant: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
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
  });
});
