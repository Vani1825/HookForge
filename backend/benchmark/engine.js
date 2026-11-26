/**
 * Core Benchmark Execution Engine.
 *
 * Dispatches concurrent requests using a worker-pool pattern,
 * measures high-resolution nanosecond latencies, aggregates status codes,
 * and handles connection errors and timeouts gracefully.
 */

import { validateBenchmarkConfig, sanitizeReportHeaders } from './config.js';
import { calculateStats } from './metrics.js';

export class BenchmarkEngine {
  /**
   * @param {Object} [options]
   */
  constructor(options = {}) {
    this.config = validateBenchmarkConfig(options);
  }

  /**
   * Execute a single HTTP probe.
   *
   * @param {number} _index - Request index
   * @returns {Promise<{ latencyMs: number, statusCode: number|null, success: boolean, error?: string, headers?: Object }>}
   */
  async executeProbe(_index) {
    const { url, method, headers, body, timeoutMs } = this.config;
    const fetchOptions = {
      method,
      headers: { ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'object' ? JSON.stringify(body) : String(body);
      if (!fetchOptions.headers['content-type']) {
        fetchOptions.headers['content-type'] = 'application/json';
      }
    }

    const startNs = process.hrtime.bigint();
    try {
      const response = await fetch(url, fetchOptions);
      // Consume body to free socket
      await response.text().catch(() => {});
      const endNs = process.hrtime.bigint();
      const latencyMs = Number(endNs - startNs) / 1_000_000;

      const statusCode = response.status;
      const success = statusCode >= 200 && statusCode <= 299;

      const responseHeaders = {};
      const relevantHeaders = ['x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after', 'content-type'];
      for (const h of relevantHeaders) {
        const val = response.headers.get(h);
        if (val) responseHeaders[h] = val;
      }

      return {
        latencyMs,
        statusCode,
        success,
        headers: responseHeaders,
      };
    } catch (err) {
      const endNs = process.hrtime.bigint();
      const latencyMs = Number(endNs - startNs) / 1_000_000;

      let errorMsg = 'UnknownError';
      if (
        err.name === 'TimeoutError' ||
        err.name === 'AbortError' ||
        err.cause?.name === 'TimeoutError' ||
        err.cause?.name === 'AbortError'
      ) {
        errorMsg = 'TimeoutExceeded';
      } else if (
        err.code === 'ECONNREFUSED' ||
        err.cause?.code === 'ECONNREFUSED' ||
        String(err.cause?.message || '').includes('ECONNREFUSED') ||
        String(err.message || '').includes('ECONNREFUSED')
      ) {
        errorMsg = 'ConnectionRefused';
      } else if (err.message) {
        errorMsg = err.message;
      }

      return {
        latencyMs,
        statusCode: null,
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Run the configured benchmark scenario across concurrent workers.
   *
   * @param {Object} [runtimeOverrides]
   * @returns {Promise<Object>} Aggregated benchmark results
   */
  async run(runtimeOverrides = {}) {
    if (Object.keys(runtimeOverrides).length > 0) {
      this.config = validateBenchmarkConfig({ ...this.config, ...runtimeOverrides });
    }

    const { requests: totalRequests, concurrency, url, method, path, headers } = this.config;
    const results = new Array(totalRequests);
    let nextIndex = 0;

    const wallClockStartNs = process.hrtime.bigint();

    // Worker pool: exactly `concurrency` parallel tasks consuming from `nextIndex`
    const workerCount = Math.min(concurrency, totalRequests);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < totalRequests) {
        const currentIndex = nextIndex++;
        results[currentIndex] = await this.executeProbe(currentIndex);
      }
    });

    await Promise.all(workers);

    const wallClockEndNs = process.hrtime.bigint();
    const totalDurationMs = Number(wallClockEndNs - wallClockStartNs) / 1_000_000;

    const stats = calculateStats(results, totalDurationMs);

    return {
      timestamp: new Date().toISOString(),
      target: {
        url,
        path,
        method,
        headers: sanitizeReportHeaders(headers),
      },
      configuration: {
        requests: totalRequests,
        concurrency,
        timeoutMs: this.config.timeoutMs,
      },
      stats,
      sampleResults: results.slice(0, 10), // Include first 10 for diagnostics without memory bloat
    };
  }
}

export default BenchmarkEngine;
