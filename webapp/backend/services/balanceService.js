const { getPool, sql } = require('../database/mssql_db');

/**
 * Single Source of Truth for Customer & Supplier Balance
 *
 * Formula (customer): opening_balance + sales - returns - collections
 * Collections include: customer_collections, ar_payments, ar_notes
 * Bounced/cancelled checks are excluded from collections
 *
 * Formula (supplier): opening_balance + purchases - returns - payments
 * Same exclusions apply
 */

async function getCustomerFullBalance(customerId, poolOrReq) {
  const req = poolOrReq ? (typeof poolOrReq.request === 'function' ? poolOrReq.request() : poolOrReq) : (await getPool()).request();
  const p = Math.random().toString(36).substring(2, 9);
  req.input(`cid_${p}`, sql.Int, customerId);
  const cRes = await req.query(`SELECT opening_balance FROM customers WHERE id = @cid_${p}`);
  if (!cRes.recordset[0]) return null;
  const salesRes = await req.query(`SELECT COALESCE(SUM(grand_total),0) AS total FROM sales_invoices WHERE customer_id = @cid_${p} AND status NOT IN ('cancelled','deleted')`);
  const retRes = await req.query(`SELECT COALESCE(SUM(grand_total),0) AS total FROM sales_returns WHERE customer_id = @cid_${p} AND status NOT IN ('cancelled','deleted')`);
  const colRes = await req.query(`
    SELECT COALESCE(SUM(sub.amount),0) AS total FROM (
      SELECT cc.amount FROM customer_collections cc
      LEFT JOIN checks ch ON ch.collection_id = cc.id
      WHERE cc.customer_id = @cid_${p} AND (ch.id IS NULL OR ch.status NOT IN ('bounced','cancelled'))
      UNION ALL
      SELECT ap.amount FROM ar_payments ap
      LEFT JOIN ar_cheques ac ON ac.payment_id = ap.id
      WHERE ap.customer_id = @cid_${p} AND ap.status = 'active' AND (ac.id IS NULL OR ac.status NOT IN ('returned','cancelled'))
      UNION ALL
      SELECT CASE WHEN an.note_type='debit' THEN an.amount ELSE -an.amount END FROM ar_notes an
      WHERE an.customer_id = @cid_${p} AND an.status = 'active'
    ) sub
  `);
  const opening = +cRes.recordset[0].opening_balance || 0;
  const sales = +salesRes.recordset[0].total || 0;
  const returns = +retRes.recordset[0].total || 0;
  const collections = +colRes.recordset[0].total || 0;
  const balance = opening + sales - returns - collections;
  return { opening, sales, returns, collections, balance };
}

async function updateCustomerBalance(customerId, poolOrTxReq) {
  const data = await getCustomerFullBalance(customerId, poolOrTxReq);
  if (!data) return null;
  const req = typeof poolOrTxReq.request === 'function' ? poolOrTxReq.request() : poolOrTxReq;
  const p = Math.random().toString(36).substring(2, 9);
  req.input(`bal_${p}`, sql.Decimal(18, 2), data.balance);
  req.input(`cid_${p}`, sql.Int, customerId);
  await req.query(`UPDATE customers SET current_balance = @bal_${p} WHERE id = @cid_${p}`);
  return data.balance;
}

async function getCustomerPeriodData(customerId, from, to, poolOrReq) {
  const req = poolOrReq ? (typeof poolOrReq.request === 'function' ? poolOrReq.request() : poolOrReq) : (await getPool()).request();
  const p = Math.random().toString(36).substring(2, 9);
  req.input(`cid_${p}`, sql.Int, customerId);
  if (from) req.input(`from_${p}`, sql.NVarChar, from);
  if (to) req.input(`to_${p}`, sql.NVarChar, to);

  const cRes = await req.query(`SELECT opening_balance FROM customers WHERE id = @cid_${p}`);
  if (!cRes.recordset[0]) return null;

  const salesRes = await req.query(`
    SELECT COUNT(DISTINCT id) AS invoice_count,
           COALESCE(SUM(grand_total),0) AS total_sales,
           COALESCE(SUM(discount_amount),0) AS total_discount,
           COALESCE(SUM(tax_amount),0) AS total_tax
    FROM sales_invoices
    WHERE customer_id = @cid_${p} AND status NOT IN ('cancelled','deleted')
    ${from ? 'AND invoice_date >= @from_' + p : ''} ${to ? 'AND invoice_date <= @to_' + p : ''}
  `);
  const profitRes = await req.query(`
    SELECT COALESCE(SUM(ii.line_total - ii.quantity * ii.cost_price),0) AS profit,
           COALESCE(SUM(ii.quantity * ii.cost_price),0) AS total_cost,
           COALESCE(SUM(ii.line_total),0) AS sales_value
    FROM sales_invoice_items ii
    JOIN sales_invoices i ON i.id = ii.invoice_id
    WHERE i.customer_id = @cid_${p} AND i.status NOT IN ('cancelled','deleted')
    ${from ? 'AND i.invoice_date >= @from_' + p : ''} ${to ? 'AND i.invoice_date <= @to_' + p : ''}
  `);

  const retRes = await req.query(`
    SELECT COALESCE(SUM(grand_total),0) AS total_returns
    FROM sales_returns
    WHERE customer_id = @cid_${p} AND status NOT IN ('cancelled','deleted')
    ${from ? 'AND return_date >= @from_' + p : ''} ${to ? 'AND return_date <= @to_' + p : ''}
  `);

  const colRes = await req.query(`
    SELECT COALESCE(SUM(amount),0) AS total_collections
    FROM customer_collections
    WHERE customer_id = @cid_${p}
    ${from ? 'AND collection_date >= @from_' + p : ''} ${to ? 'AND collection_date <= @to_' + p : ''}
  `);

  const opening = +cRes.recordset[0].opening_balance || 0;
  const inv = salesRes.recordset[0];
  const prf = profitRes.recordset[0];
  const ret = retRes.recordset[0];
  const col = colRes.recordset[0];

  const totalSales = +inv.total_sales || 0;
  const totalDiscount = +inv.total_discount || 0;
  const totalTax = +inv.total_tax || 0;
  const totalReturns = +ret.total_returns || 0;
  const totalCollections = +col.total_collections || 0;
  const profit = +prf.profit || 0;
  const totalCost = +prf.total_cost || 0;

  return {
    invoice_count: +inv.invoice_count || 0,
    total_sales: totalSales,
    total_discount: totalDiscount,
    total_tax: totalTax,
    sales_value: +prf.sales_value || 0,
    total_cost: totalCost,
    profit,
    margin_pct: totalCost > 0 ? (profit / totalCost) * 100 : 0,
    total_returns: totalReturns,
    total_collections: totalCollections,
    outstanding: totalSales - totalReturns - totalCollections,
    opening,
    current_balance: opening + totalSales - totalReturns - totalCollections
  };
}

async function getSupplierFullBalance(supplierId, poolOrReq) {
  const req = poolOrReq ? (typeof poolOrReq.request === 'function' ? poolOrReq.request() : poolOrReq) : (await getPool()).request();
  const p = Math.random().toString(36).substring(2, 9);
  req.input(`sid_${p}`, sql.Int, supplierId);
  const sRes = await req.query(`SELECT opening_balance FROM suppliers WHERE id = @sid_${p}`);
  if (!sRes.recordset[0]) return null;

  // SINGLE SOURCE OF TRUTH: derived from the General Ledger (journal_entries on SYS_AP)
  const accRes = await req.query(`SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_AP'`);
  const apAccId = accRes.recordset[0] ? accRes.recordset[0].id : null;
  let net = 0;
  if (apAccId) {
    req.input(`ap_${p}`, sql.Int, apAccId);
    const netRes = await req.query(`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0) AS net
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.supplier_id = @sid_${p}
        AND jl.account_id = @ap_${p}
        AND (je.is_reversed IS NULL OR je.is_reversed = 0)
        AND (je.reversal_of_id IS NULL)
        AND (je.source_action IS NULL OR (je.source_action NOT LIKE '%_cancel' AND je.source_action <> 'cancel'))
    `);
    net = +netRes.recordset[0].net || 0;
  }
  const opening = +sRes.recordset[0].opening_balance || 0;
  const balance = Math.round((opening + net) * 100) / 100;
  return { opening, purchases: 0, returns: 0, payments: 0, balance };
}

async function updateSupplierBalance(supplierId, poolOrTxReq) {
  const data = await getSupplierFullBalance(supplierId, poolOrTxReq);
  if (!data) return null;
  const req = typeof poolOrTxReq.request === 'function' ? poolOrTxReq.request() : poolOrTxReq;
  const p = Math.random().toString(36).substring(2, 9);
  req.input(`bal_${p}`, sql.Decimal(18, 2), data.balance);
  req.input(`sid_${p}`, sql.Int, supplierId);
  await req.query(`UPDATE suppliers SET current_balance = @bal_${p} WHERE id = @sid_${p}`);
  return data.balance;
}

async function getSupplierPeriodData(supplierId, from, to, poolOrReq) {
  const req = poolOrReq ? (typeof poolOrReq.request === 'function' ? poolOrReq.request() : poolOrReq) : (await getPool()).request();
  const p = Math.random().toString(36).substring(2, 9);
  req.input(`sid_${p}`, sql.Int, supplierId);
  if (from) req.input(`from_${p}`, sql.NVarChar, from);
  if (to) req.input(`to_${p}`, sql.NVarChar, to);

  const sRes = await req.query(`SELECT opening_balance FROM suppliers WHERE id = @sid_${p}`);
  if (!sRes.recordset[0]) return null;

  const purRes = await req.query(`
    SELECT COUNT(DISTINCT id) AS invoice_count,
           COALESCE(SUM(grand_total),0) AS total_purchases
    FROM purchase_invoices
    WHERE supplier_id = @sid_${p} AND status NOT IN ('cancelled','deleted')
    ${from ? 'AND invoice_date >= @from_' + p : ''} ${to ? 'AND invoice_date <= @to_' + p : ''}
  `);
  const retRes = await req.query(`
    SELECT COALESCE(SUM(grand_total),0) AS total_returns
    FROM purchase_returns
    WHERE supplier_id = @sid_${p} AND status NOT IN ('cancelled','deleted')
    ${from ? 'AND return_date >= @from_' + p : ''} ${to ? 'AND return_date <= @to_' + p : ''}
  `);
  const payRes = await req.query(`
    SELECT COALESCE(SUM(amount),0) AS total_payments
    FROM supplier_payments
    WHERE supplier_id = @sid_${p}
    ${from ? 'AND payment_date >= @from_' + p : ''} ${to ? 'AND payment_date <= @to_' + p : ''}
  `);

  const opening = +sRes.recordset[0].opening_balance || 0;
  const purchases = +purRes.recordset[0].total_purchases || 0;
  const invoiceCount = +purRes.recordset[0].invoice_count || 0;
  const returns = +retRes.recordset[0].total_returns || 0;
  const payments = +payRes.recordset[0].total_payments || 0;

  return {
    invoice_count: invoiceCount,
    total_purchases: purchases,
    total_returns: returns,
    total_payments: payments,
    outstanding: purchases - returns - payments,
    opening,
    current_balance: opening + purchases - returns - payments
  };
}

module.exports = {
  getCustomerFullBalance,
  updateCustomerBalance,
  getCustomerPeriodData,
  getSupplierFullBalance,
  updateSupplierBalance,
  getSupplierPeriodData
};