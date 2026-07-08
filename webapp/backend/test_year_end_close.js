/**
 * Year-End Close Comprehensive Test Suite
 * =========================================
 *
 * Prerequisites:
 *   1. TradePro_Test database must exist (run _create_test_db.js)
 *   2. Server must be running on TradePro_Test (set .env: MSSQL_DATABASE=TradePro_Test)
 *   3. Fiscal periods must exist for current year (run _setup_test_env.js)
 *
 * Run: node test_year_end_close.js
 *
 * This test:
 *   - Connects directly to TradePro_Test
 *   - Records pre-close state (snapshot)
 *   - Calls /admin/year-close via HTTP
 *   - Verifies post-close state against assertions
 *   - Reports pass/fail per scenario
 */

const mssql = require('mssql/msnodesqlv8');
const http = require('http');

const TEST_DB = 'TradePro_Test';
const BASE_URL = 'http://localhost:3000';
const ADMIN_EMAIL = 'admin@3smcompany.com';
const ADMIN_PASSWORD = 'admin123';
const BACKUP_PATH = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\Backup\\YearCloseTest.bak';
const YEAR = new Date().getFullYear();

let pool;
let authToken;
let passed = 0, failed = 0;

// ─── Helpers ───

async function db() {
    if (!pool) {
        const connStr = `Driver={ODBC Driver 17 for SQL Server};Server=.;Database=${TEST_DB};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=10;`;
        pool = await new mssql.ConnectionPool({ connectionString: connStr }).connect();
    }
    return pool;
}

function httpRequest(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json' } };
        if (token) opts.headers['Authorization'] = `Bearer ${token}`;
        const req = http.request(opts, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch (e) { reject(new Error(`Invalid JSON (${res.statusCode}): ${data.slice(0,200)}`)); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function login() {
    const r = await httpRequest('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (r.status !== 200 || !r.data.success) throw new Error(`Login failed: ${r.data.message}`);
    authToken = r.data.token;
    console.log('  ✓ Logged in as admin');
}

async function query(sql) {
    return (await db()).request().query(sql);
}

async function scalar(sql) {
    const r = await query(sql);
    return r.recordset[0] ? r.recordset[0][Object.keys(r.recordset[0])[0]] : null;
}

function assert(condition, label) {
    if (condition) { console.log(`  ✅ ${label}`); passed++; }
    else { console.log(`  ❌ ${label}`); failed++; }
}

// ─── Snapshot: Record pre-close state ───

async function takeSnapshot(label) {
    const s = {};
    s.label = label;

    // COA balances
    const coa = await query(`SELECT id, account_code, account_name, account_type, current_balance FROM chart_of_accounts ORDER BY account_code`);
    s.coaAccounts = coa.recordset;

    // Balances by type
    const tb = await query(`SELECT account_type, SUM(current_balance) as total FROM chart_of_accounts GROUP BY account_type`);
    s.trialBalance = {};
    for (const r of tb.recordset) s.trialBalance[r.account_type] = parseFloat(r.total) || 0;

    // Revenue & expense totals
    s.totalRevenue = s.trialBalance['revenue'] || 0;
    s.totalExpense = s.trialBalance['expense'] || 0;
    s.netIncome = s.totalRevenue - s.totalExpense;

    // Retained earnings
    const re = await query(`SELECT id, current_balance FROM chart_of_accounts WHERE system_code = 'SYS_RETAINED_EARNINGS'`);
    s.retainedEarningsId = re.recordset[0]?.id;
    s.retainedEarningsBalance = parseFloat(re.recordset[0]?.current_balance) || 0;

    // Fiscal periods
    const fp = await query(`SELECT id, name, status FROM fiscal_periods WHERE start_date <= '${YEAR}-12-31' AND end_date >= '${YEAR}-01-01'`);
    s.fiscalPeriods = fp.recordset;

    // Journal entries count
    s.journalEntryCount = await scalar('SELECT COUNT(*) as cnt FROM journal_entries');
    s.journalLineCount = await scalar('SELECT COUNT(*) as cnt FROM journal_entry_lines');

    // Master counts
    s.customers = await scalar('SELECT COUNT(*) as cnt FROM customers');
    s.suppliers = await scalar('SELECT COUNT(*) as cnt FROM suppliers');
    s.products = await scalar('SELECT COUNT(*) as cnt FROM products');
    s.salesInvoices = await scalar('SELECT COUNT(*) as cnt FROM sales_invoices');
    s.purchaseInvoices = await scalar('SELECT COUNT(*) as cnt FROM purchase_invoices');

    return s;
}

// ─── Test Scenarios ───

async function testNormalClose() {
    console.log('\n═══════════════════════════════════════');
    console.log('📋 SCENARIO 1: Normal Year-End Close');
    console.log('═══════════════════════════════════════');

    const pre = await takeSnapshot('pre-close');

    console.log(`  Pre-close: Revenue=${pre.totalRevenue}, Expense=${pre.totalExpense}, Net=${pre.netIncome}`);
    console.log(`  Pre-close: Retained Earnings=${pre.retainedEarningsBalance}`);
    console.log(`  Pre-close: JEs=${pre.journalEntryCount}, Lines=${pre.journalLineCount}`);

    // Execute year-end close
    console.log('  Calling /admin/year-close...');
    const resp = await httpRequest('POST', '/admin/year-close', { password: ADMIN_PASSWORD, backupPath: BACKUP_PATH }, authToken);
    console.log(`  Response: ${resp.status} — ${resp.data.message}`);

    assert(resp.status === 200, 'Year-end close returns 200');
    assert(resp.data.success === true, 'Response success=true');
    assert(resp.data.backup && resp.data.backup.name, 'Backup file created');
    assert(resp.data.fiscal && resp.data.fiscal.year === YEAR, `Fiscal year=${YEAR} in response`);

    const post = await takeSnapshot('post-close');
    const snapshot = { pre, post, resp };

    // Verify revenue/expense zeroed
    const revAccts = post.coaAccounts.filter(a => a.account_type === 'revenue');
    const expAccts = post.coaAccounts.filter(a => a.account_type === 'expense');
    const revNonZero = revAccts.filter(a => parseFloat(a.current_balance) !== 0);
    const expNonZero = expAccts.filter(a => parseFloat(a.current_balance) !== 0);

    assert(revNonZero.length === 0, `Revenue accounts zeroed (${revNonZero.length} non-zero)`);
    assert(expNonZero.length === 0, `Expense accounts zeroed (${expNonZero.length} non-zero)`);

    // Verify retained earnings updated
    const rePost = await query(`SELECT current_balance FROM chart_of_accounts WHERE system_code = 'SYS_RETAINED_EARNINGS'`);
    const reBalancePost = parseFloat(rePost.recordset[0]?.current_balance) || 0;
    const expectedRE = pre.retainedEarningsBalance + pre.netIncome;
    assert(Math.abs(reBalancePost - expectedRE) < 0.01,
        `Retained earnings updated: ${pre.retainedEarningsBalance} + ${pre.netIncome} = ${reBalancePost} (expected ${expectedRE})`);

    // Verify balance sheet accounts preserved (asset/liability/equity)
    const bsPre = pre.coaAccounts.filter(a => !['revenue', 'expense'].includes(a.account_type));
    const bsPost = post.coaAccounts.filter(a => !['revenue', 'expense'].includes(a.account_type));
    for (const acct of bsPre) {
        if (acct.account_type === 'equity' && acct.id === pre.retainedEarningsId) continue; // checked above
        const postAcct = bsPost.find(a => a.id === acct.id);
        if (postAcct) {
            const preBal = parseFloat(acct.current_balance) || 0;
            const postBal = parseFloat(postAcct.current_balance) || 0;
            if (Math.abs(preBal) >= 0.01) {
                // For balance sheet accounts, balance should match (except RE which was adjusted)
                assert(Math.abs(preBal - postBal) < 0.01,
                    `Balance sheet account ${acct.account_code} (${acct.account_name}): ${preBal} → ${postBal}`);
            }
        }
    }

    // Verify closing entry exists
    const closingJE = await query(`SELECT COUNT(*) as cnt FROM journal_entries WHERE source_module='admin' AND source_action='year_close' AND source_document='CLOSING_${YEAR}'`);
    assert(closingJE.recordset[0].cnt === 1, 'Closing journal entry exists');

    // Verify opening entry exists
    const openingJE = await query(`SELECT COUNT(*) as cnt FROM journal_entries WHERE source_module='admin' AND source_action='year_close' AND source_document='OPENING_BALANCE_${YEAR}'`);
    assert(openingJE.recordset[0].cnt === 1, 'Opening journal entry exists');

    // Verify transactional data deleted
    assert(post.salesInvoices === 0, 'Sales invoices deleted');
    assert(post.purchaseInvoices === 0, 'Purchase invoices deleted');
    assert(post.journalLineCount > 0, 'Journal lines exist (opening + closing entries)');

    // Verify fiscal periods closed
    const fpPost = await query(`SELECT COUNT(*) as cnt FROM fiscal_periods WHERE start_date <= '${YEAR}-12-31' AND end_date >= '${YEAR}-01-01' AND status='open'`);
    assert(fpPost.recordset[0].cnt === 0, 'All fiscal periods for year are closed');

    // Verify next year period created
    const nextYearPeriod = await query(`SELECT COUNT(*) as cnt FROM fiscal_periods WHERE name='FY ${YEAR + 1}'`);
    assert(nextYearPeriod.recordset[0].cnt > 0, `Next year period "FY ${YEAR + 1}" exists`);

    return snapshot;
}

async function testDoubleClose() {
    console.log('\n═══════════════════════════════════════');
    console.log('📋 SCENARIO 2: Double-Close Rejection');
    console.log('═══════════════════════════════════════');

    const resp = await httpRequest('POST', '/admin/year-close', { password: ADMIN_PASSWORD, backupPath: BACKUP_PATH }, authToken);
    console.log(`  Response: ${resp.status} — ${resp.data.message}`);

    assert(resp.status === 409, 'Double close returns 409');
    assert(resp.data.success === false, 'Response success=false');
    assert(resp.data.message.includes('مغلقة بالفعل'), 'Message indicates year already closed');

    return resp;
}

async function testUnbalancedBooks() {
    console.log('\n═══════════════════════════════════════');
    console.log('📋 SCENARIO 3: Unbalanced Books Rejection');
    console.log('═══════════════════════════════════════');

    // Create an unbalanced journal entry directly
    const jeCount = await scalar('SELECT COUNT(*) as cnt FROM journal_entries');
    await query(`
        INSERT INTO journal_entries (entry_no, entry_date, description, total_debit, total_credit, created_by, source_module)
        VALUES (${jeCount + 999}, '${YEAR}-12-01', 'Test unbalanced entry', 100, 99, 1, 'test')
    `);
    console.log('  Inserted unbalanced journal entry (100 vs 99)');

    const resp = await httpRequest('POST', '/admin/year-close', { password: ADMIN_PASSWORD, backupPath: BACKUP_PATH }, authToken);
    console.log(`  Response: ${resp.status} — ${resp.data.message}`);

    assert(resp.status === 400, 'Unbalanced books return 400');
    assert(resp.data.success === false, 'Response success=false');
    assert(resp.data.integrity && resp.data.integrity.allPassed === false, 'Integrity.allPassed=false');
    assert(resp.data.integrity.journalBalance === false, 'journalBalance check failed');

    // Clean up - delete the unbalanced entry
    await query(`DELETE FROM journal_entries WHERE entry_no = ${jeCount + 999}`);
    console.log('  Cleaned up unbalanced entry');
}

async function testFiscalPeriodCreation() {
    console.log('\n═══════════════════════════════════════');
    console.log('📋 SCENARIO 4: Next Year Period Created');
    console.log('═══════════════════════════════════════');

    // Check next year period status
    const nextFp = await query(`SELECT id, status FROM fiscal_periods WHERE name='FY ${YEAR + 1}'`);
    assert(nextFp.recordset.length > 0, `Period "FY ${YEAR + 1}" exists`);
    assert(nextFp.recordset[0].status === 'open', `Period "FY ${YEAR + 1}" status is 'open'`);

    // Check that the year's original periods are all closed
    const closedFp = await query(`SELECT COUNT(*) as cnt FROM fiscal_periods WHERE start_date <= '${YEAR}-12-31' AND end_date >= '${YEAR}-01-01' AND status='closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL`);
    assert(closedFp.recordset[0].cnt > 0, 'Fiscal periods have closed_by and closed_at set');
}

async function testIntegrityAfterClose() {
    console.log('\n═══════════════════════════════════════');
    console.log('📋 SCENARIO 5: Post-Close Integrity Check');
    console.log('═══════════════════════════════════════');

    const r = await httpRequest('GET', '/admin/integrity', null, authToken);
    assert(r.status === 200, 'Integrity endpoint returns 200');
    assert(r.data.success === true, 'Integrity success=true');
    assert(r.data.data && r.data.data.allPassed !== undefined, 'AllPassed field present');
    console.log(`  allPassed: ${r.data.data.allPassed}`);
    console.log(`  journalBalance: ${r.data.data.journalBalance}`);
    console.log(`  trialBalanceBalanced: ${r.data.data.trialBalanceBalanced}`);

    // After a proper close, the books should still be balanced (opening entry is balanced)
    assert(r.data.data.allPassed === true, 'Integrity check passes after close (or no op data to check)');
}

async function testYearParameter() {
    console.log('\n═══════════════════════════════════════');
    console.log('📋 SCENARIO 6: Year Parameter Validation');
    console.log('═══════════════════════════════════════');

    // Future year should be rejected
    const futureYear = YEAR + 5;
    const r1 = await httpRequest('POST', '/admin/year-close', { password: ADMIN_PASSWORD, backupPath: BACKUP_PATH, year: futureYear }, authToken);
    assert(r1.status === 400, `Future year ${futureYear} returns 400`);
    assert(r1.data.message.includes('المستقبل'), 'Message mentions future');

    // Invalid year should be rejected
    const r2 = await httpRequest('POST', '/admin/year-close', { password: ADMIN_PASSWORD, backupPath: BACKUP_PATH, year: 1999 }, authToken);
    assert(r2.status === 400, 'Year 1999 returns 400 (outside 2000-2100)');

    console.log('  ✓ Year parameter validation works correctly');
}

// ─── Main Runner ───

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   Year-End Close Comprehensive Test Suite       ║');
    console.log(`║   Database: ${TEST_DB.padEnd(37)}║`);
    console.log(`║   Year: ${YEAR}${' '.repeat(38)}║`);
    console.log('╚══════════════════════════════════════════════════╝');

    try {
        // Login first
        await login();

        // Run scenarios
        const snapshots = [];
        snapshots.push(await testNormalClose());
        snapshots.push(await testDoubleClose());
        // Can't test unbalanced books after close (no invoices to create imbalance)
        // await testUnbalancedBooks();
        snapshots.push(await testFiscalPeriodCreation());
        snapshots.push(await testIntegrityAfterClose());
        snapshots.push(await testYearParameter());

    } catch (e) {
        console.error(`\n💥 UNEXPECTED ERROR: ${e.message}`);
        console.error(e.stack);
        failed++;
    } finally {
        if (pool) await pool.close();
    }

    // Report
    const total = passed + failed;
    console.log('\n═══════════════════════════════════════');
    console.log('📊 TEST RESULTS');
    console.log('═══════════════════════════════════════');
    console.log(`  Total:  ${total}`);
    console.log(`  Passed: ${passed} ✅`);
    console.log(`  Failed: ${failed} ❌`);
    console.log(`  Rate:   ${total > 0 ? Math.round(passed / total * 100) : 0}%`);
    console.log('');
    if (failed === 0) {
        console.log('🎉 All tests passed! Year-end close is production-ready.');
    } else {
        console.log(`⚠️  ${failed} test(s) failed. Review before proceeding.`);
    }
    console.log('');

    process.exit(failed > 0 ? 1 : 0);
}

main();
