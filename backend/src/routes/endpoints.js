/**
 * Endpoint routes - REST API for endpoint management.
 * POST /endpoints - Create endpoint
 * GET /endpoints - List endpoints
 * GET /endpoints/:id - Get endpoint by ID
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
      .custom((val, { req }) => {
        if ((req.body?.templateId || req.body?.template_id) && (val === undefined || val === null || val === '')) {
          return true;
        }
        if (!val || typeof val !== 'string') {
          throw new Error('URL must be a valid HTTP or HTTPS URL');
        }
        try {
          const u = new URL(val);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            throw new Error('URL must be a valid HTTP or HTTPS URL');
          }
        } catch {
          throw new Error('URL must be a valid HTTP or HTTPS URL');
        }
        return true;
      }),
    body('templateId')
      .optional()
      .isUUID()
      .withMessage('Invalid template ID'),
    body('template_id')
      .optional()
      .isUUID()
      .withMessage('Invalid template_id'),
    body('rateLimitRps')
      .optional()
      .isInt({ min: 1 })
      .withMessage('rateLimitRps must be a positive integer'),
    body('rate_limit_rps')
      .optional()
      .isInt({ min: 1 })
      .withMessage('rate_limit_rps must be a positive integer'),
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
    body('retryDelayMs')
      .optional()
      .isInt({ min: 100, max: 86400000 })
      .withMessage('retryDelayMs must be an integer between 100 and 86400000'),
    body('retry_delay_ms')
      .optional()
      .isInt({ min: 100, max: 86400000 })
      .withMessage('retry_delay_ms must be an integer between 100 and 86400000'),
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
    body('retryPolicy')
      .optional()
      .isObject()
      .withMessage('retryPolicy must be an object'),
    body('retry_policy')
      .optional()
      .isObject()
      .withMessage('retry_policy must be an object'),
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
      const { url } = req.body;
      const rateLimitRps =
        req.body.rateLimitRps !== undefined
          ? req.body.rateLimitRps
          : req.body.rate_limit_rps;

      const endpoint = await endpointService.create(tenantId, {
        ...req.body,
        url,
        rateLimitRps,
      });

      logger.info('Endpoint created via API', {
        endpointId: endpoint.id,
        tenantId,
      });

      const circuit = endpoint.circuitState ? endpoint.circuitState.toString() : 'CLOSED';
      res.status(201).json({
        id: endpoint.id,
        url: endpoint.url,
        secret: endpoint.secret, // Secret shown only on create
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
    } catch (error) {
      if (error.name === 'ValidationError' || error.type === 'validation_error' || error.statusCode === 400) {
        return res.status(400).json({
          error: 'Validation Error',
          message: error.message,
        });
      }
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
 * GET /endpoints/:id
 * Get a specific endpoint for the authenticated tenant.
 */
router.get(
  '/:id',
  apiKeyAuth,
  [
    param('id').isUUID().withMessage('Invalid endpoint ID'),
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

      const endpoint =
        (await endpointService.getById?.(tenantId, id)) ||
        (await endpointService.get?.(tenantId, id)) ||
        null;

      if (!endpoint) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Endpoint not found',
        });
      }

      res.status(200).json(endpoint);
    } catch (error) {
      next(error);
    }
  }
);

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
    body('rate_limit_rps')
      .optional()
      .isInt({ min: 1 })
      .withMessage('rate_limit_rps must be a positive integer'),
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
    body('retryDelayMs')
      .optional()
      .isInt({ min: 100, max: 86400000 })
      .withMessage('retryDelayMs must be an integer between 100 and 86400000'),
    body('retry_delay_ms')
      .optional()
      .isInt({ min: 100, max: 86400000 })
      .withMessage('retry_delay_ms must be an integer between 100 and 86400000'),
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
    body('retryPolicy')
      .optional()
      .isObject()
      .withMessage('retryPolicy must be an object'),
    body('retry_policy')
      .optional()
      .isObject()
      .withMessage('retry_policy must be an object'),
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
      const { url, active } = req.body;
      const rateLimitRps =
        req.body.rateLimitRps !== undefined
          ? req.body.rateLimitRps
          : req.body.rate_limit_rps;

      const updated = await endpointService.update(tenantId, id, {
        ...req.body,
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
      if (error.name === 'ValidationError' || error.type === 'validation_error' || error.statusCode === 400) {
        return res.status(400).json({
          error: 'Validation Error',
          message: error.message,
        });
      }
      next(error);
    }
  }
);


/**
 * POST /endpoints/test
 * Test a webhook endpoint destination using ad-hoc configuration or body endpoint ID.
 */
router.post(
  '/test',
  apiKeyAuth,
  [
    body('url')
      .optional()
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('URL must be a valid HTTP or HTTPS URL'),
    body('endpointId')
      .optional()
      .isUUID()
      .withMessage('Invalid endpoint ID'),
    body('endpoint_id')
      .optional()
      .isUUID()
      .withMessage('Invalid endpoint_id'),
    body('method')
      .optional()
      .isString()
      .withMessage('Method must be a string'),
    body('headers')
      .optional()
      .isObject()
      .withMessage('Headers must be an object'),
    body('timeoutMs')
      .optional()
      .isInt({ min: 100, max: 60000 })
      .withMessage('timeoutMs must be an integer between 100 and 60000'),
    body('timeout_ms')
      .optional()
      .isInt({ min: 100, max: 60000 })
      .withMessage('timeout_ms must be an integer between 100 and 60000'),
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
      const result = await endpointService.testEndpoint(tenantId, {
        ...req.body,
        endpointId: req.body.endpointId || req.body.endpoint_id,
      });

      res.status(200).json(result);
    } catch (error) {
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
  }
);

/**
 * POST /endpoints/:id/test
 * Test an existing saved webhook endpoint for the authenticated tenant.
 */
router.post(
  '/:id/test',
  apiKeyAuth,
  [
    param('id').isUUID().withMessage('Invalid endpoint ID'),
    body('url')
      .optional()
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('URL must be a valid HTTP or HTTPS URL'),
    body('method')
      .optional()
      .isString()
      .withMessage('Method must be a string'),
    body('headers')
      .optional()
      .isObject()
      .withMessage('Headers must be an object'),
    body('timeoutMs')
      .optional()
      .isInt({ min: 100, max: 60000 })
      .withMessage('timeoutMs must be an integer between 100 and 60000'),
    body('timeout_ms')
      .optional()
      .isInt({ min: 100, max: 60000 })
      .withMessage('timeout_ms must be an integer between 100 and 60000'),
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

      const result = await endpointService.testEndpoint(tenantId, {
        ...req.body,
        endpointId: id,
      });

      res.status(200).json(result);
    } catch (error) {
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
  }
);

/**
 * DELETE /endpoints/:id
 * Delete or deactivate an endpoint for the authenticated tenant.
 */
router.delete(
  '/:id',
  apiKeyAuth,
  param('id').isUUID().withMessage('Invalid endpoint ID'),
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

      const result = await endpointService.remove(tenantId, id);
      if (!result) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Endpoint not found',
        });
      }

      logger.info('Endpoint deleted/deactivated via API', {
        endpointId: id,
        tenantId,
      });

      res.status(200).json({ success: true, id, message: 'Endpoint removed' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
