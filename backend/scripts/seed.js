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

async function seedTenant(client, name, apiKey) {
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const existing = await client.query(
    'SELECT id, name FROM tenants WHERE api_key_hash = $1',
    [hash]
  );
  if (existing.rows.length > 0) {
    console.log(`Development tenant already exists: ${existing.rows[0].name} (ID: ${existing.rows[0].id})`);
    return existing.rows[0].id;
  }
  const res = await client.query(
    'INSERT INTO tenants (name, api_key_hash) VALUES ($1, $2) RETURNING id, name',
    [name, hash]
  );
  console.log(`Created development tenant: ${res.rows[0].name} (ID: ${res.rows[0].id})`);
  return res.rows[0].id;
}

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding development tenants...');

    const devApiKey = process.env.DEV_API_KEY || 'wh_dev_test_key_001';
    await seedTenant(client, 'Default Dev Tenant', devApiKey);

    const devApiKeyBeta = process.env.DEV_API_KEY_BETA || 'wh_dev_test_key_beta_002';
    await seedTenant(client, 'Beta Dev Tenant', devApiKeyBeta);

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
