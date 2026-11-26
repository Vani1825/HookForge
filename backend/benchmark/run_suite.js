/**
 * Automated Suite Runner for HookForge Performance Benchmarks.
 * Starts the HookForge Express application on port 8081,
 * executes the low-load benchmark scenarios against local endpoints,
 * saves structured reports in backend/benchmark/results/,
 * displays CLI summaries, and gracefully shuts down the server.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import app from '../src/app.js';
import { runScenario, SCENARIO_NAMES } from './scenarios.js';
import { formatJsonReport, formatCliSummary } from './reporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, 'results');

const TEST_API_KEY = 'hf_test_bench_sec_89df71b23c';

async function main() {
  await fs.mkdir(RESULTS_DIR, { recursive: true });

  console.log('Starting HookForge application on 127.0.0.1:8081 for benchmark execution...');
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(8081, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  const baseUrl = 'http://127.0.0.1:8081';
  console.log(`HookForge app listening at ${baseUrl}\n`);

  const results = {};

  try {
    // Scenario 1: Health probe (10 requests, concurrency 2)
    console.log('>>> [1/5] Executing Scenario: health (10 requests, concurrency 2)...');
    const healthResult = await runScenario(SCENARIO_NAMES.HEALTH, {
      baseUrl,
      requests: 10,
      concurrency: 2,
    });
    const healthPath = path.join(RESULTS_DIR, 'health_report.json');
    await fs.writeFile(healthPath, formatJsonReport(healthResult), 'utf-8');
    console.log(formatCliSummary(healthResult));
    console.log(`Saved: ${healthPath}\n`);
    results.health = healthResult;

    // Scenario 2: Cached endpoints list (10 requests, concurrency 2, test auth)
    console.log('>>> [2/5] Executing Scenario: endpoints_list (10 requests, concurrency 2)...');
    const endpointsResult = await runScenario(SCENARIO_NAMES.ENDPOINTS_LIST, {
      baseUrl,
      requests: 10,
      concurrency: 2,
      apiKey: TEST_API_KEY,
    });
    const endpointsPath = path.join(RESULTS_DIR, 'endpoints_list_report.json');
    await fs.writeFile(endpointsPath, formatJsonReport(endpointsResult), 'utf-8');
    console.log(formatCliSummary(endpointsResult));
    console.log(`Saved: ${endpointsPath}\n`);
    results.endpoints_list = endpointsResult;

    // Scenario 3: Analytics overview (10 requests, concurrency 2, test auth)
    console.log('>>> [3/5] Executing Scenario: analytics_overview (10 requests, concurrency 2)...');
    const analyticsResult = await runScenario(SCENARIO_NAMES.ANALYTICS_OVERVIEW, {
      baseUrl,
      requests: 10,
      concurrency: 2,
      apiKey: TEST_API_KEY,
    });
    const analyticsPath = path.join(RESULTS_DIR, 'analytics_overview_report.json');
    await fs.writeFile(analyticsPath, formatJsonReport(analyticsResult), 'utf-8');
    console.log(formatCliSummary(analyticsResult));
    console.log(`Saved: ${analyticsPath}\n`);
    results.analytics_overview = analyticsResult;

    // Scenario 4: Cold vs warm cache comparison (1 cold, 10 warm, concurrency 2)
    console.log('>>> [4/5] Executing Scenario: cold_vs_warm_cache (1 cold, 10 warm, concurrency 2)...');
    const coldWarmResult = await runScenario(SCENARIO_NAMES.COLD_VS_WARM, {
      baseUrl,
      path: '/health',
      requests: 10,
      concurrency: 2,
    });
    const coldWarmPath = path.join(RESULTS_DIR, 'cold_vs_warm_cache_report.json');
    await fs.writeFile(coldWarmPath, formatJsonReport(coldWarmResult), 'utf-8');
    console.log(formatCliSummary(coldWarmResult));
    console.log(`Saved: ${coldWarmPath}\n`);
    results.cold_vs_warm = coldWarmResult;

    // Scenario 5: Rate limit evaluation (35 requests, concurrency 5 against health limiter)
    console.log('>>> [5/5] Executing Scenario: rate_limit_probe (35 requests, concurrency 5)...');
    const rateLimitResult = await runScenario(SCENARIO_NAMES.RATE_LIMIT_PROBE, {
      baseUrl,
      requests: 35,
      concurrency: 5,
    });
    const rateLimitPath = path.join(RESULTS_DIR, 'rate_limit_probe_report.json');
    await fs.writeFile(rateLimitPath, formatJsonReport(rateLimitResult), 'utf-8');
    console.log(formatCliSummary(rateLimitResult));
    console.log(`Saved: ${rateLimitPath}\n`);
    results.rate_limit_probe = rateLimitResult;

    console.log('All 5 benchmark scenarios executed and reports saved successfully.');
  } catch (err) {
    console.error('Benchmark suite execution failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    console.log('HookForge test application server closed.');
  }
}

main();
