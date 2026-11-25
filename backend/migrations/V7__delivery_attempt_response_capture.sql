-- V7: Delivery Attempt Response Capture and Headers
--
-- Features:
--  * Adds response_body TEXT to capture destination HTTP response bodies (safely truncated)
--  * Adds response_headers JSONB to capture destination HTTP response headers
--  * Adds request_headers JSONB to capture outbound HTTP request headers (safely redacted)

ALTER TABLE delivery_attempts
    ADD COLUMN IF NOT EXISTS response_body TEXT,
    ADD COLUMN IF NOT EXISTS response_headers JSONB,
    ADD COLUMN IF NOT EXISTS request_headers JSONB;
