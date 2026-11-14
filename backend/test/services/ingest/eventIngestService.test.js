/**
 * Unit tests for EventIngestService.
 * Tests event ingestion with idempotency and batch delivery fan-out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = { query: vi.fn(), release: vi.fn() };

vi.mock('../../../src/repositories/jdbc/eventRepository.js', () => ({
  default: {
    insert: vi.fn(),
    findByTenantAndIdempotencyKey: vi.fn(),
    enqueue: vi.fn(),
    enqueueBatch: vi.fn(),
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
  const mockEndpointId1 = 'abc12345-e89b-12d3-a456-426614174001';
  const mockEndpointId2 = 'abc12345-e89b-12d3-a456-426614174002';

  describe('ingest', () => {
    it('should create event directly and batch enqueue deliveries passing transaction client', async () => {
      const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;

      eventRepository.insert.mockResolvedValue({
        id: mockEventId,
        tenantId: mockTenantId,
        payloadJson: '{"test": "data"}',
        idempotencyKey: 'key-123',
        createdAt: new Date().toISOString(),
      });
      eventRepository.enqueueBatch.mockResolvedValue([
        { id: 'delivery-1', endpointId: mockEndpointId1, seq: 1 },
      ]);

      const result = await eventIngestService.ingest(
        mockTenantId,
        'key-123',
        '{"test": "data"}'
      );

      expect(result.duplicate).toBe(false);
      expect(result.deliveriesEnqueued).toBe(1);

      // Verify NO initial redundant findByTenantAndIdempotencyKey query was executed
      expect(eventRepository.findByTenantAndIdempotencyKey).not.toHaveBeenCalled();

      // Verify direct insert with transaction client
      expect(eventRepository.insert).toHaveBeenCalledWith(
        mockTenantId,
        '{"test": "data"}',
        'key-123',
        mockClient
      );

      // Verify batch fan-out called with transaction client
      expect(eventRepository.enqueueBatch).toHaveBeenCalledWith(
        mockTenantId,
        mockEventId,
        mockClient
      );
    });

    it('should return duplicate=true when direct insert returns null without enqueuing deliveries', async () => {
      const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;

      // Direct insert returns null due to ON CONFLICT DO NOTHING
      eventRepository.insert.mockResolvedValue(null);
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
      expect(result.event.id).toBe(mockEventId);

      // Ensure findByTenantAndIdempotencyKey was called only AFTER insert conflict
      expect(eventRepository.findByTenantAndIdempotencyKey).toHaveBeenCalledWith(
        mockTenantId,
        'key-123',
        mockClient
      );
      // Ensure no deliveries were queued on duplicate
      expect(eventRepository.enqueueBatch).not.toHaveBeenCalled();
    });

    it('should handle tenant with zero active endpoints correctly', async () => {
      const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;

      eventRepository.insert.mockResolvedValue({
        id: mockEventId,
        tenantId: mockTenantId,
        payloadJson: '{"test": "no-endpoints"}',
        idempotencyKey: 'key-no-endpoints',
        createdAt: new Date().toISOString(),
      });
      eventRepository.enqueueBatch.mockResolvedValue([]);

      const result = await eventIngestService.ingest(
        mockTenantId,
        'key-no-endpoints',
        '{"test": "no-endpoints"}'
      );

      expect(result.duplicate).toBe(false);
      expect(result.deliveriesEnqueued).toBe(0);
      expect(eventRepository.enqueueBatch).toHaveBeenCalledWith(
        mockTenantId,
        mockEventId,
        mockClient
      );
    });

    it('should handle tenant with multiple active endpoints with set-based fan-out', async () => {
      const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;

      eventRepository.insert.mockResolvedValue({
        id: mockEventId,
        tenantId: mockTenantId,
        payloadJson: '{"test": "multi"}',
        idempotencyKey: 'key-multi',
        createdAt: new Date().toISOString(),
      });
      eventRepository.enqueueBatch.mockResolvedValue([
        { id: 'delivery-1', endpointId: mockEndpointId1, seq: 1 },
        { id: 'delivery-2', endpointId: mockEndpointId2, seq: 5 },
      ]);

      const result = await eventIngestService.ingest(
        mockTenantId,
        'key-multi',
        '{"test": "multi"}'
      );

      expect(result.duplicate).toBe(false);
      expect(result.deliveriesEnqueued).toBe(2);
      expect(eventRepository.enqueueBatch).toHaveBeenCalledWith(
        mockTenantId,
        mockEventId,
        mockClient
      );
    });

    it('should handle concurrent duplicate insertion when insert returns null (ON CONFLICT)', async () => {
      const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;

      // 1. Direct insert returns null (another transaction just committed with same key)
      eventRepository.insert.mockResolvedValue(null);
      // 2. Fetch returns the existing committed event
      eventRepository.findByTenantAndIdempotencyKey.mockResolvedValue({
        id: mockEventId,
        tenantId: mockTenantId,
        idempotencyKey: 'concurrent-key',
        createdAt: new Date().toISOString(),
      });

      const result = await eventIngestService.ingest(
        mockTenantId,
        'concurrent-key',
        '{"concurrent": true}'
      );

      expect(result.duplicate).toBe(true);
      expect(result.deliveriesEnqueued).toBe(0);
      expect(result.event.id).toBe(mockEventId);
      // Ensure no deliveries were queued
      expect(eventRepository.enqueueBatch).not.toHaveBeenCalled();
    });

    it('should propagate error to abort transaction if batch fan-out fails (atomic rollback)', async () => {
      const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;

      eventRepository.insert.mockResolvedValue({
        id: mockEventId,
        tenantId: mockTenantId,
      });
      eventRepository.enqueueBatch.mockRejectedValue(
        new Error('DB failure during batch sequence allocation')
      );

      await expect(
        eventIngestService.ingest(mockTenantId, 'key-123', '{"test": "data"}')
      ).rejects.toThrow('DB failure during batch sequence allocation');
    });

    it('should reject payload over 256KB with PayloadTooLargeError', async () => {
      const largePayload = 'x'.repeat(256 * 1024 + 1);

      await expect(
        eventIngestService.ingest(mockTenantId, 'key-123', largePayload)
      ).rejects.toThrow('Payload too large');

      try {
        await eventIngestService.ingest(mockTenantId, 'key-123', largePayload);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err.statusCode).toBe(413);
        expect(err.name).toBe('PayloadTooLargeError');
        expect(err.type).toBe('payload_too_large');
      }
    });

    it('should respect custom configured maxPayloadBytes limit', async () => {
      const config = (await import('../../../src/config/index.js')).default;
      const originalLimit = config.ingest.maxPayloadBytes;

      try {
        config.ingest.maxPayloadBytes = 500;
        const overLimitPayload = 'x'.repeat(501);

        await expect(
          eventIngestService.ingest(mockTenantId, 'key-custom-1', overLimitPayload)
        ).rejects.toThrow(/Payload too large/);

        const eventRepository = (await import('../../../src/repositories/jdbc/eventRepository.js')).default;

        eventRepository.insert.mockResolvedValue({
          id: mockEventId,
          tenantId: mockTenantId,
          payloadJson: '{"small": true}',
          idempotencyKey: 'key-custom-2',
          createdAt: new Date().toISOString(),
        });
        eventRepository.enqueueBatch.mockResolvedValue([]);

        const withinLimitPayload = '{"small": true}';
        const result = await eventIngestService.ingest(
          mockTenantId,
          'key-custom-2',
          withinLimitPayload
        );
        expect(result.duplicate).toBe(false);
      } finally {
        config.ingest.maxPayloadBytes = originalLimit;
      }
    });
  });
});
