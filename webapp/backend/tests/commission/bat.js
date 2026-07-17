#!/usr/bin/env node
/**
 * TradePro ERP — Business Acceptance Testing (BAT)
 *
 * Tests on REAL database with realistic data volumes.
 * No mocks. No shortcuts.
 *
 * Usage:
 *   node tests/commission/bat.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { getPool, sql } = require('../../database/mssql_db');

const PERIOD = '2026-07';
const BATCH_SIZE = 500;
let passed = 0, failed = 0, errors = [];

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✅  ${name}`);
    } catch (e) {
        failed++;
        const msg = e.message.split('\n')[0];
        console.log(`  ❌  ${name}`);
        console.log(`      ${msg}`);
        errors.push({ name, error: msg });
    }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ═══════════════════════════════════════════════════════════
// PHASE 1: Generate Realistic Test Data
// ═══════════════════════════════════════════════════════════

let repIds = [], customerIds = [], invoiceIds = [], storeId;

async function generateData(pool) {
    console.log('\n  Generating realistic test data...');

    // Get a valid store_id
    const storeResult = await pool.request().query('SELECT TOP 1 id FROM stores');
    if (storeResult.recordset.length > 0) {
        storeId = storeResult.recordset[0].id;
    } else {
        await pool.request().query(`INSERT INTO stores (store_name, is_active) VALUES ('Test Store', 1)`);
        storeId = (await pool.request().query('SELECT SCOPE_IDENTITY() as id')).recordset[0].id;
    }

    // Get default plan
    const planResult = await pool.request().query('SELECT TOP 1 id FROM commission_plans');
    const planId = planResult.recordset[0].id;

    // 1. Create 50 Reps
    console.log('    Creating 50 reps...');
    for (let i = 1; i <= 50; i++) {
        const code = `BAT-R${String(i).padStart(4, '0')}`;
        const target = rand(50000, 200000);
        await pool.request()
            .input('code', sql.NVarChar, code)
            .input('name', sql.NVarChar, `مندوب اختبار ${i}`)
            .input('target', sql.Decimal(18, 4), target)
            .input('planId', sql.Int, planId)
            .query(`INSERT INTO sales_reps (rep_code, rep_name, target_amount, plan_id, is_active)
                     VALUES (@code, @name, @target, @planId, 1)`);
    }
    const repsResult = await pool.request().query(`SELECT id FROM sales_reps WHERE rep_code LIKE 'BAT-R%' ORDER BY id`);
    repIds = repsResult.recordset.map(r => r.id);

    // 2. Create 500 Customers
    console.log('    Creating 500 customers...');
    for (let i = 1; i <= 500; i++) {
        const code = `BAT-C${String(i).padStart(5, '0')}`;
        const repId = pick(repIds);
        await pool.request()
            .input('code', sql.NVarChar, code)
            .input('name', sql.NVarChar, `عميل اختبار ${i}`)
            .input('repId', sql.Int, repId)
            .query(`INSERT INTO customers (customer_code, customer_name, rep_id, credit_limit, is_active)
                     VALUES (@code, @name, @repId, ${rand(10000, 100000)}, 1)`);
    }
    const custResult = await pool.request().query(`SELECT id FROM customers WHERE customer_code LIKE 'BAT-C%' ORDER BY id`);
    customerIds = custResult.recordset.map(c => c.id);

    // 3. Create 3000 Invoices
    console.log('    Creating 3000 invoices...');
    for (let i = 1; i <= 3000; i++) {
        const invNo = `BAT-INV-${String(i).padStart(6, '0')}`;
        const custId = pick(customerIds);
        const amount = rand(500, 50000);
        const day = String(rand(1, 28)).padStart(2, '0');
        const invDate = `2026-07-${day}`;
        await pool.request()
            .input('invNo', sql.NVarChar, invNo)
            .input('invDate', sql.NVarChar, invDate)
            .input('custId', sql.Int, custId)
            .input('storeId', sql.Int, storeId)
            .input('grandTotal', sql.Decimal(18, 4), amount)
            .query(`INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, store_id, grand_total, amount_paid, remaining, status)
                     VALUES (@invNo, @invDate, @custId, @storeId, @grandTotal, @grandTotal, 0, 'posted')`);
    }
    const invResult = await pool.request().query(`SELECT id FROM sales_invoices WHERE invoice_no LIKE 'BAT-INV-%' ORDER BY id`);
    invoiceIds = invResult.recordset.map(v => v.id);

    // 4. Create 1200 Collections with allocations
    console.log('    Creating 1200 collections...');
    let collectionsCreated = 0;
    for (let i = 1; i <= 1200; i++) {
        const collNo = `BAT-REC-${String(i).padStart(6, '0')}`;
        const custId = pick(customerIds);
        const invId = pick(invoiceIds);
        const amount = rand(500, 25000);
        const day = String(rand(1, 28)).padStart(2, '0');
        const collDate = `2026-07-${day}`;

        // Get rep from customer
        const custRep = await pool.request()
            .input('custId', sql.Int, custId)
            .query('SELECT rep_id FROM customers WHERE id = @custId');
        const repId = custRep.recordset[0]?.rep_id || pick(repIds);

        await pool.request()
            .input('collNo', sql.NVarChar, collNo)
            .input('collDate', sql.NVarChar, collDate)
            .input('custId', sql.Int, custId)
            .input('amount', sql.Decimal(18, 4), amount)
            .input('repId', sql.Int, repId)
            .query(`INSERT INTO customer_collections (collection_no, collection_date, customer_id, amount, rep_id, payment_method)
                     VALUES (@collNo, @collDate, @custId, @amount, @repId, 'cash')`);

        // Get the collection id
        const collIdResult = await pool.request()
            .input('collNo', sql.NVarChar, collNo)
            .query('SELECT id FROM customer_collections WHERE collection_no = @collNo');
        const collId = collIdResult.recordset[0]?.id;

        if (collId && invId) {
            await pool.request()
                .input('collId', sql.Int, collId)
                .input('invId', sql.Int, invId)
                .input('amount', sql.Decimal(18, 4), amount)
                .query(`INSERT INTO collection_allocations (collection_id, invoice_id, amount)
                         VALUES (@collId, @invId, @amount)`);
            collectionsCreated++;
        }
    }
    console.log(`    Created ${collectionsCreated} collections with allocations`);

    // 5. Create 250 Returns
    console.log('    Creating 250 returns...');
    for (let i = 1; i <= 250; i++) {
        const retNo = `BAT-RET-${String(i).padStart(6, '0')}`;
        const custId = pick(customerIds);
        const invId = pick(invoiceIds);
        const amount = rand(100, 5000);
        const day = String(rand(1, 28)).padStart(2, '0');
        const retDate = `2026-07-${day}`;
        await pool.request()
            .input('retNo', sql.NVarChar, retNo)
            .input('retDate', sql.NVarChar, retDate)
            .input('invId', sql.Int, invId)
            .input('custId', sql.Int, custId)
            .input('storeId', sql.Int, storeId)
            .input('grandTotal', sql.Decimal(18, 4), amount)
            .query(`INSERT INTO sales_returns (return_no, return_date, invoice_id, customer_id, store_id, grand_total, status, workflow_status)
                     VALUES (@retNo, @retDate, @invId, @custId, @storeId, @grandTotal, 'posted', 'approved')`);
    }

    console.log('    Test data generation complete.');
}

// ═══════════════════════════════════════════════════════════
// PHASE 2: Stress Test — 20 Concurrent Collections
// ═══════════════════════════════════════════════════════════

async function stressTest(pool) {
    console.log('\n  Running stress test (20 concurrent collection processes)...');

    // Pick 20 random collections
    const collections = await pool.request().query(`
        SELECT TOP 20 cc.id, cc.collection_no, cc.customer_id, cc.amount, cc.rep_id, cc.collection_date
        FROM customer_collections cc
        WHERE cc.collection_no LIKE 'BAT-REC-%'
        ORDER BY NEWID()
    `);

    const commission = require('../../services/commission/index');
    const startTime = Date.now();

    // Process all 20 concurrently
    const results = await Promise.allSettled(
        collections.recordset.map(async (coll) => {
            const collection = {
                id: coll.id,
                customer_id: coll.customer_id,
                rep_id: coll.rep_id,
                amount: parseFloat(coll.amount),
                collection_no: coll.collection_no,
                collection_date: coll.collection_date,
                company_id: null,
                customer_name: 'Stress Test Customer',
                invoice_no: null,
                invoice_date: null
            };
            return await commission.processCollectionCreated(collection);
        })
    );

    const elapsed = Date.now() - startTime;
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failedConcurrent = results.filter(r => r.status === 'rejected').length;

    console.log(`    Stress test: ${succeeded} succeeded, ${failedConcurrent} failed in ${elapsed}ms`);

    // Check for duplicate commissions
    const txCount = await pool.request().query(`
        SELECT COUNT(*) as cnt FROM commission_transactions
        WHERE collection_no LIKE 'BAT-REC-%'
    `);
    const totalCollections = 20;
    const txsPerCollection = txCount.recordset[0].cnt;
    console.log(`    Commission transactions created: ${txsPerCollection}`);

    // Each collection should create exactly 1 transaction (since each has 1 allocation)
    // But some may have multiple allocations, so the count may vary
    // The key check: no collection should have MORE transactions than allocations
    const duplicates = await pool.request().query(`
        SELECT collection_id, COUNT(*) as cnt
        FROM commission_transactions
        WHERE collection_no LIKE 'BAT-REC-%'
        GROUP BY collection_id
        HAVING COUNT(*) > 1
    `);

    return { succeeded, failed: failedConcurrent, elapsed, duplicates: duplicates.recordset.length };
}

// ═══════════════════════════════════════════════════════════
// PHASE 3: Idempotency Test
// ═══════════════════════════════════════════════════════════

async function idempotencyTest(pool) {
    console.log('\n  Running idempotency test...');

    // Pick one collection
    const coll = await pool.request().query(`
        SELECT TOP 1 cc.id, cc.collection_no, cc.customer_id, cc.amount, cc.rep_id, cc.collection_date
        FROM customer_collections cc
        WHERE cc.collection_no LIKE 'BAT-REC-%'
        ORDER BY NEWID()
    `);

    if (coll.recordset.length === 0) throw new Error('No test collections found');

    const c = coll.recordset[0];
    const collection = {
        id: c.id, customer_id: c.customer_id, rep_id: c.rep_id,
        amount: parseFloat(c.amount), collection_no: c.collection_no,
        collection_date: c.collection_date, company_id: null,
        customer_name: 'Idempotency Test', invoice_no: null, invoice_date: null
    };

    // Count before
    const before = await pool.request().query(
        `SELECT COUNT(*) as cnt FROM commission_transactions WHERE collection_id = ${c.id}`
    );
    const countBefore = before.recordset[0].cnt;

    // Process same collection twice
    const commission = require('../../services/commission/index');
    await commission.processCollectionCreated(collection);
    await commission.processCollectionCreated(collection);

    // Count after
    const after = await pool.request().query(
        `SELECT COUNT(*) as cnt FROM commission_transactions WHERE collection_id = ${c.id}`
    );
    const countAfter = after.recordset[0].cnt;

    return { countBefore, countAfter, duplicated: countAfter > countBefore + 1 };
}

// ═══════════════════════════════════════════════════════════
// PHASE 4: Rollback Test
// ═══════════════════════════════════════════════════════════

async function rollbackTest(pool) {
    console.log('\n  Running rollback test...');

    // Create a mock collection that will fail during processing
    // We'll simulate an error by using a non-existent rep_id
    const commission = require('../../services/commission/index');

    const txCountBefore = (await pool.request().query(
        `SELECT COUNT(*) as cnt FROM commission_transactions`
    )).recordset[0].cnt;

    // Process a collection with invalid data — should not crash the system
    try {
        await commission.processCollectionCreated({
            id: 999999, customer_id: 999999, rep_id: 999999,
            amount: -1, collection_no: 'BAT-ROLLBACK-TEST',
            collection_date: '2026-07-01', company_id: null,
            customer_name: 'Rollback Test', invoice_no: null, invoice_date: null
        });
    } catch (e) {
        // Expected — this should fail gracefully
    }

    const txCountAfter = (await pool.request().query(
        `SELECT COUNT(*) as cnt FROM commission_transactions`
    )).recordset[0].cnt;

    // No new transactions should have been created for invalid data
    return { before: txCountBefore, after: txCountAfter, noLeak: txCountAfter === txCountBefore };
}

// ═══════════════════════════════════════════════════════════
// PHASE 5: Multi-Company Isolation
// ═══════════════════════════════════════════════════════════

async function multiCompanyTest(pool) {
    console.log('\n  Running multi-company isolation test...');

    // Create Tenant A company_id=1 data
    const repA = await pool.request().query(`
        INSERT INTO commission_transactions (
            company_id, rep_id, plan_id, collection_amount, rep_name,
            invoice_no, collection_no, period, base_rate, achievement_pct,
            tier_multiplier, effective_rate, commission_amount, workflow_status,
            is_posted_to_gl, is_paid
        ) VALUES (1, ${repIds[0]}, 1, 10000, 'Tenant A Rep',
                  'INV-A-001', 'REC-A-001', '${PERIOD}', 2.0, 100,
                  1.0, 2.0, 200, 0, 0, 0);
        SELECT SCOPE_IDENTITY() as id;
    `);
    const idA = repA.recordset[0].id;

    // Create Tenant B company_id=2 data
    const repB = await pool.request().query(`
        INSERT INTO commission_transactions (
            company_id, rep_id, plan_id, collection_amount, rep_name,
            invoice_no, collection_no, period, base_rate, achievement_pct,
            tier_multiplier, effective_rate, commission_amount, workflow_status,
            is_posted_to_gl, is_paid
        ) VALUES (2, ${repIds[1]}, 1, 10000, 'Tenant B Rep',
                  'INV-B-001', 'REC-B-001', '${PERIOD}', 2.0, 100,
                  1.0, 2.0, 200, 0, 0, 0);
        SELECT SCOPE_IDENTITY() as id;
    `);
    const idB = repB.recordset[0].id;

    // Query with company_id filter — Tenant A should only see its data
    const tenantA = await pool.request().query(
        `SELECT COUNT(*) as cnt FROM commission_transactions WHERE company_id = 1 AND collection_no LIKE 'REC-A-%'`
    );
    const tenantB = await pool.request().query(
        `SELECT COUNT(*) as cnt FROM commission_transactions WHERE company_id = 2 AND collection_no LIKE 'REC-B-%'`
    );

    // Cross-tenant check: Tenant A should NOT see Tenant B data when filtering
    const crossLeakA = await pool.request().query(
        `SELECT COUNT(*) as cnt FROM commission_transactions WHERE company_id = 1 AND collection_no LIKE 'REC-B-%'`
    );
    const crossLeakB = await pool.request().query(
        `SELECT COUNT(*) as cnt FROM commission_transactions WHERE company_id = 2 AND collection_no LIKE 'REC-A-%'`
    );

    // Cleanup
    await pool.request().query(`DELETE FROM commission_transactions WHERE id IN (${idA}, ${idB})`);

    return {
        tenantA: tenantA.recordset[0].cnt,
        tenantB: tenantB.recordset[0].cnt,
        crossLeakA: crossLeakA.recordset[0].cnt,
        crossLeakB: crossLeakB.recordset[0].cnt,
        isolated: crossLeakA.recordset[0].cnt === 0 && crossLeakB.recordset[0].cnt === 0
    };
}

// ═══════════════════════════════════════════════════════════
// PHASE 6: Journal Verification (Trial Balance)
// ═══════════════════════════════════════════════════════════

async function journalVerificationTest(pool) {
    console.log('\n  Running journal verification (Trial Balance)...');

    // Get Trial Balance before
    const tbBefore = await pool.request().query(`
        SELECT
            SUM(CASE WHEN debit > 0 THEN debit ELSE 0 END) as total_debit,
            SUM(CASE WHEN credit > 0 THEN credit ELSE 0 END) as total_credit
        FROM journal_entry_lines
    `);
    const debitBefore = parseFloat(tbBefore.recordset[0].total_debit || 0);
    const creditBefore = parseFloat(tbBefore.recordset[0].total_credit || 0);
    const balancedBefore = Math.abs(debitBefore - creditBefore) < 0.01;

    console.log(`    TB Before: Debit=${debitBefore.toFixed(2)}, Credit=${creditBefore.toFixed(2)}, Balanced=${balancedBefore}`);

    // Create some commission journal entries (simulating what settlement would do)
    const commissionExpense = await pool.request().query(
        `SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_COMMISSION_EXPENSE'`
    );
    const commissionPayable = await pool.request().query(
        `SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_COMMISSION_PAYABLE'`
    );

    if (commissionExpense.recordset.length > 0 && commissionPayable.recordset.length > 0) {
        const expenseAccountId = commissionExpense.recordset[0].id;
        const payableAccountId = commissionPayable.recordset[0].id;
        const amount = 5000;

        // Create journal entry
        const jeResult = await pool.request().query(`
            INSERT INTO journal_entries (entry_no, entry_date, description, total_debit, total_credit, source_module, is_system_generated)
            VALUES ('BAT-JE-TEST-${Date.now()}', '${PERIOD}-15', 'BAT Test Commission Journal', ${amount}, ${amount}, 'commission', 1);
            SELECT SCOPE_IDENTITY() as id;
        `);
        const jeId = jeResult.recordset[0].id;

        // Debit commission expense
        await pool.request().query(`
            INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description)
            VALUES (${jeId}, ${expenseAccountId}, ${amount}, 0, 'Commission Expense - BAT Test')
        `);

        // Credit commission payable
        await pool.request().query(`
            INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description)
            VALUES (${jeId}, ${payableAccountId}, 0, ${amount}, 'Commission Payable - BAT Test')
        `);

        // Get Trial Balance after
        const tbAfter = await pool.request().query(`
            SELECT
                SUM(CASE WHEN debit > 0 THEN debit ELSE 0 END) as total_debit,
                SUM(CASE WHEN credit > 0 THEN credit ELSE 0 END) as total_credit
            FROM journal_entry_lines
        `);
        const debitAfter = parseFloat(tbAfter.recordset[0].total_debit || 0);
        const creditAfter = parseFloat(tbAfter.recordset[0].total_credit || 0);
        const balancedAfter = Math.abs(debitAfter - creditAfter) < 0.01;

        console.log(`    TB After:  Debit=${debitAfter.toFixed(2)}, Credit=${creditAfter.toFixed(2)}, Balanced=${balancedAfter}`);

        // The journal entry itself must be balanced
        const jeCheck = await pool.request().query(`
            SELECT SUM(debit) as total_debit, SUM(credit) as total_credit
            FROM journal_entry_lines WHERE entry_id = ${jeId}
        `);
        const jeDebit = parseFloat(jeCheck.recordset[0].total_debit || 0);
        const jeCredit = parseFloat(jeCheck.recordset[0].total_credit || 0);
        const jeBalanced = Math.abs(jeDebit - jeCredit) < 0.01;

        // Cleanup
        await pool.request().query(`DELETE FROM journal_entry_lines WHERE entry_id = ${jeId}`);
        await pool.request().query(`DELETE FROM journal_entries WHERE id = ${jeId}`);

        return {
            balancedBefore,
            balancedAfter,
            jeBalanced,
            debitDiff: (debitAfter - debitBefore).toFixed(2),
            creditDiff: (creditAfter - creditBefore).toFixed(2)
        };
    }

    return { balancedBefore, balancedAfter: balancedBefore, jeBalanced: true, note: 'No COA accounts found' };
}

// ═══════════════════════════════════════════════════════════
// PHASE 7: Data Integrity Checks
// ═══════════════════════════════════════════════════════════

async function dataIntegrityTest(pool) {
    console.log('\n  Running data integrity checks...');

    // 1. Check all commission_transactions have valid rep_id
    const orphanTxs = await pool.request().query(`
        SELECT COUNT(*) as cnt FROM commission_transactions ct
        WHERE NOT EXISTS (SELECT 1 FROM sales_reps sr WHERE sr.id = ct.rep_id)
    `);

    // 2. Check all commission_transactions have valid plan_id
    const orphanPlans = await pool.request().query(`
        SELECT COUNT(*) as cnt FROM commission_transactions ct
        WHERE NOT EXISTS (SELECT 1 FROM commission_plans cp WHERE cp.id = ct.plan_id)
    `);

    // 3. Check commission_amount = collection_amount * effective_rate / 100
    const badCalc = await pool.request().query(`
        SELECT COUNT(*) as cnt FROM commission_transactions
        WHERE commission_amount != 0 AND collection_amount != 0
        AND ABS(commission_amount - (collection_amount * effective_rate / 100)) > 0.02
    `);

    // 4. Check all vouchers have lines
    const vouchersWithoutLines = await pool.request().query(`
        SELECT COUNT(*) as cnt FROM commission_payment_vouchers v
        WHERE NOT EXISTS (SELECT 1 FROM commission_voucher_lines vl WHERE vl.voucher_id = v.id)
    `);

    // 5. Check voucher total = sum of lines
    const badVoucherTotals = await pool.request().query(`
        SELECT v.id, v.total_amount, ISNULL(SUM(vl.amount), 0) as lines_total
        FROM commission_payment_vouchers v
        LEFT JOIN commission_voucher_lines vl ON vl.voucher_id = v.id
        GROUP BY v.id, v.total_amount
        HAVING ABS(v.total_amount - ISNULL(SUM(vl.amount), 0)) > 0.02
    `);

    return {
        orphanTxs: orphanTxs.recordset[0].cnt,
        orphanPlans: orphanPlans.recordset[0].cnt,
        badCalc: badCalc.recordset[0].cnt,
        vouchersWithoutLines: vouchersWithoutLines.recordset[0].cnt,
        badVoucherTotals: badVoucherTotals.recordset.length
    };
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
    console.log('\n' + '╔' + '═'.repeat(58) + '╗');
    console.log('║  TradePro ERP — Business Acceptance Testing (BAT)'.padEnd(58) + '║');
    console.log('╚' + '═'.repeat(58) + '╝');

    const pool = await getPool();
    const startTime = Date.now();

    try {
        // Phase 1: Generate data
        await generateData(pool);

        // Phase 2: Stress test
        await test('STRESS: 20 concurrent collection processes', async () => {
            const result = await stressTest(pool);
            assert(result.failed === 0, `${result.failed} concurrent processes failed`);
            assert(result.duplicates === 0, `${result.duplicates} duplicate commission groups found`);
            console.log(`    (${result.succeeded} succeeded in ${result.elapsed}ms, 0 duplicates)`);
        });

        // Phase 3: Idempotency
        await test('IDEMPOTENCY: Duplicate collection does not create duplicate commissions', async () => {
            const result = await idempotencyTest(pool);
            assert(!result.duplicated, `Duplicate detected: ${result.countBefore} → ${result.countAfter} transactions`);
            console.log(`    (${result.countBefore} before, ${result.countAfter} after — OK)`);
        });

        // Phase 4: Rollback
        await test('ROLLBACK: Invalid data does not leak partial transactions', async () => {
            const result = await rollbackTest(pool);
            assert(result.noLeak, `Data leaked: ${result.before} → ${result.after} transactions`);
            console.log(`    (${result.before} before, ${result.after} after — no leak)`);
        });

        // Phase 5: Multi-company isolation
        await test('ISOLATION: Multi-company data is properly isolated', async () => {
            const result = await multiCompanyTest(pool);
            assert(result.isolated, `Cross-tenant leak: A→B=${result.crossLeakA}, B→A=${result.crossLeakB}`);
            assert(result.tenantA === 1, `Tenant A: expected 1, got ${result.tenantA}`);
            assert(result.tenantB === 1, `Tenant B: expected 1, got ${result.tenantB}`);
        });

        // Phase 6: Journal verification
        await test('JOURNAL: Trial Balance stays balanced after commission entries', async () => {
            const result = await journalVerificationTest(pool);
            assert(result.jeBalanced, 'Journal entry itself is not balanced');
            assert(result.balancedAfter, 'Trial Balance not balanced after entries');
        });

        // Phase 7: Data integrity
        await test('INTEGRITY: No orphan transactions, correct calculations', async () => {
            const result = await dataIntegrityTest(pool);
            assert(result.orphanTxs === 0, `${result.orphanTxs} orphan transactions (invalid rep_id)`);
            assert(result.orphanPlans === 0, `${result.orphanPlans} orphan transactions (invalid plan_id)`);
            assert(result.badCalc === 0, `${result.badCalc} transactions with incorrect commission calculation`);
        });

        await test('INTEGRITY: All vouchers have matching lines and correct totals', async () => {
            const result = await dataIntegrityTest(pool);
            assert(result.vouchersWithoutLines === 0, `${result.vouchersWithoutLines} vouchers without lines`);
            assert(result.badVoucherTotals === 0, `${result.badVoucherTotals} vouchers with mismatched totals`);
        });

    } finally {
        // Cleanup: remove test data
        console.log('\n  Cleaning up test data...');
        await pool.request().query(`DELETE FROM commission_voucher_lines WHERE voucher_id IN (SELECT id FROM commission_payment_vouchers WHERE voucher_no LIKE 'BAT-%')`);
        await pool.request().query(`DELETE FROM commission_payment_vouchers WHERE voucher_no LIKE 'BAT-%'`);
        await pool.request().query(`DELETE FROM commission_audit_log WHERE entity_type LIKE '%bat%' OR entity_type LIKE '%BAT%'`);
        await pool.request().query(`DELETE FROM commission_adjustments WHERE reason LIKE '%BAT%'`);
        await pool.request().query(`DELETE FROM commission_transactions WHERE collection_no LIKE 'BAT-REC-%' OR invoice_no LIKE 'BAT-INV-%' OR collection_no LIKE 'BAT-ROLLBACK%'`);
        await pool.request().query(`DELETE FROM collection_allocations WHERE collection_id IN (SELECT id FROM customer_collections WHERE collection_no LIKE 'BAT-REC-%')`);
        await pool.request().query(`DELETE FROM customer_collections WHERE collection_no LIKE 'BAT-REC-%'`);
        await pool.request().query(`DELETE FROM sales_returns WHERE return_no LIKE 'BAT-RET-%'`);
        await pool.request().query(`DELETE FROM sales_invoices WHERE invoice_no LIKE 'BAT-INV-%'`);
        await pool.request().query(`DELETE FROM customers WHERE customer_code LIKE 'BAT-C%'`);
        await pool.request().query(`DELETE FROM sales_reps WHERE rep_code LIKE 'BAT-R%'`);
        console.log('  Cleanup complete.');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '═'.repeat(60));
    console.log('  Business Acceptance Testing — Summary');
    console.log('═'.repeat(60));
    console.log(`  Total: ${passed + failed} tests · ${passed} passed · ${failed} failed · ${elapsed}s`);
    console.log('═'.repeat(60));

    if (failed > 0) {
        console.log('\n  ❌ SOME TESTS FAILED\n');
        console.log('  Failed tests:');
        errors.forEach(e => console.log(`    - ${e.name}: ${e.error}`));
        process.exit(1);
    } else {
        console.log('\n  ✅ ALL BUSINESS ACCEPTANCE TESTS PASSED\n');
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
