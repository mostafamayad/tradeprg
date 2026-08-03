// ============================================================
// TradePro ERP â€“ Enterprise Reports Module
// SAP S/4HANA / Dynamics 365 / Odoo Enterprise â€“ Grade
// ============================================================
// Every report reconciles with accounting (journal entries)
// All totals validated against system accounts
// ============================================================

const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// Load company data from both company_info and settings tables (settings has logo, phone, email, etc.)
async function loadCompanyData(requestObj) {
    const rq = requestObj.request ? requestObj.request() : requestObj;
    const compRes = await rq.query(`SELECT TOP 1 * FROM company_info`);
    const company = compRes.recordset[0] || {};
    try {
        const settingsRes = await (requestObj.request ? requestObj.request() : requestObj).query(`SELECT * FROM settings WHERE [key] LIKE 'company_%'`);
        settingsRes.recordset.forEach(s => {
            const stripped = s.key.replace('company_', '');
            if (s.value) {
                company[stripped] = s.value;
                // Also overwrite the original company_info-style key if different
                if (stripped !== s.key) company[s.key] = s.value;
            }
        });
    } catch (e) { /* settings table may not exist */ }
    return company;
}

function escapeHtml(u) {
  if (u == null) return '';
  return u.toString().replace(/[&<>\"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[m]);
}

function applyDateFilter(sqlParts, alias, from, to, req) {
  if (from) { sqlParts.push(` AND ${alias} >= @from`); req.input('from', sql.NVarChar, from); }
  if (to)   { sqlParts.push(` AND ${alias} <= @to`);   req.input('to',   sql.NVarChar, to);   }
}

// â”€â”€ Accounting system codes (must match accountingEngine) â”€â”€
const SYS_SALES          = 'SYS_SALES';
const SYS_SALES_RETURNS  = 'SYS_SALES_RETURNS';
const SYS_AR             = 'SYS_AR';
const SYS_AP             = 'SYS_AP';
const SYS_VAT_OUTPUT     = 'SYS_VAT_OUTPUT';
const SYS_VAT_INPUT      = 'SYS_VAT_INPUT';
const SYS_COGS           = 'SYS_COGS';
const SYS_PURCHASES      = 'SYS_PURCHASES';
const SYS_PURCHASE_RETURNS = 'SYS_PURCHASE_RETURNS';

// â”€â”€ Reusable: get active pool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getSysAccId(req, code) {
  const r = await req.query(`SELECT id FROM chart_of_accounts WHERE system_code = '${code}'`);
  return r.recordset[0] ? r.recordset[0].id : null;
}

// =====================================================================
// 1) CUSTOMER STATEMENT â€“ Enterprise (كشف حساب كشف حساب متكامل)
// =====================================================================
// Includes: opening balance, sales invoices, sales returns,
//           collections, credit notes, debit notes, manual journal
//           entries affecting customer AR account.
// Running balance after every transaction.
// Closing balance MUST equal customers.current_balance.
// =====================================================================
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
    const arAcc = await getSysAccId(rq, SYS_AR);

    // â”€â”€ Build union of all transaction types â”€â”€
    let sqlParts_arr = [];
    let wStr = '';
    if (from) wStr += ` AND invoice_date >= @from`;
    if (to)   wStr += ` AND invoice_date <= @to`;

    sqlParts_arr.push(`
      SELECT invoice_date AS trans_date, invoice_no AS doc_no,
             N'فاتورة مبيعات' AS doc_type, N'فاتورة' AS doc_type_short,
             grand_total AS debit, 0 AS credit,
             'sales_invoice' AS ref_type, id AS ref_id,
             ISNULL(notes,'') AS description, '' AS created_by_name
      FROM sales_invoices
      WHERE customer_id = @cid AND status NOT IN ('cancelled', 'deleted')${wStr}
    `);

    let wStrR = '';
    if (from) wStrR += ` AND return_date >= @from`;
    if (to)   wStrR += ` AND return_date <= @to`;

    sqlParts_arr.push(`
      SELECT return_date AS trans_date, return_no AS doc_no,
             N'مرتجع مبيعات' AS doc_type, N'مرتجع' AS doc_type_short,
             0 AS debit, grand_total AS credit,
             'sales_return' AS ref_type, id AS ref_id,
             ISNULL(return_reason,'') AS description, '' AS created_by_name
      FROM sales_returns
      WHERE customer_id = @cid AND status NOT IN ('cancelled', 'deleted')${wStrR}
    `);

    let wStrC = '';
    if (from) wStrC += ` AND collection_date >= @from`;
    if (to)   wStrC += ` AND collection_date <= @to`;

    sqlParts_arr.push(`
      SELECT collection_date AS trans_date, collection_no AS doc_no,
             N'تحصيل' AS doc_type, N'تحصيل' AS doc_type_short,
             0 AS debit, amount AS credit,
             'collection' AS ref_type, id AS ref_id,
             ISNULL(notes,'') AS description, '' AS created_by_name
      FROM customer_collections
      WHERE customer_id = @cid${wStrC}
    `);

    // Manual journal entries affecting AR
    if (arAcc) {
      let wStrJ = '';
      if (from) wStrJ += ` AND je.entry_date >= @from`;
      if (to)   wStrJ += ` AND je.entry_date <= @to`;

      sqlParts_arr.push(`
        SELECT je.entry_date AS trans_date, je.entry_no AS doc_no,
               CASE WHEN jl.debit > 0 THEN N'قيد مدين' ELSE N'قيد دائن' END AS doc_type,
               CASE WHEN jl.debit > 0 THEN N'مدين' ELSE N'دائن' END AS doc_type_short,
               jl.debit, jl.credit,
               'journal_entry' AS ref_type, je.id AS ref_id,
               ISNULL(jl.description,'') AS description,
               ISNULL(u.full_name,'') AS created_by_name
        FROM journal_entry_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        LEFT JOIN users u ON je.created_by = u.id
        WHERE jl.account_id = @arAccId
          AND je.reference_type IS NULL
          AND (jl.description LIKE N'%' + CAST(@cid AS NVARCHAR) + N'%'
               OR jl.description LIKE N'%عميل%' + CAST(@cid AS NVARCHAR)
               OR jl.description LIKE N'%' + CAST(@cid AS NVARCHAR) + N'%')
          ${wStrJ}
      `);
    }

    const finalQ = sqlParts_arr.join(' UNION ALL ') + ` ORDER BY trans_date ASC, ref_id ASC`;

    const reqF = pool.request();
    reqF.input('cid', sql.Int, Number(cid));
    if (arAcc) reqF.input('arAccId', sql.Int, arAcc);
    if (from) reqF.input('from', sql.NVarChar, from);
    if (to)   reqF.input('to',   sql.NVarChar, to);

    const rowsRes = await reqF.query(finalQ);
    let rows = rowsRes.recordset;

    // Fetch invoice details if requested
    if (req.query.showDetails === 'true') {
      const siIds = rows.filter(r => r.ref_type === 'sales_invoice').map(r => r.ref_id);
      const srIds = rows.filter(r => r.ref_type === 'sales_return').map(r => r.ref_id);
      
      let itemsByRef = { sales_invoice: {}, sales_return: {} };
      let metaByRef = { sales_invoice: {}, sales_return: {} };

      if (siIds.length > 0) {
        const invReq = pool.request();
        const siIdsStr = siIds.join(',');
        const invRows = (await invReq.query(`SELECT id, discount_amount, tax_amount FROM sales_invoices WHERE id IN (${siIdsStr})`)).recordset;
        invRows.forEach(ir => {
          metaByRef.sales_invoice[ir.id] = { tax_amount: num(ir.tax_amount), discount_amount: num(ir.discount_amount) };
        });

        const itemsRows = (await invReq.query(`
          SELECT invoice_id, p.product_name, p.product_code, quantity, p.unit_name AS unit, unit_price, discount_amount AS discount, line_total AS total
          FROM sales_invoice_items i
          LEFT JOIN products p ON p.id = i.product_id
          WHERE invoice_id IN (${siIdsStr})
        `)).recordset;
        itemsRows.forEach(it => {
          if (!itemsByRef.sales_invoice[it.invoice_id]) itemsByRef.sales_invoice[it.invoice_id] = [];
          itemsByRef.sales_invoice[it.invoice_id].push({
            product_name: it.product_name,
            product_code: it.product_code,
            quantity: num(it.quantity),
            unit: it.unit,
            unit_price: num(it.unit_price),
            discount: num(it.discount),
            total: num(it.total)
          });
        });
      }

      if (srIds.length > 0) {
        const retReq = pool.request();
        const srIdsStr = srIds.join(',');
        const retRows = (await retReq.query(`SELECT id, discount_amount, tax_amount FROM sales_returns WHERE id IN (${srIdsStr})`)).recordset;
        retRows.forEach(rr => {
          metaByRef.sales_return[rr.id] = { tax_amount: num(rr.tax_amount), discount_amount: num(rr.discount_amount) };
        });

        const itemsRows = (await retReq.query(`
          SELECT return_id, p.product_name, p.product_code, quantity, p.unit_name AS unit, unit_price, ISNULL(discount_amount_snapshot, 0) AS discount, line_total AS total
          FROM sales_return_items i
          LEFT JOIN products p ON p.id = i.product_id
          WHERE return_id IN (${srIdsStr})
        `)).recordset;
        itemsRows.forEach(it => {
          if (!itemsByRef.sales_return[it.return_id]) itemsByRef.sales_return[it.return_id] = [];
          itemsByRef.sales_return[it.return_id].push({
            product_name: it.product_name,
            product_code: it.product_code,
            quantity: num(it.quantity),
            unit: it.unit,
            unit_price: num(it.unit_price),
            discount: num(it.discount),
            total: num(it.total)
          });
        });
      }

      rows = rows.map(r => {
        if (r.ref_type === 'sales_invoice' || r.ref_type === 'sales_return') {
          return {
            ...r,
            items: itemsByRef[r.ref_type][r.ref_id] || [],
            tax_amount: metaByRef[r.ref_type][r.ref_id]?.tax_amount || 0,
            discount_amount: metaByRef[r.ref_type][r.ref_id]?.discount_amount || 0
          };
        }
        return r;
      });
    }

    let running = num(cust.opening_balance);
    const statement = rows.map(r => {
      running += num(r.debit) - num(r.credit);
      return {
        date: r.trans_date,
        doc_no: r.doc_no,
        doc_type: r.doc_type,
        doc_type_short: r.doc_type_short,
        debit: num(r.debit),
        credit: num(r.credit),
        balance: running,
        description: r.description,
        created_by: r.created_by_name,
        ref_type: r.ref_type,
        ref_id: r.ref_id,
        items: r.items,
        tax_amount: r.tax_amount,
        discount_amount: r.discount_amount
      };
    });

    const totalDebit  = statement.reduce((s, r) => s + r.debit, 0);
    const totalCredit = statement.reduce((s, r) => s + r.credit, 0);
    const closing     = num(cust.opening_balance) + totalDebit - totalCredit;

    // ── حساب الـ KPIs للعرض في الكروت ─────────────────────────────────────────
    const totalSales       = statement.filter(r => r.ref_type === 'sales_invoice').reduce((s, r) => s + r.debit,  0);
    const totalCollections = statement.filter(r => r.ref_type === 'collection').reduce((s, r) => s + r.credit, 0);
    const totalReturns     = statement.filter(r => r.ref_type === 'sales_return').reduce((s, r) => s + r.credit, 0);

    res.json({
      success: true,
      data: {
        customer: {
          id: cust.id,
          customer_code: cust.customer_code,
          customer_name: cust.customer_name,
          phone: cust.phone,
          address: cust.address,
          credit_limit: num(cust.credit_limit),
          current_balance: closing,              // الرصيد الحقيقي من الحركات
          branch: cust.branch,
          governorate: cust.governorate,
          rep_name: null,
          last_invoice_date: statement.filter(r => r.ref_type === 'sales_invoice').slice(-1)[0]?.date || null,
          last_collection_date: statement.filter(r => r.ref_type === 'collection').slice(-1)[0]?.date || null
        },
        opening_balance: num(cust.opening_balance),
        total_debit: totalDebit,
        total_credit: totalCredit,
        closing_balance: closing,
        kpis: {
          current_balance: closing,
          total_sales: totalSales,
          total_collections: totalCollections,
          total_returns: totalReturns,
          transaction_count: statement.length,
          opening_balance: num(cust.opening_balance),
          closing_balance: closing
        },
        rows: statement
      }
    });
  } catch (err) {
    console.error('Report customer-statement error:', err);
    return res.status(500).json({ success: false, message: err.message || 'خطأ في قاعدة البيانات' });
  }
}));

// =====================================================================
// 2) SALES DURING PERIOD – Enterprise (تقرير المبيعات)
// =====================================================================
// Filters: date, branch, warehouse, rep, customer, product, category
// Returns: invoice count, sold qty, gross, discount, tax, net,
//          avg invoice, avg margin, return rate
//          daily chart, monthly chart data
// =====================================================================
router.get('/sales-by-period', asyncHandler(async (req, res) => {
  try {
    const { from, to, rep_id, customer_id, store_id, product_id, category_id, group_by } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let joins = '';
    let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;

    if (from)        { wheres += ` AND i.invoice_date >= @from`;        rq.input('from', sql.NVarChar, from); }
    if (to)          { wheres += ` AND i.invoice_date <= @to`;          rq.input('to', sql.NVarChar, to); }
    if (rep_id)      { wheres += ` AND i.rep_id = @rep_id`;             rq.input('rep_id', sql.Int, rep_id); }
    if (customer_id) { wheres += ` AND i.customer_id = @customer_id`;   rq.input('customer_id', sql.Int, customer_id); }
    if (store_id)    { wheres += ` AND i.store_id = @store_id`;         rq.input('store_id', sql.Int, store_id); }
    if (product_id || category_id) {
      joins += ` JOIN sales_invoice_items ii ON ii.invoice_id = i.id`;
      if (product_id)  { wheres += ` AND ii.product_id = @product_id`;    rq.input('product_id', sql.Int, product_id); }
      if (category_id) {
        joins += ` JOIN products p ON ii.product_id = p.id`;
        wheres += ` AND p.category_id = @category_id`;
        rq.input('category_id', sql.Int, category_id);
      }
    }

    const dateGroup = group_by === 'monthly'
      ? `LEFT(i.invoice_date, 7)`
      : `LEFT(i.invoice_date, 10)`;

    const hasItemsJoin = !!(product_id || category_id);
    let soldQtyCol = '0';
    let marginCalc = '0';
    
    if (hasItemsJoin) {
      soldQtyCol = `COALESCE(SUM(ii.quantity), 0)`;
      marginCalc = `CASE WHEN COALESCE(SUM(ii.line_total), 0) > 0
               THEN (COALESCE(SUM(ii.line_total), 0) - COALESCE(SUM(ii.quantity * ii.cost_price), 0)) / NULLIF(COALESCE(SUM(ii.line_total), 0), 0) * 100
               ELSE 0 END`;
    } else {
      joins += ` OUTER APPLY (SELECT SUM(quantity) AS total_qty FROM sales_invoice_items WHERE invoice_id = i.id) oa_qty`;
      soldQtyCol = `COALESCE(SUM(oa_qty.total_qty), 0)`;
    }

    const q = `
      SELECT ${dateGroup} AS period,
             COUNT(DISTINCT i.id) AS invoice_count,
             ${soldQtyCol} AS sold_qty,
             COALESCE(SUM(i.subtotal), 0) AS gross_sales,
             COALESCE(SUM(i.discount_amount), 0) AS total_discount,
             COALESCE(SUM(i.tax_amount), 0) AS total_tax,
             COALESCE(SUM(i.grand_total), 0) AS net_sales,
             CASE WHEN COUNT(DISTINCT i.id) > 0
                  THEN COALESCE(SUM(i.grand_total), 0) / COUNT(DISTINCT i.id)
                  ELSE 0 END AS avg_invoice,
             ${marginCalc} AS avg_margin_pct
      FROM sales_invoices i
      ${joins}
      ${wheres}
      GROUP BY ${dateGroup}
      ORDER BY period DESC
    `;

    const data = (await rq.query(q)).recordset;

    // Return rate calculation (second query)
    const rq2 = pool.request();
    if (from) rq2.input('from', sql.NVarChar, from);
    if (to)   rq2.input('to',   sql.NVarChar, to);
    let retWhere = `WHERE sr.status NOT IN ('cancelled', 'deleted')`;
    if (from) retWhere += ` AND sr.return_date >= @from`;
    if (to)   retWhere += ` AND sr.return_date <= @to`;

    const retQ = `
      SELECT COALESCE(SUM(sr.grand_total), 0) AS return_total,
             COALESCE(SUM(sri.quantity), 0) AS return_qty
      FROM sales_returns sr
      LEFT JOIN sales_return_items sri ON sri.return_id = sr.id
      ${retWhere}
    `;
    const retData = (await rq2.query(retQ)).recordset[0];
    const returnTotal = num(retData.return_total);
    const returnQty   = num(retData.return_qty);

    // Grand totals row
    const totSoldQty = hasItemsJoin ? `COALESCE(SUM(ii.quantity), 0)` : `0`;
    const totQ = `
      SELECT COUNT(DISTINCT i.id) AS invoice_count,
             ${totSoldQty} AS sold_qty,
             COALESCE(SUM(i.subtotal), 0) AS gross_sales,
             COALESCE(SUM(i.discount_amount), 0) AS total_discount,
             COALESCE(SUM(i.tax_amount), 0) AS total_tax,
             COALESCE(SUM(i.grand_total), 0) AS net_sales
      FROM sales_invoices i
      ${joins}
      ${wheres}
    `;
    const totData = (await rq.query(totQ)).recordset[0];
    const netSales = num(totData.net_sales);
    const returnRate = netSales > 0 ? (returnTotal / netSales) * 100 : 0;

    res.json({
      success: true,
      data,
      totals: {
        invoice_count: num(totData.invoice_count),
        sold_qty: num(totData.sold_qty),
        gross_sales: num(totData.gross_sales),
        total_discount: num(totData.total_discount),
        total_tax: num(totData.total_tax),
        net_sales: netSales,
        avg_invoice: num(totData.invoice_count) > 0 ? netSales / num(totData.invoice_count) : 0,
        return_total: returnTotal,
        return_qty: returnQty,
        return_rate: returnRate
      }
    });
  } catch (err) {
    console.error('sales-by-period error:', err);
    return res.status(500).json({ success: false, message: err.message || 'خطأ في قاعدة البيانات' });
  }
}));

// =====================================================================
// 3) PRODUCT SALES REPORT (تقرير مبيعات الأصناف)
// =====================================================================
// Per product: sold qty, returned qty, net qty, sales value,
//              cost, profit, margin %, inventory remaining, avg selling price
// =====================================================================
router.get('/product-sales', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id, category_id, page = 1, per_page = 50, sort = 'sales_value', order = 'desc' } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
    let retWheres = `AND sr.status NOT IN ('cancelled', 'deleted')`;
    if (from) {
      wheres += ` AND i.invoice_date >= @from`;
      retWheres += ` AND sr.return_date >= @from`;
      rq.input('from', sql.NVarChar, from);
    }
    if (to) {
      wheres += ` AND i.invoice_date <= @to`;
      retWheres += ` AND sr.return_date <= @to`;
      rq.input('to', sql.NVarChar, to);
    }
    if (store_id) {
      wheres += ` AND i.store_id = @store_id`;
      retWheres += ` AND sr.store_id = @store_id`;
      rq.input('store_id', sql.Int, store_id);
    }
    if (category_id) {
      wheres += ` AND p.category_id = @category_id`;
      rq.input('category_id', sql.Int, category_id);
    }

    const offset = (Number(page) - 1) * Number(per_page);
    const sortCol = ['sold_qty','returned_qty','net_qty','sales_value','cost','profit','margin_pct','inventory','avg_price'].includes(sort) ? sort : 'sales_value';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    const allowedSort = sortCol;
    const q = `
      WITH product_sales AS (
        SELECT p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, p.sell_price,
               COALESCE(SUM(ii.quantity), 0) AS sold_qty,
               COALESCE(SUM(ii.line_total), 0) AS sales_value,
               CASE WHEN COALESCE(SUM(ii.quantity), 0) > 0
                    THEN COALESCE(SUM(ii.line_total), 0) / SUM(ii.quantity) ELSE 0 END AS avg_price
        FROM products p
        LEFT JOIN sales_invoice_items ii ON ii.product_id = p.id
        LEFT JOIN sales_invoices i ON ii.invoice_id = i.id ${wheres.replace('WHERE', 'AND')}
        GROUP BY p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, p.sell_price
      ),
      product_returns AS (
        SELECT sri.product_id,
               COALESCE(SUM(sri.quantity), 0) AS returned_qty
        FROM sales_return_items sri
        JOIN sales_returns sr ON sr.id = sri.return_id
        WHERE 1=1 ${retWheres}
        GROUP BY sri.product_id
      ),
      product_inventory AS (
        SELECT ib.product_id,
               COALESCE(SUM(ib.quantity), 0) AS inventory
        FROM inventory_balances ib
        GROUP BY ib.product_id
      )
      SELECT ps.*,
             COALESCE(pr.returned_qty, 0) AS returned_qty,
             ps.sold_qty - COALESCE(pr.returned_qty, 0) AS net_qty,
             COALESCE(pinv.inventory, 0) AS inventory
      FROM product_sales ps
      LEFT JOIN product_returns pr ON pr.product_id = ps.id
      LEFT JOIN product_inventory pinv ON pinv.product_id = ps.id
      WHERE ps.sold_qty > 0 OR COALESCE(pr.returned_qty, 0) > 0
      ORDER BY ${allowedSort} ${sortDir}
      OFFSET ${offset} ROWS FETCH NEXT ${Number(per_page)} ROWS ONLY
    `;

    const data = (await rq.query(q)).recordset;

    // Count total
    const cq = `
      SELECT COUNT(DISTINCT ii.product_id) AS total
      FROM sales_invoice_items ii
      JOIN sales_invoices i ON ii.invoice_id = i.id
      ${wheres}
    `;
    const countRes = (await rq.query(cq)).recordset[0];
    const total = num(countRes.total);

    res.json({
      success: true,
      data,
      pagination: { page: Number(page), per_page: Number(per_page), total, total_pages: Math.ceil(total / Number(per_page)) }
    });
  } catch (err) {
    console.error('product-sales error:', err);
    return res.status(500).json({ success: false, message: err.message || 'خطأ في قاعدة البيانات' });
  }
}));

// =====================================================================
// 4) VAT REPORT – Enterprise (تقرير ضريبة القيمة المضافة)
// =====================================================================
// Shows: taxable sales, taxable returns, VAT collected, VAT reversed,
//        net VAT, grouped by VAT rate
// MUST reconcile with SYS_VAT_OUTPUT account
// =====================================================================
router.get('/vat-report', asyncHandler(async (req, res) => {
  try {
    const { from, to } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
    if (from) { wheres += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
    if (to)   { wheres += ` AND i.invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }

    // VAT on sales invoices (grouped by tax_pct from items, tax from header)
    const salesVatQ = `
      SELECT COALESCE(ii.tax_pct, 0) AS vat_rate,
             COUNT(DISTINCT i.id) AS invoice_count,
             COALESCE(SUM(ii.line_total), 0) AS taxable_sales,
             COALESCE(SUM(ii.line_total * (ii.tax_pct / 100.0)), 0) AS vat_collected
      FROM sales_invoice_items ii
      JOIN sales_invoices i ON ii.invoice_id = i.id
      ${wheres}
      GROUP BY ii.tax_pct
      ORDER BY vat_rate
    `;
    const salesVat = (await rq.query(salesVatQ)).recordset;

    // VAT on sales returns
    const rq2 = pool.request();
    let retW = `WHERE sr.status NOT IN ('cancelled', 'deleted')`;
    if (from) { retW += ` AND sr.return_date >= @from`; rq2.input('from', sql.NVarChar, from); }
    if (to)   { retW += ` AND sr.return_date <= @to`;   rq2.input('to',   sql.NVarChar, to);   }

    const retVatQ = `
      SELECT COALESCE(sri.tax_pct_snapshot, 0) AS vat_rate,
             COUNT(DISTINCT sr.id) AS return_count,
             COALESCE(SUM(sri.line_total), 0) AS taxable_returns,
             COALESCE(SUM(sri.tax_amount_snapshot), 0) AS vat_reversed
      FROM sales_return_items sri
      JOIN sales_returns sr ON sr.id = sri.return_id
      ${retW}
      GROUP BY sri.tax_pct_snapshot
      ORDER BY vat_rate
    `;
    const retVat = (await rq2.query(retVatQ)).recordset;

    // Accounting validation: get VAT from journal entries
    const rq3 = pool.request();
    const vatAcc = await getSysAccId(rq3, SYS_VAT_OUTPUT);

    let accW = `WHERE jl.account_id = @vatAccId`;
    if (from) { accW += ` AND je.entry_date >= @from`; rq3.input('from', sql.NVarChar, from); }
    if (to)   { accW += ` AND je.entry_date <= @to`;   rq3.input('to',   sql.NVarChar, to);   }
    rq3.input('vatAccId', sql.Int, vatAcc);

    const accVatQ = `
      SELECT COALESCE(SUM(jl.credit), 0) AS vat_collected,
             COALESCE(SUM(jl.debit), 0) AS vat_reversed
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      ${accW}
    `;
    const accVat = vatAcc ? (await rq3.query(accVatQ)).recordset[0] : { vat_collected: 0, vat_reversed: 0 };

    // Merge sales & returns VAT by rate
    const rateMap = {};
    for (const r of salesVat) {
      const rate = num(r.vat_rate);
      rateMap[rate] = {
        vat_rate: rate,
        invoice_count: num(r.invoice_count),
        taxable_sales: num(r.taxable_sales),
        vat_collected: num(r.vat_collected),
        return_count: 0,
        taxable_returns: 0,
        vat_reversed: 0
      };
    }
    for (const r of retVat) {
      const rate = num(r.vat_rate);
      if (!rateMap[rate]) {
        rateMap[rate] = {
          vat_rate: rate,
          invoice_count: 0,
          taxable_sales: 0,
          vat_collected: 0,
          return_count: 0,
          taxable_returns: 0,
          vat_reversed: 0
        };
      }
      rateMap[rate].return_count += num(r.return_count);
      rateMap[rate].taxable_returns += num(r.taxable_returns);
      rateMap[rate].vat_reversed += num(r.vat_reversed);
    }

    const details = Object.values(rateMap).sort((a, b) => a.vat_rate - b.vat_rate);
    const totals = details.reduce((acc, r) => {
      acc.taxable_sales += r.taxable_sales;
      acc.taxable_returns += r.taxable_returns;
      acc.vat_collected += r.vat_collected;
      acc.vat_reversed += r.vat_reversed;
      return acc;
    }, { taxable_sales: 0, taxable_returns: 0, vat_collected: 0, vat_reversed: 0 });
    totals.net_vat = totals.vat_collected - totals.vat_reversed;

    res.json({
      success: true,
      data: details,
      totals,
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
    return res.status(500).json({ success: false, message: err.message || 'خطأ في قاعدة البيانات' });
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

    const offset = (Number(page) - 1) * Number(per_page);

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
      OFFSET ${offset} ROWS FETCH NEXT ${Number(per_page)} ROWS ONLY
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

    const offset = (Number(page) - 1) * Number(per_page);

    // Sales returns don't have rep_id, so compute returns via customer invoice rep
    const repWhere = rep_id ? 'AND r.id = @rep_id' : '';
    const repWhereCount = rep_id ? 'AND id = @rep_id' : '';
    let colWheres = rep_id ? 'cc.rep_id = @rep_id' : 'cc.rep_id IS NOT NULL';
    if (from)   { rq.input('col_from', sql.NVarChar, from); colWheres += ` AND cc.collection_date >= @col_from`; }
    if (to)     { rq.input('col_to',   sql.NVarChar, to);   colWheres += ` AND cc.collection_date <= @col_to`;   }
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
               COUNT(DISTINCT cc.id) AS collection_count,
               COALESCE(SUM(cc.amount), 0) AS total_collections,
               COALESCE(AVG(cc.amount), 0) AS avg_collection
        FROM customer_collections cc
        WHERE ${colWheres}
        GROUP BY cc.rep_id
      )
      SELECT r.id, r.rep_code, r.rep_name, r.phone, r.target_amount, r.commission_rate,
             COALESCE(rs.invoice_count, 0) AS invoice_count,
             COALESCE(rs.total_sales, 0) AS total_sales,
             COALESCE(rs.total_discount, 0) AS total_discount,
             COALESCE(rs.avg_invoice, 0) AS avg_invoice,
             0 AS total_returns,
             COALESCE(rc.total_collections, 0) AS total_collections,
             COALESCE(rc.collection_count, 0) AS collection_count,
             COALESCE(rc.avg_collection, 0) AS avg_collection,
             CASE WHEN COALESCE(rs.total_sales, 0) > 0
                  THEN (COALESCE(rc.total_collections, 0) / COALESCE(rs.total_sales, 0)) * 100
                  ELSE 0 END AS collection_rate,
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
      OFFSET ${offset} ROWS FETCH NEXT ${Number(per_page)} ROWS ONLY
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

    // Collection totals
    let colTotWhere = '1=1';
    if (from)   { colTotWhere += ` AND collection_date >= N'${from.replace(/'/g, "''")}'`; }
    if (to)     { colTotWhere += ` AND collection_date <= N'${to.replace(/'/g, "''")}'`;   }
    const colTotQ = `
      SELECT COALESCE(SUM(amount), 0) AS total_collections,
             COUNT(*) AS collection_count
      FROM customer_collections
      WHERE ${colTotWhere} AND rep_id IS NOT NULL
    `;
    const colTotals = (await rq.query(colTotQ)).recordset[0];

    res.json({
      success: true,
      data,
      totals: {
        total_sales: num(totals.total_sales),
        total_collections: num(colTotals.total_collections),
        collection_count: num(colTotals.collection_count)
      },
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

    let wI = '', wR = '', wC = '', wJ = '';
    if (from) { wI = ` AND i.invoice_date >= N'${from.replace(/'/g, "''")}'`; }
    if (to)   { wI += ` AND i.invoice_date <= N'${to.replace(/'/g, "''")}'`; }
    if (from) { wR = ` AND r.return_date >= N'${from.replace(/'/g, "''")}'`; }
    if (to)   { wR += ` AND r.return_date <= N'${to.replace(/'/g, "''")}'`; }
    if (from) { wC = ` AND c.collection_date >= N'${from.replace(/'/g, "''")}'`; }
    if (to)   { wC += ` AND c.collection_date <= N'${to.replace(/'/g, "''")}'`; }

    const q = `
      SELECT trans_date, doc_no, doc_type, debit, credit FROM (
        SELECT i.invoice_date AS trans_date, i.invoice_no AS doc_no, N'فاتورة مبيعات' AS doc_type, i.grand_total AS debit, 0 AS credit
        FROM sales_invoices i WHERE i.customer_id = ${cid} AND i.status NOT IN ('cancelled', 'deleted')${wI}
        UNION ALL
        SELECT r.return_date, r.return_no, N'مرتجع مبيعات', 0, r.grand_total
        FROM sales_returns r WHERE r.customer_id = ${cid} AND r.status NOT IN ('cancelled', 'deleted')${wR}
        UNION ALL
        SELECT c.collection_date, c.collection_no, N'تحصيل', 0, c.amount
        FROM customer_collections c WHERE c.customer_id = ${cid}${wC}
      ) sub ORDER BY trans_date ASC
    `;
    const rows = (await pool.request().query(q)).recordset;

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

// â”€â”€ Purchase Invoice Print â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/purchase-invoice/:id/print', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();
    rq.input('id', sql.Int, req.params.id);

    const invRes = await rq.query(`SELECT i.*, s.supplier_name, s.phone, s.address,
                                          st.store_name
                                   FROM purchase_invoices i
                                   LEFT JOIN suppliers s ON i.supplier_id = s.id
                                   LEFT JOIN stores st ON i.store_id = st.id
                                   WHERE i.id = @id`);
    const invoice = invRes.recordset[0];
    if (!invoice) return res.status(404).send('الفاتورة غير موجودة');

    const itemsRes = await rq.query(`SELECT ii.*, p.product_name, p.product_code, p.unit_name
                                     FROM purchase_invoice_items ii
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

    const paymentMethodLabel =
      invoice.payment_type === 'cash'   ? 'نقدي' :
      invoice.payment_type === 'credit' ? 'آجل'  :
      invoice.payment_type === 'bank'   ? 'تحويل بنكي' :
      invoice.payment_type === 'check'  ? 'شيك' : (invoice.payment_type || '-');

    function money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function e(v) { return escapeHtml(v); }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة مشتريات ${e(invoice.invoice_no)}</title>
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
  .bottom-bar{background:#1f2937;color:#fff;padding:8px 18px;display:flex;justify-content:space-between;align-items:center;font-size:11px;flex-wrap:wrap;gap:8px;}
  .bottom-bar>div{display:flex;align-items:center;gap:5px;}
  .bottom-bar i{color:#9ca3af;font-size:11px;}
  .bottom-bar span{opacity:0.95;}
  .no-print{max-width:850px;margin:0 auto 8px;text-align:center;}
  .no-print button{padding:8px 24px;background:#1f2937;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;font-family:'Cairo',sans-serif;}
  @page{size:A4;margin:6mm;}
  @media print{body{padding:0;background:#fff!important;font-size:11px;}.page{box-shadow:none;border:none;max-width:100%;}.no-print{display:none!important;}}
  .cancelled-stamp{text-align:center;padding:18px 14px;margin:14px 18px;border:3px double #dc2626;border-radius:8px;background:#fef2f2;}
  .cancelled-stamp .cs-text{font-size:28px;font-weight:900;color:#dc2626;letter-spacing:4px;line-height:1;}
  .cancelled-stamp .cs-sub{font-size:12px;color:#dc2626;margin-top:6px;font-weight:700;}
</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()"><i class="fa-solid fa-print"></i> طباعة فاتورة المشتريات</button></div>
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
      <div class="contact-row"><i class="fa-solid fa-hashtag"></i> <span>${e(company.tax_number||'')}${company.cr_no ? ' | سجل تجاري: ' + e(company.cr_no) : ''}</span></div>
    </div></div>
  </div>
  <div class="header-right">
    <div class="invoice-title">فاتورة مشتريات</div>
    <div class="invoice-title-en">PURCHASE INVOICE</div>
    <div class="invoice-number-box">
      <div class="invoice-number-label">رقم الفاتورة</div>
      <div class="invoice-number-value">${e(invoice.invoice_no)}</div>
    </div>
  </div>
</div>

<div class="meta-boxes">
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-calendar"></i></div>
    <div class="meta-text"><div class="lbl">التاريخ</div><div class="val">${e(invoice.invoice_date||'')}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-calendar-check"></i></div>
    <div class="meta-text"><div class="lbl">تاريخ الاستحقاق</div><div class="val">${e(invoice.due_date||'')}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-credit-card"></i></div>
    <div class="meta-text"><div class="lbl">طريقة الدفع</div><div class="val">${paymentMethodLabel}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-warehouse"></i></div>
    <div class="meta-text"><div class="lbl">المخزن</div><div class="val">${e(invoice.store_name||'')}</div></div>
  </div>
</div>

<div class="info-cards">
  <div class="info-card">
    <div class="info-card-header"><i class="fa-solid fa-truck"></i> بيانات المورد</div>
    <div class="info-row"><span class="lbl">الاسم</span><span class="val">${e(invoice.supplier_name||'-')}</span></div>
    <div class="info-row"><span class="lbl">الهاتف</span><span class="val">${e(invoice.phone||'-')}</span></div>
    <div class="info-row"><span class="lbl">العنوان</span><span class="val">${e(invoice.address||'-')}</span></div>
    <div class="info-row"><span class="lbl">الرقم الضريبي</span><span class="val">${e(invoice.tax_number||'-')}</span></div>
  </div>
  <div class="info-card">
    <div class="info-card-header"><i class="fa-solid fa-file-invoice"></i> بيانات الفاتورة</div>
    <div class="info-row"><span class="lbl">رقم فاتورة المورد</span><span class="val">${e(invoice.supplier_invoice_no||'-')}</span></div>
    <div class="info-row"><span class="lbl">الط­الط©</span><span class="val">${isCancelled ? 'ملغاة' : 'مسجلة'}</span></div>
    <div class="info-row"><span class="lbl">الالمبلغ المدفوع</span><span class="val" style="color:#059669;">${money(amount_paid)}</span></div>
    <div class="info-row"><span class="lbl">المتبقي</span><span class="val" style="color:${remaining > 0 ? '#dc2626' : '#059669'};">${money(remaining)}</span></div>
  </div>
</div>

<div class="items-section">
  <div class="section-title"><i class="fa-solid fa-box"></i> الأصناف الفاتورة</div>
  <table class="items-table">
    <thead><tr>
      <th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>سعر التكلفة</th><th>الإجمالي</th>
    </tr></thead>
    <tbody>
      ${items.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td class="item-name-cell">${e(item.product_name)}<br><small style="color:#9ca3af;font-size:9px;">${e(item.product_code||'')}</small></td>
        <td>${e(item.unit_name||'-')}</td>
        <td>${Number(item.quantity).toLocaleString()}</td>
        <td>${money(item.cost_price)}</td>
        <td>${money(item.line_total || (item.quantity * item.cost_price))}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="totals-section">
  <div class="totals-side-col">
    <div class="totals-side-card">
      <div class="ts-head">إجمالي الأصناف</div>
      <div class="ts-big">${money(subtotal)}</div>
    </div>
    <div class="totals-side-card">
      <div class="ts-head">ط¹ط¯ط¯ الأصناف</div>
      <div class="ts-big">${items.length}</div>
    </div>
  </div>
  <div class="summary-table">
    <table>
      <tr><td>إجمالي الأصناف</td><td>${money(subtotal)}</td></tr>
      ${discount ? `<tr><td>الخصم</td><td style="color:#dc2626;">-${money(discount)}</td></tr>` : ''}
      ${tax ? `<tr><td>ضريبة القيمة المضافة</td><td style="color:#059669;">+${money(tax)}</td></tr>` : ''}
      <tr class="grand"><td>الإجمالي النهائي</td><td>${money(grand_total)}</td></tr>
    </table>
  </div>
</div>

${isCancelled ? `<div class="cancelled-stamp"><div class="cs-text">ملغاة</div><div class="cs-sub">هذا الفاتورة ملغاة ولم يعد لها أي اعتبار</div></div>` : ''}

<div class="footer">
  <div class="footer-card">
    <h4><i class="fa-solid fa-message"></i> ملاحظات</h4>
    <div style="font-size:11px;color:#4b5563;min-height:40px;">${e(invoice.notes||'لا توجد ملاحظات')}</div>
  </div>
  <div class="footer-card" style="text-align:center;">
    <h4><i class="fa-solid fa-signature"></i> توقيع</h4>
    <div class="signature-line"></div>
    <div class="signature-text">المورد / الالمستلم</div>
  </div>
  <div class="footer-card" style="text-align:center;">
    <h4><i class="fa-solid fa-barcode"></i> QR</h4>
    <div style="font-size:9px;color:#6b7280;margin-top:4px;">${e(invoice.invoice_no)}</div>
  </div>
</div>

<div class="bottom-bar">
  <div><i class="fa-regular fa-copyright"></i> <span>${e(company.company_name||'')}</span></div>
  <div><i class="fa-solid fa-print"></i> <span>تمت الطباعة: ${new Date().toLocaleString('ar-EG')}</span></div>
  <div><i class="fa-solid fa-hashtag"></i> <span>فاتورة مشتريات رقم ${e(invoice.invoice_no)}</span></div>
</div>
</div>
</body>
</html>`);
  } catch (err) {
    console.error('Purchase invoice print error:', err);
    res.status(500).send('خطأ في طباعة فاتورة المشتريات');
  }
}));

// â”€â”€ Purchase Return Print â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/purchase-return/:id/print', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();
    rq.input('id', sql.Int, req.params.id);

    const retRes = await rq.query(`
      SELECT pr.*, s.supplier_name, s.phone, s.address,
             pi.invoice_no as original_invoice_no, pi.invoice_date as original_invoice_date,
             st.store_name, rr.label_ar AS reason_name
      FROM purchase_returns pr
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      LEFT JOIN purchase_invoices pi ON pr.invoice_id = pi.id
      LEFT JOIN stores st ON pr.store_id = st.id
      LEFT JOIN return_reasons rr ON pr.return_reason = rr.code
      WHERE pr.id = @id`);
    const pret = retRes.recordset[0];
    if (!pret) return res.status(404).send('المرتجع غير موجود');

    const itemsRes = await rq.query(`
      SELECT pri.*, p.product_name, p.product_code, p.unit_name
      FROM purchase_return_items pri
      LEFT JOIN products p ON pri.product_id = p.id
      WHERE pri.return_id = @id`);
    const items = itemsRes.recordset;

    const company = await loadCompanyData(rq);

    // Fetch creator user name
    let createdByName = '—';
    if (pret.created_by) {
        try {
            const uRes = await rq.query(`SELECT full_name FROM users WHERE id = ${pret.created_by}`);
            if (uRes.recordset[0]) createdByName = uRes.recordset[0].full_name;
        } catch(e) {}
    }

    const subtotal = Number(pret.subtotal) || 0;
    const discount = Number(pret.discount_amount) || 0;
    const tax = Number(pret.tax_amount) || 0;
    const grand_total = Number(pret.grand_total) || 0;
    const isCancelled = pret.status === 'cancelled' || pret.status === 'deleted';

    function money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function e(v) { return escapeHtml(v); }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>مرتجع مشتريات ${e(pret.return_no)}</title>
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
  .invoice-number-box{background:#dc2626;color:#fff;padding:8px 12px;border-radius:6px;display:inline-block;min-width:160px;text-align:center;}
  .invoice-number-label{font-size:10px;opacity:0.7;margin-bottom:2px;}
  .invoice-number-value{font-size:18px;font-weight:900;letter-spacing:1px;}
  .meta-boxes{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px 18px;border-bottom:1px solid #e5e7eb;background:#fafafa;}
  .meta-box{display:flex;align-items:center;gap:8px;padding:4px 8px;}
  .meta-box .icon-wrap{width:26px;height:26px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#4b5563;font-size:11px;flex-shrink:0;}
  .meta-box .meta-text{text-align:right;flex:1;min-width:0;}
  .meta-box .lbl{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:0.2px;line-height:1.2;}
  .meta-box .val{font-size:12px;font-weight:800;color:#1f2937;line-height:1.3;}
  .info-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 18px;}
  .info-card{border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;}
  .info-card-header{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#1f2937;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #f3f4f6;}
  .info-card-header i{color:#9ca3af;font-size:11px;}
  .info-row{display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:2px 0;gap:8px;}
  .info-row .lbl{color:#6b7280;flex-shrink:0;}
  .info-row .val{color:#1f2937;font-weight:600;text-align:left;overflow:hidden;text-overflow:ellipsis;}
  .items-section{padding:0 18px 10px;}
  .section-title{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#fff;margin:0 0 6px 0;padding:5px 10px;background:#dc2626;border-radius:4px;width:fit-content;}
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
  .summary-table{border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;}
  .summary-table table{width:100%;border-collapse:collapse;}
  .summary-table td{padding:5px 12px;font-size:11px;border-bottom:1px solid #f3f4f6;}
  .summary-table tr:last-child td{border-bottom:none;}
  .summary-table td:first-child{color:#6b7280;}
  .summary-table td:last-child{font-weight:700;color:#1f2937;text-align:left;}
  .summary-table tr.grand td{background:#dc2626;color:#fff;font-size:12px;font-weight:900;padding:8px 12px;}
  .summary-table tr.grand td:first-child{color:#fff;}
  .footer{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;padding:10px 18px;border-top:1px solid #e5e7eb;}
  .footer-card{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;}
  .footer-card h4{margin:0 0 5px 0;font-size:11px;font-weight:800;display:flex;align-items:center;gap:5px;color:#1f2937;padding-bottom:4px;border-bottom:1px solid #f3f4f6;}
  .footer-card h4 i{color:#9ca3af;font-size:10px;}
  .bottom-bar{background:#dc2626;color:#fff;padding:8px 18px;display:flex;justify-content:space-between;align-items:center;font-size:11px;flex-wrap:wrap;gap:8px;}
  .bottom-bar>div{display:flex;align-items:center;gap:5px;}
  .bottom-bar i{color:#fca5a5;font-size:11px;}
  .bottom-bar span{opacity:0.95;}
  .no-print{max-width:850px;margin:0 auto 8px;text-align:center;}
  .no-print button{padding:8px 24px;background:#1f2937;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;font-family:'Cairo',sans-serif;}
  @page{size:A4;margin:6mm;}
  @media print{body{padding:0;background:#fff!important;font-size:11px;}.page{box-shadow:none;border:none;max-width:100%;}.no-print{display:none!important;}}
  .cancelled-stamp{text-align:center;padding:18px 14px;margin:14px 18px;border:3px double #dc2626;border-radius:8px;background:#fef2f2;}
  .cancelled-stamp .cs-text{font-size:28px;font-weight:900;color:#dc2626;letter-spacing:4px;line-height:1;}
  .cancelled-stamp .cs-sub{font-size:12px;color:#dc2626;margin-top:6px;font-weight:700;}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:80px;font-weight:900;color:rgba(220,38,38,0.06);pointer-events:none;z-index:0;letter-spacing:10px;}
  .audit-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 18px;border-top:1px solid #e5e7eb;background:#fafafa;font-size:10px;}
  .audit-item{display:flex;align-items:center;gap:4px;color:#6b7280;}
  .audit-item i{color:#9ca3af;font-size:9px;}
  .audit-item .audit-val{font-weight:700;color:#374151;}
  .source-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;}
  .source-badge.invoice{background:#dbeafe;color:#1e40af;}
  .source-badge.manual{background:#fef3c7;color:#92400e;}
</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()"><i class="fa-solid fa-print"></i> طباعة مرتجع المشتريات</button></div>
<div class="page">
<div class="watermark">ORIGINAL</div>
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
      <div class="contact-row"><i class="fa-solid fa-hashtag"></i> <span>${e(company.tax_number||'')}${company.cr_no ? ' | سجل تجاري: ' + e(company.cr_no) : ''}</span></div>
    </div></div>
  </div>
  <div class="header-right">
    <div class="invoice-title">مرتجع مشتريات</div>
    <div class="invoice-title-en">PURCHASE RETURN</div>
    <div class="invoice-number-box">
      <div class="invoice-number-label">رقم المرتجع</div>
      <div class="invoice-number-value">${e(pret.return_no)}</div>
    </div>
  </div>
</div>

<div class="meta-boxes">
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-calendar"></i></div>
    <div class="meta-text"><div class="lbl">التاريخ</div><div class="val">${e(pret.return_date||'')}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-file-invoice"></i></div>
    <div class="meta-text"><div class="lbl">الفاتورة الأصلية</div><div class="val">${e(pret.original_invoice_no||'-')}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-warehouse"></i></div>
    <div class="meta-text"><div class="lbl">المخزن</div><div class="val">${e(pret.store_name||'')}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-info-circle"></i></div>
    <div class="meta-text"><div class="lbl">الحالة</div><div class="val">${isCancelled ? 'ملغي' : 'نشط'}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-tag"></i></div>
    <div class="meta-text"><div class="lbl">النوع</div><div class="val"><span class="source-badge ${pret.source_type || 'invoice'}">${pret.source_type === 'manual' ? 'مرتجع يدوي' : 'مرتبط بفاتورة'}</span></div></div>
  </div>
  ${pret.reason_name ? `<div class="meta-box"><div class="icon-wrap"><i class="fa-solid fa-circle-question"></i></div><div class="meta-text"><div class="lbl">السبب</div><div class="val">${e(pret.reason_name)}</div></div></div>` : ''}
</div>
</div>

<div class="info-cards">
  <div class="info-card">
    <div class="info-card-header"><i class="fa-solid fa-truck"></i> بيانات المورد</div>
    <div class="info-row"><span class="lbl">الاسم</span><span class="val">${e(pret.supplier_name||'-')}</span></div>
    <div class="info-row"><span class="lbl">الهاتف</span><span class="val">${e(pret.phone||'-')}</span></div>
    <div class="info-row"><span class="lbl">العنوان</span><span class="val">${e(pret.address||'-')}</span></div>
  </div>
  <div class="info-card">
    <div class="info-card-header"><i class="fa-solid fa-file-invoice"></i> بيانات المرتجع</div>
    <div class="info-row"><span class="lbl">الفاتورة الأصلية</span><span class="val">${e(pret.original_invoice_no||'-')}</span></div>
    <div class="info-row"><span class="lbl">تاريخ الفاتورة</span><span class="val">${e(pret.original_invoice_date||'-')}</span></div>
    <div class="info-row"><span class="lbl">ملاحظات</span><span class="val">${e(pret.notes||'-')}</span></div>
  </div>
</div>

<div class="items-section">
  <div class="section-title"><i class="fa-solid fa-box"></i> الأصناف المرتجعط©</div>
  <table class="items-table">
    <thead><tr>
      <th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>سعر التكلفة</th><th>الإجمالي</th>
    </tr></thead>
    <tbody>
      ${items.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td class="item-name-cell">${e(item.product_name)}<br><small style="color:#9ca3af;font-size:9px;">${e(item.product_code||'')}</small></td>
        <td>${e(item.unit_name||'-')}</td>
        <td>${Number(item.quantity).toLocaleString()}</td>
        <td>${money(item.cost_price)}</td>
        <td>${money(item.line_total || (item.quantity * item.cost_price))}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="totals-section">
  <div class="totals-side-col">
    <div class="totals-side-card">
      <div class="ts-head">ط¹ط¯ط¯ الأصناف</div>
      <div class="ts-big">${items.length}</div>
    </div>
  </div>
  <div class="summary-table">
    <table>
      <tr><td>إجمالي الأصناف</td><td>${money(subtotal)}</td></tr>
      ${discount ? `<tr><td>الخصم</td><td style="color:#dc2626;">-${money(discount)}</td></tr>` : ''}
      ${tax ? `<tr><td>ضريبة القيمة المضافة</td><td style="color:#059669;">+${money(tax)}</td></tr>` : ''}
      <tr class="grand"><td>إجمالي المرتجع</td><td>${money(grand_total)}</td></tr>
    </table>
  </div>
</div>

${isCancelled ? `<div class="cancelled-stamp"><div class="cs-text">ملغي</div><div class="cs-sub">هذا المرتجع ملغي وليس له أي اعتبار</div></div>` : ''}

<div class="audit-bar">
  <div class="audit-item"><i class="fa-solid fa-user-plus"></i> أنشأه: <span class="audit-val">${e(createdByName)}</span></div>
  <div class="audit-item"><i class="fa-solid fa-print"></i> طُبع بواسطة: <span class="audit-val">${e(req.user?.full_name || 'المستخدم الحالي')}</span></div>
  <div class="audit-item"><i class="fa-solid fa-clock"></i> وقت الطباعة: <span class="audit-val">${new Date().toLocaleString('ar-EG')}</span></div>
</div>

<div class="footer">
  <div class="footer-card" style="text-align:center;">
    <h4><i class="fa-solid fa-user-check"></i> تم الإنشاء بواسطة</h4>
    <div style="font-size:11px;font-weight:700;color:#1f2937;padding:6px 0;">${e(createdByName)}</div>
    <div class="signature-line"></div>
    <div class="signature-text">التوقيع</div>
  </div>
  <div class="footer-card" style="text-align:center;">
    <h4><i class="fa-solid fa-stamp"></i> تم الاعتماد بواسطة</h4>
    <div style="font-size:11px;font-weight:700;color:#1f2937;padding:6px 0;">${e(createdByName)}</div>
    <div class="signature-line"></div>
    <div class="signature-text">التوقيع</div>
  </div>
  <div class="footer-card" style="text-align:center;">
    <h4><i class="fa-solid fa-truck"></i> استلم المورد</h4>
    <div style="font-size:11px;font-weight:700;color:#1f2937;padding:6px 0;">${e(pret.supplier_name||'')}</div>
    <div class="signature-line"></div>
    <div class="signature-text">التوقيع والختم</div>
  </div>
</div>

<div class="bottom-bar">
  <div><i class="fa-regular fa-copyright"></i> <span>${e(company.company_name||'')}</span></div>
  <div><i class="fa-solid fa-print"></i> <span>تمت الطباعة: ${new Date().toLocaleString('ar-EG')}</span></div>
  <div><i class="fa-solid fa-hashtag"></i> <span>مرتجع مشتريات رقم ${e(pret.return_no)}</span></div>
</div>
</div>
</body>
</html>`);
  } catch (err) {
    console.error('Purchase return print error:', err);
    res.status(500).send('خطأ في طباعة مرتجع المشتريات');
  }
}));

// â”€â”€ Supplier Payment Print â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ─── Customer Collection Print (سند قبض) ──────────────────────────
router.get('/collection/:id/print', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const collResult = await pool.request()
        .input('col_id', sql.Int, req.params.id)
        .query(`
            SELECT p.id, p.payment_no, p.payment_date, p.amount, p.status,
                   p.payment_method, p.check_no, p.check_date, p.bank_name, p.notes,
                   c.customer_name, c.phone, c.address
            FROM ar_payments p
            LEFT JOIN customers c ON p.customer_id = c.id
            WHERE p.id = @col_id
        `);
    const col = collResult.recordset[0];
    if (!col) return res.status(404).send('<h3>سند القبض غير موجود</h3>');
    
    const formatDate = (d) => {
        if (!d) return '-';
        try {
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return String(d).slice(0,10);
            return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        } catch(e) { return String(d); }
    };
    
    const fPaymentDate = formatDate(col.payment_date);
    const fCheckDate = formatDate(col.check_date);

    const methodLabel = col.payment_method === 'cash' ? 'نقدي' 
        : col.payment_method === 'check' ? 'شيك بنكي' 
        : 'تحويل بنكي';
    const checkInfo = col.payment_method === 'check' 
        ? `<div class="info-row"><span>رقم الشيك:</span><strong>${col.check_no||'-'}</strong></div>
           <div class="info-row"><span>البنك:</span><strong>${col.bank_name||'-'}</strong></div>
           <div class="info-row"><span>تاريخ الشيك:</span><strong>${fCheckDate}</strong></div>` 
        : '';
    const notesHtml = col.notes 
        ? `<div style="font-size:14px;color:#666;margin-top:8px;font-weight:normal">ملاحظات: ${col.notes}</div>` 
        : '';

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <title>سند قبض رقم ${col.payment_no || col.id}</title>
    <style>
        body{font-family:'Segoe UI',Tahoma,sans-serif;background:#fff;padding:40px;color:#333}
        .container{max-width:800px;margin:0 auto;border:2px solid #333;padding:30px;position:relative}
        .watermark{position:absolute;top:50%;left:50%;transform:translate(-50%, -50%) rotate(-45deg);font-size:120px;color:rgba(220,38,38,0.15);font-weight:900;border:10px solid rgba(220,38,38,0.15);border-radius:20px;padding:20px;pointer-events:none;z-index:999;letter-spacing:5px}
        .header{text-align:center;border-bottom:2px solid #7c3aed;padding-bottom:15px;margin-bottom:20px}
        .header h1{margin:0;font-size:22px;color:#7c3aed}
        .doc-title{text-align:center;font-size:20px;font-weight:bold;margin:20px 0;text-decoration:underline}
        .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:25px}
        .info-box{border:1px solid #ccc;padding:15px;border-radius:6px;font-size:15px}
        .info-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dashed #eee}
        .info-row:last-child{border-bottom:none}
        .amount-box{text-align:center;font-size:18px;font-weight:bold;background:#f5f3ff;padding:15px;border:2px solid #7c3aed;border-radius:6px;margin:20px 0}
        .signatures{display:flex;justify-content:space-around;margin-top:60px;font-size:15px;font-weight:bold}
        .sig-box{text-align:center;width:140px}
        .sig-line{border-bottom:1px solid #333;margin-top:40px}
        @media print{button{display:none!important}}
    </style>
</head>
<body>
    <div style="text-align:center;margin-bottom:15px">
        <button onclick="window.print()" style="background:#7c3aed;color:#fff;padding:8px 20px;border:none;border-radius:6px;cursor:pointer">🖨️ طباعة</button>
    </div>
    <div class="container">
        ${col.status === 'reversed' ? '<div class="watermark">ملغي</div>' : ''}
        <div class="header"><h1>TradePro ERP</h1><p style="margin:5px 0 0;color:#666">نظام إدارة التجارة</p></div>
        <div class="doc-title">سند قبض رقم: ${col.payment_no || col.id} ${col.status === 'reversed' ? '<span style="color:#dc2626">(ملغي)</span>' : ''}</div>
        <div class="info-grid">
            <div class="info-box">
                <div class="info-row"><span>التاريخ:</span><strong>${fPaymentDate}</strong></div>
                <div class="info-row"><span>طريقة الدفع:</span><strong>${methodLabel}</strong></div>
                ${checkInfo}
            </div>
            <div class="info-box">
                <div class="info-row"><span>استلمنا من:</span><strong>${col.customer_name}</strong></div>
                <div class="info-row"><span>الهاتف:</span><strong>${col.phone||'-'}</strong></div>
                <div class="info-row"><span>العنوان:</span><strong>${col.address||'-'}</strong></div>
            </div>
        </div>
        <div class="amount-box">المبلغ المقبوض: <span style="color:#7c3aed">${Number(col.amount).toFixed(2)} ج.م</span>${notesHtml}</div>
        <div class="signatures">
            <div class="sig-box">المستلم<div class="sig-line"></div></div>
            <div class="sig-box">المحاسب<div class="sig-line"></div></div>
            <div class="sig-box">مدير الفرع<div class="sig-line"></div></div>
        </div>
    </div>
</body>
</html>`;
    res.send(html);
  } catch(err) {
    console.error('Collection print error:', err);
    res.status(500).send('خطأ في طباعة سند القبض');
  }
}));

router.get('/payment/:id/print', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();
    rq.input('id', sql.Int, req.params.id);

    const payRes = await rq.query(`SELECT sp.*, s.supplier_name, s.phone, s.address
                                   FROM ap_payments sp
                                   LEFT JOIN suppliers s ON sp.supplier_id = s.id
                                   WHERE sp.id = @id`);
    const pay = payRes.recordset[0];
    if (!pay) return res.status(404).send('السند غير موجود');

    const fmtDate = (d) => {
        if (!d) return '-';
        try {
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return String(d).slice(0,10);
            return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
        } catch(e) { return String(d); }
    };
    const fPayDate = fmtDate(pay.payment_date);
    const fChkDate = fmtDate(pay.check_date);
    const isCancelled = pay.status === 'reversed';

    const allocRes = await rq.query(`SELECT spa.*, pi.invoice_no
                                     FROM ap_payment_allocations spa
                                     LEFT JOIN purchase_invoices pi ON spa.invoice_id = pi.id
                                     WHERE spa.payment_id = @id`);
    const allocs = allocRes.recordset;

    const company = await loadCompanyData(rq);

    const amount = Number(pay.amount) || 0;
    // Total from allocations (محاسبياً الصحيح هو مجموع التوزيع)
    
    const methodLabel = pay.payment_method === 'cash' ? 'نقدي' : pay.payment_method === 'check' ? 'شيك' : 'تحويل بنكي';

    function money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function e(v) { return (v != null ? String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''); }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<title>سند صرف - ${e(pay.payment_no)}</title>
<style>
@page { margin: 8mm; size: A4 portrait; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Cairo', Tahoma, sans-serif; color:#1e293b; background:#fff; padding:20px; font-size:13px; }
.print-header { text-align:center; border-bottom:2px solid #1e3a8a; padding-bottom:12px; margin-bottom:20px; }
.print-header h1 { font-size:20px; color:#1e3a8a; margin-bottom:4px; }
.print-header .sub { font-size:11px; color:#64748b; }
.invoice-title { text-align:center; margin:16px 0; font-size:16px; font-weight:700; color:#1e3a8a; border:1px solid #e2e8f0; display:inline-block; padding:6px 28px; border-radius:6px; background:#f8fafc; width:100%; }
.print-wrap { position:relative; }
.watermark { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-45deg); font-size:110px; color:rgba(220,38,38,0.12); font-weight:900; border:10px solid rgba(220,38,38,0.12); border-radius:20px; padding:15px 25px; pointer-events:none; z-index:999; letter-spacing:5px; white-space:nowrap; }
.info-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 30px; padding:14px; background:#f8fafc; border-radius:6px; margin-bottom:14px; border:1px solid #e2e8f0; }
.info-grid > div { padding:3px 0; }
.info-grid strong { color:#475569; }
.data-table { width:100%; border-collapse:collapse; margin:10px 0; }
.data-table th { background:#1e3a8a; color:#fff; padding:8px 10px; font-size:12px; text-align:center; }
.data-table td { padding:8px 10px; text-align:center; border-bottom:1px solid #e2e8f0; font-size:12px; }
.data-table tr:nth-child(even) td { background:#f8fafc; }
.totals { margin-top:16px; padding:12px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; text-align:center; }
.totals .amount { font-size:20px; font-weight:700; color:#dc2626; }
.notes { margin-top:12px; padding:10px; background:#fef3c7; border-radius:6px; font-size:12px; }
.footer { margin-top:24px; display:flex; justify-content:space-between; padding-top:12px; border-top:1px solid #e2e8f0; font-size:11px; color:#64748b; }
.footer .sig-line { width:160px; border-top:1px solid #94a3b8; padding-top:4px; text-align:center; font-size:11px; margin-top:30px; }
@media print { body { padding:10px; } .no-print { display:none !important; } }
</style>
</head>
<body>
<div class="no-print" style="text-align:left;margin-bottom:10px">
  <button onclick="window.print()" style="background:#1e3a8a;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px"><i class="fa-solid fa-print"></i> طباعة</button>
  <button onclick="window.close()" style="background:#64748b;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;margin-right:8px">âœ✖️ إغلاق</button>
</div>

<div class="print-header">
  ${company.logo ? '<img src="' + e(company.logo) + '" style="height:48px;object-fit:contain;margin-bottom:8px;">' : ''}
  <h1>${e(company.company_name || '')}</h1>
  <div class="sub">${e(company.company_address || '')}${company.city ? ' - ' + e(company.city) : ''} | ${e(company.company_phone || '')} | ${e(company.company_email || '')}${company.tax_number ? ' | رقم ضريبي: ' + e(company.tax_number) : ''}</div>
</div>

${isCancelled ? '<div class="watermark">ملغي</div>' : ''}
<div class="invoice-title" style="${isCancelled ? 'border-color:#dc2626;background:#fef2f2;color:#dc2626;' : ''}">سند صرف رقم: ${e(pay.payment_no)} ${isCancelled ? '<span style="font-size:14px;color:#dc2626">(ملغي)</span>' : ''}</div>

<div class="info-grid">
  <div><strong>رقم السند:</strong> ${e(pay.payment_no)}</div>
  <div><strong>التاريخ:</strong> ${fPayDate}</div>
  <div><strong>المورد:</strong> ${e(pay.supplier_name || '-')}</div>
  <div><strong>طريقة الدفع:</strong> ${methodLabel}</div>
  ${pay.payment_method === 'check' ? `<div><strong>رقم الشيك:</strong> ${e(pay.check_no || '-')}</div><div><strong>تاريخ الشيك:</strong> ${fChkDate}</div><div><strong>البنك:</strong> ${e(pay.bank_name || '-')}</div>` : ''}
  <div><strong>هاتف المورد:</strong> ${e(pay.phone || '-')}</div>
  <div><strong>العنوان:</strong> ${e(pay.address || '-')}</div>
</div>

${allocs.length > 0 ? `
<table class="data-table">
  <thead><tr><th>#</th><th>رقم الفاتورة</th><th>المبلغ المسدد</th></tr></thead>
  <tbody>
    ${allocs.map((a, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${e(a.invoice_no || '-')}</td>
        <td>${money(a.allocated_amount)} ج.م</td>
      </tr>`).join('')}
  </tbody>
</table>` : ''}

<div class="totals">
  <div style="font-size:13px;color:#64748b;margin-bottom:4px">إجمالي المبلغ المدفوع</div>
  <div class="amount">${money(allocs.length > 0 ? allocs.reduce((s,a) => s + (Number(a.allocated_amount)||0), 0) : amount)} ج.م</div>

</div>

${pay.notes ? `<div class="notes"><strong>ملاحظات:</strong> ${e(pay.notes)}</div>` : ''}

<div class="footer">
  <div>
    <div class="sig-line">توقيع المورد</div>
  </div>
  <div>
    <div class="sig-line">المحاسب</div>
  </div>
  <div>
    <div class="sig-line">المدير المالي</div>
  </div>
</div>

<div style="text-align:center;margin-top:14px;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px">
  <i class="fa-solid fa-print"></i> تمت الطباعة: ${new Date().toLocaleString('ar-EG')}
  &nbsp;|&nbsp; <i class="fa-solid fa-hashtag"></i> سند صرف رقم ${e(pay.payment_no)}
</div>
</body>
</html>`);
  } catch (err) {
    console.error('Payment print error:', err);
    res.status(500).send('خطأ في طباعة سند الصرف');
  }
}));

// =====================================================================
// PURCHASE REPORTS
// =====================================================================

router.get('/purchase-dashboard', asyncHandler(async (req, res) => {
    try {
        const { from, to } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let wheres = `WHERE status NOT IN ('cancelled', 'deleted')`;
        if (from) { wheres += ` AND invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wheres += ` AND invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }

        const purchQ = `
            SELECT COUNT(*) AS invoice_count,
                   COALESCE(SUM(grand_total), 0) AS total_purchases,
                   COALESCE(SUM(subtotal), 0) AS gross_purchases,
                   COALESCE(SUM(discount_amount), 0) AS total_discount,
                   COALESCE(SUM(tax_amount), 0) AS total_tax,
                   COALESCE(SUM(amount_paid), 0) AS total_paid,
                   COALESCE(SUM(remaining), 0) AS total_outstanding,
                   CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(grand_total), 0) / COUNT(*) ELSE 0 END AS avg_invoice
            FROM purchase_invoices i
            ${wheres}
        `;
        const purch = (await rq.query(purchQ)).recordset[0];

        const rq2 = pool.request();
        let retW = `WHERE status NOT IN ('cancelled', 'deleted')`;
        if (from) { retW += ` AND return_date >= @from`; rq2.input('from', sql.NVarChar, from); }
        if (to)   { retW += ` AND return_date <= @to`;   rq2.input('to',   sql.NVarChar, to);   }

        const retQ = `
            SELECT COALESCE(SUM(grand_total), 0) AS total_returns, COUNT(*) AS return_count
            FROM purchase_returns sr
            ${retW}
        `;
        const retData = (await rq2.query(retQ)).recordset[0];

        const rq3 = pool.request();
        let payW = '';
        if (from) { payW += ` WHERE payment_date >= @from`; rq3.input('from', sql.NVarChar, from); }
        if (to)   { payW += `${from ? ' AND' : ' WHERE'} payment_date <= @to`; rq3.input('to', sql.NVarChar, to); }
        const payQ = `
            SELECT COALESCE(SUM(amount), 0) AS paid_amount, COUNT(*) AS payment_count
            FROM supplier_payments sp
            ${payW}
        `;
        const payData = (await rq3.query(payQ)).recordset[0];

        const supQ = `SELECT COUNT(*) AS supplier_count FROM suppliers WHERE is_active = 1`;
        const supData = (await pool.request().query(supQ)).recordset[0];

        const totalPurch = num(purch.total_purchases);
        const totalReturns = num(retData.total_returns);
        const netPurch = totalPurch - totalReturns;

        res.json({
            success: true,
            data: {
                total_purchases: totalPurch,
                gross_purchases: num(purch.gross_purchases),
                total_returns: totalReturns,
                net_purchases: netPurch,
                paid_amount: num(payData.paid_amount),
                outstanding_amount: num(purch.total_outstanding),
                total_vat: num(purch.total_tax),
                invoice_count: num(purch.invoice_count),
                avg_invoice: num(purch.avg_invoice),
                supplier_count: num(supData.supplier_count),
                return_count: num(retData.return_count),
                return_rate: totalPurch > 0 ? (totalReturns / totalPurch) * 100 : 0,
                total_discount: num(purch.total_discount),
                payment_count: num(payData.payment_count)
            }
        });
    } catch (err) {
        console.error('purchase-dashboard error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/supplier-statement/:id', asyncHandler(async (req, res) => {
    try {
        const { from, to } = req.query;
        const sid = req.params.id;
        const pool = await getPool();
        const rq = pool.request();
        rq.input('sid', sql.Int, sid);

        const sup = (await rq.query(`SELECT * FROM suppliers WHERE id = @sid`)).recordset[0];
        if (!sup) return res.status(404).json({ success: false, message: 'المورد غير موجود' });

        const apAcc = await getSysAccId(rq, SYS_AP);

        let wStr = '';
        if (from) wStr += ` AND invoice_date >= @from`;
        if (to)   wStr += ` AND invoice_date <= @to`;

        let parts = [];
        parts.push(`
            SELECT invoice_date AS trans_date, invoice_no AS doc_no,
                   N'فاتورة مشتريات' AS doc_type, N'فاتورة' AS doc_type_short,
                   grand_total AS debit, 0 AS credit,
                   'purchase_invoice' AS ref_type, id AS ref_id,
                   ISNULL(notes,'') AS description, '' AS created_by_name
            FROM purchase_invoices
            WHERE supplier_id = @sid AND status NOT IN ('cancelled', 'deleted')${wStr}
        `);

        let wStrR = '';
        if (from) wStrR += ` AND return_date >= @from`;
        if (to)   wStrR += ` AND return_date <= @to`;

        parts.push(`
            SELECT return_date AS trans_date, return_no AS doc_no,
                   N'مرتجع مشتريات' AS doc_type, N'مرتجع' AS doc_type_short,
                   0 AS debit, grand_total AS credit,
                   'purchase_return' AS ref_type, id AS ref_id,
                   ISNULL(return_reason,'') AS description, '' AS created_by_name
            FROM purchase_returns
            WHERE supplier_id = @sid AND status NOT IN ('cancelled', 'deleted')${wStrR}
        `);

        let wStrP = '';
        if (from) wStrP += ` AND payment_date >= @from`;
        if (to)   wStrP += ` AND payment_date <= @to`;

        parts.push(`
            SELECT payment_date AS trans_date, payment_no AS doc_no,
                   N'سند صرف' AS doc_type, N'سند صرف' AS doc_type_short,
                   0 AS debit, amount AS credit,
                   'supplier_payment' AS ref_type, id AS ref_id,
                   ISNULL(notes,'') AS description, '' AS created_by_name
            FROM supplier_payments
            WHERE supplier_id = @sid${wStrP}
        `);

        if (apAcc) {
            let wStrJ = '';
            if (from) wStrJ += ` AND je.entry_date >= @from`;
            if (to)   wStrJ += ` AND je.entry_date <= @to`;

            parts.push(`
                SELECT je.entry_date AS trans_date, je.entry_no AS doc_no,
                       CASE WHEN jl.debit > 0 THEN N'قيد مدين' ELSE N'قيد دائن' END AS doc_type,
                       CASE WHEN jl.debit > 0 THEN N'مدين' ELSE N'دائن' END AS doc_type_short,
                       jl.debit, jl.credit,
                       'journal_entry' AS ref_type, je.id AS ref_id,
                       ISNULL(jl.description,'') AS description,
                       ISNULL(u.full_name,'') AS created_by_name
                FROM journal_entry_lines jl
                JOIN journal_entries je ON je.id = jl.entry_id
                LEFT JOIN users u ON je.created_by = u.id
                WHERE jl.account_id = @apAccId
                  AND je.reference_type IS NULL
                  AND (jl.description LIKE N'%' + CAST(@sid AS NVARCHAR) + N'%'
                       OR jl.description LIKE N'%المورد%' + CAST(@sid AS NVARCHAR)
                       OR jl.description LIKE N'%' + CAST(@sid AS NVARCHAR) + N'%')
                  ${wStrJ}
            `);
        }

        const finalQ = parts.join(' UNION ALL ') + ' ORDER BY trans_date ASC, ref_id ASC';

        const reqF = pool.request();
        reqF.input('sid', sql.Int, Number(sid));
        if (apAcc) reqF.input('apAccId', sql.Int, apAcc);
        if (from) reqF.input('from', sql.NVarChar, from);
        if (to)   reqF.input('to',   sql.NVarChar, to);

        const rowsRes = await reqF.query(finalQ);
        const rows = rowsRes.recordset;

        let running = op_bal;
        const statement = rows.map(r => {
            running += num(r.debit) - num(r.credit);
            return {
                date: r.trans_date, doc_no: r.doc_no, doc_type: r.doc_type,
                doc_type_short: r.doc_type_short, debit: num(r.debit), credit: num(r.credit),
                balance: running, description: r.description, created_by: r.created_by_name,
                ref_type: r.ref_type, ref_id: r.ref_id
            };
        });

        const totalDebit  = statement.reduce((s, r) => s + r.debit, 0);
        const totalCredit = statement.reduce((s, r) => s + r.credit, 0);
        const closing     = num(sup.opening_balance) + totalDebit - totalCredit;

        res.json({
            success: true,
            data: {
                supplier: { id: sup.id, supplier_code: sup.supplier_code, supplier_name: sup.supplier_name, phone: sup.phone, address: sup.address, current_balance: running },
                opening_balance: op_bal,
                total_debit: totalDebit, total_credit: totalCredit,
                closing_balance: closing, rows: statement
            }
        });
    } catch (err) {
        console.error('supplier-statement error:', err);
        err.status = 500; err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.get('/purchases-by-period', asyncHandler(async (req, res) => {
    try {
        const { from, to, supplier_id, store_id, group_by } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let joins = '';
        let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;

        if (from)       { wheres += ` AND i.invoice_date >= @from`;  rq.input('from', sql.NVarChar, from); }
        if (to)         { wheres += ` AND i.invoice_date <= @to`;    rq.input('to', sql.NVarChar, to); }
        if (supplier_id){ wheres += ` AND i.supplier_id = @supplier_id`; rq.input('supplier_id', sql.Int, supplier_id); }
        if (store_id)   { wheres += ` AND i.store_id = @store_id`;   rq.input('store_id', sql.Int, store_id); }

        const dateGroup = group_by === 'monthly' ? `LEFT(i.invoice_date, 7)` : `LEFT(i.invoice_date, 10)`;

        const q = `
            SELECT ${dateGroup} AS period,
                   COUNT(DISTINCT i.id) AS invoice_count,
                   COALESCE(SUM(i.subtotal), 0) AS gross_purchases,
                   COALESCE(SUM(i.discount_amount), 0) AS total_discount,
                   COALESCE(SUM(i.tax_amount), 0) AS total_tax,
                   COALESCE(SUM(i.grand_total), 0) AS net_purchases,
                   CASE WHEN COUNT(DISTINCT i.id) > 0 THEN COALESCE(SUM(i.grand_total), 0) / COUNT(DISTINCT i.id) ELSE 0 END AS avg_invoice,
                   COALESCE(SUM(pii.qty), 0) AS purchased_qty
            FROM purchase_invoices i
            LEFT JOIN (SELECT invoice_id, SUM(quantity) AS qty FROM purchase_invoice_items GROUP BY invoice_id) pii ON pii.invoice_id = i.id
            ${joins}
            ${wheres}
            GROUP BY ${dateGroup}
            ORDER BY period DESC
        `;

        const data = (await rq.query(q)).recordset;

        const rq2 = pool.request();
        if (from) rq2.input('from', sql.NVarChar, from);
        if (to)   rq2.input('to',   sql.NVarChar, to);
        let retWhere = `WHERE sr.status NOT IN ('cancelled', 'deleted')`;
        if (from) retWhere += ` AND sr.return_date >= @from`;
        if (to)   retWhere += ` AND sr.return_date <= @to`;

        const retQ = `SELECT COALESCE(SUM(sr.grand_total), 0) AS return_total FROM purchase_returns sr ${retWhere}`;
        const retData = (await rq2.query(retQ)).recordset[0];
        const returnTotal = num(retData.return_total);

        const totQ = `
            SELECT COUNT(DISTINCT i.id) AS invoice_count,
                   COALESCE(SUM(i.subtotal), 0) AS gross_purchases,
                   COALESCE(SUM(i.discount_amount), 0) AS total_discount,
                   COALESCE(SUM(i.tax_amount), 0) AS total_tax,
                   COALESCE(SUM(i.grand_total), 0) AS net_purchases
            FROM purchase_invoices i ${joins} ${wheres}
        `;
        const totData = (await rq.query(totQ)).recordset[0];
        const netPurch = num(totData.net_purchases);
        const returnRate = netPurch > 0 ? (returnTotal / netPurch) * 100 : 0;

        res.json({
            success: true, data,
            totals: {
                invoice_count: num(totData.invoice_count), purchased_qty: 0,
                gross_purchases: num(totData.gross_purchases),
                total_discount: num(totData.total_discount), total_tax: num(totData.total_tax),
                net_purchases: netPurch,
                avg_invoice: num(totData.invoice_count) > 0 ? netPurch / num(totData.invoice_count) : 0,
                return_total: returnTotal, return_rate: returnRate
            }
        });
    } catch (err) {
        console.error('purchases-by-period error:', err);
        return res.status(500).json({ success: false, message: err.message || 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/purchase-returns', asyncHandler(async (req, res) => {
    try {
        const { from, to, supplier_id, page = 1, per_page = 200 } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let wheres = `WHERE sr.status NOT IN ('cancelled', 'deleted')`;
        if (from) { wheres += ` AND sr.return_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wheres += ` AND sr.return_date <= @to`;   rq.input('to', sql.NVarChar, to); }
        if (supplier_id) { wheres += ` AND sr.supplier_id = @supplier_id`; rq.input('supplier_id', sql.Int, supplier_id); }

        const q = `
            SELECT sr.id, sr.return_no, sr.return_date, sr.grand_total, sr.tax_amount,
                   sr.grand_total - sr.tax_amount AS net_total, sr.return_reason AS reason,
                   sr.source_type, sr.reason_id,
                   s.supplier_name, pi.invoice_no, rr.label_ar AS reason_name,
                   sr.supplier_id, sr.invoice_id
            FROM purchase_returns sr
            LEFT JOIN suppliers s ON s.id = sr.supplier_id
            LEFT JOIN purchase_invoices pi ON pi.id = sr.invoice_id
            LEFT JOIN return_reasons rr ON sr.return_reason = rr.code
            ${wheres}
            ORDER BY sr.return_date DESC
            OFFSET ${(Number(page)-1)*Number(per_page)} ROWS FETCH NEXT ${Number(per_page)} ROWS ONLY
        `;

        const data = (await rq.query(q)).recordset;

        const totQ = `SELECT COUNT(*) AS return_count, COALESCE(SUM(grand_total), 0) AS grand_total, COALESCE(SUM(tax_amount), 0) AS tax_amount, COALESCE(SUM(grand_total - tax_amount), 0) AS net_total FROM purchase_returns sr ${wheres}`;
        const totals = (await rq.query(totQ)).recordset[0];

        const countQ = `SELECT COUNT(*) AS total FROM purchase_returns sr ${wheres}`;
        const countRes = (await rq.query(countQ)).recordset[0];

        res.json({
            success: true, data,
            totals: { return_count: num(totals.return_count), grand_total: num(totals.grand_total), tax_amount: num(totals.tax_amount), net_total: num(totals.net_total) },
            pagination: { page: Number(page), per_page: Number(per_page), total: num(countRes.total), total_pages: Math.ceil(num(countRes.total)/Number(per_page)) }
        });
    } catch (err) {
        console.error('purchase-returns error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/supplier-payments', asyncHandler(async (req, res) => {
    try {
        const { from, to, supplier_id, page = 1, per_page = 200 } = req.query;
        const pool = await getPool();

        let wheres = 'WHERE 1=1';
        const rq1 = pool.request();
        if (from) { wheres += ` AND sp.payment_date >= @from`; rq1.input('from', sql.NVarChar, from); }
        if (to)   { wheres += ` AND sp.payment_date <= @to`;   rq1.input('to', sql.NVarChar, to); }
        if (supplier_id) { wheres += ` AND sp.supplier_id = @supplier_id`; rq1.input('supplier_id', sql.Int, supplier_id); }

        const q = `
            SELECT sp.id, sp.payment_no, sp.payment_date, sp.amount, sp.payment_method, sp.notes,
                   s.supplier_name, s.supplier_code
            FROM supplier_payments sp
            LEFT JOIN suppliers s ON s.id = sp.supplier_id
            ${wheres}
            ORDER BY sp.payment_date DESC
            OFFSET ${(Number(page)-1)*Number(per_page)} ROWS FETCH NEXT ${Number(per_page)} ROWS ONLY
        `;
        const data = (await rq1.query(q)).recordset;

        const rq2 = pool.request();
        if (from) rq2.input('from', sql.NVarChar, from);
        if (to)   rq2.input('to', sql.NVarChar, to);
        if (supplier_id) rq2.input('supplier_id', sql.Int, supplier_id);
        const totQ = `SELECT COUNT(*) AS payment_count, COALESCE(SUM(amount), 0) AS total_amount FROM supplier_payments sp ${wheres}`;
        const totals = (await rq2.query(totQ)).recordset[0];

        const rq3 = pool.request();
        if (from) rq3.input('from', sql.NVarChar, from);
        if (to)   rq3.input('to', sql.NVarChar, to);
        if (supplier_id) rq3.input('supplier_id', sql.Int, supplier_id);
        const countQ = `SELECT COUNT(*) AS total FROM supplier_payments sp ${wheres}`;
        const countRes = (await rq3.query(countQ)).recordset[0];

        res.json({
            success: true, data,
            totals: { payment_count: num(totals.payment_count), total_amount: num(totals.total_amount) },
            pagination: { page: Number(page), per_page: Number(per_page), total: num(countRes.total), total_pages: Math.ceil(num(countRes.total)/Number(per_page)) }
        });
    } catch (err) {
        console.error('supplier-payments error:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/payables', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const q = `
            SELECT s.id, s.supplier_code, s.supplier_name, s.phone,
                   s.current_balance,
                   CASE WHEN s.current_balance > 0 THEN DATEDIFF(DAY, GETDATE(), GETDATE()) ELSE 0 END AS days_outstanding,
                   COALESCE((
                       SELECT SUM(i.grand_total - i.amount_paid)
                       FROM purchase_invoices i
                       WHERE i.supplier_id = s.id AND i.status NOT IN ('cancelled', 'deleted')
                         AND (i.grand_total - i.amount_paid) > 0
                         AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 0 AND 30
                   ), 0) AS age_0_30,
                   COALESCE((
                       SELECT SUM(i.grand_total - i.amount_paid)
                       FROM purchase_invoices i
                       WHERE i.supplier_id = s.id AND i.status NOT IN ('cancelled', 'deleted')
                         AND (i.grand_total - i.amount_paid) > 0
                         AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 31 AND 60
                   ), 0) AS age_31_60,
                   COALESCE((
                       SELECT SUM(i.grand_total - i.amount_paid)
                       FROM purchase_invoices i
                       WHERE i.supplier_id = s.id AND i.status NOT IN ('cancelled', 'deleted')
                         AND (i.grand_total - i.amount_paid) > 0
                         AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 61 AND 90
                   ), 0) AS age_61_90,
                   COALESCE((
                       SELECT SUM(i.grand_total - i.amount_paid)
                       FROM purchase_invoices i
                       WHERE i.supplier_id = s.id AND i.status NOT IN ('cancelled', 'deleted')
                         AND (i.grand_total - i.amount_paid) > 0
                         AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 91 AND 120
                   ), 0) AS age_91_120,
                   COALESCE((
                       SELECT SUM(i.grand_total - i.amount_paid)
                       FROM purchase_invoices i
                       WHERE i.supplier_id = s.id AND i.status NOT IN ('cancelled', 'deleted')
                         AND (i.grand_total - i.amount_paid) > 0
                         AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) > 120
                   ), 0) AS age_120_plus
            FROM suppliers s
            WHERE s.is_active = 1 AND s.current_balance > 0
            ORDER BY s.current_balance DESC
        `;
        const data = (await pool.request().query(q)).recordset;

        const totals = data.reduce((acc, r) => {
            acc.total_balance += num(r.current_balance);
            acc.age_0_30 += num(r.age_0_30);
            acc.age_31_60 += num(r.age_31_60);
            acc.age_61_90 += num(r.age_61_90);
            acc.age_91_120 += num(r.age_91_120);
            acc.age_120_plus += num(r.age_120_plus);
            return acc;
        }, { total_balance: 0, age_0_30: 0, age_31_60: 0, age_61_90: 0, age_91_120: 0, age_120_plus: 0 });

        res.json({ success: true, data, totals });
    } catch (err) {
        console.error('payables error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/top-suppliers', asyncHandler(async (req, res) => {
    try {
        const { from, to, page = 1, per_page = 50 } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
        if (from) { wheres += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wheres += ` AND i.invoice_date <= @to`;   rq.input('to', sql.NVarChar, to); }

        const offset = (Number(page) - 1) * Number(per_page);

        const q = `
            WITH sup_purchases AS (
                SELECT i.supplier_id,
                       COUNT(DISTINCT i.id) AS invoice_count,
                       COALESCE(SUM(i.grand_total), 0) AS total_purchases
                FROM purchase_invoices i
                ${wheres}
                GROUP BY i.supplier_id
            ),
            sup_returns AS (
                SELECT sr.supplier_id, COALESCE(SUM(sr.grand_total), 0) AS total_returns
                FROM purchase_returns sr
                WHERE sr.status NOT IN ('cancelled', 'deleted')
                GROUP BY sr.supplier_id
            ),
            sup_payments AS (
                SELECT sp.supplier_id, COALESCE(SUM(sp.amount), 0) AS total_payments
                FROM supplier_payments sp
                GROUP BY sp.supplier_id
            )
            SELECT s.id, s.supplier_code, s.supplier_name, s.phone, s.current_balance,
                   COALESCE(sp.invoice_count, 0) AS invoice_count,
                   COALESCE(sp.total_purchases, 0) AS total_purchases,
                   COALESCE(sr.total_returns, 0) AS total_returns,
                   COALESCE(spa.total_payments, 0) AS total_payments,
                   s.current_balance AS outstanding,
                   ROW_NUMBER() OVER (ORDER BY COALESCE(sp.total_purchases, 0) DESC) AS ranking
            FROM suppliers s
            LEFT JOIN sup_purchases sp ON sp.supplier_id = s.id
            LEFT JOIN sup_returns sr ON sr.supplier_id = s.id
            LEFT JOIN sup_payments spa ON spa.supplier_id = s.id
            WHERE s.is_active = 1
            ORDER BY total_purchases DESC
            OFFSET ${offset} ROWS FETCH NEXT ${Number(per_page)} ROWS ONLY
        `;

        const data = (await rq.query(q)).recordset;

        const countQ = `SELECT COUNT(DISTINCT i.supplier_id) AS total FROM purchase_invoices i ${wheres}`;
        const countRes = (await rq.query(countQ)).recordset[0];

        res.json({
            success: true, data,
            pagination: { page: Number(page), per_page: Number(per_page), total: num(countRes.total), total_pages: Math.ceil(num(countRes.total)/Number(per_page)) }
        });
    } catch (err) {
        console.error('top-suppliers error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/product-purchases', asyncHandler(async (req, res) => {
    try {
        const { from, to, store_id, page = 1, per_page = 100, sort = 'purchase_value', order = 'desc' } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
        if (from)   { wheres += ` AND i.invoice_date >= @from`;   rq.input('from', sql.NVarChar, from); }
        if (to)     { wheres += ` AND i.invoice_date <= @to`;     rq.input('to',   sql.NVarChar, to); }
        if (store_id) { wheres += ` AND i.store_id = @store_id`;  rq.input('store_id', sql.Int, store_id); }

        const offset = (Number(page) - 1) * Number(per_page);
        const sortCol = ['purchased_qty','returned_qty','net_qty','purchase_value','cost','inventory'].includes(sort) ? sort : 'purchase_value';
        const sortDir = order === 'asc' ? 'ASC' : 'DESC';

        const q = `
            WITH product_purchases AS (
                SELECT p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, p.sell_price,
                       COALESCE(SUM(ii.quantity), 0) AS purchased_qty,
                       COALESCE(SUM(ii.line_total), 0) AS purchase_value,
                       COALESCE(SUM(ii.quantity * ii.cost_price), 0) AS cost
                FROM products p
                LEFT JOIN purchase_invoice_items ii ON ii.product_id = p.id
                LEFT JOIN purchase_invoices i ON ii.invoice_id = i.id AND i.status NOT IN ('cancelled', 'deleted')
                ${wheres}
                GROUP BY p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, p.sell_price
            ),
            product_returns AS (
                SELECT pri.product_id, COALESCE(SUM(pri.quantity), 0) AS returned_qty
                FROM purchase_return_items pri
                JOIN purchase_returns pr ON pr.id = pri.return_id AND pr.status NOT IN ('cancelled', 'deleted')
                GROUP BY pri.product_id
            ),
            product_inventory AS (
                SELECT ib.product_id, COALESCE(SUM(ib.quantity), 0) AS inventory
                FROM inventory_balances ib
                GROUP BY ib.product_id
            )
            SELECT pp.*,
                   COALESCE(pr.returned_qty, 0) AS returned_qty,
                   pp.purchased_qty - COALESCE(pr.returned_qty, 0) AS net_qty,
                   COALESCE(pinv.inventory, 0) AS inventory
            FROM product_purchases pp
            LEFT JOIN product_returns pr ON pr.product_id = pp.id
            LEFT JOIN product_inventory pinv ON pinv.product_id = pp.id
            WHERE pp.purchased_qty > 0 OR COALESCE(pr.returned_qty, 0) > 0
            ORDER BY ${sortCol} ${sortDir}
            OFFSET ${offset} ROWS FETCH NEXT ${Number(per_page)} ROWS ONLY
        `;

        const data = (await rq.query(q)).recordset;

        const cq = `SELECT COUNT(DISTINCT ii.product_id) AS total FROM purchase_invoice_items ii JOIN purchase_invoices i ON ii.invoice_id = i.id ${wheres}`;
        const countRes = (await rq.query(cq)).recordset[0];

        res.json({
            success: true, data,
            pagination: { page: Number(page), per_page: Number(per_page), total: num(countRes.total), total_pages: Math.ceil(num(countRes.total)/Number(per_page)) }
        });
    } catch (err) {
        console.error('product-purchases error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/purchase-movement', asyncHandler(async (req, res) => {
    try {
        const { from, to, supplier_id, store_id, page = 1, per_page = 200 } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let parts = [];

        let wI = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
        if (from) { wI += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wI += ` AND i.invoice_date <= @to`;   rq.input('to', sql.NVarChar, to); }
        if (supplier_id) { wI += ` AND i.supplier_id = @supplier_id`; rq.input('supplier_id', sql.Int, supplier_id); }

        parts.push(`
            SELECT i.invoice_date AS trans_date, i.invoice_no AS doc_no,
                   N'فاتورة مشتريات' AS doc_type, i.grand_total, i.tax_amount,
                   i.grand_total - i.tax_amount AS net_total, i.status,
                   s.supplier_name, st.store_name
            FROM purchase_invoices i
            LEFT JOIN suppliers s ON s.id = i.supplier_id
            LEFT JOIN stores st ON st.id = i.store_id
            ${wI}
        `);

        let wR = `WHERE sr.status NOT IN ('cancelled', 'deleted')`;
        if (from) { wR += ` AND sr.return_date >= @from`; }
        if (to)   { wR += ` AND sr.return_date <= @to`; }
        if (supplier_id) { wR += ` AND sr.supplier_id = @supplier_id`; }

        parts.push(`
            SELECT sr.return_date AS trans_date, sr.return_no AS doc_no,
                   N'مرتجع مشتريات' AS doc_type, sr.grand_total, sr.tax_amount,
                   sr.grand_total - sr.tax_amount AS net_total, sr.status,
                   s.supplier_name, st.store_name
            FROM purchase_returns sr
            LEFT JOIN suppliers s ON s.id = sr.supplier_id
            LEFT JOIN stores st ON st.id = sr.store_id
            ${wR}
        `);

        let wP = 'WHERE 1=1';
        if (from) { wP += ` AND sp.payment_date >= @from`; }
        if (to)   { wP += ` AND sp.payment_date <= @to`; }
        if (supplier_id) { wP += ` AND sp.supplier_id = @supplier_id`; }

        parts.push(`
            SELECT sp.payment_date AS trans_date, sp.payment_no AS doc_no,
                   N'سند صرف' AS doc_type, sp.amount AS grand_total, 0 AS tax_amount,
                   sp.amount AS net_total, 'paid' AS status,
                   s.supplier_name, '' AS store_name
            FROM supplier_payments sp
            LEFT JOIN suppliers s ON s.id = sp.supplier_id
            ${wP}
        `);

        const finalQ = parts.join(' UNION ALL ') + ' ORDER BY trans_date DESC, doc_no DESC';

        const reqF = pool.request();
        if (from) reqF.input('from', sql.NVarChar, from);
        if (to)   reqF.input('to',   sql.NVarChar, to);
        if (supplier_id) reqF.input('supplier_id', sql.Int, supplier_id);

        const allRows = (await reqF.query(finalQ)).recordset;
        const total = allRows.length;
        const offset = (Number(page) - 1) * Number(per_page);
        const data = allRows.slice(offset, offset + Number(per_page));

        const totals = data.reduce((acc, r) => {
            acc.grand_total += num(r.grand_total);
            acc.tax_amount += num(r.tax_amount);
            acc.net_total += num(r.net_total);
            return acc;
        }, { grand_total: 0, tax_amount: 0, net_total: 0 });

        res.json({
            success: true, data: data,
            totals: { trans_count: total, grand_total: num(totals.grand_total), tax_amount: num(totals.tax_amount), net_total: num(totals.net_total) },
            pagination: { page: Number(page), per_page: Number(per_page), total, total_pages: Math.ceil(total/Number(per_page)) }
        });
    } catch (err) {
        console.error('purchase-movement error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/vat-purchase-report', asyncHandler(async (req, res) => {
    try {
        const { from, to } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
        if (from) { wheres += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wheres += ` AND i.invoice_date <= @to`;   rq.input('to', sql.NVarChar, to); }

        const purchVatQ = `
            SELECT COUNT(DISTINCT i.id) AS invoice_count,
                   COALESCE(SUM(i.subtotal), 0) AS taxable_purchases,
                   COALESCE(SUM(i.tax_amount), 0) AS vat_paid
            FROM purchase_invoices i
            ${wheres}
        `;
        const purchVat = (await rq.query(purchVatQ)).recordset[0];

        const rq2 = pool.request();
        let retW = `WHERE sr.status NOT IN ('cancelled', 'deleted')`;
        if (from) { retW += ` AND sr.return_date >= @from`; rq2.input('from', sql.NVarChar, from); }
        if (to)   { retW += ` AND sr.return_date <= @to`;   rq2.input('to', sql.NVarChar, to); }

        const retVatQ = `
            SELECT COUNT(DISTINCT sr.id) AS return_count,
                   COALESCE(SUM(sr.grand_total), 0) AS taxable_returns
            FROM purchase_returns sr
            ${retW}
        `;
        const retVat = (await rq2.query(retVatQ)).recordset[0];

        const rq3 = pool.request();
        const vatAcc = await getSysAccId(rq3, SYS_VAT_INPUT);

        let accW = `WHERE jl.account_id = @vatAccId`;
        if (from) { accW += ` AND je.entry_date >= @from`; rq3.input('from', sql.NVarChar, from); }
        if (to)   { accW += ` AND je.entry_date <= @to`;   rq3.input('to', sql.NVarChar, to); }
        rq3.input('vatAccId', sql.Int, vatAcc);

        const accVatQ = `
            SELECT COALESCE(SUM(jl.debit), 0) AS vat_paid, COALESCE(SUM(jl.credit), 0) AS vat_reversed
            FROM journal_entry_lines jl
            JOIN journal_entries je ON je.id = jl.entry_id
            ${accW}
        `;
        const accVat = vatAcc ? (await rq3.query(accVatQ)).recordset[0] : { vat_paid: 0, vat_reversed: 0 };

        const details = [{
            vat_rate: 0,
            invoice_count: num(purchVat.invoice_count),
            taxable_purchases: num(purchVat.taxable_purchases),
            vat_paid: num(purchVat.vat_paid),
            return_count: num(retVat.return_count),
            taxable_returns: num(retVat.taxable_returns),
            vat_reversed: 0
        }];

        const totals = {
            taxable_purchases: num(purchVat.taxable_purchases),
            taxable_returns: num(retVat.taxable_returns),
            vat_paid: num(purchVat.vat_paid),
            vat_reversed: 0
        };
        totals.net_vat = totals.vat_paid - totals.vat_reversed;

        res.json({
            success: true, data: details, totals,
            accounting_validation: {
                vat_paid_operational: totals.vat_paid,
                vat_paid_accounting: num(accVat.vat_paid),
                vat_reversed_operational: totals.vat_reversed,
                vat_reversed_accounting: num(accVat.vat_reversed),
                reconciled: Math.abs(totals.vat_paid - num(accVat.vat_paid)) < 0.01 && Math.abs(totals.vat_reversed - num(accVat.vat_reversed)) < 0.01
            }
        });
    } catch (err) {
        console.error('vat-purchase-report error:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'خطأ في قاعدة البيانات' });
    }
}));

// =====================================================================
// INVENTORY REPORTS MODULE
// =====================================================================

const SYS_INVENTORY      = 'SYS_INVENTORY';
const SYS_INVENTORY_SHORTAGE = 'SYS_INVENTORY_SHORTAGE';

// ─── 1) Inventory Dashboard ─────────────────────────────────────────
router.get('/inventory/dashboard', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();
    const { from, to } = req.query;

    // Total inventory value (cost)
    const valRes = await rq.query(`
      SELECT COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value,
             COUNT(DISTINCT ib.product_id) AS total_products
      FROM inventory_balances ib
      JOIN products p ON ib.product_id = p.id
      WHERE ib.quantity != 0
    `);

    // Low stock products
    const lowRes = await rq.query(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT ib.product_id FROM inventory_balances ib
        JOIN products p ON ib.product_id = p.id
        WHERE ib.quantity <= COALESCE(p.min_stock, 0) AND ib.quantity > 0
        GROUP BY ib.product_id
      ) low
    `);

    // Out of stock products
    const oosRes = await rq.query(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT ib.product_id FROM inventory_balances ib
        GROUP BY ib.product_id HAVING COALESCE(SUM(ib.quantity), 0) <= 0
      ) oos
    `);

    // Transfer count
    let transferSql = `SELECT COUNT(*) AS cnt FROM stock_transfers WHERE status = 'posted'`;
    const tParts = [];
    if (from) { tParts.push(` AND transfer_date >= @tfrom`); rq.input('tfrom', sql.NVarChar, from); }
    if (to)   { tParts.push(` AND transfer_date <= @tto`);   rq.input('tto',   sql.NVarChar, to);   }
    const trnRes = await rq.query(transferSql + tParts.join(''));

    // Disposal count
    let dispSql = `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_value), 0) AS disp_value FROM stock_disposals WHERE status = 'posted'`;
    const dParts = [];
    if (from) { dParts.push(` AND doc_date >= @dfrom`); rq.input('dfrom', sql.NVarChar, from); }
    if (to)   { dParts.push(` AND doc_date <= @dto`);   rq.input('dto',   sql.NVarChar, to);   }
    const dispRes = await rq.query(dispSql + dParts.join(''));

    // Stock count count
    const cntRes = await rq.query(`SELECT COUNT(*) AS cnt FROM stock_count WHERE status = 'completed'`);

    // Adjustment count
    let adjSql = `SELECT COUNT(*) AS cnt, COALESCE(SUM(ABS(quantity)), 0) AS adj_qty FROM stock_adjustments WHERE status = 'posted'`;
    const aParts = [];
    if (from) { aParts.push(` AND adj_date >= @afrom`); rq.input('afrom', sql.NVarChar, from); }
    if (to)   { aParts.push(` AND adj_date <= @ato`);   rq.input('ato',   sql.NVarChar, to);   }
    const adjRes = await rq.query(adjSql + aParts.join(''));

    // Top store by value
    const topStoreRes = await rq.query(`
      SELECT TOP 1 s.id, s.store_name,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS store_value
      FROM stores s
      JOIN inventory_balances ib ON s.id = ib.store_id
      JOIN products p ON ib.product_id = p.id
      WHERE ib.quantity != 0
      GROUP BY s.id, s.store_name
      ORDER BY store_value DESC
    `);

    // Bottom store by value
    const botStoreRes = await rq.query(`
      SELECT TOP 1 s.id, s.store_name,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS store_value
      FROM stores s
      JOIN inventory_balances ib ON s.id = ib.store_id
      JOIN products p ON ib.product_id = p.id
      WHERE ib.quantity != 0
      GROUP BY s.id, s.store_name
      ORDER BY store_value ASC
    `);

    // Store count
    const stCntRes = await rq.query(`SELECT COUNT(*) AS cnt FROM stores WHERE status IS NULL OR status = 'active'`);

    res.json({
      success: true,
      data: {
        total_value: num(valRes.recordset[0].total_value),
        total_products: num(valRes.recordset[0].total_products),
        low_stock_count: num(lowRes.recordset[0].cnt),
        out_of_stock_count: num(oosRes.recordset[0].cnt),
        transfer_count: num(trnRes.recordset[0].cnt),
        disposal_count: num(dispRes.recordset[0].cnt),
        disposal_value: num(dispRes.recordset[0].disp_value),
        count_count: num(cntRes.recordset[0].cnt),
        adjustment_count: num(adjRes.recordset[0].cnt),
        adjustment_qty: num(adjRes.recordset[0].adj_qty),
        top_store: topStoreRes.recordset[0] || null,
        bottom_store: botStoreRes.recordset[0] || null,
        store_count: num(stCntRes.recordset[0].cnt)
      }
    });
  } catch (err) {
    console.error('inventory/dashboard error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 2) Inventory Balances Report ────────────────────────────────────
router.get('/inventory/balances', asyncHandler(async (req, res) => {
  try {
    const { store_id, category_id, stock_status } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE ib.quantity != 0';
    if (store_id) { where += ' AND ib.store_id = @sid'; rq.input('sid', sql.Int, store_id); }
    if (category_id) { where += ' AND p.category_id = @cat'; rq.input('cat', sql.Int, category_id); }
    if (stock_status === 'low') { where += ' AND ib.quantity <= COALESCE(p.min_stock, 0)'; }
    if (stock_status === 'out') { where += ' AND ib.quantity <= 0'; }
    if (stock_status === 'normal') { where += ' AND ib.quantity > COALESCE(p.min_stock, 0)'; }

    const result = await rq.query(`
      SELECT ib.store_id, s.store_name,
             ib.product_id, p.product_code, p.product_name, p.unit_name,
             ib.quantity, COALESCE(p.cost_price, 0) AS cost_price,
             (ib.quantity * COALESCE(p.cost_price, 0)) AS total_value,
             COALESCE(p.min_stock, 0) AS min_stock,
             CASE WHEN ib.quantity <= 0 THEN 'out'
                  WHEN ib.quantity <= COALESCE(p.min_stock, 0) THEN 'low'
                  ELSE 'normal' END AS stock_status
      FROM inventory_balances ib
      JOIN stores s ON ib.store_id = s.id
      JOIN products p ON ib.product_id = p.id
      ${where}
      ORDER BY s.store_name, p.product_name
    `);

    const totals = { total_qty: 0, total_value: 0, product_count: 0 };
    result.recordset.forEach(r => {
      totals.total_qty += num(r.quantity);
      totals.total_value += num(r.total_value);
      totals.product_count++;
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/balances error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 3) Inventory Movement (Stock Card) ──────────────────────────────
router.get('/inventory/movement/:productId', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id } = req.query;
    const productId = req.params.productId;
    const pool = await getPool();
    const rq = pool.request();
    rq.input('pid', sql.Int, productId);

    // Product info
    const prodRes = await rq.query(`SELECT * FROM products WHERE id = @pid`);
    if (!prodRes.recordset[0]) return res.status(404).json({ success: false, message: 'الصنف غير موجود' });
    const product = prodRes.recordset[0];

    // Opening balance before the period
    let opening = 0;
    if (from) {
      rq.input('opfrom', sql.NVarChar, from);
      const opRes = await rq.query(`
        SELECT COALESCE(SUM(qty_in), 0) - COALESCE(SUM(qty_out), 0) AS balance
        FROM stock_movements
        WHERE product_id = @pid AND move_date < @opfrom
        ${store_id ? 'AND store_id = @op_sid' : ''}
      `);
      if (store_id) rq.input('op_sid', sql.Int, store_id);
      opening = num(opRes.recordset[0].balance);
    } else {
      // Get balance from inventory_balances
      const balRes = await rq.query(`
        SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_balances WHERE product_id = @pid
        ${store_id ? 'AND store_id = @bal_sid' : ''}
      `);
      if (store_id) rq.input('bal_sid', sql.Int, store_id);
      // We'll compute opening as 0 and movements as the full history
      opening = 0;
    }

    // Movements
    let movWhere = 'WHERE sm.product_id = @pid';
    if (from) { movWhere += ' AND sm.move_date >= @mfrom'; rq.input('mfrom', sql.NVarChar, from); }
    if (to)   { movWhere += ' AND sm.move_date <= @mto';   rq.input('mto',   sql.NVarChar, to);   }
    if (store_id) { movWhere += ' AND sm.store_id = @msid'; rq.input('msid', sql.Int, store_id); }

    const movRes = await rq.query(`
      SELECT sm.id, sm.move_date, sm.move_type, sm.document_no, sm.store_id,
             s.store_name, sm.qty_in, sm.qty_out, sm.cost_price, sm.sell_price,
             sm.balance_after, sm.notes, sm.created_at
      FROM stock_movements sm
      LEFT JOIN stores s ON sm.store_id = s.id
      ${movWhere}
      ORDER BY sm.move_date ASC, sm.id ASC
    `);

    // Closing balance = opening + net movements
    let runningBalance = opening;
    const rows = movRes.recordset.map(m => {
      const qtyIn = num(m.qty_in);
      const qtyOut = num(m.qty_out);
      runningBalance += qtyIn - qtyOut;
      return {
        ...m,
        qty_in: qtyIn,
        qty_out: qtyOut,
        cost_price: num(m.cost_price),
        running_balance: runningBalance
      };
    });
    const closingBalance = runningBalance;

    // Store info
    let stores = [];
    if (store_id) {
      const sRes = await pool.request().query(`SELECT id, store_name FROM stores WHERE id = ${parseInt(store_id)}`);
      stores = sRes.recordset;
    }

    res.json({
      success: true,
      data: {
        product: { id: product.id, product_code: product.product_code, product_name: product.product_name, unit_name: product.unit_name, cost_price: num(product.cost_price) },
        opening_balance: opening,
        closing_balance: closingBalance,
        movements: rows,
        total_qty_in: rows.reduce((s, r) => s + r.qty_in, 0),
        total_qty_out: rows.reduce((s, r) => s + r.qty_out, 0)
      }
    });
  } catch (err) {
    console.error('inventory/movement error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 4) Transfer Report ──────────────────────────────────────────────
router.get('/inventory/transfers', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE 1=1';
    if (from) { where += ' AND t.transfer_date >= @from'; rq.input('from', sql.NVarChar, from); }
    if (to)   { where += ' AND t.transfer_date <= @to';   rq.input('to',   sql.NVarChar, to);   }
    if (store_id) { where += ' AND (t.from_store_id = @sid OR t.to_store_id = @sid)'; rq.input('sid', sql.Int, store_id); }

    const result = await rq.query(`
      SELECT t.id, t.transfer_no, t.transfer_date, t.status, t.notes, t.created_at,
             fs.store_name AS from_store, ts.store_name AS to_store,
             (SELECT COUNT(*) FROM stock_transfer_items WHERE transfer_id = t.id) AS item_count,
             (SELECT COALESCE(SUM(quantity), 0) FROM stock_transfer_items WHERE transfer_id = t.id) AS total_qty
      FROM stock_transfers t
      JOIN stores fs ON t.from_store_id = fs.id
      JOIN stores ts ON t.to_store_id = ts.id
      ${where}
      ORDER BY t.id DESC
    `);

    const totals = { transfer_count: result.recordset.length, total_qty: 0 };
    result.recordset.forEach(r => { totals.total_qty += num(r.total_qty); });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/transfers error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 5) Disposal Report ──────────────────────────────────────────────
router.get('/inventory/disposals', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE d.status = \'posted\'';
    if (from) { where += ' AND d.doc_date >= @from'; rq.input('from', sql.NVarChar, from); }
    if (to)   { where += ' AND d.doc_date <= @to';   rq.input('to',   sql.NVarChar, to);   }
    if (store_id) { where += ' AND d.store_id = @sid'; rq.input('sid', sql.Int, store_id); }

    const result = await rq.query(`
      SELECT d.id, d.doc_no, d.doc_date, d.store_id, s.store_name, d.committee,
             d.reason, d.notes, d.total_qty, d.total_value, d.status, d.created_at,
             u.username AS created_by_name,
             (SELECT COUNT(*) FROM stock_disposal_items WHERE disposal_id = d.id) AS item_count
      FROM stock_disposals d
      LEFT JOIN stores s ON d.store_id = s.id
      LEFT JOIN users u ON d.created_by = u.id
      ${where}
      ORDER BY d.id DESC
    `);

    const totals = { disposal_count: result.recordset.length, total_qty: 0, total_value: 0 };
    result.recordset.forEach(r => {
      totals.total_qty += num(r.total_qty);
      totals.total_value += num(r.total_value);
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/disposals error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 6) Stock Count Report ────────────────────────────────────────────
router.get('/inventory/counts', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE 1=1';
    if (from) { where += ' AND c.count_date >= @from'; rq.input('from', sql.NVarChar, from); }
    if (to)   { where += ' AND c.count_date <= @to';   rq.input('to',   sql.NVarChar, to);   }
    if (store_id) { where += ' AND c.store_id = @sid'; rq.input('sid', sql.Int, store_id); }

    const result = await rq.query(`
      SELECT c.id, c.count_no, c.count_date, c.store_id, s.store_name, c.status, c.notes, c.created_at,
             (SELECT COUNT(*) FROM stock_count_items WHERE count_id = c.id) AS item_count,
             (SELECT COUNT(*) FROM stock_count_items WHERE count_id = c.id AND diff != 0) AS diff_count,
             (SELECT COALESCE(SUM(ABS(diff)), 0) FROM stock_count_items WHERE count_id = c.id) AS total_diff_qty,
             (SELECT COALESCE(SUM(ABS(diff) * COALESCE(p.cost_price, 0)), 0)
              FROM stock_count_items ci
              JOIN products p ON ci.product_id = p.id
              WHERE ci.count_id = c.id) AS total_diff_value
      FROM stock_count c
      LEFT JOIN stores s ON c.store_id = s.id
      ${where}
      ORDER BY c.id DESC
    `);

    const totals = { count_count: result.recordset.length, total_diff_qty: 0, total_diff_value: 0 };
    result.recordset.forEach(r => {
      totals.total_diff_qty += num(r.total_diff_qty);
      totals.total_diff_value += num(r.total_diff_value);
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/counts error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 7) Adjustment Report ────────────────────────────────────────────
router.get('/inventory/adjustments', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE a.status = \'posted\'';
    if (from) { where += ' AND a.adj_date >= @from'; rq.input('from', sql.NVarChar, from); }
    if (to)   { where += ' AND a.adj_date <= @to';   rq.input('to',   sql.NVarChar, to);   }
    if (store_id) { where += ' AND a.store_id = @sid'; rq.input('sid', sql.Int, store_id); }

    const result = await rq.query(`
      SELECT a.id, a.adj_no, a.adj_date, a.store_id, s.store_name, a.product_id,
             p.product_code, p.product_name, p.unit_name,
             a.quantity, (a.quantity * COALESCE(p.cost_price, 0)) AS total_value,
             a.reason, a.status, a.created_at
      FROM stock_adjustments a
      LEFT JOIN stores s ON a.store_id = s.id
      LEFT JOIN products p ON a.product_id = p.id
      ${where}
      ORDER BY a.id DESC
    `);

    const totals = { adjustment_count: result.recordset.length, total_qty: 0, total_value: 0 };
    result.recordset.forEach(r => {
      totals.total_qty += num(r.quantity);
      totals.total_value += num(r.total_value);
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/adjustments error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 8) Slow-Moving Items Report ─────────────────────────────────────
router.get('/inventory/slow-moving', asyncHandler(async (req, res) => {
  try {
    const { days, store_id } = req.query;
    const threshold = parseInt(days) || 90;
    const pool = await getPool();
    const rq = pool.request();
    rq.input('days', sql.Int, threshold);

    let where = '';
    if (store_id) { where = ' AND sm.store_id = @sid'; rq.input('sid', sql.Int, store_id); }

    const result = await rq.query(`
      SELECT p.id, p.product_code, p.product_name, p.unit_name, p.cost_price,
             COALESCE(ib.qty, 0) AS current_qty,
             (COALESCE(ib.qty, 0) * COALESCE(p.cost_price, 0)) AS total_value,
             last_mv.last_move_date,
             DATEDIFF(DAY, last_mv.last_move_date, GETDATE()) AS days_since_move
      FROM products p
      OUTER APPLY (
        SELECT TOP 1 sm.move_date AS last_move_date
        FROM stock_movements sm
        WHERE sm.product_id = p.id ${where}
          AND (sm.qty_in > 0 OR sm.qty_out > 0)
        ORDER BY sm.move_date DESC
      ) last_mv
      OUTER APPLY (
        SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_balances ib
        WHERE ib.product_id = p.id ${store_id ? 'AND ib.store_id = @sid' : ''}
      ) ib
      WHERE last_mv.last_move_date IS NOT NULL
        AND DATEDIFF(DAY, last_mv.last_move_date, GETDATE()) >= @days
        AND COALESCE(ib.qty, 0) > 0
      ORDER BY days_since_move DESC
    `);

    const totals = { product_count: result.recordset.length, total_qty: 0, total_value: 0 };
    result.recordset.forEach(r => {
      totals.total_qty += num(r.current_qty);
      totals.total_value += num(r.total_value);
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/slow-moving error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 9) Fast-Moving Items Report ──────────────────────────────────────
router.get('/inventory/fast-moving', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id, sort_by } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE 1=1';
    if (from) { where += ' AND sm.move_date >= @from'; rq.input('from', sql.NVarChar, from); }
    if (to)   { where += ' AND sm.move_date <= @to';   rq.input('to',   sql.NVarChar, to);   }
    if (store_id) { where += ' AND sm.store_id = @sid'; rq.input('sid', sql.Int, store_id); }

    const orderBy = sort_by === 'value' ? 'total_movement_value DESC' : 'total_movement_qty DESC';

    const result = await rq.query(`
      SELECT TOP 100 p.id, p.product_code, p.product_name, p.unit_name, p.cost_price,
             COALESCE(SUM(sm.qty_in + sm.qty_out), 0) AS total_movement_qty,
             COALESCE(SUM((sm.qty_in + sm.qty_out) * COALESCE(sm.cost_price, 0)), 0) AS total_movement_value,
             COALESCE(ib.qty, 0) AS current_qty,
             MAX(sm.move_date) AS last_move_date,
             COUNT(*) AS movement_count
      FROM stock_movements sm
      JOIN products p ON sm.product_id = p.id
      OUTER APPLY (
        SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_balances ib
        WHERE ib.product_id = p.id ${store_id ? 'AND ib.store_id = @sid' : ''}
      ) ib
      ${where}
      GROUP BY p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, ib.qty
      ORDER BY ${orderBy}
    `);

    const totals = { product_count: result.recordset.length, total_movement_qty: 0, total_movement_value: 0 };
    result.recordset.forEach(r => {
      totals.total_movement_qty += num(r.total_movement_qty);
      totals.total_movement_value += num(r.total_movement_value);
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/fast-moving error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 10) Inventory Valuation Report ──────────────────────────────────
router.get('/inventory/valuation', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();

    // Value by store
    const byStoreRes = await rq.query(`
      SELECT s.id AS store_id, s.store_name,
             COUNT(DISTINCT ib.product_id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value
      FROM stores s
      LEFT JOIN inventory_balances ib ON s.id = ib.store_id AND ib.quantity != 0
      LEFT JOIN products p ON ib.product_id = p.id
      WHERE s.status IS NULL OR s.status = 'active'
      GROUP BY s.id, s.store_name
      ORDER BY total_value DESC
    `);

    // Value by category
    const byCatRes = await rq.query(`
      SELECT COALESCE(p.category_id, 0) AS category_id,
             COALESCE(c.category_name, 'غير مصنف') AS category_name,
             COUNT(DISTINCT p.id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value
      FROM products p
      LEFT JOIN inventory_balances ib ON p.id = ib.product_id AND ib.quantity != 0
      LEFT JOIN categories c ON p.category_id = c.id
      GROUP BY p.category_id, c.category_name
      ORDER BY total_value DESC
    `);

    // Grand total
    const grandRes = await rq.query(`
      SELECT COUNT(DISTINCT ib.product_id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value
      FROM inventory_balances ib
      JOIN products p ON ib.product_id = p.id
      WHERE ib.quantity != 0
    `);

    // Accounting validation
    const invAccId = await getSysAccId(rq, SYS_INVENTORY);
    let accValue = 0;
    if (invAccId) {
      const accRes = await rq.query(`
        SELECT COALESCE(current_balance, 0) AS balance FROM chart_of_accounts WHERE id = ${invAccId}
      `);
      accValue = num(accRes.recordset[0]?.balance);
    }

    res.json({
      success: true,
      data: {
        by_store: byStoreRes.recordset,
        by_category: byCatRes.recordset,
        grand_total: {
          product_count: num(grandRes.recordset[0].product_count),
          total_qty: num(grandRes.recordset[0].total_qty),
          total_value: num(grandRes.recordset[0].total_value)
        },
        accounting_balance: accValue,
        difference: num(grandRes.recordset[0].total_value) - accValue
      }
    });
  } catch (err) {
    console.error('inventory/valuation error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── Customer Sales Summary (ملخص مبيعات العملاء) ──────────────────────────
router.get('/customer-sales-filter-options', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const govRes = await pool.request().query(`SELECT DISTINCT governorate FROM customers WHERE governorate IS NOT NULL AND governorate != ''`);
    const brRes = await pool.request().query(`SELECT DISTINCT branch FROM customers WHERE branch IS NOT NULL AND branch != ''`);
    const ctRes = await pool.request().query(`SELECT DISTINCT customer_type FROM customers WHERE customer_type IS NOT NULL AND customer_type != ''`);
    res.json({
      success: true,
      data: {
        governorates: govRes.recordset.map(r => r.governorate),
        branches: brRes.recordset.map(r => r.branch),
        customer_types: ctRes.recordset.map(r => r.customer_type)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الفلاتر' });
  }
}));

router.get('/customer-sales-summary', asyncHandler(async (req, res) => {
  try {
    const { from, to, governorate, branch, customer_type, customer_id, rep_id, sort, order } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let cWhere = `c.is_active = 1`;
    if (governorate) { cWhere += ` AND c.governorate = @gov`; rq.input('gov', sql.NVarChar, governorate); }
    if (branch) { cWhere += ` AND c.branch = @branch`; rq.input('branch', sql.NVarChar, branch); }
    if (customer_type) { cWhere += ` AND c.customer_type = @ctype`; rq.input('ctype', sql.NVarChar, customer_type); }
    if (customer_id) { cWhere += ` AND c.id IN (${customer_id.split(',').map(n => Number(n)).filter(n => n).join(',')})`; }
    if (rep_id) { cWhere += ` AND c.rep_id IN (${rep_id.split(',').map(n => Number(n)).filter(n => n).join(',')})`; }

    // First get the customers
    const custRes = await rq.query(`
      SELECT c.id, c.customer_code, c.customer_name, c.branch, c.governorate, 
             ISNULL(c.opening_balance, 0) as initial_opening_balance,
             r.rep_name
      FROM customers c
      LEFT JOIN sales_reps r ON c.rep_id = r.id
      WHERE ${cWhere}
    `);
    const customers = custRes.recordset;

    if (customers.length === 0) {
      return res.json({ success: true, data: [], totals: {} });
    }

    const cIds = customers.map(c => c.id).join(',');
    
    if (from) rq.input('from', sql.NVarChar, from);
    if (to) rq.input('to', sql.NVarChar, to);

    // Now get transaction summaries grouped by customer_id and reference_type
    // We get BEFORE period (for opening balance adjustment) and DURING period
    let q = `
      SELECT 
        je.customer_id,
        je.reference_type,
        SUM(CASE WHEN ${from ? 'je.entry_date < @from' : '1=0'} THEN jl.debit - jl.credit ELSE 0 END) as before_net,
        SUM(CASE WHEN ${from ? 'je.entry_date >= @from' : '1=1'} ${to ? 'AND je.entry_date <= @to' : ''} THEN jl.debit ELSE 0 END) as period_debit,
        SUM(CASE WHEN ${from ? 'je.entry_date >= @from' : '1=1'} ${to ? 'AND je.entry_date <= @to' : ''} THEN jl.credit ELSE 0 END) as period_credit,
        COUNT(DISTINCT CASE WHEN je.reference_type = 'sales' AND ${from ? 'je.entry_date >= @from' : '1=1'} ${to ? 'AND je.entry_date <= @to' : ''} THEN je.id ELSE NULL END) as period_count,
        MAX(CASE WHEN je.reference_type = 'sales' AND ${from ? 'je.entry_date >= @from' : '1=1'} ${to ? 'AND je.entry_date <= @to' : ''} THEN je.entry_date ELSE NULL END) as last_invoice_date,
        MAX(CASE WHEN je.reference_type = 'collection' AND ${from ? 'je.entry_date >= @from' : '1=1'} ${to ? 'AND je.entry_date <= @to' : ''} THEN je.entry_date ELSE NULL END) as last_collection_date
      FROM journal_entries je
      JOIN journal_entry_lines jl ON je.id = jl.entry_id
      JOIN chart_of_accounts a ON jl.account_id = a.id
      WHERE je.customer_id IN (${cIds}) 
        AND a.system_code = 'SYS_AR'
        AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
      GROUP BY je.customer_id, je.reference_type
    `;

    const txRes = await rq.query(q);
    const tx = txRes.recordset;

    // Need to get tax and discount totals per customer for sales invoices during the period
    let invWhere = `customer_id IN (${cIds}) AND status NOT IN ('cancelled', 'deleted')`;
    if (from) invWhere += ` AND invoice_date >= @from`;
    if (to) invWhere += ` AND invoice_date <= @to`;
    
    const invRes = await rq.query(`
      SELECT customer_id, SUM(tax_amount) as total_tax, SUM(discount_amount) as total_discount
      FROM sales_invoices WHERE ${invWhere} GROUP BY customer_id
    `);
    const invMap = {};
    invRes.recordset.forEach(r => invMap[r.customer_id] = r);

    const result = customers.map(c => {
      const cTx = tx.filter(t => t.customer_id === c.id);
      
      const beforeNet = cTx.reduce((s, t) => s + num(t.before_net), 0);
      const opening_balance = num(c.initial_opening_balance) + beforeNet;
      
      const salesRow = cTx.find(t => t.reference_type === 'sales') || {};
      const returnRow = cTx.find(t => t.reference_type === 'sales_return') || {};
      const collRow = cTx.find(t => t.reference_type === 'collection') || {};
      
      const period_gross = num(salesRow.period_debit);
      const period_returns = num(returnRow.period_credit);
      const period_collections = num(collRow.period_credit);
      
      const period_count = num(salesRow.period_count);
      const last_invoice_date = salesRow.last_invoice_date;
      const last_collection_date = collRow.last_collection_date;

      const meta = invMap[c.id] || {};
      const period_tax = num(meta.total_tax);
      const period_discount = num(meta.total_discount);
      
      const net_sales = period_gross - period_returns;
      
      const allPeriodDebit = cTx.reduce((s, t) => s + num(t.period_debit), 0);
      const allPeriodCredit = cTx.reduce((s, t) => s + num(t.period_credit), 0);
      const closing_balance = opening_balance + allPeriodDebit - allPeriodCredit;
      
      return {
        customer_id: c.id,
        customer_code: c.customer_code,
        customer_name: c.customer_name,
        rep_name: c.rep_name,
        branch: c.branch,
        governorate: c.governorate,
        opening_balance,
        period_gross,
        period_returns,
        period_discount,
        period_tax,
        net_sales,
        period_collections,
        closing_balance,
        period_count,
        last_invoice_date,
        last_collection_date,
        balance_type: closing_balance > 0 ? 'مدين' : (closing_balance < 0 ? 'دائن' : 'متزن')
      };
    });

    const totalGross = result.reduce((s, r) => s + r.period_gross, 0);
    result.forEach(r => { r.contribution_pct = totalGross > 0 ? ((r.period_gross / totalGross) * 100).toFixed(1) : 0; });

    const sKey = sort || 'gross_sales';
    const sOrd = order === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      let v1 = a[sKey];
      let v2 = b[sKey];
      if (sKey === 'gross_sales') { v1 = a.period_gross; v2 = b.period_gross; }
      if (v1 < v2) return -1 * sOrd;
      if (v1 > v2) return 1 * sOrd;
      return 0;
    });

    res.json({
      success: true,
      data: result,
      totals: {
        customer_count: result.length,
        invoice_count: result.reduce((s, r) => s + r.period_count, 0),
        net_sales: result.reduce((s, r) => s + r.net_sales, 0),
        return_total: result.reduce((s, r) => s + r.period_returns, 0)
      }
    });
  } catch (err) {
    console.error('customer-sales-summary error:', err);
    res.status(500).json({ success: false, message: 'خطأ في جلب البيانات' });
  }
}));

// ============================================================
// PAYMENT MATCHING STATUS REPORTS
// ============================================================

// GET /ar-matching-status
router.get('/ar-matching-status', asyncHandler(async (req, res) => {
  const { from, to, customer_id, status } = req.query;
  const pool = await getPool();
  const rq = pool.request();
  let where = `si.status NOT IN ('cancelled','draft')`;
  if (from) { where += ` AND si.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
  if (to)   { where += ` AND si.invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to); }
  if (customer_id) { where += ` AND si.customer_id = @cid`; rq.input('cid', sql.Int, parseInt(customer_id)); }
  let having = '';
  if (status === 'open')    having = 'HAVING ROUND(si.grand_total - ISNULL(SUM(ca.amount),0), 2) > 0';
  if (status === 'closed')  having = 'HAVING ROUND(si.grand_total - ISNULL(SUM(ca.amount),0), 2) <= 0';
  if (status === 'partial') having = 'HAVING ISNULL(SUM(ca.amount),0) > 0 AND ROUND(si.grand_total - ISNULL(SUM(ca.amount),0), 2) > 0';
  const r = await rq.query(`
    SELECT si.id, si.invoice_no,
      CONVERT(varchar(10), si.invoice_date, 23) AS invoice_date,
      c.customer_name, si.grand_total,
      ISNULL(SUM(ca.amount),0) AS allocated_amount,
      si.discount_amount AS discount_amount,
      ROUND(si.grand_total - ISNULL(SUM(ca.amount),0), 2) AS remaining,
      CASE
        WHEN ROUND(si.grand_total - ISNULL(SUM(ca.amount),0), 2) <= 0 THEN N'مسدد بالكامل'
        WHEN ISNULL(SUM(ca.amount),0) > 0 THEN N'مسدد جزئياً'
        ELSE N'غير مسدد'
      END AS match_status,
      COUNT(ca.id) AS allocation_count
    FROM sales_invoices si
    JOIN customers c ON si.customer_id = c.id
    LEFT JOIN customer_collections cc ON cc.customer_id = si.customer_id
    LEFT JOIN collection_allocations ca ON ca.collection_id = cc.id AND ca.invoice_id = si.id
    WHERE ${where}
    GROUP BY si.id, si.invoice_no, si.invoice_date, c.customer_name, si.grand_total, si.discount_amount
    ${having}
    ORDER BY si.invoice_date DESC, si.invoice_no DESC
  `);
  const rows = r.recordset;
  res.json({ success: true, data: rows, totals: {
    count: rows.length,
    grand_total: rows.reduce((s,r) => s+(Number(r.grand_total)||0),0),
    allocated:   rows.reduce((s,r) => s+(Number(r.allocated_amount)||0),0),
    discount:    rows.reduce((s,r) => s+(Number(r.discount_amount)||0),0),
    remaining:   rows.reduce((s,r) => s+(Number(r.remaining)||0),0),
  }});
}));

// GET /ap-matching-status
router.get('/ap-matching-status', asyncHandler(async (req, res) => {
  const { from, to, supplier_id, status } = req.query;
  const pool = await getPool();
  const rq = pool.request();
  let where = `pi.status NOT IN ('cancelled','draft')`;
  if (from) { where += ` AND pi.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
  if (to)   { where += ` AND pi.invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to); }
  if (supplier_id) { where += ` AND pi.supplier_id = @sid`; rq.input('sid', sql.Int, parseInt(supplier_id)); }
  let having = '';
  if (status === 'open')    having = 'HAVING ROUND(pi.grand_total - ISNULL(SUM(spa.allocated_amount),0), 2) > 0';
  if (status === 'closed')  having = 'HAVING ROUND(pi.grand_total - ISNULL(SUM(spa.allocated_amount),0), 2) <= 0';
  if (status === 'partial') having = 'HAVING ISNULL(SUM(spa.allocated_amount),0) > 0 AND ROUND(pi.grand_total - ISNULL(SUM(spa.allocated_amount),0), 2) > 0';
  const r = await rq.query(`
    SELECT pi.id, pi.invoice_no,
      CONVERT(varchar(10), pi.invoice_date, 23) AS invoice_date,
      s.supplier_name, pi.grand_total,
      ISNULL(SUM(spa.allocated_amount),0) AS allocated_amount,
      pi.discount_amount AS discount_amount,
      ROUND(pi.grand_total - ISNULL(SUM(spa.allocated_amount),0), 2) AS remaining,
      CASE
        WHEN ROUND(pi.grand_total - ISNULL(SUM(spa.allocated_amount),0), 2) <= 0 THEN N'مسدد بالكامل'
        WHEN ISNULL(SUM(spa.allocated_amount),0) > 0 THEN N'مسدد جزئياً'
        ELSE N'غير مسدد'
      END AS match_status,
      COUNT(spa.id) AS allocation_count
    FROM purchase_invoices pi
    JOIN suppliers s ON pi.supplier_id = s.id
    LEFT JOIN supplier_payments sp ON sp.supplier_id = pi.supplier_id
    LEFT JOIN supplier_payment_allocations spa ON spa.payment_id = sp.id AND spa.invoice_id = pi.id
    WHERE ${where}
    GROUP BY pi.id, pi.invoice_no, pi.invoice_date, s.supplier_name, pi.grand_total, pi.discount_amount
    ${having}
    ORDER BY pi.invoice_date DESC, pi.invoice_no DESC
  `);
  const rows = r.recordset;
  res.json({ success: true, data: rows, totals: {
    count: rows.length,
    grand_total: rows.reduce((s,r) => s+(Number(r.grand_total)||0),0),
    allocated:   rows.reduce((s,r) => s+(Number(r.allocated_amount)||0),0),
    discount:    rows.reduce((s,r) => s+(Number(r.discount_amount)||0),0),
    remaining:   rows.reduce((s,r) => s+(Number(r.remaining)||0),0),
  }});
}));

module.exports = router;
