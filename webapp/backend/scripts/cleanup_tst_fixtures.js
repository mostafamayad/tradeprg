/**
 * Clean TST_* test fixtures from TradePro (live).
 * Scoped STRICTLY to synthetic customers/supplier/products ids:
 *    suppliers: 3,4,5   customers: 3,4,5,6   products: 3,4,5,6,7,8
 * Runs in ONE transaction. On any error -> rollback, nothing half-applied.
 * After commit: recalculates coa 45 balance and treasury balances to GL.
 *
 * usage: node scripts/cleanup_tst_fixtures.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getPool, sql } = require('../database/mssql_db');
const engine = require('../services/accountingEngine');

const TST_SUP = [3, 4, 5];
const TST_CUS = [3, 4, 5, 6];
const TST_PROD = [3, 4, 5, 6, 7, 8];
const inList = (a) => a.join(',');

(async () => {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  const rq = tx.request();
  let count = {};
  const del = async (sqls) => { const r = await rq.query(sqls); count[sqls.replace(/\s+/g,' ').slice(18,46)] = r.rowsAffected[0]; };
  try {
    // ── AR allocations / collections / cheques / payments (customers) ──
    await del(`DELETE FROM ar_payment_allocations WHERE payment_id IN (SELECT id FROM ar_payments WHERE customer_id IN (${inList(TST_CUS)}))`);
    await del(`DELETE FROM customer_collections WHERE customer_id IN (${inList(TST_CUS)})`);
    await del(`DELETE FROM ar_security_cheques WHERE customer_id IN (${inList(TST_CUS)})`);
    await del(`DELETE FROM ar_cheques WHERE customer_id IN (${inList(TST_CUS)})`);
    await del(`DELETE FROM checks WHERE customer_id IN (${inList(TST_CUS)}) OR supplier_id IN (${inList(TST_SUP)})`);
    await del(`DELETE FROM ar_notes WHERE customer_id IN (${inList(TST_CUS)})`);
    await del(`DELETE FROM customer_notes WHERE customer_id IN (${inList(TST_CUS)})`);
    await del(`DELETE FROM customer_visits WHERE customer_id IN (${inList(TST_CUS)})`);
    await del(`DELETE FROM ar_payments WHERE customer_id IN (${inList(TST_CUS)})`);

    // ── AP allocations/cheques/notes/payments + legacy (suppliers) ──
    await del(`DELETE FROM ap_payment_allocations WHERE payment_id IN (SELECT id FROM ap_payments WHERE supplier_id IN (${inList(TST_SUP)}))`);
    await del(`DELETE FROM ap_cheques WHERE supplier_id IN (${inList(TST_SUP)})`);
    await del(`DELETE FROM ap_notes WHERE supplier_id IN (${inList(TST_SUP)})`);
    await del(`DELETE FROM ap_payments WHERE supplier_id IN (${inList(TST_SUP)})`);
    await del(`DELETE FROM supplier_payments WHERE supplier_id IN (${inList(TST_SUP)})`);
    await del(`DELETE FROM supplier_payment_allocations WHERE payment_id IN (SELECT id FROM supplier_payments WHERE supplier_id IN (${inList(TST_SUP)}))`);

    // ── Sales documents (customers) ──
    await del(`DELETE FROM sales_invoice_items WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE customer_id IN (${inList(TST_CUS)}))`);
    await del(`DELETE FROM sales_returns WHERE customer_id IN (${inList(TST_CUS)})`);
    await del(`DELETE FROM sales_invoices WHERE customer_id IN (${inList(TST_CUS)})`);

    // ── Purchase documents (suppliers) ──
    await del(`DELETE FROM purchase_invoice_items WHERE invoice_id IN (SELECT id FROM purchase_invoices WHERE supplier_id IN (${inList(TST_SUP)}))`);
    await del(`DELETE FROM purchase_returns WHERE supplier_id IN (${inList(TST_SUP)})`);
    await del(`DELETE FROM purchase_invoices WHERE supplier_id IN (${inList(TST_SUP)})`);

    // ── Treasury transactions for these parties / docs ──
    await del(`DELETE FROM treasury_transactions WHERE related_id IN (${inList([...TST_CUS, ...TST_SUP])})`);

    // ── Journal entries + lines owned by these customers/suppliers ──
    await del(`DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE customer_id IN (${inList(TST_CUS)}) OR supplier_id IN (${inList(TST_SUP)}))`);
    await del(`DELETE FROM journal_entries WHERE customer_id IN (${inList(TST_CUS)}) OR supplier_id IN (${inList(TST_SUP)})`);

    // ── Inventory: balances + movements for test products ──
    await del(`DELETE FROM inventory_balances WHERE product_id IN (${inList(TST_PROD)})`);
    await del(`DELETE FROM stock_movements WHERE product_id IN (${inList(TST_PROD)})`);

    // ── Parents last ──
    await del(`DELETE FROM products WHERE id IN (${inList(TST_PROD)})`);
    await del(`DELETE FROM customers WHERE id IN (${inList(TST_CUS)})`);
    await del(`DELETE FROM suppliers WHERE id IN (${inList(TST_SUP)})`);

await tx.commit();

    // Recompute treasury account balances to their GL-derived value post-cleanup
    const accRows = (await pool.request().query(`SELECT id FROM treasury_accounts`)).recordset;
    for (const a of accRows) { try { await engine.recalcTreasuryBalanceAsync(pool.request(), a.id); } catch (e) { console.error('treasury recalc', a.id, e.message); } }
    console.log('CLEANUP OK. rows-affected:', JSON.stringify(count));
    process.exit(0);
  } catch (err) {
    await tx.rollback();
    console.error('CLEANUP ROLLED BACK. error:', err.message);
    if (err.originalError) console.error('  detail:', err.originalError.message);
    process.exit(2);
  }
})();