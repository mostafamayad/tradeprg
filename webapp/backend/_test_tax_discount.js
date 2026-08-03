/**
 * Tax & Discount Accounting Test
 *
 * Verifies JEs for:
 * 1. Sale with discount (percentage) + VAT
 * 2. Sale with discount (amount) + VAT
 * 3. Purchase with discount + VAT
 * 4. Combined cycle verification
 */

const { getPool, sql } = require('./database/mssql_db');
const poolPromise = getPool();
const accEngine = require('./services/accountingEngine');

let passCount = 0, failCount = 0, assertCount = 0;
function assert(condition, msg) {
    assertCount++;
    if (condition) { passCount++; console.log(`  ✓ ${msg}`); }
    else { failCount++; console.log(`  ✗ FAILED: ${msg}`); }
}

async function getCoaBalance(pool, systemCode) {
    const r = await pool.request().input('sc', sql.NVarChar, systemCode)
        .query("SELECT ISNULL(SUM(jel.debit),0) - ISNULL(SUM(jel.credit),0) as net FROM journal_entry_lines jel JOIN journal_entries je ON jel.entry_id = je.id JOIN chart_of_accounts a ON jel.account_id = a.id WHERE a.system_code = @sc AND je.description LIKE '%TAX-DISC-TEST%'");
    return parseFloat(r.recordset[0].net);
}

async function getAccountId(pool, systemCode) {
    const r = await pool.request().input('sc', sql.NVarChar, systemCode)
        .query("SELECT id FROM chart_of_accounts WHERE system_code = @sc");
    return r.recordset[0]?.id;
}

async function main() {
    const pool = await poolPromise;

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║     TAX & DISCOUNT ACCOUNTING TEST             ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    const del = async (q) => { try { await pool.request().query(q); } catch (e) { /* ignore */ } };
    await del("DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE description LIKE '%TAX-DISC-TEST%')");
    await del("DELETE FROM journal_entries WHERE description LIKE '%TAX-DISC-TEST%'");
    await del("DELETE FROM treasury_transactions WHERE notes LIKE '%TAX-DISC-TEST%'");
    await del("DELETE FROM customer_collections WHERE notes LIKE '%TAX-DISC-TEST%'");
    await del("DELETE FROM supplier_payments WHERE notes LIKE '%TAX-DISC-TEST%'");
    await del("DELETE FROM sales_invoice_items WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE invoice_no LIKE 'TD-TEST%')");
    await del("DELETE FROM sales_invoices WHERE invoice_no LIKE 'TD-TEST%'");
    await del("DELETE FROM purchase_invoice_items WHERE invoice_id IN (SELECT id FROM purchase_invoices WHERE invoice_no LIKE 'TD-TEST%')");
    await del("DELETE FROM purchase_invoices WHERE invoice_no LIKE 'TD-TEST%'");

    const accAR = await getAccountId(pool, 'SYS_AR');
    const accSales = await getAccountId(pool, 'SYS_SALES');
    const accVatOut = await getAccountId(pool, 'SYS_VAT_OUTPUT');
    const accInv = await getAccountId(pool, 'SYS_INVENTORY');
    const accVatIn = await getAccountId(pool, 'SYS_VAT_INPUT');
    const accAP = await getAccountId(pool, 'SYS_AP');
    const accCash = await getAccountId(pool, 'SYS_CASH');
    const accCOGS = await getAccountId(pool, 'SYS_COGS');

    console.log(`  System accounts: AR=${accAR}, Sales=${accSales}, VAT-Out=${accVatOut}, Inv=${accInv}, VAT-In=${accVatIn}, AP=${accAP}, Cash=${accCash}, COGS=${accCOGS}\n`);

    // ═══════════════════════════════════════════════════
    // TEST 1: Sale with 10% discount + 14% VAT
    // Subtotal=1000, Disc%=10% (100), Net=900, VAT=126 (14% of 900)
    // grandTotal = 900 + 126 = 1026
    // JE: Dr AR 1026 / Cr Sales 900 / Cr VAT-Out 126
    // ═══════════════════════════════════════════════════

    console.log('═══ TEST 1: Sale with 10% discount + 14% VAT ═══');
    const trans1 = new sql.Transaction(pool);
    await trans1.begin();
    const tx1 = trans1.request();
    try {
        const r1 = await tx1.input('invNo', sql.NVarChar, 'TD-TEST-SINV-001')
            .input('iDate', sql.NVarChar, '2026-07-22')
            .input('custId', sql.Int, 1)
            .input('storeId', sql.Int, 1)
            .input('subtotal', sql.Decimal(18,2), 1000)
            .input('discount', sql.Decimal(18,2), 100)
            .input('discPct', sql.Decimal(18,2), 10)
            .input('tax', sql.Decimal(18,2), 126)
            .input('grandTotal', sql.Decimal(18,2), 1026)
            .query(`INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, store_id, subtotal, discount_amount, discount_pct, tax_amount, grand_total, amount_paid, remaining, status, payment_type)
                    OUTPUT INSERTED.id
                    VALUES (@invNo, @iDate, @custId, @storeId, @subtotal, @discount, @discPct, @tax, @grandTotal, 0, @grandTotal, 'posted', 'credit')`);
        const sinvId1 = r1.recordset[0].id;

        // JE: Dr AR 1026, Cr Sales 900, Cr VAT-Out 126
        await accEngine.postJournalEntryAsync(tx1, '2026-07-22', 'TAX-DISC-TEST sale with disc+vta',
            [
                { account_id: accAR, debit: 1026, credit: 0, description: 'استحقاق فاتورة اختبار' },
                { account_id: accSales, debit: 0, credit: 900, description: 'إيراد بعد الخصم' },
                { account_id: accVatOut, debit: 0, credit: 126, description: 'ضريبة مخرجات' }
            ],
            'sales_invoice', null, 1,
            { module: 'sales', action: 'test', document: 'TD-TEST-SINV-001', isSystem: true }
        );

        await trans1.commit();
        console.log('  Sale created: subtotal=1000, disc=100(10%), tax=126, grandTotal=1026');
    } catch (e) { await trans1.rollback(); throw e; }

    let arBal = await getCoaBalance(pool, 'SYS_AR');
    let salesBal = await getCoaBalance(pool, 'SYS_SALES');
    let vatOutBal = await getCoaBalance(pool, 'SYS_VAT_OUTPUT');
    console.log(`  AR balance=${arBal.toFixed(2)}, Sales balance=${salesBal.toFixed(2)}, VAT-Out balance=${vatOutBal.toFixed(2)}`);
    assert(Math.abs(arBal - 1026) < 0.01, `AR = 1026 (Dr, got ${arBal})`);
    assert(Math.abs(salesBal - (-900)) < 0.01, `Sales = 900 (Cr, got ${salesBal})`); // revenue is credit
    assert(Math.abs(vatOutBal - (-126)) < 0.01, `VAT-Out = 126 (Cr, got ${vatOutBal})`);
    assert(Math.abs(arBal - (-salesBal - vatOutBal)) < 0.01, 'Balanced: AR (Dr) = Sales (Cr) + VAT-Out (Cr)');

    // ═══════════════════════════════════════════════════
    // TEST 2: Sale with fixed discount (200) + VAT (112)
    // Subtotal=1000, Disc=200, Net=800, VAT=112, grandTotal=912
    // ═══════════════════════════════════════════════════

    console.log('\n═══ TEST 2: Sale with fixed discount 200 + VAT 112 ═══');
    const trans2 = new sql.Transaction(pool);
    await trans2.begin();
    const tx2 = trans2.request();
    try {
        const r2 = await tx2.input('invNo', sql.NVarChar, 'TD-TEST-SINV-002')
            .input('iDate', sql.NVarChar, '2026-07-22')
            .input('custId', sql.Int, 1)
            .input('storeId', sql.Int, 1)
            .input('subtotal', sql.Decimal(18,2), 1000)
            .input('discount', sql.Decimal(18,2), 200)
            .input('tax', sql.Decimal(18,2), 112)
            .input('grandTotal', sql.Decimal(18,2), 912)
            .query(`INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, store_id, subtotal, discount_amount, tax_amount, grand_total, amount_paid, remaining, status, payment_type)
                    OUTPUT INSERTED.id
                    VALUES (@invNo, @iDate, @custId, @storeId, @subtotal, @discount, @tax, @grandTotal, 0, @grandTotal, 'posted', 'credit')`);
        const sinvId2 = r2.recordset[0].id;

        await accEngine.postJournalEntryAsync(tx2, '2026-07-22', 'TAX-DISC-TEST sale fixed disc',
            [
                { account_id: accAR, debit: 912, credit: 0, description: 'استحقاق فاتورة اختبار' },
                { account_id: accSales, debit: 0, credit: 800, description: 'إيراد بعد الخصم' },
                { account_id: accVatOut, debit: 0, credit: 112, description: 'ضريبة مخرجات' }
            ],
            'sales_invoice', null, 1,
            { module: 'sales', action: 'test', document: 'TD-TEST-SINV-002', isSystem: true }
        );

        await trans2.commit();
        console.log('  Sale created: subtotal=1000, disc=200 (fixed), tax=112, grandTotal=912');
    } catch (e) { await trans2.rollback(); throw e; }

    arBal = await getCoaBalance(pool, 'SYS_AR');
    salesBal = await getCoaBalance(pool, 'SYS_SALES');
    vatOutBal = await getCoaBalance(pool, 'SYS_VAT_OUTPUT');
    console.log(`  AR=${arBal.toFixed(2)}, Sales=${salesBal.toFixed(2)}, VAT-Out=${vatOutBal.toFixed(2)}`);
    assert(Math.abs(arBal - (1026+912)) < 0.01, `AR = 1938 (got ${arBal})`);
    assert(Math.abs(vatOutBal - (-126-112)) < 0.01, `VAT-Out = 238 (Cr, got ${vatOutBal})`);

    // ═══════════════════════════════════════════════════
    // TEST 3: Purchase with discount (500) + VAT (15% of net)
    // Subtotal=5000, Disc=500, Net=4500, VAT=675 (15% of 4500)
    // grandTotal = 4500 + 675 = 5175
    // JE: Dr Inventory 4500 / Dr VAT-In 675 / Cr AP 5175
    // ═══════════════════════════════════════════════════

    console.log('\n═══ TEST 3: Purchase with discount 500 + VAT 675 ═══');
    const trans3 = new sql.Transaction(pool);
    await trans3.begin();
    const tx3 = trans3.request();
    try {
        const r3 = await tx3.input('invNo', sql.NVarChar, 'TD-TEST-PINV-001')
            .input('iDate', sql.NVarChar, '2026-07-22')
            .input('suppId', sql.Int, 1)
            .input('storeId', sql.Int, 1)
            .input('subtotal', sql.Decimal(18,2), 5000)
            .input('discount', sql.Decimal(18,2), 500)
            .input('tax', sql.Decimal(18,2), 675)
            .input('grandTotal', sql.Decimal(18,2), 5175)
            .query(`INSERT INTO purchase_invoices (invoice_no, invoice_date, supplier_id, store_id, subtotal, discount_amount, tax_amount, grand_total, amount_paid, remaining, status, payment_type)
                    OUTPUT INSERTED.id
                    VALUES (@invNo, @iDate, @suppId, @storeId, @subtotal, @discount, @tax, @grandTotal, 0, @grandTotal, 'posted', 'credit')`);
        const pinvId3 = r3.recordset[0].id;

        await accEngine.postJournalEntryAsync(tx3, '2026-07-22', 'TAX-DISC-TEST purchase with disc+vta',
            [
                { account_id: accInv, debit: 4500, credit: 0, description: 'مخزون فاتورة (بعد الخصم)' },
                { account_id: accVatIn, debit: 675, credit: 0, description: 'ضريبة مدخلات' },
                { account_id: accAP, debit: 0, credit: 5175, description: 'استحقاق مورد فاتورة' }
            ],
            'purchase_invoice', null, 1,
            { module: 'purchases', action: 'test', document: 'TD-TEST-PINV-001', isSystem: true }
        );

        await trans3.commit();
        console.log('  Purchase created: subtotal=5000, disc=500, tax=675, grandTotal=5175');
    } catch (e) { await trans3.rollback(); throw e; }

    let invBal = await getCoaBalance(pool, 'SYS_INVENTORY');
    let vatInBal = await getCoaBalance(pool, 'SYS_VAT_INPUT');
    let apBal = await getCoaBalance(pool, 'SYS_AP');
    console.log(`  Inventory=${invBal.toFixed(2)}, VAT-In=${vatInBal.toFixed(2)}, AP=${apBal.toFixed(2)}`);
    assert(Math.abs(invBal - 4500) < 0.01, `Inventory = 4500 (Dr, got ${invBal})`);
    assert(Math.abs(vatInBal - 675) < 0.01, `VAT-In = 675 (Dr, got ${vatInBal})`);
    assert(Math.abs(apBal - (-5175)) < 0.01, `AP = 5175 (Cr, got ${apBal})`);
    assert(Math.abs(invBal + vatInBal + apBal) < 0.01, 'Balanced: Inventory + VAT-In (Dr) = AP (Cr)');

    // ═══════════════════════════════════════════════════
    // FINAL VERIFICATION
    // ═══════════════════════════════════════════════════

    console.log('\n══════════════ FINAL VERIFICATION ══════════════\n');

    const allBal = await pool.request().query(`
        SELECT a.system_code, a.account_code, a.account_name, a.account_type,
               ISNULL(SUM(jel.debit),0) - ISNULL(SUM(jel.credit),0) as net
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.entry_id = je.id
        JOIN chart_of_accounts a ON jel.account_id = a.id
        WHERE je.description LIKE '%TAX-DISC-TEST%'
        GROUP BY a.system_code, a.account_code, a.account_name, a.account_type
        ORDER BY a.account_code
    `);
    console.log('  All affected accounts:');
    let totalDr = 0, totalCr = 0;
    allBal.recordset.forEach(r => {
        const net = parseFloat(r.net);
        const side = net >= 0 ? 'Dr' : 'Cr';
        console.log(`    ${r.account_code}\t${r.account_name}\t(${r.account_type})\t${side}=${Math.abs(net).toFixed(2)}`);
        if (net >= 0) totalDr += net; else totalCr += Math.abs(net);
    });
    console.log(`  Total: Dr=${totalDr.toFixed(2)}, Cr=${totalCr.toFixed(2)}, Balanced=${Math.abs(totalDr - totalCr) < 0.01}`);

    // Verify: Total Dr of all JEs = Total Cr of all JEs
    assert(Math.abs(totalDr - totalCr) < 0.01, `All JEs balanced (Dr=${totalDr}, Cr=${totalCr})`);

    // Verify net VAT position: |VAT-Out| - |VAT-In| = 238 - 675 = -437 (net VAT receivable)
    const netVat = -vatOutBal - vatInBal; // vatOutBal is negative (Cr)
    console.log(`\n  Net VAT position: |VAT-Out|(${-vatOutBal.toFixed(2)}) - |VAT-In|(${vatInBal.toFixed(2)}) = ${netVat.toFixed(2)}`);
    assert(Math.abs(netVat - (-437)) < 0.01, `Net VAT = -437 (receivable, got ${netVat})`);

    console.log('\n══════════════════════════════════════════════════');
    console.log(`Results: ${passCount}/${assertCount} passed, ${failCount} failed`);
    console.log('══════════════════════════════════════════════════');

    if (failCount > 0) process.exit(1);
    pool.close();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
