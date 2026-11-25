/**
 * Delivery routes - Status APIs, scheduling, replay, and bulk operations.
 * GET /deliveries?state=DEAD
 * POST /deliveries/schedule
 * GET /deliveries/scheduled
 * GET /deliveries/scheduled/:id
 * POST /deliveries/:id/cancel
 * POST /deliveries/:id/replay
 * POST /deliveries/bulk-replay
 */

import express from 'express';
import { query, param, body, validationResult } from 'express-validator';
import { TENANT_ID_ATTRIBUTE } from '../middleware/auth.js';
import deliveryService from '../services/delivery/deliveryService.js';
import { deliveryState } from '../domain/deliveryState.js';
import { IllegalStateTransitionError } from '../domain/errors/illegalStateTransitionError.js';

const router = express.Router();

function formatDeliveryPayload(d) {
  return {
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
    scheduledAt: d.scheduledAt || null,
    scheduled_at: d.scheduledAt || null,
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
  };
}

/**
 * Shared schedule request validators
 */
const scheduleValidators = [
  body('endpointId')
    .optional()
    .isUUID()
    .withMessage('endpointId must be a valid UUID'),
  body('endpoint_id')
    .optional()
    .isUUID()
    .withMessage('endpoint_id must be a valid UUID'),
  body('scheduledAt')
    .optional()
    .isISO8601()
    .withMessage('scheduledAt must be a valid ISO 8601 date'),
  body('scheduled_at')
    .optional()
    .isISO8601()
    .withMessage('scheduled_at must be a valid ISO 8601 date'),
  body('eventId')
    .optional()
    .isUUID()
    .withMessage('eventId must be a valid UUID'),
  body('event_id')
    .optional()
    .isUUID()
    .withMessage('event_id must be a valid UUID'),
  body().custom((value, { req }) => {
    const endpointId = req.body?.endpointId || req.body?.endpoint_id;
    if (!endpointId) {
      throw new Error('endpointId or endpoint_id is required');
    }
    const scheduledAt = req.body?.scheduledAt || req.body?.scheduled_at;
    if (!scheduledAt) {
      throw new Error('scheduledAt or scheduled_at is required');
    }
    const schedDate = new Date(scheduledAt);
    if (isNaN(schedDate.getTime())) {
      throw new Error('scheduledAt must be a valid ISO 8601 date string');
    }
    if (schedDate.getTime() <= Date.now()) {
      throw new Error('scheduledAt must be a future date and time');
    }
    const eventId = req.body?.eventId || req.body?.event_id;
    const payload = req.body?.payload;
    if (!eventId && payload === undefined) {
      throw new Error('Either eventId or payload must be provided');
    }
    if (
      payload !== undefined &&
      (typeof payload !== 'object' || payload === null || Array.isArray(payload) || Object.keys(payload).length === 0)
    ) {
      throw new Error('Payload must be a non-empty JSON object');
    }
    return true;
  }),
];

async function handleSchedule(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.array().map((e) => e.msg).join(', '),
        errors: errors.array(),
      });
    }

    const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];
    const delivery = await deliveryService.scheduleDelivery(tenantId, req.body);
    const formatted = formatDeliveryPayload(delivery);

    res.status(201).json({
      success: true,
      message: 'Webhook delivery scheduled successfully',
      ...formatted,
      delivery: formatted,
    });
  } catch (error) {
    if (error.statusCode === 400 || error.name === 'ValidationError') {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.message,
      });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message,
      });
    }
    next(error);
  }
}

/**
 * Shared bulk replay validators
 */
const bulkReplayValidators = [
  body().custom((value, { req }) => {
    const ids = req.body?.deliveryIds || req.body?.delivery_ids || req.body?.ids;
    if (!ids) {
      throw new Error('deliveryIds or delivery_ids is required');
    }
    if (!Array.isArray(ids)) {
      throw new Error('deliveryIds must be an array of UUIDs');
    }
    if (ids.length === 0) {
      throw new Error('deliveryIds must not be empty');
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const id of ids) {
      if (typeof id !== 'string' || !uuidRegex.test(id)) {
        throw new Error(`Invalid delivery ID in array: ${id}`);
      }
    }
    return true;
  }),
];

async function handleBulkReplay(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.array().map((e) => e.msg).join(', '),
        errors: errors.array(),
      });
    }

    const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];
    const deliveryIds = req.body.deliveryIds || req.body.delivery_ids || req.body.ids;

    const result = await deliveryService.bulkReplayDeliveries(deliveryIds, tenantId);

    res.status(200).json({
      success: true,
      message: 'Bulk replay completed',
      ...result,
    });
  } catch (error) {
    if (error.statusCode === 400 || error.name === 'ValidationError') {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.message,
      });
    }
    next(error);
  }
}

/**
 * Shared cancel handler
 */
async function handleCancel(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const deliveryId = req.params.id;
    const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];

    const cancelled = await deliveryService.cancelScheduledDelivery(deliveryId, tenantId);
    const formatted = formatDeliveryPayload(cancelled);

    res.status(200).json({
      success: true,
      message: 'Scheduled delivery cancelled successfully',
      ...formatted,
      delivery: formatted,
    });
  } catch (error) {
    if (error instanceof IllegalStateTransitionError || error.name === 'IllegalStateTransitionError') {
      return res.status(400).json({
        error: 'Invalid state transition',
        message: error.message,
      });
    }
    if (error.statusCode === 400) {
      return res.status(400).json({
        error: 'Bad Request',
        message: error.message,
      });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message,
      });
    }
    next(error);
  }
}

// -------------------------------------------------------------
// POST /deliveries/schedule & POST /deliveries/scheduled
// -------------------------------------------------------------
router.post('/schedule', scheduleValidators, handleSchedule);
router.post('/scheduled', scheduleValidators, handleSchedule);

// -------------------------------------------------------------
// POST /deliveries/bulk-replay & POST /deliveries/replay
// -------------------------------------------------------------
router.post('/bulk-replay', bulkReplayValidators, handleBulkReplay);
router.post('/replay', bulkReplayValidators, handleBulkReplay);

// -------------------------------------------------------------
// GET /deliveries/scheduled
// -------------------------------------------------------------
router.get(
  '/scheduled',
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
    query('endpoint_id')
      .optional()
      .isUUID()
      .withMessage('endpoint_id must be a valid UUID'),
    query('endpointId')
      .optional()
      .isUUID()
      .withMessage('endpointId must be a valid UUID'),
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
      .withMessage('created_before must be a valid ISO 8601 date'),
    query('q')
      .optional()
      .isString()
      .trim(),
    query('search')
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

      const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];

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
        endpoint_id: req.query.endpoint_id || req.query.endpointId || null,
        event_id: req.query.event_id || null,
        created_after: req.query.created_after || null,
        created_before: req.query.created_before || null,
        q: req.query.q || req.query.search || null,
      };

      const pagination = {
        page,
        pageSize,
        ...(isLimit ? { limit } : {}),
        ...(isOffset ? { offset } : {}),
      };

      const result = await deliveryService.getScheduledDeliveries(tenantId, filters, pagination);
      const formattedDeliveries = result.deliveries.map(formatDeliveryPayload);

      res.json({
        data: formattedDeliveries,
        deliveries: formattedDeliveries,
        state: 'SCHEDULED',
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }
);

// -------------------------------------------------------------
// GET /deliveries/scheduled/:id
// -------------------------------------------------------------
router.get(
  '/scheduled/:id',
  param('id').isUUID().withMessage('Invalid delivery ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const deliveryId = req.params.id;
      const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];

      const delivery = await deliveryService.getScheduledDeliveryById(deliveryId, tenantId);
      if (!delivery) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Delivery not found',
        });
      }

      res.json({
        ...formatDeliveryPayload(delivery),
        attempts: delivery.attempts || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

// -------------------------------------------------------------
// POST /deliveries/scheduled/:id/cancel & DELETE /deliveries/scheduled/:id
// -------------------------------------------------------------
router.post('/scheduled/:id/cancel', param('id').isUUID().withMessage('Invalid delivery ID'), handleCancel);
router.delete('/scheduled/:id', param('id').isUUID().withMessage('Invalid delivery ID'), handleCancel);

/**
 * GET /deliveries
 * Query deliveries with tenant isolation, dynamic filters, and pagination.
 */
router.get(
  '/',
  [
    query('state')
      .optional()
      .custom((val) => {
        const allowed = [...deliveryState.values(), 'ALL'];
        const tokens = String(val)
          .split(',')
          .map((s) => s.trim().toUpperCase());
        for (const token of tokens) {
          if (!allowed.includes(token)) {
            throw new Error('Invalid state');
          }
        }
        return true;
      }),
    query('status')
      .optional()
      .custom((val) => {
        const allowed = [...deliveryState.values(), 'ALL'];
        const tokens = String(val)
          .split(',')
          .map((s) => s.trim().toUpperCase());
        for (const token of tokens) {
          if (!allowed.includes(token)) {
            throw new Error('Invalid state');
          }
        }
        return true;
      }),
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
      .custom((val) => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const tokens = String(val)
          .split(',')
          .map((s) => s.trim());
        for (const token of tokens) {
          if (!uuidRegex.test(token)) {
            throw new Error('endpoint_id must be a valid UUID');
          }
        }
        return true;
      }),
    query('endpointId')
      .optional()
      .custom((val) => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const tokens = String(val)
          .split(',')
          .map((s) => s.trim());
        for (const token of tokens) {
          if (!uuidRegex.test(token)) {
            throw new Error('endpointId must be a valid UUID');
          }
        }
        return true;
      }),
    query('event_id')
      .optional()
      .custom((val) => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const tokens = String(val)
          .split(',')
          .map((s) => s.trim());
        for (const token of tokens) {
          if (!uuidRegex.test(token)) {
            throw new Error('event_id must be a valid UUID');
          }
        }
        return true;
      }),
    query('eventId')
      .optional()
      .custom((val) => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const tokens = String(val)
          .split(',')
          .map((s) => s.trim());
        for (const token of tokens) {
          if (!uuidRegex.test(token)) {
            throw new Error('eventId must be a valid UUID');
          }
        }
        return true;
      }),
    query('event_type').optional().isString().trim(),
    query('eventType').optional().isString().trim(),
    query('created_after')
      .optional()
      .isISO8601()
      .withMessage('created_after must be a valid ISO 8601 date'),
    query('from')
      .optional()
      .isISO8601()
      .withMessage('from must be a valid ISO 8601 date'),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('startDate must be a valid ISO 8601 date'),
    query('start_date')
      .optional()
      .isISO8601()
      .withMessage('start_date must be a valid ISO 8601 date'),
    query('created_before')
      .optional()
      .isISO8601()
      .withMessage('created_before must be a valid ISO 8601 date'),
    query('to')
      .optional()
      .isISO8601()
      .withMessage('to must be a valid ISO 8601 date'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('endDate must be a valid ISO 8601 date'),
    query('end_date')
      .optional()
      .isISO8601()
      .withMessage('end_date must be a valid ISO 8601 date'),
    query().custom((value, { req }) => {
      const after =
        req.query.created_after ||
        req.query.from ||
        req.query.startDate ||
        req.query.start_date;
      const before =
        req.query.created_before ||
        req.query.to ||
        req.query.endDate ||
        req.query.end_date;
      if (after && before) {
        const afterTime = new Date(after).getTime();
        const beforeTime = new Date(before).getTime();
        if (!isNaN(afterTime) && !isNaN(beforeTime) && afterTime > beforeTime) {
          throw new Error('created_after cannot be later than created_before');
        }
      }
      return true;
    }),
    query('status_code')
      .optional()
      .custom((val) => {
        const s = String(val).trim().toLowerCase();
        if (['2xx', '3xx', '4xx', '5xx'].includes(s)) return true;
        const num = parseInt(s, 10);
        if (isNaN(num) || ((num < 100 || num > 599) && num !== 0)) {
          throw new Error('status_code must be between 100 and 599 or a class like 2xx, 4xx, 5xx');
        }
        return true;
      }),
    query('statusCode')
      .optional()
      .custom((val) => {
        const s = String(val).trim().toLowerCase();
        if (['2xx', '3xx', '4xx', '5xx'].includes(s)) return true;
        const num = parseInt(s, 10);
        if (isNaN(num) || ((num < 100 || num > 599) && num !== 0)) {
          throw new Error('statusCode must be between 100 and 599 or a class like 2xx, 4xx, 5xx');
        }
        return true;
      }),
    query('last_status_code')
      .optional()
      .custom((val) => {
        const s = String(val).trim().toLowerCase();
        if (['2xx', '3xx', '4xx', '5xx'].includes(s)) return true;
        const num = parseInt(s, 10);
        if (isNaN(num) || ((num < 100 || num > 599) && num !== 0)) {
          throw new Error('last_status_code must be between 100 and 599 or a class like 2xx, 4xx, 5xx');
        }
        return true;
      }),
    query('http_status')
      .optional()
      .custom((val) => {
        const s = String(val).trim().toLowerCase();
        if (['2xx', '3xx', '4xx', '5xx'].includes(s)) return true;
        const num = parseInt(s, 10);
        if (isNaN(num) || ((num < 100 || num > 599) && num !== 0)) {
          throw new Error('http_status must be between 100 and 599 or a class like 2xx, 4xx, 5xx');
        }
        return true;
      }),
    query('attempt_count')
      .optional()
      .isInt({ min: 0 })
      .withMessage('attempt_count must be a non-negative integer'),
    query('attemptCount')
      .optional()
      .isInt({ min: 0 })
      .withMessage('attemptCount must be a non-negative integer'),
    query('min_attempts')
      .optional()
      .isInt({ min: 0 })
      .withMessage('min_attempts must be a non-negative integer'),
    query('minAttempts')
      .optional()
      .isInt({ min: 0 })
      .withMessage('minAttempts must be a non-negative integer'),
    query('max_attempts')
      .optional()
      .isInt({ min: 0 })
      .withMessage('max_attempts must be a non-negative integer'),
    query('maxAttempts')
      .optional()
      .isInt({ min: 0 })
      .withMessage('maxAttempts must be a non-negative integer'),
    query().custom((value, { req }) => {
      const min = req.query.min_attempts ?? req.query.minAttempts;
      const max = req.query.max_attempts ?? req.query.maxAttempts;
      if (min !== undefined && max !== undefined) {
        if (parseInt(min, 10) > parseInt(max, 10)) {
          throw new Error('min_attempts cannot be greater than max_attempts');
        }
      }
      return true;
    }),
    query('sortBy')
      .optional()
      .isIn([
        'created_at',
        'createdAt',
        'updated_at',
        'updatedAt',
        'seq',
        'attempt_count',
        'attemptCount',
        'next_attempt_at',
        'nextAttemptAt',
      ])
      .withMessage('Invalid sortBy column'),
    query('sort_by')
      .optional()
      .isIn([
        'created_at',
        'createdAt',
        'updated_at',
        'updatedAt',
        'seq',
        'attempt_count',
        'attemptCount',
        'next_attempt_at',
        'nextAttemptAt',
      ])
      .withMessage('Invalid sort_by column'),
    query('sortOrder')
      .optional()
      .isIn(['ASC', 'DESC', 'asc', 'desc'])
      .withMessage('Invalid sortOrder'),
    query('sort_order')
      .optional()
      .isIn(['ASC', 'DESC', 'asc', 'desc'])
      .withMessage('Invalid sort_order'),
    query('order')
      .optional()
      .isIn(['ASC', 'DESC', 'asc', 'desc'])
      .withMessage('Invalid order'),
    query('q')
      .optional()
      .isString()
      .trim(),
    query('search')
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

      const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];
      const stateQuery = req.query.state || req.query.status;
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
        endpoint_id: req.query.endpoint_id || req.query.endpointId || null,
        event_id: req.query.event_id || req.query.eventId || null,
        event_type: req.query.event_type || req.query.eventType || null,
        created_after:
          req.query.created_after ||
          req.query.from ||
          req.query.startDate ||
          req.query.start_date ||
          null,
        created_before:
          req.query.created_before ||
          req.query.to ||
          req.query.endDate ||
          req.query.end_date ||
          null,
        status_code:
          req.query.status_code ??
          req.query.statusCode ??
          req.query.last_status_code ??
          req.query.http_status ??
          null,
        attempt_count: req.query.attempt_count ?? req.query.attemptCount ?? null,
        min_attempts: req.query.min_attempts ?? req.query.minAttempts ?? null,
        max_attempts: req.query.max_attempts ?? req.query.maxAttempts ?? null,
        q: req.query.q || req.query.search || null,
        sortBy: req.query.sortBy || req.query.sort_by || null,
        sortOrder: req.query.sortOrder || req.query.sort_order || req.query.order || null,
      };

      const pagination = {
        page,
        pageSize,
        ...(isLimit ? { limit } : {}),
        ...(isOffset ? { offset } : {}),
        ...(filters.sortBy ? { sortBy: filters.sortBy } : {}),
        ...(filters.sortOrder ? { sortOrder: filters.sortOrder } : {}),
      };

      const result = await deliveryService.queryDeliveries(
        tenantId,
        filters,
        pagination
      );

      const formattedDeliveries = result.deliveries.map(formatDeliveryPayload);

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
 * POST /deliveries (alias for schedule delivery if scheduling fields provided)
 */
router.post('/', scheduleValidators, handleSchedule);

/**
 * GET /deliveries/:id
 * Get delivery by ID with detailed attempts, event info, endpoint info, and diagnostics.
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
      const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];

      const delivery = await deliveryService.getDeliveryById(deliveryId, tenantId);

      if (!delivery) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Delivery not found',
        });
      }

      res.json({
        ...formatDeliveryPayload(delivery),
        attempts: delivery.attempts || [],
        event: delivery.event || null,
        endpoint: delivery.endpoint || null,
        retry: delivery.retry || null,
        lifecycle: delivery.lifecycle || null,
        request: delivery.request || null,
        diagnostics: delivery.diagnostics || null,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /deliveries/:id/attempts
 * Get delivery attempt history (tenant-scoped).
 */
router.get(
  '/:id/attempts',
  param('id').isUUID().withMessage('Invalid delivery ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const deliveryId = req.params.id;
      const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];

      const attempts = await deliveryService.getDeliveryAttempts(deliveryId, tenantId);

      if (!attempts) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Delivery not found',
        });
      }

      res.json({
        deliveryId,
        delivery_id: deliveryId,
        totalAttempts: attempts.length,
        total_attempts: attempts.length,
        attempts,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /deliveries/:id/logs
 * Get detailed diagnostic logs for a delivery (tenant-scoped).
 */
router.get(
  '/:id/logs',
  param('id').isUUID().withMessage('Invalid delivery ID'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const deliveryId = req.params.id;
      const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];

      const delivery = await deliveryService.getDeliveryLogs(deliveryId, tenantId);

      if (!delivery) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Delivery not found',
        });
      }

      res.json({
        deliveryId,
        delivery_id: deliveryId,
        state: delivery.state?.toString() || delivery.state,
        endpoint: delivery.endpoint || null,
        event: delivery.event || null,
        lifecycle: delivery.lifecycle || null,
        retry: delivery.retry || null,
        diagnostics: delivery.diagnostics || null,
        attempts: delivery.attempts || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /deliveries/:id/cancel & DELETE /deliveries/:id
 * Cancel a scheduled delivery (tenant-scoped).
 */
router.post('/:id/cancel', param('id').isUUID().withMessage('Invalid delivery ID'), handleCancel);
router.delete('/:id', param('id').isUUID().withMessage('Invalid delivery ID'), handleCancel);

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
      const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];

      const delivery = await deliveryService.replayDelivery(deliveryId, tenantId);
      const deliveryPayload = formatDeliveryPayload(delivery);

      res.json({
        success: true,
        message: 'Delivery replayed successfully',
        ...deliveryPayload,
        delivery: deliveryPayload,
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

/**
 * POST /deliveries/:id/resend
 * Resend an existing delivery (DEAD, SUCCEEDED, or CANCELLED).
 * Supports optional immediate execution: { "immediate": true|false } (defaults to false).
 */
router.post(
  '/:id/resend',
  [
    param('id').isUUID().withMessage('Invalid delivery ID'),
    body('immediate')
      .optional()
      .isBoolean()
      .withMessage('immediate must be a boolean'),
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

      const deliveryId = req.params.id;
      const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];
      const immediate = req.body?.immediate === true;

      const result = await deliveryService.resendDelivery(deliveryId, tenantId, { immediate });
      const deliveryPayload = formatDeliveryPayload(result.delivery || result);

      res.status(200).json({
        success: result.success !== undefined ? result.success : true,
        message: result.message || (immediate ? 'Delivery resent immediately' : 'Delivery queued for resend'),
        ...deliveryPayload,
        delivery: deliveryPayload,
        ...(result.attempt ? { attempt: result.attempt } : {}),
        ...(result.blocked ? { blocked: result.blocked } : {}),
      });
    } catch (error) {
      if (
        error instanceof IllegalStateTransitionError ||
        error.name === 'IllegalStateTransitionError' ||
        error.statusCode === 400
      ) {
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
