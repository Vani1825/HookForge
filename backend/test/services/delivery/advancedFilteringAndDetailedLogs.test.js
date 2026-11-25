/**
 * Comprehensive tests for Phase 2 - Vani's Task 2: Advanced Filtering & Detailed Logs (Backend).
 * Covers:
 *  - Part A: Advanced delivery filtering combinations, validation, pagination, totals, SQL safety.
 *  - Part B: Detailed delivery logs, attempt history, diagnostics, lifecycle, sensitive data redaction, bounds.
 *  - Tenant isolation and missing delivery error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import deliveriesRouter from '../../../src/routes/deliveries.js';
import deliveryService from '../../../src/services/delivery/deliveryService.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import eventRepository from '../../../src/repositories/jdbc/eventRepository.js';
import endpointRepository from '../../../src/repositories/jdbc/endpointRepository.js';
import { query } from '../../../src/config/database.js';
import {
  isSensitiveKey,
  redactSensitiveData,
  sanitizeErrorMessage,
  sanitizeUrl,
  classifyFailure,
  getFailureRecommendation,
} from '../../../src/utils/redaction.js';
import { deliveryState } from '../../../src/domain/deliveryState.js';

vi.mock('../../../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../../src/repositories/jdbc/deliveryRepository.js', () => {
  const repo = {
    findByIdAndTenant: vi.fn(),
    findAttemptsByDeliveryId: vi.fn(),
    findWithFilters: vi.fn(),
    releaseLease: vi.fn(),
    markTerminal: vi.fn(),
    recordAttempt: vi.fn(),
  };
  return {
    default: repo,
    ...repo,
  };
});

vi.mock('../../../src/repositories/jdbc/eventRepository.js', () => {
  const repo = {
    findById: vi.fn(),
    insert: vi.fn(),
  };
  return {
    default: repo,
    ...repo,
  };
});

vi.mock('../../../src/repositories/jdbc/endpointRepository.js', () => {
  const repo = {
    findByIdAndTenant: vi.fn(),
    allocate: vi.fn(),
  };
  return {
    default: repo,
    ...repo,
  };
});

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mock authenticated tenant middleware
  app.use((req, res, next) => {
    req.tenantId = '123e4567-e89b-12d3-a456-426614174000';
    next();
  });

  app.use('/deliveries', deliveriesRouter);
  return app;
}

describe("Phase 2 – Vani's Task 2: Advanced Filtering & Detailed Logs (Backend)", () => {
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockDeliveryId = '987e6543-e89b-12d3-a456-426614174999';
  const mockEndpointId = '111e6543-e89b-12d3-a456-426614174111';
  const mockEventId = '222e6543-e89b-12d3-a456-426614174222';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: Redaction & Sanitization Utilities
  // =========================================================================
  describe('1. Redaction and Sanitization Utilities', () => {
    it('detects sensitive credential keys accurately', () => {
      expect(isSensitiveKey('password')).toBe(true);
      expect(isSensitiveKey('secret')).toBe(true);
      expect(isSensitiveKey('api_key')).toBe(true);
      expect(isSensitiveKey('apiKey')).toBe(true);
      expect(isSensitiveKey('authorization')).toBe(true);
      expect(isSensitiveKey('token')).toBe(true);
      expect(isSensitiveKey('access_token')).toBe(true);
      expect(isSensitiveKey('card')).toBe(true);
      expect(isSensitiveKey('credit_card')).toBe(true);
      expect(isSensitiveKey('cvv')).toBe(true);
      expect(isSensitiveKey('signing_secret')).toBe(true);
      expect(isSensitiveKey('normal_field')).toBe(false);
      expect(isSensitiveKey('endpoint_url')).toBe(false);
    });

    it('redacts sensitive values in nested payloads while preserving non-sensitive data', () => {
      const payload = {
        event: 'user.created',
        user: {
          id: 'usr_123',
          email: 'test@example.com',
          password: 'plainTextPassword123!',
          api_token: 'secret_tok_xyz',
          profile: {
            name: 'Alice',
            creditCard: {
              card: '4111111111111111',
              cvv: '123',
            },
          },
        },
        metadata: {
          source: 'checkout',
        },
      };

      const redacted = redactSensitiveData(payload);
      expect(redacted.event).toBe('user.created');
      expect(redacted.user.id).toBe('usr_123');
      expect(redacted.user.email).toBe('test@example.com');
      expect(redacted.user.password).toBe('[REDACTED]');
      expect(redacted.user.api_token).toBe('[REDACTED]');
      expect(redacted.user.profile.name).toBe('Alice');
      expect(redacted.user.profile.creditCard.card).toBe('[REDACTED]');
      expect(redacted.user.profile.creditCard.cvv).toBe('[REDACTED]');
      expect(redacted.metadata.source).toBe('checkout');
    });

    it('bounds oversized strings and deeply nested objects in payloads', () => {
      const hugeString = 'A'.repeat(3000);
      const data = {
        message: hugeString,
        nested: {
          l1: { l2: { l3: { l4: { l5: 'too deep' } } } },
        },
      };

      const bounded = redactSensitiveData(data, 4, 50);
      expect(bounded.message).toHaveLength(50 + '... [TRUNCATED]'.length);
      expect(bounded.message).toContain('... [TRUNCATED]');
      expect(bounded.nested.l1.l2.l3.l4).toBe('[NESTED_OBJECT_TRUNCATED]');
    });

    it('sanitizes error messages by stripping stack traces, Bearer tokens, DB credentials, and private IPs', () => {
      const rawError =
        'Connection to 10.0.1.55:8080 timed out with Bearer eyJhbGciOiJIUzI1NiJ9.testToken and postgres://app_user:s3cr3tP@ss@db.internal:5432/hookforge_db\n' +
        '    at Client.connect (/app/node_modules/pg/lib/client.js:100:10)\n' +
        '    at Connection.query (/app/src/db.js:45:12)';

      const sanitized = sanitizeErrorMessage(rawError);
      expect(sanitized).not.toContain('s3cr3tP@ss');
      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(sanitized).not.toContain('10.0.1.55');
      expect(sanitized).not.toContain('at Client.connect');
      expect(sanitized).toContain('postgres://[REDACTED]@[REDACTED]');
      expect(sanitized).toContain('Bearer [REDACTED]');
      expect(sanitized).toContain('[PRIVATE_IP]:8080');
    });

    it('sanitizes query parameters containing secrets in URLs', () => {
      const rawUrl = 'https://api.partner.com/webhook?token=mySecret123&apiKey=key_abc&id=42';
      const cleanUrl = sanitizeUrl(rawUrl);
      expect(cleanUrl).toContain('token=%5BREDACTED%5D');
      expect(cleanUrl).toContain('apiKey=%5BREDACTED%5D');
      expect(cleanUrl).toContain('id=42');
      expect(cleanUrl).not.toContain('mySecret123');
      expect(cleanUrl).not.toContain('key_abc');
    });

    it('correctly classifies failure categories and provides actionable advice', () => {
      expect(classifyFailure(null, 200)).toBe('SUCCESS');
      expect(classifyFailure('Rate limited', 429)).toBe('RATE_LIMITED_429');
      expect(classifyFailure('Unauthorized', 401)).toBe('CLIENT_ERROR_4XX');
      expect(classifyFailure('Internal Error', 502)).toBe('SERVER_ERROR_5XX');
      expect(classifyFailure('connect ETIMEDOUT 1.2.3.4', null)).toBe('TIMEOUT');
      expect(classifyFailure('getaddrinfo ENOTFOUND host.invalid', null)).toBe('NETWORK_ERROR');
      expect(classifyFailure('Destination IP blocked by SSRF protection', null)).toBe('BLOCKED_SSRF');

      const timeoutAdvice = getFailureRecommendation('TIMEOUT', null);
      expect(timeoutAdvice).toContain('took too long to acknowledge');

      const rateLimitAdvice = getFailureRecommendation('RATE_LIMITED_429', 429);
      expect(rateLimitAdvice).toContain('rate-limiting webhook dispatches');
    });
  });

  // =========================================================================
  // SECTION 2: Repository Level findWithFilters SQL Construction & Parameters
  // =========================================================================
  describe('2. DeliveryRepository findWithFilters SQL Query Construction', () => {
    it('applies multiple filters simultaneously: state, endpoint, event type, date range, status code, attempt bounds, search', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ count: 12 }] }) // count query
        .mockResolvedValueOnce({ rows: [] }); // data query

      // Import unmocked actual findWithFilters from deliveryRepository module implementation
      const { findWithFilters } = await vi.importActual(
        '../../../src/repositories/jdbc/deliveryRepository.js'
      );

      const filters = {
        state: 'DEAD',
        endpointId: mockEndpointId,
        eventId: mockEventId,
        eventType: 'invoice.paid',
        created_after: '2026-11-01T00:00:00Z',
        created_before: '2026-11-20T23:59:59Z',
        statusCode: 504,
        minAttempts: 2,
        maxAttempts: 5,
        q: 'payment-gateway',
        sortBy: 'seq',
        sortOrder: 'ASC',
      };

      const pagination = {
        page: 2,
        pageSize: 10,
        sortBy: 'seq',
        sortOrder: 'ASC',
      };

      const result = await findWithFilters(mockTenantId, filters, pagination);

      expect(result.totalRecords).toBe(12);

      // Verify count SQL
      const countSql = query.mock.calls[0][0];
      const countParams = query.mock.calls[0][1];

      expect(countSql).toContain('FROM deliveries d');
      expect(countSql).toContain('JOIN endpoints e ON d.endpoint_id = e.id');
      expect(countSql).toContain('JOIN events ev ON d.event_id = ev.id');
      expect(countSql).toContain('e.tenant_id = $1');
      expect(countSql).toContain('d.state = $2');
      expect(countSql).toContain('d.endpoint_id = $3');
      expect(countSql).toContain('d.event_id = $4');
      expect(countSql).toContain("ev.payload->>'type' = $5");
      expect(countSql).toContain('d.created_at >= $6');
      expect(countSql).toContain('d.created_at <= $7');
      expect(countSql).toContain('EXISTS (\n        SELECT 1 FROM delivery_attempts da\n        WHERE da.delivery_id = d.id AND da.status_code = $8\n      )');
      expect(countSql).toContain('d.attempt_count >= $9');
      expect(countSql).toContain('d.attempt_count <= $10');
      expect(countSql).toContain('ILIKE $11');

      expect(countParams).toEqual([
        mockTenantId,
        'DEAD',
        mockEndpointId,
        mockEventId,
        'invoice.paid',
        '2026-11-01T00:00:00Z',
        '2026-11-20T23:59:59Z',
        504,
        2,
        5,
        '%payment-gateway%',
      ]);

      // Verify data SQL contains CTE, ORDER BY, LIMIT, and OFFSET
      const dataSql = query.mock.calls[1][0];
      const dataParams = query.mock.calls[1][1];

      expect(dataSql).toContain('WITH filtered_deliveries AS');
      expect(dataSql).toContain('latest_attempts AS');
      expect(dataSql).toContain('ORDER BY d.seq ASC');
      expect(dataSql).toContain('LIMIT $12 OFFSET $13');

      // limit: 10, offset for page 2: (2-1)*10 = 10
      expect(dataParams).toEqual([...countParams, 10, 10]);
    });

    it('supports comma-separated multiple states (e.g. DEAD,RETRYING)', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })
        .mockResolvedValueOnce({ rows: [] });

      const { findWithFilters } = await vi.importActual(
        '../../../src/repositories/jdbc/deliveryRepository.js'
      );

      await findWithFilters(
        mockTenantId,
        { state: 'DEAD,RETRYING' },
        { page: 1, pageSize: 20 }
      );

      const countSql = query.mock.calls[0][0];
      const countParams = query.mock.calls[0][1];

      expect(countSql).toContain('d.state = ANY($2::text[])');
      expect(countParams[1]).toEqual(['DEAD', 'RETRYING']);
    });

    it('supports status code class filtering such as 5xx, 4xx, and 2xx', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ count: 3 }] })
        .mockResolvedValueOnce({ rows: [] });

      const { findWithFilters } = await vi.importActual(
        '../../../src/repositories/jdbc/deliveryRepository.js'
      );

      await findWithFilters(
        mockTenantId,
        { statusCode: '5xx' },
        { page: 1, pageSize: 20 }
      );

      const countSql = query.mock.calls[0][0];
      expect(countSql).toContain('da.status_code >= 500 AND da.status_code <= 599');
    });

    it('safely escapes SQL special characters in text search queries', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      const { findWithFilters } = await vi.importActual(
        '../../../src/repositories/jdbc/deliveryRepository.js'
      );

      await findWithFilters(
        mockTenantId,
        { q: '100%_discount\\promo' },
        { page: 1, pageSize: 20 }
      );

      const countParams = query.mock.calls[0][1];
      expect(countParams[1]).toBe('%100\\%\\_discount\\\\promo%');
    });
  });

  // =========================================================================
  // SECTION 3: Service Layer Detailed Logs & Diagnostics
  // =========================================================================
  describe('3. DeliveryService Detailed Logs & Diagnostics', () => {
    const rawDelivery = {
      id: mockDeliveryId,
      eventId: mockEventId,
      endpointId: mockEndpointId,
      endpointUrl: 'https://webhook.customer.org/endpoint',
      seq: 1,
      state: deliveryState.DEAD,
      attemptCount: 3,
      scheduledAt: null,
      nextAttemptAt: null,
      lastError: 'HTTP 500 Internal Server Error: database connection pool exhausted',
      lastStatusCode: 500,
      createdAt: '2026-11-25T01:00:00.000Z',
      updatedAt: '2026-11-25T01:05:00.000Z',
    };

    const rawAttempts = [
      {
        id: 101,
        deliveryId: mockDeliveryId,
        attemptNo: 1,
        startedAt: '2026-11-25T01:00:05.000Z',
        statusCode: 500,
        latencyMs: 140,
        error: 'HTTP 500 Server Error',
      },
      {
        id: 102,
        deliveryId: mockDeliveryId,
        attemptNo: 2,
        startedAt: '2026-11-25T01:01:05.000Z',
        statusCode: 500,
        latencyMs: 130,
        error: 'HTTP 500 Server Error',
      },
      {
        id: 103,
        deliveryId: mockDeliveryId,
        attemptNo: 3,
        startedAt: '2026-11-25T01:05:00.000Z',
        statusCode: 500,
        latencyMs: 150,
        error: 'HTTP 500 Internal Server Error: database connection pool exhausted',
      },
    ];

    const rawEvent = {
      id: mockEventId,
      tenantId: mockTenantId,
      idempotencyKey: 'idem_key_999',
      createdAt: '2026-11-25T00:59:59.000Z',
      payloadJson: JSON.stringify({
        type: 'order.placed',
        orderId: 'ord_123',
        customer: {
          name: 'Bob',
          apiKey: 'super_secret_token_abc',
        },
      }),
    };

    const rawEndpoint = {
      id: mockEndpointId,
      tenantId: mockTenantId,
      url: 'https://webhook.customer.org/endpoint?secretToken=hidden123',
      secret: 'whsec_PLAINTEXT_SECRET_NEVER_EXPOSE',
      active: true,
      rateLimitRps: 25,
      circuitState: 'CLOSED',
      retryStrategy: 'EXPONENTIAL',
      retryMaxAttempts: 5,
      retryBaseDelayMs: 2000,
      retryMaxDelayMs: 60000,
      retryBackoffMultiplier: 2.0,
    };

    it('returns enriched delivery details with redacted payload and without exposing endpoint secret', async () => {
      deliveryRepository.findByIdAndTenant.mockResolvedValue(rawDelivery);
      deliveryRepository.findAttemptsByDeliveryId.mockResolvedValue(rawAttempts);
      eventRepository.findById.mockResolvedValue(rawEvent);
      endpointRepository.findByIdAndTenant.mockResolvedValue(rawEndpoint);

      const detailed = await deliveryService.getDeliveryById(mockDeliveryId, mockTenantId);

      expect(detailed).toBeDefined();
      expect(detailed.id).toBe(mockDeliveryId);

      // Event details
      expect(detailed.event).toBeDefined();
      expect(detailed.event.id).toBe(mockEventId);
      expect(detailed.event.eventType).toBe('order.placed');
      expect(detailed.event.payload.orderId).toBe('ord_123');
      expect(detailed.event.payload.customer.apiKey).toBe('[REDACTED]');

      // Endpoint details
      expect(detailed.endpoint).toBeDefined();
      expect(detailed.endpoint.id).toBe(mockEndpointId);
      expect(detailed.endpoint.url).toContain('secretToken=%5BREDACTED%5D');
      expect(detailed.endpoint.secret).toBeUndefined(); // NEVER EXPOSED
      expect(JSON.stringify(detailed)).not.toContain('whsec_PLAINTEXT_SECRET_NEVER_EXPOSE');

      // Retry scheduling metadata
      expect(detailed.retry.strategy).toBe('EXPONENTIAL');
      expect(detailed.retry.maxAttempts).toBe(5);
      expect(detailed.retry.attemptCount).toBe(3);
      expect(detailed.retry.remainingAttempts).toBe(2);
      expect(detailed.retry.isRetryable).toBe(true);

      // Lifecycle metadata
      expect(detailed.lifecycle.state).toBe('DEAD');
      expect(detailed.lifecycle.isTerminal).toBe(true);
      expect(detailed.lifecycle.totalAttempts).toBe(3);
      expect(detailed.lifecycle.durationMs).toBe(300000); // 5 minutes

      // Diagnostics
      expect(detailed.diagnostics.failureCategory).toBe('SERVER_ERROR_5XX');
      expect(detailed.diagnostics.recommendation).toContain('internal error');

      // Attempts list
      expect(detailed.attempts).toHaveLength(3);
      expect(detailed.attempts[0].attemptNo).toBe(1);
      expect(detailed.attempts[0].statusCode).toBe(500);
      expect(detailed.attempts[0].responseSummary).toBe('HTTP 500');
    });

    it('returns attempts history via getDeliveryAttempts', async () => {
      deliveryRepository.findByIdAndTenant.mockResolvedValue(rawDelivery);
      deliveryRepository.findAttemptsByDeliveryId.mockResolvedValue(rawAttempts);
      endpointRepository.findByIdAndTenant.mockResolvedValue(rawEndpoint);

      const attempts = await deliveryService.getDeliveryAttempts(mockDeliveryId, mockTenantId);
      expect(attempts).toHaveLength(3);
      expect(attempts[2].statusCode).toBe(500);
      expect(attempts[2].latencyMs).toBe(150);
    });

    it('enforces tenant isolation and returns null on unauthorized tenant access', async () => {
      deliveryRepository.findByIdAndTenant.mockResolvedValue(null);

      const detailed = await deliveryService.getDeliveryById(mockDeliveryId, 'other-tenant-999');
      expect(detailed).toBeNull();
      expect(deliveryRepository.findByIdAndTenant).toHaveBeenCalledWith(
        mockDeliveryId,
        'other-tenant-999'
      );
    });
  });

  // =========================================================================
  // SECTION 4: HTTP API Route Validation & Integration
  // =========================================================================
  describe('4. Delivery HTTP Routes Integration & Edge Cases', () => {
    let app;

    beforeEach(() => {
      app = createTestApp();
    });

    it('GET /deliveries supports advanced filters and passes them to service', async () => {
      vi.spyOn(deliveryService, 'queryDeliveries').mockResolvedValue({
        deliveries: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      });

      const response = await request(app).get(
        '/deliveries?state=RETRYING&status_code=504&min_attempts=2&max_attempts=4&event_type=payment.succeeded&sortBy=seq&sortOrder=ASC'
      );

      expect(response.status).toBe(200);
      expect(deliveryService.queryDeliveries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          state: 'RETRYING',
          status_code: '504',
          min_attempts: '2',
          max_attempts: '4',
          event_type: 'payment.succeeded',
        }),
        expect.objectContaining({
          page: 1,
          pageSize: 20,
          sortBy: 'seq',
          sortOrder: 'ASC',
        })
      );
    });

    it('rejects invalid status code query parameters with 400 Bad Request', async () => {
      const response = await request(app).get('/deliveries?status_code=99');
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('status_code');
    });

    it('rejects invalid attempt count parameters with 400 Bad Request', async () => {
      const response = await request(app).get('/deliveries?min_attempts=-5');
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('min_attempts');
    });

    it('rejects reversed attempt bounds with 400 Bad Request (min > max)', async () => {
      const response = await request(app).get('/deliveries?min_attempts=5&max_attempts=2');
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('min_attempts cannot be greater than max_attempts');
    });

    it('rejects reversed date range with 400 Bad Request', async () => {
      const response = await request(app).get(
        '/deliveries?created_after=2026-11-20T00:00:00Z&created_before=2026-11-10T00:00:00Z'
      );
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('created_after cannot be later than created_before');
    });

    it('rejects invalid sortBy column with 400 Bad Request', async () => {
      const response = await request(app).get('/deliveries?sortBy=non_existent_column');
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid sortBy column');
    });

    it('rejects invalid sortOrder with 400 Bad Request', async () => {
      const response = await request(app).get('/deliveries?sortOrder=SIDEWAYS');
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid sortOrder');
    });

    it('GET /deliveries/:id returns 200 with enriched diagnostics and sanitized attempts', async () => {
      vi.spyOn(deliveryService, 'getDeliveryById').mockResolvedValue({
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 1,
        state: 'DEAD',
        attemptCount: 1,
        createdAt: '2026-11-25T00:00:00Z',
        updatedAt: '2026-11-25T00:01:00Z',
        event: {
          id: mockEventId,
          eventType: 'order.created',
          payload: { order_id: '123' },
        },
        endpoint: {
          id: mockEndpointId,
          url: 'https://example.com/webhook',
          active: true,
        },
        retry: {
          strategy: 'EXPONENTIAL',
          maxAttempts: 8,
          remainingAttempts: 7,
        },
        diagnostics: {
          failureCategory: 'SERVER_ERROR_5XX',
          recommendation: 'Check target server logs',
        },
        attempts: [
          {
            id: 1,
            attemptNo: 1,
            statusCode: 500,
            latencyMs: 120,
            error: 'Server error',
          },
        ],
      });

      const response = await request(app).get(`/deliveries/${mockDeliveryId}`);
      expect(response.status).toBe(200);
      expect(response.body.id).toBe(mockDeliveryId);
      expect(response.body.diagnostics.failureCategory).toBe('SERVER_ERROR_5XX');
      expect(response.body.event.eventType).toBe('order.created');
      expect(response.body.attempts).toHaveLength(1);
    });

    it('GET /deliveries/:id returns 404 when delivery is missing or tenant unauthorized', async () => {
      vi.spyOn(deliveryService, 'getDeliveryById').mockResolvedValue(null);

      const response = await request(app).get(`/deliveries/${mockDeliveryId}`);
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not Found');
    });

    it('GET /deliveries/:id/attempts returns attempt history array and totals', async () => {
      vi.spyOn(deliveryService, 'getDeliveryAttempts').mockResolvedValue([
        { id: 1, attemptNo: 1, statusCode: 504, latencyMs: 5000, error: 'Gateway Timeout' },
      ]);

      const response = await request(app).get(`/deliveries/${mockDeliveryId}/attempts`);
      expect(response.status).toBe(200);
      expect(response.body.deliveryId).toBe(mockDeliveryId);
      expect(response.body.totalAttempts).toBe(1);
      expect(response.body.attempts).toHaveLength(1);
      expect(response.body.attempts[0].statusCode).toBe(504);
    });

    it('GET /deliveries/:id/attempts returns 404 for missing delivery', async () => {
      vi.spyOn(deliveryService, 'getDeliveryAttempts').mockResolvedValue(null);

      const response = await request(app).get(`/deliveries/${mockDeliveryId}/attempts`);
      expect(response.status).toBe(404);
    });

    it('GET /deliveries/:id/logs returns comprehensive diagnostic logging view', async () => {
      vi.spyOn(deliveryService, 'getDeliveryLogs').mockResolvedValue({
        id: mockDeliveryId,
        state: 'DEAD',
        endpoint: { id: mockEndpointId, url: 'https://test.net/hook' },
        event: { id: mockEventId, eventType: 'test.event' },
        lifecycle: { state: 'DEAD', totalAttempts: 4 },
        retry: { isRetryable: true },
        diagnostics: { failureCategory: 'TIMEOUT' },
        attempts: [{ id: 1, attemptNo: 1, error: 'Timeout' }],
      });

      const response = await request(app).get(`/deliveries/${mockDeliveryId}/logs`);
      expect(response.status).toBe(200);
      expect(response.body.deliveryId).toBe(mockDeliveryId);
      expect(response.body.diagnostics.failureCategory).toBe('TIMEOUT');
      expect(response.body.attempts).toHaveLength(1);
    });
  });
});
