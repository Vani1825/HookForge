# Phase 2 Implementation Plan

**Branch:** feature/backend-core
**Status:** Proposed - Awaiting Approval
**Scope:** Domain models, Clock/Random abstractions, Tenant authentication, Endpoint CRUD

---

## Overview

Phase 2 implements the foundational domain layer, testability abstractions, authentication, and endpoint management. This phase does not modify the database schema (already created in Phase 1) but implements the repository adapters and service layer for endpoints.

---

## Files to Create

### 1. Domain Models (src/domain/)

#### src/domain/deliveryState.js
- DeliveryState enum with states: PENDING, IN_FLIGHT, RETRYING, SUCCEEDED, DEAD
- ALLOWED transitions map
- canTransitionTo(state) method
- requireTransitionTo(state) method (throws IllegalStateTransitionException)
- isTerminal() method
- isOpen() method

#### src/domain/deliveryOutcome.js
- DeliveryOutcome enum: SUCCESS, RETRY, RATE_LIMITED, RETRY_LIMITED, ENDPOINT_GONE
- countsAsEndpointFailure() method

#### src/domain/circuitState.js
- CircuitState enum: CLOSED, OPEN, HALF_OPEN

#### src/domain/models/tenant.js
- Tenant POJO factory: { id, name }
- Factory function createTenant({ id, name })

#### src/domain/models/endpoint.js
- Endpoint POJO factory: { id, tenantId, url, secret, active, rateLimitRps, nextSeq, circuitState, circuitUntil, consecutiveFailures, createdAt }
- Factory function createEndpoint(data)
- toResponse() method (excludes secret)

#### src/domain/models/event.js
- Event POJO factory: { id, tenantId, payloadJson, idempotencyKey, createdAt }
- Factory function createEvent(data)

#### src/domain/models/delivery.js
- Delivery POJO factory: { id, eventId, endpointId, seq, state, attemptCount, nextAttemptAt, leaseUntil, lastError, createdAt, updatedAt }
- Factory function createDelivery(data)

#### src/domain/models/deliveryAttempt.js
- DeliveryAttempt POJO factory: { deliveryId, attemptNo, startedAt, statusCode, latencyMs, error }
- Factory function createDeliveryAttempt(data)

#### src/domain/errors/illegalStateTransitionError.js
- IllegalStateTransitionException class
- Extends Error
- Properties: fromState, toState

#### src/domain/errors/notFoundError.js
- NotFoundException class (already exists in errorHandler, may consolidate)

### 2. Testability Abstractions (src/utils/)

#### src/utils/clock.js
- Clock interface with now() method
- SystemClock implementation (Date.now())
- TestClock implementation for deterministic tests (setTime(), advanceTime())

#### src/utils/random.js
- RandomGenerator interface with nextInt(min, max) method
- SystemRandom implementation (crypto.randomInt)
- TestRandom implementation for deterministic tests (seeded)

### 3. Authentication (src/middleware/)

#### src/middleware/auth.js
- ApiKeyAuthFilter middleware
- Extracts Authorization: Bearer <api-key> header
- Computes SHA-256 hash of API key
- Queries tenant repository by hash
- Sets req.tenantId attribute
- Returns 401 if invalid or missing
- Skips /health and /actuator paths

### 4. Tenant Repository (src/repositories/jdbc/)

#### src/repositories/jdbc/tenantRepository.js
- Implements TenantRepository port
- findByApiKeyHash(apiKeyHash) → Optional<Tenant>
- Uses parameterized SQL with pg

### 5. Endpoint Service Layer (src/services/endpoint/)

#### src/services/endpoint/endpointService.js
- EndpointService class
- create(tenantId, request) → Endpoint
  - Generates secret (32 bytes, Base64 URL-safe, "whsec_" prefix)
  - Validates SSRF (skip for MVP, document gap)
  - Calls repository.insert()
- list(tenantId) → Endpoint[]
  - Calls repository.findAllByTenant()
- update(tenantId, endpointId, request) → Endpoint
  - Validates ownership
  - Patches fields (url, active, rateLimitRps)
  - Calls repository.update()

#### src/services/endpoint/sequenceAllocator.js
- SequenceAllocator port interface
- allocate(endpointId) → Promise<number>

#### src/services/endpoint/endpointRepository.js
- EndpointRepository port interface
- insert(tenantId, url, secret, rateLimitRps) → Promise<Endpoint>
- findByIdAndTenant(id, tenantId) → Promise<Endpoint | null>
- findAllByTenant(tenantId) → Promise<Endpoint[]>
- findActiveByTenant(tenantId) → Promise<Endpoint[]>
- update(endpoint) → Promise<Endpoint>

### 6. Endpoint Repository Adapter (src/repositories/jdbc/)

#### src/repositories/jdbc/endpointRepository.js
- Implements all 3 ports: EndpointRepository, SequenceAllocator, EndpointHealthStore
- EndpointRepository methods:
  - insert(tenantId, url, secret, rateLimitRps) → Endpoint
  - findByIdAndTenant(id, tenantId) → Endpoint | null
  - findAllByTenant(tenantId) → Endpoint[]
  - findActiveByTenant(tenantId) → Endpoint[] (ORDER BY id for stable lock order)
  - update(endpoint) → Endpoint
- SequenceAllocator methods:
  - allocate(endpointId) → number (UPDATE endpoints SET next_seq = next_seq + 1 RETURNING next_seq - 1)
- EndpointHealthStore methods (stub for now, implemented in Phase 6):
  - saveCircuit(endpointId, update) → void
  - deactivate(endpointId) → void
- Row mapper for Endpoint domain model

### 7. Endpoint Routes (src/routes/)

#### src/routes/endpoints.js
- Express router
- POST /endpoints
  - Middleware: auth, validation (express-validator)
  - Body: { url, rateLimitRps? }
  - Response: 201 with endpoint (including secret)
- GET /endpoints
  - Middleware: auth
  - Response: 200 with array of endpoints (without secret)
- PATCH /endpoints/:id
  - Middleware: auth, validation
  - Body: { url?, active?, rateLimitRps? }
  - Response: 200 with updated endpoint (without secret)
- Request/response DTOs with Zod or express-validator

### 8. Tests (test/)

#### test/domain/deliveryState.test.js
- Test legal transitions
- Test illegal transitions throw exceptions
- Test isTerminal() and isOpen()
- Mirror reference's DeliveryStateTest

#### test/domain/deliveryOutcome.test.js
- Test countsAsEndpointFailure()

#### test/domain/circuitState.test.js
- Basic enum validation

#### test/utils/clock.test.js
- Test SystemClock.now()
- Test TestClock.setTime() and advanceTime()

#### test/utils/random.test.js
- Test SystemRandom.nextInt()
- Test TestRandom with seed

#### test/middleware/auth.test.js
- Test valid API key authenticates
- Test missing header returns 401
- Test invalid API key returns 401
- Test /health bypasses auth

#### test/repositories/tenantRepository.test.js
- Test findByApiKeyHash with valid hash
- Test findByApiKeyHash with invalid hash returns null

#### test/repositories/endpointRepository.test.js
- Test insert returns endpoint with generated id
- Test findByIdAndTenant returns endpoint
- Test findByIdAndTenant with wrong tenant returns null
- Test findAllByTenant returns all endpoints
- Test findActiveByTenant returns only active endpoints
- Test update patches fields
- Test allocate increments and returns sequence number

#### test/services/endpointService.test.js
- Test create generates secret
- Test create with default rateLimitRps
- Test list returns endpoints
- Test update patches fields
- Test update validates ownership

#### test/routes/endpoints.test.js
- Integration tests with supertest
- Test POST /endpoints returns 201 with secret
- Test GET /endpoints returns 200 without secret
- Test PATCH /endpoints/:id returns 200
- Test auth required for all endpoints
- Test validation errors return 400

---

## API Contracts

### POST /endpoints

**Request:**
```json
{
  "url": "https://example.com/webhook",
  "rateLimitRps": 10
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "url": "https://example.com/webhook",
  "secret": "whsec_...",
  "active": true,
  "rateLimitRps": 10,
  "circuitState": "CLOSED",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Validation:**
- url: required, valid URL
- rateLimitRps: optional, integer > 0

### GET /endpoints

**Response (200):**
```json
[
  {
    "id": "uuid",
    "url": "https://example.com/webhook",
    "active": true,
    "rateLimitRps": 10,
    "circuitState": "CLOSED",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

**Note:** secret is never returned in list/update responses

### PATCH /endpoints/:id

**Request:**
```json
{
  "url": "https://example.com/new-url",
  "active": false,
  "rateLimitRps": 20
}
```

**Response (200):**
```json
{
  "id": "uuid",
  "url": "https://example.com/new-url",
  "active": false,
  "rateLimitRps": 20,
  "circuitState": "CLOSED",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Validation:**
- url: optional, valid URL if provided
- active: optional, boolean
- rateLimitRps: optional, integer > 0 if provided

---

## Database Changes

**None.** The database schema from Phase 1 includes all necessary tables:
- tenants table (for authentication)
- endpoints table (for CRUD operations)

No new migrations required in Phase 2.

---

## Implementation Order

### Step 1: Domain Models (Foundation)
1. Create DeliveryState enum with transition logic
2. Create DeliveryOutcome enum
3. Create CircuitState enum
4. Create POJO factories for Tenant, Endpoint, Event, Delivery, DeliveryAttempt
5. Create custom error classes
6. Write unit tests for domain models

### Step 2: Testability Abstractions
1. Create Clock interface and implementations
2. Create RandomGenerator interface and implementations
3. Write unit tests for clock and random

### Step 3: Tenant Authentication
1. Create TenantRepository port interface
2. Implement JdbcTenantRepository
3. Create ApiKeyAuthFilter middleware
4. Wire middleware into app.js
5. Write tests for auth middleware and repository

### Step 4: Endpoint Repository
1. Create EndpointRepository, SequenceAllocator, EndpointHealthStore port interfaces
2. Implement JdbcEndpointRepository (all 3 ports)
3. Write repository tests (with test database or mocked)

### Step 5: Endpoint Service
1. Create EndpointService with business logic
2. Implement secret generation
3. Write service tests

### Step 6: Endpoint Routes
1. Create endpoints router with validation
2. Wire router into app.js with auth middleware
3. Write integration tests with supertest

### Step 7: Integration and Verification
1. Run all tests
2. Verify API contracts with manual testing (optional)
3. Update documentation

---

## Testing Strategy

### Unit Tests
- Domain models: Test state transitions, enum values, factory functions
- Utilities: Test clock and random abstractions
- Repositories: Test SQL queries, row mapping, error handling
- Services: Test business logic, secret generation, validation

### Integration Tests
- Auth middleware: Test with valid/invalid API keys
- Endpoint routes: Test full request/response cycle with supertest
- Use in-memory SQLite or testcontainers for database tests (Phase 2 may use mocked repositories for simplicity, Phase 3+ will use testcontainers)

### Test Data
- Seed a test tenant with known API key for auth tests
- Use deterministic UUIDs in tests for predictability

---

## Design Decisions

### 1. Domain Models as Factories
- **Decision:** Use factory functions instead of classes for POJOs
- **Rationale:** Simpler in JavaScript, immutability by default with Object.freeze if needed
- **Impact:** Consistent with functional programming patterns in Node.js

### 2. Clock and Random Abstractions
- **Decision:** Injectable dependencies like reference
- **Rationale:** Testability, matches reference's CoreBeansConfig
- **Impact:** Deterministic tests for time-dependent and random behavior

### 3. Authentication Middleware
- **Decision:** Express middleware that sets req.tenantId
- **Rationale:** Matches reference's ApiKeyAuthFilter pattern
- **Impact:** All protected routes can access tenantId from request

### 4. Secret Generation
- **Decision:** 32 random bytes, Base64 URL-safe, "whsec_" prefix
- **Rationale:** Matches reference's generateSecret() method
- **Impact:** Compatible with reference's signature format

### 5. Repository Implementation
- **Decision:** Single file implements 3 ports (EndpointRepository, SequenceAllocator, EndpointHealthStore)
- **Rationale:** Matches reference's JdbcEndpointRepository pattern
- **Impact:** SQL lives in one place, cohesive data access layer

### 6. Validation
- **Decision:** Use express-validator for request validation
- **Rationale:** Express ecosystem standard, integrates well with middleware
- **Impact:** Clear validation errors, easy to extend

---

## Dependencies

### New Dependencies (if needed)
- **crypto** (built-in) for SHA-256 hashing
- **express-validator** (already in package.json)
- No additional npm packages required

### Existing Dependencies Used
- pg (database queries)
- uuid (UUID generation)
- pino (logging)
- vitest (testing)
- supertest (integration testing)

---

## Known Limitations

1. **SSRF Guard Not Implemented**
   - Reference skips SSRF check for Docker Compose demos
   - Phase 2 will document this gap without implementation
   - Future phase may add host resolution and private range checks

2. **EndpointHealthStore Stubbed**
   - Circuit breaker health methods will be stubs in Phase 2
   - Full implementation in Phase 6 (Resilience)

3. **Database Tests**
   - Phase 2 may use mocked repositories for simplicity
   - Full integration tests with testcontainers in later phases

---

## Success Criteria

- [ ] All domain models implemented with correct transition logic
- [ ] Clock and Random abstractions work in tests
- [ ] API key authentication validates correctly
- [ ] Endpoint CRUD operations work end-to-end
- [ ] All unit tests passing
- [ ] Integration tests for endpoint routes passing
- [ ] No database schema changes required
- [ ] API contracts match reference exactly
- [ ] Code follows port-adapter architecture
- [ ] All tests pass (target: 30+ tests)

---

## Risks and Mitigations

### Risk 1: Authentication Complexity
- **Risk:** SHA-256 hashing and tenant lookup may have edge cases
- **Mitigation:** Write comprehensive tests for auth middleware
- **Fallback:** Reference implementation exists to validate behavior

### Risk 2: Repository SQL Errors
- **Risk:** Parameterized SQL may have syntax errors
- **Mitigation:** Write repository tests with actual database or careful mocking
- **Fallback:** Reference SQL available for comparison

### Risk 3: Secret Generation Compatibility
- **Risk:** Secret format may not match reference
- **Mitigation:** Match reference's generateSecret() exactly (32 bytes, Base64 URL-safe, "whsec_" prefix)
- **Fallback:** Test signature verification in Phase 4

---

## Deliverables

1. **Code:** 20+ new files (domain models, utilities, middleware, repositories, services, routes, tests)
2. **Tests:** 30+ unit and integration tests
3. **Documentation:** Phase 2 summary document
4. **Verification:** Test results report

---

## Questions for Review

1. Should Phase 2 use testcontainers for database tests, or mock repositories for simplicity?
2. Should we implement SSRF guard in Phase 2, or document as gap per reference?
3. Should EndpointHealthStore methods throw NotImplementedError or be no-ops?

---

**Awaiting approval to proceed with implementation.**
