/**
 * Unit tests for AttemptExecutor.
 * Tests delivery attempt execution with signing and classification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/delivery/hmacSha256Signer.js', () => ({
  sign: vi.fn(() => 't=123,v1=abc123'),
}));

vi.mock('../../../src/services/delivery/httpWebhookSender.js', () => ({
  default: {
    send: vi.fn(),
  },
}));

vi.mock('../../../src/services/delivery/defaultResponseClassifier.js', () => ({
  classify: vi.fn(() => ({ toString: () => 'SUCCESS' })),
}));

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
      15000 // 5000 + 10000
    );
    expect(result).toHaveProperty('attemptNo', 1);
    expect(result).toHaveProperty('statusCode', 200);
  });
});
