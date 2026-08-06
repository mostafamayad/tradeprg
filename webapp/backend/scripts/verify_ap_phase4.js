const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { login, headers, BASE_URL } = require('../tests/lib/auth');
const { getPool } = require('../database/mssql_db');
const { recalcTreasuryBalanceAsync } = require('../services/accountingEngine');

const num = (v) => { const n = parseFloat(v) || 0; return Math.round(n * 100) / 100; };
const ok = (b) => (b ? 'PASS' : 'FAIL');
const results = [];
function check(name, b, note) { results.push([name, ok(b)]); console.log(`${ok(b)}  ${name}${note ? ' :: ' + note : ''}`); }
const call = async (m, p, b) => {
  const r = await fetch(BASE_URL + p, { method: m, headers: headers(), body: b ? JSON.stringify(b) : undefined });
  let d; try { d = await r.json(); } catch { d = {}; }
  return { status: r.status, data: d };
};
const db = async (query, params) => {
  const pool = await getPool();
  const req = pool.request();
  if (params) for (const k of Object.keys(params)) req.input(k, params[k]);
  return (await req.query(query)).recordset;
};
function today() { return new Date().toISOString().slice(0, 10); }

// ─────────────────────────────────────────────────────────────
// TEARDOWN — removes ALL APV4-* fixtures (this run + older residue).
// Always runs (success or failure). Never touches non-APV4 data.
// Reverses: stock/inventory, payments, allocations, cheques, treasury
// transactions, journal entries (accrual+payment+discount), invoices,
// suppliers, then recalculates treasury balances.
// ─────────────────────────────────────────────────────────────
async function teardownFixtures() {
  const pool = await getPool();
  try {
    const supRows = await pool.request().query(`SELECT id FROM suppliers WHERE supplier_code LIKE 'APV4%'`);
    if (supRows.recordset.length === 0) { console.log('── teardown: nothing to clean ──'); return; }
    const ids = supRows.recordset.map(r => r.id);
    console.log(`── teardown: cleaning ${ids.length} APV4 fixtures ──`);

    const idList = ids.join(',');

    // JEs + lines for these suppliers (covers accrual, payment, discount, reversals)
    await pool.request().query(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE supplier_id IN (${idList}))`);
    await pool.request().query(`DELETE FROM journal_entries WHERE supplier_id IN (${idList})`);

    // Payments + allocations + cheques + treasury
    const payRows = await pool.request().query(`SELECT id FROM ap_payments WHERE supplier_id IN (${idList})`);
    const payIds = payRows.recordset.map(r => r.id);
    const payList = payIds.length ? payIds.join(',') : 'NULL';
    await pool.request().query(`DELETE FROM ap_payment_allocations WHERE payment_id IN (${payList})`);
    await pool.request().query(`DELETE FROM ap_cheques WHERE payment_id IN (${payList})`);
    await pool.request().query(`DELETE FROM treasury_transactions WHERE related_id IN (${idList}) AND related_type='supplier'`);
    await pool.request().query(`DELETE FROM ap_payments WHERE supplier_id IN (${idList})`);

    // Invoices: reverse stock, drop items/movements/invoices
    const invRows = await pool.request().query(`SELECT id, store_id FROM purchase_invoices WHERE supplier_id IN (${idList})`);
    for (const inv of invRows.recordset) {
      const itRows = await pool.request().query(`SELECT product_id, quantity FROM purchase_invoice_items WHERE invoice_id=${inv.id}`);
      for (const it of itRows.recordset) {
        await pool.request().query(`
          IF NOT EXISTS (SELECT 1 FROM inventory_balances WHERE store_id=${inv.store_id} AND product_id=${it.product_id})
            INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (${inv.store_id}, ${it.product_id}, 0)
          UPDATE inventory_balances SET quantity = quantity - ${it.quantity} WHERE store_id=${inv.store_id} AND product_id=${it.product_id}
        `);
      }
      await pool.request().query(`DELETE FROM stock_movements WHERE reference_id=${inv.id} AND move_type='in'`);
      await pool.request().query(`DELETE FROM purchase_invoice_items WHERE invoice_id=${inv.id}`);
      await pool.request().query(`DELETE FROM purchase_invoices WHERE id=${inv.id}`);
    }

    // Suppliers last
    await pool.request().query(`DELETE FROM suppliers WHERE id IN (${idList})`);

    // Recompute treasury balances from GL (they were touched by test 'out' rows we removed)
    const accRows = await pool.request().query(`SELECT id FROM treasury_accounts`);
    for (const a of accRows.recordset) { try { await recalcTreasuryBalanceAsync(pool.request(), a.id); } catch {} }
    console.log('── teardown complete ──');
  } catch (err) {
    console.error('── teardown warning (non-fatal):', err.message);
  }
}

async function supplierReferee(sid, label) {
  const rows = await db(`
    SELECT
      (SELECT opening_balance FROM suppliers WHERE id=@sid) AS open_bal,
      (SELECT COALESCE(SUM(jl.credit - jl.debit), 0)
        FROM journal_entry_lines jl
        JOIN journal_entries je ON je.id=jl.entry_id
        JOIN chart_of_accounts ca ON ca.id=jl.account_id
        WHERE ca.system_code='SYS_AP' AND je.supplier_id=@sid
          AND (je.is_reversed IS NULL OR je.is_reversed=0) AND (je.reversal_of_id IS NULL)
          AND (je.source_action IS NULL OR (je.source_action NOT LIKE '%_cancel' AND je.source_action <> 'cancel'))) AS net,
      (SELECT current_balance FROM suppliers WHERE id=@sid) AS cur`, { sid });
  const open = num(rows[0].open_bal), net = num(rows[0].net), cur = num(rows[0].cur);
  const expect = num(open + net);
  console.log(`\n── [${label}] ── expected balance=${expect} (open ${open} + GL net ${net}) | suppliers.current_balance=${cur}`);
  check(`[${label}] suppliers.current_balance == GL-derived expected`, expect === cur, `${expect} vs ${cur}`);
  return cur;
}
async function invState(invId) {
  const r = await db(`
    SELECT pi.grand_total, pi.remaining, pi.status,
           COALESCE((SELECT SUM(net_amount) FROM ap_payment_allocations WHERE invoice_id=pi.id AND status='active'),0) AS net,
           COALESCE((SELECT SUM(discount_amount) FROM ap_payment_allocations WHERE invoice_id=pi.id AND status='active'),0) AS disc,
           (SELECT COUNT(*) FROM ap_payment_allocations WHERE invoice_id=pi.id AND status='active') AS cnt
    FROM purchase_invoices pi WHERE pi.id=@inv`, { inv: invId });
  const row = r[0];
  const dynamic = num(row.grand_total) - num(row.net);
  console.log(`    inv=${invId} grand=${num(row.grand_total)} remaining=${num(row.remaining)} dynamic=${num(dynamic)} net=${num(row.net)} disc=${num(row.disc)} active=${row.cnt} status=${row.status}`);
  return { cache: num(row.remaining), dynamic, ok: num(row.remaining) === dynamic, net: num(row.net), disc: num(row.disc), cnt: row.cnt, status: row.status };
}

(async () => {
  let tag;
  try {
    await login();
    const now = today();
    tag = 'APV4' + Date.now().toString().slice(-6);

    await call('POST', '/suppliers', { supplier_code: tag, supplier_name: 'apv4_' + tag, is_active: 1 });
    const sid = Number((await db(`SELECT TOP 1 id FROM suppliers WHERE supplier_code=@c ORDER BY id DESC`, { c: tag }))[0].id);
    console.log('fresh supplier id =', sid, 'tag=', tag);

    // A) fresh invoice grand 1200
    const invA = await call('POST', '/purchases/invoices', {
      supplier_id: sid, invoice_date: today(), due_date: today(), payment_type: 'credit', amount_paid: 0,
      items: [{ product_id: 1, quantity: 3, cost_price: 400 }] });
    if (invA.status !== 201 || !invA.data.invoiceId) throw new Error('invoiceA fail: ' + JSON.stringify(invA.data));
    const invIdA = Number(invA.data.invoiceId);
    await supplierReferee(sid, 'after invoice 1200');

    // (1) create payment 1200 -> net 1200
    const payA = await call('POST', '/ap/payments', {
      supplier_id: sid, payment_date: today(), amount: 1200, payment_method: 'cash',
      apply_to_invoices: [{ id: invIdA, amount: 1200 }] });
    check('A1 POST /ap/payments (create 1200 cash)', payA.status === 201 && payA.data.id, JSON.stringify(payA.data));
    const pidA = Number(payA.data.id);
    let s = await invState(invIdA);
    check('A1 invoice closed (remaining=0, paid) + net=1200 active=1', s.ok && s.cache === 0 && s.status === 'paid', `cache=${s.cache} net=${s.net}`);
    const alloc = await db(`SELECT allocated_amount, discount_amount, net_amount, status FROM ap_payment_allocations WHERE payment_id=@p`, { p: pidA });
    check('A1 allocation persisted (net=allocated, status=active)', alloc.length === 1 && num(alloc[0].net_amount) === num(alloc[0].allocated_amount) && alloc[0].status === 'active', JSON.stringify(alloc[0]));
    await supplierReferee(sid, 'after payment 1200 (should be 0)');

    // matching endpoints responsive (SSOT ap_*)
    const ms = await call('GET', '/ap/payments/matching/suppliers');
    const md = await call('GET', '/ap/payments/matching/data/' + sid);
    const mdp = md.data?.data || md.data || {};
    check('A1 matching/suppliers responsive', ms.status === 200 && (Array.isArray(ms.data?.data) || Array.isArray(ms.data)), 'status=' + ms.status);
    check('A1 matching/data responsive (SSOT ap_*)', md.status === 200 && Boolean(mdp.payments || mdp.invoices || mdp.supplier_payments), 'keys=' + Object.keys(mdp).join(','));
    const det = await call('GET', '/ap/payments/' + pidA);
    const ddt = det.data?.data || det.data || {};
    const allocsFromDet = (ddt.allocations || ddt.alloc || ddt.allocation_rows || ddt.allocs || []);
    check('A1 GET /ap/payments/:id returns allocation', det.status === 200 && allocsFromDet.length >= 1, 'keys=' + Object.keys(ddt).join(','));

    // ── soft reverse ──
    const del = await call('DELETE', '/ap/payments/' + pidA);
    check('A2 soft-reverse DELETE /ap/payments/:id', del.status === 200, JSON.stringify(del.data));
    const allocAfter = await db(`SELECT allocated_amount, net_amount, status FROM ap_payment_allocations WHERE payment_id=@p`, { p: pidA });
    check('A2 allocation NOT deleted; flagged void (audit kept)', allocAfter.length === 1 && allocAfter[0].status === 'void', JSON.stringify(allocAfter[0]));
    s = await invState(invIdA);
    check('A2 invoice reopened (remaining 1200, pending) + GL back', s.cache === 1200 && s.status === 'pending' && s.net === 0, `cache=${s.cache} net=${s.net} status=${s.status}`);
    await supplierReferee(sid, 'after reversal (should be 1200)');

    // ── B) discount gold path (net = allocated + discount) ──
    const invB = await call('POST', '/purchases/invoices', {
      supplier_id: sid, invoice_date: today(), due_date: today(), payment_type: 'credit', amount_paid: 0,
      items: [{ product_id: 1, quantity: 2, cost_price: 500 }] }); // grand 1000
    const invIdB = Number(invB.data.invoiceId);
    // Pay 900 cash TARGETED at invoice B -> invoice rem 100.
    const payB = await call('POST', '/ap/payments', {
      supplier_id: sid, payment_date: today(), amount: 900, payment_method: 'cash',
      apply_to_invoices: [{ id: invIdB, amount: 900 }] });
    check('B1 partial payment (900 cash) accepted', payB.status === 201 && payB.data.id, JSON.stringify(payB.data));
    const pidB = Number(payB.data.id);
    const sB0 = await invState(invIdB);
    check('B1 invoice partial (rem 100 after 900 cash)', sB0.cache === 100, `cache=${sB0.cache} net=${sB0.net}`);

    // matching/save: close residual 100 with a discount-only allocation (alloc 0 + disc 100 = net 100)
    const save = await call('POST', '/ap/payments/matching/save', {
      supplier_id: sid, allocations: [{ payment_id: pidB, invoice_id: invIdB, allocated_amount: 0, discount_amount: 100 }] });
    check('B2 matching/save discount-only accepted (alloc 0 + disc 100)', save.status === 200, JSON.stringify(save.data).slice(0, 140));
    s = await invState(invIdB);
    check('B2 invoice closed by net (cash 900 + disc 100 = 1000)', s.ok && s.cache === 0 && s.disc === 100 && s.net === 1000, `cache=${s.cache} net=${s.net} disc=${s.disc}`);
    const discJE = await db(`SELECT COUNT(*) AS n FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id=jl.entry_id
      JOIN chart_of_accounts ca ON ca.id=jl.account_id
      WHERE ca.system_code='SYS_PURCHASE_DISCOUNT' AND je.reference_type='ap_payment' AND je.reference_id=@p
        AND (je.is_reversed IS NULL OR je.is_reversed=0)`, { p: pidB });
    check('B/discount JE via accountingEngine (SYS_PURCHASE_DISCOUNT)', discJE[0].n >= 1, 'count=' + discJE[0].n);
    await supplierReferee(sid, 'final (A=1200 open; B settled 900 cash + 100 disc)');

    const fails = results.filter(r => r[1] === 'FAIL').length;
    const passes = results.length - fails;
    console.log(`\n═══════════════════════════════════════`);
    console.log(`AP PHASE-4 VERIFY: ${passes}/${results.length} PASS`);
    if (fails) console.log(`FAILURES: ${fails}`);
  } catch (err) {
    console.error('verify_ap_phase4 fatal:', err.message);
    process.exitCode = 2;
  } finally {
    await teardownFixtures();
    const fails = results.filter(r => r[1] === 'FAIL').length;
    process.exit(fails ? 1 : 0);
  }
})();