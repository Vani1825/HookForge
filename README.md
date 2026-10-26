# HookForge

Reliable, event-driven webhook delivery platform built with Node.js, Express, and PostgreSQL.

HookForge serves as a robust webhook delivery middleware providing durable queueing, atomic queue claiming, guaranteed per-endpoint sequence ordering, HMAC-SHA256 request signing, exponential backoff with full jitter, circuit breakers, per-endpoint rate limiting, and lease-based worker crash recovery.

---

## Architecture Overview

HookForge utilizes **PostgreSQL as the durable queue**, avoiding external brokers like Kafka, RabbitMQ, or Redis.

```
                           +----------------------+
                           |  Client Application  |
                           +----------+-----------+
                                      |
                      POST /events    | (Bearer <api-key>)
                                      v
                        +-------------+------------+
                        |  Express HTTP API Layer  |
                        +-------------+------------+
                                      |
                           Atomic fan-out & sequence
                                      v
                     +----------------+----------------+
                     |    PostgreSQL Storage & Queue   |
                     |  - events (idempotency key uq)  |
                     |  - endpoints (circuit state)    |
                     |  - deliveries (FOR UPDATE SKIP) |
                     |  - delivery_attempts (audit log)|
                     +----------------+----------------+
                                      ^
               Atomic Claim           |  Status & Lease
            (FOR UPDATE SKIP LOCKED)  |  Management
                                      v
                     +----------------+----------------+
                     |    Asynchronous Dispatcher      |
                     |  - Rate Limiter (Token Bucket)  |
                     |  - Circuit Breaker (Threshold)  |
                     |  - Lease Reaper (Crash Recovery)|
                     +----------------+----------------+
                                      |
                    HTTP POST + HMAC  |
                    X-Webhook-Signature
                                      v
                        +-------------+------------+
                        |    Webhook Receiver      |
                        +--------------------------+
```

### Core Architecture Components

1. **Transactional Ingestion (`EventIngestService`):**
   - Atomically records the event with `(tenant_id, idempotency_key)` uniqueness.
   - Fans out delivery records to all active endpoints registered to the authenticated tenant.
   - Allocates monotonically increasing sequence numbers (`seq`) per endpoint.

2. **Durable Delivery Queue (`JdbcDeliveryRepository`):**
   - PostgreSQL `deliveries` table serves as the queue.
   - Workers claim work using `SELECT ... FOR UPDATE SKIP LOCKED` inside transactions.
   - Enforces per-endpoint FIFO ordering: a delivery is only claimed if no earlier sequence delivery for that endpoint is non-terminal (`PENDING`, `RETRYING`, or `IN_FLIGHT`).
   - Assigns a lease deadline (`lease_until`) to every claimed delivery.

3. **Resilience & Fault Tolerance:**
   - **Exponential Jitter Retry Policy:** `delay = random(0, min(cap, base * 2^(attempts-1)))` with full jitter up to 8 attempts.
   - **Threshold Circuit Breaker:** Trips to `OPEN` after 5 consecutive failures; enters `HALF_OPEN` probe after 1 minute cooldown; resets to `CLOSED` on success. Circuit state is persisted in PostgreSQL on the `endpoints` row.
   - **Token Bucket Rate Limiter:** Per-endpoint rate limiting adhering to configured `rate_limit_rps`.
   - **Lease Reaper:** Background process recovering expired `IN_FLIGHT` leases caused by ungraceful worker termination.

4. **Security & Authentication:**
   - Authenticates tenants via `Authorization: Bearer <api-key>`.
   - Raw API keys are never stored; only SHA-256 hashes are persisted and looked up.
   - Cryptographic signatures generated using HMAC-SHA256 with timestamp in the header `X-Webhook-Signature: t=<unix>,v1=<hex>`.
   - Stable `X-Webhook-Id` header sent with each delivery attempt.

---

## Technology Stack

- **Runtime:** Node.js (>= 20)
- **Framework:** Express 5
- **Database:** PostgreSQL 16 (using `pg` pool and explicit parameterized SQL)
- **Test Suite:** Vitest 3 + Supertest
- **Containerization:** Docker Compose

---

## Key Features Implemented

- [x] Multi-tenant isolation for all routes and operations.
- [x] API Key Bearer authentication (SHA-256 hashed).
- [x] Endpoint management (create, list, update).
- [x] Webhook signing secret generation (`whsec_...`).
- [x] Event ingestion with tenant-scoped idempotency keys.
- [x] Atomic transactional fan-out to active endpoints.
- [x] Monotonic per-endpoint sequence allocation.
- [x] Atomic queue claiming with `FOR UPDATE SKIP LOCKED`.
- [x] Strict per-endpoint FIFO ordering (guaranteed single in-flight per endpoint).
- [x] HMAC-SHA256 signature generation (`X-Webhook-Signature`).
- [x] Stable delivery identifier header (`X-Webhook-Id`).
- [x] Exponential backoff with full jitter and maximum attempt ceiling.
- [x] Response classification (2xx success, 410 dead, 429 rate limited, 5xx/network retry).
- [x] Token bucket rate limiter.
- [x] Three-state circuit breaker (CLOSED, OPEN, HALF_OPEN) with persistence.
- [x] Lease-based crash recovery reaper for orphaned in-flight deliveries.
- [x] Dead-letter queue (DLQ) querying (`GET /deliveries?state=DEAD`).
- [x] Manual replay API (`POST /deliveries/:id/replay`) with attempt count reset.
- [x] Comprehensive delivery attempt history logging.

---

## Prerequisites

- Node.js >= 20.x
- Docker & Docker Compose (or local PostgreSQL 16)

---

## Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Default verified configuration:

```env
# Server
PORT=8081
NODE_ENV=development

# Database (HookForge PostgreSQL container mapped to host port 5434)
DATABASE_HOST=localhost
DATABASE_PORT=5434
DATABASE_USER=webhooks
DATABASE_PASSWORD=webhooks
DATABASE_NAME=webhooks
DATABASE_POOL_MAX=20

# Retry Policy
RETRY_MAX_ATTEMPTS=8
RETRY_BASE_DELAY=5s
RETRY_MAX_DELAY=1h

# Dispatcher
DISPATCHER_POLL_INTERVAL=0.5s
DISPATCHER_BATCH_SIZE=50
DISPATCHER_WORKER_CONCURRENCY=50
DISPATCHER_LEASE_MARGIN=30s
DISPATCHER_REAPER_INTERVAL=15s

# Circuit Breaker
CIRCUIT_FAILURE_THRESHOLD=5
CIRCUIT_OPEN_DURATION=1m

# HTTP
HTTP_CONNECT_TIMEOUT=3s
HTTP_READ_TIMEOUT=10s

# Ingestion
INGEST_MAX_PAYLOAD_BYTES=262144
```

---

## Getting Started

### 1. Start PostgreSQL Service

To avoid conflicts with existing services running on port 5432 or 5433, HookForge maps PostgreSQL to host port `5434`:

```bash
docker compose up -d postgres
```

### 2. Run Database Migrations

Apply the database schema from `migrations/V1__init.sql`:

```bash
npm run db:migrate
```

### 3. Start the HookForge Application

```bash
npm start
```

For development with live reload:

```bash
npm run dev
```

### 4. Health Check

```bash
curl -X GET http://localhost:8081/health
```

Expected response:
```json
{
  "status": "up",
  "timestamp": "2026-10-26T18:30:00.000Z",
  "checks": {
    "database": {
      "status": "up",
      "timestamp": "2026-10-26T18:30:00.000Z"
    }
  }
}
```

---

## Automated Tests

### Unit & Integration Test Suite

Execute the 19 test suites containing 131 tests:

```bash
npm test
```

Current test status:
- **Test Files:** 19 passed (100%)
- **Tests:** 131 passed (100%)

### End-to-End Acceptance Verification

Execute the end-to-end acceptance suite testing all 8 core scenarios against live PostgreSQL and a controlled mock HTTP receiver:

```bash
npm run test:e2e
```

Current E2E status:
- `Test 1: Successful signed delivery` — **PASS**
- `Test 2: Idempotency` — **PASS**
- `Test 3: Ordering` — **PASS**
- `Test 4: Retry` — **PASS**
- `Test 5: Dead-letter replay` — **PASS**
- `Test 6: Lease recovery` — **PASS**
- `Test 7: Circuit breaker` — **PASS**
- `Test 8: Tenant isolation` — **PASS**

---

## API Documentation

All protected endpoints require an `Authorization: Bearer <api-key>` header.

### 1. Register Endpoint
`POST /endpoints`

**Request:**
```bash
curl -X POST http://localhost:8081/endpoints \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/webhook",
    "rateLimitRps": 20
  }'
```

**Response (201 Created):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "url": "https://example.com/webhook",
  "secret": "whsec_abc123...",
  "active": true,
  "rateLimitRps": 20,
  "circuitState": "CLOSED",
  "createdAt": "2026-10-26T18:30:00.000Z"
}
```
*Note: The `secret` is displayed only upon endpoint creation and never returned in listing APIs.*

### 2. List Endpoints
`GET /endpoints`

**Request:**
```bash
curl -X GET http://localhost:8081/endpoints \
  -H "Authorization: Bearer <api-key>"
```

### 3. Update Endpoint
`PATCH /endpoints/:id`

**Request:**
```bash
curl -X PATCH http://localhost:8081/endpoints/123e4567-e89b-12d3-a456-426614174000 \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "rateLimitRps": 50,
    "active": true
  }'
```

### 4. Ingest Event
`POST /events`

**Headers:**
- `Authorization: Bearer <api-key>`
- `Idempotency-Key: <unique-client-key>`
- `Content-Type: application/json`

**Request:**
```bash
curl -X POST http://localhost:8081/events \
  -H "Authorization: Bearer <api-key>" \
  -H "Idempotency-Key: evt_idemp_991823" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "payment.succeeded",
    "customerId": "cust_882",
    "amount": 4900
  }'
```

**Response for New Event (202 Accepted):**
```json
{
  "id": "987e6543-e89b-12d3-a456-426614174999",
  "idempotencyKey": "evt_idemp_991823",
  "createdAt": "2026-10-26T18:30:00.000Z",
  "deliveriesEnqueued": 1
}
```

**Response for Duplicate Event (200 OK):**
```json
{
  "id": "987e6543-e89b-12d3-a456-426614174999",
  "idempotencyKey": "evt_idemp_991823",
  "createdAt": "2026-10-26T18:30:00.000Z",
  "deliveriesEnqueued": 0
}
```

### 5. Get Deliveries for an Event
`GET /events/:id/deliveries`

**Request:**
```bash
curl -X GET http://localhost:8081/events/987e6543-e89b-12d3-a456-426614174999/deliveries \
  -H "Authorization: Bearer <api-key>"
```

### 6. List Dead Deliveries (DLQ)
`GET /deliveries?state=DEAD`

**Request:**
```bash
curl -X GET "http://localhost:8081/deliveries?state=DEAD&limit=50" \
  -H "Authorization: Bearer <api-key>"
```

### 7. Replay Dead Delivery
`POST /deliveries/:id/replay`

**Request:**
```bash
curl -X POST http://localhost:8081/deliveries/123e4567-e89b-12d3-a456-426614174000/replay \
  -H "Authorization: Bearer <api-key>"
```

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "eventId": "987e6543-e89b-12d3-a456-426614174999",
  "endpointId": "456e7890-e89b-12d3-a456-426614174111",
  "seq": 1,
  "state": "PENDING",
  "attemptCount": 0,
  "nextAttemptAt": "2026-10-26T18:31:00.000Z",
  "lastError": null
}
```

---

## Webhook Signature Verification

HookForge attaches the following headers to outgoing webhooks:
- `X-Webhook-Signature`: `t=<unix_timestamp>,v1=<hmac_sha256_hex>`
- `X-Webhook-Timestamp`: `<unix_timestamp>`
- `X-Webhook-Id`: `<stable_delivery_uuid>`

### Receiver Verification Example (Node.js)

```javascript
import crypto from 'crypto';

function verifyWebhook(secret, rawBody, signatureHeader) {
  const match = signatureHeader.match(/^t=(\d+),v1=([a-f0-9]+)$/);
  if (!match) return false;

  const [_, timestamp, signature] = match;
  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}
```

---

## Delivery Guarantees & Honest Limitations

1. **At-Least-Once Delivery:**
   HookForge guarantees at-least-once delivery. Network anomalies, timeouts, and receiver crashes may result in retries even after the receiver processed an attempt. Receivers **must** perform deduplication using the stable `X-Webhook-Id` header.

2. **Head-of-Line Blocking under Strict Ordering:**
   To guarantee strict FIFO sequence order (`seq = 1, 2, 3...`), deliveries to a single endpoint are processed sequentially. If delivery `seq = 1` repeatedly fails or is delayed, subsequent deliveries for that endpoint are blocked until delivery 1 succeeds, times out, or reaches its maximum attempts (`DEAD`).

3. **Replay Breaks Original Sequence Ordering:**
   When a `DEAD` delivery is manually replayed via `POST /deliveries/:id/replay`, it is re-queued into `PENDING` state. Because subsequent events may have already progressed or succeeded, replaying a dead-letter delivery is **not** order-preserving relative to newer events.

4. **Single-Node In-Memory Resilience State:**
   The token-bucket rate limiter currently tracks tokens in single-node memory. While circuit breaker states are persisted to PostgreSQL on the `endpoints` table, high-concurrency multi-node rate limiting is not distributed across separate processes without shared memory or database-level token accounting.

5. **Throughput Bounds:**
   Ingestion and sequence allocation rely on PostgreSQL row-level locks and transactions (`UPDATE endpoints SET next_seq = next_seq + 1`). This provides strict consistency and correctness at the trade-off of vertical database write limits.

6. **SSRF Defensive Scope:**
   Endpoint URLs are validated for protocol (`http`, `https`) and standard URL formatting. Full private network / RFC 1918 egress filtering is documented as an infrastructure-level responsibility (or future proxy enhancement).
