/**
 * Webhook Template Routes - REST API for Webhook Templates.
 *
 * POST   /templates                  - Create a new webhook template
 * GET    /templates                  - List accessible templates (system + custom)
 * GET    /templates/:id              - Get template by ID
 * PATCH  /templates/:id              - Update custom template
 * PUT    /templates/:id              - Update custom template
 * DELETE /templates/:id              - Delete custom template
 * POST   /templates/:id/apply        - Prefill endpoint configuration from template
 * GET    /templates/:id/apply        - Prefill endpoint configuration from template
 * POST   /templates/:id/create-endpoint - Explicitly create endpoint from template
 */

import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { apiKeyAuth, TENANT_ID_ATTRIBUTE } from '../middleware/auth.js';
import templateService from '../services/template/templateService.js';
import logger from '../utils/logger.js';

const router = express.Router();

function formatEndpointResponse(res, status, endpoint) {
  const circuit = endpoint.circuitState ? endpoint.circuitState.toString() : 'CLOSED';
  return res.status(status).json({
    id: endpoint.id,
    url: endpoint.url,
    secret: endpoint.secret,
    active: endpoint.active,
    rateLimitRps: endpoint.rateLimitRps,
    rate_limit_rps: endpoint.rateLimitRps,
    circuitState: circuit,
    circuit_state: circuit,
    consecutiveFailures: endpoint.consecutiveFailures,
    consecutive_failures: endpoint.consecutiveFailures,
    retryStrategy: endpoint.retryStrategy || 'EXPONENTIAL',
    retry_strategy: endpoint.retryStrategy || 'EXPONENTIAL',
    retryMaxAttempts: endpoint.retryMaxAttempts ?? 8,
    retry_max_attempts: endpoint.retryMaxAttempts ?? 8,
    retryBaseDelayMs: endpoint.retryBaseDelayMs ?? 5000,
    retry_base_delay_ms: endpoint.retryBaseDelayMs ?? 5000,
    retryMaxDelayMs: endpoint.retryMaxDelayMs ?? 3600000,
    retry_max_delay_ms: endpoint.retryMaxDelayMs ?? 3600000,
    retryBackoffMultiplier: endpoint.retryBackoffMultiplier ?? 2.0,
    retry_backoff_multiplier: endpoint.retryBackoffMultiplier ?? 2.0,
    retryPolicy: {
      strategy: endpoint.retryStrategy || 'EXPONENTIAL',
      maxAttempts: endpoint.retryMaxAttempts ?? 8,
      baseDelayMs: endpoint.retryBaseDelayMs ?? 5000,
      maxDelayMs: endpoint.retryMaxDelayMs ?? 3600000,
      backoffMultiplier: endpoint.retryBackoffMultiplier ?? 2.0,
    },
    createdAt: endpoint.createdAt,
    created_at: endpoint.createdAt,
  });
}

function handleRouteError(error, res, next) {
  if (
    error.name === 'ValidationError' ||
    error.type === 'validation_error' ||
    error.statusCode === 400
  ) {
    return res.status(400).json({
      error: 'Validation Error',
      message: error.message,
    });
  }
  if (
    error.name === 'ForbiddenError' ||
    error.type === 'forbidden' ||
    error.statusCode === 403
  ) {
    return res.status(403).json({
      error: 'Forbidden',
      message: error.message,
    });
  }
  if (
    error.name === 'NotFoundError' ||
    error.type === 'not_found' ||
    error.statusCode === 404
  ) {
    return res.status(404).json({
      error: 'Not Found',
      message: error.message,
    });
  }
  next(error);
}

/**
 * Shared validation rules for template creation/updating
 */
const templateBodyValidators = [
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Template name cannot be blank')
    .isLength({ max: 100 })
    .withMessage('Template name must not exceed 100 characters'),
  body('description')
    .optional()
    .isString()
    .withMessage('Description must be a string'),
  body('httpMethod')
    .optional()
    .toUpperCase()
    .isIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    .withMessage("httpMethod must be one of 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'"),
  body('http_method')
    .optional()
    .toUpperCase()
    .isIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    .withMessage("http_method must be one of 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'"),
  body('rateLimitRps')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('rateLimitRps must be an integer between 1 and 500'),
  body('rate_limit_rps')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('rate_limit_rps must be an integer between 1 and 500'),
  body('retryStrategy')
    .optional()
    .custom((val) => {
      const s = String(val).trim().toUpperCase();
      if (s !== 'EXPONENTIAL' && s !== 'FIXED') {
        throw new Error('retryStrategy must be EXPONENTIAL or FIXED');
      }
      return true;
    }),
  body('retry_strategy')
    .optional()
    .custom((val) => {
      const s = String(val).trim().toUpperCase();
      if (s !== 'EXPONENTIAL' && s !== 'FIXED') {
        throw new Error('retry_strategy must be EXPONENTIAL or FIXED');
      }
      return true;
    }),
  body('retryMaxAttempts')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('retryMaxAttempts must be an integer between 1 and 50'),
  body('retry_max_attempts')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('retry_max_attempts must be an integer between 1 and 50'),
  body('retryBaseDelayMs')
    .optional()
    .isInt({ min: 100, max: 86400000 })
    .withMessage('retryBaseDelayMs must be an integer between 100 and 86400000'),
  body('retry_base_delay_ms')
    .optional()
    .isInt({ min: 100, max: 86400000 })
    .withMessage('retry_base_delay_ms must be an integer between 100 and 86400000'),
  body('retryMaxDelayMs')
    .optional()
    .isInt({ min: 100, max: 86400000 })
    .withMessage('retryMaxDelayMs must be an integer between 100 and 86400000'),
  body('retry_max_delay_ms')
    .optional()
    .isInt({ min: 100, max: 86400000 })
    .withMessage('retry_max_delay_ms must be an integer between 100 and 86400000'),
  body('retryBackoffMultiplier')
    .optional()
    .isFloat({ min: 1.0, max: 10.0 })
    .withMessage('retryBackoffMultiplier must be a number between 1.0 and 10.0'),
  body('retry_backoff_multiplier')
    .optional()
    .isFloat({ min: 1.0, max: 10.0 })
    .withMessage('retry_backoff_multiplier must be a number between 1.0 and 10.0'),
];

/**
 * POST /templates
 * Create a new custom template for the authenticated tenant.
 */
router.post(
  '/',
  apiKeyAuth,
  [
    body('name')
      .notEmpty()
      .withMessage('Template name is required')
      .isLength({ max: 100 })
      .withMessage('Template name must not exceed 100 characters'),
    ...templateBodyValidators,
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

      const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
      const template = await templateService.create(tenantId, req.body);

      logger.info('Webhook template created via API', {
        templateId: template.id,
        tenantId,
      });

      res.status(201).json(template);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  }
);

/**
 * GET /templates
 * List templates accessible to the authenticated tenant (system + custom).
 */
router.get(
  '/',
  apiKeyAuth,
  [
    query('type')
      .optional()
      .isIn(['all', 'system', 'custom'])
      .withMessage("Filter 'type' must be 'all', 'system', or 'custom'"),
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

      const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
      const templates = await templateService.list(tenantId, req.query);

      res.status(200).json(templates);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  }
);

/**
 * GET /templates/:id
 * Retrieve a specific template accessible to the authenticated tenant.
 */
router.get(
  '/:id',
  apiKeyAuth,
  [param('id').isUUID().withMessage('Invalid template ID')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation Error',
          message: errors.array().map((e) => e.msg).join(', '),
        });
      }

      const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
      const { id } = req.params;

      const template = await templateService.getById(tenantId, id);
      res.status(200).json(template);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  }
);

/**
 * PATCH /templates/:id
 * Partially update a custom template owned by the authenticated tenant.
 */
router.patch(
  '/:id',
  apiKeyAuth,
  [
    param('id').isUUID().withMessage('Invalid template ID'),
    ...templateBodyValidators,
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

      const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
      const { id } = req.params;

      const updated = await templateService.update(tenantId, id, req.body);
      logger.info('Webhook template updated via API', {
        templateId: id,
        tenantId,
      });

      res.status(200).json(updated);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  }
);

/**
 * PUT /templates/:id
 * Update a custom template owned by the authenticated tenant.
 */
router.put(
  '/:id',
  apiKeyAuth,
  [
    param('id').isUUID().withMessage('Invalid template ID'),
    ...templateBodyValidators,
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

      const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
      const { id } = req.params;

      const updated = await templateService.update(tenantId, id, req.body);
      res.status(200).json(updated);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  }
);

/**
 * DELETE /templates/:id
 * Delete a custom template owned by the authenticated tenant.
 */
router.delete(
  '/:id',
  apiKeyAuth,
  [param('id').isUUID().withMessage('Invalid template ID')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation Error',
          message: errors.array().map((e) => e.msg).join(', '),
        });
      }

      const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
      const { id } = req.params;

      await templateService.remove(tenantId, id);
      logger.info('Webhook template deleted via API', {
        templateId: id,
        tenantId,
      });

      res.status(200).json({
        success: true,
        id,
        message: 'Template deleted',
      });
    } catch (error) {
      handleRouteError(error, res, next);
    }
  }
);

/**
 * POST /templates/:id/apply
 * GET /templates/:id/apply
 *
 * Prefills endpoint configuration from template with optional user overrides.
 * DOES NOT create an endpoint automatically unless query param ?create=true is passed.
 */
async function handleApplyTemplate(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.array().map((e) => e.msg).join(', '),
      });
    }

    const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
    const { id } = req.params;
    const shouldCreate =
      req.query.create === 'true' ||
      req.query.create === '1' ||
      req.body?.create === true;

    const payload = req.method === 'GET' ? req.query : req.body;

    if (shouldCreate) {
      const endpoint = await templateService.createEndpointFromTemplate(
        tenantId,
        id,
        payload
      );
      return formatEndpointResponse(res, 201, endpoint);
    }

    const result = await templateService.applyTemplate(tenantId, id, payload);
    res.status(200).json(result);
  } catch (error) {
    handleRouteError(error, res, next);
  }
}

router.post(
  '/:id/apply',
  apiKeyAuth,
  [param('id').isUUID().withMessage('Invalid template ID')],
  handleApplyTemplate
);

router.get(
  '/:id/apply',
  apiKeyAuth,
  [param('id').isUUID().withMessage('Invalid template ID')],
  handleApplyTemplate
);

/**
 * POST /templates/:id/create-endpoint
 * Explicitly creates and validates an endpoint from the template + user overrides.
 */
router.post(
  '/:id/create-endpoint',
  apiKeyAuth,
  [param('id').isUUID().withMessage('Invalid template ID')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation Error',
          message: errors.array().map((e) => e.msg).join(', '),
        });
      }

      const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
      const { id } = req.params;

      const endpoint = await templateService.createEndpointFromTemplate(
        tenantId,
        id,
        req.body
      );

      logger.info('Endpoint created from template via API', {
        templateId: id,
        endpointId: endpoint.id,
        tenantId,
      });

      return formatEndpointResponse(res, 201, endpoint);
    } catch (error) {
      handleRouteError(error, res, next);
    }
  }
);

export default router;

