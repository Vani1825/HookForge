/**
 * Unit & Integration tests for HttpWebhookSender.
 * Tests connection pinning, SSRF mitigation, DNS rebinding protection,
 * redirect safety, sensitive header stripping, HTTP method semantics, and timeout handling.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import EventEmitter from 'node:events';
import { send } from '../../../src/services/delivery/httpWebhookSender.js';
import { sanitizeUrlForLogging } from '../../../src/utils/ssrf.js';

describe('HttpWebhookSender SSRF & Connection Pinning', () => {
  let activeServers = [];

  function startServer(handler) {
    return new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        activeServers.push(server);
        resolve({ server, port: address.port, address: '127.0.0.1' });
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

  describe('Connection Pinning & Delivery Execution', () => {
    it('successfully delivers webhook to pinned IP with preserved Host header and body', async () => {
      let receivedRequest = null;

      const { port } = await startServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          receivedRequest = {
            method: req.method,
            headers: req.headers,
            url: req.url,
            body,
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        });
      });

      // Target URL has a domain name, but DNS lookup resolves to our local server
      const targetUrl = `http://webhook.partner.example:${port}/webhook-endpoint`;
      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      const payload = JSON.stringify({ event: 'order.completed', id: 42 });
      const customHeaders = {
        'X-Webhook-Id': 'del-123',
        'X-Webhook-Signature': 'sha256=abcdef123456',
      };

      const result = await send(
        targetUrl,
        payload,
        customHeaders,
        5000,
        {
          allowLocal: true, // Needed because our test server is on 127.0.0.1
          dnsLookup: mockDnsLookup,
        }
      );

      expect(result.error).toBeNull();
      expect(result.statusCode).toBe(200);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      // Verify that server received request at the pinned address, but with original Host header!
      expect(receivedRequest).not.toBeNull();
      expect(receivedRequest.method).toBe('POST');
      expect(receivedRequest.headers.host).toBe(`webhook.partner.example:${port}`);
      expect(receivedRequest.headers['x-webhook-id']).toBe('del-123');
      expect(receivedRequest.headers['x-webhook-signature']).toBe('sha256=abcdef123456');
      expect(receivedRequest.headers['content-type']).toBe('application/json');
      expect(receivedRequest.body).toBe(payload);
    });

    it('blocks private IPv4 destinations', async () => {
      const result = await send(
        'http://192.168.1.50:8080/webhook',
        '{"test":1}',
        {},
        2000
      );

      expect(result.statusCode).toBeNull();
      expect(result.error).toContain('Blocked by SSRF protection');
      expect(result.error).toContain('private or reserved');
    });

    it('blocks private and loopback IPv6 destinations', async () => {
      const loopbackResult = await send(
        'http://[::1]:8080/webhook',
        '{"test":1}',
        {},
        2000
      );
      expect(loopbackResult.statusCode).toBeNull();
      expect(loopbackResult.error).toContain('Blocked by SSRF protection');
      expect(loopbackResult.error).toContain('loopback');

      const linkLocalResult = await send(
        'http://[fe80::1]:8080/webhook',
        '{"test":1}',
        {},
        2000
      );
      expect(linkLocalResult.statusCode).toBeNull();
      expect(linkLocalResult.error).toContain('Blocked by SSRF protection');
      expect(linkLocalResult.error).toContain('link-local');

      const uniqueLocalResult = await send(
        'http://[fc00::1]:8080/webhook',
        '{"test":1}',
        {},
        2000
      );
      expect(uniqueLocalResult.statusCode).toBeNull();
      expect(uniqueLocalResult.error).toContain('Blocked by SSRF protection');
      expect(uniqueLocalResult.error).toContain('private');
    });

    it('validates public IPv4 and public IPv6 literal destinations', async () => {
      const resV4 = await send(
        'http://93.184.216.34:65530/webhook',
        '{}',
        {},
        500
      );
      expect(resV4.error).not.toContain('Blocked by SSRF protection');

      const resV6 = await send(
        'http://[2606:2800:220:1:248:1893:25c8:1946]:65530/webhook',
        '{}',
        {},
        500
      );
      expect(resV6.error).not.toContain('Blocked by SSRF protection');
    });

    it('rejects destination if DNS resolves to multiple addresses with at least one private IP', async () => {
      const mockDnsLookup = async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 }, // Poisoned internal IP
      ];

      const result = await send(
        'https://mixed-dns.example.com/webhook',
        '{}',
        {},
        2000,
        { dnsLookup: mockDnsLookup }
      );

      expect(result.statusCode).toBeNull();
      expect(result.error).toContain('Blocked by SSRF protection');
      expect(result.error).toContain('private or reserved');
    });

    it('prevents DNS rebinding by pinning the connection to the initially resolved IP', async () => {
      let lookupCallCount = 0;

      const { port } = await startServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });

      const mockDnsLookup = async () => {
        lookupCallCount++;
        if (lookupCallCount > 1) {
          // Attempted rebind to cloud metadata
          return [{ address: '169.254.169.254', family: 4 }];
        }
        return [{ address: '127.0.0.1', family: 4 }];
      };

      const result = await send(
        `http://rebind-test.example:${port}/webhook`,
        '{"data":1}',
        {},
        3000,
        {
          allowLocal: true,
          dnsLookup: mockDnsLookup,
        }
      );

      expect(result.statusCode).toBe(200);
      expect(result.error).toBeNull();
    });

    it('blocks redirects to localhost or private IPs', async () => {
      const { port: port1 } = await startServer((req, res) => {
        res.writeHead(302, {
          'Location': 'http://127.0.0.1:9090/internal-admin',
        });
        res.end();
      });

      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      const result = await send(
        `http://public-target.example:${port1}/webhook`,
        '{}',
        {},
        3000,
        {
          dnsLookup: mockDnsLookup,
          allowLocal: false, // Strict: redirect to 127.0.0.1 must be blocked!
        }
      );

      expect(result.statusCode).toBeNull();
      expect(result.error).toContain('Blocked by SSRF protection');
      expect(result.error).toContain('loopback');
    });

    it('validates and blocks redirects to cloud metadata even when first hop was permitted', async () => {
      let redirectAttempted = false;

      const { port: port1 } = await startServer((req, res) => {
        redirectAttempted = true;
        res.writeHead(302, {
          'Location': 'http://169.254.169.254/latest/meta-data/',
        });
        res.end();
      });

      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      const result = await send(
        `http://initial-server.example:${port1}/webhook`,
        '{}',
        {},
        3000,
        {
          allowLocal: true,
          dnsLookup: mockDnsLookup,
        }
      );

      expect(redirectAttempted).toBe(true);
      expect(result.statusCode).toBeNull();
      expect(result.error).toContain('Blocked by SSRF protection');
      expect(result.error).toContain('cloud metadata');
    });

    it('handles request timeouts gracefully', async () => {
      const { port } = await startServer((_req, _res) => {
        // Intentionally hang without sending a response
      });

      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      const result = await send(
        `http://timeout-target.example:${port}/webhook`,
        '{}',
        {},
        100, // Short 100ms timeout
        {
          allowLocal: true,
          dnsLookup: mockDnsLookup,
        }
      );

      expect(result.statusCode).toBeNull();
      expect(result.error).toBe('Timeout');
      expect(result.latencyMs).toBeGreaterThanOrEqual(90);
    });
  });

  describe('Redirect Security, Headers, and Semantics', () => {
    it('strips origin-bound sensitive credentials and X-Webhook-Signature on cross-origin redirects', async () => {
      let finalRequestHeaders = null;

      // Server 2: Final redirect destination (different port = different origin)
      const { port: port2 } = await startServer((req, res) => {
        finalRequestHeaders = req.headers;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"success":true}');
      });

      // Server 1: Initial webhook destination that issues a cross-origin 307 redirect to Server 2
      const { port: port1 } = await startServer((req, res) => {
        res.writeHead(307, {
          'Location': `http://destination-b.example:${port2}/final-endpoint`,
        });
        res.end();
      });

      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      const initialHeaders = {
        'Authorization': 'Bearer super-secret-token',
        'Proxy-Authorization': 'Basic dXNlcjpwYXNz',
        'Cookie': 'sessionId=abc123xyz',
        'X-Webhook-Signature': 'sha256=1122334455667788',
        'X-Api-Key': 'secret-api-key',
        'Api-Key': 'another-secret-key',
        'X-Auth-Token': 'auth-token-999',
        'X-Custom-Tracking-Id': 'track-42',
      };

      const result = await send(
        `http://destination-a.example:${port1}/hook`,
        '{"event":"test"}',
        initialHeaders,
        5000,
        {
          allowLocal: true,
          dnsLookup: mockDnsLookup,
        }
      );

      expect(result.statusCode).toBe(200);
      expect(finalRequestHeaders).not.toBeNull();

      // Non-sensitive custom header is PRESERVED across cross-origin redirect
      expect(finalRequestHeaders['x-custom-tracking-id']).toBe('track-42');

      // All origin-bound credentials and signatures MUST BE STRIPPED on cross-origin redirect
      expect(finalRequestHeaders['authorization']).toBeUndefined();
      expect(finalRequestHeaders['proxy-authorization']).toBeUndefined();
      expect(finalRequestHeaders['cookie']).toBeUndefined();
      expect(finalRequestHeaders['x-webhook-signature']).toBeUndefined();
      expect(finalRequestHeaders['x-api-key']).toBeUndefined();
      expect(finalRequestHeaders['api-key']).toBeUndefined();
      expect(finalRequestHeaders['x-auth-token']).toBeUndefined();
    });

    it('preserves sensitive credentials and X-Webhook-Signature on same-origin 307 and 308 redirects', async () => {
      let finalHeaders307 = null;
      let finalHeaders308 = null;

      const { port } = await startServer((req, res) => {
        if (req.url === '/hop-307') {
          res.writeHead(307, { 'Location': '/same-origin-target-307' });
          res.end();
        } else if (req.url === '/same-origin-target-307') {
          finalHeaders307 = req.headers;
          res.writeHead(200);
          res.end('ok');
        } else if (req.url === '/hop-308') {
          res.writeHead(308, { 'Location': '/same-origin-target-308' });
          res.end();
        } else if (req.url === '/same-origin-target-308') {
          finalHeaders308 = req.headers;
          res.writeHead(200);
          res.end('ok');
        }
      });

      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];
      const headers = {
        'Authorization': 'Bearer internal-jwt',
        'X-Webhook-Signature': 'sha256=sameoriginhmac',
        'X-Correlation-Id': 'corr-100',
      };

      // Test 307
      const res307 = await send(
        `http://partner.example:${port}/hop-307`,
        '{"test":1}',
        headers,
        5000,
        { allowLocal: true, dnsLookup: mockDnsLookup }
      );
      expect(res307.statusCode).toBe(200);
      expect(finalHeaders307['authorization']).toBe('Bearer internal-jwt');
      expect(finalHeaders307['x-webhook-signature']).toBe('sha256=sameoriginhmac');
      expect(finalHeaders307['x-correlation-id']).toBe('corr-100');

      // Test 308
      const res308 = await send(
        `http://partner.example:${port}/hop-308`,
        '{"test":2}',
        headers,
        5000,
        { allowLocal: true, dnsLookup: mockDnsLookup }
      );
      expect(res308.statusCode).toBe(200);
      expect(finalHeaders308['authorization']).toBe('Bearer internal-jwt');
      expect(finalHeaders308['x-webhook-signature']).toBe('sha256=sameoriginhmac');
      expect(finalHeaders308['x-correlation-id']).toBe('corr-100');
    });

    it('rewrites POST to GET and drops payload body on 301, 302, and 303 redirects', async () => {
      for (const redirectCode of [301, 302, 303]) {
        let finalRequest = null;

        const { port } = await startServer((req, res) => {
          if (req.url === '/initial') {
            res.writeHead(redirectCode, { 'Location': '/final-get' });
            res.end();
          } else if (req.url === '/final-get') {
            let body = '';
            req.on('data', (c) => {
              body += c;
            });
            req.on('end', () => {
              finalRequest = {
                method: req.method,
                headers: req.headers,
                body,
              };
              res.writeHead(200);
              res.end('done');
            });
          }
        });

        const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

        const result = await send(
          `http://redirect.example:${port}/initial`,
          '{"message":"original-payload"}',
          { 'X-Custom-Header': 'val' },
          5000,
          { allowLocal: true, dnsLookup: mockDnsLookup }
        );

        expect(result.statusCode).toBe(200);
        expect(finalRequest).not.toBeNull();
        // Method rewritten to GET
        expect(finalRequest.method).toBe('GET');
        // Body dropped
        expect(finalRequest.body).toBe('');
        // Content-Length and Content-Type headers deleted
        expect(finalRequest.headers['content-length']).toBeUndefined();
        expect(finalRequest.headers['content-type']).toBeUndefined();
        // Custom non-sensitive header preserved
        expect(finalRequest.headers['x-custom-header']).toBe('val');
      }
    });

    it('preserves POST method and payload body on 307 and 308 redirects', async () => {
      for (const redirectCode of [307, 308]) {
        let finalRequest = null;

        const { port } = await startServer((req, res) => {
          if (req.url === '/initial') {
            res.writeHead(redirectCode, { 'Location': '/final-post' });
            res.end();
          } else if (req.url === '/final-post') {
            let body = '';
            req.on('data', (c) => {
              body += c;
            });
            req.on('end', () => {
              finalRequest = {
                method: req.method,
                headers: req.headers,
                body,
              };
              res.writeHead(200);
              res.end('done');
            });
          }
        });

        const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];
        const payload = JSON.stringify({ preserve: true, code: redirectCode });

        const result = await send(
          `http://redirect.example:${port}/initial`,
          payload,
          { 'Content-Type': 'application/json' },
          5000,
          { allowLocal: true, dnsLookup: mockDnsLookup }
        );

        expect(result.statusCode).toBe(200);
        expect(finalRequest).not.toBeNull();
        // Method preserved as POST
        expect(finalRequest.method).toBe('POST');
        // Body preserved
        expect(finalRequest.body).toBe(payload);
        expect(finalRequest.headers['content-type']).toBe('application/json');
      }
    });

    it('blocks dangerous redirect schemes like javascript: or file:', async () => {
      const { port } = await startServer((req, res) => {
        if (req.url === '/js') {
          res.writeHead(302, { 'Location': 'javascript:alert(1)' });
          res.end();
        } else if (req.url === '/file') {
          res.writeHead(302, { 'Location': 'file:///etc/passwd' });
          res.end();
        }
      });

      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      // JavaScript scheme
      const resJs = await send(
        `http://schemetest.example:${port}/js`,
        '{}',
        {},
        3000,
        { allowLocal: true, dnsLookup: mockDnsLookup }
      );
      expect(resJs.statusCode).toBeNull();
      expect(resJs.error).toContain('Disallowed redirect URL scheme \'javascript:\'');

      // File scheme
      const resFile = await send(
        `http://schemetest.example:${port}/file`,
        '{}',
        {},
        3000,
        { allowLocal: true, dnsLookup: mockDnsLookup }
      );
      expect(resFile.statusCode).toBeNull();
      expect(resFile.error).toContain('Disallowed redirect URL scheme \'file:\'');
    });

    it('rejects HTTPS to HTTP redirect downgrades across all 3xx status codes', async () => {
      for (const code of [301, 302, 303, 307, 308]) {
        let secondHopAttempted = false;

        const httpsSpy = vi.spyOn(https, 'request').mockImplementation((_reqOpts, cb) => {
          const req = new EventEmitter();
          req.write = vi.fn();
          req.end = vi.fn(() => {
            process.nextTick(() => {
              const res = new EventEmitter();
              res.statusCode = code;
              res.headers = {
                location: 'http://insecure-endpoint.example.com/unencrypted-webhook',
              };
              res.resume = vi.fn();
              cb(res);
              res.emit('end');
            });
          });
          req.destroy = vi.fn();
          return req;
        });

        const httpSpy = vi.spyOn(http, 'request').mockImplementation(() => {
          secondHopAttempted = true;
          const req = new EventEmitter();
          req.write = vi.fn();
          req.end = vi.fn();
          req.destroy = vi.fn();
          return req;
        });

        const mockDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

        const result = await send(
          'https://secure-endpoint.example.com/webhook',
          '{"sensitive":"order-data"}',
          { 'X-Webhook-Signature': 'sha256=secret' },
          5000,
          { dnsLookup: mockDnsLookup }
        );

        httpsSpy.mockRestore();
        httpSpy.mockRestore();

        expect(result.statusCode).toBeNull();
        expect(result.error).toBe(
          'Blocked by SSRF protection: Insecure redirect downgrade from HTTPS to HTTP is disallowed'
        );
        // Ensure raw redirect URL is NOT exposed
        expect(result.error).not.toContain('insecure-endpoint.example.com');
        expect(result.error).not.toContain('unencrypted-webhook');
        // Ensure no second request was made
        expect(secondHopAttempted).toBe(false);
      }
    });

    it('preserves normal HTTPS to HTTPS redirect behavior', async () => {
      let secondHopReceived = false;
      let requestCount = 0;

      const httpsSpy = vi.spyOn(https, 'request').mockImplementation((_reqOpts, cb) => {
        requestCount++;
        const req = new EventEmitter();
        req.write = vi.fn();
        req.end = vi.fn(() => {
          process.nextTick(() => {
            const res = new EventEmitter();
            if (requestCount === 1) {
              res.statusCode = 308;
              res.headers = {
                location: 'https://secure-target.example.com/final-path',
              };
            } else {
              secondHopReceived = true;
              res.statusCode = 200;
              res.headers = { 'content-type': 'application/json' };
            }
            res.resume = vi.fn();
            cb(res);
            res.emit('end');
          });
        });
        req.destroy = vi.fn();
        return req;
      });

      const mockDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

      const result = await send(
        'https://secure-endpoint.example.com/webhook',
        '{"payload":1}',
        {},
        5000,
        { dnsLookup: mockDnsLookup }
      );

      httpsSpy.mockRestore();

      expect(result.statusCode).toBe(200);
      expect(result.error).toBeNull();
      expect(secondHopReceived).toBe(true);
    });

    it('rejects invalid or empty Location headers safely without leaking raw values', async () => {
      const { port } = await startServer((req, res) => {
        if (req.url === '/empty') {
          res.writeHead(302, { 'Location': '' });
          res.end();
        } else if (req.url === '/whitespace') {
          res.writeHead(302, { 'Location': '   ' });
          res.end();
        }
      });

      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      const resEmpty = await send(
        `http://invalidlocation.example:${port}/empty`,
        '{}',
        {},
        3000,
        { allowLocal: true, dnsLookup: mockDnsLookup }
      );
      expect(resEmpty.statusCode).toBeNull();
      expect(resEmpty.error).toBe('Invalid redirect Location header');

      const resWhitespace = await send(
        `http://invalidlocation.example:${port}/whitespace`,
        '{}',
        {},
        3000,
        { allowLocal: true, dnsLookup: mockDnsLookup }
      );
      expect(resWhitespace.statusCode).toBeNull();
      expect(resWhitespace.error).toBe('Invalid redirect Location header');
    });

    it('enforces redirect count limit', async () => {
      const { port } = await startServer((req, res) => {
        const count = parseInt(req.url.replace('/hop', ''), 10) || 0;
        res.writeHead(302, { 'Location': `/hop${count + 1}` });
        res.end();
      });

      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      const result = await send(
        `http://loop.example:${port}/hop0`,
        '{}',
        {},
        5000,
        {
          allowLocal: true,
          dnsLookup: mockDnsLookup,
          maxRedirects: 3,
        }
      );

      expect(result.statusCode).toBe(302);
      expect(result.error).toBe('Too many redirects');
    });

    it('honors followRedirects: false', async () => {
      const { port } = await startServer((req, res) => {
        res.writeHead(302, { 'Location': '/redirected-to-somewhere' });
        res.end();
      });

      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      const result = await send(
        `http://no-follow.example:${port}/hook`,
        '{}',
        {},
        5000,
        {
          allowLocal: true,
          dnsLookup: mockDnsLookup,
          followRedirects: false,
        }
      );

      // Does not follow; returns 302 directly
      expect(result.statusCode).toBe(302);
      expect(result.error).toBeNull();
    });

    it('enforces total timeout across redirect hops', async () => {
      const { port } = await startServer((req, res) => {
        if (req.url === '/first-hop') {
          res.writeHead(302, { 'Location': '/hanging-hop' });
          res.end();
        } else if (req.url === '/hanging-hop') {
          // Intentionally do not respond
        }
      });

      const mockDnsLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      const result = await send(
        `http://timeout-chain.example:${port}/first-hop`,
        '{}',
        {},
        150, // 150ms total timeout
        {
          allowLocal: true,
          dnsLookup: mockDnsLookup,
        }
      );

      expect(result.statusCode).toBeNull();
      expect(result.error).toBe('Timeout');
      expect(result.latencyMs).toBeGreaterThanOrEqual(140);
    });

    it('aborts delivery with Timeout when DNS resolution exceeds remaining timeout', async () => {
      const slowLookup = () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([{ address: '127.0.0.1', family: 4 }]), 200);
        });

      const result = await send(
        'http://slow-dns-test.example/webhook',
        '{}',
        {},
        60, // Short 60ms timeout
        {
          allowLocal: true,
          dnsLookup: slowLookup,
        }
      );

      expect(result.statusCode).toBeNull();
      expect(result.error).toBe('Timeout');
      expect(result.latencyMs).toBeGreaterThanOrEqual(50);
    });

    it('ensures expired requests cannot proceed to outbound connection after DNS resolution completes', async () => {
      let outboundSocketAttempted = false;

      const { port } = await startServer((_req, res) => {
        outboundSocketAttempted = true;
        res.writeHead(200);
        res.end('ok');
      });

      // DNS lookup takes 80ms, while overall timeout is only 50ms
      const slowLookup = () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([{ address: '127.0.0.1', family: 4 }]), 80);
        });

      const result = await send(
        `http://timeout-after-dns.example:${port}/webhook`,
        '{}',
        {},
        50, // 50ms total timeout
        {
          allowLocal: true,
          dnsLookup: slowLookup,
          dnsTimeoutMs: 150, // Allow DNS lookup to finish so post-DNS check is exercised
        }
      );

      expect(result.statusCode).toBeNull();
      expect(result.error).toBe('Timeout');
      expect(outboundSocketAttempted).toBe(false);
    });
  });

  describe('URL Sanitization for Logging', () => {
    it('strips credentials and redacts query parameters', () => {
      const sanitized = sanitizeUrlForLogging(
        'https://admin:supersecret@api.partner.com:8443/webhook/v1?token=12345&sig=xyz#fragment'
      );
      expect(sanitized).toBe('https://api.partner.com:8443/webhook/v1?[REDACTED]');
      expect(sanitized).not.toContain('supersecret');
      expect(sanitized).not.toContain('admin:');
      expect(sanitized).not.toContain('12345');
      expect(sanitized).not.toContain('fragment');
    });

    it('returns [INVALID_URL] for malformed URLs', () => {
      expect(sanitizeUrlForLogging('not-a-valid-url')).toBe('[INVALID_URL]');
      expect(sanitizeUrlForLogging(null)).toBe('[INVALID_URL]');
    });
  });
});
