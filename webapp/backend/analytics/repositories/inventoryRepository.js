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
 * Total inventory value (cost basis) grouped by product with name/category.
 */
async function getInventoryValue() {
    const ctx = await init(req());
    return (await ctx.request.query(`
        SELECT p.id, p.product_code, p.product_name, p.cost_price, p.sell_price,
               COALESCE(b.quantity, 0) AS quantity,
               ROUND(p.cost_price * COALESCE(b.quantity, 0), 2) AS cost_value,
               ROUND(p.sell_price * COALESCE(b.quantity, 0), 2) AS sell_value
        FROM products p
        LEFT JOIN inventory_balances b ON b.product_id = p.id
        WHERE p.is_active = 1 AND COALESCE(b.quantity, 0) != 0
        ORDER BY cost_value DESC
    `)).recordset;
}

/**
 * Stock movements filtered by date range and optional type.
 * @param {string} [from] - YYYY-MM-DD
 * @param {string} [to] - YYYY-MM-DD
 * @param {string} [type] - move_type filter
 */
async function getStockMovement(from, to, type) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    inp(ctx, 'type', sql.NVarChar, type);
    return (await ctx.request.query(`
        SELECT sm.move_date, sm.move_type, sm.document_no, sm.store_id,
               sm.product_id, sm.qty_in, sm.qty_out, sm.cost_price,
               sm.balance_after, sm.created_at,
               s.store_name, p.product_name, p.product_code
        FROM stock_movements sm
        JOIN stores s ON sm.store_id = s.id
        JOIN products p ON sm.product_id = p.id
        WHERE 1=1
          ${from ? 'AND sm.move_date >= @from' : ''}
          ${to ? 'AND sm.move_date <= @to' : ''}
          ${type ? 'AND sm.move_type = @type' : ''}
        ORDER BY sm.move_date DESC, sm.id DESC
    `)).recordset;
}

/**
 * Inventory turnover ratio for a period.
 * COGS from purchases and sales; average inventory from balances snapshot.
 * @param {string} from
 * @param {string} to
 */
async function getInventoryTurnover(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from || '2026-01-01');
    inp(ctx, 'to', sql.NVarChar, to || '2026-12-31');
    return (await ctx.request.query(`
        SELECT
            COALESCE(ROUND(SUM(sm.qty_out * sm.cost_price), 2), 0) AS cogs,
            COALESCE(ROUND(AVG(sm.balance_after * sm.cost_price), 2), 0) AS avg_inventory_value
        FROM stock_movements sm
        WHERE sm.move_type IN ('out', 'transfer', 'disposal')
          AND sm.move_date >= @from AND sm.move_date <= @to
    `)).recordset[0];
}

/**
 * Dead stock — products with no movement in the last N days.
 * @param {number} [days=90]
 */
async function getDeadStock(days) {
    days = parseInt(days) || 90;
    const ctx = await init(req());
    inp(ctx, 'days', sql.Int, days);
    return (await ctx.request.query(`
        SELECT p.id, p.product_code, p.product_name, p.cost_price, p.sell_price,
               COALESCE(b.quantity, 0) AS quantity,
               ROUND(p.cost_price * COALESCE(b.quantity, 0), 2) AS total_value,
               DATEDIFF(DAY, MAX(sm.move_date), GETDATE()) AS days_since_last_movement
        FROM products p
        JOIN inventory_balances b ON b.product_id = p.id AND b.quantity > 0
        LEFT JOIN stock_movements sm ON sm.product_id = p.id
        WHERE p.is_active = 1
        GROUP BY p.id, p.product_code, p.product_name, p.cost_price, p.sell_price, b.quantity
        HAVING DATEDIFF(DAY, ISNULL(MAX(sm.move_date), '2000-01-01'), GETDATE()) >= @days
        ORDER BY total_value DESC
    `)).recordset;
}

/**
 * Fast-moving products — highest total qty_out in a period.
 * @param {number} [limit=20]
 * @param {string} [from]
 * @param {string} [to]
 */
async function getFastMoving(limit, from, to) {
    limit = parseInt(limit) || 20;
    const ctx = await init(req());
    inp(ctx, 'limit', sql.Int, limit);
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    return (await ctx.request.query(`
        SELECT TOP (@limit) p.id, p.product_code, p.product_name,
               SUM(sm.qty_out) AS total_qty_out,
               SUM(sm.qty_in) AS total_qty_in,
               COUNT(DISTINCT sm.document_no) AS transaction_count,
               COALESCE(b.quantity, 0) AS current_stock
        FROM stock_movements sm
        JOIN products p ON sm.product_id = p.id
        LEFT JOIN inventory_balances b ON b.product_id = p.id
        WHERE sm.move_type = 'out'
          ${from ? 'AND sm.move_date >= @from' : ''}
          ${to ? 'AND sm.move_date <= @to' : ''}
        GROUP BY p.id, p.product_code, p.product_name, b.quantity
        ORDER BY total_qty_out DESC
    `)).recordset;
}

/**
 * Slow-moving products — low turnover relative to stock level.
 * @param {number} [limit=20]
 * @param {string} [from]
 * @param {string} [to]
 */
async function getSlowMoving(limit, from, to) {
    limit = parseInt(limit) || 20;
    const ctx = await init(req());
    inp(ctx, 'limit', sql.Int, limit);
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    return (await ctx.request.query(`
        SELECT TOP (@limit) p.id, p.product_code, p.product_name,
               COALESCE(SUM(sm.qty_out), 0) AS total_qty_out,
               COALESCE(b.quantity, 0) AS current_stock,
               ROUND(COALESCE(SUM(sm.qty_out), 0) * 1.0 / NULLIF(COALESCE(b.quantity, 0), 0), 4) AS turnover_ratio,
               ROUND(p.cost_price * COALESCE(b.quantity, 0), 2) AS stock_value
        FROM products p
        JOIN inventory_balances b ON b.product_id = p.id AND b.quantity > 0
        LEFT JOIN stock_movements sm ON sm.product_id = p.id AND sm.move_type = 'out'
          ${from ? 'AND sm.move_date >= @from' : ''}
          ${to ? 'AND sm.move_date <= @to' : ''}
        WHERE p.is_active = 1
        GROUP BY p.id, p.product_code, p.product_name, p.cost_price, b.quantity
        HAVING COALESCE(SUM(sm.qty_out), 0) < COALESCE(b.quantity, 0) * 0.5
        ORDER BY turnover_ratio ASC
    `)).recordset;
}

/**
 * Reorder suggestions — products where current qty <= min_stock.
 */
async function getReorderSuggestions() {
    const ctx = await init(req());
    return (await ctx.request.query(`
        SELECT p.id, p.product_code, p.product_name, p.cost_price, p.sell_price,
               COALESCE(b.quantity, 0) AS current_quantity,
               p.min_stock, p.max_stock,
               ROUND(p.cost_price * (p.max_stock - COALESCE(b.quantity, 0)), 2) AS suggested_order_value,
               (p.max_stock - COALESCE(b.quantity, 0)) AS suggested_order_qty
        FROM products p
        LEFT JOIN inventory_balances b ON b.product_id = p.id
        WHERE p.is_active = 1
          AND COALESCE(b.quantity, 0) <= p.min_stock
        ORDER BY (p.max_stock - COALESCE(b.quantity, 0)) DESC
    `)).recordset;
}

/**
 * Negative stock — products with negative quantity.
 */
async function getNegativeStock() {
    const ctx = await init(req());
    return (await ctx.request.query(`
        SELECT p.id, p.product_code, p.product_name, p.cost_price,
               b.quantity, b.store_id, s.store_name,
               ROUND(p.cost_price * b.quantity, 2) AS negative_value
        FROM inventory_balances b
        JOIN products p ON b.product_id = p.id
        JOIN stores s ON b.store_id = s.id
        WHERE b.quantity < 0
        ORDER BY b.quantity ASC
    `)).recordset;
}

/**
 * Warehouse summary — value/qty per store.
 */
async function getWarehouseSummary() {
    const ctx = await init(req());
    return (await ctx.request.query(`
        SELECT s.id, s.store_code, s.store_name,
               COUNT(b.product_id) AS product_count,
               COALESCE(SUM(b.quantity), 0) AS total_quantity,
               COALESCE(ROUND(SUM(p.cost_price * b.quantity), 2), 0) AS total_cost_value,
               COALESCE(ROUND(SUM(p.sell_price * b.quantity), 2), 0) AS total_sell_value,
               COALESCE(SUM(CASE WHEN b.quantity < 0 THEN 1 ELSE 0 END), 0) AS negative_items,
               COALESCE(SUM(CASE WHEN b.quantity <= p.min_stock AND b.quantity > 0 THEN 1 ELSE 0 END), 0) AS low_stock_items
        FROM stores s
        LEFT JOIN inventory_balances b ON b.store_id = s.id
        LEFT JOIN products p ON b.product_id = p.id
        GROUP BY s.id, s.store_code, s.store_name
        ORDER BY total_cost_value DESC
    `)).recordset;
}

/**
 * ABC Analysis by inventory value (cost).
 * A = top 70%, B = next 20%, C = last 10%.
 */
async function getABCAnalysis() {
    const ctx = await init(req());
    const rows = await ctx.request.query(`
        WITH ranked AS (
            SELECT p.id, p.product_code, p.product_name,
                   ROUND(p.cost_price * COALESCE(b.quantity, 0), 2) AS total_value,
                   COALESCE(b.quantity, 0) AS quantity,
                   ROW_NUMBER() OVER(ORDER BY p.cost_price * COALESCE(b.quantity, 0) DESC) AS rn
            FROM products p
            LEFT JOIN inventory_balances b ON b.product_id = p.id
            WHERE p.is_active = 1 AND COALESCE(b.quantity, 0) > 0
        )
        SELECT * FROM ranked ORDER BY rn
    `);
    return rows.recordset;
}

/**
 * XYZ Analysis by demand variability (coefficient of variation of qty_out).
 * X = low variation, Y = medium, Z = high.
 * @param {number} [months=6]
 */
async function getXYZAnalysis(months) {
    months = parseInt(months) || 6;
    const ctx = await init(req());
    inp(ctx, 'months', sql.Int, months);
    // For products with at least 3 months of data, compute stddev / avg
    return (await ctx.request.query(`
        WITH monthly AS (
            SELECT p.id, p.product_code, p.product_name,
                   LEFT(sm.move_date, 7) AS move_month,
                   SUM(sm.qty_out) AS monthly_qty
            FROM products p
            JOIN stock_movements sm ON sm.product_id = p.id AND sm.move_type = 'out'
            WHERE p.is_active = 1 AND sm.move_date >= DATEADD(MONTH, -@months, GETDATE())
            GROUP BY p.id, p.product_code, p.product_name, LEFT(sm.move_date, 7)
        )
        SELECT id, product_code, product_name,
               ROUND(AVG(monthly_qty), 2) AS avg_monthly_qty,
               ROUND(STDEV(monthly_qty), 2) AS stddev_monthly_qty,
               ROUND(NULLIF(STDEV(monthly_qty), 0) / NULLIF(AVG(monthly_qty), 0), 4) AS cv
        FROM monthly
        GROUP BY id, product_code, product_name
        HAVING COUNT(*) >= 2
        ORDER BY cv DESC
    `)).recordset;
}

/**
 * Monthly inventory value trend.
 * @param {number} [months=12]
 */
async function getInventoryValueTrend(months) {
    months = parseInt(months) || 12;
    const ctx = await init(req());
    inp(ctx, 'months', sql.Int, months);
    return (await ctx.request.query(`
        WITH months AS (
            SELECT DATEADD(MONTH, -n, DATEADD(DAY, 1, EOMONTH(GETDATE()))) AS month_end
            FROM (SELECT TOP (@months) ROW_NUMBER() OVER(ORDER BY (SELECT 1)) - 1 AS n FROM sys.columns) nums
        )
        SELECT FORMAT(m.month_end, 'yyyy-MM') AS month,
               COALESCE(ROUND(SUM(p.cost_price * ib.quantity), 2), 0) AS total_value
        FROM months m
        LEFT JOIN inventory_balances ib ON 1=1
        LEFT JOIN products p ON ib.product_id = p.id
        GROUP BY m.month_end
        ORDER BY m.month_end
    `)).recordset;
}

/**
 * Damaged / disposed stock summary.
 */
async function getDamagedStock() {
    const ctx = await init(req());
    return (await ctx.request.query(`
        SELECT p.id, p.product_code, p.product_name,
               COALESCE(SUM(ds.quantity), 0) AS total_damaged_qty,
               ROUND(COALESCE(SUM(p.cost_price * ds.quantity), 0), 2) AS total_damaged_value,
               COUNT(DISTINCT ds.id) AS damage_entries
        FROM damaged_stock ds
        JOIN products p ON ds.product_id = p.id
        GROUP BY p.id, p.product_code, p.product_name
        HAVING SUM(ds.quantity) > 0
        ORDER BY total_damaged_value DESC
    `)).recordset;
}

module.exports = {
    getInventoryValue,
    getStockMovement,
    getInventoryTurnover,
    getDeadStock,
    getFastMoving,
    getSlowMoving,
    getReorderSuggestions,
    getNegativeStock,
    getWarehouseSummary,
    getABCAnalysis,
    getXYZAnalysis,
    getInventoryValueTrend,
    getDamagedStock
};
