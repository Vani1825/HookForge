/**
 * JdbcTemplateRepository - PostgreSQL adapter for webhook templates.
 * Handles database persistence with tenant isolation and system template support.
 */

import { query } from '../../config/database.js';
import { createWebhookTemplate } from '../../domain/models/webhookTemplate.js';
import logger from '../../utils/logger.js';

/**
 * Map a raw database row to WebhookTemplate domain model
 */
function mapRowToTemplate(row) {
  return createWebhookTemplate({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    httpMethod: row.http_method,
    url: row.url,
    customHeaders: row.custom_headers,
    defaultPayload: row.default_payload,
    rateLimitRps: row.rate_limit_rps,
    retryStrategy: row.retry_strategy,
    retryMaxAttempts: row.retry_max_attempts,
    retryBaseDelayMs: row.retry_base_delay_ms,
    retryMaxDelayMs: row.retry_max_delay_ms,
    retryBackoffMultiplier: row.retry_backoff_multiplier,
    isSystem: row.is_system,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at || new Date().toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at || new Date().toISOString(),
  });
}

/**
 * Insert a new webhook template into the database
 *
 * @param {Object} template - WebhookTemplate domain model or data
 * @returns {Promise<Object>} Created template domain model
 */
export async function insert(template) {
  const sql = `
    INSERT INTO webhook_templates (
      id,
      tenant_id,
      name,
      description,
      http_method,
      url,
      custom_headers,
      default_payload,
      rate_limit_rps,
      retry_strategy,
      retry_max_attempts,
      retry_base_delay_ms,
      retry_max_delay_ms,
      retry_backoff_multiplier,
      is_system,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING *
  `;

  const params = [
    template.id,
    template.tenantId,
    template.name,
    template.description || null,
    template.httpMethod || 'POST',
    template.url || null,
    JSON.stringify(template.customHeaders || {}),
    template.defaultPayload !== undefined && template.defaultPayload !== null
      ? JSON.stringify(template.defaultPayload)
      : null,
    template.rateLimitRps || 10,
    template.retryStrategy || 'EXPONENTIAL',
    template.retryMaxAttempts !== undefined ? template.retryMaxAttempts : 8,
    template.retryBaseDelayMs !== undefined ? template.retryBaseDelayMs : 5000,
    template.retryMaxDelayMs !== undefined ? template.retryMaxDelayMs : 3600000,
    template.retryBackoffMultiplier !== undefined ? template.retryBackoffMultiplier : 2.0,
    Boolean(template.isSystem),
    template.createdAt || new Date().toISOString(),
    template.updatedAt || new Date().toISOString(),
  ];

  try {
    const result = await query(sql, params);
    return mapRowToTemplate(result.rows[0]);
  } catch (error) {
    logger.error('Failed to insert webhook template', { error: error.message });
    throw error;
  }
}

/**
 * Find all templates accessible to a tenant (tenant's own templates + system templates)
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [options={}] - Query filters (type: 'system'|'custom', search: string)
 * @returns {Promise<Array>} List of template domain models
 */
export async function findAllByTenant(tenantId, options = {}) {
  let sql = `
    SELECT * FROM webhook_templates
    WHERE (tenant_id = $1 OR is_system = TRUE)
  `;
  const params = [tenantId];
  let paramIdx = 2;

  if (options.type === 'system') {
    sql += ` AND is_system = TRUE`;
  } else if (options.type === 'custom' || options.type === 'user') {
    sql += ` AND is_system = FALSE AND tenant_id = $1`;
  }

  if (options.search && typeof options.search === 'string' && options.search.trim()) {
    sql += ` AND (name ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`;
    params.push(`%${options.search.trim()}%`);
    paramIdx++;
  }

  sql += ` ORDER BY is_system DESC, name ASC, created_at DESC`;

  try {
    const result = await query(sql, params);
    return result.rows.map(mapRowToTemplate);
  } catch (error) {
    logger.error('Failed to list webhook templates', { tenantId, error: error.message });
    throw error;
  }
}

/**
 * Find template by ID for a specific tenant (tenant's own template or system template)
 *
 * @param {string} id - Template UUID
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Object|null>} Template domain model or null if not found
 */
export async function findByIdAndTenant(id, tenantId) {
  const sql = `
    SELECT * FROM webhook_templates
    WHERE id = $1 AND (tenant_id = $2 OR is_system = TRUE)
  `;

  try {
    const result = await query(sql, [id, tenantId]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToTemplate(result.rows[0]);
  } catch (error) {
    logger.error('Failed to find webhook template by ID and tenant', {
      id,
      tenantId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Find template by ID without tenant scoping (used to inspect system status or internal lookups)
 *
 * @param {string} id - Template UUID
 * @returns {Promise<Object|null>} Template domain model or null
 */
export async function findById(id) {
  const sql = `SELECT * FROM webhook_templates WHERE id = $1`;

  try {
    const result = await query(sql, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToTemplate(result.rows[0]);
  } catch (error) {
    logger.error('Failed to find webhook template by ID', { id, error: error.message });
    throw error;
  }
}

/**
 * Update an existing template owned by tenant (system templates cannot be updated)
 *
 * @param {string} id - Template UUID
 * @param {string} tenantId - Tenant UUID
 * @param {Object} updates - Updated template fields
 * @returns {Promise<Object|null>} Updated template domain model or null
 */
export async function update(id, tenantId, updates) {
  const setClauses = [];
  const params = [id, tenantId];
  let paramIdx = 3;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIdx++}`);
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    setClauses.push(`description = $${paramIdx++}`);
    params.push(updates.description || null);
  }
  if (updates.httpMethod !== undefined || updates.http_method !== undefined) {
    setClauses.push(`http_method = $${paramIdx++}`);
    params.push(String(updates.httpMethod ?? updates.http_method).toUpperCase());
  }
  if (updates.url !== undefined) {
    setClauses.push(`url = $${paramIdx++}`);
    params.push(updates.url || null);
  }
  if (updates.customHeaders !== undefined || updates.custom_headers !== undefined || updates.headers !== undefined) {
    const headers = updates.customHeaders ?? updates.custom_headers ?? updates.headers ?? {};
    setClauses.push(`custom_headers = $${paramIdx++}`);
    params.push(JSON.stringify(headers));
  }
  if (updates.defaultPayload !== undefined || updates.default_payload !== undefined || updates.payload !== undefined) {
    const payload = updates.defaultPayload !== undefined
      ? updates.defaultPayload
      : (updates.default_payload !== undefined ? updates.default_payload : updates.payload);
    setClauses.push(`default_payload = $${paramIdx++}`);
    params.push(payload !== null && payload !== undefined ? JSON.stringify(payload) : null);
  }
  if (updates.rateLimitRps !== undefined || updates.rate_limit_rps !== undefined) {
    setClauses.push(`rate_limit_rps = $${paramIdx++}`);
    params.push(Number(updates.rateLimitRps ?? updates.rate_limit_rps));
  }
  if (updates.retryStrategy !== undefined || updates.retry_strategy !== undefined) {
    setClauses.push(`retry_strategy = $${paramIdx++}`);
    params.push(String(updates.retryStrategy ?? updates.retry_strategy).toUpperCase());
  }
  if (updates.retryMaxAttempts !== undefined || updates.retry_max_attempts !== undefined) {
    setClauses.push(`retry_max_attempts = $${paramIdx++}`);
    params.push(Number(updates.retryMaxAttempts ?? updates.retry_max_attempts));
  }
  if (
    updates.retryBaseDelayMs !== undefined ||
    updates.retry_base_delay_ms !== undefined ||
    updates.retryDelayMs !== undefined ||
    updates.retry_delay_ms !== undefined
  ) {
    const delay =
      updates.retryBaseDelayMs ??
      updates.retry_base_delay_ms ??
      updates.retryDelayMs ??
      updates.retry_delay_ms;
    setClauses.push(`retry_base_delay_ms = $${paramIdx++}`);
    params.push(Number(delay));
  }
  if (updates.retryMaxDelayMs !== undefined || updates.retry_max_delay_ms !== undefined) {
    setClauses.push(`retry_max_delay_ms = $${paramIdx++}`);
    params.push(Number(updates.retryMaxDelayMs ?? updates.retry_max_delay_ms));
  }
  if (updates.retryBackoffMultiplier !== undefined || updates.retry_backoff_multiplier !== undefined) {
    setClauses.push(`retry_backoff_multiplier = $${paramIdx++}`);
    params.push(Number(updates.retryBackoffMultiplier ?? updates.retry_backoff_multiplier));
  }

  // Always update updated_at
  setClauses.push(`updated_at = now()`);

  if (setClauses.length === 1) {
    // Only updated_at, return current
    return findByIdAndTenant(id, tenantId);
  }

  const sql = `
    UPDATE webhook_templates
    SET ${setClauses.join(', ')}
    WHERE id = $1 AND tenant_id = $2 AND is_system = FALSE
    RETURNING *
  `;

  try {
    const result = await query(sql, params);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToTemplate(result.rows[0]);
  } catch (error) {
    logger.error('Failed to update webhook template', { id, tenantId, error: error.message });
    throw error;
  }
}

/**
 * Delete a template owned by tenant (system templates cannot be deleted)
 *
 * @param {string} id - Template UUID
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<boolean>} True if deleted, false if not found or system template
 */
export async function deleteByIdAndTenant(id, tenantId) {
  const sql = `
    DELETE FROM webhook_templates
    WHERE id = $1 AND tenant_id = $2 AND is_system = FALSE
    RETURNING id
  `;

  try {
    const result = await query(sql, [id, tenantId]);
    return result.rowCount > 0;
  } catch (error) {
    logger.error('Failed to delete webhook template', { id, tenantId, error: error.message });
    throw error;
  }
}

export default {
  insert,
  findAllByTenant,
  findByIdAndTenant,
  findById,
  update,
  deleteByIdAndTenant,
};

