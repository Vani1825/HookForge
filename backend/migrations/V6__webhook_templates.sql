-- V6: Webhook Templates
--
-- Features:
--  * Predefined system templates (is_system = true, tenant_id = NULL)
--  * User-created tenant templates (is_system = false, tenant_id = tenant UUID)
--  * Reusable configurations: HTTP method, destination URL, custom headers, default payload, rate limits, retry policies

CREATE TABLE IF NOT EXISTS webhook_templates (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID        REFERENCES tenants (id) ON DELETE CASCADE,
    name                     TEXT        NOT NULL,
    description              TEXT,
    http_method              TEXT        NOT NULL DEFAULT 'POST'
                                         CHECK (http_method IN ('POST', 'PUT', 'PATCH', 'GET', 'DELETE')),
    url                      TEXT,
    custom_headers           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    default_payload          JSONB,
    rate_limit_rps           INT         NOT NULL DEFAULT 10
                                         CHECK (rate_limit_rps > 0 AND rate_limit_rps <= 500),
    retry_strategy           TEXT        NOT NULL DEFAULT 'EXPONENTIAL'
                                         CHECK (retry_strategy IN ('EXPONENTIAL', 'FIXED')),
    retry_max_attempts       INT         NOT NULL DEFAULT 8
                                         CHECK (retry_max_attempts >= 1 AND retry_max_attempts <= 50),
    retry_base_delay_ms      INT         NOT NULL DEFAULT 5000
                                         CHECK (retry_base_delay_ms >= 100 AND retry_base_delay_ms <= 86400000),
    retry_max_delay_ms       INT         NOT NULL DEFAULT 3600000
                                         CHECK (retry_max_delay_ms >= 100 AND retry_max_delay_ms <= 86400000),
    retry_backoff_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 2.0
                                         CHECK (retry_backoff_multiplier >= 1.0 AND retry_backoff_multiplier <= 10.0),
    is_system                BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_templates_tenant ON webhook_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_templates_system ON webhook_templates (is_system);

-- Seed predefined / system templates
INSERT INTO webhook_templates (
    id, tenant_id, name, description, http_method, url, custom_headers, default_payload,
    rate_limit_rps, retry_strategy, retry_max_attempts, retry_base_delay_ms, retry_max_delay_ms, retry_backoff_multiplier, is_system
) VALUES
(
    '00000000-0000-4000-8000-000000000001',
    NULL,
    'Slack Incoming Webhook',
    'Deliver notifications and alerts to Slack channels via incoming webhooks',
    'POST',
    'https://hooks.slack.com/services/PLACEHOLDER',
    '{"Content-Type": "application/json"}'::jsonb,
    '{"text": "HookForge webhook event dispatch"}'::jsonb,
    1, 'EXPONENTIAL', 5, 2000, 60000, 2.0, TRUE
),
(
    '00000000-0000-4000-8000-000000000002',
    NULL,
    'Discord Webhook',
    'Post messages and embed alerts into Discord channels',
    'POST',
    'https://discord.com/api/webhooks/PLACEHOLDER',
    '{"Content-Type": "application/json"}'::jsonb,
    '{"content": "HookForge notification", "username": "HookForge Bot"}'::jsonb,
    5, 'EXPONENTIAL', 5, 2000, 60000, 2.0, TRUE
),
(
    '00000000-0000-4000-8000-000000000003',
    NULL,
    'Stripe Event Forwarder',
    'High-throughput idempotent webhook receiver with rapid exponential backoff',
    'POST',
    NULL,
    '{"Content-Type": "application/json", "User-Agent": "HookForge-Relay/1.0"}'::jsonb,
    '{"event": "payment_intent.succeeded", "data": {}}'::jsonb,
    25, 'EXPONENTIAL', 10, 1000, 300000, 2.0, TRUE
),
(
    '00000000-0000-4000-8000-000000000004',
    NULL,
    'PagerDuty Events v2',
    'Trigger and resolve incidents via PagerDuty Events API v2',
    'POST',
    'https://events.pagerduty.com/v2/enqueue',
    '{"Content-Type": "application/json"}'::jsonb,
    '{"routing_key": "SERVICE_KEY", "event_action": "trigger", "payload": {"summary": "Alert from HookForge", "source": "hookforge", "severity": "error"}}'::jsonb,
    10, 'FIXED', 4, 5000, 5000, 1.0, TRUE
),
(
    '00000000-0000-4000-8000-000000000005',
    NULL,
    'Generic JSON Webhook',
    'Standard REST webhook with robust exponential backoff and retry ceiling',
    'POST',
    NULL,
    '{"Content-Type": "application/json"}'::jsonb,
    '{}'::jsonb,
    10, 'EXPONENTIAL', 8, 5000, 3600000, 2.0, TRUE
)
ON CONFLICT (id) DO NOTHING;

