/**
 * DeliveryOutcome enum - what a single HTTP attempt means for the delivery's future.
 * Produced by the ResponseClassifier.
 */

const SUCCESS = 'SUCCESS';
const RETRY = 'RETRY';
const RATE_LIMITED = 'RATE_LIMITED';
const RETRY_LIMITED = 'RETRY_LIMITED';
const ENDPOINT_GONE = 'ENDPOINT_GONE';

class DeliveryOutcome {
  constructor(value) {
    this.value = value;
  }

  /**
   * Outcomes that should count against the endpoint's circuit breaker
   */
  countsAsEndpointFailure() {
    return this.value === RETRY;
  }

  equals(other) {
    return this.value === other.value;
  }

  toString() {
    return this.value;
  }
}

// Export singleton instances
export const deliveryOutcome = {
  SUCCESS: new DeliveryOutcome(SUCCESS),
  RETRY: new DeliveryOutcome(RETRY),
  RATE_LIMITED: new DeliveryOutcome(RATE_LIMITED),
  RETRY_LIMITED: new DeliveryOutcome(RETRY_LIMITED),
  ENDPOINT_GONE: new DeliveryOutcome(ENDPOINT_GONE),

  /**
   * Get DeliveryOutcome instance from string value
   */
  fromString(value) {
    const outcome = this[value];
    if (!outcome) {
      throw new Error(`Invalid DeliveryOutcome: ${value}`);
    }
    return outcome;
  },

  /**
   * Get all valid values
   */
  values() {
    return [SUCCESS, RETRY, RATE_LIMITED, RETRY_LIMITED, ENDPOINT_GONE];
  },
};

export default deliveryOutcome;
