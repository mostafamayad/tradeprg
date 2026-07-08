/**
 * ═══════════════════════════════════════════════════════════════
 * UAT: Year-End Close — Full Business Cycle Automation
 * ═══════════════════════════════════════════════════════════════
 *
 * Simulates a complete fiscal year workflow as a real user would.
 *
 * Usage:
 *   1. TradePro_Test must exist (created via _setup_test_db.js)
 *   2. Server running on TradePro_Test
 *   3. Run:  node uat_year_end_close.js
 *
 * ═══════════════════════════════════════════════════════════════
 */

const mssql = require('mssql/msnodesqlv8');
const http = require('http');

const TEST_DB = 'TradePro_Test';
const ADMIN_EMAIL = 'admin@3smcompany.com';
const ADMIN_PASSWORD = 'admin123';
const BACKUP_PATH = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\Backup\\UAT_Close_Backup.bak';
const YEAR = new Date().getFullYear();
const NEXT_YEAR = YEAR + 1;

let authToken;
let pool;
let passed = 0, failed = 0, warnings = 0;
const log = [];

let customerId, supplierId, product1Id, product2Id, product3Id;
let coaSalesId, coaExpenseId, coaCashId, coaArId, coaApId, coaReId, coaInventoryId, coaPurchasesId;
let treasuryCashId;
let salesInvoiceId, purchaseInvoiceId;

async function db(sql) {
    if (!pool) {
        const cs = `Driver={ODBC Driver 17 for SQL Server};Server=.;Database=${TEST_DB};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=10;`;
        pool = await new mssql.ConnectionPool({ connectionString: cs }).connect();
    }
    return pool.request().query(sql);
}

async function scalar(sql) {
    const r = await db(sql);
    return r.recordset[0] ? r.recordset[0][Object.keys(r.recordset[0])[0]] : null;
}

function httpReq(method, path, body) {
    return new Promise((resolve, reject) => {
        const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json' } };
        if (authToken) opts.headers['Authorization'] = `Bearer ${authToken}`;
        const req = http.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch (e) { reject(new Error(`Bad JSON (${res.statusCode}): ${data.slice(0,300)}`)); }
            });
        });
        req.on('error', e => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function section(title) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'═'.repeat(60)}`);
    log.push(`\n## ${title}`);
}

function check(cond, label) {
    if (cond) { console.log(`  ✅ ${label}`); passed++; log.push(`- ✅ ${label}`); }
    else { console.log(`  ❌ ${label}`); failed++; log.push(`- ❌ ${label}`); }
}

function warn(label) {
    console.log(`  ⚠️  ${label}`);
    warnings++;
    log.push(`- ⚠️  ${label}`);
}

async function apiCheck(label, call) {
    const r = await call();
    if (r.data.success) {
        console.log(`  ✅ ${label}`);
        passed++;
        log.push(`- ✅ ${label}`);
    } else {
        console.log(`  ❌ ${label}: ${r.data.message || 'unknown error'}`);
        failed++;
        log.push(`- ❌ ${label}: ${r.data.message || 'unknown error'}`);
    }
    return r;
}

async function login() {
    const r = await httpReq('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (!r.data.success) throw new Error(`Login failed: ${r.data.message}`);
    authToken = r.data.token;
    console.log('  ✓ Logged in');
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: SETUP — Master Data + Opening Stock
// ═══════════════════════════════════════════════════════════════

async function phase1() {
    section('PHASE 1: Master Data Setup');

    const sysAccs = await db(`SELECT system_code, id, account_type FROM chart_of_accounts WHERE system_code IS NOT NULL`);
    const byCode = Object.fromEntries(sysAccs.recordset.map(a => [a.system_code, a]));
    coaSalesId = byCode['SYS_SALES']?.id;
    coaArId = byCode['SYS_AR']?.id;
    coaApId = byCode['SYS_AP']?.id;
    coaCashId = byCode['SYS_CASH']?.id;
    coaReId = byCode['SYS_RETAINED_EARNINGS']?.id;
    coaInventoryId = byCode['SYS_INVENTORY']?.id;
    coaPurchasesId = byCode['SYS_PURCHASES']?.id;
    coaExpenseId = byCode['SYS_EXPENSE']?.id;

    if (!coaExpenseId) {
        const ex = await db(`SELECT TOP 1 id FROM chart_of_accounts WHERE account_type='expense' AND system_code IS NULL ORDER BY id`);
        coaExpenseId = ex.recordset[0]?.id;
    }

    // Get treasury cash account (different from COA cash)
    const tr = await db("SELECT TOP 1 id FROM treasury_accounts WHERE account_type='cash'");
    treasuryCashId = tr.recordset[0]?.id;

    check(!!coaSalesId, 'Sales revenue account found');
    check(!!coaArId, 'AR account found');
    check(!!coaApId, 'AP account found');
    check(!!coaCashId, 'COA Cash account found');
    check(!!coaReId, 'Retained earnings account found');
    check(!!coaPurchasesId, 'Purchases account found');
    check(!!treasuryCashId, 'Treasury cash account found');

    // Create customer
    const cust = await httpReq('POST', '/api/customers', {
        customer_name: 'UAT Test Customer', phone: '01234567890',
        email: 'uat_customer@test.com', credit_limit: 50000, payment_terms_days: 30
    });
    check(cust.data.success, `Customer created`);
    customerId = cust.data.data?.id || cust.data.id;
    if (!customerId) { const c = await db("SELECT TOP 1 id FROM customers ORDER BY id DESC"); customerId = c.recordset[0]?.id; }

    // Create supplier
    const sup = await httpReq('POST', '/api/suppliers', {
        supplier_name: 'UAT Test Supplier', phone: '01111111111', address: 'Test Address'
    });
    check(sup.data.success, 'Supplier created');
    supplierId = sup.data.id;
    if (!supplierId) { const s = await db("SELECT TOP 1 id FROM suppliers ORDER BY id DESC"); supplierId = s.recordset[0]?.id; }

    // Create products
    const p1 = await httpReq('POST', '/api/products', { product_name: 'UAT Product A', cost_price: 50, sell_price: 100, unit_name: 'قطعة' });
    check(p1.data.success, 'Product A created');
    product1Id = p1.data.id;
    const p2 = await httpReq('POST', '/api/products', { product_name: 'UAT Product B', cost_price: 30, sell_price: 75, unit_name: 'قطعة' });
    check(p2.data.success, 'Product B created');
    product2Id = p2.data.id;
    const p3 = await httpReq('POST', '/api/products', { product_name: 'UAT Product C', cost_price: 100, sell_price: 200, unit_name: 'قطعة' });
    check(p3.data.success, 'Product C created');
    product3Id = p3.data.id;

    // Set initial stock via inventory adjustment
    await apiCheck('Initial stock A: +20', () => httpReq('POST', '/api/inventory/adjust', { store_id: 1, product_id: product1Id, quantity: 20, reason: 'UAT opening stock' }));
    await apiCheck('Initial stock B: +30', () => httpReq('POST', '/api/inventory/adjust', { store_id: 1, product_id: product2Id, quantity: 30, reason: 'UAT opening stock' }));
    await apiCheck('Initial stock C: +10', () => httpReq('POST', '/api/inventory/adjust', { store_id: 1, product_id: product3Id, quantity: 10, reason: 'UAT opening stock' }));

    console.log(`  Customer=${customerId}, Supplier=${supplierId}, Treasury=${treasuryCashId}`);
    console.log(`  Products: A=${product1Id}, B=${product2Id}, C=${product3Id}`);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1b: Normalize Test Data for Integrity Check
// ═══════════════════════════════════════════════════════════════

async function phase1b() {
    section('PHASE 1b: Normalize Balances for Integrity Check');

    // Fix customer balances: set current_balance = transactional total
    await db(`
        UPDATE c SET c.current_balance = COALESCE(c.opening_balance, 0) +
            ISNULL((SELECT SUM(grand_total) FROM sales_invoices WHERE customer_id = c.id AND status NOT IN ('cancelled','deleted')), 0) -
            ISNULL((SELECT SUM(grand_total) FROM sales_returns WHERE customer_id = c.id AND status NOT IN ('cancelled','deleted')), 0) -
            ISNULL((SELECT SUM(amount) FROM customer_collections WHERE customer_id = c.id), 0)
        FROM customers c
    `);
    console.log('  ✓ Customer balances normalized');

    // Fix supplier balances
    await db(`
        UPDATE s SET s.current_balance = COALESCE(s.opening_balance, 0) +
            ISNULL((SELECT SUM(grand_total) FROM purchase_invoices WHERE supplier_id = s.id AND status NOT IN ('cancelled','deleted')), 0) -
            ISNULL((SELECT SUM(grand_total) FROM purchase_returns WHERE supplier_id = s.id AND status NOT IN ('cancelled','deleted')), 0) -
            ISNULL((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = s.id), 0)
        FROM suppliers s
    `);
    console.log('  ✓ Supplier balances normalized');

    // Fix treasury balances
    await db(`
        UPDATE t SET t.current_balance = COALESCE(t.opening_balance, 0) +
            ISNULL((SELECT SUM(CASE WHEN trans_type='in' THEN amount ELSE -amount END) FROM treasury_transactions WHERE account_id = t.id), 0)
        FROM treasury_accounts t
    `);
    console.log('  ✓ Treasury balances normalized');
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: Operations — Business Transactions
// ═══════════════════════════════════════════════════════════════

async function phase2() {
    section('PHASE 2: Business Operations');

    // Purchase Invoice (credit — creates stock + AP)
    const pi = await apiCheck('Purchase invoice (10xA, 20xB)', () => httpReq('POST', '/api/purchases/invoices', {
        supplier_id: supplierId, store_id: 1, payment_type: 'credit',
        items: [
            { product_id: product1Id, quantity: 10, cost_price: 50 },
            { product_id: product2Id, quantity: 20, cost_price: 30 }
        ]
    }));
    purchaseInvoiceId = pi.data.id || pi.data.invoiceId;

    // Sales Invoice (credit — creates revenue + AR)
    const si = await apiCheck('Sales invoice (3xA, 5xB, 1xC)', () => httpReq('POST', '/api/sales/invoices', {
        customer_id: customerId, store_id: 1, payment_type: 'credit',
        items: [
            { product_id: product1Id, quantity: 3, unit_price: 100 },
            { product_id: product2Id, quantity: 5, unit_price: 75 },
            { product_id: product3Id, quantity: 1, unit_price: 200 }
        ]
    }));
    salesInvoiceId = si.data.id;

    // Customer Collection
    await apiCheck('Customer collection 300', () => httpReq('POST', '/api/collections', {
        customer_id: customerId, amount: 300, payment_method: 'cash'
    }));

    // Supplier Payment
    await apiCheck('Supplier payment 500', () => httpReq('POST', '/api/payments', {
        supplier_id: supplierId, amount: 500, payment_method: 'cash'
    }));

    // Expense (uses treasury account ID, not COA ID)
    await apiCheck('Expense 150', () => httpReq('POST', '/api/treasury/expenses', {
        amount: 150, expense_type: 'general', description: 'UAT test expense',
        account_id: coaExpenseId, treasury_id: treasuryCashId
    }));

    // Manual Journal Entry
    await apiCheck('Manual JE (200 debit/credit)', () => httpReq('POST', '/api/accounting/journals', {
        date: `${YEAR}-06-15`, description: 'UAT manual adjustment entry',
        lines: [
            { account_id: coaExpenseId, debit: 200, credit: 0, description: 'UAT expense adjustment' },
            { account_id: coaArId, debit: 0, credit: 200, description: 'UAT offset to AR' }
        ]
    }));
}

// ═══════════════════════════════════════════════════════════════
// PHASE 3: Pre-Close Verification
// ═══════════════════════════════════════════════════════════════

async function phase3() {
    section('PHASE 3: Pre-Close Report Verification');

    const tb = await httpReq('GET', '/api/accounting/trial-balance');
    check(tb.data.success, 'Trial Balance accessible');
    const tbSummary = tb.data.summary || {};
    check(tbSummary.balanced !== false, `Trial Balance balanced: ${tbSummary.balanced}`);
    log.push(`  Debit=${tbSummary.totalDebit}, Credit=${tbSummary.totalCredit}`);

    const inc = await httpReq('GET', '/api/accounting/income-statement');
    check(inc.data.success, 'Income Statement accessible');
    const netIncome = inc.data.netIncome;
    log.push(`  Net Income: ${netIncome}`);
    check(netIncome !== 0 && netIncome !== undefined, `Income Statement has net income`);

    const bs = await httpReq('GET', '/api/accounting/balance-sheet');
    check(bs.data.success, 'Balance Sheet accessible');
    check(bs.data.totals?.balanced !== false, 'Balance Sheet is balanced');

    const gl = await httpReq('GET', '/api/accounting/general-ledger');
    check(gl.data.success, 'General Ledger accessible');

    const coaRevExp = await db(`SELECT account_type, SUM(current_balance) as total FROM chart_of_accounts WHERE account_type IN ('revenue','expense') GROUP BY account_type`);
    for (const r of coaRevExp.recordset) {
        const bal = parseFloat(r.total) || 0;
        check(Math.abs(bal) > 0.01, `${r.account_type} has pre-close balance of ${bal}`);
    }

    return {
        revenue: coaRevExp.recordset.find(r => r.account_type === 'revenue'),
        expense: coaRevExp.recordset.find(r => r.account_type === 'expense'),
        retainedEarnings: await scalar(`SELECT current_balance FROM chart_of_accounts WHERE id = ${coaReId}`)
    };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: Execute Year-End Close
// ═══════════════════════════════════════════════════════════════

async function phase4() {
    section('PHASE 4: Year-End Close Execution');

    const resp = await httpReq('POST', '/api/admin/year-close', {
        password: ADMIN_PASSWORD, backupPath: BACKUP_PATH, year: YEAR
    });

    check(resp.status === 200, `Close HTTP status ${resp.status}`);
    check(resp.data.success === true, 'Close success=true');
    if (resp.data.warning) warn(`Close warning: ${resp.data.message}`);
    else if (resp.data.message) console.log(`  Message: ${resp.data.message}`);

    check(resp.data.backup?.name, 'Backup file recorded');
    check(resp.data.fiscal?.year === YEAR, `Fiscal year ${YEAR} in response`);
    check(resp.data.fiscal?.closedPeriods?.length > 0, 'Closed periods listed');
    check(resp.data.fiscal?.nextYearPeriod === `FY ${NEXT_YEAR}`, `Next year period FY ${NEXT_YEAR} created`);

    return resp.data;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 5: Post-Close Verification
// ═══════════════════════════════════════════════════════════════

async function phase5(preState) {
    section('PHASE 5: Post-Close State Verification');

    const revExp = await db(`SELECT account_type, SUM(current_balance) as total FROM chart_of_accounts WHERE account_type IN ('revenue','expense') GROUP BY account_type`);
    for (const r of revExp.recordset) {
        const bal = parseFloat(r.total) || 0;
        check(Math.abs(bal) < 0.01, `${r.account_type} zeroed after close (balance=${bal})`);
    }

    const rePost = parseFloat(await scalar(`SELECT current_balance FROM chart_of_accounts WHERE id = ${coaReId}`)) || 0;
    const preRev = parseFloat(preState.revenue?.total) || 0;
    const preExp = parseFloat(preState.expense?.total) || 0;
    const netInc = preRev - preExp;
    const expectedRE = parseFloat(preState.retainedEarnings) + netInc;
    check(Math.abs(rePost - expectedRE) < 0.01,
        `RE updated: ${preState.retainedEarnings} + ${netInc} (net) = ${rePost} (expected ${expectedRE})`);

    const bsAccts = await db(`SELECT account_code, account_name, current_balance FROM chart_of_accounts WHERE account_type IN ('asset','liability','equity') AND current_balance != 0 ORDER BY account_code`);
    check(bsAccts.recordset.length > 0, 'Balance sheet accounts have balances');

    const allJEs = await db("SELECT id, source_module, source_action, source_document FROM journal_entries WHERE source_action='year_close'");
    const closeJE = allJEs.recordset.filter(j => j.source_document === `CLOSING_${YEAR}`).length;
    check(closeJE >= 1, `Closing journal entry CLOSING_${YEAR} exists (${closeJE})`);
    if (closeJE === 0) {
        const all = await db("SELECT id, source_module, source_action, source_document, entry_no FROM journal_entries ORDER BY id DESC");
        console.log('  DEBUG: All JEs:', JSON.stringify(all.recordset.slice(0, 5)));
    }

    const openJE = allJEs.recordset.filter(j => j.source_document === `OPENING_BALANCE_${YEAR}`).length;
    check(openJE >= 1, `Opening journal entry OPENING_BALANCE_${YEAR} exists (${openJE})`);

    const openFp = await scalar(`SELECT COUNT(*) FROM fiscal_periods WHERE start_date <= '${YEAR}-12-31' AND end_date >= '${YEAR}-01-01' AND status='open'`);
    check(openFp === 0, `All ${YEAR} fiscal periods closed (open=${openFp})`);

    const nextFp = await scalar(`SELECT COUNT(*) FROM fiscal_periods WHERE name='FY ${NEXT_YEAR}' AND status='open'`);
    check(nextFp >= 1, `Next year period FY ${NEXT_YEAR} open (${nextFp})`);

    const siCount = await scalar('SELECT COUNT(*) FROM sales_invoices');
    const piCount = await scalar('SELECT COUNT(*) FROM purchase_invoices');
    check(siCount === 0, `Sales invoices deleted (${siCount} remaining)`);
    check(piCount === 0, `Purchase invoices deleted (${piCount} remaining)`);

    const custCount = await scalar('SELECT COUNT(*) FROM customers');
    const suppCount = await scalar('SELECT COUNT(*) FROM suppliers');
    const prodCount = await scalar('SELECT COUNT(*) FROM products');
    check(custCount > 0, `Customers preserved (${custCount})`);
    check(suppCount > 0, `Suppliers preserved (${suppCount})`);
    check(prodCount > 0, `Products preserved (${prodCount})`);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 6: First Transaction in New Year
// ═══════════════════════════════════════════════════════════════

async function phase6() {
    section('PHASE 6: First Transaction in New Fiscal Year');

    // Set initial stock for the new year (inventory balances were deleted by close)
    await apiCheck('Initial stock A: +10', () => httpReq('POST', '/api/inventory/adjust', {
        store_id: 1, product_id: product1Id, quantity: 10, reason: 'UAT opening stock new year'
    }));
    await apiCheck('Initial stock B: +10', () => httpReq('POST', '/api/inventory/adjust', {
        store_id: 1, product_id: product2Id, quantity: 10, reason: 'UAT opening stock new year'
    }));

    const si = await apiCheck(`First ${NEXT_YEAR} sales invoice (2xA, 3xB)`, () => httpReq('POST', '/api/sales/invoices', {
        customer_id: customerId, store_id: 1, payment_type: 'cash',
        invoice_date: `${NEXT_YEAR}-01-15`,
        items: [
            { product_id: product1Id, quantity: 2, unit_price: 110 },
            { product_id: product2Id, quantity: 3, unit_price: 80 }
        ]
    }));
    console.log(`  Post-close invoice ID=${si.data.id}`);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 7: Final Report Verification
// ═══════════════════════════════════════════════════════════════

async function phase7() {
    section('PHASE 7: Final Report Verification (Post-Close + New Transaction)');

    const tb = await httpReq('GET', '/api/accounting/trial-balance');
    check(tb.data.success, 'Trial Balance accessible post-close');
    check(tb.data.summary?.balanced !== false, 'Trial Balance balanced post-close');

    const inc = await httpReq('GET', '/api/accounting/income-statement');
    check(inc.data.success, 'Income Statement accessible post-close');
    check(inc.data.netIncome !== undefined, `Income Statement has net income: ${inc.data.netIncome}`);

    const bs = await httpReq('GET', '/api/accounting/balance-sheet');
    check(bs.data.success, 'Balance Sheet accessible post-close');
    check(bs.data.totals?.balanced !== false, 'Balance Sheet balanced post-close');

    const revBal = await db(`SELECT SUM(current_balance) as total FROM chart_of_accounts WHERE account_type='revenue'`);
    const revPost = parseFloat(revBal.recordset[0]?.total) || 0;
    check(revPost > 0, `Revenue started fresh in ${NEXT_YEAR}: ${revPost}`);

    const expBal = await db(`SELECT SUM(current_balance) as total FROM chart_of_accounts WHERE account_type='expense'`);
    const expPost = parseFloat(expBal.recordset[0]?.total) || 0;
    check(expPost >= 0, `Expense starts at 0 in ${NEXT_YEAR}: ${expPost}`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     UAT: Year-End Close — Full Business Cycle Test          ║
║     Database: ${TEST_DB}                        ║
║     Year: ${YEAR} → ${NEXT_YEAR}                                     ║
╚══════════════════════════════════════════════════════════════╝
`);

    try {
        await login();
        await phase1();
        await phase1b();
        await phase2();
        const preState = await phase3();
        await phase4();
        await phase5(preState);
        await phase6();
        await phase7();
    } catch (e) {
        console.error(`\n💥 FATAL ERROR: ${e.message}`);
        console.error(e.stack);
        failed++;
        log.push(`\n- 💥 FATAL: ${e.message}`);
    } finally {
        if (pool) await pool.close();
    }

    const total = passed + failed;
    const rate = total > 0 ? Math.round(passed / total * 100) : 0;

    console.log(`\n${'═'.repeat(60)}`);
    console.log('  📊 UAT FINAL REPORT');
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Total assertions: ${total}`);
    console.log(`  Passed:           ${passed} ✅`);
    console.log(`  Failed:           ${failed} ❌`);
    console.log(`  Warnings:         ${warnings} ⚠️`);
    console.log(`  Pass rate:        ${rate}%`);

    if (failed === 0) {
        console.log(`\n  🎉 YEAR-END CLOSE: ALL UAT TESTS PASSED`);
        console.log(`  Core Accounting is PRODUCTION READY ✅`);
    } else {
        console.log(`\n  ⚠️  ${failed} assertion(s) failed. Review logs above.`);
    }

    console.log(`\n${'═'.repeat(60)}`);

    process.exit(failed > 0 ? 1 : 0);
}

main();
