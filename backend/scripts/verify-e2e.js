/**
 * End-to-end Acceptance Verification Script for HookForge.
 * Executes all 8 acceptance scenarios against live PostgreSQL and a real HTTP mock receiver.
 */

import http from 'http';
import crypto from 'crypto';
import request from 'supertest';
import app from '../src/app.js';
import pool, { query, closePool } from '../src/config/database.js';
import { poll } from '../src/services/delivery/dispatcher.js';
import { recoverExpiredLeases } from '../src/services/resilience/leaseReaper.js';
import endpointRepository from '../src/repositories/jdbc/endpointRepository.js';

const MOCK_RECEIVER_PORT = 9095;
const MOCK_RECEIVER_URL = `http://127.0.0.1:${MOCK_RECEIVER_PORT}/webhook`;

// Mock receiver state
let receivedRequests = [];
let receiverMode = 'success'; // 'success' | 'fail_count' | 'always_status'
let failCountRemaining = 0;
let failStatusCode = 500;

const mockServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const record = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
      receivedAt: Date.now(),
    };
    receivedRequests.push(record);

    let status = 200;
    if (receiverMode === 'fail_count') {
      if (failCountRemaining > 0) {
        failCountRemaining--;
        status = failStatusCode;
      } else {
        status = 200;
      }
    } else if (receiverMode === 'always_status') {
      status = failStatusCode;
    }

    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: status === 200 ? 'ok' : 'error' }));
  });
});

function resetReceiver(mode = 'success', count = 0, status = 500) {
  receivedRequests = [];
  receiverMode = mode;
  failCountRemaining = count;
  failStatusCode = status;
}

function verifyHmacSignature(secret, body, signatureHeader) {
  if (!signatureHeader) return false;
  const match = signatureHeader.match(/^t=(\d+),v1=([a-f0-9]+)$/);
  if (!match) return false;
  const timestamp = match[1];
  const expectedSig = match[2];

  const signedPayload = `${timestamp}.${body}`;
  const computed = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return computed === expectedSig;
}

const results = [];

function recordScenario(name, passed, details = '') {
  results.push({ name, passed, details });
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`\n>>> [${status}] ${name} - ${details}\n`);
}

async function run() {
  console.log('=== HOOKFORGE ACCEPTANCE TESTS INITIALIZING ===\n');

  // Start mock receiver
  await new Promise((resolve) => mockServer.listen(MOCK_RECEIVER_PORT, resolve));
  console.log(`Mock receiver running on ${MOCK_RECEIVER_URL}`);

  // Clean test tables
  await query(`DELETE FROM delivery_attempts`);
  await query(`DELETE FROM deliveries`);
  await query(`DELETE FROM events`);
  await query(`DELETE FROM endpoints`);
  await query(`DELETE FROM tenants`);

  try {
    // Seed two test tenants
    const tenantAKey = 'wh_test_key_alpha_' + Date.now();
    const tenantBKey = 'wh_test_key_beta_' + Date.now();
    const hashA = crypto.createHash('sha256').update(tenantAKey).digest('hex');
    const hashB = crypto.createHash('sha256').update(tenantBKey).digest('hex');

    const tA = await query(
      `INSERT INTO tenants (name, api_key_hash) VALUES ($1, $2) RETURNING id`,
      ['Tenant Alpha E2E', hashA]
    );
    const tenantAId = tA.rows[0].id;

    const tB = await query(
      `INSERT INTO tenants (name, api_key_hash) VALUES ($1, $2) RETURNING id`,
      ['Tenant Beta E2E', hashB]
    );
    const tenantBId = tB.rows[0].id;

    console.log(`Seeded Tenant A: ${tenantAId}`);
    console.log(`Seeded Tenant B: ${tenantBId}\n`);

    // ==========================================
    // SCENARIO 1: Successful Signed Delivery
    // ==========================================
    console.log('--- Running Scenario 1: Successful Signed Delivery ---');
    await query(`UPDATE endpoints SET active = false WHERE tenant_id = $1`, [tenantAId]);
    resetReceiver('success');

    // Create Endpoint for Tenant A
    const ep1Res = await request(app)
      .post('/endpoints')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .send({ url: MOCK_RECEIVER_URL, rateLimitRps: 20 });

    if (ep1Res.status !== 201) throw new Error(`Create endpoint failed: ${JSON.stringify(ep1Res.body)}`);
    const endpoint1Id = ep1Res.body.id;
    const endpoint1Secret = ep1Res.body.secret;

    // Ingest Event
    const eventPayload = { event: 'user.created', userId: 'usr_1001', team: 'Alpha' };
    const idempKey1 = 'e2e-event-1-' + Date.now();
    const ev1Res = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .set('Idempotency-Key', idempKey1)
      .send(eventPayload);

    if (ev1Res.status !== 202) throw new Error(`Event ingestion failed: ${JSON.stringify(ev1Res.body)}`);
    const event1Id = ev1Res.body.id;

    // Check delivery in DB
    const delRows1 = await query(`SELECT * FROM deliveries WHERE event_id = $1`, [event1Id]);
    if (delRows1.rows.length !== 1) throw new Error('Delivery row not created in DB');
    const delivery1Id = delRows1.rows[0].id;

    // Dispatch
    await poll();

    // Verify mock receiver got it
    if (receivedRequests.length !== 1) throw new Error(`Expected 1 request at receiver, got ${receivedRequests.length}`);
    const rec1 = receivedRequests[0];
    const sigHeader = rec1.headers['x-webhook-signature'];
    const idHeader = rec1.headers['x-webhook-id'];
    const sigValid = verifyHmacSignature(endpoint1Secret, rec1.body, sigHeader);

    // Verify DB delivery state
    const del1Updated = await query(`SELECT * FROM deliveries WHERE id = $1`, [delivery1Id]);
    const attempts1 = await query(`SELECT * FROM delivery_attempts WHERE delivery_id = $1`, [delivery1Id]);

    const s1Pass =
      sigValid &&
      idHeader === delivery1Id &&
      del1Updated.rows[0].state === 'SUCCEEDED' &&
      attempts1.rows.length === 1 &&
      attempts1.rows[0].status_code === 200;

    recordScenario(
      'Test 1: Successful signed delivery',
      s1Pass,
      `Delivery ${delivery1Id} marked SUCCEEDED with valid HMAC signature and stable X-Webhook-Id`
    );

    // ==========================================
    // SCENARIO 2: Idempotency
    // ==========================================
    console.log('--- Running Scenario 2: Idempotency ---');
    const idempKey2 = 'e2e-idemp-' + Date.now();
    const payload2 = { action: 'invoice.paid', amount: 500 };

    const firstIngest = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .set('Idempotency-Key', idempKey2)
      .send(payload2);

    const secondIngest = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .set('Idempotency-Key', idempKey2)
      .send(payload2);

    const eventsCount = await query(
      `SELECT count(*) FROM events WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantAId, idempKey2]
    );

    const s2Pass =
      firstIngest.status === 202 &&
      firstIngest.body.deliveriesEnqueued === 1 &&
      secondIngest.status === 200 &&
      secondIngest.body.deliveriesEnqueued === 0 &&
      secondIngest.body.id === firstIngest.body.id &&
      parseInt(eventsCount.rows[0].count, 10) === 1;

    recordScenario(
      'Test 2: Idempotency',
      s2Pass,
      `Duplicate key returned 200 with deliveriesEnqueued: 0; DB contains exactly 1 event`
    );

    // Clean up enqueued delivery for scenario 2
    await poll();

    // ==========================================
    // SCENARIO 3: Strict Per-Endpoint Ordering
    // ==========================================
    console.log('--- Running Scenario 3: Per-Endpoint Ordering ---');
    // Deactivate previous endpoints
    await query(`UPDATE endpoints SET active = false WHERE tenant_id = $1`, [tenantAId]);
    resetReceiver('success');

    // Create a dedicated endpoint for ordering test
    const epOrderRes = await request(app)
      .post('/endpoints')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .send({ url: MOCK_RECEIVER_URL, rateLimitRps: 50 });
    const orderEpId = epOrderRes.body.id;

    // Send 10 events sequentially
    const orderedEventIds = [];
    for (let i = 1; i <= 10; i++) {
      const res = await request(app)
        .post('/events')
        .set('Authorization', `Bearer ${tenantAKey}`)
        .set('Idempotency-Key', `e2e-order-${i}-${Date.now()}`)
        .send({ index: i, note: `Order test message ${i}` });
      orderedEventIds.push(res.body.id);
    }

    // Check sequences allocated on endpoint
    const orderDeliveries = await query(
      `SELECT seq, state FROM deliveries WHERE endpoint_id = $1 ORDER BY seq ASC`,
      [orderEpId]
    );

    const sequencesMonotonic = orderDeliveries.rows.every((row, idx) => Number(row.seq) === idx + 1);

    // Run dispatcher poll multiple times until all 10 are delivered
    for (let p = 0; p < 15; p++) {
      await poll();
    }

    // Verify received sequence on mock receiver
    const receivedIndexes = receivedRequests
      .map((r) => {
        try {
          return JSON.parse(r.body).index;
        } catch {
          return null;
        }
      })
      .filter((idx) => idx !== null);

    const receiverOrdered =
      receivedIndexes.length === 10 &&
      receivedIndexes.every((val, idx) => val === idx + 1);

    const s3Pass = sequencesMonotonic && receiverOrdered;
    recordScenario(
      'Test 3: Ordering',
      s3Pass,
      `10 events delivered in strict monotonic sequence (1..10) with no head-of-line violations`
    );

    // ==========================================
    // SCENARIO 4: Retry with Backoff
    // ==========================================
    console.log('--- Running Scenario 4: Retry with Backoff ---');
    await query(`UPDATE endpoints SET active = false WHERE tenant_id = $1`, [tenantAId]);

    const epRetryRes = await request(app)
      .post('/endpoints')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .send({ url: MOCK_RECEIVER_URL, rateLimitRps: 20 });
    const retryEpId = epRetryRes.body.id;

    // Configure mock receiver to fail 2 times then succeed
    resetReceiver('fail_count', 2, 500);

    const evRetryRes = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .set('Idempotency-Key', 'e2e-retry-' + Date.now())
      .send({ test: 'retry-flow' });
    const retryEventId = evRetryRes.body.id;

    const delRetryRow = (
      await query(`SELECT id FROM deliveries WHERE event_id = $1 AND endpoint_id = $2`, [
        retryEventId,
        retryEpId,
      ])
    ).rows[0];
    const retryDeliveryId = delRetryRow.id;

    // Attempt 1: Should fail with 500, state -> RETRYING
    await poll();
    let dCheck1 = (await query(`SELECT state, attempt_count FROM deliveries WHERE id = $1`, [retryDeliveryId])).rows[0];

    // Fast-forward next_attempt_at to now
    await query(`UPDATE deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [retryDeliveryId]);

    // Attempt 2: Should fail with 500, state -> RETRYING
    await poll();
    let dCheck2 = (await query(`SELECT state, attempt_count FROM deliveries WHERE id = $1`, [retryDeliveryId])).rows[0];

    // Fast-forward next_attempt_at to now
    await query(`UPDATE deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [retryDeliveryId]);

    // Attempt 3: Mock receiver now succeeds -> SUCCEEDED
    await poll();
    let dCheck3 = (await query(`SELECT state, attempt_count FROM deliveries WHERE id = $1`, [retryDeliveryId])).rows[0];

    const attemptsCount4 = await query(`SELECT count(*) FROM delivery_attempts WHERE delivery_id = $1`, [retryDeliveryId]);

    const s4Pass =
      dCheck1.state === 'RETRYING' &&
      dCheck2.state === 'RETRYING' &&
      dCheck3.state === 'SUCCEEDED' &&
      dCheck3.attempt_count === 3 &&
      parseInt(attemptsCount4.rows[0].count, 10) === 3;

    recordScenario(
      'Test 4: Retry',
      s4Pass,
      `Delivery failed twice (500), retried according to policy, succeeded on attempt 3`
    );

    // ==========================================
    // SCENARIO 5: Dead-Letter Queue & Manual Replay
    // ==========================================
    console.log('--- Running Scenario 5: Dead-Letter Queue & Replay ---');
    await query(`UPDATE endpoints SET active = false WHERE tenant_id = $1`, [tenantAId]);

    const epDlqRes = await request(app)
      .post('/endpoints')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .send({ url: MOCK_RECEIVER_URL, rateLimitRps: 20 });
    const dlqEpId = epDlqRes.body.id;

    // Receiver will always fail with 500
    resetReceiver('always_status', 0, 500);

    const evDlqRes = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .set('Idempotency-Key', 'e2e-dlq-' + Date.now())
      .send({ test: 'dlq-exhaustion' });
    const dlqEventId = evDlqRes.body.id;

    const dlqDelId = (
      await query(`SELECT id FROM deliveries WHERE event_id = $1 AND endpoint_id = $2`, [
        dlqEventId,
        dlqEpId,
      ])
    ).rows[0].id;

    // Simulate exhausting 8 attempts
    for (let a = 1; a <= 8; a++) {
      // Keep circuit closed so all 8 attempts can be executed to reach DEAD
      await query(
        `UPDATE endpoints SET circuit_state = 'CLOSED', circuit_until = NULL, consecutive_failures = 0 WHERE id = $1`,
        [dlqEpId]
      );
      await query(`UPDATE deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [dlqDelId]);
      await poll();
    }

    const dCheckDead = (await query(`SELECT state, attempt_count FROM deliveries WHERE id = $1`, [dlqDelId])).rows[0];

    // Query DEAD deliveries via API
    const dlqApiRes = await request(app)
      .get('/deliveries?state=DEAD')
      .set('Authorization', `Bearer ${tenantAKey}`);

    const inDlqList = dlqApiRes.status === 200 && dlqApiRes.body.deliveries.some((d) => d.id === dlqDelId);

    // Cross-tenant replay attempt by Tenant B (must return 404)
    const replayCrossRes = await request(app)
      .post(`/deliveries/${dlqDelId}/replay`)
      .set('Authorization', `Bearer ${tenantBKey}`);

    // Replay as Tenant A (valid)
    resetReceiver('success');
    const replayValidRes = await request(app)
      .post(`/deliveries/${dlqDelId}/replay`)
      .set('Authorization', `Bearer ${tenantAKey}`);

    // Dispatch replayed delivery
    await poll();

    const dCheckReplayed = (await query(`SELECT state FROM deliveries WHERE id = $1`, [dlqDelId])).rows[0];

    // Attempt invalid replay on now-SUCCEEDED delivery (must return 400)
    const replayInvalidRes = await request(app)
      .post(`/deliveries/${dlqDelId}/replay`)
      .set('Authorization', `Bearer ${tenantAKey}`);

    console.log('Scenario 5 checks:', {
      deadState: dCheckDead?.state,
      attemptCount: dCheckDead?.attempt_count,
      inDlqList,
      replayCrossStatus: replayCrossRes.status,
      replayValidStatus: replayValidRes.status,
      replayedState: dCheckReplayed?.state,
      replayInvalidStatus: replayInvalidRes.status,
    });

    const s5Pass =
      dCheckDead.state === 'DEAD' &&
      dCheckDead.attempt_count === 8 &&
      inDlqList &&
      replayCrossRes.status === 404 &&
      replayValidRes.status === 200 &&
      dCheckReplayed.state === 'SUCCEEDED' &&
      replayInvalidRes.status === 400;

    recordScenario(
      'Test 5: Dead-letter replay',
      s5Pass,
      `Delivery transitioned to DEAD after 8 attempts, returned in DLQ query, Tenant B 404, replayed & succeeded, invalid replay rejected (400)`
    );

    // ==========================================
    // SCENARIO 6: Lease Recovery
    // ==========================================
    console.log('--- Running Scenario 6: Lease Recovery ---');
    await query(`UPDATE endpoints SET active = false WHERE tenant_id = $1`, [tenantAId]);

    const epLeaseRes = await request(app)
      .post('/endpoints')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .send({ url: MOCK_RECEIVER_URL, rateLimitRps: 20 });
    const leaseEpId = epLeaseRes.body.id;

    const evLeaseRes = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .set('Idempotency-Key', 'e2e-lease-' + Date.now())
      .send({ test: 'lease-recovery' });
    const leaseEventId = evLeaseRes.body.id;

    const expiredDeliveryId = (
      await query(`SELECT id FROM deliveries WHERE event_id = $1 AND endpoint_id = $2`, [
        leaseEventId,
        leaseEpId,
      ])
    ).rows[0].id;

    // Simulate worker crash by setting IN_FLIGHT with expired lease
    await query(
      `UPDATE deliveries
       SET state = 'IN_FLIGHT',
           lease_until = now() - interval '1 minute',
           next_attempt_at = now() - interval '1 minute'
       WHERE id = $1`,
      [expiredDeliveryId]
    );

    // Run lease reaper
    const recoveredCount = await recoverExpiredLeases();

    const dCheckRecovered = (
      await query(`SELECT state, lease_until FROM deliveries WHERE id = $1`, [expiredDeliveryId])
    ).rows[0];

    // Dispatch recovered delivery to confirm completion
    resetReceiver('success');
    await poll();
    const dCheckCompleted = (
      await query(`SELECT state FROM deliveries WHERE id = $1`, [expiredDeliveryId])
    ).rows[0];

    const s6Pass =
      recoveredCount >= 1 &&
      dCheckRecovered.state === 'RETRYING' &&
      dCheckRecovered.lease_until === null &&
      dCheckCompleted.state === 'SUCCEEDED';

    recordScenario(
      'Test 6: Lease recovery',
      s6Pass,
      `Expired IN_FLIGHT delivery recovered by lease reaper to RETRYING, claimed and delivered without loss`
    );

    // ==========================================
    // SCENARIO 7: Circuit Breaker
    // ==========================================
    console.log('--- Running Scenario 7: Circuit Breaker ---');
    await query(`UPDATE endpoints SET active = false WHERE tenant_id = $1`, [tenantAId]);

    const epCbRes = await request(app)
      .post('/endpoints')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .send({ url: MOCK_RECEIVER_URL, rateLimitRps: 20 });
    const cbEpId = epCbRes.body.id;

    // Cause 5 consecutive failures on this endpoint via retries of 1 event
    resetReceiver('always_status', 0, 500);

    const evCb = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .set('Idempotency-Key', `e2e-cb-${Date.now()}`)
      .send({ cb: 'trip' });

    const cbDelId = (
      await query(`SELECT id FROM deliveries WHERE event_id = $1 AND endpoint_id = $2`, [
        evCb.body.id,
        cbEpId,
      ])
    ).rows[0].id;

    for (let f = 1; f <= 5; f++) {
      await poll();
      // Fast-forward next_attempt_at for retry
      await query(`UPDATE deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [cbDelId]);
    }

    const epCheckOpen = (
      await query(`SELECT circuit_state, circuit_until, consecutive_failures FROM endpoints WHERE id = $1`, [cbEpId])
    ).rows[0];

    // Now send another event while circuit is OPEN
    resetReceiver('success'); // Even if receiver is 200, dispatcher should block attempt!
    const evBlocked = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${tenantAKey}`)
      .set('Idempotency-Key', `e2e-cb-blocked-${Date.now()}`)
      .send({ cb: 'blocked' });

    await poll(); // Should be blocked by circuit breaker
    const blockedReceiverCalls = receivedRequests.length; // Should be 0 since circuit is OPEN

    // Fast-forward circuit_until to the past (HALF_OPEN probe)
    await query(`UPDATE endpoints SET circuit_until = now() - interval '1 second' WHERE id = $1`, [cbEpId]);
    // Fast-forward cbDelId (head-of-line delivery) so it executes as the probe
    await query(`UPDATE deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [cbDelId]);

    // Dispatch probe (receiver returns 200)
    await poll();

    const epCheckClosed = (
      await query(`SELECT circuit_state, consecutive_failures FROM endpoints WHERE id = $1`, [cbEpId])
    ).rows[0];

    console.log('Scenario 7 checks:', {
      openState: epCheckOpen?.circuit_state,
      openFailures: epCheckOpen?.consecutive_failures,
      blockedCalls: blockedReceiverCalls,
      closedState: epCheckClosed?.circuit_state,
      closedFailures: epCheckClosed?.consecutive_failures,
    });

    const s7Pass =
      epCheckOpen.circuit_state === 'OPEN' &&
      epCheckOpen.consecutive_failures >= 5 &&
      blockedReceiverCalls === 0 &&
      epCheckClosed.circuit_state === 'CLOSED' &&
      epCheckClosed.consecutive_failures === 0;

    recordScenario(
      'Test 7: Circuit breaker',
      s7Pass,
      `Tripped to OPEN after 5 failures, blocked requests while OPEN, HALF_OPEN probe succeeded and reset circuit to CLOSED`
    );

    // ==========================================
    // SCENARIO 8: Tenant Isolation
    // ==========================================
    console.log('--- Running Scenario 8: Tenant Isolation ---');
    // Create an endpoint for Tenant B
    const epBRes = await request(app)
      .post('/endpoints')
      .set('Authorization', `Bearer ${tenantBKey}`)
      .send({ url: 'https://example.com/tenant-b', rateLimitRps: 10 });
    const epBId = epBRes.body.id;

    // 1. Tenant B lists endpoints -> only sees Tenant B's endpoint, not Tenant A's
    const listBRes = await request(app)
      .get('/endpoints')
      .set('Authorization', `Bearer ${tenantBKey}`);
    const bOnlySeesOwn = listBRes.body.every((ep) => ep.id !== cbEpId && ep.id === epBId);

    // 2. Tenant B tries to update Tenant A's endpoint -> 404
    const patchCrossRes = await request(app)
      .patch(`/endpoints/${cbEpId}`)
      .set('Authorization', `Bearer ${tenantBKey}`)
      .send({ rateLimitRps: 99 });

    // 3. Tenant B tries to view deliveries for Tenant A's event -> 0 deliveries
    const viewCrossRes = await request(app)
      .get(`/events/${event1Id}/deliveries`)
      .set('Authorization', `Bearer ${tenantBKey}`);
    const crossDeliveriesEmpty = viewCrossRes.status === 200 && viewCrossRes.body.deliveries.length === 0;

    // 4. Missing/invalid API key returns 401
    const noAuthRes = await request(app).get('/endpoints');
    const badAuthRes = await request(app).get('/endpoints').set('Authorization', 'Bearer invalid_key_999');

    const s8Pass =
      bOnlySeesOwn &&
      patchCrossRes.status === 404 &&
      crossDeliveriesEmpty &&
      noAuthRes.status === 401 &&
      badAuthRes.status === 401;

    recordScenario(
      'Test 8: Tenant isolation',
      s8Pass,
      `Tenant B cannot view/patch Tenant A resources; cross-tenant accesses return 404/empty; missing/bad keys return 401`
    );

  } finally {
    mockServer.close();
    await closePool();
  }

  console.log('=== ACCEPTANCE TEST SUMMARY ===');
  for (const r of results) {
    console.log(`- ${r.name}: ${r.passed ? 'PASS' : 'FAIL'}`);
  }
  const allPassed = results.every((r) => r.passed);
  console.log(`Total: ${results.length}, Passed: ${results.filter((r) => r.passed).length}, Failed: ${results.filter((r) => !r.passed).length}`);
  if (allPassed) {
    console.log('\n>>> ALL 8 ACCEPTANCE SCENARIOS PASSED SUCCESSFULLY! <<<\n');
  } else {
    console.error('\n>>> SOME ACCEPTANCE SCENARIOS FAILED! <<<\n');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error during acceptance test:', err);
  process.exit(1);
});
