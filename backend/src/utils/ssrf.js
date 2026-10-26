/**
 * SSRF (Server-Side Request Forgery) protection utilities.
 * Validates URLs to prevent requests to internal/private resources.
 */

import { URL } from 'url';

/**
 * Unsafe URL schemes
 */
const UNSAFE_SCHEMES = new Set([
  'file',
  'ftp',
  'gopher',
  'dict',
  'ldap',
  'tftp',
]);

/**
 * Private/reserved IP ranges (CIDR notation)
 * We'll check IPv4 ranges for now
 */
const PRIVATE_RANGES = [
  { start: '127.0.0.0', end: '127.255.255.255' }, // Loopback
  { start: '10.0.0.0', end: '10.255.255.255' }, // Private Class A
  { start: '172.16.0.0', end: '172.31.255.255' }, // Private Class B
  { start: '192.168.0.0', end: '192.168.255.255' }, // Private Class C
  { start: '169.254.0.0', end: '169.254.255.255' }, // Link-local
  { start: '0.0.0.0', end: '0.255.255.255' }, // Current network
  { start: '224.0.0.0', end: '239.255.255.255' }, // Multicast
  { start: '255.255.255.255', end: '255.255.255.255' }, // Broadcast
];

/**
 * Convert IP string to integer for comparison
 */
function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  return (
    (parts[0] << 24) +
    (parts[1] << 16) +
    (parts[2] << 8) +
    parts[3]
  );
}

/**
 * Check if IP is in private range
 */
function isPrivateIP(ip) {
  const ipNum = ipToInt(ip);
  for (const range of PRIVATE_RANGES) {
    if (
      ipNum >= ipToInt(range.start) &&
      ipNum <= ipToInt(range.end)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validate URL for SSRF protection
 * @throws {Error} if URL is unsafe
 */
export function validateUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch (err) {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  // Check scheme
  if (UNSAFE_SCHEMES.has(url.protocol.replace(':', ''))) {
    throw new Error(`Unsafe URL scheme: ${url.protocol}`);
  }

  // Only allow http and https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http and https schemes are allowed: ${url.protocol}`);
  }

  // Check hostname for private IPs
  const hostname = url.hostname;
  
  // Check for localhost variants
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('127.') ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0'
  ) {
    throw new Error(`Localhost and loopback addresses are not allowed: ${hostname}`);
  }

  // Check for private IP ranges (IPv4 only for now)
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(`Private IP addresses are not allowed: ${hostname}`);
    }
  }

  // Note: DNS resolution and DNS rebinding attacks are not fully mitigated here.
  // This is a basic validation; full protection requires DNS resolution at delivery time
  // with IP re-validation. Documented limitation.

  return true;
}

export default { validateUrl };
