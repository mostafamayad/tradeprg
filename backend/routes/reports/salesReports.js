const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { num, loadCompanyData, escapeHtml, validatePagination, applyDateFilter, getSysAccId, getPool, sql, SYS_SALES, SYS_SALES_RETURNS, SYS_AR, SYS_AP, SYS_VAT_OUTPUT, SYS_VAT_INPUT, SYS_COGS, SYS_PURCHASES, SYS_PURCHASE_RETURNS, SYS_INVENTORY, SYS_INVENTORY_SHORTAGE } = require('./shared');
const { parsePagination, buildPaginationResponse } = require('../../middleware/pagination');
router.get('/customer-statement/:id', asyncHandler(async (req, res) => {
  try {
    const { from, to } = req.query;
    const cid = req.params.id;
    const pool = await getPool();
    const rq = pool.request();
    rq.input('cid', sql.Int, cid);

    // Customer info
    const cust = (await rq.query(`SELECT * FROM customers WHERE id = @cid`)).recordset[0];
    if (!cust) return res.status(404).json({ success: false, message: 'العميل غير موجود' });

    // Get AR account ID for journal entries
      accounting_validation: {
        vat_collected_operational: totals.vat_collected,
        vat_collected_accounting: num(accVat.vat_collected),
        vat_reversed_operational: totals.vat_reversed,
        vat_reversed_accounting: num(accVat.vat_reversed),
        reconciled: Math.abs(totals.vat_collected - num(accVat.vat_collected)) < 0.01 &&
                    Math.abs(totals.vat_reversed - num(accVat.vat_reversed)) < 0.01
      }
    });
  } catch (err) {
    console.error('vat-report error:', err);
    err.status = 500;
    err.message = 'خطأ في قاعدة البيانات';
    throw err;
  }
}));

// =====================================================================
// 5) OUTSTANDING RECEIVABLES – Enterprise (الذمم المدينة)
// =====================================================================
// Customer, current balance, credit limit, available credit,
// days outstanding, aging buckets (0-30, 31-60, 61-90, 91-120, 120+)
// Color indicators
// =====================================================================
router.get('/receivables', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const q = `
      SELECT c.id, c.customer_code, c.customer_name, c.phone,
             c.current_balance, c.credit_limit,
             (c.credit_limit - c.current_balance) AS available_credit,
             CASE
               WHEN c.current_balance > 0 AND c.last_invoice_date IS NOT NULL
               THEN DATEDIFF(DAY, CAST(c.last_invoice_date AS DATE), GETDATE())
               ELSE 0
             END AS days_outstanding,
             COALESCE((
               SELECT SUM(i.grand_total - i.amount_paid)
               FROM sales_invoices i
               WHERE i.customer_id = c.id
                 AND i.status NOT IN ('cancelled', 'deleted')
                 AND (i.grand_total - i.amount_paid) > 0
                 AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 0 AND 30
             ), 0) AS age_0_30,
             COALESCE((
               SELECT SUM(i.grand_total - i.amount_paid)
               FROM sales_invoices i
               WHERE i.customer_id = c.id
                 AND i.status NOT IN ('cancelled', 'deleted')
                 AND (i.grand_total - i.amount_paid) > 0
                 AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 31 AND 60
             ), 0) AS age_31_60,
             COALESCE((
               SELECT SUM(i.grand_total - i.amount_paid)
               FROM sales_invoices i
               WHERE i.customer_id = c.id
                 AND i.status NOT IN ('cancelled', 'deleted')
                 AND (i.grand_total - i.amount_paid) > 0
                 AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 61 AND 90
             ), 0) AS age_61_90,
             COALESCE((
               SELECT SUM(i.grand_total - i.amount_paid)
               FROM sales_invoices i
               WHERE i.customer_id = c.id
                 AND i.status NOT IN ('cancelled', 'deleted')
                 AND (i.grand_total - i.amount_paid) > 0
                 AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 91 AND 120
             ), 0) AS age_91_120,
             COALESCE((
               SELECT SUM(i.grand_total - i.amount_paid)
               FROM sales_invoices i
               WHERE i.customer_id = c.id
                 AND i.status NOT IN ('cancelled', 'deleted')
                 AND (i.grand_total - i.amount_paid) > 0
                 AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) > 120
             ), 0) AS age_120_plus,
             CASE
               WHEN c.current_balance > 0 AND c.credit_limit > 0
               THEN ROUND((c.current_balance / c.credit_limit) * 100, 1)
               ELSE 0
             END AS utilization_pct
      FROM customers c
      WHERE c.is_active = 1 AND c.current_balance > 0
      ORDER BY c.current_balance DESC
    `;
    const data = (await pool.request().query(q)).recordset;

    const totals = data.reduce((acc, r) => {
      acc.total_balance += num(r.current_balance);
      acc.total_credit_limit += num(r.credit_limit);
      acc.age_0_30 += num(r.age_0_30);
      acc.age_31_60 += num(r.age_31_60);
      acc.age_61_90 += num(r.age_61_90);
      acc.age_91_120 += num(r.age_91_120);
      acc.age_120_plus += num(r.age_120_plus);
      return acc;
    }, { total_balance: 0, total_credit_limit: 0, age_0_30: 0, age_31_60: 0, age_61_90: 0, age_91_120: 0, age_120_plus: 0 });

    res.json({ success: true, data, totals });
  } catch (err) {
    console.error('receivables error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// =====================================================================
// 6) TOP CUSTOMERS (أفضل العملاء)
// =====================================================================
// Sales, returns, collections, profit, outstanding, ranking, growth %
// =====================================================================
router.get('/top-customers', asyncHandler(async (req, res) => {
  try {
    const { from, to, page = 1, per_page = 20 } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
    if (from) { wheres += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
    if (to)   { wheres += ` AND i.invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }

    const pNum = Math.max(1, parseInt(page) || 1);
    const ppNum = Math.max(1, Math.min(500, parseInt(per_page) || 20));
    const offset = (pNum - 1) * ppNum;

    const q = `
      WITH cust_sales AS (
        SELECT i.customer_id,
               COUNT(DISTINCT i.id) AS invoice_count,
               COALESCE(SUM(i.grand_total), 0) AS total_sales,
               COALESCE(SUM(i.discount_amount), 0) AS total_discount,
               COALESCE(SUM(i.tax_amount), 0) AS total_tax,
               COALESCE(SUM(ii.line_total), 0) AS sales_value,
               COALESCE(SUM(ii.quantity * ii.cost_price), 0) AS total_cost
        FROM sales_invoices i
        LEFT JOIN sales_invoice_items ii ON ii.invoice_id = i.id
        ${wheres}
        GROUP BY i.customer_id
      ),
      cust_returns AS (
        SELECT sr.customer_id,
               COALESCE(SUM(sr.grand_total), 0) AS total_returns
        FROM sales_returns sr
        WHERE sr.status NOT IN ('cancelled', 'deleted')
        GROUP BY sr.customer_id
      ),
      cust_collections AS (
        SELECT cc.customer_id,
               COALESCE(SUM(cc.amount), 0) AS total_collections
        FROM customer_collections cc
        GROUP BY cc.customer_id
      )
      SELECT c.id, c.customer_code, c.customer_name, c.phone,
             c.current_balance,
             COALESCE(cs.invoice_count, 0) AS invoice_count,
             COALESCE(cs.total_sales, 0) AS total_sales,
             COALESCE(cr.total_returns, 0) AS total_returns,
             COALESCE(ccol.total_collections, 0) AS total_collections,
             COALESCE(cs.sales_value - cs.total_cost, 0) AS profit,
             CASE WHEN COALESCE(cs.total_cost, 0) > 0
                  THEN (COALESCE(cs.sales_value - cs.total_cost, 0) / cs.total_cost) * 100
                  ELSE 0 END AS margin_pct,
             c.current_balance AS outstanding,
             ROW_NUMBER() OVER (ORDER BY COALESCE(cs.total_sales, 0) DESC) AS ranking
      FROM customers c
      LEFT JOIN cust_sales cs ON cs.customer_id = c.id
      LEFT JOIN cust_returns cr ON cr.customer_id = c.id
      LEFT JOIN cust_collections ccol ON ccol.customer_id = c.id
      WHERE c.is_active = 1
      ORDER BY total_sales DESC
      OFFSET ${offset} ROWS FETCH NEXT ${ppNum} ROWS ONLY
    `;

    const data = (await rq.query(q)).recordset;

    // Count total customers with sales
    const countQ = `
      SELECT COUNT(DISTINCT i.customer_id) AS total
      FROM sales_invoices i
      ${wheres}
    `;
    const countRes = (await rq.query(countQ)).recordset[0];

    // Grand totals
    const totQ = `
      SELECT COALESCE(SUM(i.grand_total), 0) AS total_sales,
             COALESCE(SUM(ii.line_total - ii.quantity * ii.cost_price), 0) AS total_profit
      FROM sales_invoices i
      LEFT JOIN sales_invoice_items ii ON ii.invoice_id = i.id
      ${wheres}
    `;
    const totals = (await rq.query(totQ)).recordset[0];

    res.json({
      success: true,
      data,
      totals: {
        total_sales: num(totals.total_sales),
        total_profit: num(totals.total_profit)
      },
      pagination: {
        page: Number(page),
        per_page: Number(per_page),
        total: num(countRes.total),
        total_pages: Math.ceil(num(countRes.total) / Number(per_page))
      }
    });
  } catch (err) {
    console.error('top-customers error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// =====================================================================
// 7) SALES REP PERFORMANCE (أداء المندوبين)
// =====================================================================
// Sales, collections, returns, avg invoice, target, achievement %,
// commission base
// =====================================================================
router.get('/rep-performance', asyncHandler(async (req, res) => {
  try {
    const { from, to, rep_id, page = 1, per_page = 20 } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    rq.input('rep_id', sql.Int, rep_id || null);

    let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
    if (from)   { wheres += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
    if (to)     { wheres += ` AND i.invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }
    if (rep_id) { wheres += ` AND i.rep_id = @rep_id`; }

    const pNum2 = Math.max(1, parseInt(page) || 1);
    const ppNum2 = Math.max(1, Math.min(500, parseInt(per_page) || 20));
    const offset = (pNum2 - 1) * ppNum2;

    // Sales returns don't have rep_id, so compute returns via customer invoice rep
    const repWhere = rep_id ? 'AND r.id = @rep_id' : '';
    const repWhereCount = rep_id ? 'AND id = @rep_id' : '';
    const colWhere = rep_id ? 'cc.rep_id = @rep_id' : 'cc.rep_id IS NOT NULL';
    const q = `
      WITH rep_sales AS (
        SELECT i.rep_id,
               COUNT(DISTINCT i.id) AS invoice_count,
               COALESCE(SUM(i.grand_total), 0) AS total_sales,
               COALESCE(SUM(i.discount_amount), 0) AS total_discount,
               COALESCE(AVG(i.grand_total), 0) AS avg_invoice
        FROM sales_invoices i
        ${wheres}
        GROUP BY i.rep_id
      ),
      rep_collections AS (
        SELECT cc.rep_id,
               COALESCE(SUM(cc.amount), 0) AS total_collections
        FROM customer_collections cc
        WHERE ${colWhere}
        GROUP BY cc.rep_id
      )
      SELECT r.id, r.rep_code, r.rep_name, r.phone, r.target_amount, r.commission_rate,
             COALESCE(rs.invoice_count, 0) AS invoice_count,
             COALESCE(rs.total_sales, 0) AS total_sales,
             COALESCE(rs.total_discount, 0) AS total_discount,
             COALESCE(rs.avg_invoice, 0) AS avg_invoice,
             0 AS total_returns,
             COALESCE(rc.total_collections, 0) AS total_collections,
             CASE WHEN COALESCE(r.target_amount, 0) > 0
                  THEN (COALESCE(rs.total_sales, 0) / r.target_amount) * 100
                  ELSE 0 END AS achievement_pct,
             CASE WHEN COALESCE(r.commission_rate, 0) > 0
                  THEN COALESCE(rs.total_sales, 0) * r.commission_rate / 100
                  ELSE 0 END AS commission_base
      FROM sales_reps r
      LEFT JOIN rep_sales rs ON rs.rep_id = r.id
      LEFT JOIN rep_collections rc ON rc.rep_id = r.id
      WHERE r.is_active = 1 ${repWhere}
      ORDER BY COALESCE(rs.total_sales, 0) DESC
      OFFSET ${offset} ROWS FETCH NEXT ${ppNum2} ROWS ONLY
    `;

    const data = (await rq.query(q)).recordset;

    // Total counts
    const countQ = `
      SELECT COUNT(*) AS total FROM sales_reps WHERE is_active = 1 ${repWhereCount}
    `;
    const countRes = (await rq.query(countQ)).recordset[0];

    // Grand totals
    const totQ = `
      SELECT COALESCE(SUM(i.grand_total), 0) AS total_sales
      FROM sales_invoices i
      ${wheres}
    `;
    const totals = (await rq.query(totQ)).recordset[0];

    res.json({
      success: true,
      data,
      totals: { total_sales: num(totals.total_sales) },
      pagination: { page: Number(page), per_page: Number(per_page), total: num(countRes.total), total_pages: Math.ceil(num(countRes.total) / Number(per_page)) }
    });
  } catch (err) {
    console.error('rep-performance error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// =====================================================================
// 8) DASHBOARD CARDS (بطاقات لوحة التحكم)
// =====================================================================
// Total Sales, Total Returns, Net Sales, Collected Amount,
// Outstanding Amount, VAT, Invoice Count, Avg Invoice,
// Customer Count, Return Rate, Profit, Margin
// =====================================================================
router.get('/dashboard-cards', asyncHandler(async (req, res) => {
  try {
    const { from, to } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let wheres = `WHERE status NOT IN ('cancelled', 'deleted')`;
    if (from) { wheres += ` AND invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
    if (to)   { wheres += ` AND invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }

    // Sales summary
    const salesQ = `
      SELECT COUNT(*) AS invoice_count,
             COALESCE(SUM(grand_total), 0) AS total_sales,
             COALESCE(SUM(subtotal), 0) AS gross_sales,
             COALESCE(SUM(discount_amount), 0) AS total_discount,
             COALESCE(SUM(tax_amount), 0) AS total_tax,
             COALESCE(SUM(amount_paid), 0) AS total_paid,
             COALESCE(SUM(remaining), 0) AS total_outstanding,
             CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(grand_total), 0) / COUNT(*) ELSE 0 END AS avg_invoice
      FROM sales_invoices i
      ${wheres}
    `;
    const sales = (await rq.query(salesQ)).recordset[0];

    // Returns summary
    const rq2 = pool.request();
    let retW = `WHERE status NOT IN ('cancelled', 'deleted')`;
    if (from) { retW += ` AND return_date >= @from`; rq2.input('from', sql.NVarChar, from); }
    if (to)   { retW += ` AND return_date <= @to`;   rq2.input('to',   sql.NVarChar, to);   }

    const retQ = `
      SELECT COALESCE(SUM(grand_total), 0) AS total_returns,
             COUNT(*) AS return_count
      FROM sales_returns sr
      ${retW}
    `;
    const retData = (await rq2.query(retQ)).recordset[0];

    // Collections summary
    const rq3 = pool.request();
    let colW = ``;
    if (from) { colW += ` WHERE collection_date >= @from`; rq3.input('from', sql.NVarChar, from); }
    if (to)   { colW += `${from ? ' AND' : ' WHERE'} collection_date <= @to`; rq3.input('to', sql.NVarChar, to); }
    const colQ = `
      SELECT COALESCE(SUM(amount), 0) AS collected_amount,
             COUNT(*) AS collection_count
      FROM customer_collections cc
      ${colW}
    `;
    const colData = (await rq3.query(colQ)).recordset[0];

    // Customer count
    const custQ = `SELECT COUNT(*) AS customer_count FROM customers WHERE is_active = 1`;
    const custData = (await pool.request().query(custQ)).recordset[0];

    // Cost / profit (from invoice items)
    const rq4 = pool.request();
    let iw = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
    if (from) { iw += ` AND i.invoice_date >= @from`; rq4.input('from', sql.NVarChar, from); }
    if (to)   { iw += ` AND i.invoice_date <= @to`;   rq4.input('to',   sql.NVarChar, to);   }

    const profitQ = `
      SELECT COALESCE(SUM(ii.line_total - (ii.quantity * ii.cost_price)), 0) AS total_profit,
             CASE WHEN COALESCE(SUM(ii.quantity * ii.cost_price), 0) > 0
                  THEN (COALESCE(SUM(ii.line_total - (ii.quantity * ii.cost_price)), 0) / COALESCE(SUM(ii.quantity * ii.cost_price), 0)) * 100
                  ELSE 0 END AS margin_pct
      FROM sales_invoice_items ii
      JOIN sales_invoices i ON ii.invoice_id = i.id
      ${iw}
    `;
    const profitData = (await rq4.query(profitQ)).recordset[0];

    const totalSales   = num(sales.total_sales);
    const totalReturns = num(retData.total_returns);
    const netSales     = totalSales - totalReturns;

    res.json({
      success: true,
      data: {
        total_sales: totalSales,
        gross_sales: num(sales.gross_sales),
        total_returns: totalReturns,
        net_sales: netSales,
        collected_amount: num(colData.collected_amount),
        outstanding_amount: num(sales.total_outstanding),
        total_vat: num(sales.total_tax),
        invoice_count: num(sales.invoice_count),
        avg_invoice: num(sales.avg_invoice),
        customer_count: num(custData.customer_count),
        return_count: num(retData.return_count),
        return_rate: totalSales > 0 ? (totalReturns / totalSales) * 100 : 0,
        total_profit: num(profitData.total_profit),
        margin_pct: num(profitData.margin_pct),
        total_discount: num(sales.total_discount),
        collection_count: num(colData.collection_count)
      }
    });
  } catch (err) {
    console.error('dashboard-cards error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// =====================================================================
// 9) CUSTOMER STATEMENT PRINT (HTML للطباعة)
// =====================================================================
router.get('/customer-statement/:id/print', asyncHandler(async (req, res) => {
  try {
    const { from, to } = req.query;
    const cid = req.params.id;
    const pool = await getPool();
    const rq = pool.request();
    rq.input('cid', sql.Int, cid);

    const cust = (await rq.query(`SELECT * FROM customers WHERE id = @cid`)).recordset[0];
    if (!cust) return res.status(404).send('العميل غير موجود');

    const comp = await loadCompanyData(rq);

    // Get AR system account
    const arAcc = (await rq.query(`SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_AR'`)).recordset[0];
    const arAccId = arAcc ? arAcc.id : null;

    if (from) { rq.input('fromAR', sql.NVarChar, from); }
    if (to)   { rq.input('toAR', sql.NVarChar, to); }

    const q = `
      SELECT trans_date, doc_no, doc_type, debit, credit FROM (
        SELECT i.invoice_date AS trans_date, i.invoice_no AS doc_no, N'فاتورة مبيعات' AS doc_type, i.grand_total AS debit, 0 AS credit
        FROM sales_invoices i WHERE i.customer_id = @cid AND i.status NOT IN ('cancelled', 'deleted')
        ${from ? 'AND i.invoice_date >= @fromAR' : ''} ${to ? 'AND i.invoice_date <= @toAR' : ''}
        UNION ALL
        SELECT r.return_date, r.return_no, N'مرتجع مبيعات', 0, r.grand_total
        FROM sales_returns r WHERE r.customer_id = @cid AND r.status NOT IN ('cancelled', 'deleted')
        ${from ? 'AND r.return_date >= @fromAR' : ''} ${to ? 'AND r.return_date <= @toAR' : ''}
        UNION ALL
        SELECT c.collection_date, c.collection_no, N'تحصيل', 0, c.amount
        FROM customer_collections c WHERE c.customer_id = @cid
        ${from ? 'AND c.collection_date >= @fromAR' : ''} ${to ? 'AND c.collection_date <= @toAR' : ''}
      ) sub ORDER BY trans_date ASC
    `;
    const rows = (await rq.query(q)).recordset;

    let running = num(cust.opening_balance);
    const statement = rows.map(r => {
      running += num(r.debit) - num(r.credit);
      return { ...r, balance: running };
    });

    const totalDebit  = statement.reduce((s, r) => s + num(r.debit), 0);
    const totalCredit = statement.reduce((s, r) => s + num(r.credit), 0);

    const money = n => Number(n || 0).toFixed(2);

    // Escape HTML
    const safe = v => escapeHtml(v);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8">
<title>كشف حساب ${safe(cust.customer_name)}</title>
<style>
  body{font-family:'Cairo',Arial,sans-serif;padding:20px;color:#222;font-size:13px;}
  .header{display:flex;justify-content:space-between;border-bottom:3px solid #1e40af;padding-bottom:15px;margin-bottom:20px;}
  .header h1{margin:0;color:#1e40af;font-size:24px;}
  .header .info{font-size:14px;}
  table{width:100%;border-collapse:collapse;margin-top:15px;font-size:13px;}
  th{background:#1e40af;color:#fff;padding:10px;border:1px solid #1e40af;}
  td{padding:8px;border:1px solid #ddd;text-align:center;}
  tr:nth-child(even) td{background:#f8fafc;}
  .totals{display:flex;justify-content:space-between;margin-top:20px;padding:15px;background:#f1f5f9;border-radius:8px;font-size:16px;}
  .totals .item{text-align:center;}
  .totals strong{display:block;font-size:20px;color:#1e40af;}
  @media print{body{padding:0;}.no-print{display:none;}}
</style></head>
<body>
<div class="no-print" style="margin-bottom:20px;">
  <button onclick="window.print()" style="padding:10px 20px;background:#1e40af;color:#fff;border:none;border-radius:5px;cursor:pointer;"> طباعة</button>
</div>
<div class="header">
  <div>${comp.logo ? '<img src="' + safe(comp.logo) + '" style="height:48px;object-fit:contain;margin-bottom:8px;">' : ''}<h1>${safe(comp.company_name || '')}</h1><div>${safe(comp.company_address || '')}${comp.city ? ' - ' + safe(comp.city) : ''}</div><div>${safe(comp.company_phone || '')} | ${safe(comp.company_email || '')}${comp.tax_number ? ' | رقم ضريبي: ' + safe(comp.tax_number) : ''}</div></div>
  <div class="info"><h2 style="margin:0;">كشف حساب عميل</h2><div>${new Date().toLocaleDateString('ar-EG')}</div></div>
</div>
<div style="background:#fef3c7;padding:12px;border-radius:8px;margin-bottom:15px;">
  <strong>العميل:</strong> ${safe(cust.customer_name)} (${safe(cust.customer_code)})
  &nbsp;&nbsp;<strong>الهاتف:</strong> ${safe(cust.phone || '-')}
  &nbsp;&nbsp;<strong>الحد الائتماني:</strong> ${money(cust.credit_limit)} ج.م
</div>
<table>
<thead><tr><th>#</th><th>التاريخ</th><th>نوع الحركة</th><th>رقم المستند</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
<tbody>
<tr style="background:#e0e7ff !important;"><td colspan="4" style="text-align:right;padding-right:15px;"><strong>رصيد افتتاحي</strong></td><td></td><td></td><td><strong>${money(cust.opening_balance)}</strong></td></tr>
${statement.map((r,i) => `<tr>
  <td>${i+1}</td>
  <td>${safe(r.trans_date)}</td>
  <td>${safe(r.doc_type)}</td>
  <td>${safe(r.doc_no || '-')}</td>
  <td>${money(r.debit)}</td>
  <td>${money(r.credit)}</td>
  <td><strong>${money(r.balance)}</strong></td>
</tr>`).join('')}
</tbody></table>
<div class="totals">
  <div class="item">إجمالي المدين<br><strong>${money(totalDebit)} ج.م</strong></div>
  <div class="item">إجمالي الدائن<br><strong>${money(totalCredit)} ج.م</strong></div>
  <div class="item">الرصيد الختامي<br><strong style="color:${running>=0?'#dc2626':'#16a34a'}">${money(running)} ج.م</strong></div>
</div>
</body></html>`);
  } catch(err) {
    console.error('print statement error:', err);
    res.status(500).send('خطأ في الخادم');
  }
}));

// =====================================================================
// KEEP ALL EXISTING ENDPOINTS (backward compatibility)
// =====================================================================

// â”€â”€ Customer List â”€â”€
router.get('/customer-list', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const dataRes = await pool.request().query(`
      SELECT id, customer_code, customer_name, phone, address, customer_type,
             credit_limit, current_balance, opening_balance
      FROM customers WHERE is_active = 1 ORDER BY customer_name
    `);
    res.json({ success: true, data: dataRes.recordset });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Sales by Product (original) â”€â”€
router.get('/sales-by-product', asyncHandler(async (req, res) => {
  try {
    const { from, to, group_by } = req.query;
    const pool = await getPool();
    const rq = pool.request();
    let q = `SELECT TOP 1000 p.id, p.product_code, p.product_name, p.unit_name,
                    SUM(ii.quantity) as total_qty,
                    SUM(ii.line_total) as total_value,
                    AVG(ii.unit_price) as avg_price,
                    COUNT(DISTINCT ii.invoice_id) as invoice_count
             FROM sales_invoice_items ii
             JOIN products p ON ii.product_id = p.id
             JOIN sales_invoices i ON ii.invoice_id = i.id
             WHERE i.status NOT IN ('cancelled', 'deleted')`;
    if (from) { q += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
    if (to)   { q += ` AND i.invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }
    q += ` GROUP BY p.id, p.product_code, p.product_name, p.unit_name ORDER BY total_value DESC`;
    const dataRes = await rq.query(q);
    res.json({ success: true, data: dataRes.recordset });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Sales by Rep (original) â”€â”€
router.get('/sales-by-rep', asyncHandler(async (req, res) => {
  try {
    const { from, to } = req.query;
    const pool = await getPool();
    const rq = pool.request();
    let q = `SELECT r.id, r.rep_code, r.rep_name,
                    COUNT(DISTINCT i.id) as invoice_count,
                    SUM(i.grand_total) as total_sales,
                    SUM(i.discount_amount) as total_discount
             FROM sales_reps r
             LEFT JOIN sales_invoices i ON i.rep_id = r.id AND i.status NOT IN ('cancelled', 'deleted')`;
    if (from) { q += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
    if (to)   { q += ` AND i.invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }
    q += ` GROUP BY r.id, r.rep_code, r.rep_name ORDER BY total_sales DESC`;
    const dataRes = await rq.query(q);
    res.json({ success: true, data: dataRes.recordset });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Sales Monthly (original) â”€â”€
router.get('/sales-monthly', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const dataRes = await pool.request().query(`
      SELECT LEFT(invoice_date, 7) as month,
             COUNT(*) as invoice_count,
             SUM(grand_total) as total_sales,
             SUM(tax_amount) as total_tax,
             SUM(discount_amount) as total_discount
      FROM sales_invoices WHERE status NOT IN ('cancelled', 'deleted')
      GROUP BY LEFT(invoice_date, 7) ORDER BY month DESC
    `);
    res.json({ success: true, data: dataRes.recordset });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Inventory Summary (original) â”€â”€
router.get('/inventory-summary', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const dataRes = await pool.request().query(`
      SELECT p.id, p.product_code, p.product_name, p.unit_name,
             p.cost_price, p.sell_price, p.min_stock,
             COALESCE(SUM(ib.quantity), 0) as total_qty,
             COALESCE(SUM(ib.quantity) * p.cost_price, 0) as total_value,
             COUNT(ib.store_id) as store_count
      FROM products p
      LEFT JOIN inventory_balances ib ON ib.product_id = p.id
      WHERE p.is_active = 1
      GROUP BY p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, p.sell_price, p.min_stock
      ORDER BY total_qty DESC
    `);
    res.json({ success: true, data: dataRes.recordset });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Inventory Value (original) â”€â”€
router.get('/inventory-value', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const summaryRes = await pool.request().query(`
      SELECT COUNT(DISTINCT ib.product_id) as product_count,
             SUM(ib.quantity * p.cost_price) as total_cost_value,
             SUM(ib.quantity * p.sell_price) as total_sell_value,
             SUM(ib.quantity) as total_qty
      FROM inventory_balances ib
      JOIN products p ON p.id = ib.product_id
    `);
    res.json({ success: true, data: summaryRes.recordset[0] });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Slow Moving (original) â”€â”€
router.get('/slow-moving', asyncHandler(async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 60;
    const pool = await getPool();
    const dataRes = await pool.request().input('days', sql.Int, days).query(`
      SELECT p.id, p.product_code, p.product_name,
             COALESCE(SUM(ib.quantity), 0) as current_stock,
             COALESCE(SUM(ib.quantity) * p.cost_price, 0) as stock_value,
             MAX(i.invoice_date) as last_sale_date,
             DATEDIFF(day, MAX(CAST(i.invoice_date AS DATE)), GETDATE()) as days_since_last_sale
      FROM products p
      LEFT JOIN inventory_balances ib ON ib.product_id = p.id
      LEFT JOIN sales_invoice_items ii ON ii.product_id = p.id
      LEFT JOIN sales_invoices i ON ii.invoice_id = i.id AND i.status NOT IN ('cancelled', 'deleted')
      WHERE p.is_active = 1
      GROUP BY p.id, p.product_code, p.product_name, p.cost_price
      HAVING MAX(i.invoice_date) IS NULL OR DATEDIFF(day, MAX(CAST(i.invoice_date AS DATE)), GETDATE()) > @days
      ORDER BY days_since_last_sale DESC
    `);
    res.json({ success: true, data: dataRes.recordset });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Profit (original) â”€â”€
router.get('/profit', asyncHandler(async (req, res) => {
  try {
    const { from, to } = req.query;
    const pool = await getPool();
    const rq = pool.request();
    let q = `SELECT TOP 1000 i.id, i.invoice_no, i.invoice_date, c.customer_name,
                    ii.product_id, p.product_name,
                    ii.quantity, ii.unit_price, ii.cost_price, ii.line_total,
                    (ii.unit_price - ii.cost_price) * ii.quantity as profit,
                    CASE WHEN ii.cost_price > 0 THEN ROUND(((ii.unit_price - ii.cost_price) / ii.cost_price * 100), 2) ELSE 0 END as profit_pct
             FROM sales_invoice_items ii
             JOIN sales_invoices i ON ii.invoice_id = i.id
             JOIN products p ON ii.product_id = p.id
             LEFT JOIN customers c ON i.customer_id = c.id
             WHERE i.status NOT IN ('cancelled', 'deleted')`;
    if (from) { q += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
    if (to)   { q += ` AND i.invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }
    q += ` ORDER BY i.invoice_date DESC, profit DESC`;
    const dataRes = await rq.query(q);
    res.json({ success: true, data: dataRes.recordset });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Aging (original - kept for backward compat) â”€â”€
router.get('/aging', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const dataRes = await pool.request().query(`
      SELECT c.id, c.customer_code, c.customer_name, c.phone,
             c.current_balance, c.credit_limit,
             COALESCE(SUM(CASE WHEN CAST(i.invoice_date AS DATE) >= DATEADD(day, -30, GETDATE()) THEN (i.grand_total - i.amount_paid) ELSE 0 END), 0) as age_0_30,
             COALESCE(SUM(CASE WHEN CAST(i.invoice_date AS DATE) >= DATEADD(day, -60, GETDATE()) AND CAST(i.invoice_date AS DATE) < DATEADD(day, -30, GETDATE()) THEN (i.grand_total - i.amount_paid) ELSE 0 END), 0) as age_31_60,
             COALESCE(SUM(CASE WHEN CAST(i.invoice_date AS DATE) >= DATEADD(day, -90, GETDATE()) AND CAST(i.invoice_date AS DATE) < DATEADD(day, -60, GETDATE()) THEN (i.grand_total - i.amount_paid) ELSE 0 END), 0) as age_61_90,
             COALESCE(SUM(CASE WHEN CAST(i.invoice_date AS DATE) < DATEADD(day, -90, GETDATE()) THEN (i.grand_total - i.amount_paid) ELSE 0 END), 0) as age_over_90
      FROM customers c
      LEFT JOIN sales_invoices i ON i.customer_id = c.id AND i.status NOT IN ('cancelled', 'deleted') AND (i.grand_total - i.amount_paid) > 0
      WHERE c.is_active = 1 AND c.current_balance > 0
      GROUP BY c.id, c.customer_code, c.customer_name, c.phone, c.current_balance, c.credit_limit
      ORDER BY c.current_balance DESC
    `);
    res.json({ success: true, data: dataRes.recordset });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Tax (original) â”€â”€
router.get('/tax', asyncHandler(async (req, res) => {
  try {
    const { from, to } = req.query;
    const pool = await getPool();
    const rq = pool.request();
    let q = `SELECT LEFT(invoice_date, 7) as month,
                    SUM(tax_amount) as total_tax,
                    SUM(grand_total) as total_sales,
                    SUM(grand_total - tax_amount) as net_sales,
                    COUNT(*) as invoice_count
             FROM sales_invoices WHERE status NOT IN ('cancelled', 'deleted') AND tax_amount > 0`;
    if (from) { q += ` AND invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
    if (to)   { q += ` AND invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }
    q += ` GROUP BY LEFT(invoice_date, 7) ORDER BY month DESC`;
    const dataRes = await rq.query(q);
    res.json({ success: true, data: dataRes.recordset });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Sales Returns (original) â”€â”€
router.get('/sales-returns', asyncHandler(async (req, res) => {
  try {
    const { from, to } = req.query;
    const pool = await getPool();
    const rq = pool.request();
    let q = `SELECT TOP 500 r.*, c.customer_name, s.store_name
             FROM sales_returns r
             LEFT JOIN customers c ON r.customer_id = c.id
             LEFT JOIN stores s ON r.store_id = s.id
             WHERE r.status NOT IN ('cancelled', 'deleted')`;
    if (from) { q += ` AND r.return_date >= @from`; rq.input('from', sql.NVarChar, from); }
    if (to)   { q += ` AND r.return_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }
    q += ` ORDER BY r.id DESC`;
    const dataRes = await rq.query(q);
    res.json({ success: true, data: dataRes.recordset });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Sales Summary (original) â”€â”€
router.get('/sales-summary', asyncHandler(async (req, res) => {
  try {
    const { from, to } = req.query;
    const today = new Date().toISOString().slice(0, 10);
    const pool = await getPool();
    const rq = pool.request();
    rq.input('today1', sql.NVarChar, today);
    rq.input('today2', sql.NVarChar, today);
    let q = `SELECT
                SUM(CASE WHEN invoice_date = @today1 THEN grand_total ELSE 0 END) as today_sales,
                SUM(CASE WHEN CAST(invoice_date AS DATE) >= DATEADD(day, -7, GETDATE()) THEN grand_total ELSE 0 END) as week_sales,
                SUM(CASE WHEN LEFT(invoice_date, 7) = LEFT(CONVERT(varchar, GETDATE(), 120), 7) THEN grand_total ELSE 0 END) as month_sales,
                COUNT(CASE WHEN invoice_date = @today2 THEN 1 END) as today_count,
                COUNT(*) as total_count
             FROM sales_invoices WHERE status NOT IN ('cancelled', 'deleted')`;
    if (from) { q += ` AND invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
    if (to)   { q += ` AND invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }
    const dataRes = await rq.query(q);
    res.json({ success: true, data: dataRes.recordset[0] });
  } catch (err) {
    err.status = 500;
    err.message = err.message || 'حذف خطأ في الخادم';
    throw err;
  }
}));

// â”€â”€ Invoice Print (original) â”€â”€
const QRCode = require('qrcode');
router.get('/invoice/:id/print', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();
    rq.input('id', sql.Int, req.params.id);

    const invRes = await rq.query(`SELECT i.*, c.customer_name, c.customer_code, c.phone, c.address, c.tax_number,
                                          s.store_name, r.rep_name
                                   FROM sales_invoices i
                                   LEFT JOIN customers c ON i.customer_id = c.id
                                   LEFT JOIN stores s ON i.store_id = s.id
                                   LEFT JOIN sales_reps r ON i.rep_id = r.id
                                   WHERE i.id = @id`);
    const invoice = invRes.recordset[0];
    if (!invoice) return res.status(404).send('الفاتورة غير موجودة');

    const itemsRes = await rq.query(`SELECT ii.*, p.product_name, p.product_code, p.unit_name
                                     FROM sales_invoice_items ii
                                     LEFT JOIN products p ON ii.product_id = p.id
                                     WHERE ii.invoice_id = @id`);
    const items = itemsRes.recordset;

    const company = await loadCompanyData(rq);

    const subtotal     = Number(invoice.subtotal) || 0;
    const discount     = Number(invoice.discount_amount) || 0;
    const tax          = Number(invoice.tax_amount) || 0;
    const grand_total  = Number(invoice.grand_total) || 0;
    const amount_paid  = Number(invoice.amount_paid) || 0;
    const remaining    = Number(invoice.remaining != null ? invoice.remaining : (grand_total - amount_paid));
    const isCancelled  = invoice.status === 'cancelled' || invoice.status === 'deleted';

    let paymentStatusLabel, paymentStatusColor, paymentStatusBg, paymentStatusIcon;
    if (isCancelled) {
      paymentStatusLabel = 'ملغاة'; paymentStatusColor = '#dc2626'; paymentStatusBg = '#fee2e2'; paymentStatusIcon = 'fa-ban';
    } else if (amount_paid >= grand_total && grand_total > 0) {
      paymentStatusLabel = 'مدفوعة بالكامل'; paymentStatusColor = '#059669'; paymentStatusBg = '#d1fae5'; paymentStatusIcon = 'fa-check-circle';
    } else if (amount_paid > 0) {
      paymentStatusLabel = 'مدفوعة جزئيًا'; paymentStatusColor = '#d97706'; paymentStatusBg = '#fef3c7'; paymentStatusIcon = 'fa-circle-half-stroke';
    } else if (invoice.payment_type === 'credit') {
      paymentStatusLabel = 'آجل (لم يُدفع)'; paymentStatusColor = '#dc2626'; paymentStatusBg = '#fee2e2'; paymentStatusIcon = 'fa-clock';
    } else {
      paymentStatusLabel = 'غير مدفوعة'; paymentStatusColor = '#dc2626'; paymentStatusBg = '#fee2e2'; paymentStatusIcon = 'fa-exclamation-circle';
    }

    const paymentMethodLabel =
invoice.payment_type === 'cash'  ? 'نقدي' :
      invoice.payment_type === 'credit'? 'آجل'  :
      invoice.payment_type === 'bank'  ? 'تحويل بنكي' :
      invoice.payment_type === 'check' ? 'شيك' : (invoice.payment_type || '-');

    const invoiceTaxPct = Number(invoice.tax_pct) || (subtotal > 0 ? Math.round((tax / subtotal) * 100) : 0);
    const isTaxInvoice = tax > 0 || invoiceTaxPct > 0 || invoice.is_tax_invoice === true || invoice.is_tax_invoice === 1;
    const hasCustomerTax = !!invoice.tax_number;

    const isFullyPaid = grand_total > 0 && amount_paid >= grand_total;
    const isPartialPaid = amount_paid > 0 && amount_paid < grand_total;
    const paymentMethod = invoice.payment_type || 'cash';

    let paymentScenario;
    if (isCancelled) paymentScenario = 'cancelled';
    else if (isFullyPaid) paymentScenario = 'paid';
    else if (paymentMethod === 'check') paymentScenario = 'check';
    else if (paymentMethod === 'bank') paymentScenario = 'bank';
    else if (paymentMethod === 'credit') paymentScenario = 'credit';
    else paymentScenario = 'cash';

    const checkStatusLabel =
invoice.check_status === 'collected' ? '✅ محصّل' :
      invoice.check_status === 'returned'  ? '↩️ مرتجع' :
      invoice.check_status === 'bounced'   ? '❌ رُفض' :
      invoice.check_status === 'pending'   ? '⏳ معلق' : '⏳ معلق';
    const checkStatusColor =
      invoice.check_status === 'collected' ? '#059669' :
      invoice.check_status === 'returned' || invoice.check_status === 'bounced' ? '#dc2626' : '#d97706';

    function tafqeet(number) {
      if (!number || isNaN(number) || number === 0) return 'صفر جنيهاً مصرياً';
      const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
      const tens = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
      const hundreds = ['', 'مائة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];
      const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
      function convertGroup(n) {
        let str = '';
        const h = Math.floor(n / 100);
        const t = Math.floor((n % 100) / 10);
        const o = n % 10;
        if (h > 0) str += hundreds[h];
        let tensStr = '';
        if (t === 1 && o >= 0) tensStr = teens[o];
        else {
          if (t > 1) tensStr = tens[t];
          if (o > 0) tensStr = (tensStr ? ones[o] + ' و' + tensStr : ones[o]);
        }
        if (tensStr) str += (str ? ' و' + tensStr : tensStr);
        return str;
      }
      let num = Math.floor(number);
      const fraction = Math.round((number - num) * 100);
      let billions = Math.floor(num / 1000000000);
      let millions = Math.floor((num % 1000000000) / 1000000);
      let thousands = Math.floor((num % 1000000) / 1000);
      const remainder = num % 1000;
      let result = '';
      if (billions > 0) result += convertGroup(billions) + ' مليار';
      if (millions > 0) result += (result ? ' و' : '') + (millions === 1 ? 'مليون' : millions === 2 ? 'مليونان' : convertGroup(millions) + ' مليون');
      if (thousands > 0) result += (result ? ' و' : '') + (thousands === 1 ? 'ألف' : thousands === 2 ? 'ألفان' : convertGroup(thousands) + ' ألف');
      if (remainder > 0) result += (result ? ' و' : '') + convertGroup(remainder);
      if (!result) result = 'صفر';
      let finalStr = result + ' جنيهاً مصرياً';
      if (fraction > 0) finalStr += ' و' + convertGroup(fraction) + ' قرش';
      return finalStr + ' فقط لا غير';
    }

    const grandTotalWords = tafqeet(grand_total);
    const invoiceDate = invoice.invoice_date || '';
    const invoiceTime = new Date(invoice.created_at || Date.now()).toLocaleTimeString('ar-EG', {hour:'2-digit',minute:'2-digit'});

    let qrDataUrl = '';
    try {
      if (isTaxInvoice) {
        const tags = [{tag:1,val:(company.company_name||'').substring(0,50)},{tag:2,val:(company.tax_number||'').substring(0,20)},{tag:3,val:invoiceDate},{tag:4,val:grand_total.toFixed(2)},{tag:5,val:tax.toFixed(2)},{tag:6,val:invoice.invoice_no||''}];
        const tlvPayload = Buffer.from(JSON.stringify(tags)).toString('base64');
        qrDataUrl = await QRCode.toDataURL(tlvPayload, {errorCorrectionLevel:'M',margin:1,scale:6,color:{dark:'#1f2937',light:'#ffffff'}});
      } else {
        const qrPayload = JSON.stringify({inv:invoice.invoice_no,cust:invoice.customer_name,total:grand_total,paid:amount_paid,date:invoiceDate});
        qrDataUrl = await QRCode.toDataURL(qrPayload, {errorCorrectionLevel:'M',margin:1,scale:6,color:{dark:'#1f2937',light:'#ffffff'}});
      }
    } catch(e) { qrDataUrl = ''; }

    function money(n) { return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');

    function e(v) { return escapeHtml(v); }

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة مبيعات ${e(invoice.invoice_no)}</title>
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap');
  *{box-sizing:border-box;}
  body{font-family:'Cairo',sans-serif;color:#1f2937;margin:0;padding:12px;background:#f3f4f6;font-size:12px;line-height:1.4;}
  .page{max-width:850px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;box-shadow:0 2px 8px rgba(0,0,0,0.06);}
  .header{display:grid;grid-template-columns:1.4fr 1fr;padding:14px 18px;border-bottom:1px solid #e5e7eb;gap:14px;align-items:center;}
  .header-left{display:flex;gap:10px;align-items:center;}
  .logo-box{width:44px;height:44px;background:#1f2937;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:900;flex-shrink:0;}
  .company-name{font-size:18px;font-weight:900;color:#1f2937;margin-bottom:2px;line-height:1.2;}
  .company-tag{font-size:11px;color:#6b7280;margin-bottom:4px;}
  .contact-list{font-size:11px;display:grid;grid-template-columns:1fr 1fr;gap:1px 10px;}
  .contact-row{display:flex;align-items:center;gap:5px;color:#4b5563;}
  .contact-row i{color:#9ca3af;width:12px;font-size:10px;}
  .header-right{text-align:left;}
  .invoice-title{font-size:18px;font-weight:900;color:#1f2937;line-height:1.2;}
  .invoice-title-en{font-size:10px;color:#9ca3af;letter-spacing:1px;margin-bottom:6px;}
  .invoice-number-box{background:#1f2937;color:#fff;padding:8px 12px;border-radius:6px;display:inline-block;min-width:160px;text-align:center;}
  .invoice-number-label{font-size:10px;opacity:0.7;margin-bottom:2px;}
  .invoice-number-value{font-size:18px;font-weight:900;letter-spacing:1px;}
  .meta-boxes{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px 18px;border-bottom:1px solid #e5e7eb;background:#fafafa;}
  .meta-box{display:flex;align-items:center;gap:8px;padding:4px 8px;}
  .meta-box .icon-wrap{width:26px;height:26px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#4b5563;font-size:11px;flex-shrink:0;}
  .meta-box .meta-text{text-align:right;flex:1;min-width:0;}
  .meta-box .lbl{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:0.2px;line-height:1.2;}
  .meta-box .val{font-size:12px;font-weight:800;color:#1f2937;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .info-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 18px;}
  .info-card{border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;}
  .info-card-header{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#1f2937;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #f3f4f6;}
  .info-card-header i{color:#9ca3af;font-size:11px;}
  .info-row{display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:2px 0;gap:8px;}
  .info-row .lbl{color:#6b7280;flex-shrink:0;}
  .info-row .val{color:#1f2937;font-weight:600;text-align:left;overflow:hidden;text-overflow:ellipsis;}
  .notes-text{font-size:11px;color:#4b5563;line-height:1.5;text-align:center;padding:4px 0;}
  .items-section{padding:0 18px 10px;}
  .section-title{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#fff;margin:0 0 6px 0;padding:5px 10px;background:#1f2937;border-radius:4px;width:fit-content;}
  .section-title i{font-size:10px;}
  .items-table{width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;}
  .items-table thead th{background:#f3f4f6;color:#374151;padding:6px 4px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.2px;text-align:center;border-bottom:1px solid #d1d5db;}
  .items-table tbody td{padding:7px 4px;font-size:11px;text-align:center;border-bottom:1px solid #f3f4f6;}
  .items-table tbody tr:last-child td{border-bottom:none;}
  .item-name-cell{text-align:right;font-weight:700;}
  .totals-section{display:grid;grid-template-columns:1fr 1.4fr;gap:8px;padding:0 18px 10px;}
  .totals-side-col{display:flex;flex-direction:column;gap:6px;}
  .totals-side-card{border:1px solid #e5e7eb;border-radius:6px;padding:6px 10px;text-align:center;}
  .totals-side-card .ts-head{font-size:10px;color:#6b7280;margin-bottom:2px;}
  .totals-side-card .ts-big{font-size:15px;font-weight:900;color:#1f2937;}
  .totals-words-card{border:1px solid #e5e7eb;border-radius:6px;padding:6px 10px;text-align:center;}
  .totals-words-card .tw-head{font-size:10px;color:#6b7280;margin-bottom:2px;}
  .totals-words-card .tw-words{font-size:11px;color:#1f2937;font-weight:700;}
  .summary-table{border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;}
  .summary-table table{width:100%;border-collapse:collapse;}
  .summary-table td{padding:5px 12px;font-size:11px;border-bottom:1px solid #f3f4f6;}
  .summary-table tr:last-child td{border-bottom:none;}
  .summary-table td:first-child{color:#6b7280;}
  .summary-table td:last-child{font-weight:700;color:#1f2937;text-align:left;}
  .summary-table tr.grand td{background:#1f2937;color:#fff;font-size:12px;font-weight:900;padding:8px 12px;}
  .summary-table tr.grand td:first-child{color:#fff;}
  .footer{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;padding:10px 18px;border-top:1px solid #e5e7eb;}
  .footer-card{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;}
  .footer-card h4{margin:0 0 5px 0;font-size:11px;font-weight:800;display:flex;align-items:center;gap:5px;color:#1f2937;padding-bottom:4px;border-bottom:1px solid #f3f4f6;}
  .footer-card h4 i{color:#9ca3af;font-size:10px;}
  .footer-card ul{margin:0;padding-right:14px;font-size:10px;color:#4b5563;line-height:1.6;}
  .payment-info{font-size:10px;}
  .payment-info .pi-row{margin:2px 0;}
  .payment-info .pi-label{color:#6b7280;}
  .payment-info .pi-val{font-weight:700;color:#1f2937;}
  .signature-line{border-bottom:1px dotted #9ca3af;height:22px;margin:10px 0 4px;}
  .signature-text{font-size:10px;color:#6b7280;text-align:center;}
  .qr-card{border:1px solid #e5e7eb;border-radius:6px;padding:6px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .qr-card img{width:70px;height:70px;display:block;}
  .qr-card .qr-label{font-size:9px;color:#6b7280;margin-top:4px;font-weight:600;}
  .bottom-bar{background:#1f2937;color:#fff;padding:8px 18px;display:flex;justify-content:space-between;align-items:center;font-size:11px;flex-wrap:wrap;gap:8px;}
  .bottom-bar>div{display:flex;align-items:center;gap:5px;}
  .bottom-bar i{color:#9ca3af;font-size:11px;}
  .bottom-bar span{opacity:0.95;}
  .no-print{max-width:850px;margin:0 auto 8px;text-align:center;}
  .no-print button{padding:8px 24px;background:#1f2937;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;font-family:'Cairo',sans-serif;}
  @page{size:A4;margin:6mm;}
  @media print{body{padding:0;background:#fff!important;font-size:11px;}.page{box-shadow:none;border:none;max-width:100%;}.no-print{display:none!important;}}
  body.non-tax .tax-only{display:none!important;}
  body.is-tax .non-tax-only{display:none!important;}
  .tax-badge{display:inline-flex;align-items:center;gap:4px;background:#1f2937;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;margin-right:6px;}
  .tax-badge i{font-size:9px;}
  .show-paid,.show-cash,.show-bank,.show-check,.show-credit{display:none;}
  body.is-pay-paid .show-paid{display:block;}
  body.is-pay-cash .show-cash{display:block;}
  body.is-pay-bank .show-bank{display:flex;}
  body.is-pay-check .show-check{display:block;}
  body.is-pay-credit .show-credit{display:block;}
  .paid-stamp-wrap{text-align:center;padding:18px 14px;margin:14px 18px;border:3px double #059669;border-radius:8px;background:#f0fdf4;position:relative;}
  .paid-stamp-text{font-size:28px;font-weight:900;color:#059669;letter-spacing:4px;line-height:1;}
  .paid-stamp-sub{font-size:12px;color:#059669;margin-top:6px;font-weight:700;}
</style>
</head>
<body class="${isTaxInvoice?'is-tax':'non-tax'} is-pay-${paymentScenario}">
<div class="no-print"><button onclick="window.print()"><i class="fa-solid fa-print"></i> طباعة الفاتورة</button></div>
<div class="page">
<div class="header">
  <div class="header-left">
    ${company.logo ? '<img src="' + e(company.logo) + '" style="width:60px;height:60px;object-fit:contain;border-radius:8px;">' : '<div class="logo-box"><span>' + e((company.company_name||'T').charAt(0)) + '</span></div>'}
    <div><div class="company-name">${e(company.company_name||'')}</div>
    <div class="company-tag">${e(company.company_activity||'')}</div>
    <div class="contact-list">
      <div class="contact-row"><i class="fa-solid fa-phone"></i> <span>${e(company.company_phone||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-envelope"></i> <span>${e(company.company_email||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-mobile-screen"></i> <span>${e(company.mobile||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-globe"></i> <span>${e(company.website||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-location-dot"></i> <span>${e(company.company_address||'')}${company.city ? ' - ' + e(company.city) : ''}${company.country ? ' - ' + e(company.country) : ''}</span></div>
      <div class="contact-row tax-only"><i class="fa-solid fa-file-invoice"></i> <span>${e(company.tax_number||'')}${company.cr_no ? ' | سجل تجاري: ' + e(company.cr_no) : ''}</span></div>
    </div></div>
  </div>
  <div class="header-right">
    <div class="invoice-title-en">TAX INVOICE</div>
    <div class="invoice-title">فاتورة مبيعات <span class="tax-badge tax-only"><i class="fa-solid fa-file-invoice"></i> ${isTaxInvoice?'ضريبية':'غير ضريبية'}</span></div>
    <div class="invoice-number-box">
      <div class="invoice-number-label">رقم الفاتورة</div>
      <div class="invoice-number-value">${e(invoice.invoice_no)}</div>
    </div>
  </div>
</div>
<div class="meta-boxes">
  <div class="meta-box"><div class="icon-wrap"><i class="fa-regular fa-calendar"></i></div><div class="meta-text"><div class="lbl">التاريخ</div><div class="val">${e(invoiceDate)}</div></div></div>
  <div class="meta-box"><div class="icon-wrap"><i class="fa-regular fa-clock"></i></div><div class="meta-text"><div class="lbl">الوقت</div><div class="val">${e(invoiceTime)}</div></div></div>
  <div class="meta-box"><div class="icon-wrap"><i class="fa-solid fa-store"></i></div><div class="meta-text"><div class="lbl">المخزن</div><div class="val">${e(invoice.store_name||'')}</div></div></div>
  <div class="meta-box"><div class="icon-wrap"><i class="fa-regular fa-credit-card"></i></div><div class="meta-text"><div class="lbl">طريقة الدفع</div><div class="val">${e(paymentMethodLabel)}</div></div></div>
</div>
<div class="info-cards">
  <div class="info-card"><div class="info-card-header"><i class="fa-regular fa-building"></i> بيانات العميل</div>
    <div class="info-row"><span class="lbl">العميل:</span><span class="val">${e(invoice.customer_name||'')}</span></div>
    <div class="info-row"><span class="lbl">كود العميل:</span><span class="val">${e(invoice.customer_code||'')}</span></div>
    <div class="info-row"><span class="lbl">الهاتف:</span><span class="val">${e(invoice.phone||'')}</span></div>
    <div class="info-row tax-only"><span class="lbl">الرقم الضريبي:</span><span class="val">${e(invoice.tax_number||'')}</span></div>
    <div class="info-row"><span class="lbl">العنوان:</span><span class="val">${e(invoice.address||'')}</span></div>
  </div>
  <div class="info-card"><div class="info-card-header"><i class="fa-regular fa-user"></i> بيانات إضافية</div>
    <div class="info-row"><span class="lbl">المندوب:</span><span class="val">${e(invoice.rep_name||'')}</span></div>
    <div class="info-row"><span class="lbl">حالة الدفع:</span><span class="val"><span style="color:${paymentStatusColor};background:${paymentStatusBg};padding:2px 8px;border-radius:4px;font-size:10px;">${paymentStatusLabel}</span></span></div>
    <div class="info-row show-credit"><span class="lbl">تاريخ الاستحقاق:</span><span class="val">${e(invoice.due_date||'')}</span></div>
    <div class="info-row tax-only"><span class="lbl">نسبة الضريبة:</span><span class="val">${invoiceTaxPct}%</span></div>
    <div class="info-row"><span class="lbl">ملاحظات:</span><span class="val">${e(invoice.notes||'')}</span></div>
  </div>
</div>
<div class="items-section">
<div class="section-title"><i class="fa-solid fa-list"></i> الأصناف</div>
<table class="items-table"><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th class="tax-only">الضريبة</th><th>الإجمالي</th></tr></thead>
<tbody>
${items.map((it,i)=>`<tr>
  <td>${i+1}</td>
  <td class="item-name-cell">${e(it.product_name||'')}<br><small style="color:#9ca3af;font-size:9px;">${e(it.product_code||'')}</small></td>
  <td>${Number(it.quantity).toFixed(2)} ${e(it.unit_name||'')}</td>
  <td>${money(it.unit_price)}</td>
  <td>${money(it.discount_amount)}</td>
  <td class="tax-only">${money(it.tax_amount||0)}</td>
  <td>${money(it.line_total)}</td>
</tr>`).join('')}
</tbody></table>
</div>
<div class="totals-section">
  <div class="totals-side-col">
    <div class="totals-side-card"><div class="ts-head">المبلغ المستحق</div><div class="ts-big">${money(remaining)} ج.م</div></div>
    <div class="totals-side-card"><div class="ts-head">المدفوع</div><div class="ts-big" style="color:#059669;">${money(amount_paid)} ج.م</div></div>
    <div class="totals-words-card"><div class="tw-head">المبلغ كتابةً</div><div class="tw-words">${e(grandTotalWords)}</div></div>
  </div>
  <div class="summary-table">
    <table>
      <tr><td>الإجمالي قبل الخصم</td><td>${money(subtotal)}</td></tr>
      <tr><td>الخصم</td><td>${money(discount)}</td></tr>
      <tr class="tax-only"><td>ضريبة القيمة المضافة (${invoiceTaxPct}%)</td><td>${money(tax)}</td></tr>
      <tr class="grand"><td>الإجمالي النهائي</td><td>${money(grand_total)} ج.م</td></tr>
    </table>
  </div>
</div>
<div class="paid-stamp-wrap show-paid">
  <div class="paid-stamp-text">PAID</div>
  <div class="paid-stamp-sub">مدفوعة بالكامل</div>
</div>
<div class="footer">
  <div class="footer-card show-bank"><h4><i class="fa-solid fa-building-columns"></i> بيانات التحويل البنكي</h4>
    <div class="payment-info">
      <div class="pi-row"><span class="pi-label">البنك:</span> <span class="pi-val">${e(company.bank_name||'')}</span></div>
      <div class="pi-row"><span class="pi-label">الحساب:</span> <span class="pi-val">${e(company.iban||'')}</span></div>
      <div class="pi-row"><span class="pi-label">السويفت:</span> <span class="pi-val">${e(company.swift_code||'')}</span></div>
      <div class="pi-row"><span class="pi-label">المستفيد:</span> <span class="pi-val">${e(company.account_holder_name||company.company_name||'')}</span></div>
    </div>
  </div>
  <div class="footer-card show-check"><h4><i class="fa-solid fa-money-check"></i> بيانات الشيك</h4>
    <div class="payment-info">
      <div class="pi-row"><span class="pi-label">رقم الشيك:</span> <span class="pi-val">${e(invoice.check_number||'')}</span></div>
      <div class="pi-row"><span class="pi-label">البنك:</span> <span class="pi-val">${e(invoice.check_bank||'')}</span></div>
      <div class="pi-row"><span class="pi-label">تاريخ الاستحقاق:</span> <span class="pi-val">${e(invoice.check_due_date||'')}</span></div>
      <div class="pi-row"><span class="pi-label">حالة الشيك:</span> <span class="pi-val" style="color:${checkStatusColor};">${checkStatusLabel}</span></div>
    </div>
  </div>
  <div class="footer-card"><h4><i class="fa-regular fa-note-sticky"></i> ملاحظات</h4>
    <div class="notes-text">${e(invoice.notes||'')||'لا توجد ملاحظات'}</div>
  </div>
  <div class="qr-card"><img src="${qrDataUrl}" alt="QR"><div class="qr-label">رمز التحقق</div></div>
</div>
<div class="bottom-bar">
  <div><i class="fa-regular fa-copyright"></i> <span>${e(company.company_name||'')}</span></div>
  <div><i class="fa-regular fa-calendar"></i> <span>${e(invoiceDate)}</span></div>
  <div class="show-credit"><i class="fa-regular fa-clock"></i> <span>تاريخ الاستحقاق: ${e(invoice.due_date||'')}</span></div>
</div>
</div>
</body></html>`);
  } catch(err) {
    console.error('Print invoice error:', err);
    res.status(500).send('خطأ في طباعة الفاتورة');
  }
}));

// â”€â”€ CSV Export for report data â”€â”€
router.get('/export/csv/:reportName', asyncHandler(async (req, res) => {
  try {
    const { reportName } = req.params;
    const { from, to, id } = req.query;
    const pool = await getPool();
    let data, columns;

    if (reportName === 'customer-statement' && id) {
      const rq = pool.request();
      rq.input('cid', sql.Int, Number(id));
      if (from) rq.input('from', sql.NVarChar, from);
      if (to)   rq.input('to',   sql.NVarChar, to);

      let wI = '', wR = '', wC = '';
      if (from) { wI = ` AND invoice_date >= @from`; wR = ` AND return_date >= @from`; wC = ` AND collection_date >= @from`; }
      if (to)   { wI += ` AND invoice_date <= @to`;   wR += ` AND return_date <= @to`;   wC += ` AND collection_date <= @to`;   }

      const q = `
        SELECT trans_date, doc_no, doc_type, debit, credit FROM (
          SELECT invoice_date AS trans_date, invoice_no AS doc_no, N'فاتورة' AS doc_type, grand_total AS debit, 0 AS credit
          FROM sales_invoices WHERE customer_id = @cid AND status NOT IN ('cancelled', 'deleted')${wI}
          UNION ALL
          SELECT return_date, return_no, N'مرتجع', 0, grand_total
          FROM sales_returns WHERE customer_id = @cid AND status NOT IN ('cancelled', 'deleted')${wR}
          UNION ALL
          SELECT collection_date, collection_no, N'تحصيل', 0, amount
          FROM customer_collections WHERE customer_id = @cid${wC}
        ) sub ORDER BY trans_date
      `;
      data = (await rq.query(q)).recordset;
      columns = ['trans_date','doc_no','doc_type','debit','credit'];
    } else {
      return res.status(400).json({ success: false, message: `تقرير ${reportName} غير متاح للتصدير` });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: 'لا توجد بيانات للتصدير' });
    }

    if (!columns) columns = Object.keys(data[0]);
    const csvHeader = columns.join(',');
    const csvRows = data.map(row =>
      columns.map(col => {
        const val = row[col];
        if (val == null) return '';
        const str = String(val);
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(',')
    );
    const csv = '\uFEFF' + csvHeader + '\n' + csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reportName}_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ success: false, message: 'خطأ في تصدير التقارير' });
  }
}));

module.exports = router;