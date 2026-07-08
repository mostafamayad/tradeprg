const { getPool, sql } = require('../../database/mssql_db');

function req() { return { pool: null, request: null }; }
async function init(r) {
    r.pool = await getPool();
    r.request = r.pool.request();
    return r;
}
function inp(r, name, type, val) {
    if (val !== null && val !== undefined) r.request.input(name, type, val);
    return r;
}

/**
 * AR Aging Detail — per-customer aging with buckets and metadata.
 * Filters: repId, region, customerId, onlyOverdue, from, to
 * @param {Object} filters
 * @param {number|string} [filters.repId]
 * @param {string} [filters.region]
 * @param {number|string} [filters.customerId]
 * @param {boolean} [filters.onlyOverdue]
 * @param {string} [filters.from]
 * @param {string} [filters.to]
 * @returns {Promise<Array>}
 */
async function getARAgingDetail(filters = {}) {
    const ctx = await init(req());
    const f = Object.assign({ repId: null, region: null, customerId: null, onlyOverdue: false, from: null, to: null }, filters);

    inp(ctx, 'repId', sql.Int, f.repId);
    inp(ctx, 'region', sql.NVarChar, f.region);
    inp(ctx, 'customerId', sql.Int, f.customerId);
    inp(ctx, 'from', sql.NVarChar, f.from);
    inp(ctx, 'to', sql.NVarChar, f.to);

    const custWhere = [];
    if (f.repId) custWhere.push('c.rep_id = @repId');
    if (f.region) custWhere.push('c.region = @region');
    if (f.customerId) custWhere.push('c.id = @customerId');
    const custClause = custWhere.length ? 'AND ' + custWhere.join(' AND ') : '';

    const overdueHaving = f.onlyOverdue ? 'HAVING SUM(i.grand_total - i.amount_paid) > 0' : '';

    const result = await ctx.request.query(`
        SELECT c.id, c.customer_code, c.customer_name, c.phone, c.region, c.rep_id,
               c.credit_limit, c.current_balance,
               SUM(i.grand_total - i.amount_paid) AS total_balance,
               COUNT(i.id) AS invoice_count,
               COALESCE(SUM(CASE WHEN DATEDIFF(DAY, i.invoice_date, GETDATE()) <= 0 THEN i.grand_total - i.amount_paid ELSE 0 END), 0) AS age_current,
               COALESCE(SUM(CASE WHEN DATEDIFF(DAY, i.invoice_date, GETDATE()) BETWEEN 1 AND 30 THEN i.grand_total - i.amount_paid ELSE 0 END), 0) AS age_1_30,
               COALESCE(SUM(CASE WHEN DATEDIFF(DAY, i.invoice_date, GETDATE()) BETWEEN 31 AND 60 THEN i.grand_total - i.amount_paid ELSE 0 END), 0) AS age_31_60,
               COALESCE(SUM(CASE WHEN DATEDIFF(DAY, i.invoice_date, GETDATE()) BETWEEN 61 AND 90 THEN i.grand_total - i.amount_paid ELSE 0 END), 0) AS age_61_90,
               COALESCE(SUM(CASE WHEN DATEDIFF(DAY, i.invoice_date, GETDATE()) > 90 THEN i.grand_total - i.amount_paid ELSE 0 END), 0) AS age_90_plus,
               MAX(i.invoice_date) AS last_invoice_date,
               COALESCE((SELECT TOP 1 cc.collection_date FROM customer_collections cc WHERE cc.customer_id = c.id AND cc.amount > 0 ORDER BY cc.collection_date DESC), NULL) AS last_collection_date
        FROM sales_invoices i
        JOIN customers c ON i.customer_id = c.id
        WHERE i.status NOT IN ('cancelled', 'deleted')
          AND (i.grand_total - i.amount_paid) > 0
          ${f.from ? 'AND i.invoice_date >= @from' : ''}
          ${f.to ? 'AND i.invoice_date <= @to' : ''}
          ${custClause}
        GROUP BY c.id, c.customer_code, c.customer_name, c.phone, c.region, c.rep_id,
                 c.credit_limit, c.current_balance
        ${overdueHaving}
        ORDER BY total_balance DESC
    `);
    return result.recordset;
}

/**
 * AP Aging Detail — per-supplier aging with buckets.
 * Filters: supplierId, onlyOverdue, from, to
 * @param {Object} filters
 * @returns {Promise<Array>}
 */
async function getAPAgingDetail(filters = {}) {
    const ctx = await init(req());
    const f = Object.assign({ supplierId: null, onlyOverdue: false, from: null, to: null }, filters);

    inp(ctx, 'supplierId', sql.Int, f.supplierId);
    inp(ctx, 'from', sql.NVarChar, f.from);
    inp(ctx, 'to', sql.NVarChar, f.to);

    const overdueHaving = f.onlyOverdue ? 'HAVING SUM(pi.grand_total - pi.amount_paid) > 0' : '';

    const result = await ctx.request.query(`
        SELECT s.id, s.supplier_code, s.supplier_name, s.phone,
               s.current_balance,
               SUM(pi.grand_total - pi.amount_paid) AS total_balance,
               COUNT(pi.id) AS invoice_count,
               COALESCE(SUM(CASE WHEN DATEDIFF(DAY, pi.invoice_date, GETDATE()) <= 0 THEN pi.grand_total - pi.amount_paid ELSE 0 END), 0) AS age_current,
               COALESCE(SUM(CASE WHEN DATEDIFF(DAY, pi.invoice_date, GETDATE()) BETWEEN 1 AND 30 THEN pi.grand_total - pi.amount_paid ELSE 0 END), 0) AS age_1_30,
               COALESCE(SUM(CASE WHEN DATEDIFF(DAY, pi.invoice_date, GETDATE()) BETWEEN 31 AND 60 THEN pi.grand_total - pi.amount_paid ELSE 0 END), 0) AS age_31_60,
               COALESCE(SUM(CASE WHEN DATEDIFF(DAY, pi.invoice_date, GETDATE()) BETWEEN 61 AND 90 THEN pi.grand_total - pi.amount_paid ELSE 0 END), 0) AS age_61_90,
               COALESCE(SUM(CASE WHEN DATEDIFF(DAY, pi.invoice_date, GETDATE()) > 90 THEN pi.grand_total - pi.amount_paid ELSE 0 END), 0) AS age_90_plus
        FROM purchase_invoices pi
        JOIN suppliers s ON pi.supplier_id = s.id
        WHERE pi.status NOT IN ('cancelled', 'deleted')
          AND (pi.grand_total - pi.amount_paid) > 0
          ${f.supplierId ? 'AND pi.supplier_id = @supplierId' : ''}
          ${f.from ? 'AND pi.invoice_date >= @from' : ''}
          ${f.to ? 'AND pi.invoice_date <= @to' : ''}
        GROUP BY s.id, s.supplier_code, s.supplier_name, s.phone, s.current_balance
        ${overdueHaving}
        ORDER BY total_balance DESC
    `);
    return result.recordset;
}

/**
 * AR Aging Summary — aggregate totals and counts per bucket.
 * @returns {Promise<{total, current, age_1_30, age_31_60, age_61_90, age_90_plus, customer_count}>}
 */
async function getARAgingSummary() {
    const ctx = await init(req());
    const result = await ctx.request.query(`
        SELECT
            COUNT(DISTINCT i.customer_id) AS customer_count,
            COALESCE(SUM(i.grand_total - i.amount_paid), 0) AS total_balance,
            COALESCE(SUM(CASE WHEN DATEDIFF(DAY, i.invoice_date, GETDATE()) <= 0 THEN i.grand_total - i.amount_paid ELSE 0 END), 0) AS age_current,
            COALESCE(SUM(CASE WHEN DATEDIFF(DAY, i.invoice_date, GETDATE()) BETWEEN 1 AND 30 THEN i.grand_total - i.amount_paid ELSE 0 END), 0) AS age_1_30,
            COALESCE(SUM(CASE WHEN DATEDIFF(DAY, i.invoice_date, GETDATE()) BETWEEN 31 AND 60 THEN i.grand_total - i.amount_paid ELSE 0 END), 0) AS age_31_60,
            COALESCE(SUM(CASE WHEN DATEDIFF(DAY, i.invoice_date, GETDATE()) BETWEEN 61 AND 90 THEN i.grand_total - i.amount_paid ELSE 0 END), 0) AS age_61_90,
            COALESCE(SUM(CASE WHEN DATEDIFF(DAY, i.invoice_date, GETDATE()) > 90 THEN i.grand_total - i.amount_paid ELSE 0 END), 0) AS age_90_plus
        FROM sales_invoices i
        WHERE i.status NOT IN ('cancelled', 'deleted')
          AND (i.grand_total - i.amount_paid) > 0
    `);
    return result.recordset[0];
}

/**
 * AP Aging Summary — aggregate totals per bucket.
 * @returns {Promise<{total, current, age_1_30, age_31_60, age_61_90, age_90_plus, supplier_count}>}
 */
async function getAPAgingSummary() {
    const ctx = await init(req());
    const result = await ctx.request.query(`
        SELECT
            COUNT(DISTINCT pi.supplier_id) AS supplier_count,
            COALESCE(SUM(pi.grand_total - pi.amount_paid), 0) AS total_balance,
            COALESCE(SUM(CASE WHEN DATEDIFF(DAY, pi.invoice_date, GETDATE()) <= 0 THEN pi.grand_total - pi.amount_paid ELSE 0 END), 0) AS age_current,
            COALESCE(SUM(CASE WHEN DATEDIFF(DAY, pi.invoice_date, GETDATE()) BETWEEN 1 AND 30 THEN pi.grand_total - pi.amount_paid ELSE 0 END), 0) AS age_1_30,
            COALESCE(SUM(CASE WHEN DATEDIFF(DAY, pi.invoice_date, GETDATE()) BETWEEN 31 AND 60 THEN pi.grand_total - pi.amount_paid ELSE 0 END), 0) AS age_31_60,
            COALESCE(SUM(CASE WHEN DATEDIFF(DAY, pi.invoice_date, GETDATE()) BETWEEN 61 AND 90 THEN pi.grand_total - pi.amount_paid ELSE 0 END), 0) AS age_61_90,
            COALESCE(SUM(CASE WHEN DATEDIFF(DAY, pi.invoice_date, GETDATE()) > 90 THEN pi.grand_total - pi.amount_paid ELSE 0 END), 0) AS age_90_plus
        FROM purchase_invoices pi
        WHERE pi.status NOT IN ('cancelled', 'deleted')
          AND (pi.grand_total - pi.amount_paid) > 0
    `);
    return result.recordset[0];
}

/**
 * Top Delinquent Customers — top N by overdue balance.
 * @param {number} [limit=10]
 * @returns {Promise<Array>}
 */
async function getTopDelinquentCustomers(limit) {
    limit = parseInt(limit) || 10;
    const ctx = await init(req());
    inp(ctx, 'limit', sql.Int, limit);
    const result = await ctx.request.query(`
        SELECT TOP (@limit) c.id, c.customer_name, c.phone, c.region,
               COALESCE(SUM(i.grand_total - i.amount_paid), 0) AS overdue_balance,
               DATEDIFF(DAY, MAX(i.invoice_date), GETDATE()) AS days_since_last_invoice
        FROM sales_invoices i
        JOIN customers c ON i.customer_id = c.id
        WHERE i.status NOT IN ('cancelled', 'deleted')
          AND (i.grand_total - i.amount_paid) > 0
        GROUP BY c.id, c.customer_name, c.phone, c.region
        ORDER BY overdue_balance DESC
    `);
    return result.recordset;
}

/**
 * Monthly Aging Trend — AR balance at end of each month for past N months.
 * @param {number} [months=12]
 * @returns {Promise<Array>}
 */
async function getMonthlyAgingTrend(months) {
    months = parseInt(months) || 12;
    const ctx = await init(req());
    inp(ctx, 'months', sql.Int, months);

    // For each month-end, compute AR balance of invoices before that date
    const result = await ctx.request.query(`
        WITH months AS (
            SELECT DATEADD(MONTH, -n, DATEADD(DAY, 1, EOMONTH(GETDATE()))) AS month_end
            FROM (SELECT TOP (@months) ROW_NUMBER() OVER(ORDER BY (SELECT 1)) - 1 AS n FROM sys.columns) nums
        )
        SELECT
            FORMAT(m.month_end, 'yyyy-MM') AS month,
            COALESCE(SUM(i.grand_total - i.amount_paid), 0) AS balance
        FROM months m
        LEFT JOIN sales_invoices i ON i.invoice_date <= m.month_end
            AND i.status NOT IN ('cancelled', 'deleted')
            AND (i.grand_total - i.amount_paid) > 0
        GROUP BY m.month_end
        ORDER BY m.month_end
    `);
    return result.recordset;
}

/**
 * Collection Efficiency — ratio of collections to outstanding invoices for a period.
 * @param {string} [from]
 * @param {string} [to]
 * @returns {Promise<{collections_total, invoices_total, efficiency_pct}>}
 */
async function getCollectionEfficiency(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);

    const result = await ctx.request.query(`
        SELECT
            COALESCE((SELECT SUM(amount) FROM customer_collections WHERE 1=1
                ${from ? 'AND collection_date >= @from' : ''}
                ${to ? 'AND collection_date <= @to' : ''}
            ), 0) AS collections_total,
            COALESCE((SELECT SUM(grand_total - amount_paid) FROM sales_invoices WHERE status NOT IN ('cancelled', 'deleted')
                AND (grand_total - amount_paid) > 0
                ${from ? 'AND invoice_date >= @from' : ''}
                ${to ? 'AND invoice_date <= @to' : ''}
            ), 0) AS invoices_total
    `);
    return result.recordset[0];
}

module.exports = {
    getARAgingDetail,
    getAPAgingDetail,
    getARAgingSummary,
    getAPAgingSummary,
    getTopDelinquentCustomers,
    getMonthlyAgingTrend,
    getCollectionEfficiency
};
