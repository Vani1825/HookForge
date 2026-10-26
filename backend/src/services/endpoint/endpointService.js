/**
 * EndpointService - Business logic for endpoint management.
 * Handles endpoint CRUD operations with tenant isolation.
 */

import crypto from 'crypto';
import endpointRepository from '../../repositories/jdbc/endpointRepository.js';
import { toResponseDTO } from '../../domain/models/endpoint.js';
import logger from '../../utils/logger.js';

/**
 * Generate a webhook signing secret.
 * 32 random bytes, Base64 URL-safe, "whsec_" prefix.
 * Matches reference's generateSecret() method.
 *
 * @returns {string} Generated secret
 */
function generateSecret() {
  const bytes = crypto.randomBytes(32);
  const base64 = bytes.toString('base64');
  // Make URL-safe by replacing + with - and / with _
  const urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `whsec_${urlSafe}`;
}

/**
 * Create a new endpoint for a tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} request - Create endpoint request
 * @param {string} request.url - Webhook URL
 * @param {number} request.rateLimitRps - Rate limit in requests per second (optional, defaults to 10)
 * @returns {Promise<Object>} Created endpoint with secret (shown only once)
 */
export async function create(tenantId, request) {
  const { url, rateLimitRps = 10 } = request;

  // SSRF validation - skip for MVP per reference (documented gap)
  // In production, validate URL against private IP ranges

  const secret = generateSecret();

  const endpoint = await endpointRepository.insert(
    tenantId,
    url,
    secret,
    rateLimitRps
  );

  logger.info('Endpoint created', {
    endpointId: endpoint.id,
    tenantId,
    url,
  });

  // Return endpoint with secret (shown only on create)
  return endpoint;
}

/**
 * List all endpoints for a tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array>} Array of endpoint DTOs (without secret)
 */
export async function list(tenantId) {
  const endpoints = await endpointRepository.findAllByTenant(tenantId);

  // Convert to response DTOs (exclude secret)
  return endpoints.map(toResponseDTO);
}

/**
 * Update an endpoint.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} endpointId - Endpoint UUID
 * @param {Object} request - Update endpoint request
 * @param {string} request.url - New webhook URL (optional)
 * @param {boolean} request.active - Active status (optional)
 * @param {number} request.rateLimitRps - New rate limit (optional)
 * @returns {Promise<Object|null>} Updated endpoint DTO (without secret) or null if not found
 */
export async function update(tenantId, endpointId, request) {
  // First, find the endpoint to validate ownership
  const existing = await endpointRepository.findByIdAndTenant(
    endpointId,
    tenantId
  );

  if (!existing) {
    logger.warn('Endpoint not found or access denied', {
      endpointId,
      tenantId,
    });
    return null;
  }

  // Patch fields (only update provided fields)
  const updates = {
    id: existing.id,
    tenantId: existing.tenantId,
    url: request.url !== undefined ? request.url : existing.url,
    secret: existing.secret, // Secret never changes via update
    active: request.active !== undefined ? request.active : existing.active,
    rateLimitRps:
      request.rateLimitRps !== undefined
        ? request.rateLimitRps
        : existing.rateLimitRps,
    circuitState: existing.circuitState,
    circuitUntil: existing.circuitUntil,
    consecutiveFailures: existing.consecutiveFailures,
  };

  const updated = await endpointRepository.update(updates);

  logger.info('Endpoint updated', {
    endpointId,
    tenantId,
  });

  // Return DTO without secret
  return toResponseDTO(updated);
}

export default {
  create,
  list,
  update,
};
