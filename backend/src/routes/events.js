/**
 * Event routes - REST API for event ingestion and status.
 * POST /events - Ingest an event with idempotency
 * GET /events/:id/deliveries - Get deliveries for an event
 */

import express from 'express';
import { header, param, validationResult } from 'express-validator';
import { apiKeyAuth, TENANT_ID_ATTRIBUTE } from '../middleware/auth.js';
import eventIngestService from '../services/ingest/eventIngestService.js';
import deliveryService from '../services/delivery/deliveryService.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * POST /events
 * Ingest an event with idempotency key.
 */
router.post(
  '/',
  apiKeyAuth,
  [
    header('Idempotency-Key')
      .notEmpty()
      .withMessage('Idempotency-Key header is required'),
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

      const tenantId = req.tenantId;
      const idempotencyKey = req.headers['idempotency-key'];
      const payloadJson = JSON.stringify(req.body);

      const result = await eventIngestService.ingest(
        tenantId,
        idempotencyKey,
        payloadJson
      );

      if (result.duplicate) {
        // 200 for idempotent replay
        res.status(200).json({
          id: result.event.id,
          idempotencyKey: result.event.idempotencyKey,
          createdAt: result.event.createdAt,
          deliveriesEnqueued: 0,
        });
      } else {
        // 202 for new event
        res.status(202).json({
          id: result.event.id,
          idempotencyKey: result.event.idempotencyKey,
          createdAt: result.event.createdAt,
          deliveriesEnqueued: result.deliveriesEnqueued,
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /events/:id/deliveries
 * Get all deliveries for an event (tenant-scoped via auth middleware).
 */
router.get(
  '/:id/deliveries',
  param('id').isUUID().withMessage('Invalid event ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const eventId = req.params.id;
      const tenantId = req.tenantId;

      const deliveries = await deliveryService.getDeliveriesByEvent(eventId, tenantId);

      res.json({
        eventId,
        deliveries: deliveries.map((d) => ({
          id: d.id,
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

export default router;
