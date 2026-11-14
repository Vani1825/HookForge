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
      expect(delivery.id).toBe('delivery-1');
    });

    it('should atomically increment attempt count and enforce stale worker condition on valid unexpired lease', async () => {
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
        attempt_count: 2,
        lease_until: null,
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const delivery = await deliveryRepository.releaseLease(
        'delivery-1',
        deliveryState.RETRYING,
        '2026-11-13T12:00:00.000Z',
        'error',
        { incrementAttempt: true, requireInFlight: true, expectedAttemptCount: 1 }
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(/attempt_count = attempt_count \+ 1.*WHERE id = \$4 AND state = 'IN_FLIGHT' AND lease_until IS NOT NULL AND lease_until >= now\(\) AND attempt_count = \$5/s),
        ['RETRYING', '2026-11-13T12:00:00.000Z', 'error', 'delivery-1', 1]
      );
      expect(query.mock.calls[0][0]).not.toContain('lease_until IS NULL OR');
      expect(delivery.attemptCount).toBe(2);
    });

    it('should reset attempt count when transitioning to PENDING', async () => {
      const mockRow = {
        id: 'delivery-1',
        state: 'PENDING',
        next_attempt_at: new Date(),
        last_error: null,
        updated_at: new Date(),
        created_at: new Date(),
        event_id: 'event-1',
        endpoint_id: 'endpoint-1',
        seq: 1,
        attempt_count: 0,
        lease_until: null,
      };

      query.mockResolvedValue({ rows: [mockRow] });

      await deliveryRepository.releaseLease(
        'delivery-1',
        deliveryState.PENDING,
        '2026-11-13T12:00:00.000Z',
        null
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(/attempt_count = 0/s),
        ['PENDING', '2026-11-13T12:00:00.000Z', null, 'delivery-1']
      );
    });

    it('should return null when stale worker has expired lease', async () => {
      // Database returns 0 rows because lease_until >= now() evaluated to false
      query.mockResolvedValue({ rows: [] });

      const delivery = await deliveryRepository.releaseLease(
        'delivery-1',
        deliveryState.RETRYING,
        '2026-11-13T12:00:00.000Z',
        'error',
        { incrementAttempt: true, requireInFlight: true }
      );

      expect(delivery).toBeNull();
    });

    it('should return null when stale worker encounters null lease deadline', async () => {
      // Database returns 0 rows because lease_until IS NOT NULL evaluated to false
      query.mockResolvedValue({ rows: [] });

      const delivery = await deliveryRepository.releaseLease(
        'delivery-1',
        deliveryState.RETRYING,
        '2026-11-13T12:00:00.000Z',
        'error',
        { incrementAttempt: true, requireInFlight: true }
      );

      expect(delivery).toBeNull();
    });

    it('should return null when delivery was already recovered or reassigned', async () => {
      // Database returns 0 rows because state is no longer IN_FLIGHT
      query.mockResolvedValue({ rows: [] });

      const delivery = await deliveryRepository.releaseLease(
        'delivery-1',
        deliveryState.RETRYING,
        '2026-11-13T12:00:00.000Z',
        'error',
        { incrementAttempt: true, requireInFlight: true }
      );

      expect(delivery).toBeNull();
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
      expect(delivery.id).toBe('delivery-1');
    });

    it('should atomically increment attempt count and enforce unexpired lease condition on terminal update', async () => {
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

      const delivery = await deliveryRepository.markTerminal(
        'delivery-1',
        deliveryState.SUCCEEDED,
        { incrementAttempt: true, requireInFlight: true, expectedAttemptCount: 0 }
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(/attempt_count = attempt_count \+ 1.*WHERE id = \$2 AND state = 'IN_FLIGHT' AND lease_until IS NOT NULL AND lease_until >= now\(\) AND attempt_count = \$3/s),
        ['SUCCEEDED', 'delivery-1', 0]
      );
      expect(query.mock.calls[0][0]).not.toContain('lease_until IS NULL OR');
      expect(delivery.attemptCount).toBe(1);
    });

    it('should return null when lease is expired on terminal update', async () => {
      // Expired lease: 0 rows returned
      query.mockResolvedValue({ rows: [] });

      const delivery = await deliveryRepository.markTerminal(
        'delivery-1',
        deliveryState.DEAD,
        { incrementAttempt: true, requireInFlight: true }
      );

      expect(delivery).toBeNull();
    });

    it('should return null when lease deadline is null on terminal update', async () => {
      // Null lease deadline: 0 rows returned
      query.mockResolvedValue({ rows: [] });

      const delivery = await deliveryRepository.markTerminal(
        'delivery-1',
        deliveryState.SUCCEEDED,
        { incrementAttempt: true, requireInFlight: true }
      );

      expect(delivery).toBeNull();
    });

    it('should return null when delivery was already recovered or reassigned on terminal update', async () => {
      // Recovered/reassigned: state is no longer IN_FLIGHT -> 0 rows returned
      query.mockResolvedValue({ rows: [] });

      const delivery = await deliveryRepository.markTerminal(
        'delivery-1',
        deliveryState.SUCCEEDED,
        { incrementAttempt: true, requireInFlight: true }
      );

      expect(delivery).toBeNull();
    });
  });

  describe('stale-worker reassignment fencing', () => {
    it('should fence out stale worker after lease expiration, recovery, and reassignment', async () => {
      // Scenario:
      // 1. Worker A claims attempt 1: expectedAttemptCount = 0.
      // 2. Worker A's lease expires and reaper recovers the delivery (incrementing attempt_count in DB to 1).
      // 3. Worker B claims the delivery for attempt 2: expectedAttemptCount = 1.
      // 4. Worker A wakes up and attempts a success or retry update with expectedAttemptCount = 0.
      //    The database query includes `AND attempt_count = $3` (0). Since DB attempt_count is 1, 0 rows match.
      query.mockImplementation((sql, params) => {
        // Check for Worker A's stale terminal update (attempt_count = 0)
        if (params.includes('delivery-1') && params.includes(0)) {
          return Promise.resolve({ rows: [] }); // zero rows affected
        }
        // Check for Worker B's valid terminal update (attempt_count = 1)
        if (params.includes('delivery-1') && params.includes(1)) {
          return Promise.resolve({
            rows: [
              {
                id: 'delivery-1',
                state: 'SUCCEEDED',
                updated_at: new Date(),
                created_at: new Date(),
                event_id: 'event-1',
                endpoint_id: 'endpoint-1',
                seq: 1,
                attempt_count: 2,
                next_attempt_at: new Date(),
                lease_until: null,
                last_error: null,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      // Worker A attempts stale terminal update
      const staleSuccess = await deliveryRepository.markTerminal(
        'delivery-1',
        deliveryState.SUCCEEDED,
        { incrementAttempt: true, requireInFlight: true, expectedAttemptCount: 0 }
      );
      expect(staleSuccess).toBeNull();

      // Worker A attempts stale retry update
      const staleRetry = await deliveryRepository.releaseLease(
        'delivery-1',
        deliveryState.RETRYING,
        '2026-11-14T12:00:00.000Z',
        'error',
        { incrementAttempt: true, requireInFlight: true, expectedAttemptCount: 0 }
      );
      expect(staleRetry).toBeNull();

      // Worker B executes valid terminal update with expectedAttemptCount = 1
      const validSuccess = await deliveryRepository.markTerminal(
        'delivery-1',
        deliveryState.SUCCEEDED,
        { incrementAttempt: true, requireInFlight: true, expectedAttemptCount: 1 }
      );
      expect(validSuccess).not.toBeNull();
      expect(validSuccess.id).toBe('delivery-1');
      expect(validSuccess.state.toString()).toBe('SUCCEEDED');
      expect(validSuccess.attemptCount).toBe(2);
    });

    it('should increment attempt_count exactly once on normal successful outcome', async () => {
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

      const delivery = await deliveryRepository.markTerminal(
        'delivery-1',
        deliveryState.SUCCEEDED,
        { incrementAttempt: true, requireInFlight: true, expectedAttemptCount: 0 }
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(/attempt_count = attempt_count \+ 1.*WHERE id = \$2 AND state = 'IN_FLIGHT'.*AND attempt_count = \$3/s),
        ['SUCCEEDED', 'delivery-1', 0]
      );
      expect(delivery.attemptCount).toBe(1);
    });

    it('should increment attempt_count exactly once on normal retry outcome', async () => {
      const mockRow = {
        id: 'delivery-1',
        state: 'RETRYING',
        next_attempt_at: new Date(),
        last_error: 'transient failure',
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
        '2026-11-14T12:00:00.000Z',
        'transient failure',
        { incrementAttempt: true, requireInFlight: true, expectedAttemptCount: 0 }
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(/attempt_count = attempt_count \+ 1.*WHERE id = \$4 AND state = 'IN_FLIGHT'.*AND attempt_count = \$5/s),
        ['RETRYING', '2026-11-14T12:00:00.000Z', 'transient failure', 'delivery-1', 0]
      );
      expect(delivery.attemptCount).toBe(1);
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
          endpoint_url: 'https://example.com/target',
          last_status_code: 502,
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
      expect(deliveries[0].endpointUrl).toBe('https://example.com/target');
      expect(deliveries[0].lastStatusCode).toBe(502);
    });

    it('should use set-based CTE with DISTINCT ON instead of correlated subquery', async () => {
      query.mockResolvedValue({ rows: [] });

      await deliveryRepository.findByState(deliveryState.DEAD, 'tenant-1', 50);

      const executedSql = query.mock.calls[0][0];
      expect(executedSql).toContain('WITH filtered_deliveries AS');
      expect(executedSql).toContain('latest_attempts AS');
      expect(executedSql).toContain('SELECT DISTINCT ON (a.delivery_id)');
      expect(executedSql).toContain('LEFT JOIN latest_attempts la ON fd.id = la.delivery_id');
      expect(executedSql).not.toContain('(SELECT a.status_code FROM delivery_attempts');
    });

    it('should support offset pagination and endpoint filtering in findByState', async () => {
      query.mockResolvedValue({ rows: [] });

      await deliveryRepository.findByState(deliveryState.DEAD, 'tenant-1', 25, {
        offset: 50,
        endpointId: 'ep-abc',
      });

      const executedSql = query.mock.calls[0][0];
      const params = query.mock.calls[0][1];

      expect(executedSql).toContain('AND d.endpoint_id = $4');
      expect(executedSql).toContain('OFFSET $5');
      expect(params).toEqual(['DEAD', 'tenant-1', 25, 'ep-abc', 50]);
    });
  });

  describe('findAllByTenant', () => {
    it('should query all deliveries for tenant with set-based latest attempts', async () => {
      query.mockResolvedValue({ rows: [] });

      await deliveryRepository.findAllByTenant('tenant-1', 100);

      const executedSql = query.mock.calls[0][0];
      expect(executedSql).toContain('WITH filtered_deliveries AS');
      expect(executedSql).toContain('WHERE e.tenant_id = $1');
      expect(executedSql).toContain('latest_attempts AS');
      expect(executedSql).toContain('SELECT DISTINCT ON (a.delivery_id)');
      expect(executedSql).not.toContain('(SELECT a.status_code FROM delivery_attempts');
      expect(query.mock.calls[0][1]).toEqual(['tenant-1', 100]);
    });

    it('should support offset and endpoint filtering in findAllByTenant', async () => {
      query.mockResolvedValue({ rows: [] });

      await deliveryRepository.findAllByTenant('tenant-1', 50, {
        offset: 100,
        endpointId: 'ep-test',
      });

      const executedSql = query.mock.calls[0][0];
      const params = query.mock.calls[0][1];

      expect(executedSql).toContain('AND d.endpoint_id = $3');
      expect(executedSql).toContain('OFFSET $4');
      expect(params).toEqual(['tenant-1', 50, 'ep-test', 100]);
    });
  });

  describe('findById and findByIdAndTenant', () => {
    it('should resolve latest attempt status code via set-based query', async () => {
      const mockRow = {
        id: 'delivery-1',
        event_id: 'event-1',
        endpoint_id: 'endpoint-1',
        endpoint_url: 'https://example.com/target',
        last_status_code: 200,
        seq: 1,
        state: 'SUCCEEDED',
        attempt_count: 2,
        next_attempt_at: new Date(),
        lease_until: null,
        last_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const delivery = await deliveryRepository.findByIdAndTenant('delivery-1', 'tenant-1');

      expect(delivery.lastStatusCode).toBe(200);
      const executedSql = query.mock.calls[0][0];
      expect(executedSql).toContain('WITH target_delivery AS');
      expect(executedSql).toContain('WHERE d.id = $1 AND e.tenant_id = $2');
      expect(executedSql).toContain('SELECT DISTINCT ON (a.delivery_id)');
      expect(executedSql).toContain('LEFT JOIN latest_attempt la ON td.id = la.delivery_id');
      expect(executedSql).not.toContain('(SELECT a.status_code FROM delivery_attempts');
    });

    it('should map lastStatusCode to null when delivery has no recorded attempts', async () => {
      const mockRow = {
        id: 'delivery-new',
        event_id: 'event-1',
        endpoint_id: 'endpoint-1',
        endpoint_url: 'https://example.com/target',
        last_status_code: null,
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

      const delivery = await deliveryRepository.findById('delivery-new');

      expect(delivery.lastStatusCode).toBeNull();
      expect(delivery.attemptCount).toBe(0);
    });
  });

  describe('findDeliveries and countDeliveries', () => {
    it('should find deliveries with dynamic filters, sorting, and pagination', async () => {
      query.mockResolvedValue({ rows: [] });

      await deliveryRepository.findDeliveries('tenant-1', {
        state: 'DEAD',
        endpointId: 'ep-123',
        eventId: 'ev-456',
        search: 'timeout',
        limit: 20,
        offset: 40,
        sortBy: 'seq',
        sortOrder: 'ASC',
      });

      const executedSql = query.mock.calls[0][0];
      const params = query.mock.calls[0][1];

      expect(executedSql).toContain('e.tenant_id = $1');
      expect(executedSql).toContain('d.state = $2');
      expect(executedSql).toContain('d.endpoint_id = $3');
      expect(executedSql).toContain('d.event_id = $4');
      expect(executedSql).toContain('(d.id::text ILIKE $5 OR e.url ILIKE $5 OR d.last_error ILIKE $5)');
      expect(executedSql).toContain('ORDER BY d.seq ASC');
      expect(executedSql).toContain('LIMIT $6 OFFSET $7');
      expect(params).toEqual([
        'tenant-1',
        'DEAD',
        'ep-123',
        'ev-456',
        '%timeout%',
        20,
        40,
      ]);
    });

    it('should count deliveries matching filters', async () => {
      query.mockResolvedValue({ rows: [{ count: '42' }] });

      const total = await deliveryRepository.countDeliveries('tenant-1', {
        state: 'SUCCEEDED',
        endpointId: 'ep-123',
      });

      expect(total).toBe(42);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*)::bigint AS count'),
        ['tenant-1', 'SUCCEEDED', 'ep-123']
      );
    });
  });

  describe('findDueEndpoints', () => {
    it('should delegate findDueEndpoints to endpointRepository', async () => {
      const mockRow = {
        id: 'endpoint-1',
        tenant_id: 'tenant-1',
        url: 'https://example.com/webhook',
        secret: 'whsec_test',
        active: true,
        rate_limit_rps: 10,
        next_seq: 1,
        circuit_state: 'CLOSED',
        circuit_until: null,
        consecutive_failures: 0,
        created_at: new Date(),
        earliest_due: new Date(),
      };

      query.mockResolvedValue({ rows: [mockRow] });

      const dueEndpoints = await deliveryRepository.findDueEndpoints(10);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT\n      e.*,\n      MIN(d.next_attempt_at) AS earliest_due'),
        [10]
      );
      expect(dueEndpoints).toHaveLength(1);
      expect(dueEndpoints[0].id).toBe('endpoint-1');
    });
  });

  describe('recoverExpiredLeasesBatch', () => {
    it('should recover expired leases batch using FOR UPDATE SKIP LOCKED and increment attempt count', async () => {
      const mockNow = new Date('2026-11-13T12:00:00.000Z');
      const mockRecoveredRows = [
        {
          id: 'del-1',
          endpoint_id: 'ep-1',
          seq: 1,
          state: 'RETRYING',
          attempt_count: 2,
        },
        {
          id: 'del-2',
          endpoint_id: 'ep-2',
          seq: 1,
          state: 'DEAD',
          attempt_count: 8,
        },
      ];

      query.mockResolvedValue({ rows: mockRecoveredRows });

      const recovered = await deliveryRepository.recoverExpiredLeasesBatch(mockNow, 50, 8);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WITH expired_candidates AS'),
        [mockNow, 50, 8]
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE SKIP LOCKED'),
        [mockNow, 50, 8]
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('CASE\n          WHEN d.attempt_count + 1 >= $3 THEN \'DEAD\'\n          ELSE \'RETRYING\'\n        END'),
        [mockNow, 50, 8]
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('attempt_count = d.attempt_count + 1'),
        [mockNow, 50, 8]
      );
      expect(recovered).toEqual([
        {
          id: 'del-1',
          endpointId: 'ep-1',
          seq: 1,
          state: 'RETRYING',
          attemptCount: 2,
        },
        {
          id: 'del-2',
          endpointId: 'ep-2',
          seq: 1,
          state: 'DEAD',
          attemptCount: 8,
        },
      ]);
    });

    it('should simulate repeated worker crashes until reaching retry limit', async () => {
      const maxAttempts = 3;
      const now = new Date('2026-11-14T12:00:00.000Z');

      // Crash 1: attempt_count was 0, recovered to RETRYING with attempt_count 1
      query.mockResolvedValueOnce({
        rows: [
          { id: 'del-crash', endpoint_id: 'ep-1', seq: 1, state: 'RETRYING', attempt_count: 1 },
        ],
      });
      const recovery1 = await deliveryRepository.recoverExpiredLeasesBatch(now, 10, maxAttempts);
      expect(recovery1[0].state).toBe('RETRYING');
      expect(recovery1[0].attemptCount).toBe(1);

      // Crash 2: attempt_count was 1, recovered to RETRYING with attempt_count 2
      query.mockResolvedValueOnce({
        rows: [
          { id: 'del-crash', endpoint_id: 'ep-1', seq: 1, state: 'RETRYING', attempt_count: 2 },
        ],
      });
      const recovery2 = await deliveryRepository.recoverExpiredLeasesBatch(now, 10, maxAttempts);
      expect(recovery2[0].state).toBe('RETRYING');
      expect(recovery2[0].attemptCount).toBe(2);

      // Crash 3: attempt_count was 2, recovered to DEAD with attempt_count 3 (maxAttempts reached)
      query.mockResolvedValueOnce({
        rows: [
          { id: 'del-crash', endpoint_id: 'ep-1', seq: 1, state: 'DEAD', attempt_count: 3 },
        ],
      });
      const recovery3 = await deliveryRepository.recoverExpiredLeasesBatch(now, 10, maxAttempts);
      expect(recovery3[0].state).toBe('DEAD');
      expect(recovery3[0].attemptCount).toBe(3);
    });

    it('should return empty array when no expired leases exist', async () => {
      query.mockResolvedValue({ rows: [] });

      const recovered = await deliveryRepository.recoverExpiredLeasesBatch(Date.now());

      expect(recovered).toEqual([]);
    });

    it('should propagate database errors', async () => {
      query.mockRejectedValue(new Error('Connection failure'));

      await expect(
        deliveryRepository.recoverExpiredLeasesBatch(Date.now())
      ).rejects.toThrow('Connection failure');
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
