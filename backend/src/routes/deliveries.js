/**
 * Delivery routes - Status APIs and replay operations.
 * GET /deliveries?state=DEAD
 * POST /deliveries/:id/replay
 */

import express from 'express';
import { body, query, param, validationResult } from 'express-validator';
import deliveryService from '../services/delivery/deliveryService.js';
import { deliveryState } from '../domain/deliveryState.js';
import { IllegalStateTransitionError } from '../domain/errors/illegalStateTransitionError.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /deliveries
 * Query deliveries with tenant isolation, dynamic filters, and pagination.
 */
router.get(
  '/',
  [
    query('state')
      .optional()
      .isIn([...deliveryState.values(), 'ALL'])
      .withMessage('Invalid state'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('page must be a positive integer'),
    query('pageSize')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('pageSize must be between 1 and 100'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Limit must be between 1 and 1000'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('offset must be a non-negative integer'),
    query('endpoint_id')
      .optional()
      .isUUID()
      .withMessage('endpoint_id must be a valid UUID'),
    query('event_id')
      .optional()
      .isUUID()
      .withMessage('event_id must be a valid UUID'),
    query('created_after')
      .optional()
      .isISO8601()
      .withMessage('created_after must be a valid ISO 8601 date'),
    query('created_before')
      .optional()
      .isISO8601()
      .withMessage('created_before must be a valid ISO 8601 date')
      .custom((value, { req }) => {
        if (req.query.created_after) {
          const after = new Date(req.query.created_after).getTime();
          const before = new Date(value).getTime();
          if (!isNaN(after) && !isNaN(before) && after > before) {
            throw new Error('created_after cannot be later than created_before');
          }
        }
        return true;
      }),
    query('q')
      .optional()
      .isString()
      .trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation Error',
          message: errors.array().map((e) => e.msg).join(', '),
          errors: errors.array(),
        });
      }

      const tenantId = req.tenantId;
      const stateQuery = req.query.state;
      const state = stateQuery || 'DEAD';

      // Resolve pagination respecting precedence: pageSize > limit, page > offset
      let pageSize = 20;
      let limit = 20;
      let isLimit = false;
      if (req.query.pageSize !== undefined) {
        pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10)));
        limit = pageSize;
      } else if (req.query.limit !== undefined) {
        limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10)));
        pageSize = limit;
        isLimit = true;
      }

      let page = 1;
      let offset = 0;
      let isOffset = false;
      if (req.query.page !== undefined) {
        page = Math.max(1, parseInt(req.query.page, 10));
        offset = (page - 1) * pageSize;
      } else if (req.query.offset !== undefined) {
        offset = Math.max(0, parseInt(req.query.offset, 10));
        page = Math.floor(offset / pageSize) + 1;
        isOffset = true;
      }

      const filters = {
        state,
        endpoint_id: req.query.endpoint_id,
        event_id: req.query.event_id,
        created_after: req.query.created_after,
        created_before: req.query.created_before,
        q: req.query.q,
      };

      const pagination = {
        page,
        pageSize,
        ...(isLimit ? { limit } : {}),
        ...(isOffset ? { offset } : {}),
      };

      const result = await deliveryService.queryDeliveries(
        tenantId,
        filters,
        pagination
      );

      const formattedDeliveries = result.deliveries.map((d) => ({
        id: d.id,
        eventId: d.eventId,
        event_id: d.eventId,
        endpointId: d.endpointId,
        endpoint_id: d.endpointId,
        seq: d.seq,
        state: d.state.toString(),
        attemptCount: d.attemptCount,
        attempt_count: d.attemptCount,
        nextAttemptAt: d.nextAttemptAt,
        next_attempt_at: d.nextAttemptAt,
        lastError: d.lastError,
        last_error: d.lastError,
        createdAt: d.createdAt,
        created_at: d.createdAt,
        updatedAt: d.updatedAt,
        updated_at: d.updatedAt,
      }));

      res.json({
        data: formattedDeliveries,
        deliveries: formattedDeliveries,
        state,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /deliveries/:id
 * Get delivery by ID with attempts (tenant-scoped via auth middleware).
 */
router.get(
  '/:id',
  param('id').isUUID().withMessage('Invalid delivery ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const deliveryId = req.params.id;
      const tenantId = req.tenantId;

      const delivery = await deliveryService.getDeliveryById(deliveryId, tenantId);

      if (!delivery) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Delivery not found',
        });
      }

      res.json({
        id: delivery.id,
        eventId: delivery.eventId,
        event_id: delivery.eventId,
        endpointId: delivery.endpointId,
        endpoint_id: delivery.endpointId,
        seq: delivery.seq,
        state: delivery.state.toString(),
        attemptCount: delivery.attemptCount,
        attempt_count: delivery.attemptCount,
        nextAttemptAt: delivery.nextAttemptAt,
        next_attempt_at: delivery.nextAttemptAt,
        lastError: delivery.lastError,
        last_error: delivery.lastError,
        createdAt: delivery.createdAt,
        created_at: delivery.createdAt,
        updatedAt: delivery.updatedAt,
        updated_at: delivery.updatedAt,
        attempts: delivery.attempts || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /deliveries/:id/replay
 * Replay a DEAD delivery (tenant-scoped via auth middleware).
 */
router.post(
  '/:id/replay',
  param('id').isUUID().withMessage('Invalid delivery ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const deliveryId = req.params.id;
      const tenantId = req.tenantId;

      const delivery = await deliveryService.replayDelivery(deliveryId, tenantId);

      const deliveryData = {
        id: delivery.id,
        eventId: delivery.eventId,
        endpointId: delivery.endpointId,
        seq: delivery.seq,
        state: delivery.state.toString(),
        attemptCount: delivery.attemptCount,
        nextAttemptAt: delivery.nextAttemptAt,
        lastError: delivery.lastError,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
      };

      res.json({
        success: true,
        message: 'Delivery re-enqueued as PENDING',
        ...deliveryData,
        delivery: deliveryData,
      });
    } catch (error) {
      if (error instanceof IllegalStateTransitionError || error.name === 'IllegalStateTransitionError') {
        return res.status(400).json({
          error: 'Invalid state transition',
          message: error.message,
        });
      }
      if (error.statusCode === 404) {
        return res.status(404).json({
          error: 'Not found',
          message: error.message,
        });
      }
      next(error);
    }
  }
);

export default router;
