# Java-to-Node.js Module Mapping

**Reference:** GodXSpell/WebhookDeliveryPlatform (Java)  
**Target:** Vani1825/HookForge (Node.js + Express)

---

## Project Structure

### Reference (Java)
```
src/main/java/io/webhookplatform/
├── WebhookPlatformApplication.java
├── config/
├── delivery/
├── dispatch/
├── dlq/
├── domain/
├── endpoint/
├── ingest/
├── observability/
├── persistence/
├── resilience/
└── tenant/
```

### Target (Node.js)
```
src/
├── app.js                    # Express app setup
├── server.js                 # Server entry point
├── config/
│   ├── index.js              # Config loader (env + defaults)
│   ├── database.js           # PostgreSQL connection
│   └── constants.js          # Magic constants
├── domain/
│   ├── deliveryState.js      # DeliveryState enum
│   ├── deliveryOutcome.js    # DeliveryOutcome enum
│   ├── circuitState.js       # CircuitState enum
│   └── models/               # Domain models (POJOs)
│       ├── tenant.js
│       ├── endpoint.js
│       ├── event.js
│       ├── delivery.js
│       └── deliveryAttempt.js
├── middleware/
│   ├── auth.js               # ApiKeyAuthFilter equivalent
│   ├── errorHandler.js       # GlobalExceptionHandler equivalent
│   └── validation.js         # Request validation
├── routes/
│   ├── endpoints.js          # EndpointController
│   ├── events.js             # EventController
│   └── deliveries.js         # DeliveryController
├── services/
│   ├── endpoint/
│   │   ├── endpointService.js     # EndpointService
│   │   └── sequenceAllocator.js   # SequenceAllocator port
│   ├── ingest/
│   │   ├── eventIngestService.js  # EventIngestService
│   │   ├── deliveryEnqueuer.js     # DeliveryEnqueuer port
│   │   └── eventRepository.js      # EventRepository port
│   ├── delivery/
│   │   ├── deliveryWorker.js      # DeliveryWorker
│   │   ├── attemptExecutor.js     # AttemptExecutor
│   │   ├── outcomeHandler.js      # OutcomeHandler
│   │   ├── deliveryQueries.js     # DeliveryQueries port
│   │   ├── deliveryRecorder.js    # DeliveryOutcomeRecorder port
│   │   ├── webhookSender.js       # WebhookSender
│   │   ├── signer.js              # Signer port
│   │   └── hmacSha256Signer.js    # HmacSha256Signer
│   ├── dispatch/
│   │   ├── dispatcher.js          # Dispatcher
│   │   ├── deliveryClaimer.js     # DeliveryClaimer port
│   │   └── leaseReaper.js         # LeaseReaper
│   ├── resilience/
│   │   ├── retryPolicy.js         # RetryPolicy port
│   │   ├── exponentialJitterRetryPolicy.js  # ExponentialJitterRetryPolicy
│   │   ├── rateLimiter.js         # RateLimiter port
│   │   ├── tokenBucketRateLimiter.js       # TokenBucketRateLimiter
│   │   ├── circuitBreaker.js      # CircuitBreaker port
│   │   ├── thresholdCircuitBreaker.js      # ThresholdCircuitBreaker
│   │   └── endpointHealthStore.js # EndpointHealthStore port
│   ├── dlq/
│   │   ├── replayService.js       # ReplayService
│   │   └── deadLetterStore.js     # DeadLetterStore port
│   └── tenant/
│       └── tenantRepository.js    # TenantRepository port
├── repositories/
│   ├── jdbc/
│   │   ├── endpointRepository.js  # JdbcEndpointRepository (3 ports)
│   │   ├── eventRepository.js     # JdbcEventRepository
│   │   ├── deliveryRepository.js  # JdbcDeliveryRepository (7 ports)
│   │   └── tenantRepository.js    # JdbcTenantRepository
│   └── baseRepository.js          # Base repository with pg client
├── utils/
│   ├── clock.js               # Clock abstraction
│   ├── random.js              # RandomGenerator abstraction
│   └── idGenerator.js         # UUID generation
├── observability/
│   └── metrics.js             # DeliveryMetrics (prom-client)
└── migrations/
    └── V1__init.sql           # Same as reference
```

---

## Detailed Class-to-Module Mapping

### Config Layer

| Java Class | Node.js Module | Notes |
|------------|----------------|-------|
| `WebhookPlatformApplication.java` | `src/app.js`, `src/server.js` | Express app setup and server startup |
| `config/WebhookProperties.java` | `src/config/index.js` | Load from env + defaults, validate |
| `config/CoreBeansConfig.java` | `src/utils/clock.js`, `src/utils/random.js` | Clock and RandomGenerator abstractions |
| `config/ApiError.java` | `src/middleware/errorHandler.js` | Error response format |
| `config/GlobalExceptionHandler.java` | `src/middleware/errorHandler.js` | Central error handling |

### Domain Layer

| Java Class | Node.js Module | Notes |
|------------|----------------|-------|
| `domain/DeliveryState.java` | `src/domain/deliveryState.js` | Enum with transition logic |
| `domain/DeliveryOutcome.java` | `src/domain/deliveryOutcome.js` | Enum |
| `domain/CircuitState.java` | `src/domain/circuitState.js` | Enum |
| `domain/Tenant.java` | `src/domain/models/tenant.js` | POJO class/factory |
| `domain/Endpoint.java` | `src/domain/models/endpoint.js` | POJO class/factory |
| `domain/Event.java` | `src/domain/models/event.js` | POJO class/factory |
| `domain/Delivery.java` | `src/domain/models/delivery.js` | POJO class/factory |
| `domain/DeliveryAttempt.java` | `src/domain/models/deliveryAttempt.js` | POJO class/factory |
| `domain/NotFoundException.java` | `src/domain/errors/notFoundError.js` | Custom error class |
| `domain/IllegalStateTransitionException.java` | `src/domain/errors/illegalStateTransitionError.js` | Custom error class |

### Tenant Layer

| Java Class | Node.js Module | Notes |
|------------|----------------|-------|
| `tenant/TenantRepository.java` (interface) | `src/services/tenant/tenantRepository.js` (interface) | Port |
| `tenant/TenantAttributes.java` | `src/middleware/auth.js` | Request attribute constant |
| `tenant/ApiKeyAuthFilter.java` | `src/middleware/auth.js` | Express middleware |
| `persistence/JdbcTenantRepository.java` | `src/repositories/jdbc/tenantRepository.js` | Adapter |

### Endpoint Layer

| Java Class | Node.js Module | Notes |
|------------|----------------|-------|
| `endpoint/EndpointController.java` | `src/routes/endpoints.js` | Express router |
| `endpoint/EndpointService.java` | `src/services/endpoint/endpointService.js` | Business logic |
| `endpoint/EndpointRepository.java` (interface) | `src/services/endpoint/endpointRepository.js` (interface) | Port |
| `endpoint/SequenceAllocator.java` (interface) | `src/services/endpoint/sequenceAllocator.js` (interface) | Port |
| `endpoint/CreateEndpointRequest.java` | `src/routes/endpoints.js` (validation schema) | Request DTO |
| `endpoint/UpdateEndpointRequest.java` | `src/routes/endpoints.js` (validation schema) | Request DTO |
| `endpoint/EndpointResponse.java` | `src/routes/endpoints.js` (response mapper) | Response DTO |
| `persistence/JdbcEndpointRepository.java` | `src/repositories/jdbc/endpointRepository.js` | Adapter (implements 3 ports) |

### Ingest Layer

| Java Class | Node.js Module | Notes |
|------------|----------------|-------|
| `ingest/EventController.java` | `src/routes/events.js` | Express router |
| `ingest/EventIngestService.java` | `src/services/ingest/eventIngestService.js` | Business logic |
| `ingest/EventRepository.java` (interface) | `src/services/ingest/eventRepository.js` (interface) | Port |
| `ingest/DeliveryEnqueuer.java` (interface) | `src/services/ingest/deliveryEnqueuer.js` (interface) | Port |
| `ingest/IngestResult.java` | `src/services/ingest/ingestResult.js` | Return type |
| `ingest/EventResponse.java` | `src/routes/events.js` (response mapper) | Response DTO |
| `persistence/JdbcEventRepository.java` | `src/repositories/jdbc/eventRepository.js` | Adapter |

### Delivery Layer

| Java Class | Node.js Module | Notes |
|------------|----------------|-------|
| `delivery/DeliveryController.java` | `src/routes/deliveries.js` | Express router |
| `delivery/DeliveryWorker.java` | `src/services/delivery/deliveryWorker.js` | Worker logic |
| `delivery/AttemptExecutor.java` | `src/services/delivery/attemptExecutor.js` | Execute single attempt |
| `delivery/OutcomeHandler.java` | `src/services/delivery/outcomeHandler.js` | Decide next state |
| `delivery/DeliveryQueries.java` (interface) | `src/services/delivery/deliveryQueries.js` (interface) | Port |
| `delivery/DeliveryOutcomeRecorder.java` (interface) | `src/services/delivery/deliveryRecorder.js` (interface) | Port |
| `delivery/DeliveryResponse.java` | `src/routes/deliveries.js` (response mapper) | Response DTO |
| `delivery/Signer.java` (interface) | `src/services/delivery/signer.js` (interface) | Port |
| `delivery/HmacSha256Signer.java` | `src/services/delivery/hmacSha256Signer.js` | Implementation |
| `delivery/WebhookSender.java` (interface) | `src/services/delivery/webhookSender.js` (interface) | Port |
| `delivery/JdkWebhookSender.java` | `src/services/delivery/httpWebhookSender.js` | Implementation (node-fetch/axios) |
| `delivery/ResponseClassifier.java` (interface) | `src/services/delivery/responseClassifier.js` (interface) | Port |
| `delivery/DefaultResponseClassifier.java` | `src/services/delivery/defaultResponseClassifier.js` | Implementation |
| `delivery/WebhookRequest.java` | `src/services/delivery/webhookRequest.js` | Request DTO |
| `delivery/SendResult.java` | `src/services/delivery/sendResult.js` | Result DTO |
| `persistence/JdbcDeliveryRepository.java` | `src/repositories/jdbc/deliveryRepository.js` | Adapter (implements 7 ports) |

### Dispatch Layer

| Java Class | Node.js Module | Notes |
|------------|----------------|-------|
| `dispatch/Dispatcher.java` | `src/services/dispatch/dispatcher.js` | Polling scheduler |
| `dispatch/DeliveryClaimer.java` (interface) | `src/services/dispatch/deliveryClaimer.js` (interface) | Port |
| `dispatch/ClaimedDelivery.java` | `src/services/dispatch/claimedDelivery.js` | Result DTO |
| `dispatch/LeaseReaper.java` | `src/services/dispatch/leaseReaper.js` | Background task |
| `dispatch/LeaseRecoveryStore.java` (interface) | `src/services/dispatch/leaseRecoveryStore.js` (interface) | Port |

### DLQ Layer

| Java Class | Node.js Module | Notes |
|------------|----------------|-------|
| `dlq/ReplayService.java` | `src/services/dlq/replayService.js` | Replay logic |
| `dlq/DeadLetterStore.java` (interface) | `src/services/dlq/deadLetterStore.js` (interface) | Port |

### Resilience Layer

| Java Class | Node.js Module | Notes |
|------------|----------------|-------|
| `resilience/RetryPolicy.java` (interface) | `src/services/resilience/retryPolicy.js` (interface) | Port |
| `resilience/ExponentialJitterRetryPolicy.java` | `src/services/resilience/exponentialJitterRetryPolicy.js` | Implementation |
| `resilience/RateLimiter.java` (interface) | `src/services/resilience/rateLimiter.js` (interface) | Port |
| `resilience/TokenBucketRateLimiter.java` | `src/services/resilience/tokenBucketRateLimiter.js` | Implementation |
| `resilience/CircuitBreaker.java` (interface) | `src/services/resilience/circuitBreaker.js` (interface) | Port |
| `resilience/ThresholdCircuitBreaker.java` | `src/services/resilience/thresholdCircuitBreaker.js` | Implementation |
| `resilience/CircuitUpdate.java` | `src/services/resilience/circuitUpdate.js` | Result DTO |
| `resilience/EndpointHealthStore.java` (interface) | `src/services/resilience/endpointHealthStore.js` (interface) | Port |

### Observability Layer

| Java Class | Node.js Module | Notes |
|------------|----------------|-------|
| `observability/DeliveryMetrics.java` | `src/observability/metrics.js` | prom-client metrics |

---

## Port-Adapter Pattern Implementation

### Interfaces (Ports)
In Node.js, interfaces are represented as:
1. **Exported functions from service modules** (for simple ports)
2. **Class definitions with required methods** (for complex ports)
3. **JSDoc annotations** for contract documentation

Example (SequenceAllocator port):
```javascript
// src/services/endpoint/sequenceAllocator.js
/**
 * Port: atomically allocate the next sequence number for an endpoint.
 * @param {UUID} endpointId
 * @returns {Promise<number>} The allocated sequence number
 */
function allocate(endpointId) {
  throw new Error('Not implemented');
}

module.exports = { allocate };
```

### Adapters
Repositories implement ports using PostgreSQL:
```javascript
// src/repositories/jdbc/endpointRepository.js
const { allocate: allocatePort } = require('../../services/endpoint/sequenceAllocator');

async function allocate(endpointId) {
  const result = await pg.query(
    'UPDATE endpoints SET next_seq = next_seq + 1 WHERE id = $1 RETURNING next_seq - 1',
    [endpointId]
  );
  return result.rows[0]['?column?'];
}

// Port implementation
module.exports = {
  // ... other methods
  allocate
};
```

---

## Dependency Injection

### Java (Spring)
```java
@Component
public class EndpointService {
  private final EndpointRepository repository;
  public EndpointService(EndpointRepository repository) {
    this.repository = repository;
  }
}
```

### Node.js (Manual DI)
```javascript
// src/services/endpoint/endpointService.js
class EndpointService {
  constructor(repository, config) {
    this.repository = repository;
    this.config = config;
  }

  async create(tenantId, request) {
    // ...
  }
}

// DI in app initialization
const endpointRepository = require('../repositories/jdbc/endpointRepository');
const endpointService = new EndpointService(endpointRepository, config);
```

---

## Transaction Management

### Java (Spring @Transactional)
```java
@Transactional
public IngestResult ingest(UUID tenantId, String idempotencyKey, String payloadJson) {
  // All DB operations in one transaction
}
```

### Node.js (pg transactions)
```javascript
async function ingest(tenantId, idempotencyKey, payloadJson) {
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    // All DB operations
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

---

## Concurrency Model

### Java (Virtual Threads)
```java
@Bean
public ExecutorService deliveryExecutor() {
  return Executors.newVirtualThreadPerTaskExecutor();
}

// Dispatcher submits to virtual threads
executor.submit(() -> worker.process(claimedDelivery));
```

### Node.js (Event Loop + Worker Pool)
```javascript
// Option 1: Async/promise-based (single-threaded, non-blocking)
async function process(claimedDelivery) {
  // All async operations don't block event loop
}

// Option 2: Worker threads for CPU-bound work
const { Worker } = require('worker_threads');
// For actual HTTP delivery, async is sufficient (I/O bound)
```

---

## Scheduled Tasks

### Java (Spring @Scheduled)
```java
@Scheduled(fixedDelayString = "${webhooks.dispatcher.poll-interval}")
public void poll() {
  // Poll for deliveries
}
```

### Node.js (setInterval or node-cron)
```javascript
// src/services/dispatch/dispatcher.js
function startPolling() {
  const intervalMs = config.dispatcher.pollInterval;
  setInterval(async () => {
    await poll();
  }, intervalMs);
}
```

---

## Key Implementation Differences

| Aspect | Java (Reference) | Node.js (Target) |
|--------|-----------------|------------------|
| Records | `record` type | POJO classes / object factories |
| Enums | `enum` type | Object with frozen keys |
| Optional | `Optional<T>` | `null` / `undefined` with validation |
| Validation | Jakarta Validation | express-validator or custom |
| HTTP Client | JDK HTTP Client | node-fetch or axios |
| JSON | Jackson (ObjectMapper) | JSON.parse/stringify |
| UUID | `java.util.UUID` | `uuid` npm package |
| Date/Time | `java.time.Instant` | `Date` or `luxon` / `date-fns` |
| HMAC | `javax.crypto.Mac` | `crypto` module (built-in) |
| SQL | JdbcClient with named params | `pg` with `$1, $2` params |
| Migrations | Flyway | node-pg-migrate or db-migrate |
| Metrics | Micrometer | prom-client |
| Logging | SLF4J + Logback | winston or pino |
| Testing | JUnit 5 + Testcontainers | Jest + testcontainers-node |

---

## Package Dependencies (Initial Estimate)

```json
{
  "dependencies": {
    "express": "^4.18.x",
    "pg": "^8.11.x",
    "node-pg-migrate": "^6.2.x",
    "uuid": "^9.0.x",
    "express-validator": "^7.0.x",
    "axios": "^1.6.x" || "node-fetch": "^3.3.x",
    "prom-client": "^15.0.x",
    "winston": "^3.11.x",
    "dotenv": "^16.3.x",
    "config": "^3.3.x"
  },
  "devDependencies": {
    "jest": "^29.7.x",
    "supertest": "^6.3.x",
    "testcontainers": "^10.0.x",
    "node-pg-migrate": "^6.2.x",
    "eslint": "^8.55.x",
    "nodemon": "^3.0.x"
  }
}
```

---

## File-by-File Implementation Order

### Phase 1: Foundation
1. `src/config/index.js` - Config loader
2. `src/config/database.js` - PostgreSQL connection
3. `src/utils/clock.js` - Clock abstraction
4. `src/utils/random.js` - Random abstraction
5. `src/domain/deliveryState.js` - DeliveryState enum
6. `src/domain/deliveryOutcome.js` - DeliveryOutcome enum
7. `src/domain/circuitState.js` - CircuitState enum
8. `src/domain/models/*.js` - Domain models
9. `migrations/V1__init.sql` - Database schema

### Phase 2: Authentication + Endpoints
10. `src/repositories/jdbc/tenantRepository.js`
11. `src/middleware/auth.js` - ApiKeyAuthFilter
12. `src/repositories/jdbc/endpointRepository.js`
13. `src/services/endpoint/endpointService.js`
14. `src/routes/endpoints.js` - EndpointController

### Phase 3: Ingest
15. `src/repositories/jdbc/eventRepository.js`
16. `src/services/ingest/eventIngestService.js`
17. `src/routes/events.js` - EventController

### Phase 4: Delivery Core
18. `src/services/delivery/hmacSha256Signer.js`
19. `src/services/delivery/httpWebhookSender.js`
20. `src/services/delivery/defaultResponseClassifier.js`
21. `src/services/delivery/attemptExecutor.js`
22. `src/services/delivery/outcomeHandler.js`

### Phase 5: Dispatch
23. `src/repositories/jdbc/deliveryRepository.js` - claim method
24. `src/services/dispatch/dispatcher.js`
25. `src/services/delivery/deliveryWorker.js`

### Phase 6: Resilience
26. `src/services/resilience/exponentialJitterRetryPolicy.js`
27. `src/repositories/jdbc/deliveryRepository.js` - outcome recording methods
28. `src/services/resilience/tokenBucketRateLimiter.js`
29. `src/services/resilience/thresholdCircuitBreaker.js`
30. `src/services/dispatch/leaseReaper.js`

### Phase 7: DLQ + Status APIs
31. `src/repositories/jdbc/deliveryRepository.js` - query methods
32. `src/services/dlq/replayService.js`
33. `src/routes/deliveries.js` - DeliveryController

### Phase 8: Observability + Polish
34. `src/observability/metrics.js`
35. `src/middleware/errorHandler.js`
36. `src/app.js` - Wire everything together
37. `src/server.js` - Server entry point
38. Tests for each module
39. Docker Compose configuration
40. Mock receiver (reuse Python version)
