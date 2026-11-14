/**
 * Unit tests for secretEncryption utility.
 * Verifies AES-256-GCM encryption at rest for webhook signing secrets.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  encryptSecret,
  decryptSecret,
  parseAndValidateKey,
  getEncryptionKey,
  isCanonicalBase64,
  validateSecretVersion,
  migrateEndpointRow,
  EncryptionError,
  DecryptionError,
  IV_LENGTH_BYTES,
  TAG_LENGTH_BYTES,
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
} from '../../src/utils/secretEncryption.js';

describe('secretEncryption utility', () => {
  const originalEnvKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

  // Generate valid test keys
  const testKeyBuffer = crypto.randomBytes(32);
  const testKeyBase64 = testKeyBuffer.toString('base64');
  const testKeyHex = testKeyBuffer.toString('hex');

  // Helper to generate non-canonical base64 strings with non-zero padding bits
  function makeNonCanonicalBase64(canonicalB64) {
    const b64Alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const padIndex = canonicalB64.indexOf('=');
    if (padIndex <= 0) return null;
    const lastCharIndex = padIndex - 1;
    const char = canonicalB64[lastCharIndex];
    const charIdx = b64Alphabet.indexOf(char);
    const badChar = b64Alphabet[charIdx ^ 1];
    return (
      canonicalB64.slice(0, lastCharIndex) +
      badChar +
      canonicalB64.slice(padIndex)
    );
  }

  beforeEach(() => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = testKeyBase64;
  });

  afterEach(() => {
    if (originalEnvKey !== undefined) {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalEnvKey;
    } else {
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    }
  });

  describe('Canonical Base64 validation (isCanonicalBase64)', () => {
    it('should validate canonical base64 strings', () => {
      expect(isCanonicalBase64(testKeyBase64)).toBe(true);
      expect(isCanonicalBase64(Buffer.from('hello world').toString('base64'))).toBe(true);
      expect(isCanonicalBase64(Buffer.from('a').toString('base64'))).toBe(true);
      expect(isCanonicalBase64(Buffer.from('ab').toString('base64'))).toBe(true);
      expect(isCanonicalBase64(Buffer.from('abc').toString('base64'))).toBe(true);
    });

    it('should reject non-canonical base64 with non-zero padding bits', () => {
      // In YQ== (base64 of 'a'), 'Q' is 010000 (padding bits are 0000).
      // 'R' is 010001 (non-zero padding bits).
      expect(isCanonicalBase64('YQ==')).toBe(true);
      expect(isCanonicalBase64('YR==')).toBe(false);

      const nonCanonicalKey = makeNonCanonicalBase64(testKeyBase64);
      expect(isCanonicalBase64(nonCanonicalKey)).toBe(false);
    });

    it('should reject malformed base64, whitespace, and URL-safe characters', () => {
      expect(isCanonicalBase64('')).toBe(false);
      expect(isCanonicalBase64(null)).toBe(false);
      expect(isCanonicalBase64(undefined)).toBe(false);
      expect(isCanonicalBase64(12345)).toBe(false);
      expect(isCanonicalBase64('abc')).toBe(false); // length not multiple of 4
      expect(isCanonicalBase64('abcde')).toBe(false);
      expect(isCanonicalBase64('====')).toBe(false);
      expect(isCanonicalBase64('YQ===')).toBe(false);
      expect(isCanonicalBase64(' YQ==')).toBe(false); // leading space
      expect(isCanonicalBase64('YQ== ')).toBe(false); // trailing space
      expect(isCanonicalBase64('Y Q==')).toBe(false); // space inside
      expect(isCanonicalBase64('YQ-_')).toBe(false); // URL-safe characters
      expect(isCanonicalBase64('YQ$#')).toBe(false); // special non-base64 chars
    });
  });

  describe('Key validation (parseAndValidateKey)', () => {
    it('should accept a valid 32-byte canonical base64-encoded key', () => {
      const parsed = parseAndValidateKey(testKeyBase64);
      expect(Buffer.isBuffer(parsed)).toBe(true);
      expect(parsed.length).toBe(32);
      expect(parsed.equals(testKeyBuffer)).toBe(true);
    });

    it('should accept a valid 32-byte 64-character hex key', () => {
      const parsed = parseAndValidateKey(testKeyHex);
      expect(Buffer.isBuffer(parsed)).toBe(true);
      expect(parsed.length).toBe(32);
      expect(parsed.equals(testKeyBuffer)).toBe(true);
    });

    it('should accept a valid 32-byte Buffer', () => {
      const parsed = parseAndValidateKey(testKeyBuffer);
      expect(parsed.length).toBe(32);
      expect(parsed.equals(testKeyBuffer)).toBe(true);
    });

    it('should reject non-canonical base64 keys with non-zero padding bits', () => {
      const nonCanonicalKey = makeNonCanonicalBase64(testKeyBase64);
      expect(() => parseAndValidateKey(nonCanonicalKey)).toThrow(EncryptionError);
      expect(() => parseAndValidateKey(nonCanonicalKey)).toThrow(
        /expected valid 32-byte canonical base64 or 64-character hex string/i
      );
    });

    it('should reject base64 keys with whitespace, newlines, or tabs', () => {
      expect(() => parseAndValidateKey(' ' + testKeyBase64)).toThrow(
        /illegal whitespace/i
      );
      expect(() => parseAndValidateKey(testKeyBase64 + ' ')).toThrow(
        /illegal whitespace/i
      );
      expect(() => parseAndValidateKey(testKeyBase64 + '\n')).toThrow(
        /illegal whitespace/i
      );
      expect(() => parseAndValidateKey(testKeyBase64 + '\r\n')).toThrow(
        /illegal whitespace/i
      );
      expect(() => parseAndValidateKey(testKeyBase64.slice(0, 10) + ' ' + testKeyBase64.slice(10))).toThrow(
        /illegal whitespace/i
      );
    });

    it('should reject malformed base64 keys', () => {
      // Non-base64 characters
      const malformedKey = testKeyBase64.slice(0, 42) + '$=';
      expect(() => parseAndValidateKey(malformedKey)).toThrow(EncryptionError);

      // Wrong length base64 (e.g. 40 characters instead of 44)
      const shortKey = testKeyBase64.slice(0, 40);
      expect(() => parseAndValidateKey(shortKey)).toThrow(EncryptionError);

      // 48-character base64 (decodes to 36 bytes)
      const longB64 = crypto.randomBytes(36).toString('base64');
      expect(() => parseAndValidateKey(longB64)).toThrow(EncryptionError);

      // URL-safe base64 containing _ or -
      const urlSafeKey = testKeyBase64.replace(/\+/g, '-').replace(/\//g, '_');
      if (urlSafeKey !== testKeyBase64) {
        expect(() => parseAndValidateKey(urlSafeKey)).toThrow(EncryptionError);
      }
    });

    it('should reject hex keys that are not exactly 64 hex characters', () => {
      // 62 chars
      expect(() => parseAndValidateKey(testKeyHex.slice(0, 62))).toThrow(EncryptionError);
      // 66 chars
      expect(() => parseAndValidateKey(testKeyHex + 'ab')).toThrow(EncryptionError);
      // Non-hex chars in 64-char string
      const badHex = 'z' + testKeyHex.slice(1);
      expect(() => parseAndValidateKey(badHex)).toThrow(EncryptionError);
    });

    it('should reject ambiguous or malformed encodings', () => {
      expect(() => parseAndValidateKey('not-a-valid-key-at-all')).toThrow(EncryptionError);
      expect(() => parseAndValidateKey('12345678901234567890123456789012')).toThrow(EncryptionError);
    });

    it('should throw EncryptionError when key is missing or empty', () => {
      expect(() => parseAndValidateKey(null)).toThrow(EncryptionError);
      expect(() => parseAndValidateKey('')).toThrow(EncryptionError);
      expect(() => parseAndValidateKey('   ')).toThrow(EncryptionError);
      expect(() => parseAndValidateKey(undefined)).toThrow(
        /WEBHOOK_SECRET_ENCRYPTION_KEY.*required/i
      );
    });

    it('should throw EncryptionError when Buffer key is not 32 bytes', () => {
      expect(() => parseAndValidateKey(crypto.randomBytes(16))).toThrow(
        /expected exactly 32 bytes/i
      );
      expect(() => parseAndValidateKey(crypto.randomBytes(64))).toThrow(
        /expected exactly 32 bytes/i
      );
    });

    it('should throw EncryptionError for non-string, non-buffer input', () => {
      expect(() => parseAndValidateKey(12345)).toThrow(EncryptionError);
      expect(() => parseAndValidateKey({})).toThrow(EncryptionError);
      expect(() => parseAndValidateKey([])).toThrow(EncryptionError);
    });

    it('should never expose key material in error messages', () => {
      const fakeSecretKey = 'VERY_SECRET_KEY_MATERIAL_1234567890';
      try {
        parseAndValidateKey(fakeSecretKey);
      } catch (err) {
        expect(err.message).not.toContain(fakeSecretKey);
      }
    });

    it('should retrieve key via getEncryptionKey', () => {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = testKeyBase64;
      expect(getEncryptionKey()).toBe(testKeyBase64);
    });
  });

  describe('Version validation (validateSecretVersion)', () => {
    it('should accept valid supported integer version', () => {
      expect(validateSecretVersion(1)).toBe(1);
      expect(SUPPORTED_VERSIONS).toContain(CURRENT_VERSION);
    });

    it('should reject missing or empty secret versions (never default)', () => {
      expect(() => validateSecretVersion(undefined)).toThrow(DecryptionError);
      expect(() => validateSecretVersion(undefined)).toThrow(
        /missing secret version/i
      );
      expect(() => validateSecretVersion(null)).toThrow(
        /missing secret version/i
      );
      expect(() => validateSecretVersion('')).toThrow(
        /missing secret version/i
      );
    });

    it('should reject malformed non-integer versions', () => {
      expect(() => validateSecretVersion('1')).toThrow(
        /invalid secret version format/i
      );
      expect(() => validateSecretVersion('v1')).toThrow(
        /invalid secret version format/i
      );
      expect(() => validateSecretVersion(1.5)).toThrow(
        /invalid secret version format/i
      );
      expect(() => validateSecretVersion(NaN)).toThrow(
        /invalid secret version format/i
      );
      expect(() => validateSecretVersion({})).toThrow(
        /invalid secret version format/i
      );
    });

    it('should reject unsupported versions', () => {
      expect(() => validateSecretVersion(0)).toThrow(
        /unsupported encrypted secret version: 0/i
      );
      expect(() => validateSecretVersion(2)).toThrow(
        /unsupported encrypted secret version: 2/i
      );
      expect(() => validateSecretVersion(99)).toThrow(
        /unsupported encrypted secret version: 99/i
      );
      expect(() => validateSecretVersion(-1)).toThrow(
        /unsupported encrypted secret version: -1/i
      );
    });

    it('should reject unsupported or invalid version in encryptSecret', () => {
      expect(() => encryptSecret('whsec_test', null, 2)).toThrow(
        /unsupported or invalid secret version/i
      );
      expect(() => encryptSecret('whsec_test', null, null)).toThrow(
        /unsupported or invalid secret version/i
      );
      expect(() => encryptSecret('whsec_test', null, '1')).toThrow(
        /unsupported or invalid secret version/i
      );
    });

    it('should reject decryption when secret_version is missing from row', () => {
      const encrypted = encryptSecret('whsec_test');
      const rowMissingVersion = {
        secret_ciphertext: encrypted.ciphertext,
        secret_iv: encrypted.iv,
        secret_tag: encrypted.tag,
        // secret_version is omitted
      };

      expect(() => decryptSecret(rowMissingVersion)).toThrow(DecryptionError);
      expect(() => decryptSecret(rowMissingVersion)).toThrow(
        /missing secret version/i
      );
    });
  });

  describe('Component validation in decryptSecret', () => {
    it('should reject noncanonical base64 in ciphertext', () => {
      const encrypted = encryptSecret('whsec_test_canonical_ciphertext');
      const nonCanonicalCiphertext = makeNonCanonicalBase64(encrypted.ciphertext);

      if (nonCanonicalCiphertext) {
        expect(() =>
          decryptSecret({ ...encrypted, ciphertext: nonCanonicalCiphertext })
        ).toThrow(/invalid base64 encoding in ciphertext/i);
      }
    });

    it('should reject malformed base64 in ciphertext before attempting decryption', () => {
      const encrypted = encryptSecret('whsec_test_malformed_ciphertext');

      // Invalid base64 characters
      expect(() =>
        decryptSecret({ ...encrypted, ciphertext: 'invalid_base64_$$$$' })
      ).toThrow(/invalid base64 encoding in ciphertext/i);

      // Wrong length (not multiple of 4)
      expect(() =>
        decryptSecret({ ...encrypted, ciphertext: 'abcde' })
      ).toThrow(/invalid base64 encoding in ciphertext/i);

      // Whitespace inside ciphertext
      expect(() =>
        decryptSecret({ ...encrypted, ciphertext: encrypted.ciphertext + ' ' })
      ).toThrow(/invalid base64 encoding in ciphertext/i);

      // Empty ciphertext
      expect(() =>
        decryptSecret({ ...encrypted, ciphertext: '' })
      ).toThrow(/invalid base64 encoding in ciphertext|missing/i);
    });

    it('should reject noncanonical or malformed base64 in IV', () => {
      const encrypted = encryptSecret('whsec_test_iv');

      expect(() =>
        decryptSecret({ ...encrypted, iv: 'not-base64-!@#$' })
      ).toThrow(/invalid base64 encoding in iv/i);

      expect(() =>
        decryptSecret({ ...encrypted, iv: encrypted.iv + ' ' })
      ).toThrow(/invalid base64 encoding in iv/i);
    });

    it('should reject noncanonical or malformed base64 in tag', () => {
      const encrypted = encryptSecret('whsec_test_tag');
      const nonCanonicalTag = makeNonCanonicalBase64(encrypted.tag);

      if (nonCanonicalTag) {
        expect(() =>
          decryptSecret({ ...encrypted, tag: nonCanonicalTag })
        ).toThrow(/invalid base64 encoding in auth tag/i);
      }

      expect(() =>
        decryptSecret({ ...encrypted, tag: 'invalid_tag_chars!!==' })
      ).toThrow(/invalid base64 encoding in auth tag/i);
    });

    it('should reject invalid IV lengths even if valid base64', () => {
      const encrypted = encryptSecret('whsec_test');

      // 8 bytes (too short)
      const shortIv = crypto.randomBytes(8).toString('base64');
      expect(() => decryptSecret({ ...encrypted, iv: shortIv })).toThrow(
        /Invalid IV length: expected 12 bytes, got 8 bytes/i
      );

      // 16 bytes (too long)
      const longIv = crypto.randomBytes(16).toString('base64');
      expect(() => decryptSecret({ ...encrypted, iv: longIv })).toThrow(
        /Invalid IV length: expected 12 bytes, got 16 bytes/i
      );
    });

    it('should reject invalid auth tag lengths even if valid base64', () => {
      const encrypted = encryptSecret('whsec_test');

      // 12 bytes (too short)
      const shortTag = crypto.randomBytes(12).toString('base64');
      expect(() => decryptSecret({ ...encrypted, tag: shortTag })).toThrow(
        /Invalid auth tag length: expected 16 bytes, got 12 bytes/i
      );

      // 32 bytes (too long)
      const longTag = crypto.randomBytes(32).toString('base64');
      expect(() => decryptSecret({ ...encrypted, tag: longTag })).toThrow(
        /Invalid auth tag length: expected 16 bytes, got 32 bytes/i
      );
    });

    it('should reject non-string ciphertext, IV, or tag', () => {
      const encrypted = encryptSecret('whsec_test');

      expect(() => decryptSecret({ ...encrypted, ciphertext: 12345 })).toThrow(
        /must be strings/i
      );
      expect(() => decryptSecret({ ...encrypted, iv: {} })).toThrow(
        /must be strings/i
      );
      expect(() => decryptSecret({ ...encrypted, tag: [] })).toThrow(
        /must be strings/i
      );
    });
  });

  describe('Authentication failures and fail-closed behavior', () => {
    it('should reject tampered ciphertext and fail closed', () => {
      const encrypted = encryptSecret('whsec_tamper_test');
      const cipherBuffer = Buffer.from(encrypted.ciphertext, 'base64');

      // Flip the last bit of the ciphertext
      cipherBuffer[cipherBuffer.length - 1] ^= 0x01;
      const tampered = {
        ...encrypted,
        ciphertext: cipherBuffer.toString('base64'),
      };

      expect(() => decryptSecret(tampered)).toThrow(DecryptionError);
      expect(() => decryptSecret(tampered)).toThrow(
        'Failed to decrypt secret: authentication tag verification failed or ciphertext is corrupted'
      );
    });

    it('should reject tampered authentication tag', () => {
      const encrypted = encryptSecret('whsec_tamper_tag_test');
      const tagBuffer = Buffer.from(encrypted.tag, 'base64');

      // Flip a bit in the auth tag
      tagBuffer[0] ^= 0xff;
      const tampered = {
        ...encrypted,
        tag: tagBuffer.toString('base64'),
      };

      expect(() => decryptSecret(tampered)).toThrow(DecryptionError);
      expect(() => decryptSecret(tampered)).toThrow(
        'Failed to decrypt secret: authentication tag verification failed or ciphertext is corrupted'
      );
    });

    it('should reject tampered IV', () => {
      const encrypted = encryptSecret('whsec_tamper_iv_test');
      const ivBuffer = Buffer.from(encrypted.iv, 'base64');

      // Flip a bit in IV
      ivBuffer[0] ^= 0xaa;
      const tampered = {
        ...encrypted,
        iv: ivBuffer.toString('base64'),
      };

      expect(() => decryptSecret(tampered)).toThrow(DecryptionError);
    });

    it('should reject decryption with wrong key', () => {
      const otherKey = crypto.randomBytes(32);
      const encrypted = encryptSecret('whsec_wrong_key_test');

      expect(() => decryptSecret(encrypted, otherKey)).toThrow(DecryptionError);
    });

    it('should never expose low-level OpenSSL error messages', () => {
      const encrypted = encryptSecret('whsec_openssl_test');
      const tampered = {
        ...encrypted,
        tag: crypto.randomBytes(16).toString('base64'),
      };

      try {
        decryptSecret(tampered);
        expect.unreachable('Should have thrown DecryptionError');
      } catch (err) {
        expect(err.name).toBe('DecryptionError');
        expect(err.message).toBe(
          'Failed to decrypt secret: authentication tag verification failed or ciphertext is corrupted'
        );
        expect(err.message).not.toContain('Unsupported state');
        expect(err.message).not.toContain('OPENSSL');
      }
    });
  });

  describe('Encryption and Decryption roundtrips', () => {
    it('should encrypt and decrypt a standard webhook signing secret', () => {
      const plaintext = 'whsec_a8f9c3e2b1d0475689abcdef12345678';
      const encrypted = encryptSecret(plaintext);

      expect(encrypted).toHaveProperty('ciphertext');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('tag');
      expect(encrypted).toHaveProperty('version', 1);

      expect(encrypted.ciphertext).not.toBe(plaintext);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt secrets with special characters and Unicode', () => {
      const plaintext = 'whsec_!@#$%^&*()_+~`|}{[]:;?><,./-= 🚀 🔐';
      const encrypted = encryptSecret(plaintext);
      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should work with explicit keyOverride parameter', () => {
      const customKey = crypto.randomBytes(32);
      const plaintext = 'whsec_custom_key_test';

      const encrypted = encryptSecret(plaintext, customKey);
      const decrypted = decryptSecret(encrypted, customKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should decrypt using database row column naming convention', () => {
      const plaintext = 'whsec_db_column_convention';
      const encrypted = encryptSecret(plaintext);

      const dbRow = {
        secret_ciphertext: encrypted.ciphertext,
        secret_iv: encrypted.iv,
        secret_tag: encrypted.tag,
        secret_version: encrypted.version,
      };

      const decrypted = decryptSecret(dbRow);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('Unique IV generation and non-determinism', () => {
    it('should generate a unique 12-byte IV for every encryption operation', () => {
      const plaintext = 'whsec_constant_secret';
      const iterations = 50;
      const ivSet = new Set();
      const ciphertextSet = new Set();

      for (let i = 0; i < iterations; i++) {
        const encrypted = encryptSecret(plaintext);
        const ivBuffer = Buffer.from(encrypted.iv, 'base64');

        expect(ivBuffer.length).toBe(IV_LENGTH_BYTES);
        ivSet.add(encrypted.iv);
        ciphertextSet.add(encrypted.ciphertext);
      }

      expect(ivSet.size).toBe(iterations);
      expect(ciphertextSet.size).toBe(iterations);
    });

    it('should produce 16-byte authentication tags', () => {
      const encrypted = encryptSecret('whsec_test_tag_length');
      const tagBuffer = Buffer.from(encrypted.tag, 'base64');
      expect(tagBuffer.length).toBe(TAG_LENGTH_BYTES);
    });
  });

  describe('Plaintext validation in encryptSecret', () => {
    it('should throw EncryptionError on empty or non-string plaintext', () => {
      expect(() => encryptSecret('')).toThrow(EncryptionError);
      expect(() => encryptSecret(null)).toThrow(EncryptionError);
      expect(() => encryptSecret(undefined)).toThrow(EncryptionError);
      expect(() => encryptSecret(12345)).toThrow(EncryptionError);
    });

    it('should throw EncryptionError when no key is configured', () => {
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
      expect(() => encryptSecret('whsec_test')).toThrow(EncryptionError);
    });
  });

  describe('Migration helper (migrateEndpointRow)', () => {
    it('should recognize already migrated row with secret_ciphertext', () => {
      const row = {
        id: 'ep-123',
        secret_ciphertext: 'some_ciphertext',
        secret_iv: 'some_iv',
        secret_tag: 'some_tag',
        secret_version: 1,
      };

      const result = migrateEndpointRow(row);
      expect(result.alreadyMigrated).toBe(true);
      expect(result.id).toBe('ep-123');
    });

    it('should migrate legacy plaintext secret and return encrypted components', () => {
      const row = {
        id: 'ep-456',
        secret: 'whsec_legacy_plaintext_secret_12345',
        secret_ciphertext: null,
      };

      const result = migrateEndpointRow(row);
      expect(result.alreadyMigrated).toBe(false);
      expect(result.id).toBe('ep-456');
      expect(result).toHaveProperty('ciphertext');
      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('tag');
      expect(result).toHaveProperty('version', 1);

      const decrypted = decryptSecret(result);
      expect(decrypted).toBe(row.secret);
    });

    it('should throw error when row has neither secret nor secret_ciphertext', () => {
      const row = {
        id: 'ep-789',
        secret: null,
        secret_ciphertext: null,
      };

      expect(() => migrateEndpointRow(row)).toThrow(
        /neither secret_ciphertext nor secret/i
      );
    });
  });
});
