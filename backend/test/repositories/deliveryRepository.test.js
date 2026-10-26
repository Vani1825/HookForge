/**
 * Tests for JdbcDeliveryRepository.
 * Note: These are unit tests with mocked database calls.
 * Integration tests with actual PostgreSQL would be in a separate test suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import deliveryRepository from '../../src/repositories/jdbc/deliveryRepository.js';
import { query, getClient } from '../../src/config/database.js';
import { deliveryState } from '../../src/domain/deliveryState.js';

// Mock database
vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

describe('JdbcDeliveryRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('insert', () => {
    it('should insert a new delivery', async () => {
      const mockRow = {
        id: 'delivery-1',
        event_id: 'event-1',
        endpoint_id: 'endpoint-1',
        seq: 1,
        state: 'PENDING',
        attempt_count: 0,
        next_attempt_at: new Date(),
        lease_until: null,
        last_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const delivery = await deliveryRepository.insert('event-1', 'endpoint-1', 1);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO deliveries'),
        ['event-1', 'endpoint-1', 1]
      );
      expect(delivery.id).toBe('delivery-1');
    });
  });

  describe('claim', () => {
    it('should claim a delivery with FOR UPDATE SKIP LOCKED', async () => {
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      const mockOrderingRow = { seq: 1 };
      const mockClaimRow = {
        id: 'delivery-1',
        event_id: 'event-1',
        endpoint_id: 'endpoint-1',
        seq: 1,
        state: 'IN_FLIGHT',
        attempt_count: 0,
        next_attempt_at: new Date(),
        lease_until: new Date(),
        last_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      getClient.mockResolvedValue(mockClient);
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [mockOrderingRow] }) // ordering check
        .mockResolvedValueOnce({ rows: [mockClaimRow] }) // claim
        .mockResolvedValueOnce(); // COMMIT

      const delivery = await deliveryRepository.claim('endpoint-1', 30000);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(delivery.id).toBe('delivery-1');
      expect(delivery.state.toString()).toBe('IN_FLIGHT');
    });

    it('should return null when no delivery available', async () => {
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      getClient.mockResolvedValue(mockClient);
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // no open deliveries
        .mockResolvedValueOnce(); // ROLLBACK

      const delivery = await deliveryRepository.claim('endpoint-1', 30000);

      expect(delivery).toBeNull();
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('releaseLease', () => {
    it('should release lease and update state', async () => {
      const mockRow = {
        id: 'delivery-1',
        state: 'RETRYING',
        next_attempt_at: new Date(),
        last_error: 'error',
        updated_at: new Date(),
        created_at: new Date(),
        event_id: 'event-1',
        endpoint_id: 'endpoint-1',
        seq: 1,
        attempt_count: 1,
        lease_until: null,
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const delivery = await deliveryRepository.releaseLease(
        'delivery-1',
        deliveryState.RETRYING,
        new Date().toISOString(),
        'error'
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE deliveries'),
        ['RETRYING', expect.any(String), 'error', 'delivery-1']
      );
    });
  });

  describe('markTerminal', () => {
    it('should mark delivery as terminal', async () => {
      const mockRow = {
        id: 'delivery-1',
        state: 'SUCCEEDED',
        updated_at: new Date(),
        created_at: new Date(),
        event_id: 'event-1',
        endpoint_id: 'endpoint-1',
        seq: 1,
        attempt_count: 1,
        next_attempt_at: new Date(),
        lease_until: null,
        last_error: null,
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const delivery = await deliveryRepository.markTerminal('delivery-1', deliveryState.SUCCEEDED);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE deliveries'),
        ['SUCCEEDED', 'delivery-1']
      );
    });
  });

  describe('findByEvent', () => {
    it('should find deliveries by event ID with tenant scope', async () => {
      const mockRows = [
        { 
          id: 'delivery-1', 
          event_id: 'event-1', 
          endpoint_id: 'endpoint-1', 
          seq: 1,
          state: 'SUCCEEDED',
          attempt_count: 1,
          next_attempt_at: new Date(),
          lease_until: null,
          last_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        { 
          id: 'delivery-2', 
          event_id: 'event-1', 
          endpoint_id: 'endpoint-2', 
          seq: 2,
          state: 'DEAD',
          attempt_count: 3,
          next_attempt_at: new Date(),
          lease_until: null,
          last_error: 'error',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      query.mockResolvedValue({ rows: mockRows });

      const deliveries = await deliveryRepository.findByEvent('event-1', 'tenant-1');

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE d.event_id = $1 AND e.tenant_id = $2'),
        ['event-1', 'tenant-1']
      );
      expect(deliveries).toHaveLength(2);
    });
  });

  describe('findByState', () => {
    it('should find deliveries by state with tenant scope', async () => {
      const mockRows = [
        { 
          id: 'delivery-1', 
          state: 'DEAD',
          event_id: 'event-1',
          endpoint_id: 'endpoint-1',
          seq: 1,
          attempt_count: 3,
          next_attempt_at: new Date(),
          lease_until: null,
          last_error: 'error',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      query.mockResolvedValue({ rows: mockRows });

      const deliveries = await deliveryRepository.findByState(deliveryState.DEAD, 'tenant-1', 100);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE d.state = $1 AND e.tenant_id = $2'),
        ['DEAD', 'tenant-1', 100]
      );
    });
  });

  describe('recordAttempt', () => {
    it('should record delivery attempt', async () => {
      query.mockResolvedValue({});

      await deliveryRepository.recordAttempt({
        deliveryId: 'delivery-1',
        attemptNo: 1,
        startedAt: new Date().toISOString(),
        statusCode: 200,
        latencyMs: 100,
        error: null,
      });

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO delivery_attempts'),
        ['delivery-1', 1, expect.any(String), 200, 100, null]
      );
    });
  });
});
