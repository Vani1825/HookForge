/**
 * Unit & Integration tests for httpWebhookSender.test helper method.
 * Verifies that response body and headers are captured, size limits & truncation work,
 * and errors are safely caught and structured.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { test as testSender } from '../../../src/services/delivery/httpWebhookSender.js';

describe('httpWebhookSender.test', () => {
  let activeServers = [];

  function startServer(handler) {
    return new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        activeServers.push(server);
        resolve({ server, port: address.port });
      });
      server.on('error', reject);
    });
  }

  afterEach(async () => {
    for (const server of activeServers) {
      await new Promise((res) => server.close(res));
    }
    activeServers = [];
  });

  it('captures status code, response headers, and response body on success', async () => {
    const { port } = await startServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Server-Name': 'TestReceiver',
      });
      res.end(JSON.stringify({ received: true, greeting: 'hello' }));
    });

    const targetUrl = `http://localhost:${port}/webhook`;
    const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

    const result = await testSender(
      targetUrl,
      JSON.stringify({ ping: 'pong' }),
      { 'Content-Type': 'application/json' },
      5000,
      {
        allowLocal: true,
        dnsLookup: mockDnsLookup,
      }
    );

    expect(result.error).toBeNull();
    expect(result.statusCode).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.headers).toBeDefined();
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['x-server-name']).toBe('TestReceiver');
    expect(result.body).toBe(JSON.stringify({ received: true, greeting: 'hello' }));
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it('captures 4xx and 5xx responses with response body intact', async () => {
    const { port } = await startServer((req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
    });

    const targetUrl = `http://localhost:${port}/webhook`;
    const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

    const result = await testSender(
      targetUrl,
      null,
      {},
      5000,
      {
        method: 'GET',
        allowLocal: true,
        dnsLookup: mockDnsLookup,
      }
    );

    expect(result.error).toBeNull();
    expect(result.statusCode).toBe(403);
    expect(result.body).toBe(JSON.stringify({ error: 'Forbidden' }));
    expect(result.truncated).toBe(false);
  });

  it('truncates captured response body when exceeding maxCaptureBytes without erroring', async () => {
    const largeBody = 'X'.repeat(500);

    const { port } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(largeBody);
    });

    const targetUrl = `http://localhost:${port}/webhook`;
    const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

    const result = await testSender(
      targetUrl,
      null,
      {},
      5000,
      {
        method: 'GET',
        allowLocal: true,
        dnsLookup: mockDnsLookup,
        maxCaptureBytes: 100, // Limit capture to 100 bytes
      }
    );

    expect(result.error).toBeNull();
    expect(result.statusCode).toBe(200);
    expect(result.body.length).toBe(100);
    expect(result.sizeBytes).toBe(500);
    expect(result.truncated).toBe(true);
  });

  it('safely handles timeouts with response fields set to null/empty', async () => {
    const { port } = await startServer((req, res) => {
      // Never respond
    });

    const targetUrl = `http://localhost:${port}/webhook`;
    const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

    const result = await testSender(
      targetUrl,
      'test',
      {},
      50, // 50ms timeout
      {
        allowLocal: true,
        dnsLookup: mockDnsLookup,
      }
    );

    expect(result.statusCode).toBeNull();
    expect(result.error).toBe('Timeout');
    expect(result.headers).toBeNull();
    expect(result.body).toBeNull();
    expect(result.truncated).toBe(false);
  });
});
