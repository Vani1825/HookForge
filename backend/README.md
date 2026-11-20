# HookForge Backend API & Architecture Documentation

HookForge is an enterprise-grade, event-driven webhook delivery platform built on Node.js, Express, and PostgreSQL 16. It employs PostgreSQL as an ACID-compliant durable message queue with zero external message brokers.

---

## Phase 2, Task 1: Scheduling & Bulk Replay

This release introduces backend support for **Scheduled Webhook Delivery** and **Bulk Replay of Failed Deliveries** while preserving all Phase 0 and Phase 1 delivery, authentication, retry, signature, and analytics functionality.

---

## 1. Feature A: Scheduled Webhook Delivery

### Architecture & Lifecycle
HookForge models webhook deliveries as state machines with durable PostgreSQL tracking. Scheduled deliveries extend this state machine with an explicit `SCHEDULED` state:

```text
SCHEDULED --(scheduled time arrives)--> PENDING --(worker claim)--> IN_FLIGHT
    |                                      |                               |
    |--(user cancel)--> CANCELLED          |--(user cancel)--> CANCELLED   |--2xx HTTP--> SUCCEEDED
                                                                           |--retryable failure--> RETRYING
                                                                           |--permanent failure--> DEAD
```

1. **Scheduling**: Authorized tenants submit a delivery with a future execution timestamp (`scheduledAt`), an endpoint (`endpointId`), and either a webhook `payload` or an existing `eventId`.
2. **Durable Persistence**: The delivery record is persisted in PostgreSQL with `state = 'SCHEDULED'`, `scheduled_at = <timestamp>`, and `next_attempt_at = <timestamp>`.
3. **Head-of-Line Protection**: Scheduled deliveries remain non-blocking for active immediate deliveries on the same endpoint until their execution time arrives.
4. **Worker Promotion**: During each dispatcher cycle (`poll()`), due scheduled deliveries (`state = 'SCHEDULED' AND next_attempt_at <= now()`) are atomically promoted to `PENDING` via `SELECT ... FOR UPDATE SKIP LOCKED`.
5. **Restart & Worker Failure Safety**: If the backend crashes or restarts, scheduled deliveries remain persisted in PostgreSQL and resume on the next poll cycle without message loss or double-dispatch.
6. **Cancellation**: Scheduled deliveries in `SCHEDULED` (or `PENDING`) states can be cancelled at any time before execution, safely transitioning to terminal `CANCELLED` state.

---

## 2. Feature B: Bulk Replay

### Architecture & Reliability
Bulk replay enables authorized tenants to replay multiple failed deliveries in a single transaction-safe operation without bypassing the delivery lifecycle, signature generation, rate limiting, or retry logic.

1. **Request Validation**: Accepts an array of delivery UUIDs (`deliveryIds` or `delivery_ids`). Rejects non-arrays, empty lists, or malformed UUIDs with HTTP 400.
2. **Duplicate Prevention**: Automatically deduplicates delivery IDs within the request batch to prevent duplicate replay attempts.
3. **Authorization & Tenant Isolation**: Verifies that every delivery belongs to the authenticated tenant. Unowned or non-existent deliveries are placed into `rejected`.
4. **Eligibility Verification**: Verifies delivery eligibility under the delivery lifecycle: only deliveries in `DEAD` state are eligible for replay. Deliveries in `SUCCEEDED`, `IN_FLIGHT`, `PENDING`, or `RETRYING` states are categorized into `ineligible`.
5. **Single Replay Reuse**: Reuses the core `replayDelivery` implementation to reset `attempt_count = 0` and atomically transition state to `PENDING`.
6. **Partial Failure Handling**: Continues processing all valid requests even if individual items are ineligible or rejected, returning an explicit categorization and summary.
7. **Audit Trail**: Preserves full delivery history, including prior attempt logs in `delivery_attempts`.

---

## 3. API Reference

All requests require Bearer token authentication via the `Authorization: Bearer <tenant-api-key>` header.

### 3.1 Schedule Webhook Delivery

**Endpoint:** `POST /deliveries/schedule` (or `POST /deliveries/scheduled`)  
**Status Code:** `201 Created`

#### Request Headers
```http
Authorization: Bearer whkey_xxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

#### Request Parameters
| Parameter | Type | Required | Description |
|---|---|---|---|
| `endpointId` / `endpoint_id` | UUID string | Yes | ID of the destination endpoint (must belong to authenticated tenant) |
| `scheduledAt` / `scheduled_at` | ISO-8601 string | Yes | Future date and time for execution (e.g., `2026-12-01T15:00:00Z`) |
| `payload` | Object | Conditional | Webhook JSON body (required if `eventId` is not provided) |
| `eventId` / `event_id` | UUID string | Conditional | Reference to existing ingested event (required if `payload` is not provided) |
| `idempotencyKey` / `idempotency_key` | String | No | Custom idempotency key when creating an event from `payload` |

#### Example Request Body (With Payload)
```json
{
  "endpointId": "111e6543-e89b-12d3-a456-426614174111",
  "scheduledAt": "2026-12-01T15:00:00.000Z",
  "payload": {
    "event": "invoice.generated",
    "invoiceId": "INV-2026-001",
    "amount": 25000
  }
}
```

#### Example Response (`201 Created`)
```json
{
  "success": true,
  "message": "Webhook delivery scheduled successfully",
  "id": "333e6543-e89b-12d3-a456-426614174333",
  "eventId": "222e6543-e89b-12d3-a456-426614174222",
  "event_id": "222e6543-e89b-12d3-a456-426614174222",
  "endpointId": "111e6543-e89b-12d3-a456-426614174111",
  "endpoint_id": "111e6543-e89b-12d3-a456-426614174111",
  "endpointUrl": "https://api.partner.example/webhook",
  "endpoint_url": "https://api.partner.example/webhook",
  "seq": 5,
  "state": "SCHEDULED",
  "attemptCount": 0,
  "attempt_count": 0,
  "scheduledAt": "2026-12-01T15:00:00.000Z",
  "scheduled_at": "2026-12-01T15:00:00.000Z",
  "nextAttemptAt": "2026-12-01T15:00:00.000Z",
  "next_attempt_at": "2026-12-01T15:00:00.000Z",
  "createdAt": "2026-11-20T17:30:00.000Z",
  "created_at": "2026-11-20T17:30:00.000Z",
  "updatedAt": "2026-11-20T17:30:00.000Z",
  "updated_at": "2026-11-20T17:30:00.000Z"
}
```

#### Error Responses
- `400 Bad Request`: Scheduled time in the past or invalid ISO date format.
- `400 Bad Request`: Missing `endpointId` or invalid UUID format.
- `400 Bad Request`: Missing both `eventId` and `payload`.
- `401 Unauthorized`: Missing or invalid Bearer API key.
- `404 Not Found`: Endpoint or event does not exist for the authenticated tenant.

---

### 3.2 List Scheduled Deliveries

**Endpoint:** `GET /deliveries/scheduled`  
**Status Code:** `200 OK`

#### Query Parameters
| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | Integer | 1 | 1-based page number |
| `pageSize` | Integer | 20 | Items per page (max 100) |
| `endpointId` / `endpoint_id` | UUID | None | Filter by endpoint ID |
| `eventId` / `event_id` | UUID | None | Filter by event ID |
| `created_after` | ISO date | None | Filter created after timestamp |
| `created_before` | ISO date | None | Filter created before timestamp |
| `q` / `search` | String | None | Search query |

#### Example Response (`200 OK`)
```json
{
  "data": [
    {
      "id": "333e6543-e89b-12d3-a456-426614174333",
      "eventId": "222e6543-e89b-12d3-a456-426614174222",
      "endpointId": "111e6543-e89b-12d3-a456-426614174111",
      "state": "SCHEDULED",
      "scheduledAt": "2026-12-01T15:00:00.000Z",
      "scheduled_at": "2026-12-01T15:00:00.000Z",
      "nextAttemptAt": "2026-12-01T15:00:00.000Z",
      "attemptCount": 0
    }
  ],
  "deliveries": [ ... ],
  "state": "SCHEDULED",
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalRecords": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

---

### 3.3 Retrieve Scheduled Delivery

**Endpoint:** `GET /deliveries/scheduled/:id` (or `GET /deliveries/:id`)  
**Status Code:** `200 OK`

#### Example Response (`200 OK`)
```json
{
  "id": "333e6543-e89b-12d3-a456-426614174333",
  "eventId": "222e6543-e89b-12d3-a456-426614174222",
  "endpointId": "111e6543-e89b-12d3-a456-426614174111",
  "state": "SCHEDULED",
  "scheduledAt": "2026-12-01T15:00:00.000Z",
  "scheduled_at": "2026-12-01T15:00:00.000Z",
  "nextAttemptAt": "2026-12-01T15:00:00.000Z",
  "attemptCount": 0,
  "attempts": []
}
```

---

### 3.4 Cancel Scheduled Delivery

**Endpoint:** `POST /deliveries/:id/cancel` (or `DELETE /deliveries/scheduled/:id`)  
**Status Code:** `200 OK`

Transitions a delivery from `SCHEDULED` (or `PENDING`) to terminal `CANCELLED` state.

#### Example Response (`200 OK`)
```json
{
  "success": true,
  "message": "Scheduled delivery cancelled successfully",
  "id": "333e6543-e89b-12d3-a456-426614174333",
  "state": "CANCELLED",
  "scheduledAt": "2026-12-01T15:00:00.000Z",
  "updatedAt": "2026-11-20T17:35:00.000Z"
}
```

#### Error Responses
- `400 Bad Request`: Delivery is in an uncancellable state (e.g., `SUCCEEDED`, `DEAD`, or already `CANCELLED`).
- `404 Not Found`: Delivery does not exist or belongs to another tenant.

---

### 3.5 Bulk Replay Failed Deliveries

**Endpoint:** `POST /deliveries/bulk-replay` (or `POST /deliveries/replay`)  
**Status Code:** `200 OK`

Replays multiple `DEAD` deliveries in a single request.

#### Request Body
```json
{
  "deliveryIds": [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333"
  ]
}
```

#### Example Response (`200 OK`)
```json
{
  "success": true,
  "message": "Bulk replay completed",
  "total": 3,
  "successful": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "deliveryId": "11111111-1111-1111-1111-111111111111",
      "eventId": "222e6543-e89b-12d3-a456-426614174222",
      "endpointId": "111e6543-e89b-12d3-a456-426614174111",
      "state": "PENDING",
      "attemptCount": 0,
      "nextAttemptAt": "2026-11-20T17:30:00.000Z"
    }
  ],
  "replayed": [ ... ],
  "ineligible": [
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "deliveryId": "22222222-2222-2222-2222-222222222222",
      "state": "SUCCEEDED",
      "reason": "Delivery is in state SUCCEEDED; only DEAD deliveries are eligible for replay"
    }
  ],
  "rejected": [
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "deliveryId": "33333333-3333-3333-3333-333333333333",
      "reason": "Delivery not found or access denied"
    }
  ],
  "summary": {
    "total": 3,
    "successfulCount": 1,
    "replayedCount": 1,
    "ineligibleCount": 1,
    "rejectedCount": 1
  }
}
```

#### Error Responses
- `400 Bad Request`: `deliveryIds` is missing, not an array, empty, or contains invalid UUID strings.
- `401 Unauthorized`: Missing or invalid Bearer API key.

---

## 4. Database Schema & Migration

### Migration `V4__scheduling_and_bulk_replay.sql`
- **Columns Added**: `scheduled_at TIMESTAMPTZ` on `deliveries`.
- **Constraint Updated**: `deliveries_state_check` updated to include `'SCHEDULED'` and `'CANCELLED'`.
- **Performance Indexes**:
  - `idx_deliveries_scheduled`: Partial index on `(next_attempt_at) WHERE state = 'SCHEDULED'` for instant dispatcher discovery.
  - `idx_deliveries_scheduled_lookup`: Composite index on `(endpoint_id, state, scheduled_at)` for tenant-isolated listing.

---

## 5. Running the Backend

### Database Migrations
```bash
npm run db:migrate
```

### Initialize Development Tenant
```bash
npm run tenant:init
```

### Start Server
```bash
# Development mode with nodemon
npm run dev

# Production mode
npm start
```

### Run Tests
```bash
# Run unit and integration test suite
npm test

# Run end-to-end acceptance scenarios
npm run test:e2e
```

