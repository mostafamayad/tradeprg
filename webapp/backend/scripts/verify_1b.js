#!/usr/bin/env node
/**
 * 1B VERIFICATION — add-payment-on-invoice (POST /sales/invoices/:id/pay)
 *
 * Drives REAL HTTP: creates a credit invoice then adds a cash payment to it,
 * and proves the write goes to ar_payments / ar_payment_allocations ONLY
 * (customer_collections / collection_allocations stay at 0).
 * Also prints the journal (reference_type=ar_payment), the GET /collections/:id
 * contract, and the matching-status report execution.
 *
 * Usage: node scripts/verify_1b.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { login, headers, BASE_URL } = require('../tests/lib/auth');
const { getPool, sql } = require('../database/mssql_db');

const API = (p) => `${BASE_URL}${p}`;
async function call(method, p, body) {
    const r = await fetch(API(p), {
        method,
        headers: headers(),
        body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch (e) { data = { raw: true }; }
    return { status: r.status, data };
}
const post = (p, b) => call('POST', p, b);
async function db(sqlText, params = {}) {
    const p = await getPool();
    const r = p.request();
    for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'number') r.input(k, sql.Int, v);
        else r.input(k, sql.NVarChar, v);
    }
    const x = await r.query(sqlText);
    return x.recordset;
}
const COUNT = (t) => db(`SELECT COUNT(*) AS c FROM ${t}`).then(r => r[0].c);
function line(label, body) {
    console.log(`\n── ${label} ─────────────────────────────`);
    console.log(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

(async () => {
    await login();
    const customerId = 2, storeId = 1, prodA = 1;
    const today = new Date().toISOString().slice(0, 10);

    const before = {
        customer_collections: await COUNT('customer_collections'),
        collection_allocations: await COUNT('collection_allocations'),
        ar_payments: await COUNT('ar_payments'),
        ar_payment_allocations: await COUNT('ar_payment_allocations')
    };
    line('BEFORE row counts', before);

    // 1. credit invoice (no payment)
    const inv = await post('/sales/invoices', {
        customer_id: customerId, invoice_date: today, due_date: today, store_id: storeId,
        payment_type: 'credit',
        items: [{ product_id: prodA, quantity: 1, unit_price: 230, discount_pct: 0 }],
        amount_paid: 0
    });
    if (inv.status !== 201 || !inv.data.invoiceId) throw new Error(`invoice failed: ${inv.status} ${JSON.stringify(inv.data)}`);
    const invoiceId = inv.data.invoiceId;
    line('1] credit invoice created', inv.data);

    // 2. add a payment to the existing invoice
    const pay = await post(`/sales/invoices/${invoiceId}/pay`, { amount: 100, payment_method: 'cash', payment_date: today, notes: 'verify_1b' });
    if (pay.status !== 200 || !pay.data.success) throw new Error(`pay failed: ${pay.status} ${JSON.stringify(pay.data)}`);
    const payNo = pay.data.collection_no;
    line('2] add payment (POST /sales/invoices/:id/pay)', pay.data);

    // locate the new ar_payments row
    const payRow = (await db(`SELECT id, payment_no, customer_id, amount, payment_method, status FROM ar_payments WHERE payment_no = @p`, { p: payNo }))[0];
    if (!payRow) throw new Error(`ar_payments row ${payNo} not found`);
    line('2b] new ar_payments row', payRow);

    const after = {
        customer_collections: await COUNT('customer_collections'),
        collection_allocations: await COUNT('collection_allocations'),
        ar_payments: await COUNT('ar_payments'),
        ar_payment_allocations: await COUNT('ar_payment_allocations')
    };
    const delta = {};
    for (const k of Object.keys(after)) delta[k] = after[k] - before[k];
    line('AFTER row counts', after);
    line('DELTA (new INSERTs)', delta);

    const ok = delta.customer_collections === 0 && delta.collection_allocations === 0
        && delta.ar_payments === 1 && delta.ar_payment_allocations === 1;
    line('1B no-dual-write proof', ok
        ? 'PASS → customer_collections:0, collection_allocations:0, ar_payments:+1, ar_payment_allocations:+1'
        : 'FAIL → unexpected deltas');

    // 3. journal for the payment
    const je = await db(`
        SELECT je.id, je.entry_no, je.reference_type, je.reference_id, je.total_debit, je.total_credit,
               je.source_action, je.description, ca.account_code, ca.account_name, jl.debit, jl.credit
        FROM journal_entries je
        JOIN journal_entry_lines jl ON jl.entry_id = je.id
        LEFT JOIN chart_of_accounts ca ON ca.id = jl.account_id
        WHERE je.reference_type = 'ar_payment' AND je.reference_id = @pid
          AND (je.is_reversed IS NULL OR je.is_reversed = 0)
        ORDER BY jl.id
    `, { pid: payRow.id });
    line('3] Journal entry (reference_type = ar_payment)', je);

    // 4. GET /collections/:id contract
    const g = await call('GET', `/collections/${payRow.id}`, null);
    line('4] GET /collections/:id JSON contract', { status: g.status, data: g.data });

    // 5. invoice status after payment
    const invState = (await db(`SELECT id, invoice_no, amount_paid, remaining, status FROM sales_invoices WHERE id = @i`, { i: invoiceId }))[0];
    line('5] invoice state after payment', invState);

    // 6. matching status report (legacy reader — known Phase 2 gap; must execute without error)
    const ms = await call('GET', `/reports/ar-matching-status`, null);
    line('6] GET /reports/ar-matching-status (executes; legacy-read until Phase 2)', { status: ms.status, ok: ms.data && (ms.data.success === true || ms.data.success === undefined), sample: ms.data ? (ms.data.data || ms.data) : null });

    // 7. trial balance balanced
    const tb = (await db(`SELECT (SELECT COALESCE(SUM(total_debit),0) FROM journal_entries WHERE is_reversed IS NULL OR is_reversed=0) AS d, (SELECT COALESCE(SUM(total_credit),0) FROM journal_entries WHERE is_reversed IS NULL OR is_reversed=0) AS c`))[0];
    line('7] Trial balance', { debit: tb.d, credit: tb.c, balanced: Math.abs(tb.d - tb.c) < 0.01 ? 'PASS' : 'FAIL' });

    console.log('\n══════ done ══════');
    process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });