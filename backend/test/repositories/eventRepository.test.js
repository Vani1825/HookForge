/**
 * Tests for JdbcEventRepository.
 * Tests event insertion, idempotency lookups, and set-based batch delivery fan-out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import eventRepository from '../../src/repositories/jdbc/eventRepository.js';
import { query } from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}));

describe('JdbcEventRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockEventId = '987e6543-e89b-12d3-a456-426614174999';
  const mockEndpointId1 = 'abc12345-e89b-12d3-a456-426614174001';
  const mockEndpointId2 = 'abc12345-e89b-12d3-a456-426614174002';

  describe('insert', () => {
    it('should insert a new event directly with ON CONFLICT DO NOTHING', async () => {
      const mockRow = {
        id: mockEventId,
        tenant_id: mockTenantId,
        payload: { test: 'data' },
        idempotency_key: 'key-123',
        created_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const event = await eventRepository.insert(
        mockTenantId,
        JSON.stringify({ test: 'data' }),
        'key-123'
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (tenant_id, idempotency_key) DO NOTHING'),
        [mockTenantId, '{"test":"data"}', 'key-123']
      );
      expect(event.id).toBe(mockEventId);
      expect(event.tenantId).toBe(mockTenantId);
      expect(event.idempotencyKey).toBe('key-123');
    });

    it('should return null when insert encounters idempotency conflict', async () => {
      // ON CONFLICT DO NOTHING returns 0 rows
      query.mockResolvedValue({ rows: [] });

      const event = await eventRepository.insert(
        mockTenantId,
        JSON.stringify({ test: 'duplicate' }),
        'key-duplicate'
      );

      expect(event).toBeNull();
    });

    it('should use transaction client when provided', async () => {
      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };

      const event = await eventRepository.insert(
        mockTenantId,
        '{"test":1}',
        'key-client',
        mockClient
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO events'),
        [mockTenantId, '{"test":1}', 'key-client']
      );
      expect(event).toBeNull();
    });

    it('should propagate database error', async () => {
      query.mockRejectedValue(new Error('DB failure'));

      await expect(
        eventRepository.insert(mockTenantId, '{}', 'key-err')
      ).rejects.toThrow('DB failure');
    });
  });

  describe('findByTenantAndIdempotencyKey', () => {
    it('should find existing event by tenant and idempotency key', async () => {
      const mockRow = {
        id: mockEventId,
        tenant_id: mockTenantId,
        payload: { action: 'test' },
        idempotency_key: 'key-found',
        created_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const event = await eventRepository.findByTenantAndIdempotencyKey(
        mockTenantId,
        'key-found'
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tenant_id = $1 AND idempotency_key = $2'),
        [mockTenantId, 'key-found']
      );
      expect(event.id).toBe(mockEventId);
      expect(event.idempotencyKey).toBe('key-found');
    });

    it('should return null when no event matches', async () => {
      query.mockResolvedValue({ rows: [] });

      const event = await eventRepository.findByTenantAndIdempotencyKey(
        mockTenantId,
        'key-not-found'
      );

      expect(event).toBeNull();
    });
  });

  describe('enqueueBatch', () => {
    it('should atomically allocate sequences and insert deliveries in a single CTE query', async () => {
      const mockDeliveryRows = [
        {
          id: 'delivery-1',
          event_id: mockEventId,
          endpoint_id: mockEndpointId1,
          seq: 1,
          state: 'PENDING',
          attempt_count: 0,
          next_attempt_at: new Date(),
          lease_until: null,
          last_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'delivery-2',
          event_id: mockEventId,
          endpoint_id: mockEndpointId2,
          seq: 4,
          state: 'PENDING',
          attempt_count: 0,
          next_attempt_at: new Date(),
          lease_until: null,
          last_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: mockDeliveryRows }),
      };

      const deliveries = await eventRepository.enqueueBatch(
        mockTenantId,
        mockEventId,
        mockClient
      );

      // Verify the single CTE contains locked_endpoints, updated_endpoints, and deliveries INSERT
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('WITH locked_endpoints AS'),
        [mockTenantId, mockEventId]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY id\n      FOR UPDATE'),
        [mockTenantId, mockEventId]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('RETURNING e.id AS endpoint_id, e.next_seq - 1 AS seq'),
        [mockTenantId, mockEventId]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO deliveries'),
        [mockTenantId, mockEventId]
      );

      // Verify mapped domain models
      expect(deliveries).toHaveLength(2);
      expect(deliveries[0].id).toBe('delivery-1');
      expect(deliveries[0].seq).toBe(1);
      expect(deliveries[0].state.toString()).toBe('PENDING');
      expect(deliveries[1].id).toBe('delivery-2');
      expect(deliveries[1].seq).toBe(4);
      expect(deliveries[1].state.toString()).toBe('PENDING');
    });

    it('should return empty array when tenant has zero active endpoints', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };

      const deliveries = await eventRepository.enqueueBatch(
        mockTenantId,
        mockEventId,
        mockClient
      );

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      expect(deliveries).toEqual([]);
    });

    it('should propagate database failure during batch fan-out', async () => {
      const mockClient = {
        query: vi.fn().mockRejectedValue(new Error('CTE execution error')),
      };

      await expect(
        eventRepository.enqueueBatch(mockTenantId, mockEventId, mockClient)
      ).rejects.toThrow('CTE execution error');
    });
  });

  describe('enqueue (individual)', () => {
    it('should enqueue a single delivery', async () => {
      const mockDeliveryRow = {
        id: 'delivery-single',
        event_id: mockEventId,
        endpoint_id: mockEndpointId1,
        seq: 1,
        state: 'PENDING',
        attempt_count: 0,
        next_attempt_at: new Date(),
        lease_until: null,
        last_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockDeliveryRow] });

      const delivery = await eventRepository.enqueue(
        mockEventId,
        mockEndpointId1,
        1
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO deliveries'),
        [mockEventId, mockEndpointId1, 1]
      );
      expect(delivery.id).toBe('delivery-single');
      expect(delivery.seq).toBe(1);
    });
  });
});
