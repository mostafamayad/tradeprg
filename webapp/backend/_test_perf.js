/**
 * Performance & Stress Testing Suite
 *
 * Phases:
 *   1. Benchmark existing query times (baseline)
 *   2. Identify missing indexes
 *   3. Generate bulk data (100K products, 20K customers, 10K suppliers, ...)
 *   4. Benchmark after bulk data
 *   5. Concurrency / race condition tests
 *   6. Report generation
 *
 * Usage: node _test_perf.js
 *   --skip-data   Skip bulk data generation (just benchmark)
 *   --skip-bench  Skip benchmark (just generate data)
 *   --clean       Clean generated data before exit
 */

const { getPool, sql } = require('./database/mssql_db');
const poolPromise = getPool();

const args = process.argv.slice(2);
const SKIP_DATA = args.includes('--skip-data');
const SKIP_BENCH = args.includes('--skip-bench');
const CLEAN = args.includes('--clean');

// ── Helpers ──
const elapsed = (start) => ((Date.now() - start) / 1000).toFixed(3) + 's';
const fmt = (n) => (n || 0).toLocaleString('en-US');

let report = {};
let benches = {};

async function bench(name, fn) {
    const start = Date.now();
    try {
        await fn();
        const t = Date.now() - start;
        if (!benches[name]) benches[name] = [];
        benches[name].push(t);
        console.log(`  ${name}: ${(t/1000).toFixed(3)}s`);
        return t;
    } catch (e) {
        console.log(`  ${name}: FAILED - ${e.message}`);
        return -1;
    }
}

async function main() {
    const pool = await poolPromise;
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║     PERFORMANCE & STRESS TESTING SUITE         ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    // ──────────────────────────────────────────────────
    // 1. CURRENT STATE
    // ──────────────────────────────────────────────────
    console.log('═══ PHASE 0: Current State ═══');
    const counts = {};
    const tables = ['chart_of_accounts','journal_entries','journal_entry_lines','sales_invoices',
        'sales_invoice_items','purchase_invoices','purchase_invoice_items','products','customers',
        'suppliers','treasury_accounts','treasury_transactions','expenses','inventory_balances',
        'stock_movements','customer_collections','supplier_payments','checks','stores','users',
        'fiscal_periods','categories'];
    for (const t of tables) {
        try {
            const r = await pool.request().query(`SELECT COUNT(*) AS cnt FROM ${t}`);
            counts[t] = r.recordset[0].cnt;
        } catch(e) { counts[t] = -1; }
    }
    for (const t of tables) {
        if (counts[t] !== -1) console.log(`  ${t.padEnd(30)} ${fmt(counts[t])}`);
    }
    report.initialCounts = { ...counts };

    // ──────────────────────────────────────────────────
    // 2. BASELINE BENCHMARKS
    // ──────────────────────────────────────────────────
    if (!SKIP_BENCH) {
        console.log('\n═══ PHASE 1: Baseline Benchmarks ═══');

        // Journal list pagination
        await bench('JE List (page 1)', async () => {
            await pool.request().query('SELECT TOP 20 j.* FROM journal_entries j ORDER BY j.id DESC');
        });

        // Trial balance
        await bench('Trial Balance (all)', async () => {
            await pool.request().query(`
                SELECT a.id, a.account_code, a.account_name, a.account_type, a.system_code,
                       ISNULL(SUM(l.debit),0) AS total_debit, ISNULL(SUM(l.credit),0) AS total_credit
                FROM chart_of_accounts a
                LEFT JOIN journal_entry_lines l ON l.account_id = a.id
                GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.system_code
                ORDER BY a.account_code`);
        });

        // Account statement (GL)
        await bench('GL Account (SYS_CASH)', async () => {
            await pool.request().query(`
                SELECT j.entry_date, j.description, l.debit, l.credit,
                       SUM(ISNULL(l.debit,0)-ISNULL(l.credit,0)) OVER(ORDER BY j.entry_date, j.id ROWS UNBOUNDED PRECEDING) AS balance
                FROM journal_entry_lines l
                JOIN journal_entries j ON l.entry_id = j.id
                WHERE l.account_id = (SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_CASH')
                ORDER BY j.entry_date, j.id`);
        });

        // Item search
        await bench('Product Search (LIKE)', async () => {
            await pool.request().query("SELECT TOP 20 * FROM products WHERE product_name LIKE '%test%' OR product_code LIKE '%test%' ORDER BY product_name");
        });

        // Customer search
        await bench('Customer Search (LIKE)', async () => {
            await pool.request().query("SELECT TOP 20 * FROM customers WHERE customer_name LIKE '%test%' OR customer_code LIKE '%test%' ORDER BY customer_name");
        });
    }

    // ──────────────────────────────────────────────────
    // 3. MISSING INDEX CHECK
    // ──────────────────────────────────────────────────
    if (!SKIP_BENCH) {
        console.log('\n═══ PHASE 2: Index Analysis ═══');
        let missingIdxCount = 0;
        try {
            const missingIdx = await pool.request().query(`
                SELECT TOP 20 OBJECT_NAME(mid.object_id) AS [table], mid.equality_columns, mid.inequality_columns, mid.included_columns
                FROM sys.dm_db_missing_index_details mid
                WHERE mid.database_id = DB_ID()
                ORDER BY mid.object_id`);
            missingIdxCount = missingIdx.recordset.length;
            if (missingIdxCount === 0) {
                console.log('  ✓ No missing indexes detected by query optimizer');
            } else {
                console.log(`  ⚠ Found ${missingIdxCount} missing index(es) (hidden until large data)`);
            }
            report.missingIndexes = missingIdxCount;
        } catch(e) {
            console.log('  - Cannot read missing indexes (DMV permission?)');
            report.missingIndexes = -1;
        }

        // Check key performance indexes exist
        const existingIdx = await pool.request().query(`
            SELECT i.name, OBJECT_NAME(i.object_id) AS tbl
            FROM sys.indexes i WHERE i.name IN (
                'IX_jel_account_id','IX_jel_entry_id','IX_je_entry_date','IX_je_reference','IX_je_source',
                'IX_ib_store_product','IX_sm_store_product',
                'IX_si_customer_date','IX_pi_supplier_date')`);
        const idxNames = existingIdx.recordset.map(r => r.name);
        const required = ['IX_jel_account_id','IX_jel_entry_id','IX_je_entry_date','IX_ib_store_product','IX_sm_store_product'];
        for (const r of required) {
            if (!idxNames.includes(r)) console.log(`  ⚠ MISSING: ${r} — should be created from migration 016`);
        }
        report.existingIndexes = idxNames;
    }

    // ──────────────────────────────────────────────────
    // 4. BULK DATA GENERATION
    // ──────────────────────────────────────────────────
    if (!SKIP_DATA) {
        console.log('\n══════════════════════════════════════════════════');
        console.log('║        BULK DATA GENERATION                    ║');
        console.log('╚══════════════════════════════════════════════════\n');

        const TOTAL_PRODUCTS = 10000;
        const TOTAL_CUSTOMERS = 5000;
        const TOTAL_SUPPLIERS = 2000;
        const TOTAL_SALES_INV = 10000;
        const ITEMS_PER_INV = 3;

        const clearData = async () => {
            console.log('  Cleaning previous PERF-TEST data...');
            const del = async (q) => { try { await pool.request().query(q); } catch(e){} };
            const tables = ['journal_entry_lines','journal_entries','sales_return_items','sales_returns',
                'collection_allocations','customer_collections','supplier_payments',
                'customer_activity_log'];
            for (const t of tables) await del(`DELETE FROM ${t} WHERE description LIKE '%PERF-TEST%' OR notes LIKE '%PERF-TEST%'`);
            await del("DELETE FROM sales_invoice_items WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE invoice_no LIKE 'PERF-INV%')");
            await del("DELETE FROM sales_invoices WHERE invoice_no LIKE 'PERF-INV%'");
            await del("DELETE FROM purchase_invoice_items WHERE invoice_id IN (SELECT id FROM purchase_invoices WHERE invoice_no LIKE 'PERF-PUR%')");
            await del("DELETE FROM purchase_invoices WHERE invoice_no LIKE 'PERF-PUR%'");
            await del("DELETE FROM stock_movements WHERE document_no LIKE 'PERF-INV%' OR document_no LIKE 'PERF-PUR%'");
            await del("DELETE FROM inventory_balances WHERE product_id IN (SELECT id FROM products WHERE notes = 'PERF-TEST')");
            await del("DELETE FROM products WHERE notes = 'PERF-TEST'");
            await del("DELETE FROM customers WHERE notes = 'PERF-TEST'");
            await del("DELETE FROM suppliers WHERE notes = 'PERF-TEST'");
            console.log('  Cleanup done');
        };

        await clearData();

        // ── 4a: Stores (stored globally) ──
        let storeId = 1;
        const st = await pool.request().query("SELECT TOP 1 id FROM stores ORDER BY id");
        if (st.recordset.length > 0) storeId = st.recordset[0].id;
        else {
            const r = await pool.request().query("INSERT INTO stores (store_name, store_type) OUTPUT INSERTED.id VALUES ('PERF-TEST-Main', 'main')");
            storeId = r.recordset[0].id;
        }
        // Store it on the pool for concurrency test to use
        pool._perfStoreId = storeId;

        // ── 4b: Products (use notes='PERF-TEST' to identify test data) ──
        console.log(`\n  Generating ${TOTAL_PRODUCTS.toLocaleString()} products...`);
        const t0 = Date.now();
        const BATCH = 1000;
        for (let i = 0; i < TOTAL_PRODUCTS; i += BATCH) {
            const vals = [];
            for (let j = 0; j < BATCH && i + j < TOTAL_PRODUCTS; j++) {
                const n = i + j + 1;
                    vals.push(`(N'PERF-PROD-${n}', N'PERF-TEST Product ${n}', N'pcs', 0, 0, ${10 + (n % 100)}, N'PERF-TEST')`);
            }
            await pool.request().query(`INSERT INTO products (product_code, product_name, unit_name, cost_price, sell_price, min_stock, notes) VALUES ${vals.join(',')}`);
            if ((i + BATCH) % 5000 === 0) process.stdout.write(`    ${i + BATCH}/${TOTAL_PRODUCTS}\r`);
        }
        console.log(`\n  ✓ Products: ${((Date.now()-t0)/1000).toFixed(1)}s`);

        // ── 4c: Inventory balances ──
        const prodIds = (await pool.request().query(`SELECT id FROM products WHERE notes = 'PERF-TEST' ORDER BY id`)).recordset;
        console.log(`  Setting inventory balances for ${prodIds.length} products...`);
        const t0b = Date.now();
        let ibCount = 0;
        for (let i = 0; i < prodIds.length; i += BATCH) {
            const batch = prodIds.slice(i, i + BATCH);
            const vals = batch.map(p => `(${p.id}, ${storeId}, ${Math.floor(Math.random() * 500) + 10})`);
            await pool.request().query(`INSERT INTO inventory_balances (product_id, store_id, quantity) VALUES ${vals.join(',')}`);
            ibCount += batch.length;
        }
        console.log(`  ✓ Inventory balances: ${ibCount}, ${((Date.now()-t0b)/1000).toFixed(1)}s`);

        // ── 4d: Customers ──
        console.log(`\n  Generating ${TOTAL_CUSTOMERS.toLocaleString()} customers...`);
        const t0c = Date.now();
        for (let i = 0; i < TOTAL_CUSTOMERS; i += BATCH) {
            const vals = [];
            for (let j = 0; j < BATCH && i + j < TOTAL_CUSTOMERS; j++) {
                const n = i + j + 1;
                vals.push(`(N'PERF-CUST-${n}', N'PERF-TEST Customer ${n}', N'0100${String(n).padStart(8,'0')}', N'perf${n}@test.com', N'PERF-TEST')`);
            }
            await pool.request().query(`INSERT INTO customers (customer_code, customer_name, phone, email, notes) VALUES ${vals.join(',')}`);
        }
        console.log(`  ✓ Customers: ${((Date.now()-t0c)/1000).toFixed(1)}s`);

        // ── 4e: Suppliers ──
        console.log(`\n  Generating ${TOTAL_SUPPLIERS.toLocaleString()} suppliers...`);
        const t0s = Date.now();
        for (let i = 0; i < TOTAL_SUPPLIERS; i += BATCH) {
            const vals = [];
            for (let j = 0; j < BATCH && i + j < TOTAL_SUPPLIERS; j++) {
                const n = i + j + 1;
                vals.push(`(N'PERF-SUP-${n}', N'PERF-TEST Supplier ${n}', N'0200${String(n).padStart(8,'0')}', N'PERF-TEST')`);
            }
            await pool.request().query(`INSERT INTO suppliers (supplier_code, supplier_name, phone, notes) VALUES ${vals.join(',')}`);
        }
        console.log(`  ✓ Suppliers: ${((Date.now()-t0s)/1000).toFixed(1)}s`);

        // ── 4f: System accounts ──
        const sysId = async (code) => {
            const r = await pool.request().input('c', sql.NVarChar, code).query("SELECT id FROM chart_of_accounts WHERE system_code = @c");
            return r.recordset[0]?.id;
        };
        const accAR = await sysId('SYS_AR');
        const accSales = await sysId('SYS_SALES');
        const accVATOut = await sysId('SYS_VAT_OUTPUT');
        const accInv = await sysId('SYS_INVENTORY');
        const accCOGS = await sysId('SYS_COGS');

        // ── 4g: Sales Invoices with items + JEs ──
        console.log(`\n  Generating ${TOTAL_SALES_INV.toLocaleString()} sales invoices...`);
        const t0i = Date.now();
        const custIds = (await pool.request().query("SELECT id FROM customers WHERE notes = 'PERF-TEST' ORDER BY id")).recordset;
        const invCount = custIds.length;
        let invCreated = 0, jelCreated = 0;

        for (let i = 0; i < TOTAL_SALES_INV; i++) {
            const cust = custIds[i % invCount];
            const invNo = `PERF-INV-${i + 1}`;
            const invDate = `2026-${String(Math.floor(i / 400) + 1).padStart(2,'0')}-${String((i % 28) + 1).padStart(2,'0')}`;
            const itemCount = Math.min(ITEMS_PER_INV, prodIds.length);
            const subtotal = itemCount * 100;
            const taxAmount = subtotal * 0.15;
            const grandTotal = subtotal + taxAmount;

            const trans = new sql.Transaction(pool);
            await trans.begin();
            const tx = trans.request();
            try {
                const invR = await tx.input('invNo', sql.NVarChar, invNo)
                    .input('invDate', sql.NVarChar, invDate)
                    .input('custId', sql.Int, cust.id)
                    .input('sid', sql.Int, storeId)
                    .input('sub', sql.Decimal(18,2), subtotal)
                    .input('tax', sql.Decimal(18,2), taxAmount)
                    .input('gt', sql.Decimal(18,2), grandTotal)
                    .query(`INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, store_id, payment_type,
                            subtotal, tax_amount, grand_total, amount_paid, remaining, status, notes)
                            OUTPUT INSERTED.id
                            VALUES (@invNo, @invDate, @custId, @sid, 'cash', @sub, @tax, @gt, 0, @gt, 'posted', 'PERF-TEST invoice')`);
                const invId = invR.recordset[0].id;

                for (let k = 0; k < itemCount; k++) {
                    const pIdx = ((i * 7 + k * 3) % prodIds.length);
                    const p = prodIds[pIdx];
                    await tx.query(`INSERT INTO sales_invoice_items (invoice_id, product_id, quantity, unit_price, line_total) VALUES (${invId}, ${p.id}, 1, 100, 100)`);
                    await tx.query(`UPDATE inventory_balances SET quantity = quantity - 1 WHERE product_id = ${p.id} AND store_id = ${storeId}`);
                }

                // Post JE directly: Dr AR / Cr Sales / Cr VAT
                const entryNo = `PERF-JE-${i+1}`;
                const jeR = await tx.input('eNo', sql.NVarChar, entryNo)
                    .query(`INSERT INTO journal_entries (entry_no, entry_date, description, total_debit, total_credit, created_by, source_module, source_action, source_document, is_system_generated)
                            OUTPUT INSERTED.id
                            VALUES (@eNo, @invDate, 'PERF-TEST invoice', @gt, @gt, 11, 'sales', 'invoice', @invNo, 0)`);
                const jeId = jeR.recordset[0].id;
                // JE lines
                await tx.query(`INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description) VALUES (${jeId}, ${accAR}, ${grandTotal}, 0, 'ذمم مدينة')`);
                await tx.query(`INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description) VALUES (${jeId}, ${accSales}, 0, ${subtotal}, 'إيراد مبيعات')`);
                await tx.query(`INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description) VALUES (${jeId}, ${accVATOut}, 0, ${taxAmount}, 'ضريبة مخرجات')`);

                await trans.commit();
                invCreated++;
                jelCreated += 3;
            } catch (e) {
                await trans.rollback();
            }
            if (i > 0 && i % 2500 === 0) console.log(`    ${i}/${TOTAL_SALES_INV} invoices (${((Date.now()-t0i)/1000).toFixed(1)}s)`);
        }
        console.log(`  ✓ Sales invoices: ${invCreated} (${((Date.now()-t0i)/1000).toFixed(1)}s), JE lines: ${jelCreated}`);

        // Report counts
        const finalCounts = {};
        for (const t of tables) {
            try {
                const r = await pool.request().query(`SELECT COUNT(*) AS cnt FROM ${t}`);
                finalCounts[t] = r.recordset[0].cnt;
            } catch(e) {}
        }
        report.finalCounts = finalCounts;
        console.log('\n  Final counts:');
        for (const t of tables) {
            if (finalCounts[t] !== undefined) console.log(`    ${t.padEnd(30)} ${fmt(finalCounts[t])}`);
        }
    }

    // ──────────────────────────────────────────────────
    // 5. POST-LOAD BENCHMARKS
    // ──────────────────────────────────────────────────
    if (!SKIP_BENCH) {
        console.log('\n═══ PHASE 3: Post-Load Benchmarks ═══');

        // Trial Balance
        await bench('Trial Balance (all accounts)', async () => {
            await pool.request().query(`
                SELECT a.id, a.account_code, a.account_name, a.account_type,
                       ISNULL(SUM(l.debit),0) AS td, ISNULL(SUM(l.credit),0) AS tc
                FROM chart_of_accounts a
                LEFT JOIN journal_entry_lines l ON l.account_id = a.id
                GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.system_code
                ORDER BY a.account_code`);
        });

        // Trial Balance with date filter
        await bench('Trial Balance (Jul 2026)', async () => {
            await pool.request().query(`
                SELECT a.id, a.account_code, a.account_name, a.account_type,
                       ISNULL(SUM(CASE WHEN j.entry_date < '2026-07-01' THEN l.debit ELSE 0 END),0) AS od,
                       ISNULL(SUM(CASE WHEN j.entry_date < '2026-07-01' THEN l.credit ELSE 0 END),0) AS oc,
                       ISNULL(SUM(CASE WHEN j.entry_date >= '2026-07-01' THEN l.debit ELSE 0 END),0) AS pd,
                       ISNULL(SUM(CASE WHEN j.entry_date >= '2026-07-01' THEN l.credit ELSE 0 END),0) AS pc
                FROM chart_of_accounts a
                LEFT JOIN journal_entry_lines l ON l.account_id = a.id
                LEFT JOIN journal_entries j ON l.entry_id = j.id
                GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.system_code
                ORDER BY a.account_code`);
        });

        // Account statement (SYS_CASH)
        await bench('GL Statement (SYS_CASH)', async () => {
            await pool.request().query(`
                SELECT j.entry_date, l.debit, l.credit,
                       SUM(ISNULL(l.debit,0)-ISNULL(l.credit,0)) OVER(ORDER BY j.entry_date, j.id ROWS UNBOUNDED PRECEDING) AS balance
                FROM journal_entry_lines l
                JOIN journal_entries j ON l.entry_id = j.id
                WHERE l.account_id = (SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_CASH')
                ORDER BY j.entry_date, j.id`);
        });

        // Balance Sheet
        await bench('Balance Sheet', async () => {
            await pool.request().query(`
                SELECT a.id, a.account_code, a.account_name, a.account_type,
                       ISNULL(SUM(l.debit),0) - ISNULL(SUM(l.credit),0) AS balance
                FROM chart_of_accounts a
                LEFT JOIN journal_entry_lines l ON l.account_id = a.id
                WHERE a.account_type IN ('asset','liability','equity')
                GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.system_code
                ORDER BY a.account_code`);
        });

        // Product search
        await bench('Product Search (LIKE)', async () => {
            await pool.request().query("SELECT TOP 20 * FROM products WHERE product_name LIKE '%PERF-TEST%' OR product_code LIKE '%PERF-TEST%' ORDER BY product_name");
        });

        // Customer search
        await bench('Customer Search (LIKE)', async () => {
            await pool.request().query("SELECT TOP 20 * FROM customers WHERE customer_name LIKE '%PERF-TEST%' OR customer_code LIKE '%PERF-TEST%' ORDER BY customer_name");
        });

        // Journal browser
        await bench('Journal Browser (page 1)', async () => {
            await pool.request().query(`
                SELECT j.* FROM journal_entries j
                ORDER BY j.id DESC OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY`);
        });

        // Dashboard: total sales
        await bench('Dashboard: total sales sum', async () => {
            await pool.request().query("SELECT COUNT(*), ISNULL(SUM(grand_total),0) FROM sales_invoices WHERE invoice_no LIKE 'PERF-INV%'");
        });

        // Missing indexes after load
        let mid2 = { recordset: [] };
        try {
            mid2 = await pool.request().query(`
                SELECT TOP 10 OBJECT_NAME(mid.object_id) AS tbl,
                       mid.equality_columns, mid.inequality_columns, mid.included_columns
                FROM sys.dm_db_missing_index_details mid
                WHERE mid.database_id = DB_ID()
                ORDER BY mid.object_id`);
        } catch(e) { /* DMV not accessible */ }
        report.missingAfterLoad = mid2.recordset.map(r => ({ table: r.tbl, columns: r.equality_columns }));
        if (mid2.recordset.length > 0) {
            console.log('\n  Top missing indexes after load:');
            mid2.recordset.forEach(r => console.log(`    ${r.tbl}: ${r.equality_columns || ''} ${r.inequality_columns || ''} INCLUDE ${r.included_columns || ''} (impact: ${Math.round(r.impact)})`));
        }

        // Index fragmentation
        let frag = { recordset: [] };
        try {
            frag = await pool.request().query(`
                SELECT OBJECT_NAME(ips.object_id) AS tbl, i.name AS idx,
                       ips.avg_fragmentation_in_percent
                FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
                JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
                WHERE ips.avg_fragmentation_in_percent > 30
                ORDER BY ips.avg_fragmentation_in_percent DESC`);
        } catch(e) { /* DMV not accessible */ }
        if (frag.recordset.length > 0) {
            console.log('\n  ⚠ High fragmentation indexes:');
            frag.recordset.forEach(r => console.log(`    ${r.tbl}.${r.idx}: ${Math.round(r.avg_fragmentation_in_percent)}%`));
        }
        report.fragmentation = frag.recordset.map(r => ({ table: r.tbl, index: r.idx, frag: r.avg_fragmentation_in_percent }));
    }

    // ──────────────────────────────────────────────────
    // 6. CONCURRENCY TESTS
    // ──────────────────────────────────────────────────
    if (!SKIP_BENCH) {
        console.log('\n═══ PHASE 4: Concurrency Tests ═══');

        const sIdResult = await pool.request().query("SELECT TOP 1 id FROM stores ORDER BY id");
        const conStoreId = sIdResult.recordset[0]?.id || 1;
        const targetProd = await pool.request().query("SELECT TOP 1 id FROM products WHERE notes = 'PERF-TEST' ORDER BY id");
        const cust = await pool.request().query("SELECT TOP 1 id FROM customers WHERE notes = 'PERF-TEST' ORDER BY id");

        if (!targetProd.recordset[0] || !cust.recordset[0]) {
            console.log('  ⚠ No test products/customers available, skipping concurrency');
        } else {
            const prodId = targetProd.recordset[0].id;
            const custId = cust.recordset[0].id;

            // Warm-up: pre-compile plans and warm pool (single batch to avoid Transaction API issues)
            await pool.request().query(`
                BEGIN TRANSACTION;
                UPDATE inventory_balances SET quantity = quantity + 0 WHERE product_id = ${prodId} AND store_id = ${conStoreId};
                INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, store_id, created_by, grand_total, subtotal, tax_amount, amount_paid, remaining, status, notes)
                VALUES (0,'2026-07-22',${custId},${conStoreId},1,0,0,0,0,0,'posted','PERF-TEST warmup');
                COMMIT TRANSACTION;`);
            await pool.request().query(`DELETE FROM sales_invoices WHERE notes = 'PERF-TEST warmup'`);

            async function concurrencyTask(concurrent, desc) {
                console.log(`\n  ${desc} — ${concurrent} tasks on the SAME product (worst-case contention)`);
                const results = [];
                const tasks = [];
                for (let i = 0; i < concurrent; i++) {
                    tasks.push((async (idx) => {
                        const start = Date.now();
                        const invNo = `PERF-CON-${Date.now()}-${idx}`;
                        try {
                            // Single SQL batch: atomic UPDATE+INSERT+COMMIT on one connection
                            // Avoids mssql Transaction API which has concurrency issues with msnodesqlv8
                            const r = pool.request();
                            r.input('invNo', sql.NVarChar, invNo);
                            r.input('prodId', sql.Int, prodId);
                            r.input('storeId', sql.Int, conStoreId);
                            r.input('custId', sql.Int, custId);
                            const result = await r.query(`
                                DECLARE @old_qty DECIMAL(18,4);
                                DECLARE @result TABLE (old_qty DECIMAL(18,4));
                                
                                BEGIN TRANSACTION;
                                
                                UPDATE inventory_balances 
                                SET quantity = quantity - 1 
                                OUTPUT DELETED.quantity INTO @result
                                WHERE product_id = @prodId AND store_id = @storeId;
                                
                                SELECT @old_qty = old_qty FROM @result;
                                
                                IF ISNULL(@old_qty, 0) > 0
                                BEGIN
                                    INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, store_id, payment_type,
                                        subtotal, tax_amount, grand_total, amount_paid, remaining, status, notes)
                                    VALUES (@invNo, '2026-07-22', @custId, @storeId, 'cash',
                                        100, 15, 115, 0, 115, 'posted', 'PERF-TEST concurrency');
                                    SELECT 1 AS success;
                                    COMMIT TRANSACTION;
                                END
                                ELSE
                                BEGIN
                                    SELECT 0 AS success;
                                    ROLLBACK TRANSACTION;
                                END
                            `);
                            const success = result.recordset[0]?.success === 1;
                            return { idx, ok: success, time: Date.now() - start, error: success ? undefined : 'Insufficient stock' };
                        } catch (e) {
                            return { idx, ok: false, time: Date.now() - start, error: e.message };
                        }
                    })(i));
                }
                const conRes = await Promise.all(tasks);
                for (const r of conRes) {
                    console.log(`    Task ${r.idx}: ${r.ok ? 'OK' : 'FAIL'} (${(r.time/1000).toFixed(3)}s)${r.error ? ' - ' + r.error : ''}`);
                    results.push(r);
                }
                const okCount = results.filter(r => r.ok).length;
                const failCount = results.filter(r => !r.ok).length;
                const avgTime = results.filter(r => r.ok).reduce((s, r) => s + r.time, 0) / Math.max(okCount, 1);
                const maxTime = results.filter(r => r.ok).reduce((m, r) => Math.max(m, r.time), 0);
                const deadlocks = results.filter(r => !r.ok && (r.error || '').toLowerCase().includes('deadlock'));
                console.log(`  ➤ ${desc}: ${okCount}/${concurrent} OK, ${failCount} failed, ${deadlocks.length} deadlocks`);
                console.log(`  ➤ Avg: ${(avgTime/1000).toFixed(1)}s, Max: ${(maxTime/1000).toFixed(1)}s`);

                // Check negative stock
                const neg = await pool.request().query(`SELECT quantity FROM inventory_balances WHERE product_id = ${prodId} AND store_id = ${conStoreId}`);
                const stockAfter = parseFloat(neg.recordset[0]?.quantity ?? 0);
                console.log(`  ➤ Stock after: ${stockAfter}${stockAfter < 0 ? ' ⚠ NEGATIVE!' : ''}`);
                return results;
            }

            // Run three concurrency levels sequentially (10, 20, 50)
            for (const { count, label } of [{count:10, label:'10 users'}, {count:20, label:'20 users'}, {count:50, label:'50 users'}]) {
                // Ensure enough stock before each run
                await pool.request().query(`UPDATE inventory_balances SET quantity = 500 WHERE product_id = ${prodId} AND store_id = ${conStoreId}`);
                const r = await concurrencyTask(count, label);

                // Reset for next round (rollback concurrency test invoices)
                await pool.request().query(`DELETE FROM sales_invoices WHERE notes = 'PERF-TEST concurrency' AND invoice_no LIKE 'PERF-CON%'`);
                await pool.request().query(`UPDATE inventory_balances SET quantity = 500 WHERE product_id = ${prodId} AND store_id = ${conStoreId}`);
            }
        }
    }

    // ──────────────────────────────────────────────────
    // 7. CLEANUP
    // ──────────────────────────────────────────────────
    // Add index rebuild recommendation
    if (report.fragmentation && report.fragmentation.some(f => f.frag > 80)) {
        console.log('\n⚠ CRITICAL: Indexes with >80% fragmentation need rebuilding:');
        report.fragmentation.filter(f => f.frag > 80).forEach(f => console.log(`  ALTER INDEX [${f.index}] ON [dbo].[${f.table}] REBUILD;`));
    }

    if (CLEAN && !SKIP_DATA) {
        console.log('\n═══ Cleanup ═══');
        const del = async (q) => { try { await pool.request().query(q); } catch(e){} };
        const jel = ['journal_entry_lines','journal_entries','sales_return_items','sales_returns',
            'collection_allocations','customer_collections','supplier_payments','customer_activity_log'];
        for (const t of jel) await del(`DELETE FROM ${t} WHERE description LIKE '%PERF-TEST%' OR notes LIKE '%PERF-TEST%'`);
        await del("DELETE FROM sales_invoice_items WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE invoice_no LIKE 'PERF-INV%')");
        await del("DELETE FROM sales_invoices WHERE invoice_no LIKE 'PERF-INV%'");
        await del("DELETE FROM purchase_invoice_items WHERE invoice_id IN (SELECT id FROM purchase_invoices WHERE invoice_no LIKE 'PERF-PUR%')");
        await del("DELETE FROM purchase_invoices WHERE invoice_no LIKE 'PERF-PUR%'");
        await del("DELETE FROM stock_movements WHERE document_no LIKE 'PERF-INV%' OR document_no LIKE 'PERF-PUR%'");
        await del("DELETE FROM inventory_balances WHERE product_id IN (SELECT id FROM products WHERE notes = 'PERF-TEST')");
        await del("DELETE FROM products WHERE notes = 'PERF-TEST'");
        await del("DELETE FROM customers WHERE notes = 'PERF-TEST'");
        await del("DELETE FROM suppliers WHERE notes = 'PERF-TEST'");
        await del("DELETE FROM stores WHERE store_name = 'PERF-TEST-Main'");
        console.log('  Party data cleaned');
    }

    // ──────────────────────────────────────────────────
    // 8. FINAL REPORT
    // ──────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════');
    console.log('║            PERFORMANCE TEST REPORT              ║');
    console.log('╚══════════════════════════════════════════════════\n');

    console.log('Data Volume:');
    if (report.finalCounts) {
        for (const t of tables) {
            if (report.finalCounts[t] !== undefined) {
                const init = report.initialCounts[t] || 0;
                console.log(`  ${t.padEnd(32)} ${fmt(report.finalCounts[t])} (${fmt(report.finalCounts[t] - init)} new)`);
            }
        }
    }

    console.log('\nBenchmark Times:');
    const slowThreshold = 2000;
    let allGreen = true;
    for (const [name, times] of Object.entries(benches)) {
        const avg = times.reduce((a,b) => a + b, 0) / times.length;
        const max = Math.max(...times);
        const ok = max < slowThreshold;
        if (!ok) allGreen = false;
        console.log(`  ${name.padEnd(40)} avg=${(avg/1000).toFixed(3)}s  max=${(max/1000).toFixed(3)}s  ${ok ? '✓' : '⚠ SLOW > 2s'}`);
    }

    if (report.missingAfterLoad && report.missingAfterLoad.length > 0) {
        console.log(`\nMissing Indexes: ${report.missingAfterLoad.length}`);
        console.log('  Run migration 016 to add performance indexes if not already done.');
    }

    if (report.concurrency) {
        console.log(`\nConcurrency: ${report.concurrency.succeeded}/${report.concurrency.total} passed`);
        if (report.concurrency.failed > 0) {
            console.log(`  ⚠ ${report.concurrency.failed} tasks failed - review deadlocks/race conditions`);
        }
    }

    console.log(`\nOverall: ${allGreen ? '✓ ALL BENCHMARKS UNDER 2s' : '⚠ Some operations exceed 2s threshold'}`);
    console.log('\n══════════════════════════════════════════════════');

    pool.close();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
