-- V4: Schema extensions for Scheduled Deliveries and Bulk Replay
--
-- Features:
--  * Adds `scheduled_at` timestamp column to track scheduled execution time.
--  * Relaxes/updates state CHECK constraint on `deliveries` table to include
--    'SCHEDULED' and 'CANCELLED' states.
--  * Adds partial index on `(next_attempt_at) WHERE state = 'SCHEDULED'`
--    for high-performance dispatcher promotion.
--  * Adds composite index on `(endpoint_id, state, scheduled_at)` for
--    efficient status queries and tenant isolation.

ALTER TABLE deliveries
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

DO $$
BEGIN
    -- Drop existing check constraint if it exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'deliveries_state_check'
    ) THEN
        ALTER TABLE deliveries DROP CONSTRAINT deliveries_state_check;
    END IF;

    -- Add updated check constraint including SCHEDULED and CANCELLED
    ALTER TABLE deliveries ADD CONSTRAINT deliveries_state_check
        CHECK (state IN ('SCHEDULED', 'PENDING', 'IN_FLIGHT', 'RETRYING', 'SUCCEEDED', 'DEAD', 'CANCELLED'));
END $$;

CREATE INDEX IF NOT EXISTS idx_deliveries_scheduled
    ON deliveries (next_attempt_at)
    WHERE state = 'SCHEDULED';

CREATE INDEX IF NOT EXISTS idx_deliveries_scheduled_lookup
    ON deliveries (endpoint_id, state, scheduled_at);

