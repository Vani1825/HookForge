-- V2: Encrypted webhook secrets at rest (AES-256-GCM)
--
-- Security hardening:
--  * Adds dedicated columns for ciphertext, IV (12-byte base64), authentication tag (16-byte base64),
--    and encryption version.
--  * Relaxes the NOT NULL constraint on `secret` so that all new records can store secrets
--    exclusively in encrypted form, with `secret` column as NULL.
--  * Enforces database schema integrity via CHECK constraints:
--      1. chk_endpoints_secret_encryption: Ciphertext, IV, auth tag, and version must be either
--         ALL NULL (legacy plaintext record) or ALL POPULATED with a supported version (secret_version = 1).
--      2. chk_endpoints_secret_present: Every endpoint must have at least one secret representation
--         (plaintext secret IS NOT NULL OR secret_ciphertext IS NOT NULL).
--  * Existing legacy plaintext records remain completely valid.

ALTER TABLE endpoints
    ADD COLUMN IF NOT EXISTS secret_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS secret_iv TEXT,
    ADD COLUMN IF NOT EXISTS secret_tag TEXT,
    ADD COLUMN IF NOT EXISTS secret_version INT;

ALTER TABLE endpoints ALTER COLUMN secret DROP NOT NULL;

-- Ensure legacy rows where secret_ciphertext is NULL have secret_version set to NULL
UPDATE endpoints
SET secret_version = NULL
WHERE secret_ciphertext IS NULL AND secret_version IS NOT NULL;

-- Remove any default from secret_version so legacy inserts do not unintentionally set version
ALTER TABLE endpoints ALTER COLUMN secret_version DROP DEFAULT;

-- Add integrity constraints idempotently
DO $$
BEGIN
    -- Constraint 1: All encrypted components must be present together with supported version, or all NULL
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_endpoints_secret_encryption'
    ) THEN
        ALTER TABLE endpoints ADD CONSTRAINT chk_endpoints_secret_encryption
            CHECK (
                (
                    secret_ciphertext IS NULL
                    AND secret_iv IS NULL
                    AND secret_tag IS NULL
                    AND secret_version IS NULL
                )
                OR
                (
                    secret_ciphertext IS NOT NULL
                    AND secret_iv IS NOT NULL
                    AND secret_tag IS NOT NULL
                    AND secret_version IS NOT NULL
                    AND secret_version = 1
                )
            );
    END IF;

    -- Constraint 2: An endpoint must have at least one secret representation
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_endpoints_secret_present'
    ) THEN
        ALTER TABLE endpoints ADD CONSTRAINT chk_endpoints_secret_present
            CHECK (
                secret IS NOT NULL OR secret_ciphertext IS NOT NULL
            );
    END IF;
END $$;
