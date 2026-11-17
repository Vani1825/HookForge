/**
 * Script to migrate legacy plaintext webhook secrets to AES-256-GCM encrypted format.
 *
 * Usage:
 *   node scripts/migrate-secrets.js [options]
 *
 * Options:
 *   --dry-run        Inspect and report unmigrated records without modifying the database.
 *   --keep-legacy    Retain plaintext secrets in the legacy `secret` column during transition.
 *                    (By default, plaintext secrets are cleared: secret = NULL).
 *   --clear-legacy   Explicitly confirm clearing plaintext secrets (default behavior).
 *   --help, -h       Show this help message.
 */

import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../src/config/index.js';
import { encryptSecret } from '../src/utils/secretEncryption.js';

/**
 * Parse and validate CLI arguments.
 *
 * @param {string[]} [args]
 * @returns {{ isDryRun: boolean, clearLegacy: boolean }}
 */
export function parseArgs(args = process.argv.slice(2)) {
  const isDryRun = args.includes('--dry-run');
  const keepLegacy = args.includes('--keep-legacy');
  const clearLegacyExplicit = args.includes('--clear-legacy');

  if (keepLegacy && clearLegacyExplicit) {
    throw new Error(
      'Conflicting options: cannot specify both --keep-legacy and --clear-legacy'
    );
  }

  // Plaintext clearing is the default behavior unless --keep-legacy is specified
  const clearLegacy = !keepLegacy;

  return { isDryRun, clearLegacy };
}

/**
 * Print CLI usage documentation.
 */
export function printHelp() {
  console.log(`
HookForge Webhook Secret Encryption Migration

Usage:
  node scripts/migrate-secrets.js [options]

Options:
  --dry-run        Inspect and report unmigrated records without modifying the database.
  --keep-legacy    Retain plaintext secrets in the legacy \`secret\` column during transition.
                   (By default, plaintext secrets are cleared: secret = NULL).
  --clear-legacy   Explicitly confirm clearing plaintext secrets (default behavior).
  --help, -h       Show this help message.
`);
}

/**
 * Perform secret migration using a connected PostgreSQL client.
 *
 * @param {Object} client - PostgreSQL client
 * @param {Object} [options]
 * @param {boolean} [options.isDryRun=false]
 * @param {boolean} [options.clearLegacy=true]
 * @param {Object} [options.logger=console]
 * @returns {Promise<{ totalUnmigrated: number, migratedCount: number, dryRun: boolean }>}
 */
export async function migrateSecrets(client, options = {}) {
  const { isDryRun = false, clearLegacy = true, logger = console } = options;

  if (isDryRun) {
    logger.log('Mode: DRY-RUN (no database changes will be applied)');
    const countResult = await client.query(`
      SELECT count(*)::int AS count
      FROM endpoints
      WHERE secret_ciphertext IS NULL AND secret IS NOT NULL
    `);
    const unmigratedCount = countResult.rows[0]?.count ?? 0;
    logger.log(
      `Dry-run complete. Found ${unmigratedCount} unmigrated endpoint(s) requiring encryption.`
    );
    return {
      totalUnmigrated: unmigratedCount,
      migratedCount: 0,
      dryRun: true,
    };
  }

  logger.log(`Mode: LIVE (clear legacy plaintext: ${clearLegacy})`);

  // 1. Begin transaction before selecting records
  await client.query('BEGIN');
  let inTransaction = true;

  try {
    // 2. Select unmigrated rows within the transaction with FOR UPDATE (ordered by id for stable lock order)
    const selectSql = `
      SELECT id, secret
      FROM endpoints
      WHERE secret_ciphertext IS NULL AND secret IS NOT NULL
      ORDER BY id ASC
      FOR UPDATE
    `;

    const { rows: unmigrated } = await client.query(selectSql);
    logger.log(`Found ${unmigrated.length} unmigrated endpoint(s) to process.`);

    if (unmigrated.length === 0) {
      logger.log(
        'All endpoints already have encrypted secrets. Nothing to migrate.'
      );
      await client.query('COMMIT');
      inTransaction = false;
      return { totalUnmigrated: 0, migratedCount: 0, dryRun: false };
    }

    // 3. Encrypt and update each row within the same transaction
    let migratedCount = 0;
    const updateSql = `
      UPDATE endpoints
      SET secret_ciphertext = $1,
          secret_iv = $2,
          secret_tag = $3,
          secret_version = $4,
          secret = $5
      WHERE id = $6
        AND secret_ciphertext IS NULL
        AND secret IS NOT NULL
    `;

    for (const endpoint of unmigrated) {
      // encryptSecret validates key and throws EncryptionError if key is missing/invalid
      const encrypted = encryptSecret(endpoint.secret);
      const legacySecretValue = clearLegacy ? null : endpoint.secret;

      const updateResult = await client.query(updateSql, [
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        encrypted.version,
        legacySecretValue,
        endpoint.id,
      ]);

      if (updateResult.rowCount !== 1) {
        throw new Error(
          `Concurrent modification detected for endpoint ${endpoint.id}: expected 1 row updated, got ${updateResult.rowCount}`
        );
      }
      migratedCount++;
    }

    // 4. Commit transaction
    await client.query('COMMIT');
    inTransaction = false;
    logger.log(
      `Successfully migrated ${migratedCount} endpoint secret(s) to AES-256-GCM encryption.`
    );

    return {
      totalUnmigrated: unmigrated.length,
      migratedCount,
      dryRun: false,
    };
  } catch (err) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('Rollback failed:', rollbackErr.message);
      }
    }
    throw err;
  }
}

/**
 * Main migration runner. Manages pool connection, execution, and reliable resource cleanup.
 *
 * @param {Object|null} [customPool] - Optional pool for testing
 * @param {string[]|null} [customArgs] - Optional args for testing
 * @returns {Promise<number>} Exit code (0 for success, 1 for failure)
 */
export async function runSecretMigration(
  customPool = null,
  customArgs = null
) {
  const args = customArgs || process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  let client = null;
  let pool = customPool;
  let exitCode = 0;

  try {
    const { isDryRun, clearLegacy } = parseArgs(args);

    if (!pool) {
      pool = new pg.Pool({
        host: config.database.host,
        port: config.database.port,
        database: config.database.database,
        user: config.database.user,
        password: config.database.password,
      });
    }

    console.log('--- HookForge Webhook Secret Encryption Migration ---');
    client = await pool.connect();
    await migrateSecrets(client, { isDryRun, clearLegacy, logger: console });
  } catch (err) {
    exitCode = 1;
    console.error('Migration failed:', err.message);
  } finally {
    // Ensure client is released reliably
    if (client) {
      try {
        client.release();
      } catch {
        // ignore release errors
      }
    }
    // Ensure pool is closed reliably if created internally
    if (!customPool && pool) {
      try {
        await pool.end();
      } catch {
        // ignore pool closure errors
      }
    }
  }

  if (exitCode !== 0 && !customPool) {
    process.exitCode = exitCode;
  }

  return exitCode;
}

// Execute when invoked directly from CLI
const isDirectExecution =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  runSecretMigration();
}

export default {
  parseArgs,
  printHelp,
  migrateSecrets,
  runSecretMigration,
};
