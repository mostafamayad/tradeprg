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
  const r = await req.query(query);
  return r.recordset;
};
function today() { return new Date().toISOString().slice(0, 10); }

async function reconc(cid, label) {
  const rows = await db(`
    SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS gl_net,
           (SELECT current_balance FROM customers WHERE id=@cid) AS cur
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id=jl.entry_id
    JOIN chart_of_accounts ca ON ca.id=jl.account_id
    WHERE ca.system_code='SYS_AR' AND je.customer_id=@cid
      AND (je.is_reversed IS NULL OR je.is_reversed=0) AND (je.reversal_of_id IS NULL)
      AND (je.source_action IS NULL OR (je.source_action NOT LIKE '%_cancel' AND je.source_action <> 'cancel'))
  `, { cid });
  const gl_net = num(rows[0].gl_net);
  const cur = num(rows[0].cur);
  console.log(`\n── [${label}] reconcile ── SYS_AR GL net=${gl_net} | customers.current_balance=${cur}`);
  check(`[${label}] SYS_AR == current_balance (GL referee)`, gl_net === cur, `${gl_net} vs ${cur}`);
  return { gl_net, cur };
}

async function invDue(invId) {
  const r = await db(`
    SELECT si.grand_total, si.remaining, si.status,
           COALESCE((SELECT SUM(COALESCE(discount_amount,0)) FROM ar_payment_allocations WHERE invoice_id=si.id AND status='active'),0) AS disc,
           COALESCE((SELECT SUM(net_amount) FROM ar_payment_allocations WHERE invoice_id=si.id AND status='active'),0) AS net,
           (SELECT COUNT(*) FROM ar_payment_allocations WHERE invoice_id=si.id AND status='active') AS cnt
    FROM sales_invoices si WHERE si.id=@inv`, { inv: invId });
  const row = r[0];
  const dynamic = num(row.grand_total) - num(row.net);
  const okCache = num(row.remaining) === dynamic;
  console.log(`    inv=${invId} grand=${num(row.grand_total)} remaining=${num(row.remaining)} dynamic=${num(dynamic)} net=${num(row.net)} disc=${num(row.disc)} cnt=${row.cnt} status=${row.status}`);
  return { cache: num(row.remaining), dynamic, ok: okCache, disc: num(row.disc), cnt: row.cnt, status: row.status };
}

(async () => {
  await login();
  const now = today();

  await call('POST', '/customers', { customer_code: 'PROMOTE2', customer_name: 'promote2', customer_type: 'retail', is_active: 1 });
  const crow = await db(`SELECT TOP 1 id FROM customers WHERE customer_code='PROMOTE2' ORDER BY id DESC`);
  const cid = Number(crow[0].id);
  console.log('fresh customer id =', cid);

  // (1) pure credit invoice: grand 5000, no upfront payment
  const inv = await call('POST', '/sales/invoices', {
    customer_id: cid, invoice_date: now, due_date: now, store_id: 1, payment_type: 'credit',
    items: [{ product_id: 1, quantity: 5, unit_price: 1000, discount_pct: 0 }], amount_paid: 0 });
  if (inv.status !== 201 || !inv.data.invoiceId) throw new Error('invoice fail: ' + JSON.stringify(inv.data));
  const invId = Number(inv.data.invoiceId);
  let r = await reconc(cid, '1] credit invoice 5000');
  let d = await invDue(invId);
  check('1] GL == balance', r.gl_net === r.cur);
  check('1] invoice remaining == dynamic (5000)', d.ok && d.cache === 5000);

  // (2) independent AR voucher 1000 (unallocated)
  const p1 = await call('POST', '/ar/payments', { customer_id: cid, amount: 1000, payment_method: 'cash', payment_date: now, notes: 'independent' });
  const p1Id = p1.data.id || (await db(`SELECT TOP 1 id FROM ar_payments WHERE customer_id=@c ORDER BY id DESC`, { c: cid }))[0].id;
  r = await reconc(cid, '2] independent voucher 1000 (GL 4000)');
  check('2] GL == balance', r.gl_net === r.cur);

  // (3) full match of P1: allocate 1000
  const m1 = await call('POST', '/ar/payments/matching/save', { customer_id: cid, allocations: [{ payment_id: p1Id, invoice_id: invId, allocated_amount: 1000, discount_amount: 0 }] });
  if (m1.status !== 200 || !m1.data.success) throw new Error('partial match fail: ' + JSON.stringify(m1.data));
  await reconc(cid, '3] match P1 (1000)');
  d = await invDue(invId);
  check('3] invoice remaining == dynamic (4000)', d.ok && d.cache === 4000);

  // (4) full match on new voucher with discount: 3900 cash + 100 discount = net 4000
  const p2 = await call('POST', '/ar/payments', { customer_id: cid, amount: 3900, payment_method: 'cash', payment_date: now, notes: 'discount-match' });
  const p2Id = p2.data.id || (await db(`SELECT TOP 1 id FROM ar_payments WHERE customer_id=@c ORDER BY id DESC`, { c: cid }))[0].id;
  const m2 = await call('POST', '/ar/payments/matching/save', { customer_id: cid, allocations: [{ payment_id: p2Id, invoice_id: invId, allocated_amount: 3900, discount_amount: 100 }] });
  if (m2.status !== 200 || !m2.data.success) throw new Error('discount match fail: ' + JSON.stringify(m2.data));
  await reconc(cid, '4] full match + discount (net 2800)');
  d = await invDue(invId);
  check('4] invoice fully paid', d.cache === 0 && d.status === 'paid');
  check('4] discount recorded on allocation', d.disc === 100);

  // matching-status + statement
  const ms = await call('GET', '/reports/ar-matching-status', null);
  const msRow = (Array.isArray(ms.data && ms.data.data) ? ms.data.data : []).find(x => Number(x.id) === invId);
  check('4] matching-status (discount=100 net=5000 count=2)', !!msRow && Number(msRow.discount_amount) === 100 && Math.round(Number(msRow.net_allocated)) === 5000 && Number(msRow.allocation_count) === 2);
  const st = await call('GET', `/collections/customer/${cid}/statement`, null);
  const stRows = Array.isArray(st.data && st.data.data && st.data.data.rows) ? st.data.data.rows : [];
  const withAlloc = stRows.filter(x => x.ref_type === 'collection' && Array.isArray(x.allocations) && x.allocations.length > 0);
  check('4] statement ARP rows have allocation drill-down', withAlloc.length >= 2, 'rows with alloc=' + withAlloc.length);

  // (5) undo matching: delete the discount voucher
  const del2 = await call('DELETE', `/ar/payments/${p2Id}`, null);
  check('5] delete discount voucher', del2.data && del2.data.success);
  r = await reconc(cid, '5] undo (delete discount voucher)');
  d = await invDue(invId);
  check('5] invoice restored', d.ok && d.cache === 4000);
  check('5] GL == balance after reverse', r.gl_net === r.cur);

  // (6) delete independent voucher P1
  const del1 = await call('DELETE', `/ar/payments/${p1Id}`, null);
  check('6] delete independent voucher', del1.data && del1.data.success);
  r = await reconc(cid, '6] delete independent voucher');
  d = await invDue(invId);
  check('6] invoice fully restored (5000)', d.ok && d.cache === 5000);

  // (7) re-match full without discount
  const p3 = await call('POST', '/ar/payments', { customer_id: cid, amount: 5000, payment_method: 'cash', payment_date: now, notes: 'rematch' });
  const p3Id = p3.data.id || (await db(`SELECT TOP 1 id FROM ar_payments WHERE customer_id=@c ORDER BY id DESC`, { c: cid }))[0].id;
  const m3 = await call('POST', '/ar/payments/matching/save', { customer_id: cid, allocations: [{ payment_id: p3Id, invoice_id: invId, allocated_amount: 5000, discount_amount: 0 }] });
  check('7] re-match full', m3.status === 200 && m3.data.success);
  d = await invDue(invId);
  check('7] invoice paid after rematch', d.cache === 0 && d.status === 'paid');
  r = await reconc(cid, '7] final state');
  check('7] final GL == balance == current_balance', r.gl_net === r.cur);

  const failed = results.filter((x) => x[1] === 'FAIL').length;
  console.log(`\n==== MANUAL PROMOTION: ${results.length} checks, ${results.length - failed} pass, ${failed} FAIL ====`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('MANUAL FATAL', e && e.message); process.exit(1); });