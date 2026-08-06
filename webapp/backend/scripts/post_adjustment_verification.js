// POST-ADJUSTMENT VERIFICATION (READ-ONLY). Run AFTER any finance-approved adjustment
// (E2 gateway or E3 cheque lifecycle) to prove the system remained balanced.
// This script NEVER writes to the database and NEVER auto-fixes anything.
// On any failed check it ends with OVERALL RESULT: FAILED and lists the failures.
// Usage:
//   node scripts/post_adjustment_verification.js
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getPool } = require('../database/mssql_db');

const TOLERANCE = 0.01;
const ACTIVE_JE = `(je.is_reversed IS NULL OR je.is_reversed=0)
  AND (je.reversal_of_id IS NULL)
  AND (je.source_action IS NULL OR (je.source_action NOT LIKE '%_cancel' AND je.source_action <> 'cancel'))`;

const results = [];
function record(name, ok, detail = '') { results.push({ name, ok, detail }); }
function to2(v) { return Number(v || 0).toFixed(2); }
function isBalanced(a, b, tol = TOLERANCE) { return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol; }

async function scalar(pool, sqlText) {
  const r = await pool.request().query(sqlText);
  return r.recordset[0] ? Object.values(r.recordset[0])[0] : null;
}

async function glSum(pool, codes) {
  const inList = codes.map(c => `'${c}'`).join(',');
  return Number(await scalar(pool, `SELECT ROUND(SUM(jl.debit - jl.credit),2) s
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN chart_of_accounts ca ON ca.id = jl.account_id
    WHERE ca.system_code IN (${inList}) AND ${ACTIVE_JE}`)) || 0;
}

async function glSumCreditMinusDebit(pool, codes) {
  const inList = codes.map(c => `'${c}'`).join(',');
  return Number(await scalar(pool, `SELECT ROUND(SUM(jl.credit - jl.debit),2) s
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN chart_of_accounts ca ON ca.id = jl.account_id
    WHERE ca.system_code IN (${inList}) AND ${ACTIVE_JE}`)) || 0;
}

function runIntegrityAudit() {
  const jsonPath = path.join(os.tmpdir(), `verif_integrity_${Date.now()}.json`);
  try {
    const audit = path.join(__dirname, 'integrity_audit.js');
    try {
      execFileSync(process.execPath, [audit, '--json', jsonPath], { stdio: 'inherit' });
    } catch (e) { /* non-zero exit expected when issues exist; parse JSON below */ }
    if (!fs.existsSync(jsonPath)) { record('Integrity Audit', false, 'report file missing'); return; }
    const rep = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const issues = rep.total_issues !== undefined ? rep.total_issues : -1;
    const errors = rep.check_errors !== undefined ? rep.check_errors : 0;
    record('Integrity Audit', issues === 0 && errors === 0, `issues=${issues} errors=${errors}`);
  } catch (e) {
    record('Integrity Audit', false, 'failed to run: ' + (e.message || e));
  }
}

async function main() {
  const pool = await getPool();

  // E2 — inventory opening reconciliation
  const e2Count = await scalar(pool, `SELECT COUNT(*) FROM journal_entries je WHERE reference_type='opening_inventory_reconciliation' AND ${ACTIVE_JE}`);
  const invVal = await scalar(pool, `SELECT ROUND(SUM(ib.quantity * p.cost_price),2) FROM inventory_balances ib JOIN products p ON p.id=ib.product_id`);
  const invGl = await glSum(pool, ['SYS_INVENTORY']);
  const invDiff = (Number(invVal) || 0) - Number(invGl);
  record('E2 Status', Number(e2Count) >= 1 && isBalanced(invVal, invGl),
    `entries=${e2Count} stock=${to2(invVal)} gl=${to2(invGl)} diff=${to2(invDiff)}`);

  // E3 — customer cheque #34568
  const chStatus = await scalar(pool, `SELECT ac.status FROM ar_cheques ac WHERE ac.id=38`);
  record('E3 Status', chStatus != null, `cheque #34568 status=${chStatus || 'unknown'}`);

  // Integrity audit (subprocess, read-only)
  runIntegrityAudit();

  // Trial balance
  const tbD = await scalar(pool, `SELECT ROUND(SUM(jl.debit),2) FROM journal_entry_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE ${ACTIVE_JE}`);
  const tbC = await scalar(pool, `SELECT ROUND(SUM(jl.credit),2) FROM journal_entry_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE ${ACTIVE_JE}`);
  record('Trial Balance', isBalanced(tbD, tbC), `dr=${to2(tbD)} cr=${to2(tbC)}`);

  // GL reconciliation
  const glNet = await scalar(pool, `SELECT ROUND(SUM(jl.debit - jl.credit),2) FROM journal_entry_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE ${ACTIVE_JE}`);
  record('GL Reconciliation', isBalanced(glNet, 0), `net=${to2(glNet)}`);

  // AR reconciliation (authoritative formula)
  const arLedger = await glSum(pool, ['SYS_AR']); // debit - credit
  const arBal = Number(await scalar(pool, `SELECT ROUND(SUM(ISNULL(current_balance,0)),2) FROM customers WHERE ISNULL(is_active,1)=1`)) || 0;
  record('AR Reconciliation', isBalanced(arLedger, arBal), `gl=${to2(arLedger)} customers=${to2(arBal)}`);

  // AP reconciliation (mirrors audit: credit - debit for the liability)
  const apLedger = await glSumCreditMinusDebit(pool, ['SYS_AP']);
  const apBal = Number(await scalar(pool, `SELECT ROUND(SUM(ISNULL(current_balance,0)),2) FROM suppliers WHERE ISNULL(is_active,1)=1`)) || 0;
  record('AP Reconciliation', isBalanced(apLedger, apBal), `gl=${to2(apLedger)} suppliers=${to2(apBal)}`);

  // Treasury reconciliation (mirrors: sum current_balance vs SYS_CASH+SYS_BANK GL, debit - credit)
  const cashBank = await glSum(pool, ['SYS_CASH', 'SYS_BANK']);
  const treas = Number(await scalar(pool, `SELECT COALESCE(SUM(current_balance),0) FROM treasury_accounts`)) || 0;
  record('Treasury Reconciliation', isBalanced(cashBank, treas), `gl=${to2(cashBank)} treasury=${to2(treas)}`);

  // Inventory valuation
  record('Inventory Valuation', isBalanced(invVal, invGl), `stock=${to2(invVal)} gl=${to2(invGl)} diff=${to2(invDiff)}`);

  // Allocations (phase consistency, read-only)
  const arAlloc = await scalar(pool, `SELECT COALESCE(SUM(net_amount),0) FROM ar_payment_allocations WHERE status='active'`);
  const apAlloc = await scalar(pool, `SELECT COALESCE(SUM(net_amount),0) FROM ap_payment_allocations WHERE status='active'`);
  record('AR Allocations', Number(arAlloc) > -TOLERANCE, `active_net=${to2(arAlloc)}`);
  record('AP Allocations', Number(apAlloc) > -TOLERANCE, `active_net=${to2(apAlloc)}`);

  const failed = results.filter((r) => !r.ok);
  console.log('\n========================================');
  console.log('POST ADJUSTMENT VERIFICATION REPORT');
  console.log('========================================');
  for (const r of results) {
    const pad = ' '.repeat(Math.max(1, 26 - r.name.length));
    console.log(`${r.name}${pad} ${r.ok ? 'PASS' : 'FAIL'}   ${r.detail}`);
  }
  console.log('========================================');
  if (failed.length === 0) {
    console.log('Overall Result: PASS');
    process.exit(0);
  }
  console.log('\nFailed checks:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  console.log('\nOVERALL RESULT: FAILED');
  console.log('No automatic fix was applied.');
  process.exit(1);
}

main().catch((e) => { console.error('Verifier error:', e.message || e); process.exit(1); });