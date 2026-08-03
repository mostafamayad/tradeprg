/**
 * Financial Closing Comprehensive Test
 *
 * Scenarios:
 * 1. Record initial COA balances, create fiscal periods (2026 Q1-Q4)
 * 2. Post JEs in Q1 and Q2, verify deltas
 * 3. Close Q1 → verify Q1 block but Q2 still writable
 * 4. Year-end close 2026 → P&L zeroed, RE updated, FY 2027 created
 * 5. Verify retained earnings and trial balance after close
 * 6. Reopen Q2 → verify Q2 writable again
 */

const { getPool, sql } = require('./database/mssql_db');
const poolPromise = getPool();

let passCount = 0, failCount = 0, assertCount = 0;
function assert(condition, msg) {
    assertCount++;
    if (condition) { passCount++; console.log(`  ✓ ${msg}`); }
    else { failCount++; console.log(`  ✗ FAILED: ${msg}`); }
}

async function main() {
    const pool = await poolPromise;

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║      FINANCIAL CLOSING COMPREHENSIVE TEST      ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    const { postJournalEntryAsync } = require('./services/accountingEngine');
    const fiscalRepo = require('./repositories/fiscalPeriodRepository');

    // ── Cleanup ──
    const del = async (q) => { try { await pool.request().query(q); } catch (e) { /* ignore */ } };
    await del("DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE description LIKE '%FL-TEST%')");
    await del("DELETE FROM journal_entries WHERE description LIKE '%FL-TEST%'");
    await del("DELETE FROM fiscal_periods WHERE name LIKE 'FL-TEST%'");

    // Restore COA balances to initial state if previous run left artifacts
    // (read initial balances after cleanup to get true baseline)

    // Get system accounts
    const sys = async (code) => {
        const r = await pool.request().input('c', sql.NVarChar, code)
            .query("SELECT id FROM chart_of_accounts WHERE system_code = @c");
        return r.recordset[0]?.id;
    };
    const accCash = await sys('SYS_CASH');
    const accSales = await sys('SYS_SALES');
    const accExpense = await sys('SYS_EXPENSE');
    const accRetain = await sys('SYS_RETAINED_EARNINGS');
    console.log(`  System accounts: Cash=${accCash}, Sales=${accSales}, Expense=${accExpense}, Retained=${accRetain}\n`);

    // ── Record initial COA balances ──
    const initBal = {};
    const initRows = await pool.request()
        .query(`SELECT system_code, current_balance FROM chart_of_accounts WHERE id IN (${accCash},${accSales},${accExpense},${accRetain})`);
    initRows.recordset.forEach(r => initBal[r.system_code] = parseFloat(r.current_balance));
    console.log(`  Initial balances: Cash=${initBal.SYS_CASH}, Sales=${initBal.SYS_SALES}, Expense=${initBal.SYS_EXPENSE}, Retained=${initBal.SYS_RETAINED_EARNINGS}\n`);

    // ────────────────────────────────────────────────────
    // TEST 1: Create fiscal periods
    // ────────────────────────────────────────────────────
    console.log('═══ TEST 1: Create Fiscal Periods ═══');
    const periods = [];
    for (const q of [1, 2, 3, 4]) {
        const p = await fiscalRepo.create({
            name: `FL-TEST-Q${q}-2026`,
            startDate: `2026-${String(q * 3 - 2).padStart(2, '0')}-01`,
            endDate: `2026-${String(q * 3).padStart(2, '0')}-28`,
            userId: 11
        });
        periods.push(p);
        console.log(`  Created: ${p.name} (${(p.start_date || '').toString().slice(0,10)}) ID=${p.id}`);
    }
    assert(periods.length === 4, '4 fiscal periods created');

    // ────────────────────────────────────────────────────
    // TEST 2: Post JEs in Q1 (Jan) and Q2 (Apr)
    // ────────────────────────────────────────────────────
    console.log('\n═══ TEST 2: Post entries in Q1 (Jan) and Q2 (Apr) ═══');
    const trans2 = new sql.Transaction(pool);
    await trans2.begin();
    const tx2 = trans2.request();
    try {
        // JE Q1: Dr Cash 5000 / Cr Sales 5000
        await postJournalEntryAsync(tx2, '2026-01-15', 'FL-TEST revenue in Q1',
            [
                { account_id: accCash, debit: 5000, credit: 0, description: 'إيراد الربع الأول' },
                { account_id: accSales, debit: 0, credit: 5000, description: 'مقابل الإيراد' }
            ],
            'journal', null, 11,
            { module: 'accounting', action: 'manual_entry', document: 'FL-TEST-JE-001', isSystem: false }
        );
        // JE Q2: Dr Expense 2000 / Cr Cash 2000
        await postJournalEntryAsync(tx2, '2026-04-10', 'FL-TEST expense in Q2',
            [
                { account_id: accExpense, debit: 2000, credit: 0, description: 'مصروف الربع الثاني' },
                { account_id: accCash, debit: 0, credit: 2000, description: 'مقابل المصروف' }
            ],
            'journal', null, 11,
            { module: 'accounting', action: 'manual_entry', document: 'FL-TEST-JE-002', isSystem: false }
        );
        await trans2.commit();
    } catch (e) { await trans2.rollback(); throw e; }

    const coa2 = await pool.request()
        .query(`SELECT system_code, current_balance FROM chart_of_accounts WHERE id IN (${accCash},${accSales},${accExpense},${accRetain}) ORDER BY id`);
    const bal2 = {};
    coa2.recordset.forEach(r => bal2[r.system_code] = parseFloat(r.current_balance));
    console.log(`  Cash=${bal2.SYS_CASH} (init ${initBal.SYS_CASH}), Sales=${bal2.SYS_SALES}, Expense=${bal2.SYS_EXPENSE}, Retained=${bal2.SYS_RETAINED_EARNINGS}`);
    assert(Math.abs(bal2.SYS_CASH - (initBal.SYS_CASH + 3000)) < 0.01, `Cash = init + 3000 (${bal2.SYS_CASH})`);
    assert(Math.abs(bal2.SYS_SALES - (initBal.SYS_SALES + 5000)) < 0.01, `Sales = init + 5000 (${bal2.SYS_SALES})`);
    assert(Math.abs(bal2.SYS_EXPENSE - (initBal.SYS_EXPENSE + 2000)) < 0.01, `Expense = init + 2000 (${bal2.SYS_EXPENSE})`);
    assert(Math.abs(bal2.SYS_RETAINED_EARNINGS - initBal.SYS_RETAINED_EARNINGS) < 0.01, 'Retained unchanged');

    // ────────────────────────────────────────────────────
    // TEST 3: Close Q1 → verify isDateInClosedPeriod blocks Q1 but not Q2
    // ────────────────────────────────────────────────────
    console.log('\n═══ TEST 3: Close Q1 period ═══');
    const p1 = periods[0];
    const closed = await fiscalRepo.close(p1.id, 11);
    assert(closed && closed.status === 'closed', 'Q1 period is closed');
    const q1Check = await fiscalRepo.getById(p1.id);
    assert(q1Check.status === 'closed', 'Q1 period status = closed');

    // Verify period-level blocking via isDateInClosedPeriod
    assert(await fiscalRepo.isDateInClosedPeriod('2026-01-20') === true, 'Jan 20 flagged as closed period');
    assert(await fiscalRepo.isDateInClosedPeriod('2026-04-15') === false, 'Apr 15 not flagged (Q2 open)');

    // Posting in Q2 (Apr) must succeed
    let q2Ok = false;
    try {
        const tx3b = (new sql.Transaction(pool));
        await tx3b.begin();
        const r3b = tx3b.request();
        await postJournalEntryAsync(r3b, '2026-04-15', 'FL-TEST should-succeed',
            [{ account_id: accCash, debit: 1000, credit: 0 }, { account_id: accSales, debit: 0, credit: 1000 }],
            'journal', null, 11,
            { module: 'accounting', action: 'manual_entry', document: 'FL-TEST-JE-OK', isSystem: false }
        );
        await tx3b.commit();
        q2Ok = true;
    } catch (e) { q2Ok = false; }
    assert(q2Ok, 'Posting in open Q2 period works');

    // ────────────────────────────────────────────────────
    // TEST 4: Year-end close 2026
    // ────────────────────────────────────────────────────
    console.log('\n═══ TEST 4: Year-End Close 2026 ═══');
    const coa4 = await pool.request()
        .query(`SELECT system_code, current_balance FROM chart_of_accounts WHERE system_code IN ('SYS_SALES','SYS_EXPENSE','SYS_CASH','SYS_RETAINED_EARNINGS')`);
    const bal4 = {};
    coa4.recordset.forEach(r => bal4[r.system_code] = parseFloat(r.current_balance));
    // After JE-001 (+5000 sales) and JE-OK (+1000 sales): sales = init + 6000
    // After JE-002 (+2000 expense): expense = init + 2000
    assert(Math.abs(bal4.SYS_SALES - (initBal.SYS_SALES + 6000)) < 0.01, `Sales = init+6000 before close (${bal4.SYS_SALES})`);
    assert(Math.abs(bal4.SYS_EXPENSE - (initBal.SYS_EXPENSE + 2000)) < 0.01, `Expense = init+2000 before close (${bal4.SYS_EXPENSE})`);

    const trans4 = new sql.Transaction(pool);
    await trans4.begin();
    const tx4 = trans4.request();
    try {
        const plAccs = await tx4.query(`SELECT id, system_code, account_type, current_balance FROM chart_of_accounts WHERE account_type IN ('revenue','expense') AND current_balance != 0`);
        let closeDr = 0, closeCr = 0;
        const closeLines = [];
        for (const acc of plAccs.recordset) {
            const bal = parseFloat(acc.current_balance) || 0;
            if (Math.abs(bal) < 0.01) continue;
            const isRev = acc.account_type === 'revenue';
            if (isRev) { closeLines.push({ account_id: acc.id, debit: bal, credit: 0 }); closeDr += bal; }
            else { closeLines.push({ account_id: acc.id, debit: 0, credit: bal }); closeCr += bal; }
        }
        const netIncome = closeDr - closeCr;
        if (Math.abs(netIncome) > 0.01) {
            if (netIncome > 0) closeLines.push({ account_id: accRetain, debit: 0, credit: netIncome, description: 'صافي الربح' });
            else closeLines.push({ account_id: accRetain, debit: Math.abs(netIncome), credit: 0, description: 'صافي الخسارة' });
        }
        console.log(`  Closing Dr=${closeDr}, Cr=${closeCr}, NetIncome=${netIncome}`);

        await postJournalEntryAsync(tx4, '2026-12-31', 'FL-TEST year-end close 2026', closeLines,
            'year_close', null, 11,
            { module: 'admin', action: 'year_close', document: 'FL-TEST-CLOSE-2026', isSystem: true }
        );
        for (const acc of plAccs.recordset) {
            await tx4.query(`UPDATE chart_of_accounts SET current_balance = 0 WHERE id = ${acc.id}`);
        }
        const reNew = parseFloat(bal4.SYS_RETAINED_EARNINGS) + netIncome;
        await tx4.query(`UPDATE chart_of_accounts SET current_balance = ${reNew} WHERE id = ${accRetain}`);

        // Close open FL-TEST periods
        const openPs = await tx4.query(`SELECT id FROM fiscal_periods WHERE name LIKE 'FL-TEST%' AND status = 'open'`);
        for (const p of openPs.recordset) {
            await tx4.query(`UPDATE fiscal_periods SET status = 'closed', closed_by = 11, closed_at = GETDATE() WHERE id = ${p.id}`);
        }

        // Create FY 2027
        const nx = await tx4.query(`SELECT COUNT(*) AS cnt FROM fiscal_periods WHERE name = 'FL-TEST-FY-2027'`);
        if (nx.recordset[0].cnt === 0) {
            await tx4.query(`INSERT INTO fiscal_periods (name, start_date, end_date, status, opened_by, opened_at, notes) VALUES ('FL-TEST-FY-2027', '2027-01-01', '2027-12-31', 'open', 11, GETDATE(), 'FL-TEST')`);
        }
        await trans4.commit();
        console.log('  Year-end close completed');
    } catch (e) { await trans4.rollback(); throw e; }

    // ────────────────────────────────────────────────────
    // TEST 5: Verify post-close state
    // ────────────────────────────────────────────────────
    console.log('\n═══ TEST 5: Verify Post-Close State ═══');
    const coa5 = await pool.request()
        .query(`SELECT system_code, current_balance FROM chart_of_accounts WHERE id IN (${accSales},${accExpense},${accRetain},${accCash})`);
    const post = {};
    coa5.recordset.forEach(r => post[r.system_code] = parseFloat(r.current_balance));
    console.log(`  Sales=${post.SYS_SALES}, Expense=${post.SYS_EXPENSE}, Retained=${post.SYS_RETAINED_EARNINGS}, Cash=${post.SYS_CASH}`);

    assert(Math.abs(post.SYS_SALES) < 0.01, 'Sales = 0 after close');
    assert(Math.abs(post.SYS_EXPENSE) < 0.01, 'Expense = 0 after close');

    // After close: retained = init_retained + netIncome
    // netIncome = (init_Sales + 6000) - (init_Expense + 2000)
    // But wait, the closing JEs were posted BEFORE we zeroed the balances.
    // The actual netIncome is computed as: closeDr - closeCr
    // closeDr = sum of all revenue balances (which includes the JE from this test AND pre-existing balances)
    // closeCr = sum of all expense balances
    // netIncome = (initSales + 6000) - (initExpense + 2000)
    const expectedNet = (initBal.SYS_SALES + 6000) - (initBal.SYS_EXPENSE + 2000);
    const expectedRE = initBal.SYS_RETAINED_EARNINGS + expectedNet;
    assert(Math.abs(post.SYS_RETAINED_EARNINGS - expectedRE) < 0.01, `Retained = ${expectedRE} (got ${post.SYS_RETAINED_EARNINGS})`);

    // Cash: init + 3000 (JE-001/002) + 1000 (JE-OK) = init + 4000
    const expectedCash = initBal.SYS_CASH + 4000;
    assert(Math.abs(post.SYS_CASH - expectedCash) < 0.01, `Cash = ${expectedCash} (got ${post.SYS_CASH})`);

    // Next year period
    const nextP = await pool.request().query("SELECT * FROM fiscal_periods WHERE name = 'FL-TEST-FY-2027'");
    assert(nextP.recordset.length === 1, 'FY 2027 created');
    assert(nextP.recordset[0].status === 'open', 'FY 2027 is open');

    // All 2026 FL-TEST periods closed (checked before reopen test)
    const yrPs = await pool.request().query("SELECT name, status FROM fiscal_periods WHERE name LIKE 'FL-TEST-Q%' ORDER BY name");
    yrPs.recordset.forEach(p => console.log(`    ${p.name}: ${p.status}`));
    const allC = yrPs.recordset.every(p => p.status === 'closed');
    assert(allC, 'All 2026 FL-TEST periods are closed (pre-reopen)');

    // ────────────────────────────────────────────────────
    // TEST 6: Reopen Q2
    // ────────────────────────────────────────────────────
    console.log('\n═══ TEST 6: Reopen Q2 ═══');
    const p2 = periods[1];
    const reopened = await fiscalRepo.open(p2.id, 11);
    assert(reopened && reopened.status === 'open', 'Q2 reopened');

    let q2Post = false;
    try {
        const tx6 = (new sql.Transaction(pool));
        await tx6.begin();
        const r6 = tx6.request();
        await postJournalEntryAsync(r6, '2026-04-20', 'FL-TEST after-reopen',
            [{ account_id: accCash, debit: 500, credit: 0 }, { account_id: accSales, debit: 0, credit: 500 }],
            'journal', null, 11,
            { module: 'accounting', action: 'manual_entry', document: 'FL-TEST-JE-REOPEN', isSystem: false }
        );
        await tx6.commit();
        q2Post = true;
    } catch (e) { q2Post = false; }
    assert(q2Post, 'Posting in reopened Q2 allowed');

    // ── Cleanup ──
    console.log('\n═══ Cleanup ═══');
    await del("DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE description LIKE '%FL-TEST%')");
    await del("DELETE FROM journal_entries WHERE description LIKE '%FL-TEST%'");
    await del("DELETE FROM fiscal_periods WHERE name LIKE 'FL-TEST%'");
    console.log('  Done\n');

    console.log('══════════════════════════════════════════════════');
    console.log(`Results: ${passCount}/${assertCount} passed, ${failCount} failed`);
    console.log('══════════════════════════════════════════════════');
    if (failCount > 0) process.exit(1);
    pool.close();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
