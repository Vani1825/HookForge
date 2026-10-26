/**
 * Endpoint routes - REST API for endpoint management.
 * POST /endpoints - Create endpoint
 * GET /endpoints - List endpoints
 * PATCH /endpoints/:id - Update endpoint
 */

import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { apiKeyAuth, TENANT_ID_ATTRIBUTE } from '../middleware/auth.js';
import endpointService from '../services/endpoint/endpointService.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * POST /endpoints
 * Create a new endpoint for the authenticated tenant.
 */
router.post(
  '/',
  apiKeyAuth,
  [
    body('url')
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('URL must be a valid HTTP or HTTPS URL'),
    body('rateLimitRps')
      .optional()
      .isInt({ min: 1 })
      .withMessage('rateLimitRps must be a positive integer'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation Error',
          message: errors.array().map((e) => e.msg).join(', '),
        });
      }

      const tenantId = req[TENANT_ID_ATTRIBUTE];
      const { url, rateLimitRps } = req.body;

      const endpoint = await endpointService.create(tenantId, {
        url,
        rateLimitRps,
      });

      logger.info('Endpoint created via API', {
        endpointId: endpoint.id,
        tenantId,
      });

      res.status(201).json({
        id: endpoint.id,
        url: endpoint.url,
        secret: endpoint.secret, // Secret shown only on create
        active: endpoint.active,
        rateLimitRps: endpoint.rateLimitRps,
        circuitState: endpoint.circuitState.toString(),
        createdAt: endpoint.createdAt,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /endpoints
 * List all endpoints for the authenticated tenant.
 */
router.get('/', apiKeyAuth, async (req, res, next) => {
  try {
    const tenantId = req[TENANT_ID_ATTRIBUTE];

    const endpoints = await endpointService.list(tenantId);

    res.status(200).json(endpoints);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /endpoints/:id
 * Update an endpoint for the authenticated tenant.
 */
router.patch(
  '/:id',
  apiKeyAuth,
  [
    param('id').isUUID().withMessage('Invalid endpoint ID'),
    body('url')
      .optional()
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('URL must be a valid HTTP or HTTPS URL'),
    body('active')
      .optional()
      .isBoolean()
      .withMessage('active must be a boolean'),
    body('rateLimitRps')
      .optional()
      .isInt({ min: 1 })
      .withMessage('rateLimitRps must be a positive integer'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation Error',
          message: errors.array().map((e) => e.msg).join(', '),
        });
      }

      const tenantId = req[TENANT_ID_ATTRIBUTE];
      const { id } = req.params;
      const { url, active, rateLimitRps } = req.body;

      const updated = await endpointService.update(tenantId, id, {
        url,
        active,
        rateLimitRps,
      });

      if (!updated) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Endpoint not found',
        });
      }

      logger.info('Endpoint updated via API', {
        endpointId: id,
        tenantId,
      });

      res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
