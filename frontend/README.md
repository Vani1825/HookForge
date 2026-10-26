# HookForge Frontend

> Modern SaaS observability dashboard for **HookForge**, a reliable webhook delivery and monitoring platform.

Built with React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, and Recharts.

---

## Features

- **Reliability Overview Dashboard**:
  - Live KPI cards: Total Events, Successful Deliveries, Dead Letters, Pending & In-Flight count, and Success Rate %.
  - Throughput Over Time (Area Chart) and Status Distribution (Donut Chart) using Recharts.
  - Recent delivery activity table with direct link to inspection drawer.
  - Endpoint Circuit Health monitoring (Closed, Open, Half-Open).

- **Endpoints Management**:
  - Register new subscriber destinations with configurable Token-Bucket rate limits (RPS).
  - One-time HMAC signing secret disclosure modal with copy-to-clipboard functionality.
  - Active/pause toggle controls and real-time circuit breaker diagnostics.
  - URL validation and client-side error handling.

- **Event Explorer**:
  - Ingested event ledger with tenant-scoped idempotency keys.
  - Syntax-highlighted, crash-proof JSON viewer for arbitrary payloads.
  - Associated fan-out delivery inspection.
  - "Send Test Event" modal to publish simulated or real events with duplicate detection.

- **Delivery Pipeline Monitor**:
  - Full visibility into the PostgreSQL durable queue (`FOR UPDATE SKIP LOCKED`).
  - Strict sequence numbers (`#seq`) per endpoint to guarantee FIFO order.
  - Status badges for all 5 lifecycle states: `PENDING`, `IN_FLIGHT`, `RETRYING`, `SUCCEEDED`, and `DEAD`.
  - Detailed attempt history timeline with HTTP response codes, latencies, and stack traces.

- **Dead Letter Queue (DLQ) & Replay Management**:
  - Dedicated view for exhausted deliveries after retry policy depletion.
  - Diagnostic error reasons and failure timestamps.
  - Replay action with confirmation modal and explicit head-of-line non-ordering disclaimer.

- **Delivery Analytics**:
  - Success and failure rate gauges.
  - Average latency benchmarks and 24h throughput trends.
  - Per-endpoint breakdown table comparing volume, success rates, and circuit health.

- **Platform Settings & Live / Demo Modes**:
  - Seamless runtime toggle between **Demo Mode** (offline mock store) and **Live API Mode**.
  - Configurable Backend Base URL and Tenant API Key (`X-Api-Key`).
  - Built-in `GET /health` probe test button with visual indicators.
  - Overview of engine tunables (retry policies, dispatcher concurrency, circuit limits).

---

## Architecture & Guarantees

The frontend strictly reflects the PostgreSQL schema (`migrations/V1__init.sql`) and backend domain contracts:

| Concept | Implementation in Frontend |
|---|---|
| **Delivery States** | `PENDING`, `IN_FLIGHT`, `RETRYING`, `SUCCEEDED`, `DEAD` |
| **Circuit States** | `CLOSED` (Healthy), `HALF_OPEN` (Probing), `OPEN` (Tripped) |
| **Ordering** | Monotonically increasing sequence (`seq`) per endpoint allocated at ingest |
| **Idempotency** | Unique `(tenant_id, idempotency_key)` constraint. Duplicates return `duplicate: true` without enqueuing extra deliveries |
| **DLQ Replay** | Replaying a DEAD delivery re-enqueues it as PENDING with an updated sequence, releasing the endpoint head-of-line lock |

---

## Getting Started

### Prerequisites

- Node.js >= 20
- npm >= 10

### 1. Installation

```bash
cd frontend
npm install
```

### 2. Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Default variables in `.env`:

```env
# URL where your Express backend server is running
VITE_API_BASE_URL=http://localhost:8080

# Start in Demo Mode (true) or Live API Mode (false)
VITE_DEMO_MODE=true

# Optional tenant API key sent in X-Api-Key header
VITE_API_KEY=
```

> **Note:** Base URL and API Key can also be changed dynamically at runtime directly inside the **Settings** page without restarting Vite.

### 3. Start Development Server

```bash
npm run dev
```

Visit `http://localhost:5173` in your browser.

---

## Demo Mode vs Live Mode

HookForge Frontend includes an explicit **Demo Mode** to enable full interactive UI evaluation even before backend endpoints are deployed:

- **Demo Mode**:
  - Displays a persistent purple top banner.
  - Uses a stateful in-memory store (`src/mocks/mockStore.ts`) pre-seeded with realistic endpoints, deliveries, and payloads.
  - Creating endpoints, triggering events, and replaying dead letters actively mutate the in-memory state.
  - Zero network requests are sent to the backend.

- **Live Mode**:
  - Directly queries the HookForge Express server at `VITE_API_BASE_URL`.
  - Sends `X-Api-Key` and `Idempotency-Key` headers matching backend middleware.
  - If the backend is unreachable or returns HTTP errors, a descriptive error screen is displayed with a "Retry" and "Switch to Demo Mode" option.
  - **Never silently falls back to mock data.**

You can toggle between modes anytime via the pill switcher in the top navigation bar or inside **Settings**.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR on port 5173 |
| `npm run build` | Type-check with `tsc` and create production bundle in `dist/` |
| `npm run test` | Run Vitest unit tests |
| `npm run lint` | Run Oxlint fast linter |
| `npm run preview` | Preview production build locally |

---

## Connecting to Backend

When running HookForge backend locally:

1. In the root directory, start PostgreSQL and backend server:
   ```bash
   # In project root
   npm run dev
   ```
2. Verify backend is running on `http://localhost:8080/health`.
3. In the frontend, toggle the top bar switch to **Live API** or go to **Settings** and test the connection.

---

## Project Structure

```
frontend/
├── src/
│   ├── api/             # Centralized API client and route modules
│   ├── assets/          # Static logos and graphics
│   ├── components/      # Domain components & modals (CreateEndpoint, Replay, etc.)
│   │   └── ui/          # Generic reusable accessible UI primitives (Button, Modal, Drawer, etc.)
│   ├── context/         # Global AppContext (Mode, Health, Toasts, Unified Service)
│   ├── layouts/         # DashboardLayout, Sidebar, Header
│   ├── mocks/           # Fixtures and MockStore
│   ├── pages/           # Dashboard, Endpoints, Events, Deliveries, DeadLetters, Replay, Analytics, Settings
│   ├── test/            # Vitest unit test suites
│   ├── types/           # TypeScript definitions mirroring DB schema
│   ├── utils/           # Formatters and Tailwind helper
│   ├── App.tsx          # Router configuration
│   └── main.tsx         # Application entrypoint
├── .env.example
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```
