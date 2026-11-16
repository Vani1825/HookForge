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

## Getting Started (Local Setup & PowerShell Commands)

### 1. Start Docker Desktop and HookForge Services

To avoid conflicts with existing services running on default PostgreSQL ports (5432 or 5433), HookForge maps PostgreSQL to host port `5434` and the Express backend to host port `8081`:

```powershell
# Start HookForge PostgreSQL and Backend containers
docker compose up -d
```

Verify the containers are healthy and running:
```powershell
docker ps --filter "name=hookforge"
```

### 2. Install Dependencies

Install root and workspace dependencies:

```powershell
# Root monorepo
npm install

# Backend dependencies
npm install --prefix backend

# Frontend dependencies
npm install --prefix frontend
```

### 3. Run Database Migrations

Apply the database schema from `backend/migrations/V1__init.sql` to your local PostgreSQL instance:

```powershell
npm run db:migrate
```

### 4. Initialize a Local Development Tenant

Generate your own cryptographically secure development API key and register a local tenant in PostgreSQL:

```powershell
npm run tenant:init
```

Output:
```text
=============================================================================
           HookForge Development Tenant Initialized Successfully
=============================================================================
Tenant Name:  Default Dev Tenant
Tenant ID:    <generated-uuid>
Created At:   ...
-----------------------------------------------------------------------------
Development API Key:  whkey_<48-character-random-hex>
-----------------------------------------------------------------------------
IMPORTANT:
1. Copy and save this API key now. HookForge stores only the SHA-256 hash
   in PostgreSQL and cannot recover the plaintext key later.
2. This key was NOT written to any file or committed to source control.
```

> **Security & Idempotency Notes:**
> - The command generates a cryptographically random 192-bit key (`whkey_...`).
> - Only the SHA-256 hash is persisted into `tenants.api_key_hash`.
> - The script refuses to run if `NODE_ENV=production`.
> - If run again, existing tenant data is preserved without creating accidental duplicate tenants.

### 5. Configure the Development API Key in Frontend Settings

1. Open HookForge in your browser at [http://localhost:5173](http://localhost:5173).
2. Click **Settings** (or Platform Settings) in the sidebar.
3. Under **Backend API Configuration**:
   - **Backend Base URL:** `http://localhost:8081`
   - **Tenant API Key (X-Api-Key):** `<paste your generated whkey_... key>`
4. Click **Save API Preferences**.
5. Click **Test Health** to confirm the `200 OK` connection to `/health`.
6. Under **Environment Operation Mode**, click **Live API Mode**.
7. Navigate to the **Dashboard** — your live metrics, endpoints, and deliveries will load immediately without authentication errors.

### 6. Start the Frontend Development Server

If not already running:

```powershell
npm run dev:frontend
# Or: cd frontend; npm run dev
```

Visit [http://localhost:5173](http://localhost:5173) in your browser.

### 7. Verify Authentication & Submit a Test Event (PowerShell)

You can verify the complete pipeline using PowerShell:

```powershell
# Set your development key in PowerShell session
$API_KEY = "whkey_<your-generated-key>"

# 1. Check Backend Health (public route)
curl.exe -s http://localhost:8081/health

# 2. Verify Authentication (protected route returns empty array or registered endpoints)
curl.exe -s -H "Authorization: Bearer $API_KEY" http://localhost:8081/endpoints

# 3. Register a Webhook Endpoint
curl.exe -s -X POST http://localhost:8081/endpoints `
  -H "Authorization: Bearer $API_KEY" `
  -H "Content-Type: application/json" `
  -d '{\"url\":\"http://host.docker.internal:9000/hook\",\"rateLimitRps\":20}'

# 4. Ingest an Event with an Idempotency Key
curl.exe -s -X POST http://localhost:8081/events `
  -H "Authorization: Bearer $API_KEY" `
  -H "Idempotency-Key: evt_ps_test_001" `
  -H "Content-Type: application/json" `
  -d '{\"event\":\"order.completed\",\"orderId\":\"ord_9901\",\"amount\":4999}'

# 5. Retrieve Deliveries Status
curl.exe -s "http://localhost:8081/deliveries?state=ALL" `
  -H "Authorization: Bearer $API_KEY"
```

---

## Troubleshooting Guide

### 1. `401 Unauthorized` / "Backend Connection Failed — Unauthorized"

| Symptom | Cause | Solution |
|---|---|---|
| `{"error":"Unauthorized","message":"Missing Authorization header"}` | The client did not send an `Authorization` header. | In the frontend Settings page, paste your API key and click **Save API Preferences**. Ensure `Authorization: Bearer <key>` is sent. |
| `{"error":"Unauthorized","message":"Invalid API key"}` | The API key sent does not match any tenant in PostgreSQL (`SELECT id FROM tenants WHERE api_key_hash = SHA256(key)`). | Run `npm run tenant:init` to create a dev tenant. Copy the generated `whkey_...` key and paste it into Settings. |
| `{"error":"Unauthorized","message":"Authorization header must use Bearer scheme"}` | The header scheme is not `Bearer <key>` (e.g., `Basic` or missing prefix). | Provide the header in format: `Authorization: Bearer whkey_...`. |
| Dashboard shows "Backend Connection Failed — Unauthorized" | Frontend is in **Live API Mode** but `localStorage` or `VITE_API_KEY` is empty or invalid. | Go to `http://localhost:5173/settings`, enter your development API key, click **Save API Preferences**, and reload Dashboard. |

### 2. Database Connection Failures (`ECONNREFUSED` / Database Down)

- **Port Mapping:** HookForge's PostgreSQL container binds to host port `5434` (mapped to container `5432`). Ensure `.env` and `backend/.env` have `DATABASE_PORT=5434`.
- **Existing Postgres Instances:** If port 5432 or 5433 is in use by another local PostgreSQL or Docker project, HookForge avoids them by using `5434`. Do NOT change `DATABASE_PORT` to 5432 unless you are certain your HookForge container is mapped to 5432.
- **Restart Container:** Run `docker compose restart postgres` and verify status with `docker compose ps`.

### 3. Port Conflicts

- **Port 8081 (Backend):** HookForge Express server is exposed on host port `8081`. If another service occupies 8081, update the host port in `docker-compose.yml` (`"8082:8080"`) and update `VITE_API_BASE_URL` in `frontend/.env`.
- **Port 5173 (Frontend):** Vite runs on `5173`. If occupied, Vite automatically chooses `5174`. Check terminal output when running `npm run dev:frontend`.
- **Webhook Target URLs:** When running HookForge in Docker, `http://localhost:<port>` from within the backend container refers to the container itself. Use `http://host.docker.internal:<port>` to reach services running on the host machine.

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
