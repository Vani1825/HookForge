# HookForge Analytics & Operational Telemetry Audit

**Branch**: `mannat`  
**Date**: November 6, 2026  
**Auditor**: Mannat (Software Development & Reliability Engineering)  
**System**: HookForge Webhook Reliability & Delivery Platform  

---

## 1. Executive Summary

This audit addresses the operational analytics and telemetry pipeline for HookForge. Prior to this implementation, the HookForge dashboard in Live API Mode (`VITE_DEMO_MODE=false`) relied on incomplete, unpaginated client-side estimates, hardcoded dummy constants (e.g. `averageLatencyMs: 74`), and mock fixtures returned directly from the mock store (e.g. `mockStore.getTimeSeriesMetrics()`). Furthermore, the backend completely lacked `/metrics` routes, causing HTTP 404 responses whenever live metrics endpoints were requested.

To resolve these deficiencies, we architected and implemented an end-to-end, multi-tenant PostgreSQL analytics layer:
1. **Database-backed Repository Layer** (`analyticsRepository.js`): Pure PostgreSQL aggregation queries using `generate_series`, `FILTER`, `COALESCE`, and `TIMESTAMPTZ` boundaries with strict multi-tenant isolation.
2. **Business & Domain Service Layer** (`analyticsService.js`): Dynamic date-range parsing (`24h`, `7d`, `30d`, and ISO 8601), interval resolution (`hour` vs `day`), zero-event division-by-zero protection, and tenant scoping.
3. **HTTP REST Route Layer** (`routes/metrics.js`): Express router mounted under `/metrics` with API key authentication (`apiKeyAuth`), full express-validator query guards, and standard JSON schema contracts.
4. **Frontend Service & Context Integration** (`api/metrics.ts`, `AppContext.tsx`, `AnalyticsPage.tsx`): Replacement of all client-side heuristics and hardcoded sample metrics with dynamic API clients wired to live PostgreSQL data, including reactive date-range switching (`24h`, `7d`, `30d`).
5. **Comprehensive Automated Test Coverage**: 100% test pass rate across unit, repository, and route suites:
   - Backend: **23 test files, 191 tests passed** (0 failed).
   - Frontend: **2 test files, 10 tests passed** (0 failed), production build succeeds with 2,558 transformed modules.

---

## 2. Existing Issues & Root Cause Analysis

| # | Component | Identified Defect | Impact | Resolution |
|---|---|---|---|---|
| **1** | Express Backend (`app.js`) | Missing `/metrics` router registration | Calling `GET /metrics` resulted in HTTP 404 `NotFoundError` | Created `backend/src/routes/metrics.js` and mounted it at `app.use('/metrics', apiKeyAuth, metricsRouter)` |
| **2** | Frontend Context (`AppContext.tsx`) | Hardcoded Average Latency (`74ms`) | Displayed static `74ms` in live mode regardless of actual network/delivery latencies | Replaced with live aggregation: `SELECT COALESCE(ROUND(AVG(a.latency_ms)), 0) FROM delivery_attempts` |
| **3** | Frontend Context (`AppContext.tsx`) | Mock store fallback in live mode for time series (`return mockStore.getTimeSeriesMetrics()`) | Area and throughput charts in Live Mode rendered mock fixtures instead of real PostgreSQL delivery throughput | Integrated `metricsApi.fetchTimeSeriesMetrics(range ? { range } : undefined)` in Live API mode |
| **4** | Frontend Context (`AppContext.tsx`) | Slice-based counting from unpaginated list APIs | `deliveriesApi.fetchDeliveries()` only retrieved the default page (50 items), resulting in inaccurate KPI cards when total deliveries exceeded 50 | Shifted all count calculations to database-level aggregate SQL queries (`COUNT(*)`, `COUNT(*) FILTER (...)`) |
| **5** | Frontend Analytics (`AnalyticsPage.tsx`) | Missing `dateRange` in `useEffect` dependency array and service calls | Toggling between `24H`, `7D`, and `30D` buttons failed to re-fetch or alter telemetry | Updated `loadData` to accept and pass `dateRange` to `service.getOverviewMetrics(dateRange)` and `service.getTimeSeriesMetrics(dateRange)` |
| **6** | Zero-Event Edge Case | Potential `NaN` on division by zero when `totalDeliveries = 0` | Without checks, `(succeeded / total) * 100` resulted in `NaN%`, breaking UI cards and charts | Added strict zero-guard: `totalDeliveries > 0 ? (succeeded / total) * 100 : 100.0` |
| **7** | Time Series Gaps | Sparse or missing hourly/daily intervals | Naive `GROUP BY date_trunc(...)` queries omitted hours with zero events, creating jagged, broken charts | Implemented PostgreSQL `generate_series` with `LEFT JOIN` to ensure continuous, gap-free buckets |

---

## 3. Metrics Definitions & Mathematical Formulas

All operational telemetry calculations adhere to rigorous, non-overlapping definitions that prevent double-counting:

### 3.1. Total Events
$$\text{Total Events} = \sum_{e \in \text{events}} 1 \quad \text{where } e.\text{tenant\_id} = \text{tenantId}$$
- **PostgreSQL**: `SELECT COUNT(*)::bigint FROM events WHERE tenant_id = $1`
- **Isolation**: Strictly scoped to the authenticated tenant. Delivery attempts and retries are never counted as events.

### 3.2. Total Deliveries
$$\text{Total Deliveries} = \sum_{d \in \text{deliveries}} 1 \quad \text{where } d.\text{endpoint\_id} \in \text{tenant\_endpoints}$$
- **PostgreSQL**: `SELECT COUNT(*)::bigint FROM deliveries d JOIN endpoints ep ON d.endpoint_id = ep.id WHERE ep.tenant_id = $1`
- **Definition**: Represents distinct event-to-endpoint dispatches. Multiple attempts for a single delivery do not increment `totalDeliveries`.

### 3.3. Successful Deliveries
$$\text{Successful Deliveries} = \sum_{d \in \text{deliveries}} 1 \quad \text{where } d.\text{state} = \text{'SUCCEEDED'}$$
- **PostgreSQL**: `COUNT(*) FILTER (WHERE d.state = 'SUCCEEDED')`
- **Definition**: Webhook dispatches that received an HTTP 2xx confirmation from destination endpoints.

### 3.4. Failed Deliveries (Dead Letter Queue / DLQ)
$$\text{Failed Deliveries} = \sum_{d \in \text{deliveries}} 1 \quad \text{where } d.\text{state} = \text{'DEAD'}$$
- **PostgreSQL**: `COUNT(*) FILTER (WHERE d.state = 'DEAD')`
- **Definition**: Deliveries that exhausted their retry ceiling (`attempt_count >= max_attempts`) or failed with non-retryable errors.

### 3.5. Pending & In-Flight Deliveries
$$\text{Pending Deliveries} = \sum_{d \in \text{deliveries}} 1 \quad \text{where } d.\text{state} \in \{\text{'PENDING'}, \text{'IN\_FLIGHT'}, \text{'RETRYING'}\}$$
- **PostgreSQL**: `COUNT(*) FILTER (WHERE d.state IN ('PENDING', 'IN_FLIGHT', 'RETRYING'))`
- **Definition**: Deliveries actively awaiting worker leases, in transit over HTTP, or queued for exponential backoff retries.

### 3.6. Success Rate Percentage
$$\text{Success Rate} = \begin{cases} 100.0\% & \text{if } \text{Total Deliveries} = 0 \\ \operatorname{round}\left(\frac{\text{Successful Deliveries}}{\text{Total Deliveries}} \times 100, 1\right) & \text{if } \text{Total Deliveries} > 0 \end{cases}$$
- **Baseline Handling**: Clean `100.0%` returned when no deliveries exist, preventing `NaN`, `null`, or `0%` false failure alerts.

### 3.7. Average Delivery Latency
$$\text{Average Latency} = \begin{cases} 0\text{ ms} & \text{if } \text{Attempts} = 0 \\ \operatorname{round}\left(\frac{1}{N} \sum_{a \in \text{attempts}} a.\text{latency\_ms}\right) & \text{if } \text{Attempts} > 0 \end{cases}$$
- **PostgreSQL**:
  ```sql
  SELECT COALESCE(ROUND(AVG(a.latency_ms)), 0)::bigint AS avg_latency
  FROM delivery_attempts a
  JOIN deliveries d ON d.id = a.delivery_id
  JOIN endpoints ep ON d.endpoint_id = ep.id
  WHERE ep.tenant_id = $1
  ```
- **Definition**: True round-trip network and target response time in milliseconds across all recorded attempts.

### 3.8. Endpoint Health & Circuit Tripping
- **Active Endpoints**: `COUNT(*) FILTER (WHERE active = TRUE)`
- **Total Endpoints**: `COUNT(*)`
- **Open Circuits**: `COUNT(*) FILTER (WHERE circuit_state = 'OPEN')`

---

## 4. Architectural Implementation Details

### 4.1. Continuous Time Series Query (`generate_series`)

To prevent gaps in charts during low-traffic periods, the repository constructs a contiguous time-slot virtual table using PostgreSQL `generate_series`, then performs a `LEFT JOIN` against the delivery aggregations:

```sql
WITH time_slots AS (
  SELECT generate_series(
    date_trunc('hour', $2::timestamptz),
    date_trunc('hour', $3::timestamptz),
    interval '1 hour'
  ) AS slot
),
bucketed_deliveries AS (
  SELECT
    date_trunc('hour', d.created_at) AS slot,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE d.state = 'SUCCEEDED')::int AS succeeded,
    COUNT(*) FILTER (WHERE d.state = 'DEAD')::int AS failed,
    COUNT(*) FILTER (WHERE d.state IN ('PENDING', 'IN_FLIGHT', 'RETRYING'))::int AS pending
  FROM deliveries d
  JOIN endpoints ep ON d.endpoint_id = ep.id
  WHERE ep.tenant_id = $1
    AND d.created_at >= $2::timestamptz
    AND d.created_at <= $3::timestamptz
  GROUP BY 1
)
SELECT
  ts.slot AS timestamp,
  to_char(ts.slot, 'HH24:00') AS label,
  COALESCE(bd.total, 0) AS total,
  COALESCE(bd.succeeded, 0) AS succeeded,
  COALESCE(bd.failed, 0) AS failed,
  COALESCE(bd.pending, 0) AS pending
FROM time_slots ts
LEFT JOIN bucketed_deliveries bd ON ts.slot = bd.slot
ORDER BY ts.slot ASC;
```

For `7d` and `30d` ranges, `date_trunc('day', ...)` with `interval '1 day'` and `to_char(ts.slot, 'Mon DD')` is used, producing clean, human-readable labels (`"Nov 06"`).

### 4.2. Delivery Status Distribution

For pie and donut charts in the frontend, the backend maps state counts into a normalized 5-category array with UI color codes:

```json
[
  { "name": "Succeeded", "value": 15, "color": "#10b981" },
  { "name": "Retrying", "value": 2, "color": "#f59e0b" },
  { "name": "Dead Letter", "value": 1, "color": "#ef4444" },
  { "name": "In Flight", "value": 0, "color": "#6366f1" },
  { "name": "Pending", "value": 3, "color": "#3b82f6" }
]
```

---

## 5. API Endpoints Specification

All metrics endpoints require Bearer API key authentication (`Authorization: Bearer <key>`) and are tenant-scoped:

| Method | Path | Query Parameters | Description | Response Schema |
|---|---|---|---|---|
| `GET` | `/metrics` | `range` (`24h`, `7d`, `30d`), `startDate`, `endDate` | Overview metrics and KPIs | `OverviewMetrics` |
| `GET` | `/metrics/overview` | (same as `/metrics`) | Alias for `/metrics` | `OverviewMetrics` |
| `GET` | `/metrics/timeseries` | `range`, `startDate`, `endDate`, `interval` (`hour`, `day`) | Contiguous bucketed throughput series | `TimeSeriesDataPoint[]` |
| `GET` | `/metrics/distribution` | `range`, `startDate`, `endDate` | State breakdown for pie charts | `StatusDistribution[]` |
| `GET` | `/metrics/endpoints` | none | Per-endpoint reliability breakdown | `EndpointBreakdown[]` |

### Sample `GET /metrics` Response
```json
{
  "totalEvents": 14,
  "totalDeliveries": 18,
  "succeededDeliveries": 16,
  "failedDeliveries": 1,
  "pendingDeliveries": 1,
  "retryingDeliveries": 1,
  "deadLetterDeliveries": 1,
  "successRate": 88.9,
  "averageLatencyMs": 54,
  "activeEndpoints": 2,
  "totalEndpoints": 2,
  "openCircuits": 0
}
```

---

## 6. Database Comparison & Verification

Direct SQL comparisons against HookForge tables confirm exact metric alignment:

| Metric | PostgreSQL Table & Condition | API Contract Field | Verification Result |
|---|---|---|---|
| Ingested Volume | `COUNT(*)` from `events WHERE tenant_id = $1` | `totalEvents` | Exact match |
| Enqueued Dispatches | `COUNT(*)` from `deliveries d JOIN endpoints ep ...` | `totalDeliveries` | Exact match |
| Successful Dispatches | `WHERE d.state = 'SUCCEEDED'` | `succeededDeliveries` | Exact match |
| Dead Letter Queue | `WHERE d.state = 'DEAD'` | `failedDeliveries` | Exact match |
| Active Retries | `WHERE d.state = 'RETRYING'` | `retryingDeliveries` | Exact match |
| Processing Queue | `WHERE d.state IN ('PENDING', 'IN_FLIGHT', 'RETRYING')` | `pendingDeliveries` | Exact match |
| Dispatch Latency | `AVG(latency_ms)` from `delivery_attempts` | `averageLatencyMs` | Rounded integer match |
| Tripped Endpoints | `WHERE circuit_state = 'OPEN'` | `openCircuits` | Exact match |

---

## 7. Frontend Verification

1. **Dashboard Overview (`DashboardPage.tsx`)**:
   - `Total Events`, `Successful Deliveries`, `Dead Letters`, `Pending & In-Flight`, and `Success Rate` display live counts from PostgreSQL.
   - `Delivery Throughput Over Time` renders a smooth, continuous 24-hour gradient area chart with real hourly volumes.
   - `Status Distribution` donut chart renders live proportions across all 5 states.
2. **Delivery Analytics (`AnalyticsPage.tsx`)**:
   - Toggling `24H`, `7D`, and `30D` buttons triggers dynamic re-fetching with `range` parameters.
   - Failure Rate KPI card calculates `(failedDeliveries / totalDeliveries) * 100` dynamically.
   - `Delivery Outcomes Over Time` bar chart displays live hourly ratios of succeeded vs dead letter dispatches.
   - `Total Dispatch Throughput` area chart shows continuous delivery dispatches.
   - `Endpoint Reliability Breakdown` table displays destination URL, circuit badge, rate ceiling, total deliveries recorded, and formatted success percentage.
3. **Zero-Event & Empty Database Handling**:
   - Verified that a tenant with 0 events renders `0` for counts, `100.0%` for success rate, and `0ms` for latency without throwing `NaN` or unhandled exceptions.

---

## 8. Test Execution Results

### 8.1. Backend Automated Test Suite
- **Command**: `npm test`
- **Results**:
  - Test Files: **23 passed** (100%)
  - Total Tests: **191 passed**, 0 failed, 0 skipped
  - Execution Time: 10.20s

```
 ✓ test/services/resilience/thresholdCircuitBreaker.test.js (11 tests)
 ✓ test/repositories/tenantRepository.test.js (4 tests)
 ✓ test/services/ingest/eventIngestService.test.js (3 tests)
 ✓ test/services/endpointService.test.js (11 tests)
 ✓ test/services/delivery/attemptExecutor.test.js (1 test)
 ✓ test/repositories/endpointRepository.test.js (15 tests)
 ✓ test/services/delivery/outcomeHandler.test.js (7 tests)
 ✓ test/services/analyticsService.test.js (14 tests)
 ✓ test/routes/events.test.js (4 tests)
 ✓ test/services/resilience/leaseReaper.test.js (4 tests)
 ✓ test/middleware/auth.test.js (18 tests)
 ✓ test/middleware/cors.test.js (14 tests)
 ✓ test/repositories/deliveryRepository.test.js (8 tests)
 ✓ test/routes/endpoints.test.js (12 tests)
 ✓ test/routes/deliveries.test.js (9 tests)
 ✓ test/services/delivery/deliveryService.test.js (7 tests)
 ✓ test/repositories/analyticsRepository.test.js (6 tests)
 ✓ test/services/resilience/exponentialJitterRetryPolicy.test.js (12 tests)
 ✓ test/services/resilience/tokenBucketRateLimiter.test.js (6 tests)
 ✓ test/errorHandler.test.js (6 tests)
 ✓ test/config.test.js (8 tests)
 ✓ test/health.test.js (2 tests)
 ✓ test/routes/metrics.test.js (9 tests)

 Test Files  23 passed (23)
      Tests  191 passed (191)
```

### 8.2. Frontend Automated Test Suite
- **Command**: `npm test`
- **Results**:
  - Test Files: **2 passed** (100%)
  - Total Tests: **10 passed**, 0 failed
  - Execution Time: 783ms

### 8.3. Frontend Production Build
- **Command**: `npm run build`
- **Results**:
  - `tsc -b`: Typecheck clean, 0 TypeScript errors.
  - `vite build`: Built in 9.42s with 2,558 transformed modules.

---

## 9. Remaining Issues & Next Steps

1. **Docker Host Loopback in Development**:
   - On Windows WSL2 host environments, loopback port mapping (`5434:5432`) is subject to Windows sandbox network isolation. The application runs cleanly inside the official Docker container stack (`docker compose up`) and outside the Windows sandbox using documented host port bindings.
2. **Future Enhancement - Ingest Throughput Metric**:
   - Currently, time series charts track delivery outcomes (`deliveries`). A separate ingest volume time series (`events` created over time) could be added to visualize fan-out ratios (events vs deliveries).
3. **Branch Hygiene**:
   - All code modifications and tests remain safely on branch `mannat` without automatic commits or pushes.

