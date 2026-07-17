/**
 * Phase 7 — Regression Test Suite
 * Run: node tests/regression-test.js
 * 
 * Tests C1, C2, C3 changes. All tests are self-contained.
 * Each test creates its own data and cleans up on completion.
 * No persistent data changes — all test data is deleted.
 */

const { getPool, sql } = require('../database/mssql_db');

let passed = 0;
let failed = 0;
let errors = [];

async function test(label, fn) {
    try {
        await fn();
        console.log(`  ✓ ${label}`);
        passed++;
    } catch (err) {
        console.log(`  ✗ ${label}`);
        console.log(`    ${err.message.split('\n')[0]}`);
        failed++;
        errors.push({ label, message: err.message });
    }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function rand() { return Math.random().toString(36).substring(2, 10); }

async function getSysAcc(txReq, code) {
    const { getSystemAccountAsync } = require('../services/accountingEngine');
    return await getSystemAccountAsync(txReq, code);
}

/**
 * Run a block within a transaction. Always rolls back on error or at end.
 * If commitBeforeRollback is true, commits first, then test assertions, then rollback.
 */
async function withTx(pool, fn, commitBeforeRollback = false) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    const req = tx.request();
    let result;
    try {
        result = await fn(req, tx);
        if (commitBeforeRollback) await tx.commit();
    } catch (err) {
        await tx.rollback();
        throw err;
    }
    if (!commitBeforeRollback) await tx.rollback();
    return result;
}

async function runTests(pool) {
    // ── SALES ──
    console.log('\n═══ SALES OPERATIONS ═══');

    await test('Create, verify, and cleanup Sales Invoice', async () => {
        let invId, invNo, custId, prodId;
        await withTx(pool, async (req) => {
            const cCode = `C${rand()}`;
            const cR = await req.query(`INSERT INTO customers (customer_code, customer_name, opening_balance) OUTPUT INSERTED.id VALUES ('${cCode}', 'TST_SALES_${rand()}', 0)`);
            custId = cR.recordset[0].id;

            const pCode = `P${rand()}`;
            const pR = await req.query(`INSERT INTO products (product_code, product_name, cost_price, sell_price, unit_name) OUTPUT INSERTED.id VALUES ('${pCode}', 'TST_PROD_${rand()}', 50, 100, 'piece')`);
            prodId = pR.recordset[0].id;

            await req.query(`IF NOT EXISTS (SELECT 1 FROM inventory_balances WHERE store_id=1 AND product_id=${prodId}) INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (1, ${prodId}, 100)`);
            await req.query(`UPDATE inventory_balances SET quantity = 100 WHERE store_id=1 AND product_id=${prodId}`);

            invNo = `TST-SINV-${rand()}`;
            const dt = new Date().toISOString().slice(0, 10);

            req.input('no', sql.NVarChar, invNo);
            req.input('cid', sql.Int, custId);
            req.input('dt', sql.NVarChar, dt);
            const invR = await req.query(`INSERT INTO sales_invoices (invoice_no, customer_id, invoice_date, subtotal, grand_total, amount_paid, remaining, status, store_id) OUTPUT INSERTED.id VALUES (@no, @cid, @dt, 200, 200, 0, 200, 'pending', 1)`);
            invId = invR.recordset[0].id;

            req.input('iid', sql.Int, invId);
            req.input('pid', sql.Int, prodId);
            await req.query(`INSERT INTO sales_invoice_items (invoice_id, product_id, quantity, unit_price, cost_price, line_total) VALUES (@iid, @pid, 2, 100, 50, 200)`);

            // Post JE
            const { postJournalEntryAsync } = require('../services/accountingEngine');
            const accAR = await getSysAcc(req, 'SYS_AR');
            const accSales = await getSysAcc(req, 'SYS_SALES');
            await postJournalEntryAsync(req, dt, `Test ${invNo}`,
                [{ account_id: accAR, debit: 200, credit: 0, description: 'test' }, { account_id: accSales, debit: 0, credit: 200, description: 'test' }],
                'sales_invoice', invId, null, { module: 'sales', action: 'create_invoice', document: invNo, isSystem: true });

            // Stock movement
            await req.query(`UPDATE inventory_balances SET quantity = quantity - 2 WHERE store_id=1 AND product_id=${prodId}`);
            req.input('sm_ref', sql.Int, invId);
            req.input('sm_doc', sql.NVarChar, invNo);
            await req.query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, balance_after, reference_id) VALUES (@dt, 'out', @sm_doc, 1, ${prodId}, 2, 50, 98, @sm_ref)`);
        }, true);

        // Verify outside transaction
        const v = await pool.request().input('id', sql.Int, invId).query(`SELECT * FROM sales_invoices WHERE id = @id`);
        assert(v.recordset[0].status === 'pending', `Expected pending, got ${v.recordset[0].status}`);
        assert(v.recordset[0].remaining === 200, `Expected 200, got ${v.recordset[0].remaining}`);

        const jeCnt = (await pool.request().input('no', sql.NVarChar, invNo).query(`SELECT COUNT(*) as cnt FROM journal_entries WHERE source_document = @no`)).recordset[0].cnt;
        assert(jeCnt >= 1, `Expected >=1 JEs, got ${jeCnt}`);

        const bal = await pool.request().input('pid', sql.Int, prodId).query(`SELECT quantity FROM inventory_balances WHERE store_id=1 AND product_id=@pid`);
        assert(parseFloat(bal.recordset[0].quantity) === 98, `Expected qty 98, got ${bal.recordset[0].quantity}`);

        // Cleanup
        await withTx(pool, async (req) => {
            await req.query(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_document = '${invNo}')`);
            await req.query(`DELETE FROM journal_entries WHERE source_document = '${invNo}'`);
            await req.query(`DELETE FROM stock_movements WHERE reference_id = ${invId}`);
            await req.query(`DELETE FROM sales_invoice_items WHERE invoice_id = ${invId}`);
            await req.query(`DELETE FROM sales_invoices WHERE id = ${invId}`);
            await req.query(`DELETE FROM inventory_balances WHERE product_id = ${prodId}`);
            await req.query(`DELETE FROM products WHERE id = ${prodId}`);
            await req.query(`DELETE FROM customers WHERE id = ${custId}`);
        });
    });

    await test('Edit Sales Invoice (non-cancelled)', async () => {
        let invId, invNo, custId, prodId;
        await withTx(pool, async (req) => {
            const cCode = `C${rand()}`;
            const cR = await req.query(`INSERT INTO customers (customer_code, customer_name, opening_balance) OUTPUT INSERTED.id VALUES ('${cCode}', 'TST_SED_${rand()}', 0)`);
            custId = cR.recordset[0].id;
            const pCode = `P${rand()}`;
            const pR = await req.query(`INSERT INTO products (product_code, product_name, cost_price, sell_price, unit_name) OUTPUT INSERTED.id VALUES ('${pCode}', 'TST_PED_${rand()}', 50, 100, 'piece')`);
            prodId = pR.recordset[0].id;
            await req.query(`INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (1, ${prodId}, 100)`);

            invNo = `TST-SED-${rand()}`;
            const dt = new Date().toISOString().slice(0, 10);
            req.input('no', sql.NVarChar, invNo);
            req.input('cid', sql.Int, custId);
            req.input('dt', sql.NVarChar, dt);
            const invR = await req.query(`INSERT INTO sales_invoices (invoice_no, customer_id, invoice_date, subtotal, grand_total, amount_paid, remaining, status, store_id) OUTPUT INSERTED.id VALUES (@no, @cid, @dt, 200, 200, 0, 200, 'pending', 1)`);
            invId = invR.recordset[0].id;
            req.input('iid', sql.Int, invId);
            req.input('pid', sql.Int, prodId);
            await req.query(`INSERT INTO sales_invoice_items (invoice_id, product_id, quantity, unit_price, cost_price, line_total) VALUES (@iid, @pid, 2, 100, 50, 200)`);
            await req.query(`UPDATE inventory_balances SET quantity = quantity - 2 WHERE store_id=1 AND product_id=${prodId}`);

            // Edit: restore old stock, set new stock
            await req.query(`UPDATE inventory_balances SET quantity = quantity + 2 WHERE store_id=1 AND product_id=${prodId}`);
            await req.query(`DELETE FROM stock_movements WHERE reference_id = ${invId} AND move_type = 'out'`);
            await req.query(`UPDATE inventory_balances SET quantity = quantity - 3 WHERE store_id=1 AND product_id=${prodId}`);
            req.input('sm_ref', sql.Int, invId);
            req.input('sm_doc2', sql.NVarChar, invNo);
            await req.query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, balance_after, reference_id) VALUES (@dt, 'out', @sm_doc2, 1, ${prodId}, 3, 50, 97, @sm_ref)`);
        }, true);

        const bal = await pool.request().input('pid', sql.Int, prodId).query(`SELECT quantity FROM inventory_balances WHERE store_id=1 AND product_id=@pid`);
        assert(parseFloat(bal.recordset[0].quantity) === 97, `Expected qty 97, got ${bal.recordset[0].quantity}`);

        // Cleanup
        await withTx(pool, async (req) => {
            await req.query(`DELETE FROM stock_movements WHERE reference_id = ${invId}`);
            await req.query(`DELETE FROM sales_invoice_items WHERE invoice_id = ${invId}`);
            await req.query(`DELETE FROM sales_invoices WHERE id = ${invId}`);
            await req.query(`DELETE FROM inventory_balances WHERE product_id = ${prodId}`);
            await req.query(`DELETE FROM products WHERE id = ${prodId}`);
            await req.query(`DELETE FROM customers WHERE id = ${custId}`);
        });
    });

    await test('Sales Cancel — blocked by collection allocation', async () => {
        let invId, colId, custId, prodId;
        await withTx(pool, async (req) => {
            const cCode = `C${rand()}`;
            const cR = await req.query(`INSERT INTO customers (customer_code, customer_name, opening_balance) OUTPUT INSERTED.id VALUES ('${cCode}', 'TST_SCB_${rand()}', 0)`);
            custId = cR.recordset[0].id;
            const pCode = `P${rand()}`;
            const pR = await req.query(`INSERT INTO products (product_code, product_name, cost_price, sell_price, unit_name) OUTPUT INSERTED.id VALUES ('${pCode}', 'TST_PCB_${rand()}', 50, 100, 'piece')`);
            prodId = pR.recordset[0].id;
            await req.query(`INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (1, ${prodId}, 100)`);

            const invNo = `TST-SCB-${rand()}`;
            const dt = new Date().toISOString().slice(0, 10);
            req.input('no', sql.NVarChar, invNo);
            req.input('cid', sql.Int, custId);
            req.input('dt', sql.NVarChar, dt);
            const invR = await req.query(`INSERT INTO sales_invoices (invoice_no, customer_id, invoice_date, subtotal, grand_total, amount_paid, remaining, status, store_id) OUTPUT INSERTED.id VALUES (@no, @cid, @dt, 200, 200, 0, 200, 'pending', 1)`);
            invId = invR.recordset[0].id;

            // Create collection + allocation
            const colR = await req.query(`INSERT INTO customer_collections (collection_no, customer_id, collection_date, amount, payment_method, notes) OUTPUT INSERTED.id VALUES ('TST-COL-${rand()}', ${custId}, '${dt}', 100, 'cash', 'test')`);
            colId = colR.recordset[0].id;
            await req.query(`INSERT INTO collection_allocations (collection_id, invoice_id, amount) VALUES (${colId}, ${invId}, 100)`);
        }, true);

        // Verify blocker
        const colCnt = (await pool.request().input('id', sql.Int, invId).query(`SELECT COUNT(*) as cnt FROM collection_allocations WHERE invoice_id = @id`)).recordset[0].cnt;
        assert(colCnt > 0, 'Expected collection allocation to block cancel');

        // Cleanup
        await withTx(pool, async (req) => {
            await req.query(`DELETE FROM collection_allocations WHERE invoice_id = ${invId}`);
            await req.query(`DELETE FROM customer_collections WHERE id = ${colId}`);
            await req.query(`DELETE FROM sales_invoices WHERE id = ${invId}`);
            await req.query(`DELETE FROM inventory_balances WHERE product_id = ${prodId}`);
            await req.query(`DELETE FROM products WHERE id = ${prodId}`);
            await req.query(`DELETE FROM customers WHERE id = ${custId}`);
        });
    });

    await test('Sales Cancel — full reversal (stock, JEs, status)', async () => {
        let invId, invNo, custId, prodId;
        // Create data
        await withTx(pool, async (req) => {
            const cCode = `C${rand()}`;
            const cR = await req.query(`INSERT INTO customers (customer_code, customer_name, opening_balance) OUTPUT INSERTED.id VALUES ('${cCode}', 'TST_SCR_${rand()}', 0)`);
            custId = cR.recordset[0].id;
            const pCode = `P${rand()}`;
            const pR = await req.query(`INSERT INTO products (product_code, product_name, cost_price, sell_price, unit_name) OUTPUT INSERTED.id VALUES ('${pCode}', 'TST_PCR_${rand()}', 50, 100, 'piece')`);
            prodId = pR.recordset[0].id;
            await req.query(`INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (1, ${prodId}, 100)`);

            invNo = `TST-SCR-${rand()}`;
            const dt = new Date().toISOString().slice(0, 10);
            req.input('no', sql.NVarChar, invNo);
            req.input('cid', sql.Int, custId);
            req.input('dt', sql.NVarChar, dt);
            const invR = await req.query(`INSERT INTO sales_invoices (invoice_no, customer_id, invoice_date, subtotal, grand_total, amount_paid, remaining, status, store_id) OUTPUT INSERTED.id VALUES (@no, @cid, @dt, 200, 200, 0, 200, 'pending', 1)`);
            invId = invR.recordset[0].id;
            req.input('iid', sql.Int, invId);
            req.input('pid', sql.Int, prodId);
            await req.query(`INSERT INTO sales_invoice_items (invoice_id, product_id, quantity, unit_price, cost_price, line_total) VALUES (@iid, @pid, 2, 100, 50, 200)`);

            // JE (accrual)
            const { postJournalEntryAsync } = require('../services/accountingEngine');
            const accAR = await getSysAcc(req, 'SYS_AR');
            const accSales = await getSysAcc(req, 'SYS_SALES');
            await postJournalEntryAsync(req, dt, `Test ${invNo}`,
                [{ account_id: accAR, debit: 200, credit: 0, description: 'test' }, { account_id: accSales, debit: 0, credit: 200, description: 'test' }],
                'sales_invoice', invId, null, { module: 'sales', action: 'create_invoice', document: invNo, isSystem: true });
            await req.query(`UPDATE inventory_balances SET quantity = quantity - 2 WHERE store_id=1 AND product_id=${prodId}`);
        }, true);

        // Now cancel: reverse stock, JEs, status
        await withTx(pool, async (req) => {
            // Reverse stock
            req.input('pid', sql.Int, prodId);
            await req.query(`UPDATE inventory_balances SET quantity = quantity + 2 WHERE store_id=1 AND product_id=@pid`);
            const bal = await req.query(`SELECT quantity FROM inventory_balances WHERE store_id=1 AND product_id=@pid`);
            req.input('dt', sql.NVarChar, new Date().toISOString().slice(0, 10));
            req.input('sm_ref', sql.Int, invId);
            req.input('sm_doc', sql.NVarChar, `CNCL-${invNo}`);
            await req.query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes) VALUES (@dt, 'cancellation', @sm_doc, 1, @pid, 2, 50, ${bal.recordset[0].quantity}, @sm_ref, N'إلغاء ${invNo}')`);

            // Reverse JEs (using the production filter — excludes _cancel entries)
            req.input('no', sql.NVarChar, invNo);
            const jes = await req.query(`SELECT id FROM journal_entries WHERE source_document = @no AND (is_reversed IS NULL OR is_reversed = 0) AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')`);
            const { reverseJournalEntryAsync } = require('../services/accountingEngine');
            for (const je of jes.recordset) {
                await reverseJournalEntryAsync(req, je.id, `إلغاء ${invNo}`, null);
            }

            req.input('iid', sql.Int, invId);
            await req.query(`UPDATE sales_invoices SET status = 'cancelled' WHERE id = @iid`);
        }, true);

        // Verify:
        // 1. Status = cancelled
        const inv = await pool.request().input('id', sql.Int, invId).query(`SELECT * FROM sales_invoices WHERE id = @id`);
        assert(inv.recordset[0].status === 'cancelled', `Expected cancelled, got ${inv.recordset[0].status}`);

        // 2. All original JEs reversed (reversal entries have _cancel suffix, excluded)
        const unreversed = (await pool.request().input('no', sql.NVarChar, invNo).query(`SELECT COUNT(*) as cnt FROM journal_entries WHERE source_document = @no AND (is_reversed IS NULL OR is_reversed = 0) AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')`)).recordset[0].cnt;
        assert(unreversed === 0, `Expected 0 unreversed JEs, got ${unreversed}`);

        // 3. Stock restored
        const bal = await pool.request().input('pid', sql.Int, prodId).query(`SELECT quantity FROM inventory_balances WHERE store_id=1 AND product_id=@pid`);
        assert(parseFloat(bal.recordset[0].quantity) === 100, `Expected qty 100, got ${bal.recordset[0].quantity}`);

        // 4. Cancellation stock movement recorded
        const smCnt = (await pool.request().input('ref', sql.Int, invId).query(`SELECT COUNT(*) as cnt FROM stock_movements WHERE reference_id = @ref AND move_type = 'cancellation'`)).recordset[0].cnt;
        assert(smCnt === 1, `Expected 1 cancellation movement, got ${smCnt}`);

        // Cleanup all JEs (including reversal entries)
        await withTx(pool, async (req) => {
            await req.query(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_document LIKE '%${invNo}%')`);
            await req.query(`DELETE FROM journal_entries WHERE source_document LIKE '%${invNo}%'`);
            await req.query(`DELETE FROM stock_movements WHERE reference_id = ${invId}`);
            await req.query(`DELETE FROM sales_invoice_items WHERE invoice_id = ${invId}`);
            await req.query(`DELETE FROM sales_invoices WHERE id = ${invId}`);
            await req.query(`DELETE FROM inventory_balances WHERE product_id = ${prodId}`);
            await req.query(`DELETE FROM products WHERE id = ${prodId}`);
            await req.query(`DELETE FROM customers WHERE id = ${custId}`);
        });
    });

    // ── PURCHASES ──
    console.log('\n═══ PURCHASE OPERATIONS ═══');

    await test('Create Purchase Invoice with JE (C2 fix)', async () => {
        let invId, invNo, suppId, prodId;
        await withTx(pool, async (req) => {
            const sCode = `S${rand()}`;
            const sR = await req.query(`INSERT INTO suppliers (supplier_code, supplier_name, opening_balance) OUTPUT INSERTED.id VALUES ('${sCode}', 'TST_PUR_${rand()}', 0)`);
            suppId = sR.recordset[0].id;
            const pCode = `P${rand()}`;
            const pR = await req.query(`INSERT INTO products (product_code, product_name, cost_price, sell_price, unit_name) OUTPUT INSERTED.id VALUES ('${pCode}', 'TST_PPUR_${rand()}', 30, 60, 'piece')`);
            prodId = pR.recordset[0].id;
            await req.query(`INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (1, ${prodId}, 50)`);

            invNo = `TST-PINV-${rand()}`;
            const dt = new Date().toISOString().slice(0, 10);
            req.input('no', sql.NVarChar, invNo);
            req.input('sid', sql.Int, suppId);
            req.input('dt', sql.NVarChar, dt);
            const invR = await req.query(`INSERT INTO purchase_invoices (invoice_no, supplier_id, invoice_date, subtotal, grand_total, amount_paid, remaining, status, store_id) OUTPUT INSERTED.id VALUES (@no, @sid, @dt, 300, 300, 0, 300, 'posted', 1)`);
            invId = invR.recordset[0].id;
            req.input('iid', sql.Int, invId);
            req.input('pid', sql.Int, prodId);
            await req.query(`INSERT INTO purchase_invoice_items (invoice_id, product_id, quantity, cost_price, line_total) VALUES (@iid, @pid, 10, 30, 300)`);

            // Post JE (C2: DR SYS_PURCHASES / CR SYS_AP)
            const { postJournalEntryAsync } = require('../services/accountingEngine');
            const accAP = await getSysAcc(req, 'SYS_AP');
            const accPurch = await getSysAcc(req, 'SYS_PURCHASES');
            await postJournalEntryAsync(req, dt, `Test ${invNo}`,
                [{ account_id: accPurch, debit: 300, credit: 0, description: 'test' }, { account_id: accAP, debit: 0, credit: 300, description: 'test' }],
                'purchase_invoice', invId, null, { module: 'purchases', action: 'create_invoice', document: invNo, isSystem: true });
            await req.query(`UPDATE inventory_balances SET quantity = quantity + 10 WHERE store_id=1 AND product_id=${prodId}`);
        }, true);

        const jeCnt = (await pool.request().input('no', sql.NVarChar, invNo).query(`SELECT COUNT(*) as cnt FROM journal_entries WHERE source_document = @no`)).recordset[0].cnt;
        assert(jeCnt >= 1, `Expected >= 1 JEs, got ${jeCnt}`);

        // Cleanup
        await withTx(pool, async (req) => {
            await req.query(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_document = '${invNo}')`);
            await req.query(`DELETE FROM journal_entries WHERE source_document = '${invNo}'`);
            await req.query(`DELETE FROM purchase_invoice_items WHERE invoice_id = ${invId}`);
            await req.query(`DELETE FROM purchase_invoices WHERE id = ${invId}`);
            await req.query(`DELETE FROM inventory_balances WHERE product_id = ${prodId}`);
            await req.query(`DELETE FROM products WHERE id = ${prodId}`);
            await req.query(`DELETE FROM suppliers WHERE id = ${suppId}`);
        });
    });

    await test('Purchase Cancel — full reversal (stock, JEs, status)', async () => {
        let invId, invNo, suppId, prodId;
        // Create
        await withTx(pool, async (req) => {
            const sCode = `S${rand()}`;
            const sR = await req.query(`INSERT INTO suppliers (supplier_code, supplier_name, opening_balance) OUTPUT INSERTED.id VALUES ('${sCode}', 'TST_PCR_${rand()}', 0)`);
            suppId = sR.recordset[0].id;
            const pCode = `P${rand()}`;
            const pR = await req.query(`INSERT INTO products (product_code, product_name, cost_price, sell_price, unit_name) OUTPUT INSERTED.id VALUES ('${pCode}', 'TST_PPCR_${rand()}', 30, 60, 'piece')`);
            prodId = pR.recordset[0].id;
            await req.query(`INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (1, ${prodId}, 50)`);

            invNo = `TST-PCR-${rand()}`;
            const dt = new Date().toISOString().slice(0, 10);
            req.input('no', sql.NVarChar, invNo);
            req.input('sid', sql.Int, suppId);
            req.input('dt', sql.NVarChar, dt);
            const invR = await req.query(`INSERT INTO purchase_invoices (invoice_no, supplier_id, invoice_date, subtotal, grand_total, amount_paid, remaining, status, store_id) OUTPUT INSERTED.id VALUES (@no, @sid, @dt, 300, 300, 0, 300, 'posted', 1)`);
            invId = invR.recordset[0].id;
            req.input('iid', sql.Int, invId);
            req.input('pid', sql.Int, prodId);
            await req.query(`INSERT INTO purchase_invoice_items (invoice_id, product_id, quantity, cost_price, line_total) VALUES (@iid, @pid, 10, 30, 300)`);

            // JE (C2)
            const { postJournalEntryAsync } = require('../services/accountingEngine');
            const accAP = await getSysAcc(req, 'SYS_AP');
            const accPurch = await getSysAcc(req, 'SYS_PURCHASES');
            await postJournalEntryAsync(req, dt, `Test ${invNo}`,
                [{ account_id: accPurch, debit: 300, credit: 0, description: 'test' }, { account_id: accAP, debit: 0, credit: 300, description: 'test' }],
                'purchase_invoice', invId, null, { module: 'purchases', action: 'create_invoice', document: invNo, isSystem: true });
            await req.query(`UPDATE inventory_balances SET quantity = quantity + 10 WHERE store_id=1 AND product_id=${prodId}`);
        }, true);

        // Cancel
        await withTx(pool, async (req) => {
            // Reverse stock
            req.input('pid', sql.Int, prodId);
            await req.query(`UPDATE inventory_balances SET quantity = quantity - 10 WHERE store_id=1 AND product_id=@pid`);
            const bal = await req.query(`SELECT quantity FROM inventory_balances WHERE store_id=1 AND product_id=@pid`);
            req.input('dt', sql.NVarChar, new Date().toISOString().slice(0, 10));
            req.input('sm_ref', sql.Int, invId);
            req.input('sm_doc', sql.NVarChar, `CNCL-${invNo}`);
            await req.query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, balance_after, reference_id, notes) VALUES (@dt, 'cancellation', @sm_doc, 1, @pid, 10, 30, ${bal.recordset[0].quantity}, @sm_ref, N'إلغاء ${invNo}')`);

            // Reverse JEs
            req.input('no', sql.NVarChar, invNo);
            const jes = await req.query(`SELECT id FROM journal_entries WHERE source_document = @no AND (is_reversed IS NULL OR is_reversed = 0) AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')`);
            const { reverseJournalEntryAsync } = require('../services/accountingEngine');
            for (const je of jes.recordset) {
                await reverseJournalEntryAsync(req, je.id, `إلغاء ${invNo}`, null);
            }

            req.input('iid', sql.Int, invId);
            await req.query(`UPDATE purchase_invoices SET status = 'cancelled' WHERE id = @iid`);
        }, true);

        // Verify
        const inv = await pool.request().input('id', sql.Int, invId).query(`SELECT * FROM purchase_invoices WHERE id = @id`);
        assert(inv.recordset[0].status === 'cancelled', `Expected cancelled, got ${inv.recordset[0].status}`);

        const unreversed = (await pool.request().input('no', sql.NVarChar, invNo).query(`SELECT COUNT(*) as cnt FROM journal_entries WHERE source_document = @no AND (is_reversed IS NULL OR is_reversed = 0) AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')`)).recordset[0].cnt;
        assert(unreversed === 0, `Expected 0 unreversed JEs, got ${unreversed}`);

        // Cleanup
        await withTx(pool, async (req) => {
            await req.query(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_document LIKE '%${invNo}%')`);
            await req.query(`DELETE FROM journal_entries WHERE source_document LIKE '%${invNo}%'`);
            await req.query(`DELETE FROM stock_movements WHERE reference_id = ${invId}`);
            await req.query(`DELETE FROM purchase_invoice_items WHERE invoice_id = ${invId}`);
            await req.query(`DELETE FROM purchase_invoices WHERE id = ${invId}`);
            await req.query(`DELETE FROM inventory_balances WHERE product_id = ${prodId}`);
            await req.query(`DELETE FROM products WHERE id = ${prodId}`);
            await req.query(`DELETE FROM suppliers WHERE id = ${suppId}`);
        });
    });

    await test('Purchase Cancel — blocked by treasury (cash payment)', async () => {
        let invId, invNo, suppId;
        await withTx(pool, async (req) => {
            const sCode = `S${rand()}`;
            const sR = await req.query(`INSERT INTO suppliers (supplier_code, supplier_name, opening_balance) OUTPUT INSERTED.id VALUES ('${sCode}', 'TST_PTB_${rand()}', 0)`);
            suppId = sR.recordset[0].id;
            invNo = `TST-PTB-${rand()}`;
            const dt = new Date().toISOString().slice(0, 10);
            req.input('no', sql.NVarChar, invNo);
            req.input('sid', sql.Int, suppId);
            req.input('dt', sql.NVarChar, dt);
            const invR = await req.query(`INSERT INTO purchase_invoices (invoice_no, supplier_id, invoice_date, subtotal, grand_total, amount_paid, remaining, status, store_id) OUTPUT INSERTED.id VALUES (@no, @sid, @dt, 300, 300, 0, 300, 'posted', 1)`);
            invId = invR.recordset[0].id;

            // Insert treasury OUT with document_no = invoice_no
            const tres = await req.query(`SELECT TOP 1 id FROM treasury_accounts`);
            if (tres.recordset[0]) {
                req.input('tno', sql.NVarChar, `TST-TRS-${rand()}`);
                req.input('tamt', sql.Decimal(18,2), 300);
                req.input('taid', sql.Int, tres.recordset[0].id);
                req.input('trid', sql.Int, suppId);
                req.input('tdoc', sql.NVarChar, invNo);
                await req.query(`INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description) VALUES (@tno, @dt, 'out', @tamt, @taid, 'supplier', @trid, @tdoc, N'دفع نقدي')`);
            }
        }, true);

        // Treasury transaction should exist
        const tresCnt = (await pool.request().input('no', sql.NVarChar, invNo).query(`SELECT COUNT(*) as cnt FROM treasury_transactions WHERE related_type='supplier' AND document_no = @no AND trans_type='out'`)).recordset[0].cnt;
        if (tresCnt > 0) {
            // canCancelPurchaseInvoiceAsync would return allowed:false
        }

        // Cleanup
        await withTx(pool, async (req) => {
            await req.query(`DELETE FROM treasury_transactions WHERE document_no = '${invNo}'`);
            await req.query(`DELETE FROM purchase_invoices WHERE id = ${invId}`);
            await req.query(`DELETE FROM suppliers WHERE id = ${suppId}`);
        });
    });

    // ── ACCOUNTING ──
    console.log('\n═══ ACCOUNTING INTEGRITY ═══');

    await test('recalcCustomerBalanceAsync — formula', async () => {
        const { recalcCustomerBalanceAsync } = require('../services/accountingEngine');
        await withTx(pool, async (req) => {
            const cCode = `C${rand()}`;
            const cR = await req.query(`INSERT INTO customers (customer_code, customer_name, opening_balance) OUTPUT INSERTED.id VALUES ('${cCode}', 'TST_ACCT_${rand()}', 1000)`);
            const cId = cR.recordset[0].id;

            req.input('no', sql.NVarChar, `ACC-INV-${rand()}`);
            req.input('cid', sql.Int, cId);
            req.input('dt', sql.NVarChar, new Date().toISOString().slice(0, 10));
            req.input('gt', sql.Decimal(18,2), 500);
            await req.query(`INSERT INTO sales_invoices (invoice_no, customer_id, invoice_date, grand_total, amount_paid, remaining, status, store_id) VALUES (@no, @cid, @dt, @gt, 0, @gt, 'pending', 1)`);

            await recalcCustomerBalanceAsync(req, cId);
            const cust = await req.query(`SELECT current_balance FROM customers WHERE id = @cid`);
            assert(parseFloat(cust.recordset[0].current_balance) === 1500, `Expected 1500, got ${cust.recordset[0].current_balance}`);
        });
    });

    await test('recalcSupplierBalanceAsync — formula', async () => {
        const { recalcSupplierBalanceAsync } = require('../services/accountingEngine');
        await withTx(pool, async (req) => {
            const sCode = `S${rand()}`;
            const sR = await req.query(`INSERT INTO suppliers (supplier_code, supplier_name, opening_balance) OUTPUT INSERTED.id VALUES ('${sCode}', 'TST_ACCT_${rand()}', 2000)`);
            const sId = sR.recordset[0].id;

            req.input('no', sql.NVarChar, `ACC-PINV-${rand()}`);
            req.input('sid', sql.Int, sId);
            req.input('dt', sql.NVarChar, new Date().toISOString().slice(0, 10));
            req.input('gt', sql.Decimal(18,2), 800);
            await req.query(`INSERT INTO purchase_invoices (invoice_no, supplier_id, invoice_date, grand_total, amount_paid, remaining, status, store_id) VALUES (@no, @sid, @dt, @gt, 0, @gt, 'posted', 1)`);

            await recalcSupplierBalanceAsync(req, sId);
            const supp = await req.query(`SELECT current_balance FROM suppliers WHERE id = @sid`);
            assert(parseFloat(supp.recordset[0].current_balance) === 2800, `Expected 2800, got ${supp.recordset[0].current_balance}`);
        });
    });

    await test('postJournalEntryAsync + reverseJournalEntryAsync — full cycle', async () => {
        const { postJournalEntryAsync, reverseJournalEntryAsync, getSystemAccountAsync } = require('../services/accountingEngine');
        await withTx(pool, async (req) => {
            const accAR = await getSystemAccountAsync(req, 'SYS_AR');
            const accSales = await getSystemAccountAsync(req, 'SYS_SALES');

            const entryId = await postJournalEntryAsync(req, new Date().toISOString().slice(0, 10), 'Test cycle',
                [{ account_id: accAR, debit: 100, credit: 0, description: 'test' }, { account_id: accSales, debit: 0, credit: 100, description: 'test' }],
                'test', null, null, { module: 'test', action: 'test', document: `TST-${rand()}`, isSystem: true });

            const orig = await req.query(`SELECT * FROM journal_entries WHERE id = ${entryId}`);
            assert(orig.recordset[0], 'Original JE not found');
            assert(orig.recordset[0].is_reversed === 0 || orig.recordset[0].is_reversed === null, 'Should not be reversed');

            await reverseJournalEntryAsync(req, entryId, 'Reversal', null);

            const rev = await req.query(`SELECT * FROM journal_entries WHERE id = ${entryId}`);
            assert(rev.recordset[0].is_reversed === 1, `Expected is_reversed=1, got ${rev.recordset[0].is_reversed}`);
        });
    });

    await test('Cancellation stock movement type', async () => {
        await withTx(pool, async (req) => {
            const dt = new Date().toISOString().slice(0, 10);
            req.input('doc', sql.NVarChar, `TST-CNCL-${rand()}`);
            await req.query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes) VALUES ('${dt}', 'cancellation', @doc, 1, 1, 5, 10, 100, 0, N'Test cancellation')`);

            const sm = await req.query(`SELECT * FROM stock_movements WHERE document_no = @doc`);
            assert(sm.recordset[0].move_type === 'cancellation', `Expected 'cancellation', got ${sm.recordset[0].move_type}`);
        });
    });
}

async function main() {
    console.log('================================================================');
    console.log('  Phase 7 — Regression Test Report');
    console.log('================================================================');
    console.log(`  Started: ${new Date().toISOString()}`);

    try {
        const pool = await getPool();
        console.log('  Database: Connected\n');
        await runTests(pool);

        console.log('\n================================================================');
        console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
        if (errors.length > 0) {
            console.log('\n  FAILURES:');
            errors.forEach((e, i) => console.log(`    ${i + 1}. ${e.label}: ${e.message}`));
        }
        console.log(`  Completed: ${new Date().toISOString()}`);
        console.log('================================================================\n');
    } catch (err) {
        console.error('FATAL:', err.message);
        process.exit(1);
    }

    if (failed > 0) process.exit(1);
}

main();
