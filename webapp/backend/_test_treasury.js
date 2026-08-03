/**
 * Treasury & Banks Comprehensive Test
 *
 * Scenarios:
 * 1. Create cash account (opening balance) → JE Dr SYS_CASH / Cr SYS_RETAINED_EARNINGS
 * 2. Manual receipt (in) → JE Dr SYS_CASH / Cr SYS_RETAINED_EARNINGS
 * 3. Manual payment (out) → JE Dr SYS_EXPENSE / Cr SYS_CASH
 * 4. Expense from treasury → JE Dr COA_account / Cr SYS_CASH
 * 5. Create bank account → JE Dr SYS_BANK / Cr SYS_RETAINED_EARNINGS
 * 6. Bank deposit → JE Dr SYS_BANK / Cr SYS_RETAINED_EARNINGS
 * 7. Bank withdrawal → JE Dr SYS_EXPENSE / Cr SYS_BANK
 * 8. Cash to Bank transfer: out from cash + in to bank
 * 9. Reverse transaction
 * 10. Final verification of all balances
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
    console.log('║     TREASURY & BANKS COMPREHENSIVE TEST        ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    const del = async (q) => { try { await pool.request().query(q); } catch (e) { /* ignore */ } };
    await del("DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE description LIKE '%TB-TEST%')");
    await del("DELETE FROM journal_entries WHERE description LIKE '%TB-TEST%'");
    await del("DELETE FROM treasury_transactions WHERE description LIKE '%TB-TEST%'");
    await del("DELETE FROM expenses WHERE description LIKE '%TB-TEST%'");

    // Clean test treasury/bank accounts
    await del("DELETE FROM treasury_accounts WHERE account_name LIKE 'TB-TEST-%'");

    // ═══════════════════════════════════════════════════
    // SETUP: Get system account IDs via pool
    // ═══════════════════════════════════════════════════
    const sys = async (code) => {
        const r = await pool.request().input('c', sql.NVarChar, code)
            .query("SELECT id FROM chart_of_accounts WHERE system_code = @c");
        return r.recordset[0]?.id;
    };
    const accCash = await sys('SYS_CASH');
    const accBank = await sys('SYS_BANK');
    const accRetain = await sys('SYS_RETAINED_EARNINGS');
    const accExpense = await sys('SYS_EXPENSE');
    console.log(`  System accounts: Cash=${accCash}, Bank=${accBank}, Retained=${accRetain}, Expense=${accExpense}\n`);

    // ═══════════════════════════════════════════════════
    // HELPER: Post a treasury JE
    // ═══════════════════════════════════════════════════
    const { postJournalEntryAsync, getSystemAccountAsync } = require('./services/accountingEngine');

    // ═══════════════════════════════════════════════════
    // TEST 1: Create cash treasury account with opening balance
    // ═══════════════════════════════════════════════════
    console.log('═══ TEST 1: Create Cash Account (opening 50000) ═══');
    const trans1 = new sql.Transaction(pool);
    await trans1.begin();
    const tx1 = trans1.request();
    let cashAccId, bankAccId;
    try {
        const r1 = await tx1.input('name', sql.NVarChar, 'TB-TEST-Cash')
            .input('type', sql.NVarChar, 'cash')
            .input('ob', sql.Decimal(18,2), 50000)
            .query(`INSERT INTO treasury_accounts (account_name, account_type, opening_balance, current_balance)
                    OUTPUT INSERTED.id VALUES (@name, @type, @ob, @ob)`);
        cashAccId = r1.recordset[0].id;

        // JE: Dr SYS_CASH 50000 / Cr SYS_RETAINED_EARNINGS 50000
        await postJournalEntryAsync(tx1, '2026-07-22', 'TB-TEST opening balance cash',
            [
                { account_id: accCash, debit: 50000, credit: 0, description: 'رصيد افتتاحي خزينة' },
                { account_id: accRetain, debit: 0, credit: 50000, description: 'مقابل رصيد افتتاحي' }
            ],
            'treasury_account', null, 1,
            { module: 'treasury', action: 'create_account', document: 'ACC-' + cashAccId, isSystem: true }
        );
        await trans1.commit();
        console.log('  Cash account created ID=' + cashAccId);
    } catch (e) { await trans1.rollback(); throw e; }

    // Verify
    const tres1 = await pool.request().input('id', sql.Int, cashAccId)
        .query('SELECT current_balance FROM treasury_accounts WHERE id = @id');
    assert(parseFloat(tres1.recordset[0].current_balance) === 50000, 'Treasury cash balance = 50000');

    // ═══════════════════════════════════════════════════
    // TEST 2: Manual receipt (in) 10000
    // ═══════════════════════════════════════════════════
    console.log('\n═══ TEST 2: Manual Receipt (in) 10000 cash ═══');
    const trans2 = new sql.Transaction(pool);
    await trans2.begin();
    const tx2 = trans2.request();
    try {
        await tx2.input('transNo', sql.NVarChar, 'TB-TEST-RCPT-001')
            .input('tDate', sql.NVarChar, '2026-07-22')
            .input('amt', sql.Decimal(18,2), 10000)
            .input('accId', sql.Int, cashAccId)
            .input('desc', sql.NVarChar, 'TB-TEST manual receipt')
            .query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, description)
                    OUTPUT INSERTED.id
                    VALUES (@transNo, @tDate, 'in', @amt, @accId, @desc)`);
        // Update balance
        await tx2.query(`UPDATE treasury_accounts SET current_balance = current_balance + 10000 WHERE id = ${cashAccId}`);
        // JE: Dr SYS_CASH 10000 / Cr SYS_RETAINED_EARNINGS 10000
        await postJournalEntryAsync(tx2, '2026-07-22', 'TB-TEST manual receipt',
            [
                { account_id: accCash, debit: 10000, credit: 0, description: 'إيداع نقدي' },
                { account_id: accRetain, debit: 0, credit: 10000, description: 'مقابل إيداع' }
            ],
            'treasury', null, 1,
            { module: 'treasury', action: 'manual_transaction', document: 'TB-TEST-RCPT-001', isSystem: true }
        );
        await trans2.commit();
    } catch (e) { await trans2.rollback(); throw e; }

    const tres2 = await pool.request().input('id', sql.Int, cashAccId)
        .query('SELECT current_balance FROM treasury_accounts WHERE id = @id');
    assert(parseFloat(tres2.recordset[0].current_balance) === 60000, 'Treasury cash balance = 60000 (50000+10000)');

    // ═══════════════════════════════════════════════════
    // TEST 3: Manual payment (out) 5000
    // ═══════════════════════════════════════════════════
    console.log('\n═══ TEST 3: Manual Payment (out) 5000 cash ═══');
    const trans3 = new sql.Transaction(pool);
    await trans3.begin();
    const tx3 = trans3.request();
    try {
        await tx3.input('transNo', sql.NVarChar, 'TB-TEST-PAY-001')
            .input('tDate', sql.NVarChar, '2026-07-22')
            .input('amt', sql.Decimal(18,2), 5000)
            .input('accId', sql.Int, cashAccId)
            .query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, description)
                    OUTPUT INSERTED.id
                    VALUES (@transNo, @tDate, 'out', @amt, @accId, 'TB-TEST manual payment')`);
        await tx3.query(`UPDATE treasury_accounts SET current_balance = current_balance - 5000 WHERE id = ${cashAccId}`);
        // JE: Dr SYS_EXPENSE 5000 / Cr SYS_CASH 5000
        await postJournalEntryAsync(tx3, '2026-07-22', 'TB-TEST manual payment',
            [
                { account_id: accExpense, debit: 5000, credit: 0, description: 'صرف نقدي' },
                { account_id: accCash, debit: 0, credit: 5000, description: 'مقابل صرف' }
            ],
            'treasury', null, 1,
            { module: 'treasury', action: 'manual_transaction', document: 'TB-TEST-PAY-001', isSystem: true }
        );
        await trans3.commit();
    } catch (e) { await trans3.rollback(); throw e; }

    const tres3 = await pool.request().input('id', sql.Int, cashAccId)
        .query('SELECT current_balance FROM treasury_accounts WHERE id = @id');
    assert(parseFloat(tres3.recordset[0].current_balance) === 55000, 'Treasury cash balance = 55000 (60000-5000)');

    // ═══════════════════════════════════════════════════
    // TEST 4: Expense from treasury (2000 to expense account)
    // ═══════════════════════════════════════════════════
    console.log('\n═══ TEST 4: Expense 2000 from cash to COA expense account ═══');
    const trans4 = new sql.Transaction(pool);
    await trans4.begin();
    const tx4 = trans4.request();
    try {
        await tx4.input('expNo', sql.NVarChar, 'TB-TEST-EXP-001')
            .input('eDate', sql.NVarChar, '2026-07-22')
            .input('expType', sql.NVarChar, 'operation')
            .input('accId', sql.Int, accExpense)
            .input('tresId', sql.Int, cashAccId)
            .input('amt', sql.Decimal(18,2), 2000)
            .query(`INSERT INTO expenses (expense_no, expense_date, expense_type, account_id, treasury_id, amount, description)
                    OUTPUT INSERTED.id
                    VALUES (@expNo, @eDate, @expType, @accId, @tresId, @amt, 'TB-TEST expense')`);
        // Treasury transaction
        await tx4.input('transNo2', sql.NVarChar, 'TB-TEST-EXP-TR-001')
            .input('txAmt', sql.Decimal(18,2), 2000)
            .query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, description)
                    VALUES (@transNo2, @eDate, 'out', @txAmt, @tresId, 'expense', 'TB-TEST expense tx')`);
        await tx4.query(`UPDATE treasury_accounts SET current_balance = current_balance - 2000 WHERE id = ${cashAccId}`);
        // JE: Dr expense_account 2000 / Cr SYS_CASH 2000
        await postJournalEntryAsync(tx4, '2026-07-22', 'TB-TEST expense',
            [
                { account_id: accExpense, debit: 2000, credit: 0, description: 'مصروف تشغيل' },
                { account_id: accCash, debit: 0, credit: 2000, description: 'صرف من الخزينة' }
            ],
            'expense', null, 1,
            { module: 'treasury', action: 'expense', document: 'TB-TEST-EXP-001', isSystem: true }
        );
        await trans4.commit();
    } catch (e) { await trans4.rollback(); throw e; }

    const tres4 = await pool.request().input('id', sql.Int, cashAccId)
        .query('SELECT current_balance FROM treasury_accounts WHERE id = @id');
    assert(parseFloat(tres4.recordset[0].current_balance) === 53000, 'Treasury cash balance = 53000 (55000-2000)');

    // ═══════════════════════════════════════════════════
    // TEST 5: Create bank account (opening 100000)
    // ═══════════════════════════════════════════════════
    console.log('\n═══ TEST 5: Create Bank Account (opening 100000) ═══');
    const trans5 = new sql.Transaction(pool);
    await trans5.begin();
    const tx5 = trans5.request();
    try {
        const r5 = await tx5.input('name', sql.NVarChar, 'TB-TEST-Bank')
            .input('type', sql.NVarChar, 'bank')
            .input('bName', sql.NVarChar, 'بنك الاختبار')
            .input('accNo', sql.NVarChar, '123-456-789')
            .input('ob', sql.Decimal(18,2), 100000)
            .query(`INSERT INTO treasury_accounts (account_name, account_type, bank_name, account_no, opening_balance, current_balance)
                    OUTPUT INSERTED.id VALUES (@name, @type, @bName, @accNo, @ob, @ob)`);
        bankAccId = r5.recordset[0].id;

        // JE: Dr SYS_BANK 100000 / Cr SYS_RETAINED_EARNINGS 100000
        await postJournalEntryAsync(tx5, '2026-07-22', 'TB-TEST opening balance bank',
            [
                { account_id: accBank, debit: 100000, credit: 0, description: 'رصيد افتتاحي بنك' },
                { account_id: accRetain, debit: 0, credit: 100000, description: 'مقابل رصيد افتتاحي بنك' }
            ],
            'treasury_account', null, 1,
            { module: 'treasury', action: 'create_account', document: 'ACC-' + bankAccId, isSystem: true }
        );
        await trans5.commit();
        console.log('  Bank account created ID=' + bankAccId);
    } catch (e) { await trans5.rollback(); throw e; }

    const tres5 = await pool.request().input('id', sql.Int, bankAccId)
        .query('SELECT current_balance FROM treasury_accounts WHERE id = @id');
    assert(parseFloat(tres5.recordset[0].current_balance) === 100000, 'Bank balance = 100000');

    // ═══════════════════════════════════════════════════
    // TEST 6: Bank deposit (in) 30000
    // ═══════════════════════════════════════════════════
    console.log('\n═══ TEST 6: Bank Deposit (in) 30000 ═══');
    const trans6 = new sql.Transaction(pool);
    await trans6.begin();
    const tx6 = trans6.request();
    try {
        await tx6.input('transNo', sql.NVarChar, 'TB-TEST-BNK-IN-001')
            .input('tDate', sql.NVarChar, '2026-07-22')
            .input('amt', sql.Decimal(18,2), 30000)
            .input('accId', sql.Int, bankAccId)
            .query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, description)
                    OUTPUT INSERTED.id
                    VALUES (@transNo, @tDate, 'in', @amt, @accId, 'TB-TEST bank deposit')`);
        await tx6.query(`UPDATE treasury_accounts SET current_balance = current_balance + 30000 WHERE id = ${bankAccId}`);
        // JE: Dr SYS_BANK 30000 / Cr SYS_RETAINED_EARNINGS 30000
        await postJournalEntryAsync(tx6, '2026-07-22', 'TB-TEST bank deposit',
            [
                { account_id: accBank, debit: 30000, credit: 0, description: 'إيداع بنكي' },
                { account_id: accRetain, debit: 0, credit: 30000, description: 'مقابل إيداع بنكي' }
            ],
            'treasury', null, 1,
            { module: 'treasury', action: 'manual_transaction', document: 'TB-TEST-BNK-IN-001', isSystem: true }
        );
        await trans6.commit();
    } catch (e) { await trans6.rollback(); throw e; }

    const tres6 = await pool.request().input('id', sql.Int, bankAccId)
        .query('SELECT current_balance FROM treasury_accounts WHERE id = @id');
    assert(parseFloat(tres6.recordset[0].current_balance) === 130000, 'Bank balance = 130000 (100000+30000)');

    // ═══════════════════════════════════════════════════
    // TEST 7: Bank withdrawal (out) 15000
    // ═══════════════════════════════════════════════════
    console.log('\n═══ TEST 7: Bank Withdrawal (out) 15000 ═══');
    const trans7 = new sql.Transaction(pool);
    await trans7.begin();
    const tx7 = trans7.request();
    try {
        await tx7.input('transNo', sql.NVarChar, 'TB-TEST-BNK-OUT-001')
            .input('tDate', sql.NVarChar, '2026-07-22')
            .input('amt', sql.Decimal(18,2), 15000)
            .input('accId', sql.Int, bankAccId)
            .query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, description)
                    OUTPUT INSERTED.id
                    VALUES (@transNo, @tDate, 'out', @amt, @accId, 'TB-TEST bank withdrawal')`);
        await tx7.query(`UPDATE treasury_accounts SET current_balance = current_balance - 15000 WHERE id = ${bankAccId}`);
        // JE: Dr SYS_EXPENSE 15000 / Cr SYS_BANK 15000
        await postJournalEntryAsync(tx7, '2026-07-22', 'TB-TEST bank withdrawal',
            [
                { account_id: accExpense, debit: 15000, credit: 0, description: 'سحب بنكي' },
                { account_id: accBank, debit: 0, credit: 15000, description: 'مقابل سحب بنكي' }
            ],
            'treasury', null, 1,
            { module: 'treasury', action: 'manual_transaction', document: 'TB-TEST-BNK-OUT-001', isSystem: true }
        );
        await trans7.commit();
    } catch (e) { await trans7.rollback(); throw e; }

    const tres7 = await pool.request().input('id', sql.Int, bankAccId)
        .query('SELECT current_balance FROM treasury_accounts WHERE id = @id');
    assert(parseFloat(tres7.recordset[0].current_balance) === 115000, 'Bank balance = 115000 (130000-15000)');

    // ═══════════════════════════════════════════════════
    // TEST 8: Cash to Bank transfer: out from cash + in to bank
    // ═══════════════════════════════════════════════════
    console.log('\n═══ TEST 8: Transfer Cash→Bank 20000 ═══');
    const trans8 = new sql.Transaction(pool);
    await trans8.begin();
    const tx8 = trans8.request();
    try {
        // Out from cash
        await tx8.input('trOutNo', sql.NVarChar, 'TB-TEST-TRF-OUT')
            .input('tDate', sql.NVarChar, '2026-07-22')
            .input('amt', sql.Decimal(18,2), 20000)
            .query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, description, related_type)
                    OUTPUT INSERTED.id
                    VALUES (@trOutNo, @tDate, 'out', @amt, ${cashAccId}, 'TB-TEST transfer out from cash', 'transfer')`);
        await tx8.query(`UPDATE treasury_accounts SET current_balance = current_balance - 20000 WHERE id = ${cashAccId}`);
        // In to bank
        await tx8.input('trInNo', sql.NVarChar, 'TB-TEST-TRF-IN')
            .query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, description, related_type)
                    OUTPUT INSERTED.id
                    VALUES (@trInNo, @tDate, 'in', @amt, ${bankAccId}, 'TB-TEST transfer in to bank', 'transfer')`);
        await tx8.query(`UPDATE treasury_accounts SET current_balance = current_balance + 20000 WHERE id = ${bankAccId}`);
        // JE: Dr SYS_BANK 20000 / Cr SYS_CASH 20000 (transfer between asset accounts)
        await postJournalEntryAsync(tx8, '2026-07-22', 'TB-TEST cash to bank transfer',
            [
                { account_id: accBank, debit: 20000, credit: 0, description: 'تحويل من خزينة إلى بنك' },
                { account_id: accCash, debit: 0, credit: 20000, description: 'تحويل إلى بنك من خزينة' }
            ],
            'treasury', null, 1,
            { module: 'treasury', action: 'transfer', document: 'TB-TEST-TRF-OUT', isSystem: true }
        );
        await trans8.commit();
    } catch (e) { await trans8.rollback(); throw e; }

    const cash8 = await pool.request().input('id', sql.Int, cashAccId)
        .query('SELECT current_balance FROM treasury_accounts WHERE id = @id');
    const bank8 = await pool.request().input('id', sql.Int, bankAccId)
        .query('SELECT current_balance FROM treasury_accounts WHERE id = @id');
    assert(parseFloat(cash8.recordset[0].current_balance) === 33000, 'Cash balance after transfer = 33000 (53000-20000)');
    assert(parseFloat(bank8.recordset[0].current_balance) === 135000, 'Bank balance after transfer = 135000 (115000+20000)');

    // ═══════════════════════════════════════════════════
    // TEST 9: Reverse transaction (reverse the 5000 payment)
    // ═══════════════════════════════════════════════════
    console.log('\n═══ TEST 9: Reverse Payment 5000 ═══');
    const origTrans = await pool.request()
        .query("SELECT TOP 1 id, trans_no, trans_type, amount, account_id FROM treasury_transactions WHERE trans_no = 'TB-TEST-PAY-001'");
    const origId = origTrans.recordset[0]?.id;
    assert(!!origId, 'Original transaction found for reversal');

    const trans9 = new sql.Transaction(pool);
    await trans9.begin();
    const tx9 = trans9.request();
    try {
        // Create reversal transaction (out→in)
        await tx9.input('revNo', sql.NVarChar, 'REV-TB-TEST-PAY-001')
            .input('tDate', sql.NVarChar, '2026-07-22')
            .input('amt', sql.Decimal(18,2), 5000)
            .input('accId', sql.Int, cashAccId)
            .input('origId', sql.Int, origId)
            .query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, description)
                    OUTPUT INSERTED.id
                    VALUES (@revNo, @tDate, 'in', @amt, @accId, 'reversal', @origId, 'TB-TEST reversal of payment')`);
        // Reverse balance: +5000 back to cash
        await tx9.query(`UPDATE treasury_accounts SET current_balance = current_balance + 5000 WHERE id = ${cashAccId}`);
        // Reverse JE: Dr SYS_CASH 5000 / Cr SYS_EXPENSE 5000
        await postJournalEntryAsync(tx9, '2026-07-22', 'TB-TEST reversal of payment',
            [
                { account_id: accCash, debit: 5000, credit: 0, description: 'عكس صرف نقدي' },
                { account_id: accExpense, debit: 0, credit: 5000, description: 'عكس صرف' }
            ],
            'treasury', null, 1,
            { module: 'treasury', action: 'reversal', document: 'REV-TB-TEST-PAY-001', isSystem: true }
        );
        await trans9.commit();
    } catch (e) { await trans9.rollback(); throw e; }

    const cash9 = await pool.request().input('id', sql.Int, cashAccId)
        .query('SELECT current_balance FROM treasury_accounts WHERE id = @id');
    assert(parseFloat(cash9.recordset[0].current_balance) === 38000, 'Cash balance after reversal = 38000 (33000+5000)');

    // ═══════════════════════════════════════════════════
    // FINAL VERIFICATION
    // ═══════════════════════════════════════════════════
    console.log('\n══════════════ FINAL VERIFICATION ══════════════\n');

    // 1. Treasury balances
    console.log('  Treasury account balances:');
    const allTres = await pool.request()
        .query("SELECT id, account_name, account_type, current_balance FROM treasury_accounts WHERE account_name LIKE 'TB-TEST-%' ORDER BY id");
    let totalTres = 0;
    allTres.recordset.forEach(t => {
        const bal = parseFloat(t.current_balance);
        totalTres += bal;
        console.log(`    ${t.account_name} (${t.account_type}): ${bal.toFixed(2)}`);
    });
    // Cash: 50000+10000-5000-2000-20000+5000 = 38000
    // Bank: 100000+30000-15000+20000 = 135000
    // Total: 38000+135000 = 173000
    assert(Math.abs(totalTres - 173000) < 0.01, `Total treasury balance = 173000 (got ${totalTres})`);

    // 2. JE balances
    console.log('\n  Journal entry balances (TB-TEST only):');
    const jeData = await pool.request().query(`
        SELECT a.system_code, a.account_code, a.account_name,
               ISNULL(SUM(jel.debit),0) - ISNULL(SUM(jel.credit),0) as net
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.entry_id = je.id
        JOIN chart_of_accounts a ON jel.account_id = a.id
        WHERE je.description LIKE '%TB-TEST%'
        GROUP BY a.system_code, a.account_code, a.account_name, a.account_type
        ORDER BY a.account_code
    `);
    let totalDr = 0, totalCr = 0;
    jeData.recordset.forEach(r => {
        const net = parseFloat(r.net);
        const side = net >= 0 ? 'Dr' : 'Cr';
        console.log(`    ${r.account_code}\t${r.account_name}\t(${r.system_code})\t${side}=${Math.abs(net).toFixed(2)}`);
        if (net >= 0) totalDr += net; else totalCr += Math.abs(net);
    });
    console.log(`    Total: Dr=${totalDr.toFixed(2)}, Cr=${totalCr.toFixed(2)}`);
    assert(Math.abs(totalDr - totalCr) < 0.01, 'All JEs balanced');

    // 3. Net cash position from COA
    const cashNet = jeData.recordset.find(r => r.system_code === 'SYS_CASH');
    const bankNet = jeData.recordset.find(r => r.system_code === 'SYS_BANK');
    const cashVal = cashNet ? parseFloat(cashNet.net) : 0; // should be positive (Dr)
    const bankVal = bankNet ? parseFloat(bankNet.net) : 0;
    console.log(`\n  COA Cash net = ${cashVal.toFixed(2)}, COA Bank net = ${bankVal.toFixed(2)}`);

    // Cash: 50000 (opening) + 10000 (receipt) - 5000 (payment) - 2000 (expense) - 20000 (transfer) + 5000 (reversal) = 38000
    assert(Math.abs(cashVal - 38000) < 0.01, `COA SYS_CASH net = 38000 (got ${cashVal})`);
    // Bank: 100000 (opening) + 30000 (deposit) - 15000 (withdrawal) + 20000 (transfer) = 135000
    assert(Math.abs(bankVal - 135000) < 0.01, `COA SYS_BANK net = 135000 (got ${bankVal})`);

    // 4. Verify treasury balance = COA balance (cash + bank)
    console.log(`\n  Treasury total = ${totalTres.toFixed(2)}, COA Cash+Bank = ${(cashVal + bankVal).toFixed(2)}`);
    assert(Math.abs(totalTres - (cashVal + bankVal)) < 0.01, 'Treasury total = COA Cash+Bank');

    console.log('\n══════════════════════════════════════════════════');
    console.log(`Results: ${passCount}/${assertCount} passed, ${failCount} failed`);
    console.log('══════════════════════════════════════════════════');

    if (failCount > 0) process.exit(1);
    pool.close();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
