/**
 * CircuitState enum - per-endpoint circuit breaker state.
 * Persisted on the endpoint row so it survives restarts.
 */

const CLOSED = 'CLOSED';
const OPEN = 'OPEN';
const HALF_OPEN = 'HALF_OPEN';

class CircuitState {
  constructor(value) {
    this.value = value;
  }

  equals(other) {
    return this.value === other.value;
  }

  toString() {
    return this.value;
  }
}

// Export singleton instances
export const circuitState = {
  CLOSED: new CircuitState(CLOSED),
  OPEN: new CircuitState(OPEN),
  HALF_OPEN: new CircuitState(HALF_OPEN),

  /**
   * Get CircuitState instance from string value
   */
  fromString(value) {
    const state = this[value];
    if (!state) {
      throw new Error(`Invalid CircuitState: ${value}`);
    }
    return state;
  },

  /**
   * Get all valid values
   */
  values() {
    return [CLOSED, OPEN, HALF_OPEN];
  },
};

export default circuitState;
