/**
 * Event routes - REST API for event ingestion and status.
 * POST /events - Ingest an event with idempotency
 * GET /events/:id/deliveries - Get deliveries for an event
 */

import express from 'express';
import { header, param, query, validationResult } from 'express-validator';
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
          eventId: result.event.id,
          idempotencyKey: result.event.idempotencyKey,
          createdAt: result.event.createdAt,
          deliveriesEnqueued: 0,
          duplicate: true,
        });
      } else {
        // 202 for new event
        res.status(202).json({
          id: result.event.id,
          eventId: result.event.id,
          idempotencyKey: result.event.idempotencyKey,
          createdAt: result.event.createdAt,
          deliveriesEnqueued: result.deliveriesEnqueued,
          duplicate: false,
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
 * Query events with tenant isolation, dynamic filters, and pagination.
 */
router.get(
  '/',
  apiKeyAuth,
  [
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
    query('idempotency_key')
      .optional()
      .isString()
      .trim(),
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

      const tenantId = req[TENANT_ID_ATTRIBUTE] || req.tenantId;

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
        idempotency_key: req.query.idempotency_key,
        created_after: req.query.created_after,
        created_before: req.query.created_before,
        q: req.query.q,
      };

      const repoPagination = {
        page,
        pageSize,
        ...(isLimit ? { limit } : {}),
        ...(isOffset ? { offset } : {}),
      };

      const result = await eventRepository.findWithFilters(
        tenantId,
        filters,
        repoPagination
      );

      const totalRecords = result.totalRecords;
      const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / pageSize);
      const hasNext = offset + limit < totalRecords;
      const hasPrev = totalRecords > 0 && offset > 0;
      const pagination = {
        page,
        pageSize,
        totalRecords,
        totalPages,
        hasNext,
        hasPrev,
        ...(isOffset ? { offset } : {}),
      };

      const formattedEvents = result.events.map((e) => {
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
      });

      res.json({
        data: formattedEvents,
        events: formattedEvents,
        pagination,
      });
    } catch (error) {
      next(error);
    }
  }
);

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
