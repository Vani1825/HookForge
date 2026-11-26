import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { BenchmarkEngine } from '../../benchmark/engine.js';

describe('BenchmarkEngine Execution & Worker Pool', () => {
  let server;
  let serverPort;
  let requestCounter = 0;

  beforeAll(async () => {
    // Start local test server
    server = http.createServer((req, res) => {
      requestCounter++;
      const url = req.url || '';

      if (url.startsWith('/slow')) {
        // Delay response to test timeout
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        }, 300);
        return;
      }

      if (url.startsWith('/ratelimited')) {
        // Return 429 for requests past count 3
        if (requestCounter > 3) {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'X-RateLimit-Remaining': '0',
            'Retry-After': '5',
          });
          res.end(JSON.stringify({ error: 'Too Many Requests' }));
          return;
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': '99',
      });
      res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('executes concurrent requests and aggregates statistics accurately', async () => {
    requestCounter = 0;
    const engine = new BenchmarkEngine({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      path: '/health',
      requests: 12,
      concurrency: 3,
      timeoutMs: 2000,
    });

    const result = await engine.run();

    expect(result.configuration.requests).toBe(12);
    expect(result.configuration.concurrency).toBe(3);
    expect(result.stats.totalRequests).toBe(12);
    expect(result.stats.successfulRequests).toBe(12);
    expect(result.stats.failedRequests).toBe(0);
    expect(result.stats.statusDistribution['200']).toBe(12);
    expect(result.stats.throughputRps).toBeGreaterThan(0);
    expect(result.stats.latencies.minMs).toBeGreaterThanOrEqual(0);
    expect(result.stats.latencies.avgMs).toBeGreaterThanOrEqual(0);
    expect(result.stats.latencies.p50Ms).toBeGreaterThanOrEqual(0);
    expect(result.sampleResults.length).toBe(10);
  });

  it('correctly tracks and categorizes HTTP 429 rate limit responses', async () => {
    requestCounter = 0;
    const engine = new BenchmarkEngine({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      path: '/ratelimited',
      requests: 6,
      concurrency: 1, // sequential to guarantee order
      timeoutMs: 2000,
    });

    const result = await engine.run();

    expect(result.stats.totalRequests).toBe(6);
    expect(result.stats.successfulRequests).toBe(3);
    expect(result.stats.failedRequests).toBe(3);
    expect(result.stats.throttledRequests).toBe(3);
    expect(result.stats.statusDistribution['200']).toBe(3);
    expect(result.stats.statusDistribution['429']).toBe(3);
  });

  it('handles request timeouts gracefully without aborting the suite', async () => {
    const engine = new BenchmarkEngine({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      path: '/slow',
      requests: 2,
      concurrency: 1,
      timeoutMs: 100, // Shorter than 300ms server delay
    });

    const result = await engine.run();

    expect(result.stats.totalRequests).toBe(2);
    expect(result.stats.successfulRequests).toBe(0);
    expect(result.stats.failedRequests).toBe(2);
    expect(result.stats.errorDistribution.TimeoutExceeded).toBe(2);
  });

  it('handles connection refused errors gracefully on inactive ports', async () => {
    // Choose an unallocated high port
    const engine = new BenchmarkEngine({
      baseUrl: 'http://127.0.0.1:59999',
      path: '/health',
      requests: 2,
      concurrency: 1,
      timeoutMs: 1000,
    });

    const result = await engine.run();

    expect(result.stats.totalRequests).toBe(2);
    expect(result.stats.successfulRequests).toBe(0);
    expect(result.stats.failedRequests).toBe(2);
    expect(result.stats.errorDistribution.ConnectionRefused).toBe(2);
  });
});
