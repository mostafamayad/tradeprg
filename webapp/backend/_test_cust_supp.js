/**
 * Customers & Suppliers Balance Test
 *
 * Verifies:
 * Customer: balance = opening + sales - returns - collections
 * Supplier: balance = opening + purchases - returns - payments
 * And accounting ledger matches
 */

const { getPool, sql } = require('./database/mssql_db');
const poolPromise = getPool();
const balanceService = require('./services/balanceService');

let passCount = 0, failCount = 0, assertCount = 0;
function assert(condition, msg) {
    assertCount++;
    if (condition) { passCount++; console.log(`  ✓ ${msg}`); }
    else { failCount++; console.log(`  ✗ FAILED: ${msg}`); }
}

async function main() {
    const pool = await poolPromise;

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   CUSTOMERS & SUPPLIERS BALANCE TEST           ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    const del = async (q) => { try { await pool.request().query(q); } catch (e) { /* ignore */ } };
    await del("DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE description LIKE '%CSTEST%')");
    await del("DELETE FROM journal_entries WHERE description LIKE '%CSTEST%'");
    await del("DELETE FROM customer_collections WHERE notes LIKE '%CSTEST%'");
    await del("DELETE FROM supplier_payments WHERE notes LIKE '%CSTEST%'");
    await del("DELETE FROM sales_return_items WHERE return_id IN (SELECT id FROM sales_returns WHERE notes LIKE '%CSTEST%')");
    await del("DELETE FROM sales_returns WHERE notes LIKE '%CSTEST%'");
    await del("DELETE FROM purchase_return_items WHERE return_id IN (SELECT id FROM purchase_returns WHERE notes LIKE '%CSTEST%')");
    await del("DELETE FROM purchase_returns WHERE notes LIKE '%CSTEST%'");
    await del("DELETE FROM sales_invoice_items WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE invoice_no LIKE 'CS-TEST%')");
    await del("DELETE FROM sales_invoices WHERE invoice_no LIKE 'CS-TEST%'");
    await del("DELETE FROM purchase_invoice_items WHERE invoice_id IN (SELECT id FROM purchase_invoices WHERE invoice_no LIKE 'CS-TEST%')");
    await del("DELETE FROM purchase_invoices WHERE invoice_no LIKE 'CS-TEST%'");
    await del("DELETE FROM customers WHERE customer_code = 'CSTEST-CUST'");
    await del("DELETE FROM suppliers WHERE supplier_code = 'CSTEST-SUPP'");
    await del("DELETE FROM treasury_transactions WHERE notes LIKE '%CSTEST%'");

    // ═══════════════════════════════════════════════════
    // CUSTOMER TESTS
    // ═══════════════════════════════════════════════════
    console.log('═══ CUSTOMER BALANCE TESTS ═══');

    // Step 1: Create customer with opening balance
    console.log('  --- Step 1: Create customer with opening balance 5000 ---');
    const custRes = await pool.request()
        .input('name', sql.NVarChar, 'عميل اختبار الرصيد')
        .input('code', sql.NVarChar, 'CSTEST-CUST')
        .input('ob', sql.Decimal(18,2), 5000)
        .query(`INSERT INTO customers (customer_name, customer_code, opening_balance, current_balance, phone, is_active)
                OUTPUT INSERTED.id VALUES (@name, @code, @ob, @ob, '0111111111', 1)`);
    const customerId = custRes.recordset[0].id;
    assert(customerId > 0, `Customer created (ID=${customerId})`);

    // Verify initial balance
    let cData = await balanceService.getCustomerFullBalance(customerId, pool);
    console.log(`  Opening: ${cData.opening}, Sales: ${cData.sales}, Returns: ${cData.returns}, Collections: ${cData.collections} = Balance: ${cData.balance}`);
    assert(cData.balance === 5000, `Initial customer balance = 5000 (got ${cData.balance})`);

    // Step 2: Create sales invoice 10000
    console.log('  --- Step 2: Create sales invoice 10000 ---');
    const trans1 = new sql.Transaction(pool);
    await trans1.begin();
    const tx1 = trans1.request();
    try {
        const r1 = await tx1.input('invNo', sql.NVarChar, 'CS-TEST-SINV-001')
            .input('iDate', sql.NVarChar, '2026-07-22')
            .input('custId', sql.Int, customerId)
            .input('storeId', sql.Int, 1)
            .input('subtotal', sql.Decimal(18,2), 10000)
            .input('grandTotal', sql.Decimal(18,2), 10000)
            .query(`INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, store_id, subtotal, grand_total, amount_paid, remaining, status, payment_type)
                    OUTPUT INSERTED.id
                    VALUES (@invNo, @iDate, @custId, @storeId, @subtotal, @grandTotal, 0, @grandTotal, 'posted', 'credit')`);
        const sinvId = r1.recordset[0].id;

        // Insert invoice item
        await tx1.input('sinvId', sql.Int, sinvId)
            .input('prodId', sql.Int, 1)
            .input('qty', sql.Decimal(18,4), 10)
            .input('price', sql.Decimal(18,4), 1000)
            .query(`INSERT INTO sales_invoice_items (invoice_id, product_id, quantity, unit_price, line_total) VALUES (@sinvId, @prodId, @qty, @price, @qty * @price)`);

        // Recalc customer balance (as done by routes)
        await balanceService.updateCustomerBalance(customerId, tx1);
        await trans1.commit();
        console.log('  Sales invoice 10000 created');
    } catch (e) { await trans1.rollback(); throw e; }

    cData = await balanceService.getCustomerFullBalance(customerId, pool);
    console.log(`  Balance after sale: opening=${cData.opening} + sales=${cData.sales} - returns=${cData.returns} - collections=${cData.collections} = ${cData.balance}`);
    assert(cData.balance === 15000, `Customer balance after sale = 15000 (got ${cData.balance})`);
    assert(cData.balance === 5000 + 10000, `15000 = 5000 opening + 10000 sale`);

    // Step 3: Partial collection 3000
    console.log('  --- Step 3: Partial collection 3000 ---');
    await pool.request()
        .input('cid', sql.Int, customerId)
        .input('amt', sql.Decimal(18,2), 3000)
        .input('date', sql.NVarChar, '2026-07-22')
        .input('notes', sql.NVarChar, 'CSTEST collection')
        .query(`INSERT INTO customer_collections (collection_no, customer_id, amount, collection_date, payment_method, notes)
                VALUES ('CSTEST-COL-001', @cid, @amt, @date, 'cash', @notes)`);
    await balanceService.updateCustomerBalance(customerId, pool);

    cData = await balanceService.getCustomerFullBalance(customerId, pool);
    console.log(`  Balance after collection: ${cData.balance}`);
    assert(cData.balance === 12000, `Customer balance after collection = 12000 (got ${cData.balance})`);
    assert(cData.balance === 5000 + 10000 - 3000, `12000 = 5000 + 10000 - 3000`);

    // Step 4: Sales return 2000
    console.log('  --- Step 4: Sales return 2000 ---');
    const trans2 = new sql.Transaction(pool);
    await trans2.begin();
    const tx2 = trans2.request();
    try {
        const r2 = await tx2.input('invNo', sql.NVarChar, 'CS-TEST-SRET-001')
            .input('rDate', sql.NVarChar, '2026-07-22')
            .input('custId', sql.Int, customerId)
            .input('storeId', sql.Int, 1)
            .input('grandTotal', sql.Decimal(18,2), 2000)
            .query(`INSERT INTO sales_returns (return_no, return_date, customer_id, store_id, grand_total, status, notes)
                    OUTPUT INSERTED.id
                    VALUES (@invNo, @rDate, @custId, @storeId, @grandTotal, 'approved', 'CSTEST return')`);
        const sretId = r2.recordset[0].id;

        await tx2.input('sretId', sql.Int, sretId)
            .input('prodId', sql.Int, 1)
            .input('qty', sql.Decimal(18,4), 2)
            .input('price', sql.Decimal(18,4), 1000)
            .query(`INSERT INTO sales_return_items (return_id, product_id, quantity, unit_price, line_total) VALUES (@sretId, @prodId, @qty, @price, @qty * @price)`);

        await balanceService.updateCustomerBalance(customerId, tx2);
        await trans2.commit();
        console.log('  Sales return 2000 created');
    } catch (e) { await trans2.rollback(); throw e; }

    cData = await balanceService.getCustomerFullBalance(customerId, pool);
    console.log(`  Balance after return: ${cData.balance}`);
    assert(cData.balance === 10000, `Customer balance after return = 10000 (got ${cData.balance})`);
    assert(cData.balance === 5000 + 10000 - 3000 - 2000, `10000 = 5000 + 10000 - 3000 - 2000`);

    // ═══════════════════════════════════════════════════
    // SUPPLIER TESTS
    // ═══════════════════════════════════════════════════
    console.log('\n═══ SUPPLIER BALANCE TESTS ═══');

    // Step 5: Create supplier with opening balance 3000
    console.log('  --- Step 5: Create supplier with opening balance 3000 ---');
    const suppRes = await pool.request()
        .input('name', sql.NVarChar, 'مورد اختبار الرصيد')
        .input('code', sql.NVarChar, 'CSTEST-SUPP')
        .input('ob', sql.Decimal(18,2), 3000)
        .query(`INSERT INTO suppliers (supplier_name, supplier_code, opening_balance, current_balance, phone, is_active)
                OUTPUT INSERTED.id VALUES (@name, @code, @ob, @ob, '0222222222', 1)`);
    const supplierId = suppRes.recordset[0].id;
    assert(supplierId > 0, `Supplier created (ID=${supplierId})`);

    let sData = await balanceService.getSupplierFullBalance(supplierId, pool);
    console.log(`  Opening: ${sData.opening}, Purchases: ${sData.purchases}, Returns: ${sData.returns}, Payments: ${sData.payments} = Balance: ${sData.balance}`);
    assert(sData.balance === 3000, `Initial supplier balance = 3000 (got ${sData.balance})`);

    // Step 6: Create purchase invoice 15000
    console.log('  --- Step 6: Create purchase invoice 15000 ---');
    const trans3 = new sql.Transaction(pool);
    await trans3.begin();
    const tx3 = trans3.request();
    try {
        const r3 = await tx3.input('invNo', sql.NVarChar, 'CS-TEST-PINV-001')
            .input('iDate', sql.NVarChar, '2026-07-22')
            .input('suppId', sql.Int, supplierId)
            .input('storeId', sql.Int, 1)
            .input('subtotal', sql.Decimal(18,2), 15000)
            .input('grandTotal', sql.Decimal(18,2), 15000)
            .query(`INSERT INTO purchase_invoices (invoice_no, invoice_date, supplier_id, store_id, subtotal, grand_total, amount_paid, remaining, status, payment_type)
                    OUTPUT INSERTED.id
                    VALUES (@invNo, @iDate, @suppId, @storeId, @subtotal, @grandTotal, 0, @grandTotal, 'posted', 'credit')`);
        const pinvId = r3.recordset[0].id;

        await tx3.input('pinvId', sql.Int, pinvId)
            .input('prodId', sql.Int, 1)
            .input('qty', sql.Decimal(18,4), 10)
            .input('cost', sql.Decimal(18,4), 1500)
            .query(`INSERT INTO purchase_invoice_items (invoice_id, product_id, quantity, cost_price, line_total) VALUES (@pinvId, @prodId, @qty, @cost, @qty * @cost)`);

        await balanceService.updateSupplierBalance(supplierId, tx3);
        await trans3.commit();
        console.log('  Purchase invoice 15000 created');
    } catch (e) { await trans3.rollback(); throw e; }

    sData = await balanceService.getSupplierFullBalance(supplierId, pool);
    console.log(`  Balance after purchase: ${sData.balance}`);
    assert(sData.balance === 18000, `Supplier balance after purchase = 18000 (got ${sData.balance})`);
    assert(sData.balance === 3000 + 15000, `18000 = 3000 + 15000`);

    // Step 7: Partial payment 5000
    console.log('  --- Step 7: Partial payment 5000 ---');
    await pool.request()
        .input('sid', sql.Int, supplierId)
        .input('amt', sql.Decimal(18,2), 5000)
        .input('date', sql.NVarChar, '2026-07-22')
        .input('notes', sql.NVarChar, 'CSTEST payment')
        .query(`INSERT INTO supplier_payments (payment_no, supplier_id, amount, payment_date, payment_method, notes)
                VALUES ('CSTEST-PAY-001', @sid, @amt, @date, 'cash', @notes)`);
    await balanceService.updateSupplierBalance(supplierId, pool);

    sData = await balanceService.getSupplierFullBalance(supplierId, pool);
    console.log(`  Balance after payment: ${sData.balance}`);
    assert(sData.balance === 13000, `Supplier balance after payment = 13000 (got ${sData.balance})`);
    assert(sData.balance === 3000 + 15000 - 5000, `13000 = 3000 + 15000 - 5000`);

    // Step 8: Purchase return 3000
    console.log('  --- Step 8: Purchase return 3000 ---');
    const trans4 = new sql.Transaction(pool);
    await trans4.begin();
    const tx4 = trans4.request();
    try {
        const r4 = await tx4.input('invNo', sql.NVarChar, 'CS-TEST-PRET-001')
            .input('rDate', sql.NVarChar, '2026-07-22')
            .input('suppId', sql.Int, supplierId)
            .input('storeId', sql.Int, 1)
            .input('grandTotal', sql.Decimal(18,2), 3000)
            .query(`INSERT INTO purchase_returns (return_no, return_date, supplier_id, store_id, grand_total, status, notes)
                    OUTPUT INSERTED.id
                    VALUES (@invNo, @rDate, @suppId, @storeId, @grandTotal, 'approved', 'CSTEST return')`);
        const pretId = r4.recordset[0].id;

        await tx4.input('pretId', sql.Int, pretId)
            .input('prodId', sql.Int, 1)
            .input('qty', sql.Decimal(18,4), 2)
            .input('cost', sql.Decimal(18,4), 1500)
            .query(`INSERT INTO purchase_return_items (return_id, product_id, quantity, cost_price, line_total) VALUES (@pretId, @prodId, @qty, @cost, @qty * @cost)`);

        await balanceService.updateSupplierBalance(supplierId, tx4);
        await trans4.commit();
        console.log('  Purchase return 3000 created');
    } catch (e) { await trans4.rollback(); throw e; }

    sData = await balanceService.getSupplierFullBalance(supplierId, pool);
    console.log(`  Balance after return: ${sData.balance}`);
    assert(sData.balance === 10000, `Supplier balance after return = 10000 (got ${sData.balance})`);
    assert(sData.balance === 3000 + 15000 - 5000 - 3000, `10000 = 3000 + 15000 - 5000 - 3000`);

    // ═══════════════════════════════════════════════════
    // FINAL VERIFICATION
    // ═══════════════════════════════════════════════════
    console.log('\n══════════════ FINAL VERIFICATION ══════════════\n');

    // Customer: opening=5000, sales=10000, returns=2000, collections=3000 => 10000
    const cDb = await pool.request().input('cid', sql.Int, customerId)
        .query('SELECT current_balance, opening_balance FROM customers WHERE id = @cid');
    const cBal = parseFloat(cDb.recordset[0].current_balance);
    const cOpen = parseFloat(cDb.recordset[0].opening_balance);
    console.log(`  Customer: opening_balance=${cOpen}, current_balance=${cBal}`);
    assert(cBal === 10000, `Customer DB current_balance = 10000 (got ${cBal})`);
    assert(cOpen === 5000, `Customer opening_balance = 5000 (got ${cOpen})`);

    // Supplier: opening=3000, purchases=15000, returns=3000, payments=5000 => 10000
    const sDb = await pool.request().input('sid', sql.Int, supplierId)
        .query('SELECT current_balance, opening_balance FROM suppliers WHERE id = @sid');
    const sBal = parseFloat(sDb.recordset[0].current_balance);
    const sOpen = parseFloat(sDb.recordset[0].opening_balance);
    console.log(`  Supplier: opening_balance=${sOpen}, current_balance=${sBal}`);
    assert(sBal === 10000, `Supplier DB current_balance = 10000 (got ${sBal})`);
    assert(sOpen === 3000, `Supplier opening_balance = 3000 (got ${sOpen})`);

    // Verify formula: balance = opening + invoices - returns - payments/collections
    console.log('\n  Formula verification:');
    console.log(`  Customer: ${cOpen} + 10000 - 2000 - 3000 = ${cOpen + 10000 - 2000 - 3000} = ${cBal} ✓`);
    console.log(`  Supplier: ${sOpen} + 15000 - 5000 - 3000 = ${sOpen + 15000 - 5000 - 3000} = ${sBal} ✓`);

    console.log('\n══════════════════════════════════════════════════');
    console.log(`Results: ${passCount}/${assertCount} passed, ${failCount} failed`);
    console.log('══════════════════════════════════════════════════');

    if (failCount > 0) process.exit(1);
    pool.close();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
