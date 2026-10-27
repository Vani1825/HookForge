/**
 * Database seed script.
 * Ensures a development tenant exists.
 */

import crypto from 'crypto';
import pg from 'pg';
import config from '../src/config/index.js';

const { Pool } = pg;

const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
});

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding development tenant...');

    const devApiKey = process.env.DEV_API_KEY || 'wh_dev_test_key_001';
    const hash = crypto.createHash('sha256').update(devApiKey).digest('hex');

    // Check if tenant already exists with this hash
    const existing = await client.query(
      'SELECT id, name FROM tenants WHERE api_key_hash = $1',
      [hash]
    );

    let tenantId;
    if (existing.rows.length > 0) {
      tenantId = existing.rows[0].id;
      console.log(`Development tenant already exists: ${existing.rows[0].name} (ID: ${tenantId})`);
    } else {
      const res = await client.query(
        'INSERT INTO tenants (name, api_key_hash) VALUES ($1, $2) RETURNING id, name',
        ['Default Dev Tenant', hash]
      );
      tenantId = res.rows[0].id;
      console.log(`Created development tenant: ${res.rows[0].name} (ID: ${tenantId})`);
    }

    console.log('Seed completed successfully.');
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
