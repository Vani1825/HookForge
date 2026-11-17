-- V3: Composite indexes for tenant date-range queries, event pagination, and delivery lookups
--
-- Performance optimization:
--  * idx_events_tenant_created: Optimizes tenant-scoped event listing and pagination (ORDER BY created_at DESC)
--  * idx_deliveries_endpoint_created: Optimizes endpoint-scoped delivery listing and pagination (ORDER BY created_at DESC)

CREATE INDEX IF NOT EXISTS idx_events_tenant_created
    ON events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint_created
    ON deliveries (endpoint_id, created_at DESC);
