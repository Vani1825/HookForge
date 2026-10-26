/**
 * Tests for ThresholdCircuitBreaker.
 */

import { describe, it, expect } from 'vitest';
import { shouldAttempt, recordResult } from '../../../src/services/resilience/thresholdCircuitBreaker.js';
import { circuitState } from '../../../src/domain/circuitState.js';
import { deliveryOutcome } from '../../../src/domain/deliveryOutcome.js';

describe('ThresholdCircuitBreaker', () => {
  describe('shouldAttempt', () => {
    it('should allow attempts when circuit is CLOSED', async () => {
      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      };

      const allowed = await shouldAttempt('endpoint-1', endpoint, Date.now());
      expect(allowed).toBe(true);
    });

    it('should block attempts when circuit is OPEN and timeout not reached', async () => {
      const now = Date.now();
      const futureCircuitUntil = new Date(now + 60000).toISOString();

      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.OPEN,
        circuitUntil: futureCircuitUntil,
        consecutiveFailures: 5,
      };

      const allowed = await shouldAttempt('endpoint-1', endpoint, now);
      expect(allowed).toBe(false);
    });

    it('should allow probe when circuit is OPEN and timeout reached', async () => {
      const now = Date.now();
      const pastCircuitUntil = new Date(now - 1000).toISOString();

      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.OPEN,
        circuitUntil: pastCircuitUntil,
        consecutiveFailures: 5,
      };

      const allowed = await shouldAttempt('endpoint-1', endpoint, now);
      expect(allowed).toBe(true);
    });

    it('should allow attempts when circuit is HALF_OPEN', async () => {
      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.HALF_OPEN,
        circuitUntil: null,
        consecutiveFailures: 5,
      };

      const allowed = await shouldAttempt('endpoint-1', endpoint, Date.now());
      expect(allowed).toBe(true);
    });
  });

  describe('recordResult', () => {
    it('should reset to CLOSED on success', async () => {
      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.OPEN,
        circuitUntil: new Date(Date.now() + 60000).toISOString(),
        consecutiveFailures: 5,
      };

      const update = await recordResult('endpoint-1', deliveryOutcome.SUCCESS, endpoint, Date.now());

      expect(update).toEqual({
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      });
    });

    it('should increment failures and stay CLOSED below threshold', async () => {
      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 3,
      };

      const update = await recordResult('endpoint-1', deliveryOutcome.RETRY, endpoint, Date.now());

      expect(update).toEqual({
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 4,
      });
    });

    it('should open circuit when failures reach threshold', async () => {
      const now = Date.now();
      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 4,
      };

      const update = await recordResult('endpoint-1', deliveryOutcome.RETRY, endpoint, now);

      expect(update.circuitState).toBe(circuitState.OPEN);
      expect(update.consecutiveFailures).toBe(5);
      expect(update.circuitUntil).toBeTruthy();
    });

    it('should keep circuit open on failure in HALF_OPEN', async () => {
      const now = Date.now();
      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.HALF_OPEN,
        circuitUntil: null,
        consecutiveFailures: 5,
      };

      const update = await recordResult('endpoint-1', deliveryOutcome.RETRY, endpoint, now);

      expect(update.circuitState).toBe(circuitState.OPEN);
      expect(update.consecutiveFailures).toBe(6);
      expect(update.circuitUntil).toBeTruthy();
    });

    it('should not change circuit on RATE_LIMITED', async () => {
      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      };

      const update = await recordResult('endpoint-1', deliveryOutcome.RATE_LIMITED, endpoint, Date.now());

      expect(update).toBeNull();
    });

    it('should not change circuit on RETRY_LIMITED', async () => {
      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      };

      const update = await recordResult('endpoint-1', deliveryOutcome.RETRY_LIMITED, endpoint, Date.now());

      expect(update).toBeNull();
    });

    it('should only count RETRY as endpoint failure', async () => {
      const endpoint = {
        id: 'endpoint-1',
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      };

      // RATE_LIMITED should not count
      let update = await recordResult('endpoint-1', deliveryOutcome.RATE_LIMITED, endpoint, Date.now());
      expect(update).toBeNull();

      // RETRY should count
      update = await recordResult('endpoint-1', deliveryOutcome.RETRY, endpoint, Date.now());
      expect(update.consecutiveFailures).toBe(1);
    });
  });
});
