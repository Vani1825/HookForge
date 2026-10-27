/**
 * Database migration script.
 * Runs SQL migrations from the migrations directory.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../src/config/index.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
});

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('Running database migrations...');

    // Ensure migration tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Check existing applied migrations
    const { rows: appliedRows } = await client.query(
      'SELECT name FROM schema_migrations'
    );
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    // Get all migration files sorted
    const migrationsDir = path.join(__dirname, '../migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`Migration ${file} already applied, skipping.`);
        continue;
      }

      // If this is V1__init.sql and the tenants table already exists from earlier setup
      if (file === 'V1__init.sql') {
        const checkTable = await client.query(
          "SELECT to_regclass('public.tenants') as exists"
        );
        if (checkTable.rows[0].exists) {
          console.log(
            `Tables already initialized; recording ${file} as applied.`
          );
          await client.query(
            'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
            [file]
          );
          continue;
        }
      }

      console.log(`Applying migration ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`Migration ${file} applied successfully.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
