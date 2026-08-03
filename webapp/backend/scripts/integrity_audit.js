// ============================================================
// TradePro ERP — Data Integrity & Reconciliation Audit (read-only)
// ------------------------------------------------------------
// Detect-only tool. Never writes to the database.
// Purpose: establish a before/after baseline while fixing the
// accounting-core blockers (GL single-source-of-truth migration).
//
// Usage:
//   node scripts/integrity_audit.js
//   node scripts/integrity_audit.js --limit 20
//   node scripts/integrity_audit.js --only gl_unbalanced,ar_customer_vs_gl
//   node scripts/integrity_audit.js --json audit_report.json
//   node scripts/integrity_audit.js --quiet
// ============================================================

const path = require('path');
const fs = require('fs');
const { getPool, sql } = require('../database/mssql_db');

const TOL_MONEY = 0.01;
const TOL_QTY = 0.0001;
const DEFAULT_LIMIT = 15;

// ── CLI args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const LIMIT = parseInt(argVal('--limit', String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT;
const ONLY = argVal('--only', '');
const JSON_OUT = argVal('--json', path.join(__dirname, 'integrity_audit_report.json'));
const QUIET = args.includes('--quiet');

const onlySet = ONLY ? new Set(ONLY.split(',').map(s => s.trim())) : null;

let pool;
const SYS = {}; // system_code -> account id

// ── helpers ───────────────────────────────────────────────────
async function resolveSysAccounts() {
  const r = await pool.request().query(
    `SELECT id, system_code FROM chart_of_accounts WHERE system_code IS NOT NULL`
  );
  for (const row of r.recordset) SYS[row.system_code] = row.id;
}

function money(a) { return Math.round((Number(a) || 0) * 100) / 100; }
function qty(a) { return Math.round((Number(a) || 0) * 10000) / 10000; }

async function Q(sqlText) {
  const r = await pool.request().query(sqlText);
  return r.recordset;
}

// Canonical "active journal entry" predicate. Must stay in sync with
// services/balanceService.js and services/accountingEngine.js:
// excludes reversed entries, reversal copies (reversal_of_id), and
// cancellation actions (*_cancel / cancel).
const ACTIVE_JE = `(je.is_reversed IS NULL OR je.is_reversed = 0)
    AND (je.reversal_of_id IS NULL)
    AND (je.source_action IS NULL OR (je.source_action NOT LIKE '%_cancel' AND je.source_action <> 'cancel'))`;

// Each check: { id, group, title, run() -> { count, sample } }
const checks = [];

function defCheck(id, group, title, sqlText, cols) {
  checks.push({
    id, group, title,
    async run() {
      const rows = await Q(sqlText);
      return {
        count: rows.length,
        sample: rows.slice(0, LIMIT).map(r => {
          const o = {};
          for (const c of cols) o[c] = r[c];
          return o;
        })
      };
    }
  });
}

// ================================================================
// GROUP A — GL Core
// ================================================================
defCheck('gl_unbalanced', 'GL Core', 'قيود غير متوازنة (total_debit ≠ total_credit)',
  `SELECT id, entry_no, entry_date, reference_type, source_document, total_debit, total_credit,
          ROUND(ABS(total_debit - total_credit), 2) AS diff
   FROM journal_entries
   WHERE ABS(ISNULL(total_debit,0) - ISNULL(total_credit,0)) > ${TOL_MONEY}`,
  ['id', 'entry_no', 'entry_date', 'reference_type', 'source_document', 'total_debit', 'total_credit', 'diff']);

defCheck('gl_line_mismatch', 'GL Core', 'قيود لا يساوي مجموع سطورها الإجمالي',
  `SELECT je.id, je.entry_no, je.entry_date, je.total_debit, je.total_credit,
          ROUND(ABS(ISNULL(SUM(jl.debit),0) - ISNULL(je.total_debit,0)), 2) AS db_diff,
          ROUND(ABS(ISNULL(SUM(jl.credit),0) - ISNULL(je.total_credit,0)), 2) AS cr_diff
   FROM journal_entries je
   JOIN journal_entry_lines jl ON jl.entry_id = je.id
   GROUP BY je.id, je.entry_no, je.entry_date, je.total_debit, je.total_credit
   HAVING ABS(ISNULL(SUM(jl.debit),0) - ISNULL(je.total_debit,0)) > ${TOL_MONEY}
       OR ABS(ISNULL(SUM(jl.credit),0) - ISNULL(je.total_credit,0)) > ${TOL_MONEY}`,
  ['id', 'entry_no', 'entry_date', 'total_debit', 'total_credit', 'db_diff', 'cr_diff']);

defCheck('gl_invalid_lines', 'GL Core', 'أسطر قيد غير صالحة (سالب / مدين ودائن معاً / صفر)',
  `SELECT jl.id, jl.entry_id, jl.debit, jl.credit, ca.account_code, ca.account_name
   FROM journal_entry_lines jl
   JOIN chart_of_accounts ca ON ca.id = jl.account_id
   WHERE jl.debit < 0 OR jl.credit < 0
      OR (jl.debit > 0 AND jl.credit > 0)
      OR (ISNULL(jl.debit,0) = 0 AND ISNULL(jl.credit,0) = 0)`,
  ['id', 'entry_id', 'debit', 'credit', 'account_code']);

defCheck('gl_reversed_missing_link', 'GL Core', 'قيد موسوم كمعكوس دون قيد معاكس مرتبط',
  `SELECT id, entry_no, entry_date, source_document, reversed_by
   FROM journal_entries
   WHERE ISNULL(is_reversed,0) = 1 AND reversed_by IS NULL`,
  ['id', 'entry_no', 'entry_date', 'source_document', 'reversed_by']);

defCheck('gl_reversal_of_missing', 'GL Core', 'رابط reversal_of_id يشير لقيد غير موجود',
  `SELECT je.id, je.entry_no, je.reversal_of_id
   FROM journal_entries je
   LEFT JOIN journal_entries o ON o.id = je.reversal_of_id
   WHERE je.reversal_of_id IS NOT NULL AND o.id IS NULL`,
  ['id', 'entry_no', 'reversal_of_id']);

defCheck('gl_double_reversed', 'GL Core', 'قيد أصلي له أكثر من عكس مباشر واحد',
   `SELECT je.reversal_of_id AS original_id, COUNT(*) AS reversal_count, MIN(o.entry_no) AS original_no
    FROM journal_entries je
    JOIN journal_entries o ON o.id = je.reversal_of_id
    GROUP BY je.reversal_of_id
    HAVING COUNT(*) > 1`,
  ['original_id', 'reversal_count', 'original_no']);

defCheck('gl_entries_in_closed_period', 'GL Core', 'قيود مُرحّلة داخل فترة مالية مقفلة',
  `SELECT je.id, je.entry_no, je.entry_date, je.reference_type, je.source_document,
          fp.name AS period_name
   FROM journal_entries je
   JOIN fiscal_periods fp ON fp.status = 'closed'
        AND TRY_CONVERT(date, je.entry_date) IS NOT NULL
        AND TRY_CONVERT(date, je.entry_date) BETWEEN TRY_CONVERT(date, fp.start_date)
                                              AND TRY_CONVERT(date, fp.end_date)`,
  ['id', 'entry_no', 'entry_date', 'reference_type', 'source_document', 'period_name']);

// ================================================================
// GROUP B — Subledger vs GL
// ================================================================
defCheck('ar_customer_vs_gl', 'Subledger vs GL', 'فرق رصيد العميل (current_balance مقابل GL مقابل تشغيلي)',
  `SELECT c.id, c.customer_code, c.customer_name,
          ROUND(ISNULL(c.current_balance,0), 2) AS current_balance,
          ROUND(ISNULL(g.gl_balance,0), 2) AS gl_balance,
          ROUND(ISNULL(c.opening_balance,0)
              + ISNULL(s.sales,0) - ISNULL(rt.returns,0)
              - ISNULL(lc.legacy_coll,0) - ISNULL(ap.ar_pay,0), 2) AS operational_balance,
          ROUND(ABS(ISNULL(c.current_balance,0) - ISNULL(g.gl_balance,0)), 2) AS diff_cur_gl
   FROM customers c
   OUTER APPLY (SELECT SUM(CAST(grand_total AS DECIMAL(18,2))) AS sales
                FROM sales_invoices WHERE customer_id = c.id
                AND status NOT IN ('cancelled','deleted')) s
   OUTER APPLY (SELECT SUM(CAST(grand_total AS DECIMAL(18,2))) AS returns
                FROM sales_returns WHERE customer_id = c.id
                AND status NOT IN ('cancelled','deleted')) rt
   OUTER APPLY (SELECT SUM(amount) AS legacy_coll
                FROM customer_collections WHERE customer_id = c.id) lc
   OUTER APPLY (SELECT SUM(amount) AS ar_pay
                FROM ar_payments WHERE customer_id = c.id
                AND ISNULL(status,'active') NOT IN ('reversed','cancelled')) ap
   OUTER APPLY (SELECT SUM(jl.debit - jl.credit) AS gl_balance
                FROM journal_entry_lines jl
                JOIN journal_entries je ON je.id = jl.entry_id
                JOIN chart_of_accounts ca ON ca.id = jl.account_id
                WHERE ca.system_code = 'SYS_AR' AND ${ACTIVE_JE}
                  AND je.customer_id = c.id) g
   WHERE ABS(ISNULL(c.current_balance,0) - ISNULL(g.gl_balance,0)) > ${TOL_MONEY}
      OR ABS(ISNULL(c.current_balance,0)
           - (ISNULL(c.opening_balance,0) + ISNULL(s.sales,0) - ISNULL(rt.returns,0)
              - ISNULL(lc.legacy_coll,0) - ISNULL(ap.ar_pay,0))) > ${TOL_MONEY}`,
  ['id', 'customer_code', 'customer_name', 'current_balance', 'gl_balance', 'operational_balance', 'diff_cur_gl']);

defCheck('ap_supplier_vs_gl', 'Subledger vs GL', 'فرق رصيد المورد (current_balance مقابل GL مقابل تشغيلي)',
  `SELECT s.id, s.supplier_code, s.supplier_name,
          ROUND(ISNULL(s.current_balance,0), 2) AS current_balance,
          ROUND(ISNULL(g.gl_balance,0), 2) AS gl_balance,
          ROUND(ISNULL(s.opening_balance,0)
              + ISNULL(p.purchases,0) - ISNULL(rt.returns,0)
              - ISNULL(lp.legacy_pay,0) - ISNULL(ap.ap_pay,0), 2) AS operational_balance,
          ROUND(ABS(ISNULL(s.current_balance,0) - ISNULL(g.gl_balance,0)), 2) AS diff_cur_gl
   FROM suppliers s
   OUTER APPLY (SELECT SUM(CAST(grand_total AS DECIMAL(18,2))) AS purchases
                FROM purchase_invoices WHERE supplier_id = s.id
                AND status NOT IN ('cancelled','deleted')) p
   OUTER APPLY (SELECT SUM(CAST(grand_total AS DECIMAL(18,2))) AS returns
                FROM purchase_returns WHERE supplier_id = s.id
                AND status NOT IN ('cancelled','deleted')) rt
   OUTER APPLY (SELECT SUM(amount) AS legacy_pay
                FROM supplier_payments WHERE supplier_id = s.id) lp
   OUTER APPLY (SELECT SUM(amount) AS ap_pay
                FROM ap_payments WHERE supplier_id = s.id
                AND ISNULL(status,'active') NOT IN ('reversed','cancelled')) ap
   OUTER APPLY (SELECT SUM(jl.credit - jl.debit) AS gl_balance
                FROM journal_entry_lines jl
                JOIN journal_entries je ON je.id = jl.entry_id
                JOIN chart_of_accounts ca ON ca.id = jl.account_id
                WHERE ca.system_code = 'SYS_AP' AND ${ACTIVE_JE}
                  AND je.supplier_id = s.id) g
   WHERE ABS(ISNULL(s.current_balance,0) - ISNULL(g.gl_balance,0)) > ${TOL_MONEY}
      OR ABS(ISNULL(s.current_balance,0)
           - (ISNULL(s.opening_balance,0) + ISNULL(p.purchases,0) - ISNULL(rt.returns,0)
              - ISNULL(lp.legacy_pay,0) - ISNULL(ap.ap_pay,0))) > ${TOL_MONEY}`,
  ['id', 'supplier_code', 'supplier_name', 'current_balance', 'gl_balance', 'operational_balance', 'diff_cur_gl']);

defCheck('ar_opening_vs_gl', 'Subledger vs GL', 'فرق الرصيد الافتتاحي للعملاء (العمود مقابل قيد الافتتاحي في GL)',
  `SELECT c.id, c.customer_code, c.customer_name, ROUND(ISNULL(c.opening_balance,0),2) AS opening_balance,
          ROUND(ISNULL(g.gl_opening,0),2) AS gl_opening
   FROM customers c
   OUTER APPLY (SELECT SUM(jl.debit - jl.credit) AS gl_opening
                FROM journal_entry_lines jl
                JOIN journal_entries je ON je.id = jl.entry_id
                JOIN chart_of_accounts ca ON ca.id = jl.account_id
                WHERE ca.system_code = 'SYS_AR'
                  AND ISNULL(je.reference_type,'') = 'customers'
                  AND je.customer_id = c.id) g
   WHERE ABS(ISNULL(c.opening_balance,0) - ISNULL(g.gl_opening,0)) > ${TOL_MONEY}`,
  ['id', 'customer_code', 'customer_name', 'opening_balance', 'gl_opening']);

defCheck('ap_opening_not_in_gl', 'Subledger vs GL', 'موردون برصيد افتتاحي دون أي قيد افتتاحي في GL',
  `SELECT s.id, s.supplier_code, s.supplier_name, ROUND(ISNULL(s.opening_balance,0),2) AS opening_balance
   FROM suppliers s
   WHERE ABS(ISNULL(s.opening_balance,0)) > ${TOL_MONEY}
     AND NOT EXISTS (
       SELECT 1 FROM journal_entry_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN chart_of_accounts ca ON ca.id = jl.account_id
       WHERE ca.system_code = 'SYS_AP' AND je.supplier_id = s.id
         AND ISNULL(je.reference_type,'') LIKE '%opening%')`,
  ['id', 'supplier_code', 'supplier_name', 'opening_balance']);

defCheck('ar_total_vs_gl', 'Subledger vs GL', 'إجمالي أرصدة العملاء مقابل إجمالي SYS_AR في GL',
  `SELECT total_current_balance, total_gl_ar,
          ROUND(ABS(total_current_balance - total_gl_ar),2) AS diff
   FROM (
     SELECT
       (SELECT ROUND(SUM(ISNULL(current_balance,0)),2) FROM customers WHERE ISNULL(is_active,1) = 1) AS total_current_balance,
       (SELECT ROUND(SUM(jl.debit - jl.credit),2) FROM journal_entry_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          JOIN chart_of_accounts ca ON ca.id = jl.account_id
          WHERE ca.system_code = 'SYS_AR' AND ${ACTIVE_JE}) AS total_gl_ar
   ) t
   WHERE ABS(total_current_balance - total_gl_ar) > ${TOL_MONEY}`,
  ['total_current_balance', 'total_gl_ar', 'diff']);

defCheck('ap_total_vs_gl', 'Subledger vs GL', 'إجمالي أرصدة الموردين مقابل إجمالي SYS_AP في GL',
  `SELECT total_current_balance, total_gl_ap,
          ROUND(ABS(total_current_balance - total_gl_ap),2) AS diff
   FROM (
     SELECT
       (SELECT ROUND(SUM(ISNULL(current_balance,0)),2) FROM suppliers WHERE ISNULL(is_active,1) = 1) AS total_current_balance,
       (SELECT ROUND(SUM(jl.credit - jl.debit),2) FROM journal_entry_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          JOIN chart_of_accounts ca ON ca.id = jl.account_id
          WHERE ca.system_code = 'SYS_AP' AND ${ACTIVE_JE}) AS total_gl_ap
   ) t
   WHERE ABS(total_current_balance - total_gl_ap) > ${TOL_MONEY}`,
  ['total_current_balance', 'total_gl_ap', 'diff']);

// ================================================================
// GROUP C — Trial Balance / COA
// ================================================================
defCheck('coa_balance_vs_gl', 'COA / Trial Balance', 'فرق current_balance لحسابات الدليل مقابل GL',
  `SELECT ca.id, ca.account_code, ca.account_name, ca.account_type,
          ROUND(ISNULL(ca.current_balance,0),2) AS coa_balance,
          ROUND(ISNULL(g.gl_balance,0),2) AS gl_balance,
          ROUND(ABS(ISNULL(ca.current_balance,0) - ISNULL(g.gl_balance,0)),2) AS diff
   FROM chart_of_accounts ca
   OUTER APPLY (SELECT SUM(jl.debit - jl.credit) *
                   CASE WHEN ca.account_type IN ('liability','equity','revenue') THEN -1 ELSE 1 END AS gl_balance
                FROM journal_entry_lines jl
                JOIN journal_entries je ON je.id = jl.entry_id
                WHERE jl.account_id = ca.id AND ${ACTIVE_JE}) g
   WHERE ABS(ISNULL(ca.current_balance,0) - ISNULL(g.gl_balance,0)) > ${TOL_MONEY}`,
  ['id', 'account_code', 'account_name', 'account_type', 'coa_balance', 'gl_balance', 'diff']);

defCheck('tb_balance', 'COA / Trial Balance', 'عدم توازن ميزان المراجعة (أصول+مصروفات مقابل خصوم+حقوق+إيرادات)',
  `SELECT assets_expenses, liab_equity_rev,
          ROUND(ABS(assets_expenses - liab_equity_rev),2) AS diff
   FROM (
     SELECT
       (SELECT ROUND(SUM(jl.debit - jl.credit),2) FROM journal_entry_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          JOIN chart_of_accounts ca ON ca.id = jl.account_id
          WHERE ca.account_type IN ('asset','expense') AND ${ACTIVE_JE}) AS assets_expenses,
       (SELECT ROUND(SUM(jl.credit - jl.debit),2) FROM journal_entry_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          JOIN chart_of_accounts ca ON ca.id = jl.account_id
          WHERE ca.account_type IN ('liability','equity','revenue') AND ${ACTIVE_JE}) AS liab_equity_rev
   ) t
   WHERE ABS(assets_expenses - liab_equity_rev) > ${TOL_MONEY}`,
  ['assets_expenses', 'liab_equity_rev', 'diff']);

// ================================================================
// GROUP D — Inventory / Stock
// ================================================================
defCheck('inv_negative_stock', 'Inventory', 'أرصدة مخزون سالبة',
  `SELECT ib.id, ib.store_id, st.store_name, ib.product_id, p.product_code, p.product_name,
          ROUND(ib.quantity,4) AS quantity
   FROM inventory_balances ib
   JOIN products p ON p.id = ib.product_id
   LEFT JOIN stores st ON st.id = ib.store_id
   WHERE ib.quantity < -${TOL_QTY}`,
  ['id', 'store_name', 'product_code', 'product_name', 'quantity']);

defCheck('inv_ledger_vs_balance', 'Inventory', 'فرق كمية (stock_movements مقابل inventory_balances)',
  `SELECT ib.store_id, ib.product_id, p.product_code, p.product_name,
          ROUND(ib.quantity,4) AS balance_qty,
          ROUND(ISNULL(m.moved_qty,0),4) AS ledger_qty,
          ROUND(ib.quantity - ISNULL(m.moved_qty,0),4) AS diff
   FROM inventory_balances ib
   JOIN products p ON p.id = ib.product_id
   OUTER APPLY (SELECT SUM(ISNULL(sm.qty_in,0) - ISNULL(sm.qty_out,0)) AS moved_qty
                FROM stock_movements sm
                WHERE sm.product_id = ib.product_id AND sm.store_id = ib.store_id) m
   WHERE ABS(ib.quantity - ISNULL(m.moved_qty,0)) > ${TOL_QTY}`,
  ['store_id', 'product_code', 'product_name', 'balance_qty', 'ledger_qty', 'diff']);

defCheck('inv_balance_after_mismatch', 'Inventory', 'سلسلة balance_after في حركة الصنف غير متسقة',
  `WITH seq AS (
     SELECT id, store_id, product_id, move_date, move_type, document_no,
            ISNULL(qty_in,0) - ISNULL(qty_out,0) AS delta, balance_after, reference_id,
            ROW_NUMBER() OVER (PARTITION BY product_id, store_id ORDER BY id) AS rn
     FROM stock_movements
   )
   SELECT cur.id, cur.store_id, cur.product_id, cur.move_date, cur.move_type, cur.document_no,
          ROUND(cur.balance_after,4) AS recorded_balance,
          ROUND(ISNULL(prev.expected,0) + cur.delta,4) AS expected_balance,
          ROUND(ABS(ISNULL(prev.expected,0) + cur.delta - ISNULL(cur.balance_after,0)),4) AS diff
   FROM seq cur
   OUTER APPLY (SELECT SUM(s2.delta) AS expected FROM seq s2
                WHERE s2.product_id = cur.product_id AND s2.store_id = cur.store_id AND s2.rn < cur.rn) prev
   WHERE ABS(ISNULL(prev.expected,0) + cur.delta - ISNULL(cur.balance_after,0)) > ${TOL_QTY}`,
  ['id', 'store_id', 'product_id', 'move_date', 'move_type', 'document_no', 'recorded_balance', 'expected_balance', 'diff']);

defCheck('inv_value_vs_gl', 'Inventory', 'قيمة المخزون (أرصدة × تكلفة) مقابل SYS_INVENTORY في GL',
  `SELECT stock_value, gl_inventory,
          ROUND(ABS(stock_value - gl_inventory),2) AS diff
   FROM (
     SELECT
       (SELECT ROUND(SUM(ib.quantity * p.cost_price),2) FROM inventory_balances ib
          JOIN products p ON p.id = ib.product_id) AS stock_value,
       (SELECT ROUND(SUM(jl.debit - jl.credit),2) FROM journal_entry_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          JOIN chart_of_accounts ca ON ca.id = jl.account_id
          WHERE ca.system_code = 'SYS_INVENTORY' AND ${ACTIVE_JE}) AS gl_inventory
   ) t
   WHERE ABS(stock_value - gl_inventory) > ${TOL_MONEY}`,
  ['stock_value', 'gl_inventory', 'diff']);

defCheck('inv_zero_cost_with_stock', 'Inventory', 'أصناف تكلفتها ≤ صفر ولها رصيد موجب',
  `SELECT p.id, p.product_code, p.product_name, ROUND(p.cost_price,2) AS cost_price,
          (SELECT SUM(quantity) FROM inventory_balances ib WHERE ib.product_id = p.id) AS total_qty
   FROM products p
   WHERE p.cost_price <= 0
     AND EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = p.id AND ib.quantity > 0)`,
  ['id', 'product_code', 'product_name', 'cost_price', 'total_qty']);

defCheck('inv_deleted_sales_still_out', 'Inventory', 'فواتير بيع محذوفة ما زال لها صرف مخزون (out)',
  `SELECT si.id, si.invoice_no, si.status,
          ROUND(SUM(ISNULL(sm.qty_in,0) - ISNULL(sm.qty_out,0)),4) AS net_moved
   FROM sales_invoices si
   JOIN stock_movements sm ON sm.reference_id = si.id
   WHERE si.status = 'deleted'
   GROUP BY si.id, si.invoice_no, si.status
   HAVING ABS(SUM(ISNULL(sm.qty_in,0) - ISNULL(sm.qty_out,0))) > ${TOL_QTY}`,
  ['id', 'invoice_no', 'status', 'net_moved']);

// ================================================================
// GROUP E — Document → GL accountability
// ================================================================
defCheck('doc_sales_invoice_no_je', 'Document Accountability', 'فواتير بيع سارية بلا أي قيد محاسبي',
  `SELECT si.id, si.invoice_no, si.invoice_date, si.customer_id, si.grand_total, si.status
   FROM sales_invoices si
   WHERE si.status NOT IN ('cancelled','deleted','draft')
     AND NOT EXISTS (SELECT 1 FROM journal_entries je
                     WHERE je.source_document = si.invoice_no AND ${ACTIVE_JE})`,
  ['id', 'invoice_no', 'invoice_date', 'grand_total', 'status']);

defCheck('doc_sales_invoice_multiple_je', 'Document Accountability', 'فواتير بيع بعدد قيود نشطة غير متوقع (2 = إثبات + COGS)',
  `SELECT si.id, si.invoice_no, si.invoice_date, si.grand_total,
          (SELECT COUNT(*) FROM journal_entries je
           WHERE je.source_document = si.invoice_no AND ${ACTIVE_JE}) AS active_je_count
   FROM sales_invoices si
   WHERE si.status NOT IN ('cancelled','deleted','draft')
     AND (SELECT COUNT(*) FROM journal_entries je
          WHERE je.source_document = si.invoice_no AND ${ACTIVE_JE}) NOT IN (2, 4)
     AND (SELECT COUNT(*) FROM journal_entries je
          WHERE je.source_document = si.invoice_no AND ${ACTIVE_JE}) > 0`,
  ['id', 'invoice_no', 'invoice_date', 'grand_total', 'active_je_count']);

defCheck('doc_deleted_sales_invoice_active_je', 'Document Accountability', 'فواتير بيع محذوفة ما زال لها قيود نشطة',
  `SELECT si.id, si.invoice_no, si.status,
          (SELECT COUNT(*) FROM journal_entries je
           WHERE je.source_document = si.invoice_no AND ${ACTIVE_JE}) AS active_je_count
   FROM sales_invoices si
   WHERE si.status = 'deleted'
     AND EXISTS (SELECT 1 FROM journal_entries je
                 WHERE je.source_document = si.invoice_no AND ${ACTIVE_JE})`,
  ['id', 'invoice_no', 'status', 'active_je_count']);

defCheck('doc_purchase_invoice_no_je', 'Document Accountability', 'فواتير شراء سارية بلا أي قيد',
  `SELECT pi.id, pi.invoice_no, pi.invoice_date, pi.supplier_id, pi.grand_total, pi.status
   FROM purchase_invoices pi
   WHERE pi.status NOT IN ('cancelled','deleted','draft')
     AND NOT EXISTS (SELECT 1 FROM journal_entries je
                     WHERE je.source_document = pi.invoice_no AND ${ACTIVE_JE})`,
  ['id', 'invoice_no', 'invoice_date', 'grand_total', 'status']);

defCheck('doc_purchase_invoice_multiple_je', 'Document Accountability', 'فواتير شراء بعدد قيود نشطة غير متوقع',
  `SELECT pi.id, pi.invoice_no, pi.invoice_date, pi.grand_total,
          (SELECT COUNT(*) FROM journal_entries je
           WHERE je.source_document = pi.invoice_no AND ${ACTIVE_JE}) AS active_je_count
   FROM purchase_invoices pi
   WHERE pi.status NOT IN ('cancelled','deleted','draft')
     AND (SELECT COUNT(*) FROM journal_entries je
          WHERE je.source_document = pi.invoice_no AND ${ACTIVE_JE}) > 1`,
  ['id', 'invoice_no', 'invoice_date', 'grand_total', 'active_je_count']);

defCheck('doc_deleted_purchase_invoice_active_je', 'Document Accountability', 'فواتير شراء محذوفة ما زال لها قيود نشطة',
  `SELECT pi.id, pi.invoice_no, pi.status,
          (SELECT COUNT(*) FROM journal_entries je
           WHERE je.source_document = pi.invoice_no AND ${ACTIVE_JE}) AS active_je_count
   FROM purchase_invoices pi
   WHERE pi.status = 'deleted'
     AND EXISTS (SELECT 1 FROM journal_entries je
                 WHERE je.source_document = pi.invoice_no AND ${ACTIVE_JE})`,
  ['id', 'invoice_no', 'status', 'active_je_count']);

defCheck('doc_approved_sales_return_no_je', 'Document Accountability', 'مرتجعات بيع معتمدة بلا قيد',
  `SELECT sr.id, sr.return_no, sr.return_date, sr.customer_id, sr.grand_total, sr.workflow_status, sr.status
   FROM sales_returns sr
   WHERE ISNULL(sr.workflow_status,'approved') = 'approved'
     AND ISNULL(sr.status,'posted') NOT IN ('cancelled','reversed')
     AND NOT EXISTS (SELECT 1 FROM journal_entries je
                     WHERE je.source_document = sr.return_no AND ${ACTIVE_JE})`,
  ['id', 'return_no', 'return_date', 'grand_total', 'workflow_status', 'status']);

defCheck('doc_approved_purchase_return_no_je', 'Document Accountability', 'مرتجعات شراء سارية بلا قيد',
  `SELECT pr.id, pr.return_no, pr.return_date, pr.supplier_id, pr.grand_total, pr.status
   FROM purchase_returns pr
   WHERE ISNULL(pr.status,'posted') NOT IN ('cancelled','deleted')
     AND NOT EXISTS (SELECT 1 FROM journal_entries je
                     WHERE je.source_document = pr.return_no AND ${ACTIVE_JE})`,
  ['id', 'return_no', 'return_date', 'grand_total', 'status']);

defCheck('doc_ar_payment_no_je', 'Document Accountability', 'سندات قبض (AR) سارية بلا قيد (الشيكات معروفة)',
  `SELECT ap.id, ap.payment_no, ap.payment_date, ap.customer_id, ap.amount, ap.payment_method, ap.status
   FROM ar_payments ap
   WHERE ISNULL(ap.status,'active') NOT IN ('reversed','cancelled')
     AND NOT EXISTS (SELECT 1 FROM journal_entries je
                     WHERE je.source_document = ap.payment_no AND ${ACTIVE_JE})`,
  ['id', 'payment_no', 'payment_date', 'amount', 'payment_method', 'status']);

defCheck('doc_ap_payment_no_je', 'Document Accountability', 'سندات صرف (AP) سارية بلا قيد',
  `SELECT ap.id, ap.payment_no, ap.payment_date, ap.supplier_id, ap.amount, ap.payment_method, ap.status
   FROM ap_payments ap
   WHERE ISNULL(ap.status,'active') NOT IN ('reversed','cancelled')
     AND NOT EXISTS (SELECT 1 FROM journal_entries je
                     WHERE je.source_document = ap.payment_no AND ${ACTIVE_JE})`,
  ['id', 'payment_no', 'payment_date', 'amount', 'payment_method', 'status']);

// ================================================================
// GROUP F — Treasury
// ================================================================
defCheck('trs_account_balance', 'Treasury', 'فرق رصيد حسابات الخزينة (current_balance مقابل معاملات)',
  `SELECT ta.id, ta.account_name, ta.account_type,
          ROUND(ISNULL(ta.current_balance,0),2) AS current_balance,
          ROUND(ISNULL(ta.opening_balance,0) + ISNULL(t.moved,0),2) AS computed_balance,
          ROUND(ABS(ISNULL(ta.current_balance,0) - (ISNULL(ta.opening_balance,0) + ISNULL(t.moved,0))),2) AS diff
   FROM treasury_accounts ta
   OUTER APPLY (SELECT SUM(CASE WHEN tt.trans_type IN ('in','deposit') THEN tt.amount
                                WHEN tt.trans_type IN ('out','expense') THEN -tt.amount
                                ELSE 0 END) AS moved
                FROM treasury_transactions tt WHERE tt.account_id = ta.id) t
   WHERE ABS(ISNULL(ta.current_balance,0) - (ISNULL(ta.opening_balance,0) + ISNULL(t.moved,0))) > ${TOL_MONEY}`,
  ['id', 'account_name', 'account_type', 'current_balance', 'computed_balance', 'diff']);

defCheck('trs_transaction_no_je', 'Treasury', 'معاملات خزينة بلا قيد محاسبي',
  `SELECT tt.id, tt.trans_no, tt.trans_date, tt.trans_type, tt.amount, tt.account_id, tt.document_no
   FROM treasury_transactions tt
   WHERE NOT EXISTS (SELECT 1 FROM journal_entries je
                     WHERE je.source_document = tt.document_no AND ${ACTIVE_JE})`,
  ['id', 'trans_no', 'trans_date', 'trans_type', 'amount', 'document_no']);

// ================================================================
// GROUP G — Allocations
// ================================================================
defCheck('all_alloc_over_payment', 'Allocations', 'تخصيصات تفوق قيمة السند',
  `SELECT x.payment_no, x.payment_id, x.customer_id, x.supplier_id, x.amount,
          ROUND(x.allocated,2) AS allocated, ROUND(x.allocated - x.amount,2) AS over_amt
   FROM (
     SELECT p.payment_no, p.id AS payment_id, p.customer_id, p.supplier_id, p.amount,
            ISNULL((SELECT SUM(allocated_amount) FROM ar_payment_allocations WHERE payment_id = p.id),0)
              + ISNULL((SELECT SUM(allocated_amount) FROM ap_payment_allocations WHERE payment_id = p.id),0) AS allocated
     FROM (
       SELECT payment_no, id, customer_id, CAST(NULL AS INT) AS supplier_id, amount FROM ar_payments
       UNION ALL
       SELECT payment_no, id, CAST(NULL AS INT) AS customer_id, supplier_id, amount FROM ap_payments
     ) p
   ) x
   WHERE x.allocated > x.amount + ${TOL_MONEY}`,
  ['payment_no', 'payment_id', 'amount', 'allocated', 'over_amt']);

defCheck('all_alloc_to_cancelled_invoice', 'Allocations', 'تخصيصات تشير إلى فواتير ملغاة/محذوفة',
  `SELECT a.id, a.payment_id, a.invoice_id, a.allocated_amount,
          COALESCE(si.status, pi.status) AS invoice_status,
          COALESCE(si.invoice_no, pi.invoice_no) AS invoice_no
   FROM (
     SELECT id, payment_id, invoice_id, allocated_amount FROM ar_payment_allocations
     UNION ALL
     SELECT id, payment_id, invoice_id, allocated_amount FROM ap_payment_allocations
   ) a
   LEFT JOIN sales_invoices si ON si.id = a.invoice_id
   LEFT JOIN purchase_invoices pi ON pi.id = a.invoice_id
   WHERE COALESCE(si.status, pi.status) IN ('cancelled','deleted')`,
  ['id', 'payment_id', 'invoice_id', 'allocated_amount', 'invoice_status', 'invoice_no']);

// ================================================================
// Runner
// ================================================================
async function main() {
  const startedAt = new Date().toISOString();
  pool = await getPool();
  await resolveSysAccounts();

  const results = [];
  const byGroup = {};
  let totalIssues = 0;
  let errors = 0;

  for (const c of checks) {
    if (onlySet && !onlySet.has(c.id)) continue;
    if (!QUIET) console.log(`\n▸ [${c.group}] ${c.title}`);
    try {
      const { count, sample } = await c.run();
      const status = count === 0 ? 'OK' : 'ISSUES';
      totalIssues += count;
      results.push({ id: c.id, group: c.group, title: c.title, status, count, sample });
      byGroup[c.group] = (byGroup[c.group] || 0) + count;
      if (!QUIET) {
        console.log(`   → ${count === 0 ? 'PASS (0)' : count + ' issue(s)'}`);
        if (count > 0 && sample.length > 0) {
          console.log('     ' + JSON.stringify(sample));
        }
      }
    } catch (e) {
      errors++;
      results.push({ id: c.id, group: c.group, title: c.title, status: 'ERROR', count: -1, sample: [], error: e.message });
      if (!QUIET) console.log(`   → ERROR: ${e.message}`);
    }
  }

  // Summary
  const report = {
    generated_at: startedAt,
    database: process.env.MSSQL_DATABASE || 'TradePro',
    tolerance_money: TOL_MONEY,
    tolerance_qty: TOL_QTY,
    system_accounts: SYS,
    errors,
    total_issues: totalIssues,
    issues_by_group: byGroup,
    checks: results
  };

  if (!QUIET) {
    console.log('\n═══════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log(`Total issues: ${totalIssues}   |   check errors: ${errors}`);
    console.log('By group:');
    for (const [g, n] of Object.entries(byGroup)) console.log(`  ${g}: ${n}`);
  }

  try {
    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2), 'utf8');
    if (!QUIET) console.log(`\nReport written to: ${JSON_OUT}`);
  } catch (e) {
    console.error('Could not write report:', e.message);
  }

  try { await pool.close(); } catch (e) {}
  process.exit(totalIssues === 0 && errors === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
