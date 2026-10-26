/**
 * RandomGenerator abstraction for testability.
 * Allows injecting a deterministic random generator in tests.
 */

import crypto from 'crypto';

class RandomGenerator {
  /**
   * Get random integer in range [min, max) (exclusive of max)
   */
  nextInt(min, max) {
    throw new Error('RandomGenerator.nextInt() must be implemented');
  }

  /**
   * Get random bytes
   */
  nextBytes(length) {
    throw new Error('RandomGenerator.nextBytes() must be implemented');
  }
}

/**
 * System random using crypto.randomInt
 */
class SystemRandom extends RandomGenerator {
  nextInt(min, max) {
    return crypto.randomInt(min, max);
  }

  nextBytes(length) {
    return crypto.randomBytes(length);
  }
}

/**
 * Test random with deterministic seeded values
 * Uses a simple LCG for deterministic testing
 */
class TestRandom extends RandomGenerator {
  constructor(seed = 42) {
    super();
    this.state = seed;
  }

  nextInt(min, max) {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    const range = max - min;
    return min + (this.state % range);
  }

  nextBytes(length) {
    const bytes = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = this.nextInt(0, 256);
    }
    return bytes;
  }
}

export const randomGenerator = {
  system: new SystemRandom(),
  test: (seed) => new TestRandom(seed),
};

export default randomGenerator;
