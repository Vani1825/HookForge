import { describe, it, expect } from 'vitest';
import {
  validateBenchmarkConfig,
  sanitizeReportHeaders,
  DEFAULT_BENCHMARK_CONFIG,
} from '../../benchmark/config.js';

describe('Benchmark Configuration Validation', () => {
  it('applies default configuration values correctly', () => {
    const config = validateBenchmarkConfig();
    expect(config.baseUrl).toBe('http://127.0.0.1:8081');
    expect(config.path).toBe('/health');
    expect(config.method).toBe('GET');
    expect(config.requests).toBe(DEFAULT_BENCHMARK_CONFIG.requests);
    expect(config.concurrency).toBe(DEFAULT_BENCHMARK_CONFIG.concurrency);
    expect(config.timeoutMs).toBe(5000);
    expect(config.allowRemote).toBe(false);
  });

  it('permits valid localhost variants: 127.0.0.1, localhost, ::1, 0.0.0.0', () => {
    expect(() => validateBenchmarkConfig({ baseUrl: 'http://localhost:8081' })).not.toThrow();
    expect(() => validateBenchmarkConfig({ baseUrl: 'http://127.0.0.1:3000' })).not.toThrow();
    expect(() => validateBenchmarkConfig({ baseUrl: 'http://0.0.0.0:8081' })).not.toThrow();
  });

  it('rejects external or non-localhost targets unless allowRemote is explicitly true', () => {
    expect(() => validateBenchmarkConfig({ baseUrl: 'https://api.github.com' })).toThrow(
      /Security Constraint: Target host "api.github.com" is not localhost/
    );
    expect(() => validateBenchmarkConfig({ baseUrl: 'http://example.org' })).toThrow(
      /Security Constraint: Target host "example.org" is not localhost/
    );

    // With explicit allowRemote: true, external targets are permitted
    const remoteConfig = validateBenchmarkConfig({
      baseUrl: 'https://staging.internal.hookforge:8081',
      allowRemote: true,
    });
    expect(remoteConfig.allowRemote).toBe(true);
    expect(remoteConfig.url).toContain('staging.internal.hookforge:8081');
  });

  it('validates and clamps request count and concurrency bounds', () => {
    expect(() => validateBenchmarkConfig({ requests: 0 })).toThrow(/Requests must be a positive integer/);
    expect(() => validateBenchmarkConfig({ requests: -5 })).toThrow(/Requests must be a positive integer/);
    expect(() => validateBenchmarkConfig({ requests: 6000 })).toThrow(/Requests must be a positive integer between 1 and 5000/);

    expect(() => validateBenchmarkConfig({ concurrency: 0 })).toThrow(/Concurrency must be a positive integer/);
    expect(() => validateBenchmarkConfig({ concurrency: 150 })).toThrow(/Concurrency must be a positive integer between 1 and 100/);

    // If concurrency > requests, concurrency is safely clamped to requests count
    const clamped = validateBenchmarkConfig({ requests: 3, concurrency: 10 });
    expect(clamped.concurrency).toBe(3);
  });

  it('validates supported HTTP methods and rejects invalid ones', () => {
    expect(validateBenchmarkConfig({ method: 'get' }).method).toBe('GET');
    expect(validateBenchmarkConfig({ method: 'POST' }).method).toBe('POST');
    expect(validateBenchmarkConfig({ method: 'head' }).method).toBe('HEAD');
    expect(() => validateBenchmarkConfig({ method: 'INVALID' })).toThrow(/Unsupported HTTP method "INVALID"/);
  });

  it('validates timeout limits', () => {
    expect(() => validateBenchmarkConfig({ timeoutMs: 50 })).toThrow(/Timeout must be an integer between 100ms and 60000ms/);
    expect(() => validateBenchmarkConfig({ timeoutMs: 70000 })).toThrow(/Timeout must be an integer between 100ms and 60000ms/);
  });

  it('redacts sensitive headers in sanitizeReportHeaders', () => {
    const rawHeaders = {
      'content-type': 'application/json',
      'x-api-key': 'whkey_secret123456789',
      'authorization': 'Bearer supersecrettoken',
      'x-tenant-id': 'tenant-uuid-1',
    };

    const sanitized = sanitizeReportHeaders(rawHeaders);
    expect(sanitized['content-type']).toBe('application/json');
    expect(sanitized['x-tenant-id']).toBe('tenant-uuid-1');
    expect(sanitized['x-api-key']).toBe('[REDACTED]');
    expect(sanitized['authorization']).toBe('[REDACTED]');
  });
});
