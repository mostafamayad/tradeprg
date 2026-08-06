const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { login, headers, BASE_URL } = require('../tests/lib/auth');
const { getPool } = require('../database/mssql_db');

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

// Supplier balance is GL-derived (recalcSupplierBalance): opening_balance + SUM(credit-debit) SYS_AP, active non-reversed JEs.
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
  await login();
  const now = today();
  const tag = 'APV4' + Date.now().toString().slice(-6);

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

  // (1) create payment 1200 -> net 1200 (cash, covers invoice fully -> allowed amount==requested)
  const payA = await call('POST', '/ap/payments', {
    supplier_id: sid, payment_date: today(), amount: 1200, payment_method: 'cash',
    apply_to_invoices: [{ id: invIdA, amount: 1200 }] });
  check('A1 POST /ap/payments (create 1200 cash)', payA.status === 201 && payA.data.id, JSON.stringify(payA.data));
  const pidA = Number(payA.data.id);
  let s = await invState(invIdA);
  check('A1 invoice closed (remaining=0, paid) + net=1200 active=1', s.ok && s.cache === 0 && s.status === 'paid', `cache=${s.cache} net=${s.net}`);
  const alloc = await db(`SELECT allocated_amount, discount_amount, net_amount, status FROM ap_payment_allocations WHERE payment_id=@p`, { p: pidA });
  check('A1 allocation persisted (net=allocated, status=active)', alloc.length === 1 && num(alloc[0].net_amount) === num(alloc[0].allocated_amount) && alloc[0].status === 'active', JSON.stringify(alloc[0]));
  await supplierReferee(sid, 'after payment 1200 (should be 0: accrual 1200 - payment 1200)');

  // matching endpoints responsive (read ap_* only)
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
  await supplierReferee(sid, 'after reversal (should be 1200: accrual only)');

  // ── B) discount gold path (net = allocated + discount) ──
  const invB = await call('POST', '/purchases/invoices', {
    supplier_id: sid, invoice_date: today(), due_date: today(), payment_type: 'credit', amount_paid: 0,
    items: [{ product_id: 1, quantity: 2, cost_price: 500 }] }); // grand 1000
  const invIdB = Number(invB.data.invoiceId);
  // Pay 900 cash TARGETED at invoice B (so it lands here, not auto-spread to open invoice A) -> invoice rem 100.
  const payB = await call('POST', '/ap/payments', {
    supplier_id: sid, payment_date: today(), amount: 900, payment_method: 'cash',
    apply_to_invoices: [{ id: invIdB, amount: 900 }] });
  check('B1 partial payment (900 cash) accepted', payB.status === 201 && payB.data.id, JSON.stringify(payB.data));
  const pidB = Number(payB.data.id);
  const sB0 = await invState(invIdB);
  check('B1 invoice partial (rem 100 after 900 cash)', sB0.cache === 100, `cache=${sB0.cache} net=${sB0.net}`);

  // matching/save: close the residual 100 with a discount-only allocation (alloc 0 + disc 100 = net 100)
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
  await supplierReferee(sid, 'final (A=1200 open; B invoice 1000 - pay 900 - disc 100 = 0)');

  const fails = results.filter(r => r[1] === 'FAIL').length;
  const passes = results.length - fails;
  console.log(`\n═══════════════════════════════════════`);
  console.log(`AP PHASE-4 VERIFY: ${passes}/${results.length} PASS`);
  if (fails) console.log(`FAILURES: ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch(err => { console.error('verify_ap_phase4 fatal:', err.message); process.exit(2); });