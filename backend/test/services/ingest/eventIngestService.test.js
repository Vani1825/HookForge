/**
 * Unit tests for EventIngestService.
 * Tests event ingestion with idempotency and delivery fan-out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/repositories/jdbc/eventRepository.js', () => ({
  default: {
    insert: vi.fn(),
    findByTenantAndIdempotencyKey: vi.fn(),
    enqueue: vi.fn(),
  },
}));

vi.mock('../../../src/repositories/jdbc/endpointRepository.js', () => ({
  default: {
    findActiveByTenant: vi.fn(),
    allocate: vi.fn(),
  },
}));

vi.mock('../../../src/config/database.js', () => ({
  transaction: vi.fn((callback) => callback()),
}));

describe('EventIngestService', () => {
  let eventIngestService;

  beforeEach(async () => {
    vi.clearAllMocks();
    eventIngestService = (await import('../../../src/services/ingest/eventIngestService.js')).default;
  });

  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockEventId = '987e6543-e89b-12d3-a456-426614174999';
  const mockEndpointId = 'abc12345-e89b-12d3-a456-426614174000';

  describe('ingest', () => {
    it('should create event and enqueue deliveries', async () => {
      const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;
      const endpointRepository = (await import('../../../src/repositories/jdbc/endpointRepository.js')).default;

      eventRepository.findByTenantAndIdempotencyKey.mockResolvedValue(null);
      eventRepository.insert.mockResolvedValue({
        id: mockEventId,
        tenantId: mockTenantId,
        payloadJson: '{"test": "data"}',
        idempotencyKey: 'key-123',
        createdAt: new Date().toISOString(),
      });

      endpointRepository.findActiveByTenant.mockResolvedValue([
        { id: mockEndpointId },
      ]);
      endpointRepository.allocate.mockResolvedValue(1);
      eventRepository.enqueue.mockResolvedValue({});

      const result = await eventIngestService.ingest(
        mockTenantId,
        'key-123',
        '{"test": "data"}'
      );

      expect(result.duplicate).toBe(false);
      expect(result.deliveriesEnqueued).toBe(1);
      expect(eventRepository.insert).toHaveBeenCalled();
      expect(eventRepository.enqueue).toHaveBeenCalled();
    });

    it('should return duplicate=true for existing idempotency key', async () => {
      const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;

      eventRepository.findByTenantAndIdempotencyKey.mockResolvedValue({
        id: mockEventId,
        tenantId: mockTenantId,
        idempotencyKey: 'key-123',
        createdAt: new Date().toISOString(),
      });

      const result = await eventIngestService.ingest(
        mockTenantId,
        'key-123',
        '{"test": "data"}'
      );

      expect(result.duplicate).toBe(true);
      expect(result.deliveriesEnqueued).toBe(0);
      expect(eventRepository.insert).not.toHaveBeenCalled();
    });

    it('should reject payload over 256KB', async () => {
      const largePayload = 'x'.repeat(256 * 1024 + 1);

      await expect(
        eventIngestService.ingest(mockTenantId, 'key-123', largePayload)
      ).rejects.toThrow('Payload too large');
    });
  });
});
