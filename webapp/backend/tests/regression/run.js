#!/usr/bin/env node
/**
 * TradePro ERP — Full Baseline Regression Suite
 *
 * Runs all 4 layers in sequence:
 *   1. API Contract — every endpoint, status codes, JSON shapes
 *   2. Database Snapshot — table counts, checksums, indexes
 *   3. Business Flows — end-to-end scenarios
 *   4. Performance Baseline — response times, payload sizes
 *
 * Usage:
 *   node tests/regression/run.js
 *
 * Requires: running server on port 3000
 * Option:  node tests/regression/run.js --skip-performance
 */

const Suite = require('../lib/runner');

const SKIP_PERF = process.argv.includes('--skip-performance');

async function main() {
    // Verify server is running
    try {
        const r = await fetch('http://localhost:3000/api/company/info');
        if (!r.ok && r.status !== 200) throw new Error('Server not responding');
        console.log('✅  Server connection verified (port 3000)');
    } catch (e) {
        console.error('❌  Cannot connect to server. Is it running on http://localhost:3000 ?');
        console.error('   Start with: cd backend && node server.js');
        process.exit(1);
    }

    const suites = [];

    // Layer 1
    const apiContract = require('../baseline/api_contract');
    suites.push(await apiContract());

    // Layer 2
    const dbSnapshot = require('../baseline/db_snapshot');
    suites.push(await dbSnapshot());

    // Layer 3
    const businessFlows = require('../baseline/business_flows');
    suites.push(await businessFlows());

    // Layer 4 (optional)
    if (!SKIP_PERF) {
        const performance = require('../baseline/performance');
        suites.push(await performance());
    } else {
        console.log('\n⏭️  Skipping performance baseline (--skip-performance)');
    }

    const result = await Suite.runAll(suites);

    process.exit(result.failed > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('Fatal:', e.message);
    process.exit(1);
});
