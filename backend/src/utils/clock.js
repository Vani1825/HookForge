/**
 * Clock abstraction for testability.
 * Allows injecting a deterministic clock in tests.
 */

class Clock {
  /**
   * Get current time in milliseconds since epoch
   */
  now() {
    throw new Error('Clock.now() must be implemented');
  }
}

/**
 * System clock using Date.now()
 */
class SystemClock extends Clock {
  now() {
    return Date.now();
  }
}

/**
 * Test clock with deterministic time
 */
class TestClock extends Clock {
  constructor(initialTime = Date.now()) {
    super();
    this.currentTime = initialTime;
  }

  now() {
    return this.currentTime;
  }

  /**
   * Set the current time
   */
  setTime(time) {
    this.currentTime = time;
  }

  /**
   * Advance time by milliseconds
   */
  advanceTime(ms) {
    this.currentTime += ms;
  }
}

export const clock = {
  system: new SystemClock(),
  test: (initialTime) => new TestClock(initialTime),
};

export default clock;
