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
 * GET /deliveries?state=DEAD
 * Get deliveries by state (tenant-scoped via auth middleware).
 */
router.get(
  '/',
  query('state')
    .optional()
    .isIn([...deliveryState.values(), 'ALL'])
    .withMessage('Invalid state'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const limit = parseInt(req.query.limit || '100', 10);
      const tenantId = req.tenantId;
      const stateQuery = req.query.state;

      let state = stateQuery || 'DEAD';
      let deliveries;

      if (stateQuery === 'ALL') {
        deliveries = await deliveryService.getAllDeliveries(tenantId, limit);
      } else {
        deliveries = await deliveryService.getDeliveriesByState(state, tenantId, limit);
      }

      res.json({
        state,
        deliveries: deliveries.map((d) => ({
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
        })),
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

      res.json({
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
