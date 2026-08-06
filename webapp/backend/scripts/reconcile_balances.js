require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getPool, sql } = require('../database/mssql_db');
const engine = require('../services/accountingEngine');

// GL is the authoritative referee (GL Core = PASS). Anchor all materialized
// balance columns to it: chart_of_accounts, treasury_accounts, customers, suppliers.
// Also removes orphan journal entries left by the deleted TST_* documents.

const ACTIVE = `(je.is_reversed IS NULL OR je.is_reversed=0) AND (je.reversal_of_id IS NULL)
  AND (je.source_action IS NULL OR (je.source_action NOT LIKE '%_cancel' AND je.source_action <> 'cancel'))`;

(async () => {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  const rq = tx.request();
  try {
    // 1) Drop orphan JEs (reference deleted TST documents)
    const orphanRes = await rq.query(`
      SELECT id FROM journal_entries je WHERE
        (je.reference_type='purchase_invoice' AND NOT EXISTS (SELECT 1 FROM purchase_invoices i WHERE i.id=je.reference_id))
        OR (je.reference_type='sales_invoice' AND NOT EXISTS (SELECT 1 FROM sales_invoices i WHERE i.id=je.reference_id))
        OR (je.reference_type='ap_payment' AND NOT EXISTS (SELECT 1 FROM ap_payments p WHERE p.id=je.reference_id))
        OR (je.reference_type='ar_payment' AND NOT EXISTS (SELECT 1 FROM ar_payments p WHERE p.id=je.reference_id))`);
    const ids = orphanRes.recordset.map(r => r.id);
    if (ids.length) {
      const list = ids.join(',');
      await rq.query(`DELETE FROM journal_entry_lines WHERE entry_id IN (${list})`);
      await rq.query(`DELETE FROM journal_entries WHERE id IN (${list})`);
      console.log('orphan JEs removed:', ids.length);
    } else console.log('orphan JEs: 0');

    // 2) Recompute chart_of_accounts.current_balance from GL
    const acc = await rq.query(`
      SELECT ca.id, ca.account_type,
             SUM(jl.debit - jl.credit) *
               CASE WHEN ca.account_type IN ('liability','equity','revenue') THEN -1 ELSE 1 END AS bal
      FROM chart_of_accounts ca
      LEFT JOIN journal_entry_lines jl ON jl.account_id=ca.id
      LEFT JOIN journal_entries je ON je.id=jl.entry_id AND (${ACTIVE})
      GROUP BY ca.id, ca.account_type`);
    for (const row of acc.recordset) {
      const b = row.bal ?? 0;
      await rq.query(`UPDATE chart_of_accounts SET current_balance=${b} WHERE id=${row.id}`);
    }
    console.log('chart_of_accounts updated:', acc.recordset.length);

    // 3) Recompute treasury_accounts.current_balance from the linked SYS cash/bank
    const tAcc = await rq.query(`SELECT id, opening_balance, system_code FROM treasury_accounts`);
    for (const t of tAcc.recordset) {
      if (!t.system_code) continue;
      const g = await rq.query(`SELECT ISNULL(SUM(jl.debit - jl.credit),0) AS b
        FROM journal_entry_lines jl JOIN journal_entries je ON je.id=jl.entry_id
        WHERE jl.account_id IN (SELECT id FROM chart_of_accounts WHERE system_code='${t.system_code}')
          AND (${ACTIVE})`);
      const bal = Math.round(((t.opening_balance || 0) + g.recordset[0].b) * 100) / 100;
      await rq.query(`UPDATE treasury_accounts SET current_balance=${bal} WHERE id=${t.id}`);
    }
    console.log('treasury_accounts updated:', tAcc.recordset.length);

    await tx.commit();
    console.log('REQUIRED: JEs removed, COA + treasury anchored to GL.');

    // 4) Recompute customer/supplier current_balance to GL (engine, non-tx)
    const cust = (await pool.request().query(`SELECT id FROM customers`)).recordset;
    for (const u of cust) { try { await engine.recalcCustomerBalanceAsync(pool.request(), u.id); } catch (e) { console.error('cust', u.id, e.message); } }
    const sup = (await pool.request().query(`SELECT id FROM suppliers`)).recordset;
    for (const u of sup) { try { await engine.recalcSupplierBalanceAsync(pool.request(), u.id); } catch (e) { console.error('sup', u.id, e.message); } }
    console.log('customers recalculated:', cust.length, '| suppliers recalculated:', sup.length);
    process.exit(0);
  } catch (err) {
    await tx.rollback();
    console.error('reconcile failed:', err.message);
    process.exit(2);
  }
})();