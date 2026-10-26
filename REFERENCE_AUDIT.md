# Reference Audit: WebhookDeliveryPlatform → HookForge

**Reference:** https://github.com/GodXSpell/WebhookDeliveryPlatform  
**Target:** https://github.com/Vani1825/HookForge  
**Status:** Scaffold / TODO implementation (many stubs return 501)

---

## Project Overview

### Technology Stack (Reference)
- **Language:** Java 21
- **Framework:** Spring Boot 3.3.5
- **Database:** PostgreSQL 16 (as the durable queue)
- **Migration:** Flyway
- **Metrics:** Micrometer + Prometheus
- **Concurrency:** Virtual threads (Project Loom)
- **Testing:** JUnit 5, Testcontainers

### Technology Stack (Target)
- **Language:** Node.js
- **Framework:** Express
- **Database:** PostgreSQL 16 (preserved as durable queue)
- **Migration:** node-pg-migrate or similar
- **Metrics:** prom-client or similar
- **Concurrency:** Node.js event loop + worker threads for dispatch

---

## Architecture Principles (Must Preserve)

1. **Interface-based design:** Business logic depends on ports (interfaces), adapters implement them
2. **Immutable domain models:** Records are immutable; changes go through repositories
3. **Injectable time/randomness:** Clock and RandomGenerator injected for testability
4. **PostgreSQL as queue:** The `deliveries` table IS the work queue with FOR UPDATE SKIP LOCKED
5. **Single source of truth:** DeliveryState enum controls all legal transitions
6. **No magic numbers:** All tunables in WebhookProperties (application.yml)
7. **Feature ports:** Each feature owns its interfaces; persistence layer owns adapters

---

## Database Schema (V1__init.sql)

### Tables

#### `tenants`
```sql
- id: UUID (PK, gen_random_uuid())
- name: TEXT (NOT NULL)
- api_key_hash: TEXT (NOT NULL, UNIQUE) -- SHA-256 hex of API key
- created_at: TIMESTAMPTZ (NOT NULL, DEFAULT now())
```

#### `endpoints`
```sql
- id: UUID (PK, gen_random_uuid())
- tenant_id: UUID (FK → tenants, NOT NULL)
- url: TEXT (NOT NULL)
- secret: TEXT (NOT NULL) -- HMAC signing secret (shown once on create)
- active: BOOLEAN (NOT NULL, DEFAULT TRUE)
- rate_limit_rps: INT (NOT NULL, DEFAULT 10, CHECK > 0)
- next_seq: BIGINT (NOT NULL, DEFAULT 1) -- next sequence number for ordering
- circuit_state: TEXT (NOT NULL, DEFAULT 'CLOSED', CHECK IN ('CLOSED','OPEN','HALF_OPEN'))
- circuit_until: TIMESTAMPTZ -- when OPEN circuit may be probed
- consecutive_failures: INT (NOT NULL, DEFAULT 0)
- created_at: TIMESTAMPTZ (NOT NULL, DEFAULT now())
Index: idx_endpoints_tenant (tenant_id)
```

#### `events`
```sql
- id: UUID (PK, gen_random_uuid())
- tenant_id: UUID (FK → tenants, NOT NULL)
- payload: JSONB (NOT NULL)
- idempotency_key: TEXT (NOT NULL)
- created_at: TIMESTAMPTZ (NOT NULL, DEFAULT now())
Constraint: uq_events_idempotency UNIQUE (tenant_id, idempotency_key)
```

#### `deliveries`
```sql
- id: UUID (PK, gen_random_uuid())
- event_id: UUID (FK → events, NOT NULL)
- endpoint_id: UUID (FK → endpoints, NOT NULL)
- seq: BIGINT (NOT NULL)
- state: TEXT (NOT NULL, DEFAULT 'PENDING', CHECK IN ('PENDING','IN_FLIGHT','RETRYING','SUCCEEDED','DEAD'))
- attempt_count: INT (NOT NULL, DEFAULT 0)
- next_attempt_at: TIMESTAMPTZ (NOT NULL, DEFAULT now())
- lease_until: TIMESTAMPTZ -- worker lease
- last_error: TEXT
- created_at: TIMESTAMPTZ (NOT NULL, DEFAULT now())
- updated_at: TIMESTAMPTZ (NOT NULL, DEFAULT now())
Constraint: uq_deliveries_endpoint_seq UNIQUE (endpoint_id, seq)
Constraint: uq_deliveries_event_endpoint UNIQUE (event_id, endpoint_id)
Index: idx_deliveries_due (next_attempt_at) WHERE state IN ('PENDING','RETRYING')
Index: idx_deliveries_endpoint_open (endpoint_id, seq) WHERE state IN ('PENDING','RETRYING','IN_FLIGHT')
Index: idx_deliveries_lease (lease_until) WHERE state = 'IN_FLIGHT'
Index: idx_deliveries_state (state)
Index: idx_deliveries_event (event_id)
```

#### `delivery_attempts`
```sql
- id: BIGSERIAL (PK)
- delivery_id: UUID (FK → deliveries, NOT NULL)
- attempt_no: INT (NOT NULL)
- started_at: TIMESTAMPTZ (NOT NULL)
- status_code: INT -- NULL on connect error/timeout
- latency_ms: BIGINT (NOT NULL)
- error: TEXT
Index: idx_attempts_delivery (delivery_id, attempt_no)
```

---

## API Routes

### Authentication
- **Header:** `Authorization: Bearer <api-key>`
- **Implementation:** ApiKeyAuthFilter (currently lets everything through - TODO)
- **Tenant resolution:** Sets `TenantAttributes.TENANT_ID` as request attribute
- **Hash:** SHA-256 hex of API key stored in database

### Endpoints

#### POST `/endpoints`
- **Purpose:** Register an endpoint
- **Request Body:**
  ```json
  {
    "url": "https://example.com/webhook",
    "rateLimitRps": 10  // optional, defaults to 10
  }
  ```
- **Response (201):**
  ```json
  {
    "id": "uuid",
    "url": "https://example.com/webhook",
    "secret": "whsec_...",  // shown only once
    "active": true,
    "rateLimitRps": 10,
    "circuitState": "CLOSED",
    "createdAt": "2024-01-01T00:00:00Z"
  }
  ```
- **Implementation:** EndpointController.create → EndpointService.create → JdbcEndpointRepository.insert

#### GET `/endpoints`
- **Purpose:** List all endpoints for tenant
- **Response (200):** Array of endpoint objects (without secret)
- **Implementation:** EndpointController.list → EndpointService.list → JdbcEndpointRepository.findAllByTenant

#### PATCH `/endpoints/{id}`
- **Purpose:** Update endpoint (url, rateLimitRps, active)
- **Request Body:**
  ```json
  {
    "url": "https://example.com/new-url",  // optional
    "active": false,  // optional
    "rateLimitRps": 20  // optional
  }
  ```
- **Response (200):** Updated endpoint object (without secret)
- **Implementation:** EndpointController.update → EndpointService.update → JdbcEndpointRepository.update

#### POST `/events`
- **Purpose:** Ingest an event, fan out to active endpoints
- **Headers:**
  - `Idempotency-Key: <unique-key>` (required)
  - `Content-Type: application/json`
- **Request Body:** Raw JSON (stored as-is, signed as-is, delivered as-is)
- **Response (202):** New event accepted
  ```json
  {
    "id": "uuid",
    "idempotencyKey": "key",
    "createdAt": "2024-01-01T00:00:00Z",
    "deliveriesEnqueued": 5
  }
  ```
- **Response (200):** Idempotent replay (duplicate idempotency key)
  ```json
  {
    "id": "uuid",
    "idempotencyKey": "key",
    "createdAt": "2024-01-01T00:00:00Z",
    "deliveriesEnqueued": 0
  }
  ```
- **Implementation:** EventController.create → EventIngestService.ingest (single transaction)
- **Constraints:** Max payload 256KB

#### GET `/events/{id}/deliveries`
- **Purpose:** Get delivery status for a specific event
- **Response (200):** Array of delivery objects
  ```json
  [
    {
      "id": "uuid",
      "endpointId": "uuid",
      "seq": 1,
      "state": "SUCCEEDED",
      "attemptCount": 1,
      "lastError": null,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
  ```
- **Implementation:** DeliveryController.byEvent → DeliveryQueries.findByEvent

#### GET `/deliveries?state=DEAD&limit=50`
- **Purpose:** Inspect dead-letter queue
- **Query Params:**
  - `state`: DeliveryState enum value (required)
  - `limit`: 1-200 (default 50)
- **Response (200):** Array of delivery objects
- **Implementation:** DeliveryController.byState → DeliveryQueries.findByState

#### POST `/deliveries/{id}/replay`
- **Purpose:** Requeue a DEAD delivery
- **Response (202):** Requeued delivery object
- **Implementation:** DeliveryController.replay → ReplayService.replay (TODO)
- **Note:** NOT order-preserving relative to newer deliveries

#### GET `/actuator/prometheus`
- **Purpose:** Prometheus metrics
- **Implementation:** Spring Actuator + Micrometer

---

## Domain Models

### DeliveryState Enum
**Transitions:**
```
PENDING --claim--> IN_FLIGHT --2xx--------------> SUCCEEDED
                       |  \--retryable failure--> RETRYING --claim--> IN_FLIGHT
                       |  \--exhausted/permanent-> DEAD --manual replay--> PENDING
                       \--lease expired (reaper)-> RETRYING
```

**Legal transitions (ALLOWED map):**
- PENDING → IN_FLIGHT
- IN_FLIGHT → SUCCEEDED, RETRYING, DEAD
- RETRYING → IN_FLIGHT
- DEAD → PENDING (manual replay only)
- SUCCEEDED → (none)

**Properties:**
- `isTerminal()`: SUCCEEDED, DEAD
- `isOpen()`: PENDING, RETRYING, IN_FLIGHT (blocks later sequence numbers)

### DeliveryOutcome Enum
- **SUCCESS:** 2xx → mark SUCCEEDED
- **RETRY:** 5xx, timeout, connection error → retry with backoff, counts toward circuit breaker
- **RATE_LIMITED:** 429 → retry, honor Retry-After header
- **RETRY_LIMITED:** Other 4xx, 3xx → limited retries (3 attempts max)
- **ENDPOINT_GONE:** 410 Gone → deactivate endpoint, mark DEAD

### CircuitState Enum
- **CLOSED:** Normal operation
- **OPEN:** Circuit broken, block deliveries until circuit_until
- **HALF_OPEN:** Probe state, allow one delivery to test recovery

### Domain Records
- **Tenant:** id, name
- **Endpoint:** id, tenantId, url, secret, active, rateLimitRps, nextSeq, circuitState, circuitUntil, consecutiveFailures
- **Event:** id, tenantId, payloadJson, idempotencyKey, createdAt
- **Delivery:** id, eventId, endpointId, seq, state, attemptCount, nextAttemptAt, leaseUntil, lastError
- **DeliveryAttempt:** deliveryId, attemptNo, startedAt, statusCode, latencyMs, error

---

## Configuration (WebhookProperties)

### Retry
- `maxAttempts`: 8 (default)
- `baseDelay`: PT5S (5 seconds)
- `maxDelay`: PT1H (1 hour)

### Dispatcher
- `pollInterval`: PT0.5S (500ms)
- `batchSize`: 50
- `workerConcurrency`: 50
- `leaseMargin`: PT30S (30 seconds)
- `reaperInterval`: PT15S (15 seconds)

### Circuit
- `failureThreshold`: 5
- `openDuration`: PT1M (1 minute)

### HTTP
- `connectTimeout`: PT3S (3 seconds)
- `readTimeout`: PT10S (10 seconds)

---

## Webhook Signature Format

**Header:** `X-Webhook-Signature: t=<unix>,v1=hex(HMAC_SHA256(secret, "<t>.<body>"))`

**Algorithm:**
1. Create signed payload: `"<timestamp>.<body>"`
2. Compute HMAC-SHA256 using secret
3. Format as: `t=<timestamp>,v1=<hex>`

**Implementation:** HmacSha256Signer (implemented in reference)

**Verification (Mock Receiver):**
- If WEBHOOK_SECRET env var set, verify signature
- Compute: `hmac.new(SECRET.encode(), f"{t}.{body}".encode(), hashlib.sha256).hexdigest()`
- Compare using constant-time comparison

---

## Resilience Policies

### Exponential Jitter Retry Policy
**Formula:** `delay = random(0, min(cap, base * 2^(attempts-1)))`

**Rules:**
- Non-retryable outcomes (SUCCESS, ENDPOINT_GONE): return empty
- RETRY_LIMITED outcomes: max 3 attempts
- All other retryable outcomes: use config.maxAttempts (8)
- Cap exponent at 30 to avoid overflow
- Full jitter: uniform random in [0, ceiling]

**Implementation:** ExponentialJitterRetryPolicy (implemented in reference)

### Token Bucket Rate Limiter
**Per-endpoint in-memory bucket (single-node limitation)**

**Design:**
- Bucket holds (tokens, lastRefillNanos)
- Capacity = permitsPerSecond (allows 1s burst)
- Refill on each call: `tokens = min(capacity, tokens + elapsedSeconds * permitsPerSecond)`
- Use computeIfAbsent for bucket, synchronize on bucket
- Handle rate changes gracefully

**Implementation:** TokenBucketRateLimiter (TODO in reference)

### Threshold Circuit Breaker
**Rules:**
- Opens after `failureThreshold` consecutive failures
- Stays open for `openDuration`
- Probes after `circuitUntil` (HALF_OPEN behavior)
- Success: reset to CLOSED, failures = 0
- Failure: increment failures, if HALF_OPEN or failures >= threshold → OPEN

**Implementation:** ThresholdCircuitBreaker (TODO in reference)

---

## Delivery Claiming (Critical Algorithm)

**Port:** DeliveryClaimer.claim(limit, now, leaseFor)

**Contract:**
1. Returned deliveries moved to IN_FLIGHT with `lease_until = now + leaseFor` in same transaction
2. At most ONE delivery per endpoint (lowest-seq open delivery)
3. Inactive endpoints or OPEN circuits (not yet due for probe) excluded
4. Never more than `limit` items
5. Never blocks on locked rows (SKIP LOCKED)

**SQL Sketch:**
```sql
SELECT d.* FROM deliveries d
JOIN endpoints e ON e.id = d.endpoint_id
WHERE d.state IN ('PENDING','RETRYING')
  AND d.next_attempt_at <= :now
  AND e.active
  AND (e.circuit_state <> 'OPEN' OR e.circuit_until <= :now)
  AND NOT EXISTS (SELECT 1 FROM deliveries p
                  WHERE p.endpoint_id = d.endpoint_id AND p.seq < d.seq
                    AND p.state IN ('PENDING','RETRYING','IN_FLIGHT'))
ORDER BY d.next_attempt_at
LIMIT :limit
FOR UPDATE OF d SKIP LOCKED
```

Then UPDATE selected rows to IN_FLIGHT with lease_until, and load endpoint + event payload.

**Implementation:** JdbcDeliveryRepository.claim (TODO in reference)

---

## Dispatch Architecture

**Dispatcher:**
- Polls at `pollInterval` (500ms)
- Claims up to `batchSize` deliveries (or free worker slots)
- Hands each to a worker on a virtual thread
- Concurrency bounded by Semaphore with `workerConcurrency` slots
- Logs errors, never lets exceptions escape

**DeliveryWorker:**
- Processes a ClaimedDelivery
- Attempts delivery via AttemptExecutor
- Handles outcome via OutcomeHandler
- Releases worker slot in finally block

**LeaseReaper:**
- Runs at `reaperInterval` (15s)
- Resets expired IN_FLIGHT leases to RETRYING
- Allows recovery from crashed workers

**Implementation:**
- Dispatcher: TODO (scheduling wired, implementation missing)
- DeliveryWorker: TODO
- LeaseReaper: TODO

---

## Ingest Flow

**EventIngestService.ingest(tenantId, idempotencyKey, payloadJson):**

1. Size cap (256KB) - reject before DB
2. Try insert event with `ON CONFLICT DO NOTHING`
3. If conflict (duplicate idempotency key):
   - Find existing event by idempotency key
   - Return IngestResult with duplicate=true, deliveriesEnqueued=0
4. If inserted:
   - Find all active endpoints for tenant (ORDER BY id for stable lock order)
   - For each endpoint (stable order):
     - Allocate sequence number via SequenceAllocator.allocate
     - Enqueue delivery via DeliveryEnqueuer.enqueue
   - Return IngestResult with duplicate=false, deliveriesEnqueued=count

**Single transaction** - either event and all deliveries exist, or nothing does.

**Implementation:** EventIngestService (implemented in reference)

---

## Sequence Allocation

**SequenceAllocator.allocate(endpointId):**
```sql
UPDATE endpoints
SET next_seq = next_seq + 1
WHERE id = :id
RETURNING next_seq - 1
```

- Atomically increments and returns value BEFORE increment
- Row lock serializes concurrent ingests for this endpoint
- Must run inside ingest transaction (rollback rolls back seq)

**Implementation:** JdbcEndpointRepository (as SequenceAllocator) - implemented

---

## Mock Receiver

**Purpose:** Test chaos scenarios and verify signatures

**Controls:**
- `POST /_mode/ok` - always 200
- `POST /_mode/500` - always 500
- `POST /_mode/429` - always 429 with Retry-After: 2
- `POST /_mode/timeout` - hang for 30s
- `POST /_mode/fail:N` - fail next N requests with 500, then ok
- `POST /_reset` - clear state

**Inspect:**
- `GET /_received` - every delivery seen, in arrival order

**Signature Verification:**
- If WEBHOOK_SECRET set, verify X-Webhook-Signature header
- Format: `t=<unix>,v1=hex(HMAC_SHA256(secret, f"{t}.{body}"))`

**Implementation:** Python 3.12, ThreadingHTTPServer (fully implemented)

---

## Test Coverage

### Unit Tests
- **DeliveryStateTest:** Implemented ✓
  - Legal transitions
  - Succeeded is final
  - Cannot skip InFlight
  - Require transition throws on illegal move
  - Open states block later sequence numbers

- **ExponentialJitterRetryPolicyTest:** TODO (stub)
  - Delay never negative, never exceeds ceiling
  - Ceiling grows exponentially until maxDelay
  - Returns empty once attempts exhausted
  - Limited retry outcome has smaller budget
  - Endpoint gone and success never retry
  - Huge attempt count does not overflow

### Integration Tests
- **DeliveryGuaranteesIT:** TODO (stub with @Disabled)
  1. Happy path preserves per-endpoint order
  2. Retries then succeed without breaking order
  3. Crashed worker recovered by lease expiry
  4. Circuit breaker opens and recovers
  5. Exhausted delivery goes to DLQ and can be replayed
  6. Bonus: concurrent dispatchers never double-claim

---

## Implementation Status (Reference)

### Fully Implemented
- ✓ Database schema (V1__init.sql)
- ✓ Domain models (records, enums)
- ✓ DeliveryState enum with transition logic
- ✓ JdbcTenantRepository
- ✓ JdbcEndpointRepository (EndpointRepository, SequenceAllocator, EndpointHealthStore ports)
- ✓ JdbcEventRepository
- ✓ HmacSha256Signer
- ✓ DefaultResponseClassifier
- ✓ ExponentialJitterRetryPolicy
- ✓ EndpointService (create, list, update)
- ✓ EventIngestService (ingest with idempotency)
- ✓ ApiKeyAuthFilter (skeleton - lets everything through)
- ✓ Controllers (thin HTTP layer)
- ✓ Mock receiver (Python)
- ✓ Docker Compose setup
- ✓ WebhookProperties config
- ✓ CoreBeansConfig (Clock, RandomGenerator, ExecutorService)
- ✓ DeliveryStateTest unit test

### TODO / Stubbed (return 501 or throw UnsupportedOperationException)
- ✗ JdbcDeliveryRepository (all 7 methods: claim, resetExpiredLeases, recordSuccess, recordRetry, recordDead, releaseWithoutAttempt, enqueue, queries, requeueDead)
- ✗ Dispatcher.poll (scheduling wired, implementation missing)
- ✗ DeliveryWorker
- ✗ OutcomeHandler
- ✗ AttemptExecutor
- ✗ JdkWebhookSender
- ✗ TokenBucketRateLimiter
- ✗ ThresholdCircuitBreaker
- ✗ ReplayService.replay
- ✗ LeaseReaper
- ✗ ExponentialJitterRetryPolicyTest
- ✗ DeliveryGuaranteesIT

### Configured but not wired
- ✗ DeliveryMetrics (Micrometer)
- ✗ GlobalExceptionHandler (error handling)

---

## Known Limitations (Documented in Reference)

1. **Single node:** Rate limiter is in-memory; multi-node would need shared limiter
2. **Head-of-line blocking:** Failing event delays later events to same endpoint until it succeeds or goes DEAD
3. **Ingest serialization:** Sequence allocation takes row lock per endpoint
4. **Replay not order-preserving:** Replaying DEAD delivery is NOT order-preserving relative to newer deliveries
5. **No event-type filtering, secret rotation, batch ingest, or UI** (out of MVP scope)
6. **SSRF guard skipped:** For Docker Compose demos with mock-receiver on private subnet

---

## Build Order (From Reference README)

1. ApiKeyAuthFilter, JdbcTenantRepository, endpoint CRUD (EndpointService, JdbcEndpointRepository)
2. Ingest: JdbcEventRepository, SequenceAllocator, DeliveryEnqueuer, EventIngestService
3. HmacSha256Signer, JdkWebhookSender, AttemptExecutor: one synchronous delivery to mock receiver
4. JdbcDeliveryRepository.claim, Dispatcher, DeliveryWorker, OutcomeHandler (virtual-thread workers)
5. DefaultResponseClassifier, ExponentialJitterRetryPolicy, DLQ state, LeaseReaper
6. TokenBucketRateLimiter, ThresholdCircuitBreaker
7. Replay + status APIs
8. Load test, metrics review, README numbers

---

## Definition of Done (From Reference)

- Passing DeliveryGuaranteesIT (5 scenarios + concurrent-dispatcher test)
- Unit tests for retry/limiter/breaker/signer/classifier
- Load-test result recorded:
  - Sustained events/sec: TBD
  - p95 delivery latency: TBD
  - Events lost under injected failures: TBD (target: 0)

---

## Key Invariants to Preserve

1. **Idempotency:** Same (tenant, idempotency_key) = same event, no duplicate deliveries
2. **Ordering:** Deliveries to one endpoint attempted in seq order (concurrency cap 1)
3. **Stable X-Webhook-Id:** Same delivery ID across retries
4. **Atomic fan-out:** Event and all its deliveries created in one transaction or none
5. **Lease-based claiming:** IN_FLIGHT deliveries have lease_until; expired leases recovered by reaper
6. **Circuit breaker persistence:** Circuit state stored on endpoint row (survives restarts)
7. **Signature consistency:** Signature computed over exact bytes delivered (no re-serialization)
8. **Terminal states:** SUCCEEDED and DEAD never transition automatically (DEAD only via replay)
