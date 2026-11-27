/**
 * JdbcTokenRepository - Password reset and email verification token store.
 */

import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

// --- Password Reset Tokens ---

export async function createPasswordResetToken({ userId, tokenHash, expiresAt }) {
  const sql = `
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id, user_id, expires_at, created_at
  `;
  try {
    const res = await query(sql, [userId, tokenHash, expiresAt]);
    return res.rows[0];
  } catch (err) {
    logger.error('Failed to create password reset token', { error: err.message, userId });
    throw err;
  }
}

export async function findValidPasswordResetToken(tokenHash) {
  const sql = `
    SELECT id, user_id, expires_at, used_at
    FROM password_reset_tokens
    WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
    LIMIT 1
  `;
  try {
    const res = await query(sql, [tokenHash]);
    return res.rows[0] || null;
  } catch (err) {
    logger.error('Failed to find password reset token', { error: err.message });
    throw err;
  }
}

export async function markPasswordResetTokenUsed(tokenHash) {
  const sql = `
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE token_hash = $1
  `;
  try {
    const res = await query(sql, [tokenHash]);
    return res.rowCount > 0;
  } catch (err) {
    logger.error('Failed to mark password reset token used', { error: err.message });
    throw err;
  }
}

// --- Email Verification Tokens ---

export async function createEmailVerificationToken({ userId, tokenHash, expiresAt }) {
  const sql = `
    INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id, user_id, expires_at, created_at
  `;
  try {
    const res = await query(sql, [userId, tokenHash, expiresAt]);
    return res.rows[0];
  } catch (err) {
    logger.error('Failed to create email verification token', { error: err.message, userId });
    throw err;
  }
}

export async function findValidEmailVerificationToken(tokenHash) {
  const sql = `
    SELECT id, user_id, expires_at, used_at
    FROM email_verification_tokens
    WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
    LIMIT 1
  `;
  try {
    const res = await query(sql, [tokenHash]);
    return res.rows[0] || null;
  } catch (err) {
    logger.error('Failed to find email verification token', { error: err.message });
    throw err;
  }
}

export async function markEmailVerificationTokenUsed(tokenHash) {
  const sql = `
    UPDATE email_verification_tokens
    SET used_at = NOW()
    WHERE token_hash = $1
  `;
  try {
    const res = await query(sql, [tokenHash]);
    return res.rowCount > 0;
  } catch (err) {
    logger.error('Failed to mark email verification token used', { error: err.message });
    throw err;
  }
}

export default {
  createPasswordResetToken,
  findValidPasswordResetToken,
  markPasswordResetTokenUsed,
  createEmailVerificationToken,
  findValidEmailVerificationToken,
  markEmailVerificationTokenUsed,
};
