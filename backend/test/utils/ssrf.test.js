/**
 * Unit tests for SSRF Protection Utility.
 * Thoroughly validates IP parsers, CIDR classifications, production security invariants,
 * origin normalization, and DNS resolution requirements.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateUrl,
  validateAndResolveUrl,
  checkIpAddress,
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  parseIPv6Words,
  ipv4ToLong,
  getNormalizedOrigin,
  isSameOrigin,
} from '../../src/utils/ssrf.js';
import dns from 'dns';

describe('SSRF Protection Utility', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  describe('ipv4ToLong and isPrivateOrReservedIPv4', () => {
    it('converts valid IPv4 strings to 32-bit unsigned integer', () => {
      expect(ipv4ToLong('127.0.0.1')).toBe(0x7f000001);
      expect(ipv4ToLong('10.0.0.1')).toBe(0x0a000001);
      expect(ipv4ToLong('169.254.169.254')).toBe(0xa9fe0000 + 0xa9fe);
      expect(ipv4ToLong('invalid')).toBeNull();
      expect(ipv4ToLong('256.0.0.1')).toBeNull();
      expect(ipv4ToLong('0127.0.0.1')).toBeNull(); // Leading zero blocked
    });

    it('identifies private, loopback, and cloud metadata IPv4 ranges', () => {
      // Loopback
      expect(isPrivateOrReservedIPv4('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('127.255.255.255')).toBe(true);

      // Cloud metadata & Link-local
      expect(isPrivateOrReservedIPv4('169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIPv4('169.254.1.1')).toBe(true);

      // RFC 1918 Private
      expect(isPrivateOrReservedIPv4('10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('10.255.255.255')).toBe(true);
      expect(isPrivateOrReservedIPv4('172.16.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('172.31.255.255')).toBe(true);
      expect(isPrivateOrReservedIPv4('192.168.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('192.168.255.255')).toBe(true);

      // Shared space / CGNAT (100.64.0.0/10)
      expect(isPrivateOrReservedIPv4('100.64.0.1')).toBe(true);

      // Current network & Broadcast
      expect(isPrivateOrReservedIPv4('0.0.0.0')).toBe(true);
      expect(isPrivateOrReservedIPv4('255.255.255.255')).toBe(true);

      // Multicast & Reserved
      expect(isPrivateOrReservedIPv4('224.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('240.0.0.1')).toBe(true);

      // Public IPs should not be blocked
      expect(isPrivateOrReservedIPv4('93.184.216.34')).toBe(false); // example.com
      expect(isPrivateOrReservedIPv4('8.8.8.8')).toBe(false); // Google DNS
      expect(isPrivateOrReservedIPv4('1.1.1.1')).toBe(false); // Cloudflare DNS
      expect(isPrivateOrReservedIPv4('172.32.0.1')).toBe(false); // Public Class B
    });
  });

  describe('IPv6 parsing and classification', () => {
    it('parses valid IPv6 addresses into eight 16-bit words', () => {
      const loopbackWords = parseIPv6Words('::1');
      expect(loopbackWords).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);

      const bracketedLoopback = parseIPv6Words('[::1]');
      expect(bracketedLoopback).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);

      const linkLocalWords = parseIPv6Words('fe80::1');
      expect(linkLocalWords[0]).toBe(0xfe80);
      expect(linkLocalWords[7]).toBe(1);

      const v4MappedWords = parseIPv6Words('::ffff:127.0.0.1');
      expect(v4MappedWords[5]).toBe(0xffff);
      expect(v4MappedWords[6]).toBe(0x7f00);
      expect(v4MappedWords[7]).toBe(0x0001);

      const fullWords = parseIPv6Words('2001:0db8:0000:0000:0000:0000:0000:0001');
      expect(fullWords).toEqual([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]);
    });

    it('strictly rejects malformed IPv6 addresses', () => {
      // Non-hexadecimal characters
      expect(parseIPv6Words('::gggg')).toBeNull();
      expect(parseIPv6Words('2001:xyz::1')).toBeNull();

      // Words with more than 4 hexadecimal digits
      expect(parseIPv6Words('12345::1')).toBeNull();
      expect(parseIPv6Words('2001:00000::1')).toBeNull();

      // Multiple double colons (::)
      expect(parseIPv6Words('1::2::3')).toBeNull();
      expect(parseIPv6Words('fe80::1::2')).toBeNull();

      // Triple or excessive colons
      expect(parseIPv6Words(':::1')).toBeNull();
      expect(parseIPv6Words('1::::2')).toBeNull();

      // Single leading or trailing colon without compression
      expect(parseIPv6Words(':1:2:3:4:5:6:7:8')).toBeNull();
      expect(parseIPv6Words('1:2:3:4:5:6:7:8:')).toBeNull();

      // Too many or too few words
      expect(parseIPv6Words('1:2:3:4:5:6:7:8:9')).toBeNull();
      expect(parseIPv6Words('1:2:3:4:5:6:7')).toBeNull();

      // Malformed embedded IPv4
      expect(parseIPv6Words('::ffff:300.1.1.1')).toBeNull();
      expect(parseIPv6Words('::ffff:1.2.3.4.5')).toBeNull();
      expect(parseIPv6Words('::ffff:1.2.3')).toBeNull();
      expect(parseIPv6Words('::ffff:abc.1.1.1')).toBeNull();

      // Empty or non-string inputs
      expect(parseIPv6Words('')).toBeNull();
      expect(parseIPv6Words('   ')).toBeNull();
      expect(parseIPv6Words(null)).toBeNull();
      expect(parseIPv6Words(undefined)).toBeNull();
      expect(parseIPv6Words(12345)).toBeNull();
    });

    it('identifies private, loopback, link-local, and ULA IPv6 ranges', () => {
      expect(isPrivateOrReservedIPv6(parseIPv6Words('::'))).toBe(true); // Unspecified
      expect(isPrivateOrReservedIPv6(parseIPv6Words('::1'))).toBe(true); // Loopback
      expect(isPrivateOrReservedIPv6(parseIPv6Words('[::1]'))).toBe(true);
      expect(isPrivateOrReservedIPv6(parseIPv6Words('fe80::1'))).toBe(true); // Link-local
      expect(isPrivateOrReservedIPv6(parseIPv6Words('fc00::1'))).toBe(true); // ULA
      expect(isPrivateOrReservedIPv6(parseIPv6Words('fd12:3456::1'))).toBe(true); // ULA
      expect(isPrivateOrReservedIPv6(parseIPv6Words('ff02::1'))).toBe(true); // Multicast
      expect(isPrivateOrReservedIPv6(parseIPv6Words('2001:db8::1'))).toBe(true); // Documentation

      // IPv4-mapped IPv6
      expect(isPrivateOrReservedIPv6(parseIPv6Words('::ffff:127.0.0.1'))).toBe(true);
      expect(isPrivateOrReservedIPv6(parseIPv6Words('::ffff:169.254.169.254'))).toBe(true);
      expect(isPrivateOrReservedIPv6(parseIPv6Words('::ffff:10.0.0.1'))).toBe(true);
      expect(isPrivateOrReservedIPv6(parseIPv6Words('::ffff:93.184.216.34'))).toBe(false); // Public mapped

      // 6to4 prefix with embedded private IPv4
      expect(isPrivateOrReservedIPv6(parseIPv6Words('2002:7f00:0001::'))).toBe(true);
      expect(isPrivateOrReservedIPv6(parseIPv6Words('2002:0a00:0001::'))).toBe(true);

      // Public IPv6
      expect(isPrivateOrReservedIPv6(parseIPv6Words('2606:2800:220:1:248:1893:25c8:1946'))).toBe(false);
    });
  });

  describe('Origin normalization and comparison', () => {
    it('normalizes origins with default and explicit ports', () => {
      expect(getNormalizedOrigin('http://example.com')).toBe('http://example.com:80');
      expect(getNormalizedOrigin('http://example.com/some/path?param=1')).toBe('http://example.com:80');
      expect(getNormalizedOrigin('http://example.com:80')).toBe('http://example.com:80');
      expect(getNormalizedOrigin('http://example.com:8080/path')).toBe('http://example.com:8080');

      expect(getNormalizedOrigin('https://example.com')).toBe('https://example.com:443');
      expect(getNormalizedOrigin('https://example.com:443')).toBe('https://example.com:443');
      expect(getNormalizedOrigin('https://example.com:8443')).toBe('https://example.com:8443');

      expect(getNormalizedOrigin('invalid-url')).toBeNull();
    });

    it('correctly compares origins for same-origin policy enforcement', () => {
      // Same origins
      expect(isSameOrigin('http://example.com', 'http://example.com:80')).toBe(true);
      expect(isSameOrigin('https://api.test.com/v1', 'https://api.test.com:443/v2')).toBe(true);
      expect(isSameOrigin('http://localhost:3000/a', 'http://localhost:3000/b')).toBe(true);

      // Different origins: scheme
      expect(isSameOrigin('http://example.com', 'https://example.com')).toBe(false);
      expect(isSameOrigin('http://example.com:443', 'https://example.com:443')).toBe(false);

      // Different origins: host
      expect(isSameOrigin('http://example.com', 'http://other.com')).toBe(false);
      expect(isSameOrigin('https://api.example.com', 'https://auth.example.com')).toBe(false);

      // Different origins: port
      expect(isSameOrigin('http://example.com:8080', 'http://example.com:8081')).toBe(false);
      expect(isSameOrigin('http://example.com:80', 'http://example.com:8080')).toBe(false);

      // Invalid URLs
      expect(isSameOrigin('invalid', 'http://example.com')).toBe(false);
    });
  });

  describe('validateUrl baseline checks', () => {
    it('blocks URLs with disallowed schemes', async () => {
      await expect(validateUrl('file:///etc/passwd')).rejects.toThrow('Disallowed URL scheme');
      await expect(validateUrl('ftp://ftp.example.com/file')).rejects.toThrow('Disallowed URL scheme');
      await expect(validateUrl('gopher://example.com')).rejects.toThrow('Disallowed URL scheme');
      await expect(validateUrl('javascript:alert(1)')).rejects.toThrow('Disallowed URL scheme');
    });

    it('blocks URLs with embedded credentials', async () => {
      await expect(validateUrl('http://user:pass@example.com/webhook')).rejects.toThrow(
        'URLs with embedded credentials'
      );
    });

    it('blocks invalid port numbers', async () => {
      await expect(validateUrl('http://example.com:0/webhook')).rejects.toThrow('Invalid port');
      await expect(validateUrl('http://example.com:70000/webhook')).rejects.toThrow(/Invalid port|Invalid URL format/);
    });

    it('blocks localhost and loopback destinations by default', async () => {
      await expect(validateUrl('http://localhost:8080/webhook')).rejects.toThrow('localhost');
      await expect(validateUrl('http://127.0.0.1:8080/webhook')).rejects.toThrow('loopback');
      await expect(validateUrl('http://127.0.0.2:9000/webhook')).rejects.toThrow('loopback');
      await expect(validateUrl('http://[::1]:8080/webhook')).rejects.toThrow('loopback');
    });

    it('blocks cloud metadata endpoints unconditionally', async () => {
      await expect(validateUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
        'cloud metadata'
      );
      await expect(validateUrl('http://metadata.google.internal/computeMetadata/v1/')).rejects.toThrow(
        'cloud metadata'
      );
      await expect(validateUrl('http://instance-data/latest/meta-data/')).rejects.toThrow(
        'cloud metadata'
      );
      // Cloud metadata must be blocked even when allowLocal is true!
      await expect(
        validateUrl('http://169.254.169.254/latest/meta-data/', { allowLocal: true })
      ).rejects.toThrow('cloud metadata');
    });

    it('blocks private IPv4 and IPv6 literal destinations', async () => {
      await expect(validateUrl('http://10.0.0.1/webhook')).rejects.toThrow('private or reserved');
      await expect(validateUrl('http://172.16.5.10/webhook')).rejects.toThrow('private or reserved');
      await expect(validateUrl('http://192.168.1.100/webhook')).rejects.toThrow('private or reserved');
      await expect(validateUrl('http://[fe80::1]/webhook')).rejects.toThrow('link-local');
      await expect(validateUrl('http://[fc00::1]/webhook')).rejects.toThrow('private');
    });

    it('blocks obfuscated IP formats', async () => {
      await expect(validateUrl('http://0x7f000001/webhook')).rejects.toThrow('Obfuscated IP');
      await expect(validateUrl('http://2130706433/webhook')).rejects.toThrow('Obfuscated IP');
    });

    it('blocks domains that resolve via DNS to private or loopback IPs', async () => {
      const mockDnsLookup = async (host) => {
        if (host === 'rebind-to-private.example') {
          return [{ address: '10.0.0.5', family: 4 }];
        }
        if (host === 'rebind-to-loopback.example') {
          return [{ address: '127.0.0.1', family: 4 }];
        }
        if (host === 'rebind-to-metadata.example') {
          return [{ address: '169.254.169.254', family: 4 }];
        }
        return [{ address: '93.184.216.34', family: 4 }];
      };

      await expect(
        validateUrl('https://rebind-to-private.example/webhook', { dnsLookup: mockDnsLookup })
      ).rejects.toThrow('private or reserved');

      await expect(
        validateUrl('https://rebind-to-loopback.example/webhook', { dnsLookup: mockDnsLookup })
      ).rejects.toThrow('loopback');

      await expect(
        validateUrl('https://rebind-to-metadata.example/webhook', { dnsLookup: mockDnsLookup })
      ).rejects.toThrow('cloud metadata');
    });

    it('allows valid public IP literals and public domain destinations in test mode', async () => {
      const mockDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

      // Public IPv4 literal
      await expect(
        validateUrl('https://93.184.216.34/webhook', { resolveDns: false })
      ).resolves.toBe(true);

      // Public IPv6 literal
      await expect(
        validateUrl('https://[2606:2800:220:1:248:1893:25c8:1946]/webhook', { resolveDns: false })
      ).resolves.toBe(true);

      // Public domain with DNS lookup
      await expect(
        validateUrl('https://safe-domain.example/webhook', { dnsLookup: mockDnsLookup })
      ).resolves.toBe(true);
    });

    it('permits loopback only in controlled non-production test mode when explicitly configured', async () => {
      process.env.NODE_ENV = 'test';
      await expect(
        validateUrl('http://127.0.0.1:9095/webhook', { allowLocal: true })
      ).resolves.toBe(true);
      await expect(
        validateUrl('http://localhost:9095/webhook', { allowLocal: true })
      ).resolves.toBe(true);
    });

    it('validates IP address strings directly via checkIpAddress', () => {
      expect(() => checkIpAddress('93.184.216.34')).not.toThrow();
      expect(() => checkIpAddress('127.0.0.1')).toThrow(/loopback/i);
      expect(() => checkIpAddress('127.0.0.2')).toThrow(/loopback/i);
      expect(() => checkIpAddress('[127.0.0.1]')).toThrow(/loopback/i);
      expect(() => checkIpAddress('10.0.0.1')).toThrow(/private/i);
      expect(() => checkIpAddress('169.254.169.254')).toThrow(/cloud metadata/i);
      expect(() => checkIpAddress('::1')).toThrow(/loopback/i);
      expect(() => checkIpAddress('[::1]')).toThrow(/loopback/i);
      expect(() => checkIpAddress('fe80::1')).toThrow(/link-local/i);
      expect(() => checkIpAddress('[fe80::1]')).toThrow(/link-local/i);
      expect(() => checkIpAddress('fc00::1')).toThrow(/private/i);
      expect(() => checkIpAddress('not-an-ip')).toThrow(/invalid ip/i);
    });
  });

  describe('Production security invariants (NODE_ENV=production)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('unconditionally rejects IPv4 loopback even when allowLocal=true', async () => {
      // 127.0.0.1
      await expect(
        validateUrl('http://127.0.0.1:8080/webhook', { allowLocal: true })
      ).rejects.toThrow(/loopback/i);

      // 127.0.0.2 (full 127.0.0.0/8 block)
      await expect(
        validateUrl('http://127.0.0.2:9000/webhook', { allowLocal: true })
      ).rejects.toThrow(/loopback/i);

      // localhost exact hostname
      await expect(
        validateUrl('http://localhost:8080/webhook', { allowLocal: true })
      ).rejects.toThrow(/localhost/i);

      // subdomains of localhost
      await expect(
        validateUrl('http://app.localhost:8080/webhook', { allowLocal: true })
      ).rejects.toThrow(/blocked/i);
    });

    it('unconditionally rejects IPv6 loopback even when allowLocal=true', async () => {
      // Standard [::1]
      await expect(
        validateUrl('http://[::1]:8080/webhook', { allowLocal: true })
      ).rejects.toThrow(/loopback/i);

      // Expanded [0:0:0:0:0:0:0:1]
      await expect(
        validateUrl('http://[0:0:0:0:0:0:0:1]:8080/webhook', { allowLocal: true })
      ).rejects.toThrow(/loopback/i);

      // IPv4-mapped IPv6 loopback [::ffff:127.0.0.1]
      await expect(
        validateUrl('http://[::ffff:127.0.0.1]:8080/webhook', { allowLocal: true })
      ).rejects.toThrow(/private, link-local, or reserved/i);
    });

    it('unconditionally rejects private, link-local, and cloud metadata in production', async () => {
      // RFC 1918 Private IPv4
      await expect(
        validateUrl('http://10.0.0.1/webhook', { allowLocal: true })
      ).rejects.toThrow(/private or reserved/i);
      await expect(
        validateUrl('http://192.168.1.1/webhook', { allowLocal: true })
      ).rejects.toThrow(/private or reserved/i);
      await expect(
        validateUrl('http://172.16.0.1/webhook', { allowLocal: true })
      ).rejects.toThrow(/private or reserved/i);

      // IPv6 link-local and ULA
      await expect(
        validateUrl('http://[fe80::1]/webhook', { allowLocal: true })
      ).rejects.toThrow(/link-local/i);
      await expect(
        validateUrl('http://[fc00::1]/webhook', { allowLocal: true })
      ).rejects.toThrow(/private/i);

      // Cloud metadata
      await expect(
        validateUrl('http://169.254.169.254/latest/meta-data/', { allowLocal: true })
      ).rejects.toThrow(/cloud metadata/i);
      await expect(
        validateUrl('http://metadata.google.internal/computeMetadata/v1/', { allowLocal: true })
      ).rejects.toThrow(/cloud metadata/i);
      await expect(
        validateUrl('http://[::ffff:169.254.169.254]/', { allowLocal: true })
      ).rejects.toThrow(/private, link-local, or reserved/i);
    });

    it('strictly forbids disabling DNS resolution in production', async () => {
      // resolveDns: false is forbidden
      await expect(
        validateAndResolveUrl('https://example.com/webhook', { resolveDns: false })
      ).rejects.toThrow(/Disabling DNS resolution is strictly prohibited in production/i);

      // enforceDns: false is forbidden
      await expect(
        validateAndResolveUrl('https://example.com/webhook', { enforceDns: false })
      ).rejects.toThrow(/Disabling DNS resolution is strictly prohibited in production/i);

      // allowUnresolved: true is forbidden
      await expect(
        validateAndResolveUrl('https://example.com/webhook', { allowUnresolved: true })
      ).rejects.toThrow(/Unresolved destinations are strictly prohibited in production/i);
    });

    it('strictly ignores test dnsLookup override in production and enforces real DNS lookup', async () => {
      const mockLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

      // Mock native dns.promises.lookup to observe that native lookup is called, not mockLookup
      const realLookupSpy = vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
      ]);

      const result = await validateAndResolveUrl('https://webhook-prod.example.com/hook', {
        dnsLookup: mockLookup, // Should be IGNORED in production!
      });

      // The test-only override must NOT have been called
      expect(mockLookup).not.toHaveBeenCalled();
      // The real dns.promises.lookup MUST have been called
      expect(realLookupSpy).toHaveBeenCalledWith('webhook-prod.example.com', {
        all: true,
        verbatim: true,
      });

      expect(result.pinnedAddress).toBe('93.184.216.34');
      expect(result.pinnedFamily).toBe(4);
    });

    it('fails closed when DNS returns no records', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([]);

      await expect(
        validateAndResolveUrl('https://nonexistent-domain.example.com/hook')
      ).rejects.toThrow(/No DNS A\/AAAA records found/i);
    });

    it('fails closed when any resolved address is private even in multi-record DNS responses', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 }, // Poisoned loopback
      ]);

      await expect(
        validateAndResolveUrl('https://poisoned-domain.example.com/hook', { allowLocal: true })
      ).rejects.toThrow(/loopback/i);
    });
  });

  describe('DNS Resolution Bounded Wait & Timeout', () => {
    it('aborts and throws Timeout when DNS resolution exceeds dnsTimeoutMs', async () => {
      const slowLookup = () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), 150);
        });

      await expect(
        validateAndResolveUrl('https://slow-dns.example/webhook', {
          dnsLookup: slowLookup,
          dnsTimeoutMs: 40,
        })
      ).rejects.toThrow('Timeout');
    });

    it('resolves successfully when DNS completes within dnsTimeoutMs', async () => {
      const fastLookup = () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), 20);
        });

      const res = await validateAndResolveUrl('https://fast-dns.example/webhook', {
        dnsLookup: fastLookup,
        dnsTimeoutMs: 150,
      });

      expect(res.pinnedAddress).toBe('93.184.216.34');
    });
  });
});
