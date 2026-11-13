/**
 * SSRF (Server-Side Request Forgery) protection utilities.
 * Validates URLs and resolved network destinations to prevent requests to
 * internal, private, loopback, link-local, and cloud metadata resources.
 */

import { URL } from 'url';
import net from 'net';
import dns from 'dns';
import config from '../config/index.js';
import { ValidationError } from '../middleware/errorHandler.js';

/**
 * Allowed URL schemes
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Disallowed hostname patterns (case-insensitive)
 */
const BANNED_HOST_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.lan',
  '.corp',
  '.home',
  '.arpa',
];

const BANNED_EXACT_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'instance-data',
  'metadata',
]);

/**
 * IPv4 Private & Reserved CIDR Ranges (as unsigned integers [start, end])
 */
const IPV4_BLOCKED_RANGES = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 (Current network)
  [0x0a000000, 0x0affffff], // 10.0.0.0/8 (Private Class A - RFC 1918)
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (Shared Address Space / CGNAT - RFC 6598)
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (Loopback - RFC 1122)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (Link-local & Cloud Metadata - RFC 3927)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12 (Private Class B - RFC 1918)
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24 (IETF Protocol Assignments - RFC 6890)
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 (TEST-NET-1 - RFC 5737)
  [0xc0586300, 0xc05863ff], // 192.88.99.0/24 (6to4 Relay Anycast - RFC 3068)
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 (Private Class C - RFC 1918)
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 (Benchmarking - RFC 2544)
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24 (TEST-NET-2 - RFC 5737)
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 (TEST-NET-3 - RFC 5737)
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 (Multicast - RFC 5771)
  [0xf0000000, 0xffffffff], // 240.0.0.0/4 & 255.255.255.255 (Reserved & Broadcast)
];

/**
 * Loopback-only IPv4 range (127.0.0.0/8)
 */
const IPV4_LOOPBACK_RANGE = [0x7f000000, 0x7fffffff];

/**
 * Cloud Metadata IPv4 range (169.254.0.0/16)
 */
const IPV4_METADATA_RANGE = [0xa9fe0000, 0xa9feffff];

/**
 * Convert standard IPv4 dotted string to unsigned 32-bit integer.
 * @param {string} ip
 * @returns {number|null}
 */
export function ipv4ToLong(ip) {
  if (typeof ip !== 'string') return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let num = 0;
  for (let i = 0; i < 4; i++) {
    // Strictly disallow leading zeros that can signify octal in naive implementations
    if (parts[i].length > 1 && parts[i].startsWith('0')) {
      return null;
    }
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return null;
    }
    num = ((num << 8) + n) >>> 0;
  }
  return num;
}

/**
 * Check if IPv4 address is in loopback (127.0.0.0/8).
 */
export function isLoopbackIPv4(ip) {
  const num = ipv4ToLong(ip);
  if (num === null) return false;
  return num >= IPV4_LOOPBACK_RANGE[0] && num <= IPV4_LOOPBACK_RANGE[1];
}

/**
 * Check if IPv4 address is in cloud metadata / link-local (169.254.0.0/16).
 */
export function isMetadataIPv4(ip) {
  const num = ipv4ToLong(ip);
  if (num === null) return false;
  return num >= IPV4_METADATA_RANGE[0] && num <= IPV4_METADATA_RANGE[1];
}

/**
 * Check if IPv4 is in any private, loopback, or reserved range.
 */
export function isPrivateOrReservedIPv4(ip) {
  const num = ipv4ToLong(ip);
  if (num === null) return true; // Malformed / unparseable is treated as unsafe
  for (const [start, end] of IPV4_BLOCKED_RANGES) {
    if (num >= start && num <= end) {
      return true;
    }
  }
  return false;
}

/**
 * Check if running in production environment.
 * @returns {boolean}
 */
export function isProductionEnv() {
  return (process.env.NODE_ENV || config?.nodeEnv) === 'production';
}

/**
 * Parse and normalize IPv6 address into eight 16-bit words.
 * Handles embedded IPv4 in IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1).
 * Strictly validates syntax using Node's net.isIP before parsing words.
 * @param {string} ip
 * @returns {number[]|null}
 */
export function parseIPv6Words(ip) {
  if (typeof ip !== 'string' || !ip.trim()) return null;
  let normalized = ip.toLowerCase().trim();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }

  // Strict syntax validation via Node's net.isIP
  if (net.isIP(normalized) !== 6) {
    return null;
  }

  // Handle IPv4-mapped trailing notation (e.g. ::ffff:192.168.1.1)
  const v4Match = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const v4Parts = v4Match[1].split('.').map(Number);
    if (v4Parts.length !== 4 || v4Parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
    const high = (v4Parts[0] << 8) | v4Parts[1];
    const low = (v4Parts[2] << 8) | v4Parts[3];
    normalized = normalized.slice(0, normalized.length - v4Match[1].length) + high.toString(16) + ':' + low.toString(16);
  }

  const parts = normalized.split('::');
  if (parts.length > 2) return null;

  let words = [];
  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    if (left.some((x) => !/^[0-9a-f]{1,4}$/.test(x)) || right.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) {
      return null;
    }
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    words = [
      ...left.map((x) => parseInt(x, 16)),
      ...Array(missing).fill(0),
      ...right.map((x) => parseInt(x, 16)),
    ];
  } else {
    const rawWords = normalized.split(':');
    if (rawWords.length !== 8 || rawWords.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) {
      return null;
    }
    words = rawWords.map((x) => parseInt(x, 16));
  }

  if (words.length !== 8 || words.some((w) => isNaN(w) || w < 0 || w > 0xffff)) {
    return null;
  }
  return words;
}

/**
 * Check if IPv6 is loopback (::1).
 */
export function isLoopbackIPv6(words) {
  if (!words || words.length !== 8) return false;
  for (let i = 0; i < 7; i++) {
    if (words[i] !== 0) return false;
  }
  return words[7] === 1;
}

/**
 * Check if IPv6 is private, link-local, multicast, or reserved.
 */
export function isPrivateOrReservedIPv6(words, allowLocal = false) {
  if (!words || words.length !== 8) return true; // Malformed is treated as unsafe
  const isProduction = isProductionEnv();
  const effectiveAllowLocal = !isProduction && Boolean(allowLocal);

  // Unspecified (::)
  if (words.every((w) => w === 0)) return true;

  // Loopback (::1)
  if (isLoopbackIPv6(words)) {
    return !effectiveAllowLocal;
  }

  // IPv4-mapped IPv6 (::ffff:0:0/96)
  if (
    words[0] === 0 &&
    words[1] === 0 &&
    words[2] === 0 &&
    words[3] === 0 &&
    words[4] === 0 &&
    words[5] === 0xffff
  ) {
    const v4Long = ((words[6] << 16) | words[7]) >>> 0;
    if (effectiveAllowLocal && v4Long >= IPV4_LOOPBACK_RANGE[0] && v4Long <= IPV4_LOOPBACK_RANGE[1]) {
      return false; // Local loopback permitted under allowLocal in non-production
    }
    // Metadata is ALWAYS blocked
    if (v4Long >= IPV4_METADATA_RANGE[0] && v4Long <= IPV4_METADATA_RANGE[1]) {
      return true;
    }
    for (const [start, end] of IPV4_BLOCKED_RANGES) {
      if (v4Long >= start && v4Long <= end) return true;
    }
    return false;
  }

  // 6to4 prefix (2002::/16) - embeds IPv4 in words[1] & words[2]
  if (words[0] === 0x2002) {
    const v4Long = ((words[1] << 16) | words[2]) >>> 0;
    for (const [start, end] of IPV4_BLOCKED_RANGES) {
      if (v4Long >= start && v4Long <= end) return true;
    }
  }

  // Link-local unicast (fe80::/10)
  if ((words[0] & 0xffc0) === 0xfe80) return true;

  // Unique local addresses (fc00::/7 - covers fc00:: through fdff::)
  if ((words[0] & 0xfe00) === 0xfc00) return true;

  // Multicast (ff00::/8)
  if ((words[0] & 0xff00) === 0xff00) return true;

  // Documentation (2001:db8::/32)
  if (words[0] === 0x2001 && words[1] === 0x0db8) return true;

  return false;
}

/**
 * Validate a concrete IP address (IPv4 or IPv6 string).
 * @param {string} ip
 * @param {boolean} allowLocal
 * @throws {ValidationError}
 */
export function checkIpAddress(ip, allowLocal = false) {
  const isProduction = isProductionEnv();
  const effectiveAllowLocal = !isProduction && Boolean(allowLocal);

  let cleanIp = typeof ip === 'string' ? ip.trim() : '';
  if (cleanIp.startsWith('[') && cleanIp.endsWith(']')) {
    cleanIp = cleanIp.slice(1, -1);
  }

  if (net.isIPv4(cleanIp)) {
    if (isMetadataIPv4(cleanIp)) {
      throw new ValidationError(`Destination IP '${cleanIp}' is blocked (cloud metadata address)`);
    }
    if (isLoopbackIPv4(cleanIp)) {
      if (!effectiveAllowLocal) {
        throw new ValidationError(`Destination IP '${cleanIp}' is blocked (loopback address)`);
      }
      return;
    }
    if (isPrivateOrReservedIPv4(cleanIp)) {
      throw new ValidationError(`Destination IP '${cleanIp}' is blocked (private or reserved RFC 1918 range)`);
    }
    return;
  }

  if (net.isIPv6(cleanIp)) {
    const words = parseIPv6Words(cleanIp);
    if (!words) {
      throw new ValidationError(`Invalid IPv6 address format: '${cleanIp}'`);
    }
    if (isLoopbackIPv6(words)) {
      if (!effectiveAllowLocal) {
        throw new ValidationError(`Destination IPv6 '${cleanIp}' is blocked (loopback address)`);
      }
      return;
    }
    if (isPrivateOrReservedIPv6(words, effectiveAllowLocal)) {
      throw new ValidationError(`Destination IPv6 '${cleanIp}' is blocked (private, link-local, or reserved address)`);
    }
    return;
  }

  throw new ValidationError(`Invalid IP address format: '${ip}'`);
}

/**
 * Sanitize a URL for safe logging (removes credentials, query parameters, and fragments).
 * @param {string} urlString
 * @returns {string} Sanitized URL
 */
export function sanitizeUrlForLogging(urlString) {
  if (typeof urlString !== 'string') return '[INVALID_URL]';
  try {
    const parsed = new URL(urlString.trim());
    const hasQuery = parsed.search && parsed.search.length > 1;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${hasQuery ? '?[REDACTED]' : ''}`;
  } catch {
    return '[INVALID_URL]';
  }
}

/**
 * Compute normalized origin (scheme://hostname:effectivePort) per RFC 6454.
 *
 * @param {string|URL} url
 * @returns {string|null}
 */
export function getNormalizedOrigin(url) {
  try {
    const u = typeof url === 'string' ? new URL(url) : url;
    const protocol = u.protocol.toLowerCase();
    const hostname = u.hostname.toLowerCase();
    const port = u.port || (protocol === 'https:' ? '443' : '80');
    return `${protocol}//${hostname}:${port}`;
  } catch {
    return null;
  }
}

/**
 * Check if two URLs share the exact same normalized origin.
 *
 * @param {string|URL} url1
 * @param {string|URL} url2
 * @returns {boolean}
 */
export function isSameOrigin(url1, url2) {
  const o1 = getNormalizedOrigin(url1);
  const o2 = getNormalizedOrigin(url2);
  return Boolean(o1 && o2 && o1 === o2);
}

/**
 * Validate and resolve a webhook destination URL for SSRF protection.
 * Returns parsed connection details including the pinned IP address.
 *
 * @param {string} urlString - Webhook destination URL
 * @param {Object} [options]
 * @param {boolean} [options.allowLocal] - Explicitly permit localhost/loopback (strictly ignored in production)
 * @param {boolean} [options.resolveDns] - Whether to perform DNS resolution (mandatory in production)
 * @param {Function} [options.dnsLookup] - Custom DNS lookup function (ignored in production)
 * @returns {Promise<Object>} Resolved connection info with pinned address
 * @throws {ValidationError} If unsafe
 */
export async function validateAndResolveUrl(urlString, options = {}) {
  if (typeof urlString !== 'string' || !urlString.trim()) {
    throw new ValidationError('Webhook URL must be a non-empty string');
  }

  let url;
  try {
    url = new URL(urlString.trim());
  } catch {
    throw new ValidationError(`Invalid URL format: ${urlString}`);
  }

  // 1. Protocol validation (http / https only)
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new ValidationError(`Disallowed URL scheme '${url.protocol}'. Only http: and https: are allowed.`);
  }

  // 2. Reject embedded credentials (user:pass@)
  if (url.username || url.password) {
    throw new ValidationError('URLs with embedded credentials (user:pass@) are disallowed.');
  }

  // Check for obfuscated IP format in raw input before WHATWG normalization
  const rawHostMatch = urlString.trim().match(/^https?:\/\/(?:[^@]+@)?(\[[^\]]+\]|[^/?#:]+)/i);
  if (rawHostMatch) {
    const rawHost = rawHostMatch[1];
    if (/^0x[0-9a-f]+$/i.test(rawHost) || /^\d+$/.test(rawHost)) {
      throw new ValidationError(`Obfuscated IP address representations are blocked: ${rawHost}`);
    }
  }

  // 3. Port validation
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError(`Invalid port: ${url.port}. Port must be between 1 and 65535.`);
    }
  }

  // 4. Hostname extraction & cleanup
  let hostname = url.hostname.trim().toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }
  if (!hostname) {
    throw new ValidationError('Webhook URL must include a valid hostname.');
  }

  // Determine effective allowLocal policy:
  // In production (NODE_ENV === 'production'), allowLocal is STRICTLY and unconditionally false.
  const isProduction = isProductionEnv();
  const effectiveAllowLocal =
    !isProduction &&
    Boolean(options.allowLocal ?? config.ssrf?.allowLocal ?? false);

  // In production, any attempt to bypass DNS resolution or use test overrides must fail closed
  if (isProduction) {
    if (options.resolveDns === false || options.enforceDns === false) {
      throw new ValidationError('Disabling DNS resolution is strictly prohibited in production');
    }
    if (options.allowUnresolved) {
      throw new ValidationError('Unresolved destinations are strictly prohibited in production');
    }
  }

  // 5. Check blocked hostname keywords
  if (BANNED_EXACT_HOSTNAMES.has(hostname)) {
    if (hostname === 'localhost') {
      if (!effectiveAllowLocal) {
        throw new ValidationError("Destination host 'localhost' is blocked.");
      }
    } else {
      // Cloud metadata names are ALWAYS blocked, even with allowLocal
      throw new ValidationError(`Destination host '${hostname}' is blocked (cloud metadata address).`);
    }
  }

  for (const suffix of BANNED_HOST_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      if (hostname.endsWith('.localhost') && effectiveAllowLocal) {
        // Allowed only for local test suite
      } else {
        throw new ValidationError(`Local/internal domain suffix '${suffix}' in '${hostname}' is blocked.`);
      }
    }
  }

  // 6. Check for obfuscated IP formats (e.g. hex '0x7f000001' or decimal '2130706433')
  if (/^0x[0-9a-f]+$/i.test(hostname) || /^\d+$/.test(hostname)) {
    throw new ValidationError(`Obfuscated IP address representations are blocked: ${hostname}`);
  }

  const portNumber = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);

  // 7. Check if host is an IP literal
  const ipVersion = net.isIP(hostname);
  if (ipVersion !== 0) {
    checkIpAddress(hostname, effectiveAllowLocal);
    return {
      url,
      hostname,
      port: portNumber,
      protocol: url.protocol,
      path: (url.pathname || '/') + (url.search || ''),
      pinnedAddress: hostname,
      pinnedFamily: ipVersion,
      addresses: [{ address: hostname, family: ipVersion }],
      isIpLiteral: true,
    };
  }

  // 8. DNS Resolution Check (prevents private hosts and DNS rebinding)
  // In production, DNS resolution is mandatory for all non-IP hostnames.
  const shouldResolve = isProduction
    ? true
    : options.resolveDns !== false && (options.dnsLookup || config.ssrf?.enforceDns !== false);

  let pinnedAddress = null;
  let pinnedFamily = null;
  let addresses = [];

  if (shouldResolve) {
    // In production, test-only lookupFn override MUST be ignored; strictly use dns.promises.lookup!
    const lookupFn = (!isProduction && typeof options.dnsLookup === 'function')
      ? options.dnsLookup
      : dns.promises.lookup;

    const dnsTimeoutMs = options.dnsTimeoutMs ?? options.timeoutMs;
    let records;
    try {
      /**
       * Architectural Note on Node.js DNS Resolution & Cancellation:
       * Node.js `dns.lookup` and `dns.promises.lookup` delegate directly to `uv_getaddrinfo`
       * on libuv's thread pool, which executes the synchronous C library call `getaddrinfo(3)`.
       * The underlying operating system resolver API does not provide an abort or cancellation
       * mechanism (unlike c-ares used in `dns.resolve*`, which cannot read local hosts files).
       * Therefore, true cancellation of an in-flight OS DNS lookup is fundamentally unavailable in Node.js.
       *
       * To protect HookForge workers from blocking indefinitely on unresponsive nameservers,
       * we enforce a bounded wait using Promise.race. When the deadline expires, the promise
       * rejects immediately with a TimeoutError so the caller can fail closed and avoid
       * making any outbound connection. However, Promise.race only stops waiting for the result;
       * it does not cancel the underlying OS lookup thread.
       */
      if (typeof dnsTimeoutMs === 'number' && dnsTimeoutMs > 0 && dnsTimeoutMs < Infinity) {
        let timer = null;
        try {
          records = await Promise.race([
            lookupFn(hostname, { all: true, verbatim: true }),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                const timeoutErr = new Error(`DNS resolution timed out for hostname '${hostname}' after ${dnsTimeoutMs}ms`);
                timeoutErr.name = 'TimeoutError';
                timeoutErr.code = 'ETIMEDOUT';
                reject(timeoutErr);
              }, dnsTimeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      } else {
        records = await lookupFn(hostname, { all: true, verbatim: true });
      }
    } catch (err) {
      if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT' || err.message === 'Timeout') {
        const timeoutErr = new Error('Timeout');
        timeoutErr.name = 'TimeoutError';
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      if (options.allowUnresolved && !isProduction) {
        return {
          url,
          hostname,
          port: portNumber,
          protocol: url.protocol,
          path: (url.pathname || '/') + (url.search || ''),
          pinnedAddress: null,
          pinnedFamily: null,
          addresses: [],
          isIpLiteral: false,
        };
      }
      throw new ValidationError(`DNS resolution failed for hostname '${hostname}': ${err.message}`);
    }

    if (!Array.isArray(records) || records.length === 0) {
      throw new ValidationError(`No DNS A/AAAA records found for hostname '${hostname}'`);
    }

    // CRITICAL: Validate EVERY resolved record! Reject if ANY address is private/loopback/metadata.
    for (const rec of records) {
      checkIpAddress(rec.address, effectiveAllowLocal);
    }

    pinnedAddress = records[0].address;
    pinnedFamily = records[0].family ? Number(records[0].family) : (net.isIPv4(pinnedAddress) ? 4 : 6);
    addresses = records;
  }

  // Fail closed if pinned address could not be established
  if (!pinnedAddress) {
    throw new ValidationError(`Failed to establish a pinned IP address for hostname '${hostname}'`);
  }

  return {
    url,
    hostname,
    port: portNumber,
    protocol: url.protocol,
    path: (url.pathname || '/') + (url.search || ''),
    pinnedAddress,
    pinnedFamily,
    addresses,
    isIpLiteral: false,
  };
}

/**
 * Validate URL string for SSRF protection.
 * Returns true if valid, throws ValidationError if blocked.
 *
 * @param {string} urlString - Webhook destination URL
 * @param {Object} [options]
 * @returns {Promise<boolean>} True if safe
 * @throws {ValidationError} If unsafe
 */
export async function validateUrl(urlString, options = {}) {
  await validateAndResolveUrl(urlString, options);
  return true;
}

export default {
  validateUrl,
  validateAndResolveUrl,
  sanitizeUrlForLogging,
  getNormalizedOrigin,
  isSameOrigin,
  isProductionEnv,
  checkIpAddress,
  ipv4ToLong,
  isPrivateOrReservedIPv4,
  parseIPv6Words,
  isPrivateOrReservedIPv6,
};
