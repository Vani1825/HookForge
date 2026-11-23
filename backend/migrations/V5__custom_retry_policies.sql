-- V5: Custom Retry Policies for Endpoints
--
-- Features:
--  * Configurable retry strategy: 'EXPONENTIAL' or 'FIXED'
--  * Configurable max retry attempts (1 to 50)
--  * Configurable base delay in milliseconds (100ms to 24h)
--  * Configurable maximum delay in milliseconds (100ms to 24h)
--  * Configurable backoff multiplier for exponential strategy (1.0 to 10.0)

ALTER TABLE endpoints
    ADD COLUMN IF NOT EXISTS retry_strategy TEXT NOT NULL DEFAULT 'EXPONENTIAL',
    ADD COLUMN IF NOT EXISTS retry_max_attempts INT NOT NULL DEFAULT 8,
    ADD COLUMN IF NOT EXISTS retry_base_delay_ms INT NOT NULL DEFAULT 5000,
    ADD COLUMN IF NOT EXISTS retry_max_delay_ms INT NOT NULL DEFAULT 3600000,
    ADD COLUMN IF NOT EXISTS retry_backoff_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 2.0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'endpoints_retry_strategy_check'
    ) THEN
        ALTER TABLE endpoints ADD CONSTRAINT endpoints_retry_strategy_check
            CHECK (retry_strategy IN ('EXPONENTIAL', 'FIXED'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'endpoints_retry_max_attempts_check'
    ) THEN
        ALTER TABLE endpoints ADD CONSTRAINT endpoints_retry_max_attempts_check
            CHECK (retry_max_attempts >= 1 AND retry_max_attempts <= 50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'endpoints_retry_base_delay_ms_check'
    ) THEN
        ALTER TABLE endpoints ADD CONSTRAINT endpoints_retry_base_delay_ms_check
            CHECK (retry_base_delay_ms >= 100 AND retry_base_delay_ms <= 86400000);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'endpoints_retry_max_delay_ms_check'
    ) THEN
        ALTER TABLE endpoints ADD CONSTRAINT endpoints_retry_max_delay_ms_check
            CHECK (retry_max_delay_ms >= 100 AND retry_max_delay_ms <= 86400000);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'endpoints_retry_backoff_multiplier_check'
    ) THEN
        ALTER TABLE endpoints ADD CONSTRAINT endpoints_retry_backoff_multiplier_check
            CHECK (retry_backoff_multiplier >= 1.0 AND retry_backoff_multiplier <= 10.0);
    END IF;
END $$;

