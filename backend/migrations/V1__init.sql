-- V1: core schema for the webhook delivery platform.
--
-- Design notes (SD engineer + senior):
--  * Postgres IS the queue. The `deliveries` table is the work queue; workers claim rows with
--    FOR UPDATE SKIP LOCKED + a lease (lease_until) so a crashed worker never wedges an endpoint.
--  * Per-endpoint ordering comes from `seq`, allocated at ingest time from endpoints.next_seq.
--    UNIQUE (endpoint_id, seq) makes a double-allocation impossible.
--  * Terminal states are SUCCEEDED and DEAD. A DEAD delivery releases the endpoint's head-of-line;
--    replaying it later is therefore NOT order-preserving (documented limitation).

CREATE TABLE tenants (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT        NOT NULL,
    api_key_hash  TEXT        NOT NULL UNIQUE,          -- SHA-256 hex of the API key, never the key itself
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE endpoints (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL REFERENCES tenants (id),
    url                   TEXT        NOT NULL,
    secret                TEXT        NOT NULL,          -- HMAC signing secret (shown once on create)
    active                BOOLEAN     NOT NULL DEFAULT TRUE,
    rate_limit_rps        INT         NOT NULL DEFAULT 10 CHECK (rate_limit_rps > 0),
    next_seq              BIGINT      NOT NULL DEFAULT 1, -- next sequence number to hand out at ingest
    circuit_state         TEXT        NOT NULL DEFAULT 'CLOSED'
                              CHECK (circuit_state IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
    circuit_until         TIMESTAMPTZ,                   -- when an OPEN circuit may be probed again
    consecutive_failures  INT         NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_endpoints_tenant ON endpoints (tenant_id);

CREATE TABLE events (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL REFERENCES tenants (id),
    payload          JSONB       NOT NULL,
    idempotency_key  TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_events_idempotency UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE deliveries (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id         UUID        NOT NULL REFERENCES events (id),
    endpoint_id      UUID        NOT NULL REFERENCES endpoints (id),
    seq              BIGINT      NOT NULL,
    state            TEXT        NOT NULL DEFAULT 'PENDING'
                         CHECK (state IN ('PENDING', 'IN_FLIGHT', 'RETRYING', 'SUCCEEDED', 'DEAD')),
    attempt_count    INT         NOT NULL DEFAULT 0,
    next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until      TIMESTAMPTZ,
    last_error       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_deliveries_endpoint_seq  UNIQUE (endpoint_id, seq),
    CONSTRAINT uq_deliveries_event_endpoint UNIQUE (event_id, endpoint_id)
);

-- Claim query: "what is due?"
CREATE INDEX idx_deliveries_due
    ON deliveries (next_attempt_at)
    WHERE state IN ('PENDING', 'RETRYING');

-- Ordering check: "is there an earlier open delivery for this endpoint?"
CREATE INDEX idx_deliveries_endpoint_open
    ON deliveries (endpoint_id, seq)
    WHERE state IN ('PENDING', 'RETRYING', 'IN_FLIGHT');

-- Lease reaper: "which IN_FLIGHT rows have an expired lease?"
CREATE INDEX idx_deliveries_lease
    ON deliveries (lease_until)
    WHERE state = 'IN_FLIGHT';

-- Status APIs (GET /deliveries?state=DEAD, GET /events/{id}/deliveries)
CREATE INDEX idx_deliveries_state ON deliveries (state);
CREATE INDEX idx_deliveries_event ON deliveries (event_id);

CREATE TABLE delivery_attempts (
    id           BIGSERIAL   PRIMARY KEY,
    delivery_id  UUID        NOT NULL REFERENCES deliveries (id),
    attempt_no   INT         NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    status_code  INT,                                   -- NULL on connect error / timeout
    latency_ms   BIGINT      NOT NULL,
    error        TEXT
);
CREATE INDEX idx_attempts_delivery ON delivery_attempts (delivery_id, attempt_no);
