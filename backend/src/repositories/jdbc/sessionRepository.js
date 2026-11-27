/**
 * JdbcSessionRepository - Server-side browser session management.
 * Stores cryptographically hashed session tokens.
 */

import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

/**
 * Create a new user session.
 * @param {Object} sessionData
 * @param {string} sessionData.userId
 * @param {string} sessionData.sessionTokenHash - SHA-256 hash of token
 * @param {Date} sessionData.expiresAt
 * @param {Object} [client]
 * @returns {Promise<Object>}
 */
export async function createSession({ userId, sessionTokenHash, expiresAt }, client = null) {
  const sql = `
    INSERT INTO user_sessions (user_id, session_token_hash, expires_at, last_activity_at, created_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    RETURNING id, user_id, session_token_hash, expires_at, created_at
  `;
  const params = [userId, sessionTokenHash, expiresAt];
  try {
    const res = client ? await client.query(sql, params) : await query(sql, params);
    return res.rows[0];
  } catch (err) {
    logger.error('Failed to create user session', { error: err.message, userId });
    throw err;
  }
}

/**
 * Find active session by token hash.
 * Touches last_activity_at if valid.
 * @param {string} sessionTokenHash
 * @returns {Promise<Object|null>} Session with user details, or null if expired/invalid
 */
export async function findActiveSession(sessionTokenHash) {
  const sql = `
    SELECT s.id, s.user_id, s.expires_at, s.last_activity_at,
           u.full_name, u.email, u.status as user_status
    FROM user_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_token_hash = $1 AND s.expires_at > NOW()
    LIMIT 1
  `;
  try {
    const res = await query(sql, [sessionTokenHash]);
    if (res.rows.length === 0) return null;

    // Asynchronously refresh activity timestamp
    query('UPDATE user_sessions SET last_activity_at = NOW() WHERE id = $1', [res.rows[0].id]).catch(() => {});

    return res.rows[0];
  } catch (err) {
    logger.error('Failed to find active session', { error: err.message });
    throw err;
  }
}

/**
 * Revoke/delete a specific session by token hash.
 * @param {string} sessionTokenHash
 * @returns {Promise<boolean>}
 */
export async function revokeSession(sessionTokenHash) {
  const sql = `DELETE FROM user_sessions WHERE session_token_hash = $1`;
  try {
    const res = await query(sql, [sessionTokenHash]);
    return res.rowCount > 0;
  } catch (err) {
    logger.error('Failed to revoke session', { error: err.message });
    throw err;
  }
}

/**
 * Revoke all sessions for a specific user (e.g. on password reset or account security event).
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function revokeAllUserSessions(userId) {
  const sql = `DELETE FROM user_sessions WHERE user_id = $1`;
  try {
    const res = await query(sql, [userId]);
    return res.rowCount;
  } catch (err) {
    logger.error('Failed to revoke all user sessions', { error: err.message, userId });
    throw err;
  }
}

export default {
  createSession,
  findActiveSession,
  revokeSession,
  revokeAllUserSessions,
};
