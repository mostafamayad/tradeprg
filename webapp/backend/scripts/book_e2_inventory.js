// One-time finance-gated script for Opening Inventory Reconciliation (ADR E2).
// IDEMPOTENT + READ-ONLY unless --execute --approved (or CONFIRM_FINANCE_APPROVAL=true).
// Usage:
//   node scripts/book_e2_adjustment.js --dry-run                     (default, no writes)
//   node scripts/book_e2_adjustment.js --execute --approved
//   CONFIRM_FINANCE_APPROVAL=true node scripts/book_e2_adjustment.js --execute
'use strict';

const { getPool, sql } = require('../database/mssql_db');
const { getSystemAccountAsync, postJournalEntryAsync } = require('../services/accountingEngine');

const REF_TYPE = 'opening_inventory_reconciliation';
const DOCUMENT = 'ADR_E2';
const DESCRIPTION = 'Finance-approved inventory opening reconciliation (ADR E2)';
const TOLERANCE = 0.01; // money

const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isApproved = args.includes('--approved') || /^true$/i.test(process.env.CONFIRM_FINANCE_APPROVAL || '');

const ACTIVE_JE = `
  (je.is_reversed IS NULL OR je.is_reversed=0)
  AND (je.reversal_of_id IS NULL)`;

const INV_VALUE_SQL = `SELECT
  (SELECT ROUND(SUM(ib.quantity * p.cost_price), 2)
     FROM inventory_balances ib
     JOIN products p ON p.id = ib.product_id) AS stock_value,
  (SELECT ROUND(SUM(jl.debit - jl.credit), 2)
     FROM journal_entry_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     JOIN chart_of_accounts ca ON ca.id = jl.account_id
     WHERE ca.system_code = 'SYS_INVENTORY' AND ${ACTIVE_JE}) AS gl_inventory,
  (SELECT ROUND(SUM(jl.debit - jl.credit), 2)
     FROM journal_entry_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     JOIN chart_of_accounts ca ON ca.id = jl.account_id
     WHERE ca.system_code = 'SYS_RETAINED_EARNINGS' AND ${ACTIVE_JE}) AS gl_equity`;

async function getInventoryState(pool) {
  const res = await pool.request().query(INV_VALUE_SQL);
  const r = res.recordset[0];
  return {
    stock_value: parseFloat(r.stock_value) || 0,
    gl_inventory: parseFloat(r.gl_inventory) || 0,
    gl_equity: parseFloat(r.gl_equity) || 0,
    difference: Math.round(((r.stock_value || 0) - (r.gl_inventory || 0)) * 100) / 100,
  };
}

async function alreadyPosted(pool) {
  const res = await pool.request()
    .input('ref', sql.NVarChar, REF_TYPE)
    .query(`SELECT je.id, je.entry_date FROM journal_entries je
            WHERE je.reference_type = @ref AND ${ACTIVE_JE}`);
  return res.recordset;
}

function printProposal(s, amount) {
  console.log('==========================================================');
  console.log('ADR-E2 â€” Opening Inventory Reconciliation (Finance-gated)');
  console.log('==========================================================');
  console.log(`Inventory Value (wx.cost) : ${s.stock_value.toFixed(2)}`);
  console.log(`GL Inventory (114)        : ${s.gl_inventory.toFixed(2)}`);
  console.log(`Difference                 : ${s.difference.toFixed(2)}`);
  console.log('----------------------------------------------------------');
  console.log('Proposed journal entry:');
  if (s.difference > 0) {
    console.log(`  Dr  SYS_INVENTORY (114)        ${amount.toFixed(2)}`);
    console.log(`      Cr SYS_RETAINED_EARN (32)       ${amount.toFixed(2)}`);
  } else {
    console.log(`  Dr  SYS_RETAINED_EARNINGS (32) ${amount.toFixed(2)}`);
    console.log(`      Cr SYS_INVENTORY (114)         ${amount.toFixed(2)}`);
  }
  console.log(`  reference_type   : ${REF_TYPE}   (idempotent key)`);
  console.log(`  reference_doc    : ${DOCUMENT}`);
  console.log(`  description      : ${DESCRIPTION}`);
  console.log('----------------------------------------------------------');
  console.log('Impact:');
  console.log(`  Balance Sheet: Inventory +${(s.difference >= 0 ? s.difference : -s.difference).toFixed(2)}; Equity ${s.difference >= 0 ? '+' : '-'}${Math.abs(s.difference).toFixed(2)}`);
  console.log(`  P&L            : neutral (booked to retained earnings, not income)`);
}

async function trialBalance(pool) {
  const res = await pool.request().query(`
    SELECT ca.account_type, ROUND(SUM(jl.debit),2) d, ROUND(SUM(jl.credit),2) c
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN chart_of_accounts ca ON ca.id = jl.account_id
    WHERE ${ACTIVE_JE}
    GROUP BY ca.account_type`);
  const rows = res.recordset;
  let totD = 0, totC = 0;
  for (const r of rows) { totD += r.d; totC += r.c; }
  return { rows, total_debit: totD, total_credit: totC };
}

async function run() {
  const pool = await getPool();

  const s = await getInventoryState(pool);
  const amount = Math.abs(s.difference);

  // 1) IDEMPOTENCY GUARD
  const existing = await alreadyPosted(pool);
  if (existing.length > 0) {
    console.log(`E2 adjustment already posted (JE id ${existing.map(e => e.id).join(', ')}).`);
    console.log('Aborting.');
    process.exit(1);
  }

  if (s.difference > -TOLERANCE && s.difference < TOLERANCE) {
    console.log('Inventory value already reconciles to GL. Difference: 0.00.');
    console.log('Nothing to book. Exiting.');
    process.exit(0);
  }

  printProposal(s, amount);

  if (!isExecute) {
    console.log('\n[DRY-RUN] No database changes made.');
    console.log('To book, run: node scripts/book_e2_inventory.js --execute --approved');
    process.exit(0);
  }

  if (!isApproved) {
    console.log('\nExecution requires explicit finance approval.');
    console.log('Pass --approved or set CONFIRM_FINANCE_APPROVAL=true.');
    process.exit(1);
  }

  // 2) EXECUTE (requires approval) inside a transaction
  let tx;
  try {
    tx = new sql.Transaction(pool);
    await tx.begin();
    const txReq = tx.request();

    const accInv = await getSystemAccountAsync(txReq, 'SYS_INVENTORY');
    const accRE = await getSystemAccountAsync(txReq, 'SYS_RETAINED_EARNINGS');
    if (!accInv || !accRE) throw new Error('Cannot resolve SYS_INVENTORY / SYS_RETAINED_EARNINGS');

    let lines;
    if (s.difference > 0) {
      lines = [
        { account_id: accInv, debit: amount, credit: 0, description: 'Finance-approved inventory opening reconciliation' },
        { account_id: accRE, debit: 0, credit: amount, description: 'Finance-approved inventory opening reconciliation (ADR E2)' },
      ];
    } else {
      lines = [
        { account_id: accRE, debit: amount, credit: 0, description: 'Finance-approved inventory opening reconciliation' },
        { account_id: accInv, debit: 0, credit: amount, description: 'Finance-approved inventory opening reconciliation (ADR E2)' },
      ];
    }

    await postJournalEntryAsync(
      txReq, new Date().toISOString().slice(0, 10), DESCRIPTION, lines,
      REF_TYPE, null, null,
      { module: 'accounting', action: 'opening_inventory_adjustment', document: DOCUMENT, isSystem: true, bypassPeriodLock: true }
    );
    await tx.commit();
  } catch (err) {
    if (tx) await tx.rollback();
    console.error('Failed to book E2 adjustment:', err.message || err);
    process.exit(1);
  }

  // 3) POST-EXECUTION VERIFICATION
  console.log('\nPosting JE...');
  const after = await getInventoryState(pool);
  console.log('\n=== Post-execution report ===');
  console.log(`Inventory Value Before: ${s.stock_value.toFixed(2)}`);
  console.log(`GL Inventory Before   : ${s.gl_inventory.toFixed(2)}`);
  console.log(`Inventory Value After : ${after.stock_value.toFixed(2)}`);
  console.log(`GL Inventory After    : ${after.gl_inventory.toFixed(2)}`);
  const finalDiff = after.difference;
  console.log(`Difference            : ${finalDiff.toFixed(2)}`);
  console.log(finalDiff === 0 ? 'PASS' : 'FAIL (>0)');

  const tb = await trialBalance(pool);
  console.log(`\nTrial Balance: Debits=${tb.tot_debit.toFixed(2)} Credits=${tb.tot_credit.toFixed(2)} -> ${tb.tot_debit === tb.tot_credit ? 'BALANCED' : 'UNBALANCED'}`);

  // Full reconciliation/audit is delegated to scripts/post_adjustment_verification.js (read-only).
  process.exit(finalDiff === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Unhandled error:', err && err.message ? err.message : err);
  process.exit(1);
});
