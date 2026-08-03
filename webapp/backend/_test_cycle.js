/**
 * Full Accounting Cycle Test
 * 
 * Tests the complete accounting flow programmatically:
 * 1. Opening balance (already done)
 * 2. Credit purchase (10000)
 * 3. Credit sale (9000 with COGS 6000)
 * 4. Customer collection (3000)
 * 5. Supplier payment (2000)
 * 
 * After each step, verifies all reports.
 */

const { getPool, sql } = require('./database/mssql_db');
const accountingEngine = require('./services/accountingEngine');

const poolPromise = getPool();
let assertCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition, msg) {
    assertCount++;
    if (condition) {
        passCount++;
        console.log(`  ✓ ${msg}`);
    } else {
        failCount++;
        console.log(`  ✗ ${msg}`);
    }
}

async function checkReport(url, pool, testName) {
    console.log(`\n─── ${testName} ───`);
    try {
        if (url.includes('trial-balance')) {
            const r = await pool.request().query("SELECT a.account_code, a.account_name, a.account_type, ISNULL(SUM(jel.debit), 0) as total_debit, ISNULL(SUM(jel.credit), 0) as total_credit FROM journal_entry_lines jel JOIN journal_entries je ON jel.entry_id = je.id RIGHT JOIN chart_of_accounts a ON jel.account_id = a.id GROUP BY a.account_code, a.account_name, a.account_type, a.id ORDER BY a.id");
            let totalDr = 0, totalCr = 0;
            r.recordset.forEach(row => {
                const dr = parseFloat(row.total_debit);
                const cr = parseFloat(row.total_credit);
                if (dr !== 0 || cr !== 0) {
                    totalDr += dr; totalCr += cr;
                    console.log(`  ${row.account_code}\t${row.account_name}\tDr=${dr.toFixed(2)}\tCr=${cr.toFixed(2)}`);
                }
            });
            console.log(`  TOTAL: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)} Balanced=${Math.abs(totalDr - totalCr) < 0.01}`);
        } else if (url.includes('ledger')) {
            const r = await pool.request().query("SELECT a.account_code, a.account_name, jel.debit, jel.credit, je.entry_no, je.entry_date, je.description FROM journal_entry_lines jel JOIN journal_entries je ON jel.entry_id = je.id JOIN chart_of_accounts a ON jel.account_id = a.id ORDER BY je.entry_date, je.id");
            r.recordset.forEach(row => {
                console.log(`  ${row.entry_date}\t${row.entry_no}\t${row.account_code}\t${row.account_name}\tDr=${parseFloat(row.debit).toFixed(2)}\tCr=${parseFloat(row.credit).toFixed(2)}`);
            });
        } else if (url.includes('balance-sheet')) {
            const r = await pool.request().query("SELECT a.account_code, a.account_name, a.account_type, ISNULL(SUM(jel.debit), 0) as total_debit, ISNULL(SUM(jel.credit), 0) as total_credit FROM journal_entry_lines jel JOIN journal_entries je ON jel.entry_id = je.id JOIN chart_of_accounts a ON jel.account_id = a.id GROUP BY a.account_code, a.account_name, a.account_type, a.id ORDER BY a.id");
            let totalAssets = 0, totalLiabEq = 0;
            r.recordset.forEach(row => {
                const dr = parseFloat(row.total_debit);
                const cr = parseFloat(row.total_credit);
                if (row.account_type === 'asset') {
                    const net = dr - cr;
                    if (Math.abs(net) > 0.01) {
                        console.log(`  ${row.account_code}\t${row.account_name}\t(asset)\tNet=${net.toFixed(2)}`);
                        totalAssets += net;
                    }
                } else {
                    const net = cr - dr;
                    if (Math.abs(net) > 0.01) {
                        console.log(`  ${row.account_code}\t${row.account_name}\t(${row.account_type})\tNet=${net.toFixed(2)}`);
                        totalLiabEq += net;
                    }
                }
            });
            console.log(`  Total Assets=${totalAssets.toFixed(2)} Total Liab+Equity=${totalLiabEq.toFixed(2)} Balanced=${Math.abs(totalAssets - totalLiabEq) < 0.01}`);
        } else if (url.includes('income-statement')) {
            const r = await pool.request().query("SELECT a.account_code, a.account_name, a.account_type, ISNULL(SUM(jel.debit), 0) as total_debit, ISNULL(SUM(jel.credit), 0) as total_credit FROM journal_entry_lines jel JOIN journal_entries je ON jel.entry_id = je.id JOIN chart_of_accounts a ON jel.account_id = a.id WHERE a.account_type IN ('revenue','expense') GROUP BY a.account_code, a.account_name, a.account_type, a.id ORDER BY a.id");
            let totalRev = 0, totalExp = 0;
            r.recordset.forEach(row => {
                const dr = parseFloat(row.total_debit);
                const cr = parseFloat(row.total_credit);
                const net = row.account_type === 'revenue' ? cr - dr : dr - cr;
                if (Math.abs(net) > 0.01) {
                    console.log(`  ${row.account_code}\t${row.account_name}\t(${row.account_type})\tNet=${net.toFixed(2)}`);
                    if (row.account_type === 'revenue') totalRev += net;
                    else totalExp += net;
                }
            });
            console.log(`  Total Revenue=${totalRev.toFixed(2)} Total Expenses=${totalExp.toFixed(2)} Net Income=${(totalRev - totalExp).toFixed(2)}`);
        }
    } catch (err) {
        console.error(`  ERROR: ${err.message}`);
    }
}

async function main() {
    const pool = await poolPromise;

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║      FULL ACCOUNTING CYCLE TEST                 ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    // ===== CLEANUP PREVIOUS TEST DATA =====
    const del = async (q) => { try { await pool.request().query(q); } catch(e) { /* ignore */ } };
    await del("DELETE FROM purchase_return_items");
    await del("DELETE FROM purchase_returns");
    await del("DELETE FROM sales_return_items");
    await del("DELETE FROM sales_returns");
    await del("DELETE FROM stock_movements");
    await del("DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE description LIKE '%اختبار%')");
    await del("DELETE FROM journal_entries WHERE description LIKE '%اختبار%'");
    await del("DELETE FROM treasury_transactions");
    await del("DELETE FROM purchase_invoice_items");
    await del("DELETE FROM purchase_invoices WHERE invoice_no LIKE 'P-TEST%'");
    await del("DELETE FROM sales_invoice_items");
    await del("DELETE FROM sales_invoices WHERE invoice_no LIKE 'S-TEST%'");
    await del("DELETE FROM customer_collections");
    await del("DELETE FROM supplier_payments");
    await del("DELETE FROM inventory_balances");
    await del("DELETE FROM customers WHERE customer_code LIKE 'CUST-TEST%'");
    await del("DELETE FROM suppliers WHERE supplier_code LIKE 'SUPP-TEST%'");
    await del("DELETE FROM products WHERE product_code LIKE 'PROD-TEST%'");
    await del("UPDATE treasury_accounts SET current_balance = 100000 WHERE id = 1");
    // Restore opening balance JE lines if they were deleted
    const jelCheck = await pool.request().query('SELECT COUNT(*) as c FROM journal_entry_lines');
    if (parseInt(jelCheck.recordset[0].c) === 0) {
        const accCash = await accountingEngine.getSystemAccountAsync(pool.request(), 'SYS_CASH');
        const accRetained = await accountingEngine.getSystemAccountAsync(pool.request(), 'SYS_RETAINED_EARNINGS');
        const je = await pool.request().query("SELECT id FROM journal_entries WHERE entry_no = 'JV-00001'");
        if (je.recordset.length > 0) {
            const jeId = je.recordset[0].id;
            await pool.request()
                .input('jeId', sql.Int, jeId)
                .input('accCash', sql.Int, accCash)
                .input('accRet', sql.Int, accRetained)
                .query("INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description) VALUES (@jeId, @accCash, 100000, 0, 'رصيد افتتاحي'), (@jeId, @accRet, 0, 100000, 'رصيد افتتاحي')");
        }
    }

    // ===== VERIFY INITIAL STATE =====
    console.log('═══ INITIAL STATE (After opening balance fix) ═══');
    await checkReport('ledger', pool, 'Ledger (All)');
    
    // Check treasury
    const tres = await pool.request().query('SELECT current_balance FROM treasury_accounts WHERE id = 1');
    console.log(`\nTreasury balance: ${parseFloat(tres.recordset[0].current_balance).toFixed(2)}`);
    assert(parseFloat(tres.recordset[0].current_balance) === 100000, 'Treasury = 100,000');

    // Check JEs count
    const jeCount = await pool.request().query('SELECT COUNT(*) as c FROM journal_entries');
    console.log(`Journal entries: ${jeCount.recordset[0].c}`);
    assert(jeCount.recordset[0].c >= 1, 'At least 1 JE exists (opening balance)');

    await checkReport('trial-balance', pool, 'Trial Balance');
    await checkReport('balance-sheet', pool, 'Balance Sheet');
    await checkReport('income-statement', pool, 'Income Statement');

    // ===== STEP 1: CREATE CUSTOMER =====
    console.log('\n═══ STEP 1: Create Customer ═══');
    const custRes = await pool.request()
        .input('name', sql.NVarChar, 'عميل اختبار')
        .input('phone', sql.NVarChar, '0123456789')
        .query("INSERT INTO customers (customer_name, customer_code, phone, is_active, current_balance) OUTPUT INSERTED.id VALUES (@name, 'CUST-TEST-001', @phone, 1, 0)");
    const customerId = custRes.recordset[0].id;
    console.log(`  Created customer ID=${customerId}`);
    assert(customerId > 0, 'Customer created');

    // ===== STEP 2: CREATE SUPPLIER =====
    console.log('\n═══ STEP 2: Create Supplier ═══');
    const suppRes = await pool.request()
        .input('name', sql.NVarChar, 'مورد اختبار')
        .input('phone', sql.NVarChar, '0987654321')
        .query("INSERT INTO suppliers (supplier_name, supplier_code, phone, is_active, current_balance) OUTPUT INSERTED.id VALUES (@name, 'SUPP-TEST-001', @phone, 1, 0)");
    const supplierId = suppRes.recordset[0].id;
    console.log(`  Created supplier ID=${supplierId}`);
    assert(supplierId > 0, 'Supplier created');

    // ===== STEP 3: CREATE PRODUCT =====
    console.log('\n═══ STEP 3: Create Product ═══');
    const prodRes = await pool.request()
        .input('name', sql.NVarChar, 'منتج اختبار')
        .input('cost', sql.Decimal(18,2), 100)
        .input('sell', sql.Decimal(18,2), 150)
        .query("INSERT INTO products (product_name, product_code, cost_price, sell_price, is_active) OUTPUT INSERTED.id VALUES (@name, 'PROD-TEST-001', @cost, @sell, 1)");
    const productId = prodRes.recordset[0].id;
    console.log(`  Created product ID=${productId}`);
    assert(productId > 0, 'Product created');

    // Initialize stock
    await pool.request()
        .input('pid', sql.Int, productId)
        .input('sid', sql.Int, 1)
        .input('qty', sql.Int, 1000)
        .query("INSERT INTO inventory_balances (product_id, store_id, quantity) VALUES (@pid, @sid, @qty)");
    console.log('  Stock initialized: 1000 units');

    // ===== STEP 4: CREDIT PURCHASE (10000) =====
    console.log('\n═══ STEP 4: Credit Purchase 10,000 ═══');
    const trans1 = new sql.Transaction(pool);
    await trans1.begin();
    const tx1 = trans1.request();
    try {
        // Get system accounts
        const accAP = await accountingEngine.getSystemAccountAsync(tx1, 'SYS_AP');
        const accInv = await accountingEngine.getSystemAccountAsync(tx1, 'SYS_INVENTORY');
        console.log(`  SYS_AP=${accAP}, SYS_INVENTORY=${accInv}`);

        // Create purchase invoice
        const invNo = 'P-TEST-001';
        const iDate = '2026-07-21';
        
        await tx1
            .input('invNo', sql.NVarChar, invNo)
            .input('iDate', sql.NVarChar, iDate)
            .input('suppId', sql.Int, supplierId)
            .input('storeId', sql.Int, 1)
            .input('subtotal', sql.Decimal(18,2), 10000)
            .input('grandTotal', sql.Decimal(18,2), 10000)
            .query(`INSERT INTO purchase_invoices (invoice_no, invoice_date, supplier_id, store_id, subtotal, grand_total, amount_paid, remaining, status, payment_type) 
                    VALUES (@invNo, @iDate, @suppId, @storeId, @subtotal, @grandTotal, 0, @grandTotal, 'posted', 'credit')`);

        // JE: Dr Inventory 10000, Cr AP 10000
        await accountingEngine.postJournalEntryAsync(
            tx1, iDate, 'استحقاق فاتورة مشتريات اختبار',
            [
                { account_id: accInv, debit: 10000, credit: 0, description: 'مخزون مشتريات اختبار' },
                { account_id: accAP, debit: 0, credit: 10000, description: 'استحقاق مورد اختبار' }
            ],
            'purchase_invoice', null, 1,
            { module: 'purchases', action: 'test', document: invNo, isSystem: true }
        );

        // Update supplier balance
        await tx1
            .input('sbal_sid', sql.Int, supplierId)
            .input('sbal_amt', sql.Decimal(18,2), 10000)
            .query('UPDATE suppliers SET current_balance = COALESCE(current_balance,0) + @sbal_amt WHERE id = @sbal_sid');

        await trans1.commit();
        console.log('  ✓ Purchase invoice created + JE posted');
    } catch (err) {
        await trans1.rollback();
        console.error(`  ✗ FAILED: ${err.message}`);
        assert(false, 'Purchase JE created');
    }

    await checkReport('ledger', pool, 'Ledger After Purchase');
    await checkReport('trial-balance', pool, 'Trial Balance After Purchase');
    await checkReport('balance-sheet', pool, 'Balance Sheet After Purchase');
    await checkReport('income-statement', pool, 'Income Statement After Purchase');

    // ===== STEP 5: CREDIT SALE (9000, COGS 6000) =====
    console.log('\n═══ STEP 5: Credit Sale 9,000 (COGS 6,000) ═══');
    const trans2 = new sql.Transaction(pool);
    await trans2.begin();
    const tx2 = trans2.request();
    try {
        const accAR = await accountingEngine.getSystemAccountAsync(tx2, 'SYS_AR');
        const accSales = await accountingEngine.getSystemAccountAsync(tx2, 'SYS_SALES');
        const accCOGS = await accountingEngine.getSystemAccountAsync(tx2, 'SYS_COGS');
        const accInv = await accountingEngine.getSystemAccountAsync(tx2, 'SYS_INVENTORY');

        const sInvNo = 'S-TEST-001';
        const sDate = '2026-07-21';

        await tx2
            .input('invNo', sql.NVarChar, sInvNo)
            .input('iDate', sql.NVarChar, sDate)
            .input('custId', sql.Int, customerId)
            .input('storeId', sql.Int, 1)
            .input('subtotal', sql.Decimal(18,2), 9000)
            .input('grandTotal', sql.Decimal(18,2), 9000)
            .query(`INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, store_id, subtotal, grand_total, amount_paid, remaining, status, payment_type) 
                    VALUES (@invNo, @iDate, @custId, @storeId, @subtotal, @grandTotal, 0, @grandTotal, 'pending', 'credit')`);

        // JE 1: Dr AR 9000, Cr Sales 9000
        await accountingEngine.postJournalEntryAsync(
            tx2, sDate, 'استحقاق فاتورة مبيعات اختبار',
            [
                { account_id: accAR, debit: 9000, credit: 0, description: 'استحقاق عميل اختبار' },
                { account_id: accSales, debit: 0, credit: 9000, description: 'إيراد مبيعات اختبار' }
            ],
            'sales_invoice', null, 1,
            { module: 'sales', action: 'test', document: sInvNo, isSystem: true }
        );

        // JE 2: Dr COGS 6000, Cr Inventory 6000
        await accountingEngine.postJournalEntryAsync(
            tx2, sDate, 'تكلفة البضاعة لفاتورة اختبار',
            [
                { account_id: accCOGS, debit: 6000, credit: 0, description: 'تكلفة بضاعة مباعة' },
                { account_id: accInv, debit: 0, credit: 6000, description: 'صرف مخزون' }
            ],
            'sales_invoice_cogs', null, 1,
            { module: 'sales', action: 'test_cogs', document: sInvNo, isSystem: true }
        );

        // Update customer balance
        await tx2
            .input('cbal_cid', sql.Int, customerId)
            .input('cbal_amt', sql.Decimal(18,2), 9000)
            .query('UPDATE customers SET current_balance = COALESCE(current_balance,0) + @cbal_amt WHERE id = @cbal_cid');

        await trans2.commit();
        console.log('  ✓ Sale invoice created + 2 JEs posted');
    } catch (err) {
        await trans2.rollback();
        console.error(`  ✗ FAILED: ${err.message}`);
        assert(false, 'Sale JEs created');
    }

    await checkReport('ledger', pool, 'Ledger After Sale');
    await checkReport('trial-balance', pool, 'Trial Balance After Sale');
    await checkReport('balance-sheet', pool, 'Balance Sheet After Sale');
    await checkReport('income-statement', pool, 'Income Statement After Sale');

    // ===== STEP 6: CUSTOMER COLLECTION (3000) =====
    console.log('\n═══ STEP 6: Customer Collection 3,000 ═══');
    const trans3 = new sql.Transaction(pool);
    await trans3.begin();
    const tx3 = trans3.request();
    try {
        const accCash = await accountingEngine.getSystemAccountAsync(tx3, 'SYS_CASH');
        const accAR = await accountingEngine.getSystemAccountAsync(tx3, 'SYS_AR');
        const accTreasuryId = 1; // treasury_accounts.id = 1

        const colNo = 'C-TEST-001';
        const colDate = '2026-07-21';

        // Insert collection
        await tx3
            .input('colNo', sql.NVarChar, colNo)
            .input('colDate', sql.NVarChar, colDate)
            .input('custId', sql.Int, customerId)
            .input('amt', sql.Decimal(18,2), 3000)
            .query(`INSERT INTO customer_collections (collection_no, collection_date, customer_id, amount, payment_method) 
                    VALUES (@colNo, @colDate, @custId, @amt, 'cash')`);

        // Treasury transaction (in)
        const tresNo = 'TRES-TEST-001';
        await tx3
            .input('tresNo', sql.NVarChar, tresNo)
            .input('tDate', sql.NVarChar, colDate)
            .input('tAmt', sql.Decimal(18,2), 3000)
            .input('tAcc', sql.Int, accTreasuryId)
            .query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id) 
                    VALUES (@tresNo, @tDate, 'in', @tAmt, @tAcc)`);
        await tx3
            .input('tDelta', sql.Decimal(18,2), 3000)
            .input('tAccId', sql.Int, accTreasuryId)
            .query('UPDATE treasury_accounts SET current_balance = current_balance + @tDelta WHERE id = @tAccId');

        // JE: Dr Cash 3000, Cr AR 3000
        await accountingEngine.postJournalEntryAsync(
            tx3, colDate, 'تحصيل من العميل اختبار',
            [
                { account_id: accCash, debit: 3000, credit: 0, description: 'تحصيل نقدي' },
                { account_id: accAR, debit: 0, credit: 3000, description: 'سداد من العميل' }
            ],
            'customer_collection', null, 1,
            { module: 'collections', action: 'test', document: colNo, isSystem: true }
        );

        // Update customer balance
        await tx3
            .input('cbal_cid2', sql.Int, customerId)
            .input('cbal_amt2', sql.Decimal(18,2), 3000)
            .query('UPDATE customers SET current_balance = CASE WHEN current_balance - @cbal_amt2 < 0 THEN 0 ELSE current_balance - @cbal_amt2 END WHERE id = @cbal_cid2');

        await trans3.commit();
        console.log('  ✓ Collection created + JE posted');
    } catch (err) {
        await trans3.rollback();
        console.error(`  ✗ FAILED: ${err.message}`);
        assert(false, 'Collection JE created');
    }

    await checkReport('ledger', pool, 'Ledger After Collection');
    await checkReport('trial-balance', pool, 'Trial Balance After Collection');
    await checkReport('balance-sheet', pool, 'Balance Sheet After Collection');
    await checkReport('income-statement', pool, 'Income Statement After Collection');

    // ===== STEP 7: SUPPLIER PAYMENT (2000) =====
    console.log('\n═══ STEP 7: Supplier Payment 2,000 ═══');
    const trans4 = new sql.Transaction(pool);
    await trans4.begin();
    const tx4 = trans4.request();
    try {
        const accCash = await accountingEngine.getSystemAccountAsync(tx4, 'SYS_CASH');
        const accAP = await accountingEngine.getSystemAccountAsync(tx4, 'SYS_AP');
        const accTreasuryId = 1;

        const payNo = 'PY-TEST-001';
        const payDate = '2026-07-21';

        await tx4
            .input('payNo', sql.NVarChar, payNo)
            .input('pDate', sql.NVarChar, payDate)
            .input('suppId', sql.Int, supplierId)
            .input('amt', sql.Decimal(18,2), 2000)
            .query(`INSERT INTO supplier_payments (payment_no, payment_date, supplier_id, amount, payment_method) 
                    VALUES (@payNo, @pDate, @suppId, @amt, 'cash')`);

        // Treasury transaction (out)
        const tresNo2 = 'TRES-TEST-002';
        await tx4
            .input('tresNo2', sql.NVarChar, tresNo2)
            .input('tDate2', sql.NVarChar, payDate)
            .input('tAmt2', sql.Decimal(18,2), 2000)
            .input('tAcc2', sql.Int, accTreasuryId)
            .query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id) 
                    VALUES (@tresNo2, @tDate2, 'out', @tAmt2, @tAcc2)`);
        await tx4
            .input('tDelta2', sql.Decimal(18,2), -2000)
            .input('tAccId2', sql.Int, accTreasuryId)
            .query('UPDATE treasury_accounts SET current_balance = current_balance + @tDelta2 WHERE id = @tAccId2');

        // JE: Dr AP 2000, Cr Cash 2000
        await accountingEngine.postJournalEntryAsync(
            tx4, payDate, 'سداد للمورد اختبار',
            [
                { account_id: accAP, debit: 2000, credit: 0, description: 'سداد للمورد' },
                { account_id: accCash, debit: 0, credit: 2000, description: 'صرف نقدية' }
            ],
            'supplier_payment', null, 1,
            { module: 'payments', action: 'test', document: payNo, isSystem: true }
        );

        // Update supplier balance
        await tx4
            .input('sbal_sid2', sql.Int, supplierId)
            .input('sbal_amt2', sql.Decimal(18,2), 2000)
            .query('UPDATE suppliers SET current_balance = CASE WHEN current_balance - @sbal_amt2 < 0 THEN 0 ELSE current_balance - @sbal_amt2 END WHERE id = @sbal_sid2');

        await trans4.commit();
        console.log('  ✓ Payment created + JE posted');
    } catch (err) {
        await trans4.rollback();
        console.error(`  ✗ FAILED: ${err.message}`);
        assert(false, 'Payment JE created');
    }

    await checkReport('ledger', pool, 'Ledger After Payment');
    await checkReport('trial-balance', pool, 'Trial Balance After Payment');
    await checkReport('balance-sheet', pool, 'Balance Sheet After Payment');
    await checkReport('income-statement', pool, 'Income Statement After Payment');

    // ===== FINAL VERIFICATION =====
    console.log('\n══════════════ FINAL VERIFICATION ══════════════\n');
    
    // Check treasury
    const tresFinal = await pool.request().query('SELECT current_balance FROM treasury_accounts WHERE id = 1');
    const treasuryFinal = parseFloat(tresFinal.recordset[0].current_balance);
    console.log(`Treasury balance: ${treasuryFinal.toFixed(2)}`);
    assert(treasuryFinal === 101000, `Treasury = 101,000 (100,000 + 3,000 - 2,000) [got ${treasuryFinal}]`);

    // Check customer balance
    const custFinal = await pool.request()
        .input('id', sql.Int, customerId)
        .query('SELECT current_balance FROM customers WHERE id = @id');
    const custBal = parseFloat(custFinal.recordset[0].current_balance);
    console.log(`Customer balance: ${custBal.toFixed(2)}`);
    assert(Math.abs(custBal - 6000) < 0.01, `Customer balance = 6,000 (9,000 - 3,000) [got ${custBal}]`);

    // Check supplier balance
    const suppFinal = await pool.request()
        .input('id', sql.Int, supplierId)
        .query('SELECT current_balance FROM suppliers WHERE id = @id');
    const suppBal = parseFloat(suppFinal.recordset[0].current_balance);
    console.log(`Supplier balance: ${suppBal.toFixed(2)}`);
    assert(Math.abs(suppBal - 8000) < 0.01, `Supplier balance = 8,000 (10,000 - 2,000) [got ${suppBal}]`);

    // Check COA balances
    const coaCheck = await pool.request().query("SELECT account_code, account_name, system_code, current_balance FROM chart_of_accounts WHERE current_balance != 0 ORDER BY account_code");
    console.log('\nCOA balances:');
    coaCheck.recordset.forEach(a => console.log(`  ${a.account_code}\t${a.account_name}\tbal=${parseFloat(a.current_balance).toFixed(2)}`));

    // Check JE count
    const jeFinal = await pool.request().query('SELECT COUNT(*) as c FROM journal_entries');
    console.log(`\nTotal JEs: ${jeFinal.recordset[0].c}`);

    // Asset = Liability + Equity check (include revenue/expense as part of equity)
    const bsCheck = await pool.request().query("SELECT a.account_type, SUM(CASE WHEN a.account_type='asset' THEN jel.debit-jel.credit ELSE jel.credit-jel.debit END) as net FROM journal_entry_lines jel JOIN journal_entries je ON jel.entry_id = je.id JOIN chart_of_accounts a ON jel.account_id = a.id GROUP BY a.account_type");
    let assetNet = 0, liabEqNet = 0;
    bsCheck.recordset.forEach(r => {
        if (r.account_type === 'asset') assetNet = parseFloat(r.net);
        else liabEqNet += parseFloat(r.net);
    });
    console.log(`\nBalance Sheet: Assets=${assetNet.toFixed(2)} Liabilities+Equity=${liabEqNet.toFixed(2)}`);
    assert(Math.abs(assetNet - liabEqNet) < 0.01, 'Balance sheet is balanced');

    // Verify income statement: Revenue - COGS - Expenses = Net Income
    const plCheck = await pool.request().query("SELECT a.account_type, SUM(CASE WHEN a.account_type='revenue' THEN jel.credit-jel.debit ELSE jel.debit-jel.credit END) as net FROM journal_entry_lines jel JOIN journal_entries je ON jel.entry_id = je.id JOIN chart_of_accounts a ON jel.account_id = a.id WHERE a.account_type IN ('revenue','expense') GROUP BY a.account_type");
    let revNet = 0, expNet = 0;
    plCheck.recordset.forEach(r => {
        if (r.account_type === 'revenue') revNet = parseFloat(r.net);
        else expNet += parseFloat(r.net);
    });
    console.log(`\nIncome Statement: Revenue=${revNet.toFixed(2)} Expenses=${expNet.toFixed(2)} Net=${(revNet-expNet).toFixed(2)}`);
    assert(Math.abs(revNet - expNet - 3000) < 0.01, 'Net Income = 3,000 (9,000 - 6,000)');

    // Print summary
    console.log('\n══════════════════════════════════════════════════');
    console.log(`Results: ${passCount}/${assertCount} passed, ${failCount} failed`);
    console.log('══════════════════════════════════════════════════');

    pool.close();
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
