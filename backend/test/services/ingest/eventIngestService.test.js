/**
 * Unit tests for EventIngestService.
 * Tests event ingestion with idempotency and delivery fan-out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = { query: vi.fn(), release: vi.fn() };

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
  transaction: vi.fn((callback) => callback(mockClient)),
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
    it('should create event and enqueue deliveries passing transaction client', async () => {
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
      expect(eventRepository.findByTenantAndIdempotencyKey).toHaveBeenCalledWith(
        mockTenantId,
        'key-123',
        mockClient
      );
      expect(eventRepository.insert).toHaveBeenCalledWith(
        mockTenantId,
        '{"test": "data"}',
        'key-123',
        mockClient
      );
      expect(endpointRepository.findActiveByTenant).toHaveBeenCalledWith(
        mockTenantId,
        mockClient
      );
      expect(endpointRepository.allocate).toHaveBeenCalledWith(
        mockEndpointId,
        mockClient
      );
      expect(eventRepository.enqueue).toHaveBeenCalledWith(
        mockEventId,
        mockEndpointId,
        1,
        mockClient
      );
    });

    it('should return duplicate=true for existing idempotency key prior to insert', async () => {
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

    it('should handle concurrent duplicate insertion when insert returns null (ON CONFLICT)', async () => {
      const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;
      const endpointRepository = (await import('../../../src/repositories/jdbc/endpointRepository.js')).default;

      // 1. Initial check returns null (both race past check)
      // 2. insert returns null (Postgres ON CONFLICT DO NOTHING)
      // 3. Re-check returns existing event created by other transaction
      eventRepository.findByTenantAndIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: mockEventId,
          tenantId: mockTenantId,
          idempotencyKey: 'concurrent-key',
          createdAt: new Date().toISOString(),
        });

      eventRepository.insert.mockResolvedValue(null);

      const result = await eventIngestService.ingest(
        mockTenantId,
        'concurrent-key',
        '{"concurrent": true}'
      );

      expect(result.duplicate).toBe(true);
      expect(result.deliveriesEnqueued).toBe(0);
      expect(result.event.id).toBe(mockEventId);
      // Ensure no deliveries were queued
      expect(endpointRepository.findActiveByTenant).not.toHaveBeenCalled();
      expect(eventRepository.enqueue).not.toHaveBeenCalled();
    });

    it('should propagate error to abort transaction if fan-out fails (atomic rollback)', async () => {
      const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;
      const endpointRepository = (await import('../../../src/repositories/jdbc/endpointRepository.js')).default;

      eventRepository.findByTenantAndIdempotencyKey.mockResolvedValue(null);
      eventRepository.insert.mockResolvedValue({
        id: mockEventId,
        tenantId: mockTenantId,
      });
      endpointRepository.findActiveByTenant.mockResolvedValue([
        { id: mockEndpointId },
      ]);
      endpointRepository.allocate.mockRejectedValue(new Error('DB failure during sequence allocation'));

      await expect(
        eventIngestService.ingest(mockTenantId, 'key-123', '{"test": "data"}')
      ).rejects.toThrow('DB failure during sequence allocation');
    });

    it('should reject payload over 256KB', async () => {
      const largePayload = 'x'.repeat(256 * 1024 + 1);

      await expect(
        eventIngestService.ingest(mockTenantId, 'key-123', largePayload)
      ).rejects.toThrow('Payload too large');
    });
  });
});
