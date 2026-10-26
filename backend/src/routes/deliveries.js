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
  query('state').optional().isIn(deliveryState.values()).withMessage('Invalid state'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const state = req.query.state || 'DEAD';
      const limit = parseInt(req.query.limit || '100', 10);
      const tenantId = req.tenantId;

      const deliveries = await deliveryService.getDeliveriesByState(state, tenantId, limit);

      res.json({
        state,
        deliveries: deliveries.map((d) => ({
          id: d.id,
          eventId: d.eventId,
          endpointId: d.endpointId,
          seq: d.seq,
          state: d.state.toString(),
          attemptCount: d.attemptCount,
          nextAttemptAt: d.nextAttemptAt,
          lastError: d.lastError,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })),
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
