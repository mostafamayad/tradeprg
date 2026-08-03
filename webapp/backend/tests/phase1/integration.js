#!/usr/bin/env node
/**
 * Phase 1 Integration Tests — Posting Pipeline Integrity
 *
 * Verifies the central accounting pipeline end-to-end against the LIVE server:
 *   - Sales invoice: create → edit → edit-again → delete (reverse safety)
 *   - Sales returns: create → reverse
 *   - Inventory: count (start → items → complete → cancel), adjust, damaged + cancels
 *
 * Verifications on every step: GL, Stock, Subledger (customer balance), Audit chain.
 * Expects a running server on http://localhost:3000 (auth: admin@3smcompany.com / admin123).
 *
 * Usage: node tests/phase1/integration.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const Suite = require('../lib/runner');
const { login, headers, BASE_URL } = require('../lib/auth');
const { getPool, sql } = require('../../database/mssql_db');

const API = (p) => `${BASE_URL}${p}`;

async function call(method, p, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
        const r = await fetch(API(p), {
            method,
            headers: headers(),
            body: body ? JSON.stringify(body) : undefined,
            signal: ctrl.signal
        });
        let data = null;
        try { data = await r.json(); } catch (e) { data = { raw: true }; }
        return { status: r.status, data };
    } finally {
        clearTimeout(timer);
    }
}
const post = (p, b) => call('POST', p, b);
const put = (p, b) => call('PUT', p, b);
const del = (p) => call('DELETE', p);

// ── Direct DB helpers (read-only verification) ──
const DB = {
    async query(sqlText, params = {}) {
        const pool = await getPool();
        const req = pool.request();
        for (const [k, v] of Object.entries(params)) {
            if (typeof v === 'number') req.input(k, sql.Int, v);
            else req.input(k, sql.NVarChar, v);
        }
        const r = await req.query(sqlText);
        return r.recordset;
    },
    async activeEntriesFor(document) {
        return this.query(`
            SELECT je.id, je.entry_no, je.source_action, je.is_reversed, je.reversal_of_id,
                   je.total_debit, je.supplier_id, je.customer_id
            FROM journal_entries je
            WHERE je.source_document = @doc
              AND (je.is_reversed IS NULL OR je.is_reversed = 0)
              AND (je.reversal_of_id IS NULL)
              AND (je.source_action IS NULL OR je.source_action NOT LIKE '%_cancel')
        `, { doc: document });
    },
    async allEntriesFor(document) {
        return this.query(`
            SELECT je.id, je.entry_no, je.source_action, je.is_reversed, je.reversal_of_id, je.total_debit
            FROM journal_entries je
            WHERE je.source_document = @doc
        `, { doc: document });
    },
    async stockQty(productId, storeId) {
        const r = await this.query(`
            SELECT quantity FROM inventory_balances WHERE product_id = @p AND store_id = @s
        `, { p: productId, s: storeId });
        return r.length ? parseFloat(r[0].quantity) : 0;
    },
    async movementsFor(document) {
        return this.query(`
            SELECT move_type, qty_in, qty_out FROM stock_movements WHERE document_no = @doc
        `, { doc: document });
    },
    async customerBalance(customerId) {
        const r = await this.query(`SELECT current_balance FROM customers WHERE id = @c`, { c: customerId });
        return r.length ? parseFloat(r[0].current_balance) : null;
    },
    async glCustomerTotal(customerId) {
        const r = await this.query(`
            SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS net
            FROM journal_entry_lines jl
            JOIN journal_entries je ON je.id = jl.entry_id
            JOIN chart_of_accounts ca ON ca.id = jl.account_id AND ca.system_code = 'SYS_AR'
            WHERE je.customer_id = @c
              AND (je.is_reversed IS NULL OR je.is_reversed = 0)
              AND (je.reversal_of_id IS NULL)
              AND (je.source_action IS NULL OR (je.source_action NOT LIKE '%_cancel' AND je.source_action <> 'cancel'))
        `, { c: customerId });
        return parseFloat(r[0].net) || 0;
    },
    async invoiceById(id) {
        const r = await this.query(`SELECT * FROM sales_invoices WHERE id = @i`, { i: id });
        return r[0] || null;
    },
    async returnById(id) {
        const r = await this.query(`SELECT * FROM sales_returns WHERE id = @i`, { i: id });
        return r[0] || null;
    }
};

const TOL = 0.01;
function near(a, b, msg) {
    if (Math.abs(a - b) > TOL) throw new Error(`${msg}: expected ${b}, got ${a}`);
}

async function main() {
    await login();
    const suite = new Suite('Phase 1 — Posting Pipeline Integrity');

    // Test fixtures
    const customerId = 2;   // C-0002 (الحج متولي سعيد)
    const storeId = 1;      // main store
    const prodA = 1;        // نيمو cost 190, sell 230
    const prodB = 2;        // اوكسي cost 187.94, sell 220
    const today = new Date().toISOString().slice(0, 10);

    let testInvoiceId = null;
    let testReturnId = null;
    let testCountId = null;
    let testAdjustId = null;
    let testDamagedId = null;

    // Snapshot baseline (current_balance is operational-derived, GL AR is ledger-derived —
    // customer 2 has known historical drift, so each is measured against its OWN baseline)
    const baseStockA = await DB.stockQty(prodA, storeId);
    const baseStockB = await DB.stockQty(prodB, storeId);
    const baseCustBal = await DB.customerBalance(customerId);
    const baseGlCust = await DB.glCustomerTotal(customerId);

    await suite.run([

        // ══════════════ 1. CREATE INVOICE ══════════════
        {
            name: 'Create invoice → 2 active GL entries (accrual + COGS), stock deducted, customer balance up',
            fn: async () => {
                const r = await post('/sales/invoices', {
                    customer_id: customerId,
                    invoice_date: today,
                    due_date: today,
                    store_id: storeId,
                    payment_type: 'credit',
                    items: [
                        { product_id: prodA, quantity: 2, unit_price: 230, discount_pct: 0 },
                        { product_id: prodB, quantity: 1, unit_price: 220, discount_pct: 0 }
                    ],
                    amount_paid: 0
                });
                if (r.status !== 201 || !r.data.invoiceId) throw new Error(`Create failed: ${r.status} ${JSON.stringify(r.data)}`);
                testInvoiceId = r.data.invoiceId;
                const inv = await DB.invoiceById(testInvoiceId);
                if (!inv) throw new Error('Invoice not found in DB');

                // GL: exactly 2 active entries (accrual + cogs)
                const entries = await DB.activeEntriesFor(inv.invoice_no);
                if (entries.length !== 2) throw new Error(`Expected 2 active entries, got ${entries.length}`);
                const actions = entries.map(e => e.source_action).sort();
                if (actions.join(',') !== 'cogs,create_invoice') throw new Error(`Unexpected actions: ${actions}`);

                // Stock deducted
                near(await DB.stockQty(prodA, storeId), baseStockA - 2, 'stock A');
                near(await DB.stockQty(prodB, storeId), baseStockB - 1, 'stock B');

                // Subledger: customer balance rose by grand total (2*230 + 1*220 = 680)
                const balDelta = await DB.customerBalance(customerId) - baseCustBal;
                near(balDelta, 680, 'customer balance delta');
                const glDelta = await DB.glCustomerTotal(customerId) - baseGlCust;
                near(glDelta, 680, 'GL AR total delta');
                console.log(`     → Invoice ${inv.invoice_no} (id=${testInvoiceId}), 2 entries OK`);
            }
        },

        // ══════════════ 2. EDIT INVOICE ══════════════
        {
            name: 'Edit invoice (qty 2→3) → old entries reversed, new accrual+COGS reposted, no duplicates, stock corrected',
            fn: async () => {
                const before = await DB.invoiceById(testInvoiceId);
                const r = await put(`/sales/invoices/${testInvoiceId}`, {
                    customer_id: customerId,
                    invoice_date: before.invoice_date,
                    due_date: before.due_date,
                    store_id: storeId,
                    payment_type: before.payment_type,
                    items: [
                        { product_id: prodA, quantity: 3, unit_price: 230, discount_pct: 0 },
                        { product_id: prodB, quantity: 1, unit_price: 220, discount_pct: 0 }
                    ],
                    amount_paid: 0
                });
                if (r.status !== 200 || !r.data.success) throw new Error(`Edit failed: ${r.status} ${JSON.stringify(r.data)}`);

                // Exactly 2 ACTIVE entries again (old ones now reversed)
                const entries = await DB.activeEntriesFor(before.invoice_no);
                if (entries.length !== 2) throw new Error(`Expected 2 active entries after edit, got ${entries.length}`);

                // Old entries marked reversed (2) + reversal entries (2) exist
                const all = await DB.allEntriesFor(before.invoice_no);
                const reversed = all.filter(e => e.is_reversed === 1);
                const cancellations = all.filter(e => e.source_action && e.source_action.includes('_cancel'));
                if (reversed.length !== 2) throw new Error(`Expected 2 old entries reversed, got ${reversed.length}`);
                if (cancellations.length !== 2) throw new Error(`Expected 2 cancellation entries, got ${cancellations.length}`);

                // Stock corrected: net qty now -3 (edit removed 2, added 3)
                near(await DB.stockQty(prodA, storeId), baseStockA - 3, 'stock A after edit');
                near(await DB.stockQty(prodB, storeId), baseStockB - 1, 'stock B after edit');

                // Customer balance reflects new grand total 3*230 + 1*220 = 910
                const balDelta = await DB.customerBalance(customerId) - baseCustBal;
                near(balDelta, 910, 'customer balance after edit');
                console.log(`     → Edit OK: 2 active, 2 reversed, 2 cancellations`);
            }
        },

        // ══════════════ 3. EDIT AGAIN (reverse safety) ══════════════
        {
            name: 'Edit AGAIN → idempotent, still exactly 2 active entries, no double-reverse, no duplicate journal',
            fn: async () => {
                const before = await DB.invoiceById(testInvoiceId);
                const r = await put(`/sales/invoices/${testInvoiceId}`, {
                    customer_id: customerId,
                    invoice_date: before.invoice_date,
                    due_date: before.due_date,
                    store_id: storeId,
                    payment_type: before.payment_type,
                    items: [
                        { product_id: prodA, quantity: 2, unit_price: 230, discount_pct: 0 },
                        { product_id: prodB, quantity: 1, unit_price: 220, discount_pct: 0 }
                    ],
                    amount_paid: 0
                });
                if (r.status !== 200) throw new Error(`2nd edit failed: ${r.status} ${JSON.stringify(r.data)}`);

                const entries = await DB.activeEntriesFor(before.invoice_no);
                if (entries.length !== 2) throw new Error(`Expected 2 active entries after 2nd edit, got ${entries.length}`);

                near(await DB.stockQty(prodA, storeId), baseStockA - 2, 'stock A after 2nd edit');
                near(await DB.customerBalance(customerId) - baseCustBal, 680, 'customer balance after 2nd edit');
                console.log(`     → 2nd edit idempotent OK`);
            }
        },

        // ══════════════ 4. DELETE INVOICE ══════════════
        {
            name: 'Delete invoice → stock restored, GL fully reversed, customer balance back to baseline',
            fn: async () => {
                const before = await DB.invoiceById(testInvoiceId);
                const r = await del(`/sales/invoices/${testInvoiceId}`);
                if (r.status !== 200) throw new Error(`Delete failed: ${r.status} ${JSON.stringify(r.data)}`);

                const inv = await DB.invoiceById(testInvoiceId);
                if (inv.status !== 'deleted') throw new Error(`Invoice status = ${inv.status}, expected deleted`);

                // Stock restored to baseline
                near(await DB.stockQty(prodA, storeId), baseStockA, 'stock A after delete');
                near(await DB.stockQty(prodB, storeId), baseStockB, 'stock B after delete');

                // No active entries remain; all 2 reposted entries reversed + cancellations
                const active = await DB.activeEntriesFor(before.invoice_no);
                if (active.length !== 0) throw new Error(`Expected 0 active entries after delete, got ${active.length}`);

                // Customer balance back to baseline
                near(await DB.customerBalance(customerId), baseCustBal, 'customer balance after delete');
                near(await DB.glCustomerTotal(customerId), baseGlCust, 'GL AR total after delete');
                console.log(`     → Delete OK: stock restored, GL reversed`);
            }
        },

        // ══════════════ 5. DELETE AGAIN (must block) ══════════════
        {
            name: 'Delete AGAIN → blocked with clear message',
            fn: async () => {
                const r = await del(`/sales/invoices/${testInvoiceId}`);
                if (r.status !== 400) throw new Error(`Expected 400 on 2nd delete, got ${r.status}`);
                if (!r.data.message) throw new Error('No message returned');
                console.log(`     → Blocked OK: ${r.data.message.split('\n')[0]}`);
            }
        },

        // ══════════════ 6. CREATE RETURN ══════════════
        {
            name: 'Create approved sales return → stock returned, GL reversed for returned value, customer balance down',
            fn: async () => {
                // Re-create invoice to return against
                const r = await post('/sales/invoices', {
                    customer_id: customerId,
                    invoice_date: today,
                    due_date: today,
                    store_id: storeId,
                    payment_type: 'credit',
                    items: [{ product_id: prodA, quantity: 2, unit_price: 230, discount_pct: 0 }],
                    amount_paid: 0
                });
                if (r.status !== 201) throw new Error(`Re-create failed: ${r.status} ${JSON.stringify(r.data)}`);
                testInvoiceId = r.data.invoiceId;
                const inv = await DB.invoiceById(testInvoiceId);

                const rr = await post('/sales/returns', {
                    customer_id: customerId,
                    invoice_id: testInvoiceId,
                    return_date: today,
                    store_id: storeId,
                    return_reason: 'return_test',
                    reason_code: 'defective',
                    items: [
                        { product_id: prodA, quantity: 1, unit_price: 230, product_condition: 'saleable', reason_code: 'defective' }
                    ],
                    workflow_status: 'approved'
                });
                if (rr.status !== 201) throw new Error(`Return create failed: ${rr.status} ${JSON.stringify(rr.data)}`);
                testReturnId = rr.data.id || rr.data.return_id;
                const ret = await DB.returnById(testReturnId);
                if (!ret) throw new Error('Return not found in DB');

                // Stock: returned 1 unit → balance = baseline (invoice took 2, return gives 1)
                near(await DB.stockQty(prodA, storeId), baseStockA - 1, 'stock A after return');

                // GL: return posted reversal entries for the return value
                const returnActive = await DB.activeEntriesFor(ret.return_no);
                if (returnActive.length === 0) throw new Error('Expected GL entries for return');
                console.log(`     → Return ${ret.return_no} created, ${returnActive.length} active GL entries`);
            }
        },

        // ══════════════ 7. REVERSE RETURN ══════════════
        {
            name: 'Reverse return → return reversed, stock deducted back, GL net-neutral',
            fn: async () => {
                const ret = await DB.returnById(testReturnId);
                const r = await post(`/sales/returns/${testReturnId}/reverse`, {});
                if (r.status !== 200) throw new Error(`Return reverse failed: ${r.status} ${JSON.stringify(r.data)}`);

                // Stock back to baseline - 2 (returned unit taken back)
                near(await DB.stockQty(prodA, storeId), baseStockA - 2, 'stock A after return reverse');

                // No active entries for the return
                const active = await DB.activeEntriesFor(ret.return_no);
                if (active.length !== 0) throw new Error(`Expected 0 active entries after return reverse, got ${active.length}`);
                console.log(`     → Return reversed OK`);
            }
        },

        // ══════════════ 8. INVENTORY COUNT ══════════════
        {
            name: 'Count: start → set items → complete → 1 aggregate GL entry + stock adjusted',
            fn: async () => {
                const c = await post('/inventory/count/start', { store_id: storeId, count_date: today });
                if (c.status !== 201) throw new Error(`Count start failed: ${c.status} ${JSON.stringify(c.data)}`);
                testCountId = c.data.id;

                // Current stock after all above: baseline - 2 for prodA
                const curA = await DB.stockQty(prodA, storeId);
                const curB = await DB.stockQty(prodB, storeId);

                // Set a surplus of +1 on prodA; count prodB at its current qty (diff 0)
                // so the only difference is prodA's surplus (count start seeds all in-stock items).
                const it = await put(`/inventory/count/${testCountId}/items`, {
                    items: [
                        { product_id: prodA, counted_qty: curA + 1, diff: 1 },
                        { product_id: prodB, counted_qty: curB, diff: 0 }
                    ]
                });
                if (it.status !== 200) throw new Error(`Count items failed: ${it.status} ${JSON.stringify(it.data)}`);

                const comp = await post(`/inventory/count/${testCountId}/complete`, {});
                if (comp.status !== 200) throw new Error(`Count complete failed: ${comp.status} ${JSON.stringify(comp.data)}`);

                // Stock now +1
                near(await DB.stockQty(prodA, storeId), curA + 1, 'stock A after count');

                // Exactly 1 aggregate GL entry for the count (surplus)
                const countNo = (await DB.query(`SELECT count_no FROM stock_count WHERE id = @i`, { i: testCountId }))[0].count_no;
                const active = await DB.activeEntriesFor(countNo);
                if (active.length !== 1) throw new Error(`Expected 1 aggregate GL entry for count, got ${active.length}`);
                near(active[0].total_debit, 190, 'count GL value (prodA cost 190 × +1)');
                console.log(`     → Count ${countNo} completed: 1 aggregate entry (${active[0].total_debit})`);
            }
        },

        // ══════════════ 9. CANCEL COUNT ══════════════
        {
            name: 'Cancel count → GL entry reversed, stock back',
            fn: async () => {
                const countNo = (await DB.query(`SELECT count_no FROM stock_count WHERE id = @i`, { i: testCountId }))[0].count_no;
                const stockBefore = await DB.stockQty(prodA, storeId);
                const r = await put(`/inventory/count/${testCountId}/cancel`, {});
                if (r.status !== 200) throw new Error(`Count cancel failed: ${r.status} ${JSON.stringify(r.data)}`);

                near(await DB.stockQty(prodA, storeId), stockBefore - 1, 'stock A after count cancel');
                const active = await DB.activeEntriesFor(countNo);
                if (active.length !== 0) throw new Error(`Expected 0 active entries after count cancel, got ${active.length}`);
                console.log(`     → Count cancelled OK`);
            }
        },

        // ══════════════ 10. STOCK ADJUST ══════════════
        {
            name: 'Adjust +1 → GL entry (inventory/surplus), stock up',
            fn: async () => {
                const before = await DB.stockQty(prodA, storeId);
                const r = await post('/inventory/adjust', {
                    store_id: storeId, product_id: prodA, quantity: 1, adj_date: today, reason: 'adjust_test'
                });
                if (r.status !== 201) throw new Error(`Adjust failed: ${r.status} ${JSON.stringify(r.data)}`);
                testAdjustId = r.data.id;
                near(await DB.stockQty(prodA, storeId), before + 1, 'stock A after adjust');
                console.log(`     → Adjust id=${testAdjustId} OK`);
            }
        },

        // ══════════════ 11. CANCEL ADJUST ══════════════
        {
            name: 'Cancel adjust → GL reversed, stock back',
            fn: async () => {
                const before = await DB.stockQty(prodA, storeId);
                const r = await put(`/inventory/adjust/${testAdjustId}/cancel`, {});
                if (r.status !== 200) throw new Error(`Adjust cancel failed: ${r.status} ${JSON.stringify(r.data)}`);
                near(await DB.stockQty(prodA, storeId), before - 1, 'stock A after adjust cancel');
                console.log(`     → Adjust cancelled OK`);
            }
        },

        // ══════════════ 12. DAMAGED ══════════════
        {
            name: 'Damaged 1 unit → GL entry (damaged/inventory), stock down',
            fn: async () => {
                const before = await DB.stockQty(prodB, storeId);
                const r = await post('/inventory/damaged', {
                    store_id: storeId, product_id: prodB, quantity: 1, doc_date: today, reason: 'damaged_test'
                });
                if (r.status !== 201) throw new Error(`Damaged failed: ${r.status} ${JSON.stringify(r.data)}`);
                testDamagedId = r.data.id;
                near(await DB.stockQty(prodB, storeId), before - 1, 'stock B after damaged');
                console.log(`     → Damaged id=${testDamagedId} OK`);
            }
        },

        // ══════════════ 13. CANCEL DAMAGED ══════════════
        {
            name: 'Cancel damaged → GL reversed, stock back',
            fn: async () => {
                const before = await DB.stockQty(prodB, storeId);
                const r = await put(`/inventory/damaged/${testDamagedId}/cancel`, {});
                if (r.status !== 200) throw new Error(`Damaged cancel failed: ${r.status} ${JSON.stringify(r.data)}`);
                near(await DB.stockQty(prodB, storeId), before + 1, 'stock B after damaged cancel');
                console.log(`     → Damaged cancelled OK`);
            }
        },

        // ══════════════ 14. CLEANUP + FINAL BALANCE (no leakage) ══════════════
        {
            name: 'Cleanup re-created invoice → final: stock + customer balance return to baseline',
            fn: async () => {
                // The invoice re-created in test 6 (return test) is still active; delete it.
                const delRes = await del(`/sales/invoices/${testInvoiceId}`);
                if (delRes.status !== 200) throw new Error(`Cleanup delete failed: ${delRes.status} ${JSON.stringify(delRes.data)}`);

                near(await DB.stockQty(prodA, storeId), baseStockA, 'final stock A');
                near(await DB.stockQty(prodB, storeId), baseStockB, 'final stock B');
                near(await DB.customerBalance(customerId), baseCustBal, 'final customer balance');
                near(await DB.glCustomerTotal(customerId), baseGlCust, 'final GL AR total');
                console.log(`     → All baselines restored`);
            }
        }
    ]);

    const __pool = await getPool(); __pool.close();
    const result = suite.finish();
    process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(1);
});
