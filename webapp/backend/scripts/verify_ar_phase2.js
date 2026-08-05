#!/usr/bin/env node
/**
 * PHASE 2 VERIFICATION — Discount-capable matching, single-source drill-down.
 *
 * Proves the Allocation Engine is the only source of truth:
 *  1. ar_payment_allocations stores discount_amount + net_amount (net = allocated + discount).
 *  2. Dynamic remaining = grand_total - SUM(net) - returns (no reliance on stale cache).
 *  3. POST /ar/payments/matching/save with a discount works end-to-end.
 *  4. GET /reports/ar-matching-status reads ar_payment_allocations (net-based, allocation_count).
 *  5. Customer statement drills down into allocation detail per AR payment.
 *  6. Legacy tables (customer_collections / collection_allocations) stay untouched.
 *
 * Usage: node scripts/verify_phase2.js
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
const ok = (b) => b ? 'PASS' : 'FAIL';
const results = [];
function check(name, b) { results.push([name, ok(b)]); console.log(`${ok(b)}  ${name}`); }

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

    // 1. Credit invoice (grand_total 230)
    const inv = await post('/sales/invoices', {
        customer_id: customerId, invoice_date: today, due_date: today, store_id: storeId,
        payment_type: 'credit',
        items: [{ product_id: prodA, quantity: 1, unit_price: 230, discount_pct: 0 }],
        amount_paid: 0
    });
    if (inv.status !== 201 || !inv.data.invoiceId) throw new Error(`invoice failed: ${inv.status} ${JSON.stringify(inv.data)}`);
    const invoiceId = Number(inv.data.invoiceId);
    line('1] credit invoice created', inv.data);

    // 2. Unallocated AR payment of 700
    const pay = await post('/ar/payments', {
        customer_id: customerId, amount: 700, payment_method: 'cash', payment_date: today, notes: 'verify_phase2'
    });
    if (![200, 201].includes(pay.status) || !pay.data.success) throw new Error(`payment failed: ${pay.status} ${JSON.stringify(pay.data)}`);
    const payNo = pay.data.payment_no || pay.data.collection_no;
    const payRow = (await db(`SELECT id, payment_no FROM ar_payments WHERE payment_no = @p`, { p: payNo }))[0];
    if (!payRow) throw new Error('ar_payments row not found');
    line('2] unallocated AR payment', { payNo, paymentId: payRow.id });

    // 3. Matching/save with a discount: cash 700 + discount 20 => net 720, but invoice grand_total 230.
    //    To allow a real discount <= remaining, allocate exactly 210 cash + 20 discount = net 230 (fully settles invoice).
    const alloc = await post('/ar/payments/matching/save', {
        customer_id: customerId,
        allocations: [{ payment_id: payRow.id, invoice_id: invoiceId, allocated_amount: 210, discount_amount: 20 }]
    });
    line('3] matching/save (alloc 210 + discount 20)', alloc);
    if (alloc.status !== 200 || !alloc.data.success) throw new Error(`matching/save failed: ${alloc.status} ${JSON.stringify(alloc.data)}`);

    // 4. Allocation row persisted with discount + net
    const rows = await db(`SELECT id, payment_id, invoice_id, allocated_amount, discount_amount, net_amount, created_at FROM ar_payment_allocations WHERE payment_id = @pid`, { pid: payRow.id });
    line('4] persisted allocation row', rows);
    if (!rows.length) throw new Error('no allocation row');
    const al = rows[0];
    check('allocation stored discount_amount', Number(al.discount_amount) === 20);
    check('allocation net_amount = allocated + discount', Number(al.net_amount) === 230);
    check('allocation has created_at', al.created_at != null);

    // 5. Invoice dynamic remaining and cache
    const invState = (await db(`SELECT grand_total, amount_paid, remaining, status FROM sales_invoices WHERE id = @i`, { i: invoiceId }))[0];
    check('invoice paid', invState.status === 'paid');
    check('invoice cache remaining = 0 (agree with dynamic)', Number(invState.remaining) === 0);

    // Dynamic remaining recompute from allocations
    const dyn = (await db(`
        SELECT si.grand_total,
               COALESCE((SELECT SUM(net_amount) FROM ar_payment_allocations WHERE invoice_id = si.id),0) AS net,
               si.grand_total - COALESCE((SELECT SUM(net_amount) FROM ar_payment_allocations WHERE invoice_id = si.id),0) AS remaining
        FROM sales_invoices si WHERE si.id = @i`, { i: invoiceId }))[0];
    check('dynamic remaining = 0 (grand_total - SUM(net))', Math.round(Number(dyn.remaining) * 100) / 100 === 0);

    // 6. matching/data no longer lists the fully-paid invoice (dynamic filter)
    const md = await call('GET', `/ar/payments/matching/data/${customerId}`, null);
    const mdInv = Array.isArray(md.data && md.data.data && md.data.data.invoices) ? md.data.data.invoices : [];
    check('fully-paid invoice excluded from matching list', !mdInv.some(x => Number(x.id) === invoiceId));

    // 7. ar-matching-status reads ar_payment_allocations (net-based, allocation_count)
    const ms = await call('GET', `/reports/ar-matching-status`, null);
    const msInv = (Array.isArray(ms.data && ms.data.data) ? ms.data.data : []).find(x => Number(x.id) === invoiceId);
    line('6] /reports/ar-matching-status row', msInv);
    check('ar-matching-status includes invoice', !!msInv);
    if (msInv) {
        check('matching-status allocation_count=1', Number(msInv.allocation_count) === 1);
        check('matching-status discount_amount=20', Math.round(Number(msInv.discount_amount) * 100) / 100 === 20);
        check('matching-status net_allocated=230', Math.round(Number(msInv.net_allocated) * 100) / 100 === 230);
        check('matching-status remaining=0', Math.round(Number(msInv.remaining) * 100) / 100 === 0);
    }

    // 8. Statement drill-down: ar_payment row has allocations[]
    const st = await call('GET', `/collections/customer/${customerId}/statement`, null);
    const stRows = Array.isArray(st.data && st.data.data && st.data.data.rows) ? st.data.data.rows : [];
    const arpRow = stRows.find(r => r.ref_type === 'collection' && Number(r.ref_id) === Number(payRow.id));
    check('statement has AR payment row with ref_type=collection', !!arpRow);
    if (arpRow) {
        const hasAlloc = Array.isArray(arpRow.allocations) && arpRow.allocations.length >= 1
            && arpRow.allocations.some(a => Number(a.invoice_id) === invoiceId && Math.round(Number(a.net_amount) * 100) / 100 === 230);
        check('statement ARP row shows allocation detail (inv + net=230)', !!hasAlloc);
    }

    // 9. Legacy tables untouched (single-source proof)
    const after = {
        customer_collections: await COUNT('customer_collections'),
        collection_allocations: await COUNT('collection_allocations')
    };
    const deltaLegacy = (after.customer_collections - before.customer_collections) + (after.collection_allocations - before.collection_allocations);
    check('legacy tables untouched (delta=0)', deltaLegacy === 0);

    // 10. Trial balance balanced
    const tb = (await db(`SELECT (SELECT COALESCE(SUM(total_debit),0) FROM journal_entries WHERE is_reversed IS NULL OR is_reversed=0) AS d, (SELECT COALESCE(SUM(total_credit),0) FROM journal_entries WHERE is_reversed IS NULL OR is_reversed=0) AS c`))[0];
    check('trial balance balanced', Math.abs(Number(tb.d) - Number(tb.c)) < 0.01);

    console.log('\n───── PHASE 2 VERIFICATION SUMMARY ─────');
    let fails = 0;
    for (const [n, r] of results) { console.log(`  ${r}  ${n}`); if (r === 'FAIL') fails++; }
    console.log(`${results.length} checks · ${results.length - fails} passed · ${fails} failed`);
    console.log('\n══════ done ══════');
    process.exit(fails > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });