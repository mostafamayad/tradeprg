const { getPool, sql } = require('../../database/mssql_db');

function req() { return { pool: null, request: null }; }
async function init(r) {
    r.pool = await getPool();
    r.request = r.pool.request();
    return r;
}
function inp(r, name, type, val) {
    if (val !== null && val !== undefined && val !== '') r.request.input(name, type, val);
    return r;
}

/**
 * Company-level profitability summary.
 * @param {string} [from]
 * @param {string} [to]
 */
async function getCompanyProfitability(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    return (await ctx.request.query(`
        SELECT
            COALESCE(ROUND(SUM(si.grand_total), 2), 0) AS total_revenue,
            COALESCE(ROUND(SUM(si.grand_total - si.amount_paid), 2), 0) AS outstanding_receivables,
            COALESCE(ROUND(SUM(si2.total_cogs), 2), 0) AS total_cogs,
            COUNT(DISTINCT si.id) AS invoice_count
        FROM (
            SELECT id, grand_total, amount_paid, invoice_date
            FROM sales_invoices
            WHERE status NOT IN ('cancelled', 'deleted')
              ${from ? 'AND invoice_date >= @from' : ''}
              ${to ? 'AND invoice_date <= @to' : ''}
        ) si
        LEFT JOIN (
            SELECT sii.invoice_id,
                   SUM(sii.quantity * sii.cost_price) AS total_cogs
            FROM sales_invoice_items sii
            GROUP BY sii.invoice_id
        ) si2 ON si.id = si2.invoice_id
    `)).recordset[0];
}

/**
 * Monthly profitability trend.
 * @param {number} [months=12]
 */
async function getMonthlyProfitTrend(months) {
    months = parseInt(months) || 12;
    const ctx = await init(req());
    inp(ctx, 'months', sql.Int, months);
    return (await ctx.request.query(`
        WITH months AS (
            SELECT DATEADD(MONTH, -n, DATEADD(DAY, 1, EOMONTH(GETDATE()))) AS month_end
            FROM (SELECT TOP (@months) ROW_NUMBER() OVER(ORDER BY (SELECT 1)) - 1 AS n FROM sys.columns) nums
        )
        SELECT FORMAT(m.month_end, 'yyyy-MM') AS month,
               COALESCE(ROUND(SUM(si.grand_total), 2), 0) AS revenue,
               COALESCE(ROUND(SUM(sii.cogs), 2), 0) AS cogs
        FROM months m
        LEFT JOIN sales_invoices si ON LEFT(si.invoice_date, 7) = FORMAT(m.month_end, 'yyyy-MM')
            AND si.status NOT IN ('cancelled', 'deleted')
        LEFT JOIN (
            SELECT sii.invoice_id, SUM(sii.quantity * sii.cost_price) AS cogs
            FROM sales_invoice_items sii
            GROUP BY sii.invoice_id
        ) sii ON si.id = sii.invoice_id
        GROUP BY m.month_end
        ORDER BY m.month_end
    `)).recordset;
}

/**
 * Profitability by branch/store.
 * @param {string} [from]
 * @param {string} [to]
 */
async function getProfitByBranch(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    return (await ctx.request.query(`
        SELECT s.id AS store_id, s.store_code, s.store_name,
               COUNT(DISTINCT si.id) AS invoice_count,
               COALESCE(ROUND(SUM(si.grand_total), 2), 0) AS revenue,
               COALESCE(ROUND(SUM(sii.cogs), 2), 0) AS cogs
        FROM stores s
        LEFT JOIN sales_invoices si ON si.store_id = s.id
            AND si.status NOT IN ('cancelled', 'deleted')
            ${from ? 'AND si.invoice_date >= @from' : ''}
            ${to ? 'AND si.invoice_date <= @to' : ''}
        LEFT JOIN (
            SELECT invoice_id, SUM(quantity * cost_price) AS cogs
            FROM sales_invoice_items
            GROUP BY invoice_id
        ) sii ON si.id = sii.invoice_id
        GROUP BY s.id, s.store_code, s.store_name
        ORDER BY revenue DESC
    `)).recordset;
}

/**
 * Profitability by sales rep.
 * @param {string} [from]
 * @param {string} [to]
 */
async function getProfitBySalesRep(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    return (await ctx.request.query(`
        SELECT sr.id AS rep_id, sr.rep_code, sr.rep_name, sr.region,
               COUNT(DISTINCT si.id) AS invoice_count,
               COALESCE(ROUND(SUM(si.grand_total), 2), 0) AS revenue,
               COALESCE(ROUND(SUM(sii.cogs), 2), 0) AS cogs
        FROM sales_reps sr
        LEFT JOIN sales_invoices si ON si.rep_id = sr.id
            AND si.status NOT IN ('cancelled', 'deleted')
            ${from ? 'AND si.invoice_date >= @from' : ''}
            ${to ? 'AND si.invoice_date <= @to' : ''}
        LEFT JOIN (
            SELECT invoice_id, SUM(quantity * cost_price) AS cogs
            FROM sales_invoice_items
            GROUP BY invoice_id
        ) sii ON si.id = sii.invoice_id
        GROUP BY sr.id, sr.rep_code, sr.rep_name, sr.region
        ORDER BY revenue DESC
    `)).recordset;
}

/**
 * Profitability by product.
 * @param {string} [from]
 * @param {string} [to]
 * @param {number} [limit]
 */
async function getProfitByProduct(from, to, limit) {
    limit = parseInt(limit) || 50;
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    inp(ctx, 'limit', sql.Int, limit);
    return (await ctx.request.query(`
        SELECT TOP (@limit) p.id, p.product_code, p.product_name, p.category_id,
               COALESCE(c.category_name, 'عام') AS category_name,
               COALESCE(ROUND(SUM(sii.quantity * sii.unit_price), 2), 0) AS revenue,
               COALESCE(ROUND(SUM(sii.quantity * sii.cost_price), 2), 0) AS cogs,
               SUM(sii.quantity) AS qty_sold
        FROM sales_invoice_items sii
        JOIN products p ON sii.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN sales_invoices si ON sii.invoice_id = si.id
            AND si.status NOT IN ('cancelled', 'deleted')
            ${from ? 'AND si.invoice_date >= @from' : ''}
            ${to ? 'AND si.invoice_date <= @to' : ''}
        GROUP BY p.id, p.product_code, p.product_name, p.category_id, c.category_name
        HAVING SUM(sii.quantity) > 0
        ORDER BY revenue DESC
    `)).recordset;
}

/**
 * Top 10 customers by profit contribution.
 * @param {string} [from]
 * @param {string} [to]
 */
async function getTopCustomersByProfit(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    return (await ctx.request.query(`
        SELECT TOP 10 cu.id, cu.customer_code, cu.customer_name, cu.region,
               COUNT(DISTINCT si.id) AS invoice_count,
               COALESCE(ROUND(SUM(si.grand_total), 2), 0) AS revenue,
               COALESCE(ROUND(SUM(sii.cogs), 2), 0) AS cogs
        FROM customers cu
        JOIN sales_invoices si ON si.customer_id = cu.id
            AND si.status NOT IN ('cancelled', 'deleted')
            ${from ? 'AND si.invoice_date >= @from' : ''}
            ${to ? 'AND si.invoice_date <= @to' : ''}
        LEFT JOIN (
            SELECT invoice_id, SUM(quantity * cost_price) AS cogs
            FROM sales_invoice_items
            GROUP BY invoice_id
        ) sii ON si.id = sii.invoice_id
        GROUP BY cu.id, cu.customer_code, cu.customer_name, cu.region
        ORDER BY revenue DESC
    `)).recordset;
}

/**
 * Top 10 products by profit contribution.
 * @param {string} [from]
 * @param {string} [to]
 */
async function getTopProductsByProfit(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    return (await ctx.request.query(`
        SELECT TOP 10 p.id, p.product_code, p.product_name,
               COALESCE(ROUND(SUM(sii.quantity * sii.unit_price), 2), 0) AS revenue,
               COALESCE(ROUND(SUM(sii.quantity * sii.cost_price), 2), 0) AS cogs,
               SUM(sii.quantity) AS qty_sold
        FROM sales_invoice_items sii
        JOIN products p ON sii.product_id = p.id
        JOIN sales_invoices si ON sii.invoice_id = si.id
            AND si.status NOT IN ('cancelled', 'deleted')
            ${from ? 'AND si.invoice_date >= @from' : ''}
            ${to ? 'AND si.invoice_date <= @to' : ''}
        GROUP BY p.id, p.product_code, p.product_name
        ORDER BY revenue DESC
    `)).recordset;
}

/**
 * Profit by product category.
 * @param {string} [from]
 * @param {string} [to]
 */
async function getProfitByCategory(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    return (await ctx.request.query(`
        SELECT COALESCE(c.category_name, 'غير مصنف') AS category_name,
               COUNT(DISTINCT sii.id) AS item_count,
               COALESCE(ROUND(SUM(sii.quantity * sii.unit_price), 2), 0) AS revenue,
               COALESCE(ROUND(SUM(sii.quantity * sii.cost_price), 2), 0) AS cogs
        FROM sales_invoice_items sii
        JOIN products p ON sii.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        JOIN sales_invoices si ON sii.invoice_id = si.id
            AND si.status NOT IN ('cancelled', 'deleted')
            ${from ? 'AND si.invoice_date >= @from' : ''}
            ${to ? 'AND si.invoice_date <= @to' : ''}
        GROUP BY c.category_name
        ORDER BY revenue DESC
    `)).recordset;
}

/**
 * Top 10 sales reps by profit.
 * @param {string} [from]
 * @param {string} [to]
 */
async function getTopSalesRepsByProfit(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    return (await ctx.request.query(`
        SELECT TOP 10 sr.id, sr.rep_code, sr.rep_name, sr.region,
               COUNT(DISTINCT si.id) AS invoice_count,
               COALESCE(ROUND(SUM(si.grand_total), 2), 0) AS revenue,
               COALESCE(ROUND(SUM(sii.cogs), 2), 0) AS cogs,
               sr.commission_rate
        FROM sales_reps sr
        JOIN sales_invoices si ON si.rep_id = sr.id
            AND si.status NOT IN ('cancelled', 'deleted')
            ${from ? 'AND si.invoice_date >= @from' : ''}
            ${to ? 'AND si.invoice_date <= @to' : ''}
        LEFT JOIN (
            SELECT invoice_id, SUM(quantity * cost_price) AS cogs
            FROM sales_invoice_items
            GROUP BY invoice_id
        ) sii ON si.id = sii.invoice_id
        GROUP BY sr.id, sr.rep_code, sr.rep_name, sr.region, sr.commission_rate
        ORDER BY revenue DESC
    `)).recordset;
}

module.exports = {
    getCompanyProfitability,
    getMonthlyProfitTrend,
    getProfitByBranch,
    getProfitBySalesRep,
    getProfitByProduct,
    getTopCustomersByProfit,
    getTopProductsByProfit,
    getProfitByCategory,
    getTopSalesRepsByProfit
};
