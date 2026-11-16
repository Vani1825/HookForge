/**
 * Development Tenant Initialization Script.
 * Safe, idempotent initialization of a development tenant for local use.
 *
 * Requirements:
 * 1. Generates a cryptographically random API key.
 * 2. Creates a tenant using the existing schema (id, name, api_key_hash, created_at).
 * 3. Stores only the SHA-256 hash of the key in api_key_hash.
 * 4. Displays raw key only when creating tenant, without logging or writing to source code.
 * 5. Prevents accidental duplicate tenant creation on repeated runs.
 * 6. Does not reset, delete, or overwrite existing tenant data.
 * 7. Refuses to run in production.
 * 8. Documents how to use the generated key in the frontend Settings page.
 */

import crypto from 'crypto';
import pg from 'pg';
import config from '../src/config/index.js';

const { Pool } = pg;

export async function initDevTenant(options = {}) {
  // 7. Refuse to run in production
  const isProduction =
    (process.env.NODE_ENV && process.env.NODE_ENV.toLowerCase() === 'production') ||
    (config.nodeEnv && config.nodeEnv.toLowerCase() === 'production');

  if (isProduction && !options.skipEnvCheck) {
    console.error('\n[Security Error] Refusing to initialize development tenant in production environment.');
    console.error('This command is strictly intended for local development environments.\n');
    if (!options.silent) {
      process.exit(1);
    }
    throw new Error('Refusing to run development tenant initialization in production');
  }

  const pool = options.pool || new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
  });

  const client = await pool.connect();

  try {
    const tenantName = process.env.DEV_TENANT_NAME || options.tenantName || 'Default Dev Tenant';

    // 5 & 6. Check if development tenant already exists (prevents duplicate and prevents overwrite)
    const existingResult = await client.query(
      'SELECT id, name, created_at FROM tenants WHERE name = $1 LIMIT 1',
      [tenantName]
    );

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      console.log('\n=============================================================================');
      console.log('             HookForge Development Tenant Already Exists');
      console.log('=============================================================================');
      console.log(`Tenant Name:  ${existing.name}`);
      console.log(`Tenant ID:    ${existing.id}`);
      console.log(`Created At:   ${existing.created_at}`);
      console.log('-----------------------------------------------------------------------------');
      console.log('Notice: Existing tenant data was PRESERVED without changes.');
      console.log('Duplicate tenants are not created on repeated runs.');
      console.log('');
      console.log('If you need a new development tenant with a fresh key, you can specify');
      console.log('a custom name via DEV_TENANT_NAME:');
      console.log('  DEV_TENANT_NAME="Dev Tenant 2" npm run db:seed');
      console.log('=============================================================================\n');

      return {
        created: false,
        tenant: existing,
      };
    }

    // 1. Generate a cryptographically random API key
    // Using a clear whkey_ prefix followed by 48 hex characters (192 bits of entropy)
    const rawApiKey =
      process.env.DEV_API_KEY ||
      options.apiKey ||
      `whkey_${crypto.randomBytes(24).toString('hex')}`;

    // 3. Store only the SHA-256 hash in api_key_hash
    const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

    // 2. Create tenant using existing schema
    const insertResult = await client.query(
      'INSERT INTO tenants (name, api_key_hash) VALUES ($1, $2) RETURNING id, name, created_at',
      [tenantName, apiKeyHash]
    );

    const newTenant = insertResult.rows[0];

    // 4 & 8. Display raw key once on console and document Settings configuration
    console.log('\n=============================================================================');
    console.log('           HookForge Development Tenant Initialized Successfully');
    console.log('=============================================================================');
    console.log(`Tenant Name:  ${newTenant.name}`);
    console.log(`Tenant ID:    ${newTenant.id}`);
    console.log(`Created At:   ${newTenant.created_at}`);
    console.log('-----------------------------------------------------------------------------');
    console.log(`Development API Key:  ${rawApiKey}`);
    console.log('-----------------------------------------------------------------------------');
    console.log('IMPORTANT:');
    console.log('1. Copy and save this API key now. HookForge stores only the SHA-256 hash');
    console.log('   in PostgreSQL and cannot recover the plaintext key later.');
    console.log('2. This key was NOT written to any file or committed to source control.');
    console.log('');
    console.log('HOW TO CONFIGURE IN FRONTEND:');
    console.log('1. Open HookForge in your browser: http://localhost:5173');
    console.log('2. Navigate to "Settings" (Platform Settings).');
    console.log('3. Under "Backend API Configuration":');
    console.log('     Backend Base URL:       http://localhost:8081');
    console.log(`     Tenant API Key:         ${rawApiKey}`);
    console.log('4. Click "Save API Preferences".');
    console.log('5. Under "Environment Operation Mode", ensure "Live API Mode" is active.');
    console.log('=============================================================================\n');

    return {
      created: true,
      tenant: newTenant,
      apiKey: rawApiKey,
    };
  } finally {
    client.release();
    if (!options.pool) {
      await pool.end();
    }
  }
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  initDevTenant().catch((err) => {
    console.error('Tenant initialization failed:', err.message);
    process.exit(1);
  });
}
