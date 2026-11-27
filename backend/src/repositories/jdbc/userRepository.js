/**
 * JdbcUserRepository - PostgreSQL adapter for User data access.
 * Handles user persistence, normalization, and lookups.
 */

import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

/**
 * Create a new user.
 * @param {Object} userData
 * @param {string} userData.fullName
 * @param {string} userData.email
 * @param {string} userData.passwordHash
 * @param {string} [userData.status='ACTIVE']
 * @param {Object} [client] - Optional transactional pg client
 * @returns {Promise<Object>} Created user record
 */
export async function createUser({ fullName, email, passwordHash, status = 'ACTIVE' }, client = null) {
  const normalizedEmail = email.trim().toLowerCase();
  const sql = `
    INSERT INTO users (full_name, email, password_hash, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING id, full_name, email, email_verified_at, status, created_at, updated_at
  `;
  const params = [fullName.trim(), normalizedEmail, passwordHash, status];

  try {
    const res = client ? await client.query(sql, params) : await query(sql, params);
    return res.rows[0];
  } catch (err) {
    logger.error('Failed to create user', { error: err.message, email: normalizedEmail });
    throw err;
  }
}

/**
 * Find user by email (case-insensitive).
 * @param {string} email
 * @param {Object} [client] - Optional transactional client
 * @returns {Promise<Object|null>}
 */
export async function findByEmail(email, client = null) {
  if (!email) return null;
  const normalizedEmail = email.trim().toLowerCase();
  const sql = `
    SELECT id, full_name, email, password_hash, email_verified_at, status, created_at, updated_at
    FROM users
    WHERE LOWER(email) = $1
    LIMIT 1
  `;
  try {
    const res = client ? await client.query(sql, [normalizedEmail]) : await query(sql, [normalizedEmail]);
    return res.rows[0] || null;
  } catch (err) {
    logger.error('Failed to find user by email', { error: err.message });
    throw err;
  }
}

/**
 * Find user by ID.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function findById(id) {
  if (!id) return null;
  const sql = `
    SELECT id, full_name, email, email_verified_at, status, created_at, updated_at
    FROM users
    WHERE id = $1
    LIMIT 1
  `;
  try {
    const res = await query(sql, [id]);
    return res.rows[0] || null;
  } catch (err) {
    logger.error('Failed to find user by id', { error: err.message, id });
    throw err;
  }
}

/**
 * Update user password hash.
 * @param {string} userId
 * @param {string} passwordHash
 * @returns {Promise<boolean>}
 */
export async function updatePassword(userId, passwordHash) {
  const sql = `
    UPDATE users
    SET password_hash = $1, updated_at = NOW()
    WHERE id = $2
  `;
  const res = await query(sql, [passwordHash, userId]);
  return res.rowCount > 0;
}

/**
 * Mark user's email as verified.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function markEmailVerified(userId) {
  const sql = `
    UPDATE users
    SET email_verified_at = NOW(), status = 'ACTIVE', updated_at = NOW()
    WHERE id = $1
  `;
  const res = await query(sql, [userId]);
  return res.rowCount > 0;
}

export default {
  createUser,
  findByEmail,
  findById,
  updatePassword,
  markEmailVerified,
};
