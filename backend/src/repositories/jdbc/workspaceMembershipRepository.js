/**
 * JdbcWorkspaceMembershipRepository - Maps Users to Tenants with Roles.
 */

import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

/**
 * Create a new workspace membership.
 * @param {Object} data
 * @param {string} data.userId
 * @param {string} data.tenantId
 * @param {string} [data.role='OWNER']
 * @param {Object} [client] - Optional transactional client
 * @returns {Promise<Object>}
 */
export async function createMembership({ userId, tenantId, role = 'OWNER' }, client = null) {
  const sql = `
    INSERT INTO workspace_memberships (user_id, tenant_id, role, created_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role
    RETURNING id, user_id, tenant_id, role, created_at
  `;
  const params = [userId, tenantId, role];
  try {
    const res = client ? await client.query(sql, params) : await query(sql, params);
    return res.rows[0];
  } catch (err) {
    logger.error('Failed to create workspace membership', { error: err.message, userId, tenantId });
    throw err;
  }
}

/**
 * Find user membership in a specific tenant.
 * @param {string} userId
 * @param {string} tenantId
 * @param {Object} [client]
 * @returns {Promise<Object|null>}
 */
export async function findByUserAndTenant(userId, tenantId, client = null) {
  const sql = `
    SELECT wm.id, wm.user_id, wm.tenant_id, wm.role, wm.created_at, t.name as workspace_name
    FROM workspace_memberships wm
    JOIN tenants t ON wm.tenant_id = t.id
    WHERE wm.user_id = $1 AND wm.tenant_id = $2
    LIMIT 1
  `;
  try {
    const res = client ? await client.query(sql, [userId, tenantId]) : await query(sql, [userId, tenantId]);
    return res.rows[0] || null;
  } catch (err) {
    logger.error('Failed to find workspace membership', { error: err.message });
    throw err;
  }
}

/**
 * List all workspaces accessible to a user.
 * @param {string} userId
 * @param {Object} [client]
 * @returns {Promise<Array<Object>>}
 */
export async function findWorkspacesByUserId(userId, client = null) {
  const sql = `
    SELECT t.id, t.name, wm.role, wm.created_at as joined_at
    FROM workspace_memberships wm
    JOIN tenants t ON wm.tenant_id = t.id
    WHERE wm.user_id = $1
    ORDER BY wm.created_at ASC
  `;
  try {
    const res = client ? await client.query(sql, [userId]) : await query(sql, [userId]);
    return res.rows;
  } catch (err) {
    logger.error('Failed to list user workspaces', { error: err.message, userId });
    throw err;
  }
}

export default {
  createMembership,
  findByUserAndTenant,
  findWorkspacesByUserId,
};
