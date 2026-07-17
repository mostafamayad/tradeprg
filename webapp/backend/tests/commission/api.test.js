#!/usr/bin/env node
/**
 * Commission System — API Route Integration Tests
 *
 * Starts the server, makes HTTP requests, validates responses.
 * Uses a separate port to avoid conflicts.
 *
 * Usage:
 *   node tests/commission/api.test.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const http = require('http');
const { getPool, sql } = require('../../database/mssql_db');

const PORT = 10799;
const BASE = `http://localhost:${PORT}/api`;
let server;
let passed = 0, failed = 0, errors = [];
let testPlanId = null;

function req(method, path, body) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'localhost',
            port: PORT,
            path: path,
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        const r = http.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        r.on('error', reject);
        if (body) r.write(JSON.stringify(body));
        r.end();
    });
}

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✅  ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌  ${name}`);
        console.log(`      ${e.message}`);
        errors.push({ name, error: e.message });
    }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

async function seedTestData() {
    const pool = await getPool();
    const now = new Date();
    const period = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    const planResult = await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM commission_plans WHERE plan_name = 'API Test Plan')
            INSERT INTO commission_plans (plan_name, base_rate, company_id, effective_from) VALUES ('API Test Plan', 3.0, NULL, '2026-01-01');
        SELECT id FROM commission_plans WHERE plan_name = 'API Test Plan';
    `);
    const planId = planResult.recordset[0].id;

    const existingTier = await pool.request().query(`
        SELECT 1 FROM commission_tiers WHERE plan_id = ${planId} AND from_percent = 0
    `);
    if (existingTier.recordset.length === 0) {
        await pool.request().query(`
            INSERT INTO commission_tiers (plan_id, from_percent, to_percent, multiplier, tier_label, effective_from)
            VALUES (${planId}, 0, 100, 1.0, '0-100% Test', '2026-01-01')
        `);
    }

    testPlanId = planId;
}

async function cleanupTestData() {
    try {
        const pool = await getPool();
        await pool.request().query(`DELETE FROM commission_voucher_lines WHERE voucher_id IN (SELECT id FROM commission_vouchers WHERE voucher_no LIKE 'API-TEST-%')`);
        await pool.request().query(`DELETE FROM commission_vouchers WHERE voucher_no LIKE 'API-TEST-%'`);
        await pool.request().query(`DELETE FROM commission_audit_log WHERE entity_type = 'api_test'`);
        await pool.request().query(`DELETE FROM commission_adjustments WHERE reason LIKE '%API Test%'`);
        await pool.request().query(`DELETE FROM commission_transactions WHERE rep_id = 9001`);
    } catch (e) { /* ignore cleanup errors */ }
}

async function main() {
    console.log('\n' + '━'.repeat(60));
    console.log('  Commission — API Route Integration Tests');
    console.log('━'.repeat(60));

    await seedTestData();

    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/commissions', require('../../routes/commissions'));
    app.use('/api/commission-plans', require('../../routes/commission_plans'));

    await new Promise(resolve => { server = app.listen(PORT, resolve); });

    try {
        await test('GET /api/commissions/transactions — returns 200', async () => {
            const r = await req('GET', '/api/commissions/transactions?period=2026-07');
            assert(r.status === 200, 'Expected 200, got ' + r.status);
            assert(r.body.success === true, 'Expected success');
        });

        await test('GET /api/commissions/transactions/:id — non-existent returns 404', async () => {
            const r = await req('GET', '/api/commissions/transactions/999999');
            assert(r.status === 404, 'Expected 404, got ' + r.status);
            assert(r.body.success === false, 'Expected success=false');
        });

        await test('POST /api/commissions/period/lock — missing period returns 400', async () => {
            const r = await req('POST', '/api/commissions/period/lock', {});
            assert(r.status === 400, 'Expected 400, got ' + r.status);
        });

        await test('POST /api/commissions/transactions/approve — missing ids returns 400', async () => {
            const r = await req('POST', '/api/commissions/transactions/approve', {});
            assert(r.status === 400, 'Expected 400, got ' + r.status);
        });

        await test('POST /api/commissions/transactions/approve — empty ids returns 400', async () => {
            const r = await req('POST', '/api/commissions/transactions/approve', { ids: [] });
            assert(r.status === 400, 'Expected 400, got ' + r.status);
        });

        await test('POST /api/commissions/settle — missing ids returns 400', async () => {
            const r = await req('POST', '/api/commissions/settle', {});
            assert(r.status === 400, 'Expected 400, got ' + r.status);
        });

        await test('POST /api/commissions/vouchers — missing rep_id returns 400', async () => {
            const r = await req('POST', '/api/commissions/vouchers', { transaction_ids: [1, 2] });
            assert(r.status === 400, 'Expected 400, got ' + r.status);
        });

        await test('POST /api/commissions/vouchers — missing transaction_ids returns 400', async () => {
            const r = await req('POST', '/api/commissions/vouchers', { rep_id: 1 });
            assert(r.status === 400, 'Expected 400, got ' + r.status);
        });

        await test('GET /api/commissions/adjustments — returns 200', async () => {
            const r = await req('GET', '/api/commissions/adjustments');
            assert(r.status === 200, 'Expected 200, got ' + r.status);
            assert(r.body.success === true, 'Expected success');
        });

        await test('POST /api/commissions/adjustments — valid adjustment returns 200', async () => {
            const r = await req('POST', '/api/commissions/adjustments', {
                company_id: null,
                rep_id: 9001,
                period: '2026-07',
                type: 'bonus',
                amount: 50,
                reason: 'API Test — Bonus for good performance',
                approved_by: 1
            });
            assert(r.status === 200, 'Expected 200, got ' + r.status);
            assert(r.body.success === true, 'Expected success');
            assert(r.body.data.id > 0, 'Expected valid id');
        });

        await test('POST /api/commissions/adjustments — invalid type returns 400', async () => {
            const r = await req('POST', '/api/commissions/adjustments', {
                company_id: null,
                rep_id: 9001,
                period: '2026-07',
                type: 'invalid_type',
                amount: 50,
                reason: 'API Test',
                approved_by: 1
            });
            assert(r.status >= 400, 'Expected 4xx, got ' + r.status);
        });

        await test('GET /api/commissions/period/status?period=2026-07 — returns status', async () => {
            const r = await req('GET', '/api/commissions/period/status?period=2026-07');
            assert(r.status === 200, 'Expected 200, got ' + r.status);
            assert(r.body.success === true, 'Expected success');
            assert(r.body.data, 'Expected data');
        });

        await test('GET /api/commissions/period/status — missing period returns 400', async () => {
            const r = await req('GET', '/api/commissions/period/status');
            assert(r.status === 400, 'Expected 400, got ' + r.status);
        });

        await test('GET /api/commissions/aging — returns 200', async () => {
            const r = await req('GET', '/api/commissions/aging');
            assert(r.status === 200, 'Expected 200, got ' + r.status);
            assert(r.body.success === true, 'Expected success');
        });

        await test('GET /api/commissions/ledger/9001?period=2026-07 — returns 200', async () => {
            const r = await req('GET', '/api/commissions/ledger/9001?period=2026-07');
            assert(r.status === 200, 'Expected 200, got ' + r.status);
        });

        await test('GET /api/commissions/ledger/9001 — missing period returns 400', async () => {
            const r = await req('GET', '/api/commissions/ledger/9001');
            assert(r.status === 400, 'Expected 400, got ' + r.status);
        });

        await test('GET /api/commissions/summary/2026-07 — returns 200', async () => {
            const r = await req('GET', '/api/commissions/summary/2026-07');
            assert(r.status === 200, 'Expected 200, got ' + r.status);
            assert(r.body.success === true, 'Expected success');
        });

        await test('GET /api/commissions/vouchers?period=2026-07 — returns 200', async () => {
            const r = await req('GET', '/api/commissions/vouchers?period=2026-07');
            assert(r.status === 200, 'Expected 200, got ' + r.status);
        });

        await test('GET /api/commissions/vouchers — missing period returns 400', async () => {
            const r = await req('GET', '/api/commissions/vouchers');
            assert(r.status === 400, 'Expected 400, got ' + r.status);
        });

        await test('GET /api/commissions/vouchers/999999 — non-existent returns 404', async () => {
            const r = await req('GET', '/api/commissions/vouchers/999999');
            assert(r.status === 404, 'Expected 404, got ' + r.status);
        });

        await test('GET /api/commission-plans — returns 200 with plans', async () => {
            const r = await req('GET', '/api/commission-plans');
            assert(r.status === 200, 'Expected 200, got ' + r.status);
            assert(r.body.success === true, 'Expected success');
            assert(Array.isArray(r.body.data), 'Expected data array');
        });

        await test('GET /api/commission-plans/:id — returns plan with tiers', async () => {
            const r = await req('GET', `/api/commission-plans/${testPlanId}`);
            assert(r.status === 200, 'Expected 200, got ' + r.status);
            assert(r.body.data.plan_name === 'API Test Plan', 'Expected API Test Plan');
            assert(Array.isArray(r.body.data.tiers), 'Expected tiers array');
        });

        await test('GET /api/commission-plans/999999 — non-existent returns 404', async () => {
            const r = await req('GET', '/api/commission-plans/999999');
            assert(r.status === 404, 'Expected 404, got ' + r.status);
        });

        await test('POST /api/commission-plans — creates new plan', async () => {
            const r = await req('POST', '/api/commission-plans', {
                plan_name: 'API Test Plan New',
                base_rate: 4.0,
                company_id: null,
                effective_from: '2026-01-01'
            });
            assert(r.status === 200, 'Expected 200, got ' + r.status);
            assert(r.body.data.id > 0, 'Expected valid id');
        });

        await test('GET /api/commissions/forecast/9001 — returns forecast', async () => {
            const r = await req('GET', '/api/commissions/forecast/9001');
            assert(r.status === 200 || r.status === 404, 'Expected 200 or 404, got ' + r.status);
        });

    } finally {
        server.close();
        await cleanupTestData();
    }

    console.log('\n' + '━'.repeat(60));
    console.log(`  Total: ${passed + failed} tests · ${passed} passed · ${failed} failed`);
    console.log('━'.repeat(60));

    if (failed > 0) {
        console.log('\n  ❌ SOME TESTS FAILED\n');
        process.exit(1);
    } else {
        console.log('\n  ✅ ALL TESTS PASSED\n');
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    if (server) server.close();
    process.exit(1);
});
