/**
 * Unit tests for AttemptExecutor.
 * Tests delivery attempt execution with signing and classification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import config from '../../../src/config/index.js';
import { deliveryOutcome } from '../../../src/domain/deliveryOutcome.js';

vi.mock('../../../src/services/delivery/hmacSha256Signer.js', () => ({
  sign: vi.fn(() => 't=123,v1=abc123'),
}));

vi.mock('../../../src/services/delivery/httpWebhookSender.js', () => ({
  default: {
    send: vi.fn(),
  },
}));

vi.mock('../../../src/services/delivery/defaultResponseClassifier.js', async () => {
  const actual = await vi.importActual('../../../src/services/delivery/defaultResponseClassifier.js');
  return {
    ...actual,
    classify: vi.fn(actual.classify),
  };
});

vi.mock('../../../src/repositories/jdbc/eventRepository.js', () => ({
  findById: vi.fn(() => ({
    id: 'event-1',
    tenantId: 'tenant-1',
    payloadJson: '{"test": "data"}',
    idempotencyKey: 'key-1',
    createdAt: new Date().toISOString(),
  })),
}));

describe('AttemptExecutor', () => {
  let attemptExecutor;

  beforeEach(async () => {
    vi.clearAllMocks();
    attemptExecutor = (await import('../../../src/services/delivery/attemptExecutor.js')).default;
  });

  const mockDelivery = {
    id: 'delivery-123',
    eventId: 'event-1',
    attemptCount: 0,
  };

  const mockEndpoint = {
    id: 'endpoint-1',
    url: 'https://example.com/webhook',
    secret: 'secret123',
  };

  it('should execute delivery attempt with signature', async () => {
    const httpWebhookSender = (await import('../../../src/services/delivery/httpWebhookSender.js')).default;
    httpWebhookSender.send.mockResolvedValue({
      statusCode: 200,
      latencyMs: 100,
      error: null,
    });

    const result = await attemptExecutor.execute(mockDelivery, mockEndpoint);

    expect(httpWebhookSender.send).toHaveBeenCalledWith(
      'https://example.com/webhook',
      '{"test": "data"}',
      expect.objectContaining({
        'X-Webhook-Signature': 't=123,v1=abc123',
      }),
      config.http.connectTimeoutMs + config.http.readTimeoutMs,
      {
        connectTimeoutMs: config.http.connectTimeoutMs,
        readTimeoutMs: config.http.readTimeoutMs,
        maxResponseBytes: config.http.maxResponseBytes,
      }
    );
    expect(result).toHaveProperty('attemptNo', 1);
    expect(result).toHaveProperty('statusCode', 200);
    expect(result.outcome.equals(deliveryOutcome.SUCCESS)).toBe(true);
  });

  it('should classify oversized response failure as RETRY outcome', async () => {
    const httpWebhookSender = (await import('../../../src/services/delivery/httpWebhookSender.js')).default;
    httpWebhookSender.send.mockResolvedValue({
      statusCode: null,
      latencyMs: 120,
      error: `Response size exceeded maximum allowed limit of ${config.http.maxResponseBytes} bytes`,
    });

    const result = await attemptExecutor.execute(mockDelivery, mockEndpoint);

    expect(result).toHaveProperty('statusCode', null);
    expect(result.error).toMatch(/Response size exceeded maximum allowed limit/);
    expect(result.outcome.equals(deliveryOutcome.RETRY)).toBe(true);
    expect(result.outcome.countsAsEndpointFailure()).toBe(true);
  });

  it('should classify timeout failure as RETRY outcome', async () => {
    const httpWebhookSender = (await import('../../../src/services/delivery/httpWebhookSender.js')).default;
    httpWebhookSender.send.mockResolvedValue({
      statusCode: null,
      latencyMs: 13000,
      error: 'Timeout',
    });

    const result = await attemptExecutor.execute(mockDelivery, mockEndpoint);

    expect(result).toHaveProperty('statusCode', null);
    expect(result.error).toBe('Timeout');
    expect(result.outcome.equals(deliveryOutcome.RETRY)).toBe(true);
  });

  it('should sign payload using endpoint.secret', async () => {
    const { sign } = await import('../../../src/services/delivery/hmacSha256Signer.js');
    const httpWebhookSender = (await import('../../../src/services/delivery/httpWebhookSender.js')).default;
    httpWebhookSender.send.mockResolvedValue({
      statusCode: 200,
      latencyMs: 50,
      error: null,
    });

    await attemptExecutor.execute(mockDelivery, {
      id: 'endpoint-2',
      url: 'https://example.com/webhook',
      secret: 'whsec_decrypted_secret_for_delivery',
    });

    expect(sign).toHaveBeenCalledWith(
      'whsec_decrypted_secret_for_delivery',
      '{"test": "data"}',
      expect.any(Number)
    );
  });
});
