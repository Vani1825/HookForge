/**
 * Tests for EndpointService caching and cache invalidation.
 * Verifies read-through caching, tenant isolation, and cache eviction on mutation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dns', () => {
  const mockLookup = vi.fn().mockImplementation(async () => {
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

import * as endpointService from '../../src/services/endpoint/endpointService.js';
import endpointRepository from '../../src/repositories/jdbc/endpointRepository.js';
import cacheService from '../../src/services/cache/cacheService.js';

vi.mock('../../src/repositories/jdbc/endpointRepository.js', () => ({
  default: {
    findByIdAndTenant: vi.fn(),
    findAllByTenant: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
  },
}));

describe('Endpoint Caching & Invalidation', () => {
  const tenant1 = '11111111-1111-1111-1111-111111111111';
  const tenant2 = '22222222-2222-2222-2222-222222222222';
  const endpointId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const mockEndpointRow = {
    id: endpointId,
    tenantId: tenant1,
    url: 'https://api.partner.example/webhook',
    secret: 'whsec_testSecret123',
    active: true,
    rateLimitRps: 15,
    circuitState: 'CLOSED',
    consecutiveFailures: 0,
    retryStrategy: 'EXPONENTIAL',
    retryMaxAttempts: 5,
    retryBaseDelayMs: 1000,
    retryMaxDelayMs: 60000,
    retryBackoffMultiplier: 2.0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cacheService.resetStats();
  });

  describe('getById caching', () => {
    it('queries repository on first call and returns cached data on second call', async () => {
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpointRow);
      vi.spyOn(cacheService, 'get').mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: endpointId,
        url: 'https://api.partner.example/webhook',
        active: true,
      });
      vi.spyOn(cacheService, 'set').mockResolvedValue(true);

      // First call: Cache miss -> repository query -> cache set
      const firstResult = await endpointService.getById(tenant1, endpointId);
      expect(firstResult.id).toBe(endpointId);
      expect(endpointRepository.findByIdAndTenant).toHaveBeenCalledTimes(1);
      expect(cacheService.set).toHaveBeenCalledWith(
        `tenant:${tenant1}:endpoint:${endpointId}`,
        expect.objectContaining({ id: endpointId }),
        expect.any(Number)
      );

      // Second call: Cache hit -> returns cached data without repository query
      const secondResult = await endpointService.getById(tenant1, endpointId);
      expect(secondResult.id).toBe(endpointId);
      expect(endpointRepository.findByIdAndTenant).toHaveBeenCalledTimes(1); // Still 1!
    });

    it('enforces tenant isolation: Tenant A and Tenant B use separate cache keys', async () => {
      vi.spyOn(cacheService, 'get').mockResolvedValue(null);
      vi.spyOn(cacheService, 'set').mockResolvedValue(true);
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpointRow);

      await endpointService.getById(tenant1, endpointId);
      await endpointService.getById(tenant2, endpointId);

      expect(cacheService.set).toHaveBeenCalledWith(
        `tenant:${tenant1}:endpoint:${endpointId}`,
        expect.any(Object),
        expect.any(Number)
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        `tenant:${tenant2}:endpoint:${endpointId}`,
        expect.any(Object),
        expect.any(Number)
      );
    });
  });

  describe('list caching', () => {
    it('caches endpoint list and returns cached list on subsequent call', async () => {
      endpointRepository.findAllByTenant.mockResolvedValue([mockEndpointRow]);
      vi.spyOn(cacheService, 'get').mockResolvedValueOnce(null).mockResolvedValueOnce([
        { id: endpointId, url: 'https://api.partner.example/webhook' },
      ]);
      vi.spyOn(cacheService, 'set').mockResolvedValue(true);

      const list1 = await endpointService.list(tenant1);
      expect(list1).toHaveLength(1);
      expect(endpointRepository.findAllByTenant).toHaveBeenCalledTimes(1);

      const list2 = await endpointService.list(tenant1);
      expect(list2).toHaveLength(1);
      expect(endpointRepository.findAllByTenant).toHaveBeenCalledTimes(1); // Cached!
    });
  });

  describe('Cache invalidation on mutations', () => {
    it('invalidates endpoints list cache when create() is called', async () => {
      vi.spyOn(cacheService, 'del').mockResolvedValue(true);
      endpointRepository.insert.mockResolvedValue({
        id: 'new-endpoint-id',
        tenantId: tenant1,
        url: 'https://new.example.com',
        secret: 'whsec_newSecret',
        retryStrategy: 'EXPONENTIAL',
      });

      await endpointService.create(tenant1, {
        url: 'https://new.example.com/events',
      });

      expect(cacheService.del).toHaveBeenCalledWith(`tenant:${tenant1}:endpoints:list`);
    });

    it('invalidates both endpoint cache and list cache when update() is called', async () => {
      vi.spyOn(cacheService, 'del').mockResolvedValue(true);
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpointRow);
      endpointRepository.update.mockResolvedValue({
        ...mockEndpointRow,
        rateLimitRps: 50,
      });

      await endpointService.update(tenant1, endpointId, {
        rateLimitRps: 50,
      });

      expect(cacheService.del).toHaveBeenCalledWith(`tenant:${tenant1}:endpoint:${endpointId}`);
      expect(cacheService.del).toHaveBeenCalledWith(`tenant:${tenant1}:endpoints:list`);
    });

    it('invalidates both endpoint cache and list cache when remove() is called', async () => {
      vi.spyOn(cacheService, 'del').mockResolvedValue(true);
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpointRow);
      endpointRepository.deactivate.mockResolvedValue(true);

      await endpointService.remove(tenant1, endpointId);

      expect(cacheService.del).toHaveBeenCalledWith(`tenant:${tenant1}:endpoint:${endpointId}`);
      expect(cacheService.del).toHaveBeenCalledWith(`tenant:${tenant1}:endpoints:list`);
    });
  });
});
