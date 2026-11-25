/**
 * DeliveryState enum - lifecycle of a single delivery (one event to one endpoint).
 *
 * Transitions:
 * SCHEDULED --time due-------------> PENDING
 *           \--cancelled-----------> CANCELLED
 * PENDING --claim------------------> IN_FLIGHT
 *           \--cancelled-----------> CANCELLED
 * IN_FLIGHT --2xx------------------> SUCCEEDED
 *           \--retryable failure---> RETRYING --claim--> IN_FLIGHT
 *           \--exhausted/permanent-> DEAD --manual replay--> PENDING
 *           \--lease expired-------> RETRYING
 *
 * This is the single source of truth for legal transitions. Every state change must
 * go through requireTransitionTo().
 */

import { IllegalStateTransitionError } from './errors/illegalStateTransitionError.js';

const SCHEDULED = 'SCHEDULED';
const PENDING = 'PENDING';
const IN_FLIGHT = 'IN_FLIGHT';
const RETRYING = 'RETRYING';
const SUCCEEDED = 'SUCCEEDED';
const DEAD = 'DEAD';
const CANCELLED = 'CANCELLED';

// Legal transitions map
const ALLOWED_TRANSITIONS = {
  [SCHEDULED]: new Set([PENDING, CANCELLED]),
  [PENDING]: new Set([IN_FLIGHT, CANCELLED]),
  [IN_FLIGHT]: new Set([SUCCEEDED, RETRYING, DEAD]),
  [RETRYING]: new Set([IN_FLIGHT]),
  [SUCCEEDED]: new Set([PENDING]), // manual resend
  [DEAD]: new Set([PENDING]), // manual replay and resend
  [CANCELLED]: new Set([PENDING]), // manual resend
};

class DeliveryState {
  constructor(value) {
    this.value = value;
  }

  /**
   * Check if transition to next state is legal
   */
  canTransitionTo(nextState) {
    return ALLOWED_TRANSITIONS[this.value]?.has(nextState.value) ?? false;
  }

  /**
   * Require transition to next state, throw if illegal
   */
  requireTransitionTo(nextState) {
    if (!this.canTransitionTo(nextState)) {
      throw new IllegalStateTransitionError(this.value, nextState.value);
    }
  }

  /**
   * SUCCEEDED, DEAD, and CANCELLED never come back on their own (DEAD only via explicit replay)
   */
  isTerminal() {
    return this.value === SUCCEEDED || this.value === DEAD || this.value === CANCELLED;
  }

  /**
   * States that block later sequence numbers on the same endpoint (ordering guarantee)
   */
  isOpen() {
    return this.value === PENDING || this.value === RETRYING || this.value === IN_FLIGHT;
  }

  equals(other) {
    return other && this.value === other.value;
  }

  toString() {
    return this.value;
  }
}

// Export singleton instances
export const deliveryState = {
  SCHEDULED: new DeliveryState(SCHEDULED),
  PENDING: new DeliveryState(PENDING),
  IN_FLIGHT: new DeliveryState(IN_FLIGHT),
  RETRYING: new DeliveryState(RETRYING),
  SUCCEEDED: new DeliveryState(SUCCEEDED),
  DEAD: new DeliveryState(DEAD),
  CANCELLED: new DeliveryState(CANCELLED),

  /**
   * Get DeliveryState instance from string value
   */
  fromString(value) {
    const state = this[value];
    if (!state) {
      throw new Error(`Invalid DeliveryState: ${value}`);
    }
    return state;
  },

  /**
   * Get all valid values
   */
  values() {
    return [SCHEDULED, PENDING, IN_FLIGHT, RETRYING, SUCCEEDED, DEAD, CANCELLED];
  },
};

export default deliveryState;
