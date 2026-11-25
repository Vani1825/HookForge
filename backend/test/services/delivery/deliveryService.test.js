/**
 * Tests for DeliveryService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import deliveryService from '../../../src/services/delivery/deliveryService.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import endpointRepository from '../../../src/repositories/jdbc/endpointRepository.js';
import eventRepository from '../../../src/repositories/jdbc/eventRepository.js';
import attemptExecutor from '../../../src/services/delivery/attemptExecutor.js';
import { handleOutcome } from '../../../src/services/delivery/outcomeHandler.js';
import { shouldAttempt } from '../../../src/services/resilience/thresholdCircuitBreaker.js';
import { tryAcquire } from '../../../src/services/resilience/tokenBucketRateLimiter.js';
import { deliveryState } from '../../../src/domain/deliveryState.js';
import { deliveryOutcome } from '../../../src/domain/deliveryOutcome.js';
import { IllegalStateTransitionError } from '../../../src/domain/errors/illegalStateTransitionError.js';

// Mock dependencies
vi.mock('../../../src/repositories/jdbc/deliveryRepository.js');
vi.mock('../../../src/repositories/jdbc/endpointRepository.js');
vi.mock('../../../src/repositories/jdbc/eventRepository.js');
vi.mock('../../../src/services/delivery/attemptExecutor.js');
vi.mock('../../../src/services/delivery/outcomeHandler.js');
vi.mock('../../../src/services/resilience/thresholdCircuitBreaker.js');
vi.mock('../../../src/services/resilience/tokenBucketRateLimiter.js');

describe('DeliveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDeliveriesByEvent', () => {
    it('should return deliveries for an event with tenant scope', async () => {
      const mockDeliveries = [
        { id: 'delivery-1', eventId: 'event-1', endpointId: 'endpoint-1', seq: 1 },
        { id: 'delivery-2', eventId: 'event-1', endpointId: 'endpoint-2', seq: 2 },
      ];

      deliveryRepository.findByEvent.mockResolvedValue(mockDeliveries);

      const deliveries = await deliveryService.getDeliveriesByEvent('event-1', 'tenant-1');

      expect(deliveryRepository.findByEvent).toHaveBeenCalledWith('event-1', 'tenant-1');
      expect(deliveries).toEqual(mockDeliveries);
    });
  });

  describe('getDeliveriesByState', () => {
    it('should return deliveries by state with tenant scope', async () => {
      const mockDeliveries = [
        { id: 'delivery-1', state: deliveryState.DEAD },
        { id: 'delivery-2', state: deliveryState.DEAD },
      ];

      deliveryRepository.findByState.mockResolvedValue(mockDeliveries);

      const deliveries = await deliveryService.getDeliveriesByState('DEAD', 'tenant-1', 100);

      expect(deliveryRepository.findByState).toHaveBeenCalledWith(deliveryState.DEAD, 'tenant-1', 100);
      expect(deliveries).toEqual(mockDeliveries);
    });

    it('should use default limit of 100', async () => {
      deliveryRepository.findByState.mockResolvedValue([]);

      await deliveryService.getDeliveriesByState('DEAD', 'tenant-1');

      expect(deliveryRepository.findByState).toHaveBeenCalledWith(deliveryState.DEAD, 'tenant-1', 100);
    });
  });

  describe('replayDelivery', () => {
    it('should replay a DEAD delivery', async () => {
      const mockDelivery = {
        id: 'delivery-1',
        eventId: 'event-1',
        endpointId: 'endpoint-1',
        seq: 1,
        state: deliveryState.DEAD,
      };

      const mockUpdated = {
        id: 'delivery-1',
        state: deliveryState.PENDING,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.releaseLease.mockResolvedValue(mockUpdated);

      const result = await deliveryService.replayDelivery('delivery-1', 'tenant-1');

      expect(deliveryRepository.findByIdAndTenant).toHaveBeenCalledWith('delivery-1', 'tenant-1');
      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        'delivery-1',
        deliveryState.PENDING,
        expect.any(String),
        null
      );
      expect(result).toEqual(mockUpdated);
    });

    it('should preserve endpointUrl and lastStatusCode when replaying', async () => {
      const mockDelivery = {
        id: 'delivery-1',
        eventId: 'event-1',
        endpointId: 'endpoint-1',
        endpointUrl: 'https://webhook.example.com/endpoint',
        lastStatusCode: 504,
        seq: 1,
        state: deliveryState.DEAD,
      };

      const mockUpdated = {
        id: 'delivery-1',
        state: deliveryState.PENDING,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.releaseLease.mockResolvedValue(mockUpdated);

      const result = await deliveryService.replayDelivery('delivery-1', 'tenant-1');

      expect(result.endpointUrl).toBe('https://webhook.example.com/endpoint');
      expect(result.lastStatusCode).toBe(504);
    });

    it('should throw 404 when delivery not found', async () => {
      deliveryRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(deliveryService.replayDelivery('delivery-1', 'tenant-1')).rejects.toThrow('Delivery not found');
    });

    it('should throw IllegalStateTransitionError when delivery is not DEAD', async () => {
      const mockDelivery = {
        id: 'delivery-1',
        state: deliveryState.SUCCEEDED,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);

      await expect(deliveryService.replayDelivery('delivery-1', 'tenant-1')).rejects.toThrow(
        IllegalStateTransitionError
      );
    });

    it('should enforce tenant scope', async () => {
      deliveryRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(deliveryService.replayDelivery('delivery-1', 'tenant-1')).rejects.toThrow('Delivery not found');

      expect(deliveryRepository.findByIdAndTenant).toHaveBeenCalledWith('delivery-1', 'tenant-1');
    });
  });

  describe('resendDelivery', () => {
    const mockEndpoint = {
      id: 'endpoint-1',
      tenantId: 'tenant-1',
      url: 'https://webhook.example.com/endpoint',
      rateLimitRps: 10,
    };

    it('should requeue a DEAD delivery as PENDING when immediate is false (default)', async () => {
      const mockDelivery = {
        id: 'delivery-1',
        eventId: 'event-1',
        endpointId: 'endpoint-1',
        seq: 42,
        state: deliveryState.DEAD,
        attemptCount: 3,
        endpointUrl: 'https://webhook.example.com/endpoint',
        lastStatusCode: 500,
      };

      const mockUpdated = {
        id: 'delivery-1',
        eventId: 'event-1',
        endpointId: 'endpoint-1',
        seq: 42,
        state: deliveryState.PENDING,
        attemptCount: 0,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.releaseLease.mockResolvedValue(mockUpdated);

      const result = await deliveryService.resendDelivery('delivery-1', 'tenant-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Delivery queued for resend');
      expect(result.delivery.state).toBe(deliveryState.PENDING);
      expect(result.delivery.seq).toBe(42);
      expect(result.delivery.endpointUrl).toBe('https://webhook.example.com/endpoint');
      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        'delivery-1',
        deliveryState.PENDING,
        expect.any(String),
        null
      );
    });

    it('should allow resending a SUCCEEDED delivery when immediate is false', async () => {
      const mockDelivery = {
        id: 'delivery-2',
        eventId: 'event-2',
        endpointId: 'endpoint-1',
        seq: 15,
        state: deliveryState.SUCCEEDED,
        attemptCount: 1,
      };

      const mockUpdated = {
        id: 'delivery-2',
        eventId: 'event-2',
        endpointId: 'endpoint-1',
        seq: 15,
        state: deliveryState.PENDING,
        attemptCount: 0,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.releaseLease.mockResolvedValue(mockUpdated);

      const result = await deliveryService.resendDelivery('delivery-2', 'tenant-1', { immediate: false });

      expect(result.success).toBe(true);
      expect(result.delivery.state).toBe(deliveryState.PENDING);
      expect(result.delivery.seq).toBe(15);
    });

    it('should allow resending a CANCELLED delivery when immediate is false', async () => {
      const mockDelivery = {
        id: 'delivery-3',
        eventId: 'event-3',
        endpointId: 'endpoint-1',
        seq: 20,
        state: deliveryState.CANCELLED,
        attemptCount: 0,
      };

      const mockUpdated = {
        id: 'delivery-3',
        eventId: 'event-3',
        endpointId: 'endpoint-1',
        seq: 20,
        state: deliveryState.PENDING,
        attemptCount: 0,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.releaseLease.mockResolvedValue(mockUpdated);

      const result = await deliveryService.resendDelivery('delivery-3', 'tenant-1');

      expect(result.success).toBe(true);
      expect(result.delivery.state).toBe(deliveryState.PENDING);
    });

    it('should reject IN_FLIGHT deliveries with IllegalStateTransitionError', async () => {
      const mockDelivery = {
        id: 'delivery-4',
        state: deliveryState.IN_FLIGHT,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);

      await expect(deliveryService.resendDelivery('delivery-4', 'tenant-1')).rejects.toThrow(
        'Delivery is currently in flight and cannot be resent'
      );
    });

    it('should reject deliveries in ineligible states like SCHEDULED', async () => {
      const mockDelivery = {
        id: 'delivery-5',
        state: deliveryState.SCHEDULED,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);

      await expect(deliveryService.resendDelivery('delivery-5', 'tenant-1')).rejects.toThrow(
        /not eligible for resend/
      );
    });

    it('should execute delivery immediately when immediate is true', async () => {
      const mockDelivery = {
        id: 'delivery-6',
        eventId: 'event-1',
        endpointId: 'endpoint-1',
        seq: 10,
        state: deliveryState.DEAD,
        attemptCount: 2,
      };

      const claimedDelivery = {
        ...mockDelivery,
        state: deliveryState.IN_FLIGHT,
      };

      const mockAttempt = {
        deliveryId: 'delivery-6',
        attemptNo: 3,
        startedAt: new Date().toISOString(),
        statusCode: 200,
        latencyMs: 75,
        error: null,
        outcome: deliveryOutcome.SUCCESS,
        responseBody: '{"ok":true}',
        responseHeaders: { 'content-type': 'application/json' },
        requestHeaders: { 'X-Webhook-Id': 'delivery-6', 'X-Webhook-Signature': '[REDACTED]' },
      };

      const finalDelivery = {
        ...mockDelivery,
        state: deliveryState.SUCCEEDED,
        attemptCount: 3,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.claimForImmediateExecution.mockResolvedValue(claimedDelivery);
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);
      shouldAttempt.mockResolvedValue(true);
      tryAcquire.mockResolvedValue(true);
      attemptExecutor.execute.mockResolvedValue(mockAttempt);
      handleOutcome.mockResolvedValue(finalDelivery);

      const result = await deliveryService.resendDelivery('delivery-6', 'tenant-1', { immediate: true });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Delivery resent immediately');
      expect(result.delivery.state).toBe(deliveryState.SUCCEEDED);
      expect(result.attempt).toBeDefined();
      expect(result.attempt.statusCode).toBe(200);
      expect(result.attempt.responseBody).toBe('{"ok":true}');
      expect(attemptExecutor.execute).toHaveBeenCalledWith(claimedDelivery, mockEndpoint);
      expect(handleOutcome).toHaveBeenCalledWith(
        claimedDelivery,
        mockAttempt.outcome,
        mockAttempt,
        mockEndpoint
      );
    });

    it('should handle circuit breaker open during immediate execution', async () => {
      const mockDelivery = {
        id: 'delivery-7',
        endpointId: 'endpoint-1',
        state: deliveryState.DEAD,
        attemptCount: 1,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.claimForImmediateExecution.mockResolvedValue({
        ...mockDelivery,
        state: deliveryState.IN_FLIGHT,
      });
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);
      shouldAttempt.mockResolvedValue(false);
      deliveryRepository.releaseLease.mockResolvedValue({
        ...mockDelivery,
        state: deliveryState.RETRYING,
      });

      const result = await deliveryService.resendDelivery('delivery-7', 'tenant-1', { immediate: true });

      expect(result.success).toBe(false);
      expect(result.blocked).toBe('CIRCUIT_BREAKER_OPEN');
      expect(attemptExecutor.execute).not.toHaveBeenCalled();
    });

    it('should throw 400 when claimForImmediateExecution fails due to concurrent race', async () => {
      const mockDelivery = {
        id: 'delivery-8',
        endpointId: 'endpoint-1',
        state: deliveryState.DEAD,
      };

      deliveryRepository.findByIdAndTenant
        .mockResolvedValueOnce(mockDelivery)
        .mockResolvedValueOnce({ ...mockDelivery, state: deliveryState.IN_FLIGHT });
      deliveryRepository.claimForImmediateExecution.mockResolvedValue(null);

      await expect(
        deliveryService.resendDelivery('delivery-8', 'tenant-1', { immediate: true })
      ).rejects.toThrow('Delivery is currently in flight and cannot be resent');
    });

    it('should throw 404 when delivery not found or tenant unauthorized', async () => {
      deliveryRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(deliveryService.resendDelivery('non-existent', 'tenant-1')).rejects.toThrow(
        'Delivery not found'
      );
    });
  });

  describe('Delivery Inspector attempt details and redaction', () => {
    it('should return sanitized response body and headers in getDeliveryById and getDeliveryAttempts', async () => {
      const mockDelivery = {
        id: 'delivery-inspect-1',
        eventId: 'event-1',
        endpointId: 'endpoint-1',
        seq: 1,
        state: deliveryState.DEAD,
        attemptCount: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
      };

      const mockAttempts = [
        {
          id: 'att-1',
          deliveryId: 'delivery-inspect-1',
          attemptNo: 1,
          startedAt: '2024-01-01T00:00:00Z',
          statusCode: 401,
          latencyMs: 150,
          error: 'Unauthorized',
          responseBody: JSON.stringify({ error: 'Invalid token', secret_token: 'raw_secret_value' }),
          responseHeaders: {
            'content-type': 'application/json',
            'set-cookie': 'secret_cookie_id=12345',
          },
          requestHeaders: {
            'X-Webhook-Id': 'delivery-inspect-1',
            'X-Webhook-Signature': 'raw_hmac_secret_signature',
            'Authorization': 'Bearer raw_token',
          },
        },
      ];

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.findAttemptsByDeliveryId.mockResolvedValue(mockAttempts);
      eventRepository.findById.mockResolvedValue({
        id: 'event-1',
        payload: { event: 'test', api_key: 'top_secret' },
        createdAt: '2024-01-01T00:00:00Z',
      });
      endpointRepository.findByIdAndTenant.mockResolvedValue({
        id: 'endpoint-1',
        url: 'https://webhook.example.com/inspect',
        secret: 'whsec_raw',
      });

      const detailed = await deliveryService.getDeliveryById('delivery-inspect-1', 'tenant-1');

      expect(detailed).toBeDefined();
      expect(detailed.attempts).toHaveLength(1);
      const attempt = detailed.attempts[0];
      // Response body redaction
      expect(attempt.responseBody).toContain('"secret_token":"[REDACTED]"');
      expect(attempt.responseBody).toContain('"error":"Invalid token"');
      // Response headers redaction
      expect(attempt.responseHeaders['set-cookie']).toBe('[REDACTED]');
      expect(attempt.responseHeaders['content-type']).toBe('application/json');
      // Request headers redaction
      expect(attempt.requestHeaders['X-Webhook-Signature']).toBe('[REDACTED]');
      expect(attempt.requestHeaders['Authorization']).toBe('[REDACTED]');
      expect(attempt.requestHeaders['X-Webhook-Id']).toBe('delivery-inspect-1');

      // Top-level request headers
      expect(detailed.request.headers['X-Webhook-Signature']).toBe('[REDACTED]');

      // Check getDeliveryAttempts directly
      const attempts = await deliveryService.getDeliveryAttempts('delivery-inspect-1', 'tenant-1');
      expect(attempts).toHaveLength(1);
      expect(attempts[0].responseHeaders['set-cookie']).toBe('[REDACTED]');
    });
  });

  describe('queryDeliveries', () => {
    it('should query deliveries with default pagination and filters', async () => {
      const mockDeliveries = [
        { id: 'delivery-1', state: deliveryState.DEAD },
      ];
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: mockDeliveries,
        totalRecords: 1,
      });

      const result = await deliveryService.queryDeliveries('tenant-1', { state: 'DEAD' });

      expect(deliveryRepository.findWithFilters).toHaveBeenCalledWith(
        'tenant-1',
        { state: 'DEAD' },
        { page: 1, pageSize: 20 }
      );
      expect(result.deliveries).toEqual(mockDeliveries);
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        totalRecords: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    });

    it('should calculate pagination envelope correctly for multi-page results', async () => {
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: [],
        totalRecords: 45,
      });

      const result = await deliveryService.queryDeliveries(
        'tenant-1',
        {},
        { page: 2, pageSize: 20 }
      );

      expect(result.pagination).toEqual({
        page: 2,
        pageSize: 20,
        totalRecords: 45,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });

    it('should handle zero total records properly', async () => {
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: [],
        totalRecords: 0,
      });

      const result = await deliveryService.queryDeliveries('tenant-1');

      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it('should support arbitrary offset preserving exact skip semantics', async () => {
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: [{ id: 'del-1' }],
        totalRecords: 50,
      });

      const result = await deliveryService.queryDeliveries(
        'tenant-1',
        {},
        { limit: 20, offset: 5 }
      );

      expect(deliveryRepository.findWithFilters).toHaveBeenCalledWith(
        'tenant-1',
        {},
        { page: 1, pageSize: 20, limit: 20, offset: 5 }
      );
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        totalRecords: 50,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
        offset: 5,
      });
    });

    it('should support legacy limit up to 1000 without clamping', async () => {
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: [],
        totalRecords: 500,
      });

      const result = await deliveryService.queryDeliveries(
        'tenant-1',
        {},
        { limit: 500 }
      );

      expect(deliveryRepository.findWithFilters).toHaveBeenCalledWith(
        'tenant-1',
        {},
        { page: 1, pageSize: 500, limit: 500 }
      );
      expect(result.pagination.pageSize).toBe(500);
    });

    it('should enforce parameter precedence: pageSize over limit, page over offset', async () => {
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: [],
        totalRecords: 50,
      });

      const result = await deliveryService.queryDeliveries(
        'tenant-1',
        {},
        { pageSize: 10, limit: 500, page: 2, offset: 5 }
      );

      expect(deliveryRepository.findWithFilters).toHaveBeenCalledWith(
        'tenant-1',
        {},
        { page: 2, pageSize: 10 }
      );
      expect(result.pagination.pageSize).toBe(10);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.offset).toBeUndefined();
    });
  });
});
