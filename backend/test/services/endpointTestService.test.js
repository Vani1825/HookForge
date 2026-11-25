/**
 * Unit tests for endpointService.testEndpoint.
 * Tests method support, payload generation, HMAC signing, header sanitization,
 * SSRF validation, timeouts, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import endpointRepository from '../../src/repositories/jdbc/endpointRepository.js';
import httpWebhookSender from '../../src/services/delivery/httpWebhookSender.js';
import { testEndpoint } from '../../src/services/endpoint/endpointService.js';

vi.mock('../../src/repositories/jdbc/endpointRepository.js', () => ({
  default: {
    findByIdAndTenant: vi.fn(),
  },
}));

vi.mock('../../src/services/delivery/httpWebhookSender.js', () => ({
  default: {
    send: vi.fn(),
    test: vi.fn(),
  },
  test: vi.fn(),
}));

vi.mock('dns', () => {
  const mockLookup = vi.fn().mockImplementation(async (hostname) => {
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
      return [{ address: '169.254.169.254', family: 4 }];
    }
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      return [{ address: '127.0.0.1', family: 4 }];
    }
    if (hostname === '192.168.1.1' || hostname === 'internal.corp') {
      return [{ address: '192.168.1.1', family: 4 }];
    }
    return [{ address: '93.184.216.34', family: 4 }];
  });
  return {
    default: {
      promises: { lookup: mockLookup },
    },
    promises: { lookup: mockLookup },
  };
});

describe('endpointService.testEndpoint', () => {
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockEndpointId = '987e6543-e89b-12d3-a456-426614174999';
  const mockSecret = 'whsec_testsecret1234567890abcdef';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful endpoint probe', () => {
    it('tests existing endpoint by ID with default payload and HMAC signature', async () => {
      endpointRepository.findByIdAndTenant.mockResolvedValue({
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/webhook',
        secret: mockSecret,
        active: true,
      });

      httpWebhookSender.test.mockResolvedValue({
        statusCode: 200,
        latencyMs: 45,
        error: null,
        headers: { 'content-type': 'application/json' },
        body: '{"status":"ok"}',
        sizeBytes: 15,
        truncated: false,
      });

      const result = await testEndpoint(mockTenantId, {
        endpointId: mockEndpointId,
      });

      expect(endpointRepository.findByIdAndTenant).toHaveBeenCalledWith(
        mockEndpointId,
        mockTenantId
      );
      expect(httpWebhookSender.test).toHaveBeenCalledTimes(1);

      const [targetUrl, payload, headers, timeoutMs, options] = httpWebhookSender.test.mock.calls[0];
      expect(targetUrl).toBe('https://example.com/webhook');
      expect(options.method).toBe('POST');
      expect(timeoutMs).toBe(10000);

      // Verify default payload structure
      const parsedPayload = JSON.parse(payload);
      expect(parsedPayload.event).toBe('endpoint.test');
      expect(parsedPayload.data.endpointId).toBe(mockEndpointId);
      expect(parsedPayload.data.tenantId).toBe(mockTenantId);

      // Verify HMAC headers
      expect(headers['X-Webhook-Id']).toMatch(/^test_/);
      expect(headers['X-Webhook-Timestamp']).toBeDefined();
      expect(headers['X-Webhook-Signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
      expect(headers['X-HookForge-Test']).toBe('true');

      // Verify structured result
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.status_code).toBe(200);
      expect(result.latencyMs).toBe(45);
      expect(result.latency_ms).toBe(45);
      expect(result.error).toBeNull();
      expect(result.response.body).toBe('{"status":"ok"}');
      expect(result.response.truncated).toBe(false);
      expect(result.request.url).toBe('https://example.com/webhook');
      expect(result.request.method).toBe('POST');
    });

    it('tests ad-hoc URL with custom method, headers, and payload', async () => {
      httpWebhookSender.test.mockResolvedValue({
        statusCode: 201,
        latencyMs: 62,
        error: null,
        headers: { 'content-type': 'application/json' },
        body: '{"created":true}',
        sizeBytes: 16,
        truncated: false,
      });

      const customPayload = { orderId: 'ord_123', total: 99.99 };
      const customHeaders = {
        'X-Custom-Header': 'CustomValue',
        'Authorization': 'Bearer secret_token',
      };

      const result = await testEndpoint(mockTenantId, {
        url: 'https://example.com/custom-hook',
        method: 'PUT',
        headers: customHeaders,
        payload: customPayload,
        secret: 'whsec_adhocsecret123',
        timeoutMs: 5000,
      });

      expect(endpointRepository.findByIdAndTenant).not.toHaveBeenCalled();
      expect(httpWebhookSender.test).toHaveBeenCalledTimes(1);

      const [targetUrl, payload, headers, timeoutMs, options] = httpWebhookSender.test.mock.calls[0];
      expect(targetUrl).toBe('https://example.com/custom-hook');
      expect(options.method).toBe('PUT');
      expect(timeoutMs).toBe(5000);
      expect(JSON.parse(payload)).toEqual(customPayload);

      // Authorization header was sent to destination but must be REDACTED in returned request summary
      expect(headers['Authorization']).toBe('Bearer secret_token');
      expect(headers['X-Custom-Header']).toBe('CustomValue');
      expect(result.request.headers['Authorization']).toBe('[REDACTED]');
      expect(result.request.headers['X-Custom-Header']).toBe('CustomValue');

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(201);
      expect(result.request.method).toBe('PUT');
      expect(result.request.payload).toEqual(customPayload);
    });

    it('supports GET and HEAD methods with no request body', async () => {
      httpWebhookSender.test.mockResolvedValue({
        statusCode: 200,
        latencyMs: 12,
        error: null,
        headers: { 'content-type': 'text/plain' },
        body: 'pong',
        sizeBytes: 4,
        truncated: false,
      });

      const result = await testEndpoint(mockTenantId, {
        url: 'https://example.com/health',
        method: 'GET',
      });

      const [, payload, , , options] = httpWebhookSender.test.mock.calls[0];
      expect(options.method).toBe('GET');
      expect(payload).toBeNull();
      expect(result.request.payload).toBeNull();
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('supports all valid HTTP methods: GET, POST, PUT, PATCH, DELETE, HEAD', async () => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
      httpWebhookSender.test.mockResolvedValue({
        statusCode: 200,
        latencyMs: 10,
        error: null,
        headers: {},
        body: 'ok',
        sizeBytes: 2,
        truncated: false,
      });

      for (const m of methods) {
        const result = await testEndpoint(mockTenantId, {
          url: 'https://example.com/test',
          method: m,
        });
        expect(result.request.method).toBe(m);
      }
    });
  });

  describe('Error handling & diagnostics capture', () => {
    it('captures 4xx and 5xx responses with success: false and response body intact', async () => {
      httpWebhookSender.test.mockResolvedValue({
        statusCode: 404,
        latencyMs: 30,
        error: null,
        headers: { 'content-type': 'application/json' },
        body: '{"error":"Not Found"}',
        sizeBytes: 22,
        truncated: false,
      });

      const result = await testEndpoint(mockTenantId, {
        url: 'https://example.com/missing-webhook',
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.status_code).toBe(404);
      expect(result.error).toBeNull();
      expect(result.response).not.toBeNull();
      expect(result.response.statusCode).toBe(404);
      expect(result.response.body).toBe('{"error":"Not Found"}');
    });

    it('handles connection failures gracefully with response: null', async () => {
      httpWebhookSender.test.mockResolvedValue({
        statusCode: null,
        latencyMs: 18,
        error: 'connect ECONNREFUSED 93.184.216.34:443',
        headers: null,
        body: null,
        sizeBytes: 0,
        truncated: false,
      });

      const result = await testEndpoint(mockTenantId, {
        url: 'https://example.com/unreachable',
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeNull();
      expect(result.status_code).toBeNull();
      expect(result.latencyMs).toBe(18);
      expect(result.error).toBe('connect ECONNREFUSED 93.184.216.34:443');
      expect(result.response).toBeNull();
    });

    it('handles timeouts gracefully returning success: false, statusCode: null, error: Timeout', async () => {
      httpWebhookSender.test.mockResolvedValue({
        statusCode: null,
        latencyMs: 5002,
        error: 'Timeout',
        headers: null,
        body: null,
        sizeBytes: 0,
        truncated: false,
      });

      const result = await testEndpoint(mockTenantId, {
        url: 'https://example.com/slow',
        timeoutMs: 5000,
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeNull();
      expect(result.error).toBe('Timeout');
      expect(result.response).toBeNull();
    });

    it('reflects response truncation when body exceeds maxCaptureBytes', async () => {
      httpWebhookSender.test.mockResolvedValue({
        statusCode: 200,
        latencyMs: 80,
        error: null,
        headers: { 'content-type': 'text/plain' },
        body: 'A'.repeat(65536),
        sizeBytes: 120000,
        truncated: true,
      });

      const result = await testEndpoint(mockTenantId, {
        url: 'https://example.com/large-response',
      });

      expect(result.success).toBe(true);
      expect(result.response.truncated).toBe(true);
      expect(result.response.sizeBytes).toBe(120000);
      expect(result.response.body.length).toBe(65536);
    });
  });

  describe('Security and validation checks', () => {
    it('throws NotFoundError if endpoint does not exist or belongs to another tenant', async () => {
      endpointRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(
        testEndpoint(mockTenantId, { endpointId: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toThrow('Endpoint not found');
    });

    it('throws ValidationError if neither endpoint ID nor URL is provided', async () => {
      await expect(testEndpoint(mockTenantId, {})).rejects.toThrow(
        'Either a valid endpoint ID or a target URL must be provided'
      );
    });

    it('throws ValidationError for unsupported HTTP methods', async () => {
      await expect(
        testEndpoint(mockTenantId, {
          url: 'https://example.com/webhook',
          method: 'TRACE',
        })
      ).rejects.toThrow(/Invalid HTTP method 'TRACE'/);
    });

    it('throws ValidationError for invalid or non-HTTP protocols', async () => {
      await expect(
        testEndpoint(mockTenantId, {
          url: 'ftp://ftp.example.com/files',
        })
      ).rejects.toThrow(/Unsupported URL protocol 'ftp:'/);

      await expect(
        testEndpoint(mockTenantId, {
          url: 'javascript:alert(1)',
        })
      ).rejects.toThrow(/Unsupported URL protocol 'javascript:'/);
    });

    it('blocks SSRF destinations: loopback address in production mode', async () => {
      await expect(
        testEndpoint(mockTenantId, {
          url: 'http://127.0.0.1:8080/hook',
        })
      ).rejects.toThrow(/Destination IP '127.0.0.1' is blocked/);
    });

    it('blocks SSRF destinations: cloud metadata address 169.254.169.254', async () => {
      await expect(
        testEndpoint(mockTenantId, {
          url: 'http://169.254.169.254/latest/meta-data',
        })
      ).rejects.toThrow(/cloud metadata/);
    });

    it('blocks SSRF destinations: private RFC 1918 IP addresses', async () => {
      await expect(
        testEndpoint(mockTenantId, {
          url: 'http://192.168.1.1:8000/webhook',
        })
      ).rejects.toThrow(/private or reserved/);
    });

    it('rejects header injection / CRLF in custom headers', async () => {
      await expect(
        testEndpoint(mockTenantId, {
          url: 'https://example.com/webhook',
          headers: {
            'X-Bad-Header\r\nInjected: true': 'value',
          },
        })
      ).rejects.toThrow(/newline characters/);

      await expect(
        testEndpoint(mockTenantId, {
          url: 'https://example.com/webhook',
          headers: {
            'X-Normal-Header': 'value\r\nSet-Cookie: session=evil',
          },
        })
      ).rejects.toThrow(/newline characters/);
    });
  });
});
