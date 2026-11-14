/**
 * TenantKeyCache - In-Memory TTL Cache with LRU Eviction and Single-Flight Protection.
 * Caches positive tenant lookups by SHA-256 API key hash.
 *
 * ARCHITECTURAL NOTES & PROCESS-LOCAL LIMITATIONS:
 * 1. Process-local cache: The TenantKeyCache implemented below stores cached tenant records
 *    in Node.js process memory. In a horizontally scaled multi-replica deployment, each replica
 *    maintains its own isolated cache. When an API key is revoked or rotated in PostgreSQL,
 *    stale authentication may persist on a given replica for up to the configured TTL (default: 60s).
 * 2. Invalidation during in-flight database lookups: If invalidate(hash) or clear() is called while
 *    a database lookup for that hash is actively in flight, this cache prevents the resolving stale
 *    result from repopulating the cache. However, the in-flight asynchronous database query itself
 *    is not cancelled, and the already-running caller will receive the result of its original query.
 *
 * SECURITY INVARIANTS:
 * - The cache key is exclusively the SHA-256 hexadecimal digest of the API key, NEVER the raw API key.
 * - Raw API keys and complete API-key hashes are NEVER logged.
 * - Positive caching only: null, undefined, or missing tenant lookups are NEVER stored in cache,
 *   preventing memory exhaustion / cache poisoning attacks from random invalid key floods.
 * - Cached tenant objects are defensive copies frozen via Object.freeze, preventing callers
 *   from mutating internal cached state.
 */

import clock from '../../utils/clock.js';
import config from '../../config/index.js';

export class TenantKeyCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.ttlMs=60000] - Time to live in milliseconds (default 60s)
   * @param {number} [options.maxEntries=10000] - Maximum cache capacity before LRU eviction
   * @param {number} [options.cleanupIntervalMs=60000] - Background expired entry prune interval (0 disables timer)
   * @param {Object} [options.clock] - Clock abstraction for deterministic testing (defaults to clock.system)
   */
  constructor(options = {}) {
    const {
      ttlMs = config?.authCache?.ttlMs || 60000,
      maxEntries = config?.authCache?.maxEntries || 10000,
      cleanupIntervalMs = 60000,
      clock: clockSource = clock.system,
    } = options;

    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.clock = clockSource;

    // JavaScript Map preserves insertion order, enabling O(1) LRU eviction.
    // Key: apiKeyHash (SHA-256 hex string)
    // Value: { tenant: { id, name }, expiresAt: number, lastAccess: number }
    this.entries = new Map();

    // Single-flight in-flight lookup tracker
    // Key: apiKeyHash -> Promise<Object|null>
    this.pendingLookups = new Map();

    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };

    if (cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, cleanupIntervalMs);
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    } else {
      this.cleanupTimer = null;
    }
  }

  /**
   * Current number of active entries in the cache.
   */
  get size() {
    return this.entries.size;
  }

  /**
   * Retrieve cached tenant by SHA-256 API key hash.
   * Lazily evicts expired entries on access.
   * Refreshes LRU position on cache hit.
   *
   * @param {string} hash - SHA-256 hex hash of API key
   * @returns {Object|null} Cached tenant or null on miss/expired
   */
  get(hash) {
    if (!hash || typeof hash !== 'string') {
      return null;
    }

    const entry = this.entries.get(hash);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    const now = this.clock.now();
    if (now >= entry.expiresAt) {
      this.entries.delete(hash);
      this.stats.expirations++;
      this.stats.misses++;
      return null;
    }

    // Refresh LRU order: delete and re-insert so key moves to the end of Map iteration order
    this.entries.delete(hash);
    entry.lastAccess = now;
    this.entries.set(hash, entry);

    this.stats.hits++;
    return entry.tenant;
  }

  /**
   * Store a positive tenant lookup in the cache.
   * Enforces positive caching only (never stores null/undefined).
   * Stores a frozen defensive copy containing only id and name.
   * Evicts least recently used entry if capacity is exceeded.
   *
   * @param {string} hash - SHA-256 hex hash of API key
   * @param {Object} tenant - Tenant object ({ id, name })
   */
  set(hash, tenant) {
    // Positive lookup caching only; never cache null, undefined, or invalid results
    if (
      !hash ||
      typeof hash !== 'string' ||
      !tenant ||
      typeof tenant !== 'object' ||
      !tenant.id
    ) {
      return;
    }

    const now = this.clock.now();

    // If key already exists, delete it first to refresh position
    if (this.entries.has(hash)) {
      this.entries.delete(hash);
    } else if (this.entries.size >= this.maxEntries) {
      // LRU Eviction: the first key in Map insertion order is the least recently accessed
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    // Defensive copy containing only id and name, frozen to prevent caller mutation
    const defensiveTenant = Object.freeze({
      id: tenant.id,
      name: tenant.name !== undefined ? tenant.name : null,
    });

    this.entries.set(hash, {
      tenant: defensiveTenant,
      expiresAt: now + this.ttlMs,
      lastAccess: now,
    });
  }

  /**
   * Get an entry from cache or fetch it via single-flight database query.
   * Coalesces concurrent lookups for the identical hash onto one pending promise.
   * Different hashes run independently without blocking one another.
   *
   * @param {string} hash - SHA-256 hex hash of API key
   * @param {Function} fetchFn - Async supplier that performs the DB query
   * @returns {Promise<Object|null>}
   */
  async getOrFetch(hash, fetchFn) {
    if (!hash || typeof hash !== 'string') {
      return await fetchFn();
    }

    // 1. Check cache first
    const cached = this.get(hash);
    if (cached !== null) {
      return cached;
    }

    // 2. Check if a lookup for this hash is already in flight (single-flight deduplication)
    let pending = this.pendingLookups.get(hash);
    if (pending) {
      return await pending;
    }

    // 3. Initiate single-flight lookup
    pending = (async () => {
      try {
        const result = await fetchFn();
        // Positive lookup caching only: only cache when tenant exists
        // AND this in-flight lookup is still the active pending lookup for this hash
        // (i.e. neither invalidate() nor clear() was called during this fetch).
        if (this.pendingLookups.get(hash) === pending) {
          if (result && result.id) {
            this.set(hash, result);
          }
        }
        return result;
      } finally {
        // Guarantee pending lookup cleanup on either resolution or rejection,
        // ONLY if pendingLookups still references this exact promise.
        // If invalidate() removed it, or a newer lookup was registered after invalidation,
        // we must not accidentally delete the newer lookup's entry.
        if (this.pendingLookups.get(hash) === pending) {
          this.pendingLookups.delete(hash);
        }
      }
    })();

    this.pendingLookups.set(hash, pending);
    return await pending;
  }

  /**
   * Invalidate a specific tenant by API key hash.
   * Removes cached entry and invalidates active in-flight lookup identity so
   * a resolving in-flight fetch cannot repopulate the cache with stale state.
   *
   * @param {string} hash - SHA-256 hex hash
   * @returns {boolean} True if an entry was removed from cache or pending lookups
   */
  invalidate(hash) {
    if (!hash || typeof hash !== 'string') {
      return false;
    }
    const deletedFromEntries = this.entries.delete(hash);
    const deletedFromPending = this.pendingLookups.delete(hash);
    return deletedFromEntries || deletedFromPending;
  }

  /**
   * Clear all cached entries, pending lookups, and telemetry counters.
   */
  clear() {
    this.entries.clear();
    this.pendingLookups.clear();
    this.resetStats();
  }

  /**
   * Reset telemetry statistics counters.
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };
  }

  /**
   * Prune expired entries to reclaim memory.
   *
   * @returns {number} Count of expired entries removed
   */
  cleanup() {
    const now = this.clock.now();
    let expiredCount = 0;
    for (const [hash, entry] of this.entries.entries()) {
      if (now >= entry.expiresAt) {
        this.entries.delete(hash);
        this.stats.expirations++;
        expiredCount++;
      }
    }
    return expiredCount;
  }

  /**
   * Return copy of telemetry statistics.
   */
  getStats() {
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      expirations: this.stats.expirations,
      size: this.entries.size,
      pendingLookups: this.pendingLookups.size,
    };
  }

  /**
   * Graceful shutdown: clears cleanup interval and cache.
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }
}

export const defaultTenantKeyCache = new TenantKeyCache();
export default defaultTenantKeyCache;
