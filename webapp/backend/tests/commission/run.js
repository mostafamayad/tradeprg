#!/usr/bin/env node
/**
 * TradePro ERP — Commission System Test Suite
 *
 * Runs all commission unit tests (no server required):
 *   1. Tier Engine — tier selection logic
 *   2. Validator — input validation
 *   3. Snapshot Builder — snapshot structure
 *   4. Calculator — calculation logic with mocked DB
 *
 * Usage:
 *   node tests/commission/run.js
 */

async function main() {
    const suites = [];

    suites.push(await require('./tierEngine.test')());
    suites.push(await require('./validator.test')());
    suites.push(await require('./snapshotBuilder.test')());
    suites.push(await require('./calculator.test')());

    console.log('\n' + '═'.repeat(60));
    console.log('  Commission System — Test Summary');
    console.log('═'.repeat(60));

    let totalPassed = 0, totalFailed = 0;
    for (const s of suites) {
        totalPassed += s.passed;
        totalFailed += s.failed;
    }

    console.log(`  Total: ${totalPassed + totalFailed} tests · ${totalPassed} passed · ${totalFailed} failed`);
    console.log('═'.repeat(60));

    if (totalFailed > 0) {
        console.log('\n  ❌ SOME TESTS FAILED\n');
        process.exit(1);
    } else {
        console.log('\n  ✅ ALL TESTS PASSED\n');
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
