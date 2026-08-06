// One-time FINANCE-GATED script for the E3 customer cheque lifecycle (ADR E3).
// Actions: deposit | return | cancel. Idempotent, transaction-safe, rollback-on-error.
// READ-ONLY unless --execute --approved (or CONFIRM_FINANCE_APPROVAL=true).
// Usage:
//   node scripts/process_cheque_e3.js --cheque <id> --action <deposit|return|cancel>   (dry-run, default)
//   node scripts/process_cheque_e3.js --cheque 38 --action return --execute --approved
'use strict';

const { getPool, sql } = require('../database/mssql_db');
const {
  getSystemAccountAsync,
  postJournalEntryAsync,
  recalcCustomerBalanceAsync,
} = require('../services/accountingEngine');

const VALID_ACTIONS = ['deposit', 'return', 'cancel'];
const TOLERANCE = 0.01;
const TODAY = () => new Date().toISOString().slice(0, 10);

const argv = process.argv.slice(2);
const get = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
const chequeId = Number(get('cheque') || 0);
const action = get('action');
const isExecute = argv.includes('--execute');
const isApproved = argv.includes('--approved') || /^true$/i.test(process.env.CONFIRM_FINANCE_APPROVAL || '');

if (!chequeId) { console.error('Missing --cheque <id>'); process.exit(1); }
if (!VALID_ACTIONS.includes(action)) { console.error('Invalid/missing --action (deposit|return|cancel)'); process.exit(1); }

let pool;

async function getCheque(req) {
  const r = req.request();
  r.input('id', sql.Int, chequeId);
  const res = await r.query(`SELECT ac.*, ap.payment_no, ap.customer_id AS pay_customer_id,
        c.customer_name, c.current_balance
        FROM ar_cheques ac
        LEFT JOIN ar_payments ap ON ap.id = ac.payment_id
        LEFT JOIN customers c ON c.id = ap.customer_id
        WHERE ac.id = @id`);
  return res.recordset[0];
}

async function setChequeStatus(req, status) {
  const r = req.request();
  r.input('st', sql.NVarChar, status);
  r.input('sd', sql.Date, TODAY());
  r.input('id', sql.Int, chequeId);
  await r.query(`UPDATE ar_cheques SET status=@st, status_date=@sd WHERE id=@id`);
}

async function voidAllocations(req, paymentId) {
  const list = [];
  if (!paymentId) return list;
  const res = await req.request().query(`SELECT id, invoice_id, allocated_amount FROM ar_payment_allocations WHERE payment_id=${paymentId}`);
  for (const a of res.recordset) {
    if (a.invoice_id) {
      const r = req.request();
      r.input('amt', sql.Decimal(18, 2), a.allocated_amount);
      r.input('iid', sql.Int, a.invoice_id);
      await r.query(`UPDATE sales_invoices SET amount_paid=amount_paid-@amt, remaining=remaining+@amt WHERE id=@iid`);
    }
    const v = req.request();
    v.input('aid', sql.Int, a.id);
    await v.query(`UPDATE ar_payment_allocations SET status='void' WHERE id=@aid`);
    list.push(a.invoice_id);
  }
  return list.filter(Boolean);
}

async function refreshInvoiceStatus(req, invoiceId) {
  const inv = (await req.request().query(`SELECT * FROM sales_invoices WHERE id=${invoiceId}`)).recordset[0];
  if (!inv) return;
  const ret = (await req.request().query(`SELECT COALESCE(SUM(grand_total),0) t FROM sales_returns WHERE invoice_id=${invoiceId} AND status NOT IN ('cancelled','deleted')`)).recordset[0].t || 0;
  const allo = (await req.request().query(`SELECT COALESCE(SUM(net_amount),0) t FROM ar_payment_allocations WHERE invoice_id=${invoiceId} AND status='active'`)).recordset[0].t || 0;
  const remaining = Math.max(0, inv.grand_total - allo - ret);
  let status = 'pending';
  if (remaining <= TOLERANCE) status = 'paid';
  else if (allo > 0 || ret > 0) status = 'partial';
  const r = req.request();
  r.input('rem', sql.Decimal(18, 2), remaining);
  r.input('st', sql.NVarChar, status);
  r.input('iid', sql.Int, invoiceId);
  await r.query(`UPDATE sales_invoices SET remaining=@rem, status=@st WHERE id=@iid`);
}

async function markPaymentReversed(req, paymentId) {
  if (!paymentId) return;
  const r = req.request();
  r.input('pid', sql.Int, paymentId);
  r.input('rev', sql.NVarChar, 'reversed');
  r.input('at', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '));
  await r.query(`UPDATE ar_payments SET status=@rev, reversed_at=@at WHERE id=@pid`);
}

async function insertCustomerLog(req, ch, type) {
  if (!ch.customer_id && !ch.pay_customer_id) return;
  const cid = ch.customer_id || ch.pay_customer_id;
  const word = type === 'cheque_deposited' ? 'طھظ… ط¥ظٹط¯ط§ط¹' : type === 'cheque_returned' ? 'طھظ… ط¥ط±ط¬ط§ط¹' : 'طھظ… ط¥ظ„ط؛ط§ط،';
  const r = req.request();
  r.input('cid', sql.Int, cid);
  r.input('ty', sql.NVarChar, type);
  r.input('ds', sql.NVarChar, `${word} ط´ظٹظƒ ${ch.cheque_no} ط¨ظ‚ظٹظ…ط© ${ch.amount}`);
  r.input('rt', sql.NVarChar, 'ar_cheque');
  r.input('ri', sql.Int, chequeId);
  r.input('rn', sql.NVarChar, ch.cheque_no);
  r.input('am', sql.Decimal(18, 4), ch.amount);
  await r.query(`INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                 VALUES (@cid, @ty, @ds, @rt, @ri, @rn, @am, NULL)`);
}

function plan(ch) {
  const L = [];
  L.push('----------------------------------------------------------');
  L.push('ADR-E3 â€” Customer Cheque Lifecycle (Finance-gated)');
  L.push(`Cheque #${ch.cheque_no} (id=${ch.id})  amount=${ch.amount}  status=${ch.status}`);
  L.push(`Payment ${ch.payment_no} (id=${ch.payment_id})  Customer ${ch.customer_name || ch.pay_customer_id} (id=${ch.customer_id || ch.pay_customer_id})  balance=${ch.current_balance}`);
  if (action === 'deposit') {
    L.push(`JE:  Dr SYS_AR_CHEQUES(117) ${ch.amount}   Cr SYS_AR(113) ${ch.amount}   -> status deposited`);
  } else if (action === 'return') {
    L.push(ch.status === 'deposited' ? `JE:  Dr SYS_AR(113) ${ch.amount}   Cr SYS_AR_CHEQUES(117) ${ch.amount}  (reverse deposit)` : 'No JE (not deposited).');
    L.push('Also: void allocations, restore invoices, mark payment reversed, recalc customer balance.');
  } else {
    L.push('No JE (cancelled before deposit).');
    L.push('Also: void allocations, restore invoices, mark payment reversed, recalc customer balance.');
  }
  L.push('----------------------------------------------------------');
  return L.join('\n');
}

async function run() {
  pool = await getPool();
  const ch = await getCheque(pool);
  if (!ch) { console.error(`Cheque id ${chequeId} not found.`); process.exit(1); }

  const target = action === 'deposit' ? 'deposited' : action === 'return' ? 'returned' : 'cancelled';
  if (ch.status === target) {
    console.error(`E3 cheque already processed: status=${ch.status} == target ${target}.`);
    console.error('Aborting.');
    process.exit(1);
  }
  const ok = (action === 'deposit' && ch.status === 'received')
    || (action === 'return' && (ch.status === 'received' || ch.status === 'deposited'))
    || (action === 'cancel' && ch.status === 'received');
  if (!ok) { console.error(`Cannot perform '${action}' on cheque with status '${ch.status}'.`); process.exit(1); }

  console.log(plan(ch));
  if (!isExecute) {
    console.log('\n[DRY-RUN] No database changes made.');
    console.log(`To book: node scripts/process_cheque_e3.js --cheque ${chequeId} --action ${action} --execute --approved`);
    process.exit(0);
  }
  if (!isApproved) {
    console.error('\nExecution requires explicit finance approval.');
    console.error('Pass --approved or set CONFIRM_FINANCE_APPROVAL=true.');
    process.exit(1);
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = tx.request();
    if (action === 'deposit') {
      const accCheques = await getSystemAccountAsync(req, 'SYS_AR_CHEQUES');
      const accAR = await getSystemAccountAsync(req, 'SYS_AR');
      await postJournalEntryAsync(req, TODAY(), `ط¥ظٹط¯ط§ط¹ ط´ظٹظƒ ${ch.cheque_no}`,
        [
          { account_id: accCheques, debit: ch.amount, credit: 0, description: `ط¥ظٹط¯ط§ط¹ ط´ظٹظƒ ${ch.cheque_no}` },
          { account_id: accAR, debit: 0, credit: ch.amount, description: `ط¥ظٹط¯ط§ط¹ ط´ظٹظƒ ${ch.cheque_no}` },
        ],
        'ar_cheque', ch.id, null,
        { module: 'ar_cheques', action: 'deposit', document: `E3-${ch.cheque_no}`, isSystem: true },
        null, ch.customer_id || ch.pay_customer_id);
      await setChequeStatus(req, 'deposited');
      await insertCustomerLog(req, ch, 'cheque_deposited');
    } else if (action === 'return') {
      if (ch.status === 'deposited') {
        const accAR = await getSystemAccountAsync(req, 'SYS_AR');
        const accCheques = await getSystemAccountAsync(req, 'SYS_AR_CHEQUES');
        await postJournalEntryAsync(req, TODAY(), `ط¹ظƒط³ ط¥ظٹط¯ط§ط¹ ط´ظٹظƒ ${ch.cheque_no}`,
          [
            { account_id: accAR, debit: ch.amount, credit: 0, description: `ط¹ظƒط³ ط¥ظٹط¯ط§ط¹ ط´ظٹظƒ ${ch.cheque_no}` },
            { account_id: accCheques, debit: 0, credit: ch.amount, description: `ط¹ظƒط³ ط¥ظٹط¯ط§ط¹ ط´ظٹظƒ ${ch.cheque_no}` },
          ],
          'ar_cheque', ch.id, null,
          { module: 'ar_cheques', action: 'return_deposit', document: `E3-${ch.cheque_no}`, isSystem: true },
          null, ch.customer_id || ch.pay_customer_id);
      }
      const invIds = await voidAllocations(req, ch.payment_id);
      for (const id of invIds) await refreshInvoiceStatus(req, id);
      await markPaymentReversed(req, ch.payment_id);
      await setChequeStatus(req, 'returned');
      await insertCustomerLog(req, ch, 'cheque_returned');
    } else {
      const invIds = await voidAllocations(req, ch.payment_id);
      for (const id of invIds) await refreshInvoiceStatus(req, id);
      await markPaymentReversed(req, ch.payment_id);
      await setChequeStatus(req, 'cancelled');
      await insertCustomerLog(req, ch, 'cheque_cancelled');
    }
    if (ch.customer_id || ch.pay_customer_id) {
      await recalcCustomerBalanceAsync(req, ch.customer_id || ch.pay_customer_id);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    console.error('Failed:', err.message || err);
    process.exit(1);
  }

  const after = await getCheque(pool);
  console.log('\n=== Post-execution report ===');
  console.log(`Cheque status   : ${after.status}`);
  console.log(`Customer balance: ${after.current_balance}`);
  console.log('OK â€” E3 processed.');
}

(async () => {
  try { await run(); process.exit(0); }
  catch (e) { console.error('Unhandled error:', e.message || e); process.exit(1); }
})();
