/**
 * Event routes - REST API for event ingestion and status.
 * POST /events - Ingest an event with idempotency
 * GET /events/:id/deliveries - Get deliveries for an event
 */

import express from 'express';
import { header, param, validationResult } from 'express-validator';
import { apiKeyAuth, TENANT_ID_ATTRIBUTE } from '../middleware/auth.js';
import eventIngestService from '../services/ingest/eventIngestService.js';
import eventRepository from '../repositories/jdbc/eventRepository.js';
import deliveryService from '../services/delivery/deliveryService.js';

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

      // Event body validation: require a non-null, non-array JSON object with at least one property
      const body = req.body;
      if (
        body === undefined ||
        body === null ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length === 0
      ) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Request body must be a non-empty JSON object',
        });
      }

      const tenantId = req.tenantId;
      const idempotencyKey = req.headers['idempotency-key'];
      const payloadJson = JSON.stringify(body);

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
          eventId: d.eventId,
          event_id: d.eventId,
          endpointId: d.endpointId,
          endpoint_id: d.endpointId,
          endpointUrl: d.endpointUrl || null,
          endpoint_url: d.endpointUrl || null,
          seq: d.seq,
          state: d.state.toString(),
          attemptCount: d.attemptCount,
          attempt_count: d.attemptCount,
          nextAttemptAt: d.nextAttemptAt,
          next_attempt_at: d.nextAttemptAt,
          lastError: d.lastError,
          last_error: d.lastError,
          lastStatusCode: d.lastStatusCode ?? null,
          last_status_code: d.lastStatusCode ?? null,
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
 * GET /events
 * List events for the authenticated tenant.
 */
router.get('/', apiKeyAuth, async (req, res, next) => {
  try {
    const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
    const limit = parseInt(req.query.limit || '100', 10);
    const events = await eventRepository.findAllByTenant(tenantId, limit);

    res.json(
      events.map((e) => {
        let parsedPayload = e.payloadJson;
        try {
          if (typeof e.payloadJson === 'string') {
            parsedPayload = JSON.parse(e.payloadJson);
          }
        } catch {
          parsedPayload = e.payloadJson;
        }

        return {
          id: e.id,
          tenantId: e.tenantId,
          tenant_id: e.tenantId,
          payload: parsedPayload,
          idempotencyKey: e.idempotencyKey,
          idempotency_key: e.idempotencyKey,
          createdAt: e.createdAt,
          created_at: e.createdAt,
        };
      })
    );
  } catch (error) {
    next(error);
  }
});

/**
 * GET /events/:id
 * Get a single event by ID for the authenticated tenant.
 */
router.get(
  '/:id',
  apiKeyAuth,
  param('id').isUUID().withMessage('Invalid event ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;
      const event = await eventRepository.findById(req.params.id);

      if (!event || event.tenantId !== tenantId) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Event not found',
        });
      }

      let parsedPayload = event.payloadJson;
      try {
        if (typeof event.payloadJson === 'string') {
          parsedPayload = JSON.parse(event.payloadJson);
        }
      } catch {
        parsedPayload = event.payloadJson;
      }

      res.json({
        id: event.id,
        tenantId: event.tenantId,
        tenant_id: event.tenantId,
        payload: parsedPayload,
        idempotencyKey: event.idempotencyKey,
        idempotency_key: event.idempotencyKey,
        createdAt: event.createdAt,
        created_at: event.createdAt,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
