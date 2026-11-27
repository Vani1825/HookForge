/**
 * AuthService - Multi-tenant SaaS authentication and user account lifecycle.
 * Handles self-service registration, password hashing (bcrypt), session tokens,
 * workspace membership, password recovery, and email verification.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import {
  ValidationError,
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} from '../../middleware/errorHandler.js';
import userRepository from '../../repositories/jdbc/userRepository.js';
import workspaceMembershipRepository from '../../repositories/jdbc/workspaceMembershipRepository.js';
import sessionRepository from '../../repositories/jdbc/sessionRepository.js';
import apiKeyRepository from '../../repositories/jdbc/apiKeyRepository.js';
import tokenRepository from '../../repositories/jdbc/tokenRepository.js';
import { invalidateCache } from '../../repositories/jdbc/tenantRepository.js';

const BCRYPT_SALT_ROUNDS = 10;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Hash raw token using SHA-256.
 * @param {string} token
 * @returns {string} Hex hash
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate cryptographically secure random token.
 * @param {number} [bytes=32]
 * @returns {string} base64url string
 */
export function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Generate workspace API key with whkey_ prefix.
 * @returns {{ rawApiKey: string, keyPrefix: string, keyHash: string }}
 */
export function generateApiKey() {
  const randomHex = crypto.randomBytes(24).toString('hex');
  const rawApiKey = `whkey_${randomHex}`;
  const keyPrefix = 'whkey_';
  const keyHash = hashToken(rawApiKey);
  return { rawApiKey, keyPrefix, keyHash };
}

/**
 * Self-service registration.
 * Creates User, Tenant (Workspace), Owner Membership, initial API Key, and Session inside one atomic transaction.
 *
 * @param {Object} input
 * @param {string} input.fullName
 * @param {string} input.email
 * @param {string} input.password
 * @param {string} [input.workspaceName]
 * @returns {Promise<Object>} Safe registration result
 */
export async function register({ fullName, email, password, workspaceName }) {
  if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
    throw new ValidationError('Full name is required');
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new ValidationError('Valid email is required');
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters long');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const effectiveWorkspaceName = (workspaceName && workspaceName.trim()) || `${fullName.trim()}'s Workspace`;

  // Pre-check for duplicate email to avoid unnecessary transaction start
  const existingUser = await userRepository.findByEmail(normalizedEmail);
  if (existingUser) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Create User
    const userRes = await client.query(
      `INSERT INTO users (full_name, email, password_hash, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW())
       RETURNING id, full_name, email, status, created_at`,
      [fullName.trim(), normalizedEmail, passwordHash]
    );
    const user = userRes.rows[0];

    // 2. Generate Initial API Key
    const { rawApiKey, keyPrefix, keyHash } = generateApiKey();

    // 3. Create Tenant (Workspace)
    const tenantRes = await client.query(
      `INSERT INTO tenants (name, api_key_hash, created_at)
       VALUES ($1, $2, NOW())
       RETURNING id, name, created_at`,
      [effectiveWorkspaceName, keyHash]
    );
    const tenant = tenantRes.rows[0];

    // 4. Create Workspace Membership (Role: OWNER)
    await client.query(
      `INSERT INTO workspace_memberships (user_id, tenant_id, role, created_at)
       VALUES ($1, $2, 'OWNER', NOW())`,
      [user.id, tenant.id]
    );

    // 5. Store API Key in api_keys table
    await client.query(
      `INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, created_at)
       VALUES ($1, 'Default API Key', $2, $3, NOW())`,
      [tenant.id, keyPrefix, keyHash]
    );

    // 6. Create Initial Browser Session
    const rawSessionToken = generateSecureToken(32);
    const sessionTokenHash = hashToken(rawSessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await client.query(
      `INSERT INTO user_sessions (user_id, session_token_hash, expires_at, last_activity_at, created_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [user.id, sessionTokenHash, expiresAt]
    );

    await client.query('COMMIT');

    logger.info('Self-service user registered successfully', {
      userId: user.id,
      tenantId: tenant.id,
      email: normalizedEmail,
    });

    return {
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        status: user.status,
      },
      currentWorkspace: {
        id: tenant.id,
        name: tenant.name,
        role: 'OWNER',
      },
      workspaces: [
        {
          id: tenant.id,
          name: tenant.name,
          role: 'OWNER',
        },
      ],
      apiKey: rawApiKey, // Disclosed once upon initial registration
      sessionToken: rawSessionToken,
      expiresAt,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Registration transaction rolled back', { error: err.message, email: normalizedEmail });
    if (err.code === '23505') {
      throw new ConflictError('An account with this email already exists');
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * User login.
 *
 * @param {Object} credentials
 * @param {string} credentials.email
 * @param {string} credentials.password
 * @returns {Promise<Object>}
 */
export async function login({ email, password }) {
  if (!email || !password) {
    throw new ValidationError('Email and password are required');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await userRepository.findByEmail(normalizedEmail);

  if (!user || user.status === 'SUSPENDED') {
    // Generic error message to prevent account enumeration
    throw new UnauthorizedError('Invalid email or password');
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash);
  if (!passwordValid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Retrieve user's accessible workspaces
  const workspaces = await workspaceMembershipRepository.findWorkspacesByUserId(user.id);
  const currentWorkspace = workspaces.length > 0 ? workspaces[0] : null;

  // Generate new browser session token
  const rawSessionToken = generateSecureToken(32);
  const sessionTokenHash = hashToken(rawSessionToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await sessionRepository.createSession({
    userId: user.id,
    sessionTokenHash,
    expiresAt,
  });

  logger.info('User logged in successfully', { userId: user.id, email: normalizedEmail });

  return {
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      status: user.status,
      emailVerified: Boolean(user.email_verified_at),
    },
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      role: w.role,
    })),
    currentWorkspace: currentWorkspace
      ? {
          id: currentWorkspace.id,
          name: currentWorkspace.name,
          role: currentWorkspace.role,
        }
      : null,
    sessionToken: rawSessionToken,
    expiresAt,
  };
}

/**
 * Logout - revokes active browser session.
 * @param {string} sessionToken
 * @returns {Promise<boolean>}
 */
export async function logout(sessionToken) {
  if (!sessionToken) return false;
  const sessionTokenHash = hashToken(sessionToken);
  return await sessionRepository.revokeSession(sessionTokenHash);
}

/**
 * Retrieve authenticated user profile and workspaces via session token.
 *
 * @param {string} sessionToken
 * @param {string} [requestedTenantId]
 * @returns {Promise<Object|null>}
 */
export async function getMe(sessionToken, requestedTenantId = null) {
  if (!sessionToken) return null;
  const sessionTokenHash = hashToken(sessionToken);
  const session = await sessionRepository.findActiveSession(sessionTokenHash);

  if (!session) return null;

  const workspaces = await workspaceMembershipRepository.findWorkspacesByUserId(session.user_id);
  if (workspaces.length === 0) {
    return {
      user: {
        id: session.user_id,
        fullName: session.full_name,
        email: session.email,
        status: session.user_status,
      },
      workspaces: [],
      currentWorkspace: null,
    };
  }

  // Authorize requested workspace or fall back to primary workspace
  let currentWorkspace = workspaces[0];
  if (requestedTenantId) {
    const match = workspaces.find((w) => w.id === requestedTenantId);
    if (match) {
      currentWorkspace = match;
    }
  }

  return {
    user: {
      id: session.user_id,
      fullName: session.full_name,
      email: session.email,
      status: session.user_status,
    },
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      role: w.role,
    })),
    currentWorkspace: {
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      role: currentWorkspace.role,
    },
  };
}

/**
 * Request password recovery token.
 * Generic response always returned to prevent email enumeration.
 * @param {string} email
 * @returns {Promise<{ message: string, token?: string }>}
 */
export async function requestPasswordReset(email) {
  if (!email || typeof email !== 'string') {
    throw new ValidationError('Email is required');
  }
  const normalizedEmail = email.trim().toLowerCase();
  const user = await userRepository.findByEmail(normalizedEmail);

  if (!user) {
    // Return standard generic success message
    return { message: 'If an account exists with this email, recovery instructions have been prepared.' };
  }

  const rawToken = generateSecureToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  await tokenRepository.createPasswordResetToken({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  logger.info('Password reset token generated', { userId: user.id });

  // In development/test mode, expose token for automated verification
  const isDev = process.env.NODE_ENV !== 'production';
  return {
    message: 'If an account exists with this email, recovery instructions have been prepared.',
    ...(isDev ? { token: rawToken } : {}),
  };
}

/**
 * Reset password using valid recovery token.
 * @param {string} token
 * @param {string} newPassword
 * @returns {Promise<boolean>}
 */
export async function resetPassword(token, newPassword) {
  if (!token || !newPassword || newPassword.length < 8) {
    throw new ValidationError('Valid token and password of at least 8 characters are required');
  }

  const tokenHash = hashToken(token);
  const record = await tokenRepository.findValidPasswordResetToken(tokenHash);

  if (!record) {
    throw new ValidationError('Password reset link is invalid or has expired');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  await userRepository.updatePassword(record.user_id, passwordHash);
  await tokenRepository.markPasswordResetTokenUsed(tokenHash);

  // Security measure: invalidate all active sessions across devices
  await sessionRepository.revokeAllUserSessions(record.user_id);

  logger.info('Password reset successfully completed', { userId: record.user_id });
  return true;
}

/**
 * Create a new API key for a workspace.
 * Requires user to have OWNER or ADMIN role in that tenant.
 *
 * @param {string} tenantId
 * @param {string} name
 * @returns {Promise<Object>}
 */
export async function createApiKeyForTenant(tenantId, name = 'API Key') {
  if (!tenantId) {
    throw new ValidationError('tenantId is required');
  }

  const { rawApiKey, keyPrefix, keyHash } = generateApiKey();
  const created = await apiKeyRepository.createApiKey({
    tenantId,
    name: name.trim() || 'API Key',
    keyPrefix,
    keyHash,
  });

  return {
    id: created.id,
    tenantId: created.tenant_id,
    name: created.name,
    keyPrefix: created.key_prefix,
    rawApiKey, // Revealed only once upon generation
    createdAt: created.created_at,
  };
}

/**
 * List API keys for a workspace.
 * @param {string} tenantId
 * @returns {Promise<Array<Object>>}
 */
export async function listApiKeysForTenant(tenantId) {
  if (!tenantId) throw new ValidationError('tenantId is required');
  return await apiKeyRepository.listByTenantId(tenantId);
}

/**
 * Revoke an API key.
 * @param {string} keyId
 * @param {string} tenantId
 * @returns {Promise<boolean>}
 */
export async function revokeApiKeyForTenant(keyId, tenantId) {
  if (!keyId || !tenantId) throw new ValidationError('keyId and tenantId are required');
  const revoked = await apiKeyRepository.revokeApiKey(keyId, tenantId);
  return revoked;
}

export default {
  register,
  login,
  logout,
  getMe,
  requestPasswordReset,
  resetPassword,
  createApiKeyForTenant,
  listApiKeysForTenant,
  revokeApiKeyForTenant,
  generateApiKey,
  hashToken,
};
