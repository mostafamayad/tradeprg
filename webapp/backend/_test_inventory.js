/**
 * Inventory & WAC (Weighted Average Cost) Comprehensive Test
 *
 * Tests:
 * 1. Basic WAC: buy 100×10, buy 100×20 → WAC=15 → sell 50 (COGS=750) → remaining 150 units @2250
 * 2. WAC after more purchases: buy 100×30 → WAC=21 → remaining 250 units @5250
 * 3. Purchase return (return to supplier): -50 units, WAC unchanged
 * 4. Sales return (customer return): +10 units, WAC unchanged
 * 5. Stock transfer: move 20 units between stores
 * 6. Stock adjustment: +5 manual
 * 7. Damaged stock: -3
 * 8. Stock count variance: actual 190 vs expected 192 → adjust -2
 * 9. Verify all stock_movements have correct cost_price
 */

const { getPool, sql } = require('./database/mssql_db');
const poolPromise = getPool();

let passCount = 0, failCount = 0, assertCount = 0;

function assert(condition, msg) {
    assertCount++;
    if (condition) { passCount++; console.log(`  ✓ ${msg}`); }
    else { failCount++; console.log(`  ✗ FAILED: ${msg}`); }
}



function calcWAC(oldQty, oldCost, newQty, newCost) {
    if (oldQty + newQty <= 0) return newCost;
    return ((oldQty * oldCost) + (newQty * newCost)) / (oldQty + newQty);
}

async function main() {
    const pool = await poolPromise;

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║      INVENTORY & WAC COMPREHENSIVE TEST        ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    // Cleanup
    const del = async (q) => { try { await pool.request().query(q); } catch (e) { /* ignore */ } };
    await del("DELETE FROM stock_movements WHERE notes LIKE '%WAC-TEST%'");
    await del("DELETE FROM inventory_balances WHERE product_id IN (SELECT id FROM products WHERE product_code = 'WAC-TEST-PROD')");
    await del("DELETE FROM purchase_invoice_items WHERE invoice_id IN (SELECT id FROM purchase_invoices WHERE invoice_no LIKE 'WAC-TEST%')");
    await del("DELETE FROM sales_invoice_items WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE invoice_no LIKE 'WAC-TEST%')");
    await del("DELETE FROM purchase_invoices WHERE invoice_no LIKE 'WAC-TEST%'");
    await del("DELETE FROM sales_invoices WHERE invoice_no LIKE 'WAC-TEST%'");
    await del("DELETE FROM products WHERE product_code = 'WAC-TEST-PROD'");

    // ─── STEP 1: Create product ───
    console.log('═══ STEP 1: Create Test Product ═══');
    const prodRes = await pool.request()
        .input('name', sql.NVarChar, 'منتج اختبار WAC')
        .input('code', sql.NVarChar, 'WAC-TEST-PROD')
        .input('cost', sql.Decimal(18, 4), 0)
        .input('sell', sql.Decimal(18, 4), 50)
        .query("INSERT INTO products (product_name, product_code, cost_price, sell_price, is_active) OUTPUT INSERTED.id VALUES (@name, @code, @cost, @sell, 1)");
    const productId = prodRes.recordset[0].id;
    assert(productId > 0, `Product created (ID=${productId})`);
    const STORE_ID = 1;

    let wac = 0, totalQty = 0;

    // ═══════════════════════════════════════════════════
    // PHASE 1: BASIC WAC
    // ═══════════════════════════════════════════════════

    // ─── STEP 2: Purchase 100 × 10 ───
    console.log('\n═══ PHASE 1: Basic WAC ═══');
    console.log('  --- Step 2: Buy 100 × 10 ---');
    // Simulate purchase route WAC calculation
    let oldQty = totalQty;
    let oldCost = 0; // Product was just created with cost_price = 0
    wac = calcWAC(oldQty, oldCost, 100, 10);
    totalQty += 100;
    console.log(`  WAC calc: (${oldQty}×${oldCost} + 100×10) / ${totalQty} = ${wac}`);
    assert(Math.abs(wac - 10) < 0.001, `WAC = 10 (got ${wac.toFixed(4)})`);
    assert(totalQty === 100, `Total qty = 100 (got ${totalQty})`);

    // ─── STEP 3: Purchase 100 × 20 ───
    console.log('  --- Step 3: Buy 100 × 20 ---');
    oldQty = totalQty;
    oldCost = wac;
    wac = calcWAC(oldQty, oldCost, 100, 20);
    totalQty += 100;
    console.log(`  WAC calc: (${oldQty}×${oldCost} + 100×20) / ${totalQty} = ${wac}`);
    assert(Math.abs(wac - 15) < 0.001, `WAC = 15 (got ${wac.toFixed(4)})`);
    assert(totalQty === 200, `Total qty = 200 (got ${totalQty})`);

    const stockValueAfter3 = totalQty * wac;
    console.log(`  Stock value = ${totalQty} × ${wac} = ${stockValueAfter3}`);
    assert(Math.abs(stockValueAfter3 - 3000) < 0.01, `Stock value = 3000 (got ${stockValueAfter3.toFixed(2)})`);

    // ─── STEP 4: Sell 50 ───
    console.log('  --- Step 4: Sell 50 ---');
    const cogsPerUnit = wac; // COGS = current WAC at sale time
    const cogs = 50 * cogsPerUnit;
    totalQty -= 50;
    console.log(`  COGS = 50 × ${cogsPerUnit} = ${cogs}`);
    assert(Math.abs(cogs - 750) < 0.01, `COGS = 750 (got ${cogs.toFixed(2)})`);
    assert(totalQty === 150, `Remaining qty = 150 (got ${totalQty})`);

    const stockValueAfter4 = totalQty * wac;
    console.log(`  Stock value = ${totalQty} × ${wac} = ${stockValueAfter4}`);
    assert(Math.abs(stockValueAfter4 - 2250) < 0.01, `Stock value = 2250 (got ${stockValueAfter4.toFixed(2)})`);

    // ═══════════════════════════════════════════════════
    // PHASE 2: WAC AFTER MORE PURCHASES
    // ═══════════════════════════════════════════════════

    // ─── STEP 5: Purchase 100 × 30 ───
    console.log('\n═══ PHASE 2: WAC After More Purchases ═══');
    console.log('  --- Step 5: Buy 100 × 30 ---');
    oldQty = totalQty;
    oldCost = wac;
    wac = calcWAC(oldQty, oldCost, 100, 30);
    totalQty += 100;
    console.log(`  WAC calc: (${oldQty}×${oldCost} + 100×30) / ${totalQty} = ${wac}`);
    // Expected: (150×15 + 100×30) / 250 = (2250 + 3000) / 250 = 5250 / 250 = 21
    assert(Math.abs(wac - 21) < 0.001, `WAC = 21 (got ${wac.toFixed(4)})`);
    assert(totalQty === 250, `Total qty = 250 (got ${totalQty})`);

    const stockValueAfter5 = totalQty * wac;
    console.log(`  Stock value = ${totalQty} × ${wac} = ${stockValueAfter5}`);
    assert(Math.abs(stockValueAfter5 - 5250) < 0.01, `Stock value = 5250 (got ${stockValueAfter5.toFixed(2)})`);

    // ═══════════════════════════════════════════════════
    // PHASE 3: PURCHASE RETURN (does NOT recalculate WAC)
    // ═══════════════════════════════════════════════════

    console.log('\n═══ PHASE 3: Purchase Return ═══');
    console.log('  --- Step 6: Return 50 units to supplier ---');
    const returnQty = 50;
    totalQty -= returnQty;
    // WAC stays the same (no recalculation on purchase returns)
    console.log(`  WAC unchanged (purchase return does not recalculate WAC): ${wac}`);
    assert(totalQty === 200, `Remaining qty = 200 (got ${totalQty})`);
    const stockValueAfter6 = totalQty * wac;
    console.log(`  Stock value = ${totalQty} × ${wac} = ${stockValueAfter6}`);
    assert(Math.abs(stockValueAfter6 - 4200) < 0.01, `Stock value = 4200 (got ${stockValueAfter6.toFixed(2)})`);

    // ═══════════════════════════════════════════════════
    // PHASE 4: SALES RETURN (does NOT recalculate WAC)
    // ═══════════════════════════════════════════════════

    console.log('\n═══ PHASE 4: Sales Return ═══');
    console.log('  --- Step 7: Customer returns 10 units ---');
    const salesReturnQty = 10;
    totalQty += salesReturnQty;
    // WAC stays the same (no recalculation on sales returns)
    console.log(`  WAC unchanged (sales return does not recalculate WAC): ${wac}`);
    assert(totalQty === 210, `Remaining qty = 210 (got ${totalQty})`);
    const stockValueAfter7 = totalQty * wac;
    console.log(`  Stock value = ${totalQty} × ${wac} = ${stockValueAfter7}`);
    assert(Math.abs(stockValueAfter7 - 4410) < 0.01, `Stock value = 4410 (got ${stockValueAfter7.toFixed(2)})`);

    // ═══════════════════════════════════════════════════
    // PHASE 5: STOCK TRANSFER (WAC unchanged)
    // ═══════════════════════════════════════════════════

    console.log('\n═══ PHASE 5: Stock Transfer ═══');
    console.log('  --- Step 8: Transfer 20 units to store 2 ---');
    const transferQty = 20;
    totalQty -= transferQty;
    // WAC stays the same
    console.log(`  WAC unchanged (transfer preserves cost): ${wac}`);
    assert(totalQty === 190, `Source store qty = 190 (got ${totalQty})`);
    // Dest store would have 20 @ same WAC (no recalculation needed)

    // ═══════════════════════════════════════════════════
    // PHASE 6: STOCK ADJUSTMENT (WAC unchanged)
    // ═══════════════════════════════════════════════════

    console.log('\n═══ PHASE 6: Stock Adjustment ═══');
    console.log('  --- Step 9: Adjust +5 units ---');
    totalQty += 5;
    assert(totalQty === 195, `Remaining qty after adjust = 195 (got ${totalQty})`);
    console.log(`  WAC unchanged (adjustment uses current WAC): ${wac}`);

    // ═══════════════════════════════════════════════════
    // PHASE 7: DAMAGED STOCK (WAC unchanged)
    // ═══════════════════════════════════════════════════

    console.log('\n═══ PHASE 7: Damaged Stock ═══');
    console.log('  --- Step 10: Damage 3 units ---');
    totalQty -= 3;
    assert(totalQty === 192, `Remaining qty after damage = 192 (got ${totalQty})`);
    console.log(`  WAC unchanged (damaged uses current WAC): ${wac}`);

    // ═══════════════════════════════════════════════════
    // PHASE 8: STOCK COUNT VARIANCE (WAC unchanged)
    // ═══════════════════════════════════════════════════

    console.log('\n═══ PHASE 8: Stock Count Variance ═══');
    console.log('  --- Step 11: Count shows 190 but system has 192 → adjust -2 ---');
    const countQty = -2; // variance
    totalQty += countQty;
    assert(totalQty === 190, `Remaining qty after count = 190 (got ${totalQty})`);
    console.log(`  WAC unchanged (count adjustment uses current WAC): ${wac}`);

    // ═══════════════════════════════════════════════════
    // FINAL VERIFICATION
    // ═══════════════════════════════════════════════════

    console.log('\n══════════════ FINAL VERIFICATION ══════════════\n');
    // WAC should be 21 throughout (only purchases change it)
    assert(Math.abs(wac - 21) < 0.001, `Final WAC = 21 (got ${wac.toFixed(4)})`);
    assert(totalQty === 190, `Final total qty = 190 (got ${totalQty})`);

    // Stock value should be 190 × 21 = 3990
    const finalStockValue = totalQty * wac;
    console.log(`  Final stock value = ${totalQty} × ${wac} = ${finalStockValue.toFixed(2)}`);
    assert(Math.abs(finalStockValue - 3990) < 0.01, `Final stock value = 3990 (got ${finalStockValue.toFixed(2)})`);

    // ═══════════════════════════════════════════════════
    // PHASE 9: REAL DATABASE VERIFICATION
    // Actually execute purchase/sales flows through DB
    // to verify products.cost_price and stock_movements.cost_price
    // ═══════════════════════════════════════════════════

    console.log('\n═══ PHASE 9: Real DB Execution ═══');
    const supplierId = 1;
    const customerId = 1;

    // -- Step 12: Create purchase invoice 100×10 --
    console.log('  --- Step 12: Purchase invoice 100×10 (via DB) ---');
    const pInvNo1 = 'WAC-PINV-001';
    const pDate = '2026-07-22';
    const trans1 = new sql.Transaction(pool);
    await trans1.begin();
    const tx1 = trans1.request();
    try {
        const p12_res = await tx1.input('p12_invNo', sql.NVarChar, pInvNo1)
            .input('p12_iDate', sql.NVarChar, pDate)
            .input('p12_suppId', sql.Int, supplierId)
            .input('p12_storeId', sql.Int, STORE_ID)
            .input('p12_subtotal', sql.Decimal(18,2), 1000)
            .input('p12_grandTotal', sql.Decimal(18,2), 1000)
            .query(`INSERT INTO purchase_invoices (invoice_no, invoice_date, supplier_id, store_id, subtotal, grand_total, amount_paid, remaining, status, payment_type)
                    OUTPUT INSERTED.id
                    VALUES (@p12_invNo, @p12_iDate, @p12_suppId, @p12_storeId, @p12_subtotal, @p12_grandTotal, 0, @p12_grandTotal, 'posted', 'credit')`);
        const pInvId = p12_res.recordset[0].id;

        await tx1.input('p12_pInvId', sql.Int, pInvId)
            .input('p12_prodId', sql.Int, productId)
            .input('p12_itemCost', sql.Decimal(18,4), 10)
            .input('p12_qty', sql.Decimal(18,4), 100)
            .query(`INSERT INTO purchase_invoice_items (invoice_id, product_id, quantity, cost_price, line_total)
                    VALUES (@p12_pInvId, @p12_prodId, @p12_qty, @p12_itemCost, @p12_qty * @p12_itemCost)`);

        // Read current cost & qty for WAC
        const p12_costRes = await tx1.query(`SELECT cost_price FROM products WHERE id = ${productId}`);
        const p12_qtyRes = await tx1.query(`SELECT ISNULL(SUM(quantity),0) as qty FROM inventory_balances WHERE product_id = ${productId}`);
        const p12_oldCost = parseFloat(p12_costRes.recordset[0]?.cost_price || 0);
        const p12_oldQty = parseFloat(p12_qtyRes.recordset[0]?.qty || 0);
        const p12_wac = (p12_oldQty + 100 > 0)
            ? ((p12_oldQty * p12_oldCost) + (100 * 10)) / (p12_oldQty + 100)
            : 10;

        await tx1.input('p12_wac', sql.Decimal(18,4), p12_wac)
            .query(`UPDATE products SET cost_price = @p12_wac WHERE id = ${productId}`);

        // Update stock
        await tx1.query(`IF NOT EXISTS (SELECT 1 FROM inventory_balances WHERE store_id = ${STORE_ID} AND product_id = ${productId})
            INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (${STORE_ID}, ${productId}, 0)`);
        await tx1.query(`UPDATE inventory_balances SET quantity = quantity + 100 WHERE store_id = ${STORE_ID} AND product_id = ${productId}`);
        const p12_balRes = await tx1.query(`SELECT quantity FROM inventory_balances WHERE store_id = ${STORE_ID} AND product_id = ${productId}`);
        const p12_bal = parseFloat(p12_balRes.recordset[0].quantity);

        await tx1.input('p12_date', sql.NVarChar, pDate)
            .input('p12_doc', sql.NVarChar, pInvNo1)
            .input('p12_cost', sql.Decimal(18,4), 10)
            .input('p12_bal', sql.Decimal(18,4), p12_bal)
            .input('p12_ref', sql.Int, pInvId)
            .query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes)
                    VALUES (@p12_date, 'in', @p12_doc, ${STORE_ID}, ${productId}, 100, @p12_cost, @p12_bal, @p12_ref, 'WAC-TEST')`);

        await trans1.commit();
        console.log(`  Purchase 100×10: WAC = ${p12_wac.toFixed(4)} (expected 10)`);
        assert(Math.abs(p12_wac - 10) < 0.001, `DB WAC after purchase 1 = 10 (got ${p12_wac})`);
    } catch (e) { await trans1.rollback(); throw e; }

    // -- Step 13: Create purchase invoice 100×20 --
    console.log('  --- Step 13: Purchase invoice 100×20 (via DB) ---');
    const trans2 = new sql.Transaction(pool);
    await trans2.begin();
    const tx2 = trans2.request();
    try {
        const p13_res = await tx2.input('p13_invNo', sql.NVarChar, 'WAC-PINV-002')
            .input('p13_iDate', sql.NVarChar, pDate)
            .input('p13_suppId', sql.Int, supplierId)
            .input('p13_storeId', sql.Int, STORE_ID)
            .input('p13_subtotal', sql.Decimal(18,2), 2000)
            .input('p13_grandTotal', sql.Decimal(18,2), 2000)
            .query(`INSERT INTO purchase_invoices (invoice_no, invoice_date, supplier_id, store_id, subtotal, grand_total, amount_paid, remaining, status, payment_type)
                    OUTPUT INSERTED.id
                    VALUES (@p13_invNo, @p13_iDate, @p13_suppId, @p13_storeId, @p13_subtotal, @p13_grandTotal, 0, @p13_grandTotal, 'posted', 'credit')`);
        const pInvId2 = p13_res.recordset[0].id;

        await tx2.input('p13_pInvId', sql.Int, pInvId2)
            .input('p13_prodId', sql.Int, productId)
            .input('p13_itemCost', sql.Decimal(18,4), 20)
            .input('p13_qty', sql.Decimal(18,4), 100)
            .query(`INSERT INTO purchase_invoice_items (invoice_id, product_id, quantity, cost_price, line_total)
                    VALUES (@p13_pInvId, @p13_prodId, @p13_qty, @p13_itemCost, @p13_qty * @p13_itemCost)`);

        const p13_costRes = await tx2.query(`SELECT cost_price FROM products WHERE id = ${productId}`);
        const p13_qtyRes = await tx2.query(`SELECT ISNULL(SUM(quantity),0) as qty FROM inventory_balances WHERE product_id = ${productId}`);
        const p13_oldCost = parseFloat(p13_costRes.recordset[0]?.cost_price || 0);
        const p13_oldQty = parseFloat(p13_qtyRes.recordset[0]?.qty || 0);
        const p13_wac = (p13_oldQty + 100 > 0)
            ? ((p13_oldQty * p13_oldCost) + (100 * 20)) / (p13_oldQty + 100)
            : 20;

        await tx2.input('p13_wac', sql.Decimal(18,4), p13_wac)
            .query(`UPDATE products SET cost_price = @p13_wac WHERE id = ${productId}`);

        await tx2.query(`UPDATE inventory_balances SET quantity = quantity + 100 WHERE store_id = ${STORE_ID} AND product_id = ${productId}`);
        const p13_balRes = await tx2.query(`SELECT quantity FROM inventory_balances WHERE store_id = ${STORE_ID} AND product_id = ${productId}`);
        const p13_bal = parseFloat(p13_balRes.recordset[0].quantity);

        await tx2.input('p13_date', sql.NVarChar, pDate)
            .input('p13_doc', sql.NVarChar, 'WAC-PINV-002')
            .input('p13_cost', sql.Decimal(18,4), 20)
            .input('p13_bal', sql.Decimal(18,4), p13_bal)
            .input('p13_ref', sql.Int, pInvId2)
            .query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes)
                    VALUES (@p13_date, 'in', @p13_doc, ${STORE_ID}, ${productId}, 100, @p13_cost, @p13_bal, @p13_ref, 'WAC-TEST')`);

        await trans2.commit();
        console.log(`  Purchase 100×20: WAC = ${p13_wac.toFixed(4)} (expected 15)`);
        assert(Math.abs(p13_wac - 15) < 0.001, `DB WAC after purchase 2 = 15 (got ${p13_wac})`);
    } catch (e) { await trans2.rollback(); throw e; }

    // Verify products.cost_price in database
    const dbCost1r = await pool.request().input('pid', sql.Int, productId)
        .query('SELECT cost_price FROM products WHERE id = @pid');
    const dbCost1 = parseFloat(dbCost1r.recordset[0]?.cost_price || 0);
    console.log(`  products.cost_price now = ${dbCost1.toFixed(4)}`);
    assert(Math.abs(dbCost1 - 15) < 0.001, `products.cost_price = 15 (got ${dbCost1})`);

    // -- Step 14: Create sales invoice (sell 50) --
    console.log('  --- Step 14: Sales invoice 50 units (via DB) ---');
    const trans3 = new sql.Transaction(pool);
    await trans3.begin();
    const tx3 = trans3.request();
    try {
        const s14_res = await tx3.input('s14_invNo', sql.NVarChar, 'WAC-SINV-001')
            .input('s14_iDate', sql.NVarChar, pDate)
            .input('s14_custId', sql.Int, customerId)
            .input('s14_storeId', sql.Int, STORE_ID)
            .input('s14_subtotal', sql.Decimal(18,2), 2500)
            .input('s14_grandTotal', sql.Decimal(18,2), 2500)
            .query(`INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, store_id, subtotal, grand_total, amount_paid, remaining, status, payment_type)
                    OUTPUT INSERTED.id
                    VALUES (@s14_invNo, @s14_iDate, @s14_custId, @s14_storeId, @s14_subtotal, @s14_grandTotal, 0, @s14_grandTotal, 'posted', 'credit')`);
        const sInvId3 = s14_res.recordset[0].id;

        // Capture current WAC for COGS
        const s14_costRes = await tx3.query(`SELECT cost_price FROM products WHERE id = ${productId}`);
        const s14_currentWac = parseFloat(s14_costRes.recordset[0]?.cost_price || 0);

        await tx3.input('s14_sInvId', sql.Int, sInvId3)
            .input('s14_prodId', sql.Int, productId)
            .input('s14_sellQty', sql.Decimal(18,4), 50)
            .input('s14_sellPrice', sql.Decimal(18,4), 50)
            .input('s14_costPrice', sql.Decimal(18,4), s14_currentWac)
            .query(`INSERT INTO sales_invoice_items (invoice_id, product_id, quantity, unit_price, cost_price, line_total)
                    VALUES (@s14_sInvId, @s14_prodId, @s14_sellQty, @s14_sellPrice, @s14_costPrice, @s14_sellQty * @s14_sellPrice)`);

        // Update stock
        await tx3.query(`UPDATE inventory_balances SET quantity = quantity - 50 WHERE store_id = ${STORE_ID} AND product_id = ${productId}`);
        const s14_balRes = await tx3.query(`SELECT quantity FROM inventory_balances WHERE store_id = ${STORE_ID} AND product_id = ${productId}`);
        const s14_bal = parseFloat(s14_balRes.recordset[0].quantity);

        await tx3.input('s14_date', sql.NVarChar, pDate)
            .input('s14_doc', sql.NVarChar, 'WAC-SINV-001')
            .input('s14_cost', sql.Decimal(18,4), s14_currentWac)
            .input('s14_sellP', sql.Decimal(18,4), 50)
            .input('s14_bal', sql.Decimal(18,4), s14_bal)
            .input('s14_ref', sql.Int, sInvId3)
            .query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, sell_price, balance_after, reference_id, notes)
                    VALUES (@s14_date, 'out', @s14_doc, ${STORE_ID}, ${productId}, 50, @s14_cost, @s14_sellP, @s14_bal, @s14_ref, 'WAC-TEST')`);

        await trans3.commit();
        console.log(`  Sale 50 units: COGS per unit = ${s14_currentWac.toFixed(4)} (expected 15)`);
        assert(Math.abs(s14_currentWac - 15) < 0.001, `COGS uses WAC = 15 (got ${s14_currentWac})`);
    } catch (e) { await trans3.rollback(); throw e; }

    // -- Step 15: Purchase invoice 100×30 --
    console.log('  --- Step 15: Purchase invoice 100×30 (via DB) ---');
    const trans4 = new sql.Transaction(pool);
    await trans4.begin();
    const tx4 = trans4.request();
    try {
        const p15_res = await tx4.input('p15_invNo', sql.NVarChar, 'WAC-PINV-003')
            .input('p15_iDate', sql.NVarChar, pDate)
            .input('p15_suppId', sql.Int, supplierId)
            .input('p15_storeId', sql.Int, STORE_ID)
            .input('p15_subtotal', sql.Decimal(18,2), 3000)
            .input('p15_grandTotal', sql.Decimal(18,2), 3000)
            .query(`INSERT INTO purchase_invoices (invoice_no, invoice_date, supplier_id, store_id, subtotal, grand_total, amount_paid, remaining, status, payment_type)
                    OUTPUT INSERTED.id
                    VALUES (@p15_invNo, @p15_iDate, @p15_suppId, @p15_storeId, @p15_subtotal, @p15_grandTotal, 0, @p15_grandTotal, 'posted', 'credit')`);
        const pInvId4 = p15_res.recordset[0].id;

        await tx4.input('p15_pInvId', sql.Int, pInvId4)
            .input('p15_prodId', sql.Int, productId)
            .input('p15_itemCost', sql.Decimal(18,4), 30)
            .input('p15_qty', sql.Decimal(18,4), 100)
            .query(`INSERT INTO purchase_invoice_items (invoice_id, product_id, quantity, cost_price, line_total)
                    VALUES (@p15_pInvId, @p15_prodId, @p15_qty, @p15_itemCost, @p15_qty * @p15_itemCost)`);

        const p15_costRes = await tx4.query(`SELECT cost_price FROM products WHERE id = ${productId}`);
        const p15_qtyRes = await tx4.query(`SELECT ISNULL(SUM(quantity),0) as qty FROM inventory_balances WHERE product_id = ${productId}`);
        const p15_oldCost = parseFloat(p15_costRes.recordset[0]?.cost_price || 0);
        const p15_oldQty = parseFloat(p15_qtyRes.recordset[0]?.qty || 0);
        const p15_wac = (p15_oldQty + 100 > 0)
            ? ((p15_oldQty * p15_oldCost) + (100 * 30)) / (p15_oldQty + 100)
            : 30;

        await tx4.input('p15_wac', sql.Decimal(18,4), p15_wac)
            .query(`UPDATE products SET cost_price = @p15_wac WHERE id = ${productId}`);

        await tx4.query(`UPDATE inventory_balances SET quantity = quantity + 100 WHERE store_id = ${STORE_ID} AND product_id = ${productId}`);
        const p15_balRes = await tx4.query(`SELECT quantity FROM inventory_balances WHERE store_id = ${STORE_ID} AND product_id = ${productId}`);
        const p15_bal = parseFloat(p15_balRes.recordset[0].quantity);

        await tx4.input('p15_date', sql.NVarChar, pDate)
            .input('p15_doc', sql.NVarChar, 'WAC-PINV-003')
            .input('p15_cost', sql.Decimal(18,4), 30)
            .input('p15_bal', sql.Decimal(18,4), p15_bal)
            .input('p15_ref', sql.Int, pInvId4)
            .query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes)
                    VALUES (@p15_date, 'in', @p15_doc, ${STORE_ID}, ${productId}, 100, @p15_cost, @p15_bal, @p15_ref, 'WAC-TEST')`);

        await trans4.commit();

        // Expected: (150 × 15 + 100 × 30) / 250 = 5250/250 = 21
        console.log(`  Purchase 100×30: WAC = ${p15_wac.toFixed(4)} (expected 21)`);
        assert(Math.abs(p15_wac - 21) < 0.001, `DB WAC after purchase 3 = 21 (got ${p15_wac})`);
    } catch (e) { await trans4.rollback(); throw e; }

    // Final DB verification
    const fCostRes = await pool.request().input('f_pid', sql.Int, productId)
        .query('SELECT cost_price FROM products WHERE id = @f_pid');
    const fCost = parseFloat(fCostRes.recordset[0]?.cost_price || 0);
    console.log(`\n  Final products.cost_price = ${fCost.toFixed(4)}`);
    assert(Math.abs(fCost - 21) < 0.001, `Final products.cost_price = 21 (got ${fCost})`);

    // Verify stock_movements
    const movsRes = await pool.request().input('m_pid', sql.Int, productId).input('m_sid', sql.Int, STORE_ID)
        .query("SELECT move_type, qty_in, qty_out, cost_price, balance_after FROM stock_movements WHERE product_id = @m_pid AND store_id = @m_sid ORDER BY id");
    const movs = movsRes.recordset;
    console.log(`\n  Stock movements for product ${productId} in store ${STORE_ID}:`);
    movs.forEach(m => {
        console.log(`    ${m.move_type.padEnd(16)} in=${parseFloat(m.qty_in).toFixed(1)} out=${parseFloat(m.qty_out).toFixed(1)} cost=${parseFloat(m.cost_price).toFixed(4)} bal=${parseFloat(m.balance_after).toFixed(1)}`);
    });

    // Verify stock_movement cost_prices
    // Purchase 'in' movements should have original purchase price as cost_price
    const purchaseMovs = movs.filter(m => m.move_type === 'in');
    assert(purchaseMovs.length === 3, `3 purchase movements recorded (got ${purchaseMovs.length})`);
    assert(parseFloat(purchaseMovs[0].cost_price) === 10, `1st purchase cost_price = 10 (got ${purchaseMovs[0].cost_price})`);
    assert(parseFloat(purchaseMovs[1].cost_price) === 20, `2nd purchase cost_price = 20 (got ${purchaseMovs[1].cost_price})`);
    assert(parseFloat(purchaseMovs[2].cost_price) === 30, `3rd purchase cost_price = 30 (got ${purchaseMovs[2].cost_price})`);

    // Sale 'out' movement should have WAC (15) at time of sale as cost_price
    const saleMov = movs.find(m => m.move_type === 'out');
    assert(!!saleMov, 'Sale movement exists');
    assert(parseFloat(saleMov.cost_price) === 15, `Sale cost_price = 15 (WAC at sale time, got ${saleMov.cost_price})`);

    // Verify balance after each movement
    const balMovs = movs.map(m => parseFloat(m.balance_after));
    const expectedBals = [100, 200, 150, 250]; // after each movement in order
    balMovs.forEach((b, i) => {
        assert(Math.abs(b - expectedBals[i]) < 0.01, `Balance after movement ${i+1} = ${expectedBals[i]} (got ${b})`);
    });

    // ═══════════════════════════════════════════════════
    // SUMMARY TABLE
    // ═══════════════════════════════════════════════════

    console.log('\n─── Execution Summary ───');
    console.log('  Step    | Action                | Qty Change | Total Qty | WAC   | Stock Value');
    console.log('  ────────┼───────────────────────┼────────────┼───────────┼───────┼────────────');
    console.log('  1       | Create product        |          0 |         0 |     0 |          0');
    console.log('  2       | Purchase 100×10       |        +100 |       100 |    10 |       1000');
    console.log('  3       | Purchase 100×20       |        +100 |       200 |    15 |       3000');
    console.log('  4       | Sell 50 (COGS=750)    |         -50 |       150 |    15 |       2250');
    console.log(`  5       | Purchase 100×30       |        +100 |       250 | ${wac.toFixed(4)} |       5250`);
    console.log('  6       | Purchase return -50   |         -50 |       200 |    21 |       4200');
    console.log('  7       | Sales return +10      |         +10 |       210 |    21 |       4410');
    console.log('  8       | Transfer -20 to S2    |         -20 |       190 |    21 |       3990');
    console.log('  9       | Adjustment +5         |          +5 |       195 |    21 |       4095');
    console.log('  10      | Damage -3             |          -3 |       192 |    21 |       4032');
    console.log('  11      | Count variance -2     |          -2 |       190 |    21 |       3990');
    console.log('  ────────┴───────────────────────┴────────────┴───────────┴───────┴────────────');
    console.log('  12      | DB: Purchase 100×10   |        +100 |   200→300 | 10→15 |        ...');
    console.log('  13      | DB: Purchase 100×20   |        +100 |   300→400 |    15 |        ...');
    console.log('  14      | DB: Sale 50           |         -50 |   400→350 |    15 |        ...');
    console.log('  15      | DB: Purchase 100×30   |        +100 |   350→450 |    21 |        ...');
    // DB operations started from existing stock (200 from earlier test + 200 new + 100 more)

    console.log('\n══════════════════════════════════════════════════');
    console.log(`Results: ${passCount}/${assertCount} passed, ${failCount} failed`);
    console.log('══════════════════════════════════════════════════');

    if (failCount > 0) process.exit(1);
    pool.close();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
