-- V8: Multi-tenant SaaS user registration, authentication, workspace memberships, and API keys
--
-- Features:
--  * `users` table for browser authentication with secure password hashing.
--  * `workspace_memberships` connecting users to existing `tenants` (workspaces) with role-based access.
--  * `user_sessions` for secure server-side session token tracking with SHA-256 hashing.
--  * `password_reset_tokens` for short-lived, single-use password recovery.
--  * `email_verification_tokens` for account verification workflows.
--  * `api_keys` table for multiple workspace API keys with prefixes, last_used tracking, and revocation.
--  * Forward-compatible backfill preserving existing `tenants.api_key_hash` credentials.

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email_verified_at TIMESTAMPTZ NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_lower_email
    ON users (LOWER(email));

-- 2. Workspace Memberships (Users <-> Tenants/Workspaces)
CREATE TABLE IF NOT EXISTS workspace_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user
    ON workspace_memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_memberships_tenant
    ON workspace_memberships (tenant_id);

-- 3. Browser Sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires
    ON user_sessions (expires_at);

-- 4. Password Reset Tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_user
    ON password_reset_tokens (user_id);

-- 5. Email Verification Tokens
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_verify_user
    ON email_verification_tokens (user_id);

-- 6. Workspace API Keys
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL DEFAULT 'Default API Key',
    key_prefix VARCHAR(16) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant
    ON api_keys (tenant_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_active_lookup
    ON api_keys (key_hash)
    WHERE revoked_at IS NULL;

-- 7. Seed / Backfill existing tenants into api_keys table for backward compatibility
INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, created_at)
SELECT
    id,
    'Default API Key',
    'whkey_',
    api_key_hash,
    created_at
FROM tenants
WHERE api_key_hash IS NOT NULL
ON CONFLICT (key_hash) DO NOTHING;
