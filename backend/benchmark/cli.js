#!/usr/bin/env node

/**
 * CLI Entrypoint for HookForge Performance Benchmarking.
 * Usage:
 *   node benchmark/cli.js --scenario=health --concurrency=5 --requests=50
 *   node benchmark/cli.js --scenario=cold_vs_warm_cache
 *   node benchmark/cli.js --json
 */

import { runScenario, SCENARIO_NAMES } from './scenarios.js';
import { formatCliSummary, formatJsonReport } from './reporter.js';

function parseArgs(argv) {
  const options = {
    scenario: SCENARIO_NAMES.HEALTH,
    requests: 50,
    concurrency: 5,
    baseUrl: process.env.BENCHMARK_BASE_URL || 'http://127.0.0.1:8081',
    apiKey: process.env.BENCHMARK_API_KEY || '',
    output: '',
    json: false,
    help: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--scenario=')) {
      options.scenario = arg.split('=')[1].trim();
    } else if (arg.startsWith('--requests=')) {
      options.requests = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--concurrency=')) {
      options.concurrency = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--url=')) {
      options.baseUrl = arg.split('=')[1].trim();
    } else if (arg.startsWith('--key=')) {
      options.apiKey = arg.split('=')[1].trim();
    } else if (arg.startsWith('--output=')) {
      options.output = arg.split('=')[1].trim();
    } else if (arg.startsWith('--out=')) {
      options.output = arg.split('=')[1].trim();
    }
  }

  return options;
}

function printHelp() {
  console.log(`
HookForge Performance Benchmarking CLI

Usage:
  node benchmark/cli.js [options]
  npm run benchmark -- [options]

Options:
  --scenario=<name>    Scenario to run (default: "health")
                       Available: ${Object.values(SCENARIO_NAMES).join(', ')}
  --requests=<n>       Total number of requests (default: 50)
  --concurrency=<n>    Concurrent worker count (default: 5)
  --url=<baseUrl>      Target base URL (default: http://127.0.0.1:8081)
  --key=<apiKey>       Tenant API Key for authenticated endpoints
  --json               Output structured JSON report
  --help, -h           Show this help message
`);
}

async function main() {
  const options = parseArgs(process.argv);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    const result = await runScenario(options.scenario, {
      baseUrl: options.baseUrl,
      requests: options.requests,
      concurrency: options.concurrency,
      apiKey: options.apiKey,
    });

    if (options.output) {
      const fs = await import('fs/promises');
      const path = await import('path');
      await fs.mkdir(path.dirname(options.output), { recursive: true });
      await fs.writeFile(options.output, formatJsonReport(result), 'utf-8');
      if (!options.json) {
        console.log(`\nReport saved to: ${options.output}`);
      }
    }

    if (options.json) {
      console.log(formatJsonReport(result));
    } else {
      console.log(formatCliSummary(result));
    }
  } catch (err) {
    console.error(`\n[Benchmark Error] ${err.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('cli.js')) {
  main();
}

export default main;
