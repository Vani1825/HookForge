/**
 * SecretEncryption - Dedicated utility for encrypting and decrypting webhook signing secrets at rest.
 * Uses AES-256-GCM authenticated encryption with 12-byte IV and 16-byte authentication tag.
 * Key must be supplied via WEBHOOK_SECRET_ENCRYPTION_KEY (decoded to exactly 32 bytes).
 */

import crypto from 'crypto';

export const ALGORITHM = 'aes-256-gcm';
export const IV_LENGTH_BYTES = 12;
export const TAG_LENGTH_BYTES = 16;
export const KEY_LENGTH_BYTES = 32;
export const CURRENT_VERSION = 1;
export const SUPPORTED_VERSIONS = Object.freeze([1]);
const SUPPORTED_VERSIONS_SET = new Set(SUPPORTED_VERSIONS);

// Strict RFC 4648 standard Base64 regex (multiples of 4, standard alphabet +, /, padding =)
const BASE64_REGEX =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;

export class EncryptionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'EncryptionError';
    if (cause) {
      this.cause = cause;
    }
  }
}

export class DecryptionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DecryptionError';
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Strictly validate that a string is valid, non-empty, canonical standard Base64 (RFC 4648).
 * Checks character set, length multiples of 4, valid padding, and rejects non-canonical padding bits.
 *
 * @param {string} str - String to validate
 * @returns {boolean} True if canonical Base64
 */
export function isCanonicalBase64(str) {
  if (typeof str !== 'string' || str.length === 0 || str.length % 4 !== 0) {
    return false;
  }
  if (!BASE64_REGEX.test(str)) {
    return false;
  }
  try {
    const buf = Buffer.from(str, 'base64');
    // Non-canonical base64 occurs when unused padding bits are non-zero,
    // which results in re-encoding producing a different string.
    return buf.toString('base64') === str;
  } catch {
    return false;
  }
}

/**
 * Validate that an encrypted secret version is a supported integer version.
 * Missing, malformed, or unsupported versions are strictly rejected.
 *
 * @param {any} rawVersion
 * @returns {number} Validated integer version
 */
export function validateSecretVersion(rawVersion) {
  if (rawVersion === undefined || rawVersion === null || rawVersion === '') {
    throw new DecryptionError(
      'Malformed encrypted secret: missing secret version'
    );
  }

  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion)) {
    throw new DecryptionError(
      `Malformed encrypted secret: invalid secret version format (${typeof rawVersion})`
    );
  }

  if (!SUPPORTED_VERSIONS_SET.has(rawVersion)) {
    throw new DecryptionError(
      `Unsupported encrypted secret version: ${rawVersion}`
    );
  }

  return rawVersion;
}

/**
 * Retrieve the raw encryption key from environment.
 *
 * @returns {string|undefined}
 */
export function getEncryptionKey() {
  return process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
}

/**
 * Validate and parse a 32-byte encryption key from string (canonical base64 or 64-char hex) or Buffer.
 * Strictly rejects non-canonical or malformed base64, ambiguous encodings, and whitespace.
 * Never logs or exposes key material in error messages.
 *
 * @param {string|Buffer} rawKey
 * @returns {Buffer} 32-byte key buffer
 */
export function parseAndValidateKey(rawKey) {
  if (!rawKey || (typeof rawKey === 'string' && rawKey.trim() === '')) {
    throw new EncryptionError(
      'WEBHOOK_SECRET_ENCRYPTION_KEY environment variable is required and must not be empty'
    );
  }

  if (Buffer.isBuffer(rawKey)) {
    if (rawKey.length !== KEY_LENGTH_BYTES) {
      throw new EncryptionError(
        `Invalid encryption key length: expected exactly ${KEY_LENGTH_BYTES} bytes (256 bits), got ${rawKey.length} bytes`
      );
    }
    return rawKey;
  }

  if (typeof rawKey !== 'string') {
    throw new EncryptionError(
      'Invalid encryption key type: expected base64 string, 64-char hex string, or Buffer'
    );
  }

  // Reject whitespace or control characters in key string
  if (/\s/.test(rawKey)) {
    throw new EncryptionError(
      'Invalid encryption key: key contains illegal whitespace or newline characters'
    );
  }

  // Check if exactly 64-character hexadecimal (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    const hexBuffer = Buffer.from(rawKey, 'hex');
    if (hexBuffer.length === KEY_LENGTH_BYTES) {
      return hexBuffer;
    }
  }

  // Check canonical base64 (exactly 44 characters ending in = for 32 bytes)
  if (rawKey.length === 44 && isCanonicalBase64(rawKey)) {
    const b64Buffer = Buffer.from(rawKey, 'base64');
    if (b64Buffer.length === KEY_LENGTH_BYTES) {
      return b64Buffer;
    }
  }

  // If length matches base64 but failed canonical check or has invalid characters
  throw new EncryptionError(
    `Invalid encryption key: expected valid 32-byte canonical base64 or 64-character hex string`
  );
}

/**
 * Encrypt a plaintext webhook signing secret using AES-256-GCM.
 *
 * @param {string} plaintext - Plaintext secret (e.g. whsec_...)
 * @param {string|Buffer|null} [keyOverride] - Optional key for testing/migration
 * @param {number} [version=1] - Version number for AAD binding
 * @returns {{ ciphertext: string, iv: string, tag: string, version: number }}
 */
export function encryptSecret(
  plaintext,
  keyOverride = null,
  version = CURRENT_VERSION
) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new EncryptionError('Plaintext secret must be a non-empty string');
  }

  if (
    version === undefined ||
    version === null ||
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    !SUPPORTED_VERSIONS_SET.has(version)
  ) {
    throw new EncryptionError(
      `Unsupported or invalid secret version: ${version}`
    );
  }

  const key = parseAndValidateKey(keyOverride ?? getEncryptionKey());
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);

  try {
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Bind version in Additional Authenticated Data (AAD) to prevent version tampering
    const aad = Buffer.from(`v${version}`, 'utf8');
    cipher.setAAD(aad);

    const ciphertextBuffer = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const tagBuffer = cipher.getAuthTag();

    return {
      ciphertext: ciphertextBuffer.toString('base64'),
      iv: iv.toString('base64'),
      tag: tagBuffer.toString('base64'),
      version,
    };
  } catch (err) {
    if (err instanceof EncryptionError) throw err;
    throw new EncryptionError('Failed to encrypt secret', err);
  }
}

/**
 * Decrypt an AES-256-GCM encrypted webhook signing secret.
 * Accepts either format:
 *   { ciphertext, iv, tag, version }
 *   { secret_ciphertext, secret_iv, secret_tag, secret_version }
 *
 * Strictly validates canonical base64 for ciphertext, IV, and tag.
 * Validates version and rejects missing/unsupported versions.
 * Fails closed on any corruption or tampering.
 *
 * @param {Object} encryptedData - Object containing ciphertext, iv, tag, and version
 * @param {string|Buffer|null} [keyOverride] - Optional key for testing/migration
 * @returns {string} Plaintext secret
 */
export function decryptSecret(encryptedData, keyOverride = null) {
  if (!encryptedData || typeof encryptedData !== 'object') {
    throw new DecryptionError('Encrypted secret data must be an object');
  }

  const ciphertextB64 =
    encryptedData.ciphertext ?? encryptedData.secret_ciphertext;
  const ivB64 = encryptedData.iv ?? encryptedData.secret_iv;
  const tagB64 = encryptedData.tag ?? encryptedData.secret_tag;
  const rawVersion =
    encryptedData.version !== undefined
      ? encryptedData.version
      : encryptedData.secret_version;

  if (
    ciphertextB64 === undefined ||
    ciphertextB64 === null ||
    ivB64 === undefined ||
    ivB64 === null ||
    tagB64 === undefined ||
    tagB64 === null
  ) {
    throw new DecryptionError(
      'Malformed encrypted secret: missing ciphertext, iv, or auth tag'
    );
  }

  if (
    typeof ciphertextB64 !== 'string' ||
    typeof ivB64 !== 'string' ||
    typeof tagB64 !== 'string'
  ) {
    throw new DecryptionError(
      'Malformed encrypted secret: ciphertext, iv, and auth tag must be strings'
    );
  }

  // Validate version: strictly reject missing, malformed, or unsupported versions
  const version = validateSecretVersion(rawVersion);

  // Validate IV: strictly canonical base64 and exact byte length
  if (!isCanonicalBase64(ivB64)) {
    throw new DecryptionError(
      'Malformed encrypted secret: invalid base64 encoding in iv'
    );
  }
  const ivBuffer = Buffer.from(ivB64, 'base64');
  if (ivBuffer.length !== IV_LENGTH_BYTES) {
    throw new DecryptionError(
      `Invalid IV length: expected ${IV_LENGTH_BYTES} bytes, got ${ivBuffer.length} bytes`
    );
  }

  // Validate Tag: strictly canonical base64 and exact byte length
  if (!isCanonicalBase64(tagB64)) {
    throw new DecryptionError(
      'Malformed encrypted secret: invalid base64 encoding in auth tag'
    );
  }
  const tagBuffer = Buffer.from(tagB64, 'base64');
  if (tagBuffer.length !== TAG_LENGTH_BYTES) {
    throw new DecryptionError(
      `Invalid auth tag length: expected ${TAG_LENGTH_BYTES} bytes, got ${tagBuffer.length} bytes`
    );
  }

  // Validate Ciphertext: strictly canonical base64 before attempting decryption
  if (!isCanonicalBase64(ciphertextB64)) {
    throw new DecryptionError(
      'Malformed encrypted secret: invalid base64 encoding in ciphertext'
    );
  }
  const ciphertextBuffer = Buffer.from(ciphertextB64, 'base64');
  if (ciphertextBuffer.length === 0) {
    throw new DecryptionError(
      'Malformed encrypted secret: ciphertext cannot be empty'
    );
  }

  let key;
  try {
    key = parseAndValidateKey(keyOverride ?? getEncryptionKey());
  } catch (err) {
    if (err instanceof EncryptionError) {
      throw new DecryptionError(`Cannot decrypt secret: ${err.message}`, err);
    }
    throw new DecryptionError(
      'Cannot decrypt secret: invalid encryption key',
      err
    );
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer);
    decipher.setAuthTag(tagBuffer);

    const aad = Buffer.from(`v${version}`, 'utf8');
    decipher.setAAD(aad);

    const decrypted = Buffer.concat([
      decipher.update(ciphertextBuffer),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (err) {
    throw new DecryptionError(
      'Failed to decrypt secret: authentication tag verification failed or ciphertext is corrupted',
      err
    );
  }
}

/**
 * Migration helper for an endpoint row:
 * If row has secret_ciphertext, it is already migrated.
 * If row only has secret, it encrypts it and returns the updated fields.
 *
 * @param {Object} row - Database row or endpoint object
 * @param {string|Buffer|null} [keyOverride] - Key to use
 * @returns {{ id: string, alreadyMigrated: boolean, ciphertext?: string, iv?: string, tag?: string, version?: number }}
 */
export function migrateEndpointRow(row, keyOverride = null) {
  if (!row) {
    throw new Error('Row must be provided');
  }

  if (row.secret_ciphertext) {
    return {
      id: row.id,
      alreadyMigrated: true,
    };
  }

  if (!row.secret) {
    throw new Error(
      `Endpoint ${row.id || 'unknown'} has neither secret_ciphertext nor secret`
    );
  }

  const encrypted = encryptSecret(row.secret, keyOverride);
  return {
    id: row.id,
    alreadyMigrated: false,
    ...encrypted,
  };
}

export default {
  ALGORITHM,
  IV_LENGTH_BYTES,
  TAG_LENGTH_BYTES,
  KEY_LENGTH_BYTES,
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
  EncryptionError,
  DecryptionError,
  isCanonicalBase64,
  validateSecretVersion,
  getEncryptionKey,
  parseAndValidateKey,
  encryptSecret,
  decryptSecret,
  migrateEndpointRow,
};
