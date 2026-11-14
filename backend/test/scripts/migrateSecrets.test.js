/**
 * Unit tests for migrate-secrets script.
 * Verifies concurrency safety, dry-run, rollback, CLI parsing, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseArgs,
  migrateSecrets,
  runSecretMigration,
} from '../../scripts/migrate-secrets.js';
import { EncryptionError } from '../../src/utils/secretEncryption.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('migrate-secrets script', () => {
  const originalEnvKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  const testKeyBase64 = crypto.randomBytes(32).toString('base64');

  beforeEach(() => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = testKeyBase64;
  });

  afterEach(() => {
    if (originalEnvKey !== undefined) {
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalEnvKey;
    } else {
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    }
  });

  describe('CLI Argument Parsing (parseArgs)', () => {
    it('should default to clearLegacy = true when no flags passed', () => {
      const parsed = parseArgs([]);
      expect(parsed.isDryRun).toBe(false);
      expect(parsed.clearLegacy).toBe(true);
    });

    it('should set isDryRun = true when --dry-run is passed', () => {
      const parsed = parseArgs(['--dry-run']);
      expect(parsed.isDryRun).toBe(true);
      expect(parsed.clearLegacy).toBe(true);
    });

    it('should set clearLegacy = false when --keep-legacy is passed', () => {
      const parsed = parseArgs(['--keep-legacy']);
      expect(parsed.isDryRun).toBe(false);
      expect(parsed.clearLegacy).toBe(false);
    });

    it('should set clearLegacy = true when --clear-legacy is explicitly passed', () => {
      const parsed = parseArgs(['--clear-legacy']);
      expect(parsed.clearLegacy).toBe(true);
    });

    it('should throw an error if both --keep-legacy and --clear-legacy are passed', () => {
      expect(() => parseArgs(['--keep-legacy', '--clear-legacy'])).toThrow(
        /conflicting options/i
      );
    });
  });

  describe('Dry-run behavior (migrateSecrets)', () => {
    it('should inspect and report unmigrated records without modifying the database', async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: [{ count: 5 }],
      });
      const mockClient = { query: mockQuery };
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const result = await migrateSecrets(mockClient, {
        isDryRun: true,
        logger: mockLogger,
      });

      expect(result.dryRun).toBe(true);
      expect(result.totalUnmigrated).toBe(5);
      expect(result.migratedCount).toBe(0);

      // Verify read-only count query was executed
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT count(*)::int AS count')
      );

      // Verify no transaction commands or update queries were issued
      expect(mockQuery).not.toHaveBeenCalledWith('BEGIN');
      expect(mockQuery).not.toHaveBeenCalledWith('COMMIT');
      expect(mockQuery).not.toHaveBeenCalledWith('ROLLBACK');
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE endpoints')
      );

      // Verify logs do not expose any secrets
      const allLogMessages = mockLogger.log.mock.calls.flat().join(' ');
      expect(allLogMessages).toContain('DRY-RUN');
      expect(allLogMessages).not.toContain('whsec_');
    });
  });

  describe('Concurrency-safe live migration (migrateSecrets)', () => {
    it('should begin transaction, select with FOR UPDATE, update records, and commit', async () => {
      const queryHistory = [];
      const mockRows = [
        { id: 'ep-1', secret: 'whsec_secret_one_123' },
        { id: 'ep-2', secret: 'whsec_secret_two_456' },
      ];

      const mockClient = {
        query: vi.fn().mockImplementation((sql, params) => {
          queryHistory.push({ sql: sql.trim(), params });
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return Promise.resolve();
          }
          if (sql.includes('SELECT id, secret')) {
            return Promise.resolve({ rows: mockRows });
          }
          if (sql.includes('UPDATE endpoints')) {
            return Promise.resolve({ rowCount: 1 });
          }
          return Promise.resolve({ rows: [] });
        }),
      };
      const mockLogger = { log: vi.fn(), error: vi.fn() };

      const result = await migrateSecrets(mockClient, {
        isDryRun: false,
        clearLegacy: true,
        logger: mockLogger,
      });

      expect(result.dryRun).toBe(false);
      expect(result.totalUnmigrated).toBe(2);
      expect(result.migratedCount).toBe(2);

      // 1. Transaction must be opened FIRST
      expect(queryHistory[0].sql).toBe('BEGIN');

      // 2. Select must be inside transaction with FOR UPDATE ordered by id
      expect(queryHistory[1].sql).toContain('FOR UPDATE');
      expect(queryHistory[1].sql).toContain('ORDER BY id ASC');

      // 3. Updates must update only unmigrated rows where secret_ciphertext IS NULL
      const updateQueries = queryHistory.filter((q) =>
        q.sql.startsWith('UPDATE endpoints')
      );
      expect(updateQueries).toHaveLength(2);
      for (const update of updateQueries) {
        expect(update.sql).toContain('WHERE id = $6');
        expect(update.sql).toContain('AND secret_ciphertext IS NULL');
        expect(update.sql).toContain('AND secret IS NOT NULL');
        // Legacy secret cleared by default (param index 4 is legacySecretValue)
        expect(update.params[4]).toBeNull();
        // Version 1 is populated
        expect(update.params[3]).toBe(1);
      }

      // 4. Transaction must be committed at the end
      expect(queryHistory[queryHistory.length - 1].sql).toBe('COMMIT');
    });

    it('should retain legacy plaintext secret when clearLegacy is false (--keep-legacy)', async () => {
      const updateParams = [];
      const mockClient = {
        query: vi.fn().mockImplementation((sql, params) => {
          if (sql.includes('SELECT id, secret')) {
            return Promise.resolve({
              rows: [{ id: 'ep-1', secret: 'whsec_keep_me' }],
            });
          }
          if (sql.includes('UPDATE endpoints')) {
            updateParams.push(params);
            return Promise.resolve({ rowCount: 1 });
          }
          return Promise.resolve();
        }),
      };

      await migrateSecrets(mockClient, {
        isDryRun: false,
        clearLegacy: false,
        logger: { log: vi.fn(), error: vi.fn() },
      });

      expect(updateParams).toHaveLength(1);
      // When keepLegacy is true (clearLegacy: false), legacy secret column retains original secret
      expect(updateParams[0][4]).toBe('whsec_keep_me');
    });

    it('should handle zero unmigrated records cleanly without running updates', async () => {
      const queryHistory = [];
      const mockClient = {
        query: vi.fn().mockImplementation((sql) => {
          queryHistory.push(sql);
          if (sql.includes('SELECT id, secret')) {
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve();
        }),
      };

      const result = await migrateSecrets(mockClient, {
        isDryRun: false,
        logger: { log: vi.fn(), error: vi.fn() },
      });

      expect(result.totalUnmigrated).toBe(0);
      expect(result.migratedCount).toBe(0);
      expect(queryHistory).toContain('BEGIN');
      expect(queryHistory).toContain('COMMIT');
      expect(
        queryHistory.some(
          (q) => typeof q === 'string' && q.includes('UPDATE endpoints')
        )
      ).toBe(false);
    });

    it('should roll back all changes if an update fails', async () => {
      const queryHistory = [];
      const mockClient = {
        query: vi.fn().mockImplementation((sql) => {
          queryHistory.push(sql);
          if (sql.includes('SELECT id, secret')) {
            return Promise.resolve({
              rows: [{ id: 'ep-fail', secret: 'whsec_fail' }],
            });
          }
          if (sql.includes('UPDATE endpoints')) {
            return Promise.reject(new Error('PostgreSQL connection timeout'));
          }
          return Promise.resolve();
        }),
      };

      await expect(
        migrateSecrets(mockClient, {
          isDryRun: false,
          logger: { log: vi.fn(), error: vi.fn() },
        })
      ).rejects.toThrow('PostgreSQL connection timeout');

      expect(queryHistory).toContain('BEGIN');
      expect(queryHistory).toContain('ROLLBACK');
      expect(queryHistory).not.toContain('COMMIT');
    });

    it('should detect concurrent modification and roll back when rowCount is not 1', async () => {
      const queryHistory = [];
      const mockClient = {
        query: vi.fn().mockImplementation((sql) => {
          queryHistory.push(sql);
          if (sql.includes('SELECT id, secret')) {
            return Promise.resolve({
              rows: [{ id: 'ep-concurrent', secret: 'whsec_concurrent' }],
            });
          }
          if (sql.includes('UPDATE endpoints')) {
            // Another worker already migrated this row between select and update
            return Promise.resolve({ rowCount: 0 });
          }
          return Promise.resolve();
        }),
      };

      await expect(
        migrateSecrets(mockClient, {
          isDryRun: false,
          logger: { log: vi.fn(), error: vi.fn() },
        })
      ).rejects.toThrow(/concurrent modification detected/i);

      expect(queryHistory).toContain('BEGIN');
      expect(queryHistory).toContain('ROLLBACK');
      expect(queryHistory).not.toContain('COMMIT');
    });

    it('should roll back and not modify records if encryption key is missing', async () => {
      delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

      const queryHistory = [];
      const mockClient = {
        query: vi.fn().mockImplementation((sql) => {
          queryHistory.push(sql);
          if (sql.includes('SELECT id, secret')) {
            return Promise.resolve({
              rows: [{ id: 'ep-no-key', secret: 'whsec_no_key' }],
            });
          }
          return Promise.resolve();
        }),
      };

      await expect(
        migrateSecrets(mockClient, {
          isDryRun: false,
          logger: { log: vi.fn(), error: vi.fn() },
        })
      ).rejects.toThrow(EncryptionError);

      expect(queryHistory).toContain('BEGIN');
      expect(queryHistory).toContain('ROLLBACK');
      expect(queryHistory).not.toContain('COMMIT');
      expect(
        queryHistory.some(
          (q) => typeof q === 'string' && q.includes('UPDATE endpoints')
        )
      ).toBe(false);
    });
  });

  describe('Resource cleanup in runSecretMigration', () => {
    it('should release client and close pool on success', async () => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql) => {
          if (sql.includes('count')) return Promise.resolve({ rows: [{ count: 0 }] });
          return Promise.resolve();
        }),
        release: vi.fn(),
      };

      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
        end: vi.fn().mockResolvedValue(),
      };

      const exitCode = await runSecretMigration(mockPool, ['--dry-run']);

      expect(exitCode).toBe(0);
      expect(mockPool.connect).toHaveBeenCalledTimes(1);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should release client and handle errors cleanly without crashing', async () => {
      const mockClient = {
        query: vi.fn().mockRejectedValue(new Error('Connection lost')),
        release: vi.fn(),
      };

      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
        end: vi.fn().mockResolvedValue(),
      };

      const exitCode = await runSecretMigration(mockPool, ['--dry-run']);

      expect(exitCode).toBe(1);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('Database migration V2 integrity checks (V2__encrypted_secrets.sql)', () => {
    it('should contain CHECK constraint for all-or-nothing encryption components', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../migrations/V2__encrypted_secrets.sql'
      );
      const sql = fs.readFileSync(migrationPath, 'utf8');

      // Verifies CHECK constraint on encryption columns
      expect(sql).toContain('chk_endpoints_secret_encryption');
      expect(sql).toContain('secret_ciphertext IS NULL');
      expect(sql).toContain('secret_iv IS NULL');
      expect(sql).toContain('secret_tag IS NULL');
      expect(sql).toContain('secret_version IS NULL');
      expect(sql).toContain('secret_version = 1');

      // Verifies CHECK constraint on secret presence
      expect(sql).toContain('chk_endpoints_secret_present');
      expect(sql).toContain('secret IS NOT NULL OR secret_ciphertext IS NOT NULL');

      // Verifies safe handling of legacy rows and drop default
      expect(sql).toContain('ALTER TABLE endpoints ALTER COLUMN secret DROP NOT NULL');
      expect(sql).toContain('DROP DEFAULT');
    });
  });
});
