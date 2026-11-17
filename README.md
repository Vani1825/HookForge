# 🔗 HookForge 2.0

CI • React • Vite • Tailwind CSS • Node.js • Express • PostgreSQL • Docker • Redis • RabbitMQ

**A scalable, secure, and fault-tolerant webhook delivery platform designed for reliable asynchronous event processing, intelligent traffic management, and real-time system monitoring.**

**Build • Innovate • Deliver**

---

## Table of Contents

1. Overview
2. The Problem HookForge Solves
3. System Architecture
4. End-to-End System Lifecycle
5. Features
6. Delivery Queue & Reliability Strategy
7. Tech Stack
8. Project Structure
9. Getting Started
10. Prerequisites
11. Local Development Setup
12. Environment Configuration
13. Example: Webhook Event Delivery
14. Deployment & CI/CD
15. Testing
16. Operational Resilience
17. Security & Limitations
18. Development Roadmap
19. Team Contributions
20. License

---

## Overview

HookForge is a full-stack, event-driven webhook delivery platform that enables applications to reliably send events to external services through asynchronous processing.

It provides a centralized system for event ingestion, endpoint management, persistent delivery scheduling, concurrent processing, automatic retries, failure recovery, and delivery monitoring.

HookForge is designed around three primary layers:

- **React Frontend:** Developer dashboard for managing events, endpoints, deliveries, analytics, and dead-letter records.
- **Express Backend:** REST APIs, authentication, event ingestion, delivery scheduling, worker orchestration, retry management, and endpoint communication.
- **Data & Processing Layer:** PostgreSQL for durable queue management, with Redis for distributed rate limiting and optional RabbitMQ for message transport as the platform evolves.

The primary objective is to provide dependable webhook delivery while controlling outbound traffic, handling failures, and maintaining system observability.

## The Problem HookForge Solves

Traditional webhook implementations often face reliability and scalability challenges when communicating with external services.

| Problem | How HookForge solves it |
|---|---|
| Failed webhook requests | Automatic retries with exponential backoff and jitter |
| Duplicate event ingestion | Idempotency keys and transactional event processing |
| Unavailable subscriber endpoints | Circuit breaker and failure recovery |
| Excessive outbound traffic | Per-endpoint rate limiting |
| Worker crashes | Lease-based recovery of unfinished deliveries |
| Lost delivery records | Persistent PostgreSQL-backed queue |
| Permanently failed deliveries | Dead Letter Queue (DLQ) and manual replay |
| Difficult delivery tracking | Dashboard, delivery history, and analytics |
| High processing volume | Bounded worker concurrency and backpressure management |

## System Architecture

HookForge follows an asynchronous, queue-driven architecture in which PostgreSQL acts as the durable source of truth for event and delivery state.

### Architecture Components

| Component | Responsibility |
|---|---|
| React Frontend | Dashboard, endpoint management, event inspection, delivery monitoring and analytics |
| Express API | REST endpoints, authentication, validation and event ingestion |
| Authentication | Tenant isolation and API key verification |
| Event Ingestion | Validates incoming events and performs transactional fan-out |
| PostgreSQL | Stores tenants, endpoints, events, deliveries and delivery attempts |
| Dispatcher | Claims queued deliveries and schedules asynchronous processing |
| Worker Pool | Executes outbound HTTP requests concurrently |
| Retry Engine | Calculates retry schedules using exponential backoff and jitter |
| Rate Limiter | Controls outbound request frequency |
| Circuit Breaker | Prevents repeated requests to unhealthy endpoints |
| Dead Letter Queue | Stores deliveries that exceed retry limits |
| Redis | Planned distributed rate limiting and shared state |
| RabbitMQ | Optional future message transport |
| Monitoring | Prometheus metrics and Grafana dashboards |

### High-Level Architecture Flow

```text
              Client Application
                      |
                      |
                POST /events
                      |
                      v
              Express REST API
                      |
              Authentication
              & Validation
                      |
                      v
             Event Ingestion
                      |
             Transactional Fan-out
                      |
                      v
              PostgreSQL
          (Durable Delivery Queue)
                      |
                      v
              Dispatcher
                      |
              Atomic Claiming
                      |
                      v
                Worker Pool
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
      Rate Limit   Circuit     Retry Engine
                   Breaker
          |           |           |
          +-----------+-----------+
                      |
                      v
             Outbound HTTP POST
                + HMAC-SHA256
                      |
                      v
              External Endpoint
                      |
                HTTP Response
                      |
          +-----------+-----------+
          |                       |
          v                       v
       SUCCESS                 FAILURE
          |                       |
          v                       v
      PostgreSQL            Retry Scheduling
                                  |
                          Maximum Attempts?
                                  |
                            +-----+-----+
                            |           |
                           YES          NO
                            |           |
                            v           v
                           DLQ       Retry Queue
```

## End-to-End System Lifecycle

### Phase 0: Server Initialization

- Loads environment configuration.
- Initializes the Express application.
- Establishes PostgreSQL database connectivity.
- Configures middleware, CORS and request validation.
- Initializes the dispatcher and background processing components.
- Starts health-check endpoints.
- Configures graceful shutdown.

### Phase 1: Authentication and Event Ingestion

- Client authenticates using an API key.
- API validates the tenant and request payload.
- Idempotency keys prevent duplicate event creation.
- Event records are persisted in PostgreSQL.
- Active endpoints are identified.
- Delivery records are created transactionally.
- Sequence numbers are allocated per endpoint.

### Phase 2: Delivery Scheduling and Queue Processing

- Dispatcher polls the PostgreSQL delivery queue.
- Workers claim eligible deliveries atomically.
- `FOR UPDATE SKIP LOCKED` prevents multiple workers from claiming the same delivery.
- Lease deadlines are assigned to claimed records.
- Endpoint ordering is maintained.
- Outbound HTTP requests are executed asynchronously.

### Phase 3: Request Signing and Delivery

- Generates an HMAC-SHA256 signature.
- Attaches delivery identifiers and timestamp headers.
- Sends the event payload to the registered endpoint.
- Captures the HTTP response and delivery latency.
- Updates delivery status in PostgreSQL.

### Phase 4: Failure Detection and Recovery

- Classifies HTTP responses.
- Retries temporary failures.
- Applies exponential backoff with full jitter.
- Activates circuit breakers after repeated failures.
- Recovers expired worker leases.
- Moves permanently failed deliveries to the DLQ.

### Phase 5: Advanced Delivery Management

Planned enhancements include:

- Scheduled webhook execution.
- Configurable retry policies.
- Bulk delivery replay.
- Endpoint connectivity testing.
- Delivery diagnostics.
- Event templates.
- Advanced delivery inspection.

### Phase 6: Distributed Processing

- Redis-based distributed rate limiting.
- Shared rate-limit state across workers.
- Optional RabbitMQ message transport.
- Improved worker pool management.
- Backpressure control.
- Load and throughput benchmarking.

### Phase 7: Monitoring and Administration

- Delivery success and failure analytics.
- Queue depth monitoring.
- Worker health monitoring.
- Prometheus metrics.
- Grafana dashboards.
- API key management.
- Role-based access control.
- Audit logs and security alerts.

### Phase 8: Deployment and Production Readiness

- Production Docker configuration.
- GitHub Actions CI/CD pipeline.
- Database backup and recovery.
- Automated performance testing.
- Deployment verification.
- Final documentation and project demonstration.

## Features

### Event Management

- Event ingestion through REST APIs.
- JSON payload validation.
- Tenant-scoped idempotency.
- Atomic transactional fan-out.
- Event and delivery association.
- Event inspection and tracking.

### Endpoint Management

- Register webhook endpoints.
- Configure endpoint-level rate limits.
- Activate and deactivate endpoints.
- Generate webhook signing secrets.
- Track endpoint circuit breaker status.
- Inspect endpoint delivery performance.

### Delivery Management

- Asynchronous delivery execution.
- Bounded concurrent worker processing.
- Per-endpoint FIFO sequence ordering.
- Delivery status tracking.
- HTTP response classification.
- Complete delivery attempt history.

### Retry Management

- Exponential backoff with full jitter.
- Configurable maximum attempts.
- Automatic retry scheduling.
- Manual replay of failed deliveries.
- Lease-based crash recovery.

### Dead Letter Queue

- Permanently failed delivery storage.
- Failure reason tracking.
- Delivery attempt inspection.
- Manual replay functionality.
- Planned bulk replay and advanced filtering.

### Security

- Bearer token authentication.
- SHA-256 hashed API keys.
- HMAC-SHA256 request signing.
- Timestamp-based signature verification.
- Tenant-level data isolation.
- Planned SSRF protection and secret rotation enhancements.

## Delivery Queue & Reliability Strategy

PostgreSQL is the durable queue and source of truth for delivery state.

### 1. Atomic Queue Claiming

Workers use PostgreSQL transactions and `SELECT ... FOR UPDATE SKIP LOCKED` to claim available deliveries without competing for the same record.

### 2. Idempotency

A unique tenant-scoped idempotency key prevents duplicate event creation when clients retry ingestion requests.

### 3. Exponential Backoff with Jitter

Failed requests are rescheduled using:

```text
delay = random(0, min(cap, base * 2^(attempts - 1)))
```

This avoids synchronized retry spikes and reduces unnecessary pressure on external services.

### 4. Circuit Breaker

HookForge implements three circuit states:

| State | Behaviour |
|---|---|
| CLOSED | Requests are allowed normally |
| OPEN | Requests are temporarily stopped |
| HALF_OPEN | Limited recovery requests are permitted |

The existing implementation opens the circuit after five consecutive failures and permits a recovery probe after a one-minute cooldown.

### 5. Lease-Based Recovery

Every claimed delivery receives a lease deadline.

If a worker terminates unexpectedly, the lease reaper identifies expired in-flight records and makes them eligible for recovery.

### 6. Dead Letter Queue

Deliveries that exhaust their retry attempts are marked as permanently failed and become available for inspection and manual replay.

### 7. Distributed Rate Limiting

Redis is planned to maintain shared rate-limit state across multiple worker processes.

### 8. Optional Message Broker

RabbitMQ may be introduced as a dispatch transport while PostgreSQL continues to maintain durable delivery records and final delivery state.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, React Router, Tailwind CSS |
| Backend | Node.js, Express.js |
| Database | PostgreSQL 16 |
| Database Client | Node PostgreSQL (`pg`) |
| Validation | Zod |
| Authentication | API Key Bearer Authentication, SHA-256 |
| Webhook Security | HMAC-SHA256 |
| Queue Management | PostgreSQL, `FOR UPDATE SKIP LOCKED` |
| Rate Limiting | Token Bucket, Redis (planned) |
| Message Broker | RabbitMQ (optional planned integration) |
| Testing | Vitest, Supertest |
| Performance Testing | k6 (planned) |
| Monitoring | Prometheus and Grafana (planned) |
| Containerization | Docker, Docker Compose |
| CI/CD | GitHub Actions |

**Core Database Entities:** Tenant, Endpoint, Event, Delivery, Delivery Attempt.

## Project Structure

```text
HookForge/
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── backend/
│   ├── src/
│   │   ├── app.js
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── workers/
│   │   └── utils/
│   │
│   ├── migrations/
│   ├── tests/
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── layouts/
│   │   ├── services/
│   │   ├── hooks/
│   │   └── context/
│   │
│   ├── public/
│   ├── package.json
│   └── vite.config.js
│
├── docker-compose.yml
├── .env.example
├── package.json
├── .gitignore
└── README.md
```

*Note: This represents the logical target structure. Adjust directory names to match the actual repository as new modules are introduced.*

## Getting Started

### Prerequisites

- Node.js >= 20.x
- npm
- Docker Desktop
- Docker Compose
- PostgreSQL 16 (if running without Docker)
- Git

### Option A: Local Development Setup

#### 1. Clone the repository

```bash
git clone https://github.com/Vani1825/HookForge.git
cd HookForge
```

#### 2. Start Docker Desktop

Ensure Docker Desktop is running before starting the containers.

#### 3. Start PostgreSQL and backend services

```powershell
docker compose up -d
```

Verify containers:

```powershell
docker ps --filter "name=hookforge"
```

#### 4. Install dependencies

```powershell
npm install
npm install --prefix backend
npm install --prefix frontend
```

#### 5. Run database migrations

```powershell
npm run db:migrate
```

#### 6. Initialize a development tenant

```powershell
npm run tenant:init
```

Save the generated API key securely. It cannot be recovered as plaintext because only its SHA-256 hash is stored.

#### 7. Start the frontend

```powershell
npm run dev:frontend
```

Open:

```text
http://localhost:5173
```

#### 8. Verify backend health

```powershell
curl.exe http://localhost:8081/health
```

The backend should return a successful health response.

## Environment Configuration

Create the backend environment file using `.env.example`:

```env
# Server
PORT=8081
NODE_ENV=development

# PostgreSQL
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

Frontend configuration:

```env
VITE_API_BASE_URL=http://localhost:8081
```

| Variable | Purpose |
|---|---|
| PORT | Backend server port |
| DATABASE_HOST | PostgreSQL hostname |
| DATABASE_PORT | PostgreSQL host port |
| DATABASE_USER | Database username |
| DATABASE_PASSWORD | Database password |
| DATABASE_NAME | Database name |
| RETRY_MAX_ATTEMPTS | Maximum delivery attempts |
| DISPATCHER_BATCH_SIZE | Number of deliveries claimed per batch |
| DISPATCHER_WORKER_CONCURRENCY | Worker concurrency limit |
| CIRCUIT_FAILURE_THRESHOLD | Consecutive failures before opening circuit |
| INGEST_MAX_PAYLOAD_BYTES | Maximum accepted event payload |
| VITE_API_BASE_URL | Frontend API base URL |

Never commit `.env` files, API keys, or signing secrets to source control.

## Example: Webhook Event Delivery

Suppose an e-commerce application generates an order event.

**Step 1: Register an endpoint**

```http
POST /endpoints
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "url": "https://example.com/webhook",
  "rateLimitRps": 20
}
```

**Step 2: Ingest an event**

```http
POST /events
Authorization: Bearer <api-key>
Idempotency-Key: order_event_001
Content-Type: application/json
```

```json
{
  "event": "order.created",
  "orderId": "ORD123",
  "amount": 4999
}
```

**Step 3: Event processing**

- The event is validated.
- PostgreSQL stores the event.
- Delivery records are created for active endpoints.
- The dispatcher claims eligible deliveries.
- A worker sends the webhook request.

**Step 4: Request signing**

Outgoing webhook requests contain:

```http
X-Webhook-Id: <delivery-uuid>
X-Webhook-Timestamp: <unix-timestamp>
X-Webhook-Signature: t=<timestamp>,v1=<hmac-sha256>
```

The signature is generated using the endpoint's signing secret and the timestamp-prefixed raw payload.

**Step 5: Delivery status**

The platform records the response and updates the delivery state.

Possible outcomes:

- `SUCCESS`: Delivery completed successfully.
- `RETRYING`: Temporary failure; another attempt is scheduled.
- `DEAD`: Maximum attempts reached; delivery enters the DLQ.

## Deployment & CI/CD

### Local Deployment

| Component | Address |
|---|---|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:8081 |
| PostgreSQL | localhost:5434 |
| Mock Webhook Receiver | localhost:9000 |

### CI/CD Pipeline

GitHub Actions is planned to automate:

- Backend dependency installation.
- Automated unit and integration tests.
- Frontend dependency installation.
- Frontend production build.
- Docker build verification.
- Deployment checks.

### Production Deployment

Production deployment will include:

- Dockerized frontend and backend.
- PostgreSQL persistence and backups.
- Environment-specific configuration.
- Secure secrets management.
- Health checks.
- Automated deployment pipeline.
- Recovery and restart verification.

## Testing

HookForge includes unit, integration, and end-to-end testing.

### Existing Automated Tests

Run the test suite:

```bash
npm test
```

The existing documented test baseline contains:

| Metric | Result |
|---|---:|
| Test Files | 19 |
| Tests | 131 |
| Passing Tests | 131 |
| Pass Rate | 100% |

### End-to-End Acceptance Tests

```bash
npm run test:e2e
```

The existing acceptance suite covers:

| Test Scenario | Expected Behaviour |
|---|---|
| Successful signed delivery | Valid webhook reaches receiver |
| Idempotency | Duplicate event is not created |
| Ordering | Per-endpoint sequence is maintained |
| Retry | Temporary failure is retried |
| Dead-letter replay | Failed delivery can be replayed |
| Lease recovery | Expired worker lease is recovered |
| Circuit breaker | Repeated failures open circuit |
| Tenant isolation | Tenants cannot access each other's records |

### Planned Performance Testing

Using k6, the platform will be tested for:

- High-volume event ingestion.
- Concurrent delivery processing.
- Slow subscriber responses.
- Multiple endpoint workloads.
- Queue backlog growth.
- Worker shutdown and recovery.

Performance metrics:

- Events per second.
- Deliveries per second.
- p95 and p99 latency.
- Queue wait time.
- Database query latency.
- Worker utilization.

## Operational Resilience

**Graceful failure recovery:** Expired worker leases are detected and recovered.

**Durable persistence:** PostgreSQL maintains event and delivery records.

**Retry scheduling:** Exponential backoff with full jitter prevents aggressive retry behaviour.

**Circuit breaking:** Repeated endpoint failures temporarily stop further requests.

**Traffic control:** Token bucket rate limiting controls outbound request frequency.

**Delivery audit trail:** Every delivery attempt is recorded for inspection.

**Tenant isolation:** Database operations are scoped to authenticated tenants.

**Bounded concurrency:** Workers process a controlled number of deliveries to avoid unbounded resource consumption.

**Future observability:** Prometheus and Grafana will provide system-wide performance visibility.

## Security & Limitations

### Security Measures

- API keys are stored as SHA-256 hashes.
- HMAC-SHA256 protects webhook payload integrity.
- Timestamp headers support replay detection at receivers.
- Parameterized SQL queries help prevent SQL injection.
- Tenant-scoped operations enforce data isolation.
- Endpoint signing secrets are not returned by ordinary listing APIs.

### Current Limitations

- PostgreSQL is the durable queue and can become a throughput bottleneck under high write contention.
- Token bucket rate limiting currently uses single-process memory and is not shared across multiple instances.
- Strict FIFO delivery introduces head-of-line blocking for individual endpoints.
- At-least-once delivery can result in duplicate requests; receivers should deduplicate using `X-Webhook-Id`.
- Replaying a permanently failed delivery does not preserve its original sequence position relative to newer deliveries.
- Full private-network egress filtering and comprehensive SSRF protection remain planned security enhancements.
- RabbitMQ is an optional extension, not a current requirement.
- Redis-based distributed rate limiting and Prometheus/Grafana integration are planned enhancements.

## Development Roadmap

HookForge 2.0 is being developed through six phases over an estimated ten-week schedule.

| Phase | Timeline | Focus |
|---|---|---|
| Phase 0 | Week 1 | Stabilization & Audit Closure |
| Phase 1 | Weeks 2–3 | Frontend Redesign |
| Phase 2 | Weeks 4–5 | Advanced Webhook Management |
| Phase 3 | Weeks 6–7 | Distributed Systems Enhancements |
| Phase 4 | Weeks 8–9 | Security & Observability |
| Phase 5 | Week 10 | Deployment & Performance |

### Phase 0 – Stabilization & Audit Closure

- Verify backend test suites and APIs.
- Fix authentication and CORS issues.
- Align Docker and environment configurations.
- Resolve analytics and metrics inconsistencies.
- Review security issues, SSRF and secrets.
- Improve request limits and optimize database queries.
- Verify frontend-backend integration.
- Set up CI workflow.

### Phase 1 – Frontend Redesign

- Modernize the UI layout.
- Improve dashboard and charts.
- Add search and filters.
- Enhance event and delivery pages.
- Improve error and loading states.
- Make the application responsive.
- Add notifications and confirmation dialogs.

### Phase 2 – Advanced Webhook Management

- Implement scheduled webhook delivery.
- Support bulk replay.
- Add endpoint connectivity testing.
- Introduce custom retry policies.
- Add webhook templates.
- Improve filtering and delivery inspection.

### Phase 3 – Distributed Systems Enhancements

- Integrate Redis for caching and distributed rate limiting.
- Evaluate optional RabbitMQ integration.
- Improve worker pool management.
- Implement backpressure control.
- Monitor worker health.
- Introduce queue metrics.
- Benchmark system performance.

### Phase 4 – Security & Observability

- Implement role-based access control.
- Improve API key management.
- Introduce audit logs and security alerts.
- Integrate Prometheus metrics.
- Build Grafana monitoring dashboards.
- Implement SSRF protection.
- Support signing secret rotation.

### Phase 5 – Deployment & Performance

- Configure production Docker deployment.
- Perform load testing using k6.
- Build the GitHub Actions deployment pipeline.
- Implement backup and recovery procedures.
- Complete final UI improvements.
- Prepare documentation and project demonstration.

## Team Contributions

HookForge 2.0 is developed collaboratively by three members, with responsibilities distributed across the six development phases.

| Member | Primary Responsibility | Focus |
|---|---|---|
| Mannat | Backend & Infrastructure | API reliability, database, Redis, security and deployment |
| Vani | Frontend & Integration | UI redesign, delivery management, analytics and observability |
| Tanvi | Advanced Features & Production Readiness | Endpoint security, worker monitoring, scheduled delivery and deployment support |

### Mannat – Backend & Infrastructure

- Backend API stabilization.
- Authentication and CORS corrections.
- Docker and environment configuration.
- Analytics and database query optimization.
- Scheduled delivery and bulk replay.
- Redis integration.
- RBAC and API key management.
- Production Docker configuration.
- Load testing with k6.

### Vani – Frontend & Integration

- Security review and request limit improvements.
- Dashboard and frontend redesign.
- Event and delivery management pages.
- Advanced filtering and delivery logs.
- Optional RabbitMQ integration.
- Worker pool and backpressure improvements.
- Prometheus metrics.
- Grafana dashboards.
- CI/CD pipeline and backup recovery.

### Tanvi – Advanced Features & Production Readiness

- Frontend-backend integration verification.
- Pagination and filtering.
- CI workflow setup.
- Responsive UI and notifications.
- Delivery inspector and resend flow.
- Worker health and queue metrics.
- SSRF protection and signing secret rotation.
- Final UI polish and documentation.
- Project demonstration setup.

---

## License

This project is developed for educational and engineering purposes. See the repository license for applicable terms.

---

**Built with ❤️ by Team HookForge.**

*Building reliable webhooks, one delivery at a time.*