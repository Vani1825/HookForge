/**
 * Complete Phase 0 API and Webhook Integration Audit Script for HookForge
 */

import http from 'http';
import crypto from 'crypto';
import pg from 'pg';
import config from '../src/config/index.js';

const BACKEND_BASE = `http://localhost:${config.port}`;
const MOCK_PORT = 9099;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}/webhook`;

const TENANT_A_KEY = 'wh_dev_test_key_001';
const TENANT_B_KEY = 'wh_dev_test_key_beta_002';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
});

// Mock receiver state
let receivedWebhooks = [];
let mockResponseStatus = 200;

const mockReceiver = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    receivedWebhooks.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
      timestamp: Date.now()
    });
    res.writeHead(mockResponseStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: mockResponseStatus === 200 ? 'ok' : 'error' }));
  });
});

async function request(path, options = {}) {
  const url = `${BACKEND_BASE}${path}`;
  const { method = 'GET', headers = {}, body } = options;

  const fetchOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };

  if (body !== undefined) {
    fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const res = await fetch(url, fetchOptions);
  let data;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    data = await res.text();
  }

  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    data
  };
}

const auditResults = [];

function recordResult(category, name, method, endpoint, payload, expectedStatus, actualStatus, expectedSummary, actualResponse, passed, notes = '') {
  auditResults.push({
    category,
    name,
    method,
    endpoint,
    payload,
    expectedStatus,
    actualStatus,
    expectedSummary,
    actualResponse,
    passed,
    notes
  });
  const symbol = passed ? '✓ PASS' : '✗ FAIL';
  console.log(`[${symbol}] ${category} :: ${name} (${method} ${endpoint}) -> ${actualStatus}`);
}

async function runAudit() {
  console.log('====================================================');
  console.log('       HOOKFORGE PHASE 0 FULL API AUDIT START       ');
  console.log('====================================================\n');

  // Start mock receiver
  await new Promise((resolve) => mockReceiver.listen(MOCK_PORT, resolve));
  console.log(`Live HTTP Mock Receiver active on ${MOCK_URL}\n`);

  try {
    // ----------------------------------------------------
    // CATEGORY 0: Health Checks
    // ----------------------------------------------------
    const healthRes = await request('/health');
    recordResult(
      'Health Check',
      'Basic Health Probe',
      'GET',
      '/health',
      null,
      200,
      healthRes.status,
      'status: up, database: up',
      healthRes.data,
      healthRes.status === 200 && healthRes.data?.status === 'up' && healthRes.data?.checks?.database?.status === 'up'
    );

    // ----------------------------------------------------
    // CATEGORY A: Authentication & Authorization
    // ----------------------------------------------------
    // A.1 Missing Authorization header
    const authMissing = await request('/endpoints', { method: 'GET' });
    recordResult(
      'Authentication',
      'Missing Authorization header',
      'GET',
      '/endpoints',
      null,
      401,
      authMissing.status,
      '401 Unauthorized (Missing Authorization header)',
      authMissing.data,
      authMissing.status === 401 && authMissing.data?.error === 'Unauthorized'
    );

    // A.2 Invalid API key
    const authInvalid = await request('/endpoints', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer wh_invalid_key_9999' }
    });
    recordResult(
      'Authentication',
      'Invalid API Key',
      'GET',
      '/endpoints',
      null,
      401,
      authInvalid.status,
      '401 Unauthorized (Invalid API key)',
      authInvalid.data,
      authInvalid.status === 401 && authInvalid.data?.error === 'Unauthorized'
    );

    // A.3 Valid API key (Bearer scheme)
    const authValidBearer = await request('/endpoints', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    recordResult(
      'Authentication',
      'Valid API Key (Bearer scheme)',
      'GET',
      '/endpoints',
      null,
      200,
      authValidBearer.status,
      '200 OK with endpoints array',
      Array.isArray(authValidBearer.data) ? `Array of ${authValidBearer.data.length} endpoints` : authValidBearer.data,
      authValidBearer.status === 200 && Array.isArray(authValidBearer.data)
    );

    // A.4 Valid API key (X-Api-Key scheme)
    const authValidXApiKey = await request('/endpoints', {
      method: 'GET',
      headers: { 'X-Api-Key': TENANT_A_KEY }
    });
    recordResult(
      'Authentication',
      'Valid API Key (X-Api-Key header)',
      'GET',
      '/endpoints',
      null,
      200,
      authValidXApiKey.status,
      '200 OK with endpoints array',
      Array.isArray(authValidXApiKey.data) ? `Array of ${authValidXApiKey.data.length} endpoints` : authValidXApiKey.data,
      authValidXApiKey.status === 200 && Array.isArray(authValidXApiKey.data)
    );

    // A.5 Malformed Authorization header (Basic scheme)
    const authMalformedBasic = await request('/endpoints', {
      method: 'GET',
      headers: { 'Authorization': 'Basic dXNlcjpwYXNz' }
    });
    recordResult(
      'Authentication',
      'Malformed scheme (Basic)',
      'GET',
      '/endpoints',
      null,
      401,
      authMalformedBasic.status,
      '401 Unauthorized (Authorization header must use Bearer scheme)',
      authMalformedBasic.data,
      authMalformedBasic.status === 401 && authMalformedBasic.data?.message?.includes('Bearer scheme')
    );

    // A.6 Malformed Authorization header (Empty Bearer)
    const authMalformedEmptyBearer = await request('/endpoints', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' }
    });
    recordResult(
      'Authentication',
      'Empty Bearer Token',
      'GET',
      '/endpoints',
      null,
      401,
      authMalformedEmptyBearer.status,
      '401 Unauthorized (Empty API key)',
      authMalformedEmptyBearer.data,
      authMalformedEmptyBearer.status === 401 && authMalformedEmptyBearer.data?.message === 'Empty API key'
    );

    // ----------------------------------------------------
    // CATEGORY B: Endpoint Management
    // ----------------------------------------------------
    // B.1 Create Endpoint for Tenant A
    const epCreateRes = await request('/endpoints', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` },
      body: {
        url: MOCK_URL,
        rateLimitRps: 15
      }
    });
    const epA = epCreateRes.data;
    recordResult(
      'Endpoint Management',
      'Create Endpoint',
      'POST',
      '/endpoints',
      { url: MOCK_URL, rateLimitRps: 15 },
      201,
      epCreateRes.status,
      '201 Created with secret and ID',
      epA ? { id: epA.id, url: epA.url, secret: 'whsec_***' } : epA,
      epCreateRes.status === 201 && epA?.id && epA?.secret?.startsWith('whsec_')
    );

    // B.2 List Endpoints for Tenant A
    const epListRes = await request('/endpoints', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    recordResult(
      'Endpoint Management',
      'List Endpoints (Secret excluded)',
      'GET',
      '/endpoints',
      null,
      200,
      epListRes.status,
      '200 OK list without secrets',
      epListRes.data?.map(e => ({ id: e.id, hasSecret: Boolean(e.secret) })),
      epListRes.status === 200 && Array.isArray(epListRes.data) && !epListRes.data.some(e => e.secret)
    );

    // B.3 Update Endpoint (PATCH rateLimitRps & active)
    const epPatchRes = await request(`/endpoints/${epA.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` },
      body: {
        rateLimitRps: 30,
        active: true
      }
    });
    recordResult(
      'Endpoint Management',
      'Update Endpoint',
      'PATCH',
      `/endpoints/${epA.id}`,
      { rateLimitRps: 30, active: true },
      200,
      epPatchRes.status,
      '200 OK with updated rate_limit_rps',
      epPatchRes.data,
      epPatchRes.status === 200 && (epPatchRes.data?.rate_limit_rps === 30 || epPatchRes.data?.rateLimitRps === 30)
    );

    // B.4 Disable Endpoint
    const epDisableRes = await request(`/endpoints/${epA.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` },
      body: { active: false }
    });
    recordResult(
      'Endpoint Management',
      'Disable Endpoint',
      'PATCH',
      `/endpoints/${epA.id}`,
      { active: false },
      200,
      epDisableRes.status,
      '200 OK with active=false',
      epDisableRes.data,
      epDisableRes.status === 200 && epDisableRes.data?.active === false
    );

    // B.5 Re-enable Endpoint
    const epEnableRes = await request(`/endpoints/${epA.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` },
      body: { active: true }
    });
    recordResult(
      'Endpoint Management',
      'Enable Endpoint',
      'PATCH',
      `/endpoints/${epA.id}`,
      { active: true },
      200,
      epEnableRes.status,
      '200 OK with active=true',
      epEnableRes.data,
      epEnableRes.status === 200 && epEnableRes.data?.active === true
    );

    // B.6 Retrieve Single Endpoint by ID
    const epGetRes = await request(`/endpoints/${epA.id}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    recordResult(
      'Endpoint Management',
      'Retrieve Endpoint by ID',
      'GET',
      `/endpoints/${epA.id}`,
      null,
      200,
      epGetRes.status,
      '200 OK with endpoint details',
      epGetRes.data,
      epGetRes.status === 200 && epGetRes.data?.id === epA.id
    );

    // B.7 Create temporary endpoint and Delete/Deactivate it
    const epTempRes = await request('/endpoints', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` },
      body: { url: 'https://example.com/to-delete', rateLimitRps: 5 }
    });
    const epDelRes = await request(`/endpoints/${epTempRes.data.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    recordResult(
      'Endpoint Management',
      'Delete/Deactivate Endpoint',
      'DELETE',
      `/endpoints/${epTempRes.data?.id}`,
      null,
      200,
      epDelRes.status,
      '200 OK with success: true',
      epDelRes.data,
      epDelRes.status === 200 && epDelRes.data?.success === true
    );

    // B.6 Tenant Isolation: Tenant B cannot update Tenant A's endpoint
    const crossEpPatch = await request(`/endpoints/${epA.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${TENANT_B_KEY}` },
      body: { active: false }
    });
    recordResult(
      'Authentication',
      'Cross-Tenant Endpoint Update Isolation',
      'PATCH',
      `/endpoints/${epA.id}`,
      { active: false },
      404,
      crossEpPatch.status,
      '404 Not Found',
      crossEpPatch.data,
      crossEpPatch.status === 404
    );

    // B.7 Tenant Isolation: Tenant B endpoint list does not contain Tenant A endpoints
    const epListB = await request('/endpoints', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_B_KEY}` }
    });
    const leakAInB = Array.isArray(epListB.data) && epListB.data.some(e => e.id === epA.id);
    recordResult(
      'Authentication',
      'Cross-Tenant Endpoint List Isolation',
      'GET',
      '/endpoints',
      null,
      200,
      epListB.status,
      '200 OK without Tenant A items',
      `Tenant B endpoints count: ${epListB.data?.length}`,
      epListB.status === 200 && !leakAInB
    );

    // ----------------------------------------------------
    // CATEGORY C: Event Ingestion
    // ----------------------------------------------------
    const idempKey1 = `audit_evt_${Date.now()}_1`;
    const eventPayload1 = { eventType: 'user.signup', userId: 'u_1001', plan: 'pro' };

    // C.1 Valid Event Ingest
    const ingestRes1 = await request('/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TENANT_A_KEY}`,
        'Idempotency-Key': idempKey1
      },
      body: eventPayload1
    });
    const evt1 = ingestRes1.data;
    recordResult(
      'Event Ingestion',
      'Valid Event Ingest',
      'POST',
      '/events',
      eventPayload1,
      202,
      ingestRes1.status,
      '202 Accepted with deliveriesEnqueued >= 1',
      evt1,
      ingestRes1.status === 202 && evt1?.id && evt1?.deliveriesEnqueued >= 1
    );

    // C.2 Idempotent Duplicate Ingest
    const ingestResDuplicate = await request('/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TENANT_A_KEY}`,
        'Idempotency-Key': idempKey1
      },
      body: eventPayload1
    });
    recordResult(
      'Event Ingestion',
      'Duplicate Idempotency Key',
      'POST',
      '/events',
      eventPayload1,
      200,
      ingestResDuplicate.status,
      '200 OK with deliveriesEnqueued: 0',
      ingestResDuplicate.data,
      ingestResDuplicate.status === 200 && ingestResDuplicate.data?.deliveriesEnqueued === 0
    );

    // C.3 Missing Idempotency-Key header
    const ingestMissingKey = await request('/events', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` },
      body: eventPayload1
    });
    recordResult(
      'Event Ingestion',
      'Missing Idempotency-Key Header',
      'POST',
      '/events',
      eventPayload1,
      400,
      ingestMissingKey.status,
      '400 Validation Error',
      ingestMissingKey.data,
      ingestMissingKey.status === 400 && ingestMissingKey.data?.error === 'Validation Error'
    );

    // C.4 Invalid JSON body
    const ingestInvalidJson = await request('/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TENANT_A_KEY}`,
        'Idempotency-Key': `audit_bad_json_${Date.now()}`
      },
      body: '{ bad json :::: }'
    });
    recordResult(
      'Event Ingestion',
      'Invalid JSON Payload',
      'POST',
      '/events',
      '{ bad json :::: }',
      400,
      ingestInvalidJson.status,
      '400 Bad Request',
      ingestInvalidJson.data,
      ingestInvalidJson.status === 400
    );

    // C.5 Oversized Payload (> 256KB)
    const largeStr = 'X'.repeat(300 * 1024); // 300KB
    const ingestOversized = await request('/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TENANT_A_KEY}`,
        'Idempotency-Key': `audit_large_${Date.now()}`
      },
      body: { data: largeStr }
    });
    recordResult(
      'Event Ingestion',
      'Oversized Payload (> 256KB)',
      'POST',
      '/events',
      '300KB payload',
      413,
      ingestOversized.status,
      '413 Payload Too Large / Request Entity Too Large',
      typeof ingestOversized.data === 'string' ? ingestOversized.data.slice(0, 80) : ingestOversized.data,
      ingestOversized.status === 413
    );

    // C.6 Unauthorized Ingestion
    const ingestUnauthorized = await request('/events', {
      method: 'POST',
      headers: { 'Idempotency-Key': `unauth_${Date.now()}` },
      body: eventPayload1
    });
    recordResult(
      'Event Ingestion',
      'Unauthorized Ingestion Attempt',
      'POST',
      '/events',
      eventPayload1,
      401,
      ingestUnauthorized.status,
      '401 Unauthorized',
      ingestUnauthorized.data,
      ingestUnauthorized.status === 401
    );

    // C.7 List Events for Tenant A
    const eventsListRes = await request('/events', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    recordResult(
      'Event Ingestion',
      'List Events',
      'GET',
      '/events',
      null,
      200,
      eventsListRes.status,
      '200 OK with events array',
      `Events count: ${eventsListRes.data?.length}`,
      eventsListRes.status === 200 && Array.isArray(eventsListRes.data) && eventsListRes.data.length >= 1
    );

    // C.8 Retrieve Single Event by ID
    const singleEvtRes = await request(`/events/${evt1.id}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    recordResult(
      'Event Ingestion',
      'Retrieve Single Event',
      'GET',
      `/events/${evt1.id}`,
      null,
      200,
      singleEvtRes.status,
      '200 OK with matching payload',
      singleEvtRes.data ? { id: singleEvtRes.data.id, payload: singleEvtRes.data.payload } : singleEvtRes.data,
      singleEvtRes.status === 200 && singleEvtRes.data?.id === evt1.id
    );

    // C.9 Cross-Tenant Event Access Isolation: Tenant B cannot view Tenant A's event
    const crossEvtGet = await request(`/events/${evt1.id}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_B_KEY}` }
    });
    recordResult(
      'Authentication',
      'Cross-Tenant Event Retrieval Isolation',
      'GET',
      `/events/${evt1.id}`,
      null,
      404,
      crossEvtGet.status,
      '404 Not Found',
      crossEvtGet.data,
      crossEvtGet.status === 404
    );

    // ----------------------------------------------------
    // CATEGORY D: Webhook Delivery & Dispatcher Processing
    // ----------------------------------------------------
    // Wait for dispatcher to process the delivery to mock receiver
    console.log('Waiting up to 4s for dispatcher delivery to complete...');
    let matchingWebhook = null;
    let targetDeliveryId = null;

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      matchingWebhook = receivedWebhooks.find(w => w.body.includes(evt1.id) || w.body.includes('user.signup'));
      if (matchingWebhook) {
        break;
      }
    }

    // Outgoing Webhook Dispatch & Receipt record
    recordResult(
      'Delivery Management',
      'Outgoing Webhook Dispatch & Receipt',
      'POST',
      MOCK_URL,
      eventPayload1,
      200,
      matchingWebhook ? 200 : 500,
      'Webhook received by HTTP mock server with payload',
      matchingWebhook ? { received: true, headers: Object.keys(matchingWebhook.headers) } : 'Not received',
      Boolean(matchingWebhook)
    );

    // D.2 HMAC Signature verification
    const sigHeader = matchingWebhook?.headers['x-webhook-signature'] || matchingWebhook?.headers['x-signature'];
    const webhookIdHeader = matchingWebhook?.headers['x-webhook-id'];
    let validSignature = false;

    // Lookup the exact endpoint secret used for this specific delivery
    let signingSecret = epA.secret;
    if (webhookIdHeader) {
      const epSecretRes = await pool.query(
        `SELECT e.secret FROM deliveries d JOIN endpoints e ON e.id = d.endpoint_id WHERE d.id = $1`,
        [webhookIdHeader]
      );
      if (epSecretRes.rows[0]?.secret) {
        signingSecret = epSecretRes.rows[0].secret;
      }
    }

    if (sigHeader && signingSecret) {
      const match = sigHeader.match(/^t=(\d+),v1=([a-f0-9]+)$/);
      if (match) {
        const timestamp = match[1];
        const receivedHex = match[2];
        const signedPayload = `${timestamp}.${matchingWebhook.body}`;
        const computedHex = crypto.createHmac('sha256', signingSecret).update(signedPayload).digest('hex');
        validSignature = crypto.timingSafeEqual(Buffer.from(receivedHex, 'hex'), Buffer.from(computedHex, 'hex'));
      }
    }

    recordResult(
      'Delivery Management',
      'HMAC-SHA256 Signature Verification',
      'POST',
      '/webhook',
      null,
      'Valid Signature',
      validSignature ? 'Valid Signature' : 'Invalid',
      'X-Webhook-Signature header with t=...,v1=... matching ep.secret',
      { sigHeader, validSignature, webhookIdHeader },
      validSignature
    );

    // D.3 Poll for delivery to complete processing (SUCCEEDED)
    let deliveryRow = null;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 200));
      const dbDeliveryRes = await pool.query(
        `SELECT d.id, d.state, d.attempt_count, d.seq, a.status_code, a.latency_ms
         FROM deliveries d
         LEFT JOIN delivery_attempts a ON a.delivery_id = d.id
         WHERE d.event_id = $1 AND d.id = $2`,
        [evt1.id, webhookIdHeader || targetDeliveryId]
      );
      deliveryRow = dbDeliveryRes.rows[0];
      if (deliveryRow && deliveryRow.state === 'SUCCEEDED' && deliveryRow.status_code === 200) {
        targetDeliveryId = deliveryRow.id;
        break;
      }
      if (deliveryRow) {
        targetDeliveryId = deliveryRow.id;
      }
    }

    recordResult(
      'Delivery Management',
      'Delivery State Transition (SUCCEEDED)',
      'DB/API',
      '/deliveries',
      null,
      'SUCCEEDED',
      deliveryRow?.state,
      'state = SUCCEEDED, attempt_count >= 1',
      deliveryRow,
      deliveryRow?.state === 'SUCCEEDED' && deliveryRow?.attempt_count >= 1
    );

    // D.4 Delivery Retrieval via GET /events/:id/deliveries
    const evtDelivsRes = await request(`/events/${evt1.id}/deliveries`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    recordResult(
      'Delivery Management',
      'Event Deliveries Retrieval',
      'GET',
      `/events/${evt1.id}/deliveries`,
      null,
      200,
      evtDelivsRes.status,
      '200 OK with deliveries list',
      evtDelivsRes.data,
      evtDelivsRes.status === 200 && Array.isArray(evtDelivsRes.data?.deliveries) && evtDelivsRes.data.deliveries.length >= 1
    );

    // D.5 Single Delivery Details with Attempts via GET /deliveries/:id
    if (targetDeliveryId) {
      const singleDelivRes = await request(`/deliveries/${targetDeliveryId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
      });
      recordResult(
        'Delivery Management',
        'Single Delivery Attempt History Retrieval',
        'GET',
        `/deliveries/${targetDeliveryId}`,
        null,
        200,
        singleDelivRes.status,
        '200 OK with attempts array',
        singleDelivRes.data ? { id: singleDelivRes.data.id, attemptsCount: singleDelivRes.data.attempts?.length } : singleDelivRes.data,
        singleDelivRes.status === 200 && Array.isArray(singleDelivRes.data?.attempts) && singleDelivRes.data.attempts.length >= 1
      );

      // D.6 Cross-Tenant Delivery Retrieval Isolation
      const crossDelivGet = await request(`/deliveries/${targetDeliveryId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${TENANT_B_KEY}` }
      });
      recordResult(
        'Authentication',
        'Cross-Tenant Delivery Retrieval Isolation',
        'GET',
        `/deliveries/${targetDeliveryId}`,
        null,
        404,
        crossDelivGet.status,
        '404 Not Found',
        crossDelivGet.data,
        crossDelivGet.status === 404
      );
    }

    // ----------------------------------------------------
    // CATEGORY E: Failed Destination, Retry, DLQ & Replay
    // ----------------------------------------------------
    // Create an endpoint pointing to a failing port (9098 closed)
    const epFailRes = await request('/endpoints', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` },
      body: {
        url: 'http://127.0.0.1:9098/fail',
        rateLimitRps: 20
      }
    });
    const epFail = epFailRes.data;

    const idempKeyFail = `audit_fail_evt_${Date.now()}`;
    const failIngest = await request('/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TENANT_A_KEY}`,
        'Idempotency-Key': idempKeyFail
      },
      body: { test: 'retry-fail' }
    });

    // Wait up to 8s for dispatcher to attempt delivery and classify as RETRYING or DEAD
    let failDeliv = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400));
      const failDelivRes = await pool.query(
        `SELECT id, state, attempt_count, next_attempt_at, last_error 
         FROM deliveries 
         WHERE event_id = $1 AND endpoint_id = $2`,
        [failIngest.data.id, epFail.id]
      );
      if (failDelivRes.rows[0] && (failDelivRes.rows[0].state === 'RETRYING' || failDelivRes.rows[0].state === 'DEAD')) {
        failDeliv = failDelivRes.rows[0];
        break;
      }
      failDeliv = failDelivRes.rows[0];
    }

    recordResult(
      'Delivery Management',
      'Unreachable Destination Retry Scheduling',
      'Internal Dispatcher',
      'http://127.0.0.1:9098/fail',
      null,
      'RETRYING or DEAD',
      failDeliv?.state,
      'state IN (RETRYING, DEAD), attempt_count >= 1, last_error present',
      failDeliv,
      failDeliv && (failDeliv.state === 'RETRYING' || failDeliv.state === 'DEAD') && failDeliv.attempt_count >= 1
    );

    // E.1 Force a delivery into DEAD state to test DLQ & Replay
    await pool.query(
      `UPDATE deliveries SET state = 'DEAD', attempt_count = 8, last_error = 'Simulated max retries reached' WHERE id = $1`,
      [failDeliv.id]
    );

    // E.2 Retrieve DLQ records
    const dlqRes = await request('/deliveries?state=DEAD', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    recordResult(
      'Dead Letter Queue',
      'Retrieve DLQ (DEAD Deliveries)',
      'GET',
      '/deliveries?state=DEAD',
      null,
      200,
      dlqRes.status,
      '200 OK with DEAD deliveries',
      { count: dlqRes.data?.deliveries?.length, state: dlqRes.data?.state },
      dlqRes.status === 200 && dlqRes.data?.state === 'DEAD' && dlqRes.data?.deliveries?.some(d => d.id === failDeliv.id)
    );

    // E.3 Cross-Tenant Replay Prevention
    const crossReplay = await request(`/deliveries/${failDeliv.id}/replay`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TENANT_B_KEY}` }
    });
    recordResult(
      'Authentication',
      'Cross-Tenant DLQ Replay Prevention',
      'POST',
      `/deliveries/${failDeliv.id}/replay`,
      null,
      404,
      crossReplay.status,
      '404 Not Found',
      crossReplay.data,
      crossReplay.status === 404
    );

    // E.4 Valid DLQ Replay
    const replayRes = await request(`/deliveries/${failDeliv.id}/replay`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    recordResult(
      'Dead Letter Queue',
      'Replay DEAD Delivery',
      'POST',
      `/deliveries/${failDeliv.id}/replay`,
      null,
      200,
      replayRes.status,
      '200 OK with state = PENDING and attemptCount = 0',
      replayRes.data,
      replayRes.status === 200 && replayRes.data?.state === 'PENDING' && replayRes.data?.attemptCount === 0
    );

    // E.5 Prevent Invalid State Transition (Replaying non-DEAD delivery)
    const invalidReplay = await request(`/deliveries/${failDeliv.id}/replay`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    recordResult(
      'Dead Letter Queue',
      'Invalid Replay State Transition (PENDING cannot replay)',
      'POST',
      `/deliveries/${failDeliv.id}/replay`,
      null,
      400,
      invalidReplay.status,
      '400 Invalid state transition',
      invalidReplay.data,
      invalidReplay.status === 400 && invalidReplay.data?.error?.includes('state transition')
    );

    // ----------------------------------------------------
    // CATEGORY F: Analytics Verification
    // ----------------------------------------------------
    const allDelivsRes = await request('/deliveries?state=ALL', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    const allEndpointsRes = await request('/endpoints', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });
    const allEvtsRes = await request('/events', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TENANT_A_KEY}` }
    });

    const totalEvents = allEvtsRes.data?.length || 0;
    const deliveriesArr = allDelivsRes.data?.deliveries || [];
    const totalDeliveries = deliveriesArr.length;
    const succeededDeliveries = deliveriesArr.filter(d => d.state === 'SUCCEEDED').length;
    const failedDeliveries = deliveriesArr.filter(d => d.state === 'DEAD').length;
    const pendingDeliveries = deliveriesArr.filter(d => ['PENDING', 'IN_FLIGHT', 'RETRYING'].includes(d.state)).length;
    const successRate = totalDeliveries > 0 ? (succeededDeliveries / totalDeliveries) * 100 : 100;
    const activeEndpointsCount = allEndpointsRes.data?.filter(e => e.active).length || 0;

    recordResult(
      'Analytics',
      'Overview Metrics Computation',
      'GET',
      '/deliveries?state=ALL & /endpoints & /events',
      null,
      200,
      allDelivsRes.status === 200 && allEndpointsRes.status === 200 && allEvtsRes.status === 200 ? 200 : 500,
      'Valid metrics structure with totalEvents, totalDeliveries, successRate',
      {
        totalEvents,
        totalDeliveries,
        succeededDeliveries,
        failedDeliveries,
        pendingDeliveries,
        successRate: Math.round(successRate * 10) / 10,
        activeEndpoints: activeEndpointsCount
      },
      totalDeliveries >= 1 && totalEvents >= 1
    );

    console.log('\n====================================================');
    console.log('              AUDIT EXECUTION SUMMARY               ');
    console.log('====================================================');
    const passedCount = auditResults.filter(r => r.passed).length;
    const failedCount = auditResults.filter(r => !r.passed).length;
    console.log(`Total APIs & Scenarios Audited: ${auditResults.length}`);
    console.log(`Passed: ${passedCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log('====================================================\n');

  } catch (err) {
    console.error('Audit run error:', err);
  } finally {
    mockReceiver.close();
    await pool.end();
  }
}

runAudit();
