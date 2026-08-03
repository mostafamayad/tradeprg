const { getPool, sql } = require('../../database/mssql_db');

// ── helpers ──────────────────────────────────────────────
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
 * Builds the core financial statement CTE (opening + period balances).
 * Used by Trial Balance, Balance Sheet, and Income Statement.
 * @param {string} [from] - Start date (YYYY-MM-DD)
 * @param {string} [to] - End date (YYYY-MM-DD)
 * @param {Function} [openingOverride] - Optional callback to override opening WHERE clause
 * @returns {string} SQL text with %zeroFilter% placeholder
 */
function buildFinancialCTE(from, to, openingOverride) {
    const hasFrom = from && from !== 'undefined' && from !== '';
    const openingWhere = hasFrom ? 'WHERE j.entry_date < @from' : 'WHERE 1=0';
    const periodParts = ['WHERE 1=1'];
    if (hasFrom) periodParts.push('AND j.entry_date >= @from');
    if (to && to !== 'undefined' && to !== '') periodParts.push('AND j.entry_date <= @to');
    const periodWhere = periodParts.join(' ');

    const openingReplace = openingOverride ? openingOverride(openingWhere) : openingWhere;
    return `
WITH opening AS (
    SELECT l.account_id,
           SUM(ISNULL(l.debit, 0)) AS opening_debit,
           SUM(ISNULL(l.credit, 0)) AS opening_credit
    FROM journal_entry_lines l
    JOIN journal_entries j ON l.entry_id = j.id
    ${openingReplace}
    GROUP BY l.account_id
),
period AS (
    SELECT l.account_id,
           SUM(ISNULL(l.debit, 0)) AS period_debit,
           SUM(ISNULL(l.credit, 0)) AS period_credit
    FROM journal_entry_lines l
    JOIN journal_entries j ON l.entry_id = j.id
    ${periodWhere}
    GROUP BY l.account_id
)
SELECT
    a.id AS account_id,
    a.account_code,
    a.account_name,
    a.account_type,
    a.parent_id,
    ISNULL(o.opening_debit, 0) AS opening_debit,
    ISNULL(o.opening_credit, 0) AS opening_credit,
    ISNULL(p.period_debit, 0) AS period_debit,
    ISNULL(p.period_credit, 0) AS period_credit
FROM chart_of_accounts a
LEFT JOIN opening o ON a.id = o.account_id
LEFT JOIN period p ON a.id = p.account_id
WHERE a.account_type IN (@accTypes) %zeroFilter%
ORDER BY a.account_code`;
}

/**
 * Trial Balance — all accounts with opening and period movements.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @param {string} [accountType] - Filter by account_type
 * @param {boolean|string} [includeZero] - Include zero-balance accounts
 * @returns {Promise<Array>} Account rows with opening_debit/credit, period_debit/credit
 */
async function getTrialBalance(from, to, accountType, includeZero) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);

    const zeroFilter = includeZero ? '' : "AND (ISNULL(o.opening_debit, 0) + ISNULL(o.opening_credit, 0) + ISNULL(p.period_debit, 0) + ISNULL(p.period_credit, 0) <> 0)";
    const accTypeFilter = accountType && accountType !== 'undefined' && accountType !== ''
        ? "AND a.account_type = @accType" : '';

    let sqlText = buildFinancialCTE(from, to).replace('%zeroFilter%', zeroFilter);
    sqlText = sqlText.replace('WHERE a.account_type IN (@accTypes)', 'WHERE 1=1');

    if (accTypeFilter) {
        sqlText = sqlText.replace('WHERE 1=1', 'WHERE 1=1 ' + accTypeFilter);
    }

    if (includeZero === false || includeZero === 'false') {
        sqlText = sqlText.replace('%zeroFilter%', "AND (ISNULL(o.opening_debit, 0) + ISNULL(o.opening_credit, 0) + ISNULL(p.period_debit, 0) + ISNULL(p.period_credit, 0) <> 0)");
    }

    inp(ctx, 'accType', sql.NVarChar, accountType);
    const result = await ctx.request.query(sqlText);
    return result.recordset;
}

/**
 * Balance Sheet — asset, liability, equity accounts with net income injected.
 * Used by BI-1 Executive Dashboard and accounting module.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @param {boolean|string} [includeZero] - Include zero-balance accounts
 * @returns {Promise<{accounts: Array, netIncome: {revenue_net: number, expense_net: number}}>}
 */
async function getBalanceSheet(from, to, includeZero) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    inp(ctx, 'to2', sql.NVarChar, to);

    const zeroFilter = includeZero ? '' : "AND (ISNULL(o.opening_debit, 0) + ISNULL(o.opening_credit, 0) + ISNULL(p.period_debit, 0) + ISNULL(p.period_credit, 0) <> 0)";
    let sqlText = buildFinancialCTE(from, to).replace('%zeroFilter%', zeroFilter);
    sqlText = sqlText.replace('WHERE a.account_type IN (@accTypes)', "WHERE a.account_type IN ('asset', 'liability', 'equity')");

    const result = await ctx.request.query(sqlText);

    const niWhere = to && to !== 'undefined' && to !== '' ? 'AND j.entry_date <= @to2' : '';
    const niSQL = `
SELECT
    SUM(CASE WHEN a.account_type = 'revenue' THEN ISNULL(l.credit, 0) - ISNULL(l.debit, 0) ELSE 0 END) AS revenue_net,
    SUM(CASE WHEN a.account_type = 'expense' THEN ISNULL(l.debit, 0) - ISNULL(l.credit, 0) ELSE 0 END) AS expense_net
FROM journal_entry_lines l
JOIN journal_entries j ON l.entry_id = j.id
JOIN chart_of_accounts a ON l.account_id = a.id
WHERE 1=1 ${niWhere}`;
    const niResult = await ctx.request.query(niSQL);

    return {
        accounts: result.recordset,
        netIncome: niResult.recordset[0]
    };
}

/**
 * Income Statement — revenue and expense accounts with period movements.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @param {boolean|string} [includeZero] - Include zero-balance accounts
 * @returns {Promise<Array>} Revenue/expense rows
 */
async function getIncomeStatement(from, to, includeZero) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);

    const zeroFilter = includeZero ? '' : "AND (ISNULL(p.period_debit, 0) + ISNULL(p.period_credit, 0) <> 0)";
    let sqlText = buildFinancialCTE(from, to).replace('%zeroFilter%', zeroFilter);
    sqlText = sqlText.replace('WHERE a.account_type IN (@accTypes)', "WHERE a.account_type IN ('revenue', 'expense')");

    const result = await ctx.request.query(sqlText);
    return result.recordset;
}

/**
 * General Ledger — paginated journal entries with running balance.
 * Supports filtering by account, search text, reference type, and creator.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @param {number|string} [accountId] - Filter by account
 * @param {string} [search] - Full-text search on descriptions
 * @param {string} [refType] - Filter by reference_type
 * @param {string} [createdBy] - Filter by creator
 * @param {number|string} [page] - Page number (1-based)
 * @param {number|string} [pageSize] - Rows per page
 * @returns {Promise<{opening: Array, rows: Array, totalCount: number}>}
 */
async function getGeneralLedger(from, to, accountId, search, refType, createdBy, page, pageSize) {
    const ctx = await init(req());
    const hasFrom = from && from !== 'undefined' && from !== '';
    const hasTo = to && to !== 'undefined' && to !== '';
    const hasAccount = accountId && accountId !== 'undefined' && accountId !== '';
    const hasSearch = search && search !== 'undefined' && search !== '';
    const hasRefType = refType && refType !== 'undefined' && refType !== '';
    const hasCreatedBy = createdBy && createdBy !== 'undefined' && createdBy !== '';
    const offset = ((parseInt(page) || 1) - 1) * (parseInt(pageSize) || 50);
    const size = parseInt(pageSize) || 50;

    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    inp(ctx, 'accId', sql.Int, accountId);
    inp(ctx, 'search', sql.NVarChar, search ? `%${search}%` : null);
    inp(ctx, 'refType', sql.NVarChar, refType);
    inp(ctx, 'createdBy', sql.NVarChar, createdBy);
    inp(ctx, 'offset', sql.Int, offset);
    inp(ctx, 'size', sql.Int, size);

    const openingSQL = `
SELECT l.account_id,
       SUM(ISNULL(l.debit, 0)) AS opening_debit,
       SUM(ISNULL(l.credit, 0)) AS opening_credit
FROM journal_entry_lines l
JOIN journal_entries j ON l.entry_id = j.id
WHERE j.entry_date < @from
    ${hasAccount ? 'AND l.account_id = @accId' : ''}
    ${hasRefType ? 'AND j.reference_type = @refType' : ''}
    ${hasCreatedBy ? 'AND j.created_by = @createdBy' : ''}
GROUP BY l.account_id`;

    const periodSQL = `
WITH period_raw AS (
    SELECT
        l.account_id,
        a.account_code,
        a.account_name,
        a.account_type,
        j.entry_date,
        j.id AS journal_id,
        j.reference_type,
        j.entry_no AS ref_number,
        COALESCE(l.description, j.description) AS line_description,
        ISNULL(l.debit, 0) AS debit,
        ISNULL(l.credit, 0) AS credit
    FROM journal_entry_lines l
    JOIN journal_entries j ON l.entry_id = j.id
    JOIN chart_of_accounts a ON l.account_id = a.id
    WHERE 1=1
        ${hasFrom ? 'AND j.entry_date >= @from' : ''}
        ${hasTo ? 'AND j.entry_date <= @to' : ''}
        ${hasAccount ? 'AND l.account_id = @accId' : ''}
        ${hasSearch ? 'AND (j.description LIKE @search OR j.entry_no LIKE @search OR COALESCE(l.description, j.description) LIKE @search)' : ''}
        ${hasRefType ? 'AND j.reference_type = @refType' : ''}
        ${hasCreatedBy ? 'AND j.created_by = @createdBy' : ''}
),
with_running AS (
    SELECT *,
        SUM(debit - credit) OVER(
            PARTITION BY account_id
            ORDER BY entry_date, journal_id
            ROWS UNBOUNDED PRECEDING
        ) AS running_net,
        COUNT(*) OVER() AS total_count
    FROM period_raw
)
SELECT *
FROM with_running
ORDER BY account_code, entry_date, journal_id
OFFSET @offset ROWS
FETCH NEXT @size ROWS ONLY`;

    const [openingRes, periodRes] = await Promise.all([
        ctx.request.query(openingSQL),
        ctx.request.query(periodSQL)
    ]);

    return {
        opening: openingRes.recordset,
        rows: periodRes.recordset,
        totalCount: periodRes.recordset.length > 0 ? periodRes.recordset[0].total_count : 0
    };
}

/**
 * Dashboard KPIs — 19 aggregate metrics in a single parallel query batch.
 * Returns today/week/month sales, customer/supplier/product/employee counts,
 * receivables, payables, treasury, inventory, stock alerts, collections.
 * Used by: legacy Dashboard, BI-1 Executive Dashboard
 * @returns {Promise<Object>} All KPI values as named properties
 */
async function getDashboardKPIs() {
    const ctx = await init(req());
    const today = new Date().toISOString().slice(0, 10);
    inp(ctx, 't1', sql.NVarChar, today);
    inp(ctx, 't2', sql.NVarChar, today);
    inp(ctx, 't3', sql.NVarChar, today);
    inp(ctx, 't4', sql.NVarChar, today);

    const queries = [
        `SELECT COALESCE(SUM(grand_total), 0) as v FROM sales_invoices WHERE invoice_date = @t1 AND status NOT IN ('cancelled', 'deleted')`,
        `SELECT COALESCE(SUM(grand_total), 0) as v FROM sales_invoices WHERE TRY_CAST(invoice_date AS DATE) >= DATEADD(day, -7, GETDATE()) AND status NOT IN ('cancelled', 'deleted')`,
        `SELECT COALESCE(SUM(grand_total), 0) as v FROM sales_invoices WHERE LEFT(invoice_date, 7) = LEFT(CONVERT(NVarChar(10), GETDATE(), 120), 7) AND status NOT IN ('cancelled', 'deleted')`,
        `SELECT COUNT(*) as v FROM sales_invoices WHERE invoice_date = @t2 AND status NOT IN ('cancelled', 'deleted')`,
        `SELECT COALESCE(SUM(grand_total), 0) as v FROM purchase_invoices WHERE invoice_date = @t3 AND status NOT IN ('cancelled', 'deleted')`,
        `SELECT COALESCE(SUM(grand_total), 0) as v FROM purchase_invoices WHERE LEFT(invoice_date, 7) = LEFT(CONVERT(NVarChar(10), GETDATE(), 120), 7) AND status NOT IN ('cancelled', 'deleted')`,
        `SELECT COUNT(*) as v FROM customers WHERE is_active = 1`,
        `SELECT COUNT(*) as v FROM suppliers WHERE is_active = 1`,
        `SELECT COUNT(*) as v FROM products WHERE is_active = 1`,
        `SELECT COUNT(*) as v FROM employees WHERE status = 'active'`,
        `SELECT COUNT(*) as v FROM sales_reps WHERE is_active = 1`,
        `SELECT COALESCE(SUM(current_balance), 0) as v FROM customers WHERE current_balance > 0`,
        `SELECT COALESCE(SUM(current_balance), 0) as v FROM suppliers WHERE current_balance > 0`,
        `SELECT COALESCE(SUM(current_balance), 0) as v FROM treasury_accounts`,
        `SELECT COALESCE(SUM(ib.quantity * p.cost_price), 0) as v FROM inventory_balances ib JOIN products p ON ib.product_id = p.id`,
        `SELECT COUNT(DISTINCT ib.product_id) as v FROM inventory_balances ib JOIN products p ON ib.product_id = p.id WHERE ib.quantity <= p.min_stock AND ib.quantity > 0`,
        `SELECT COUNT(*) as v FROM products p WHERE p.is_active = 1 AND NOT EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = p.id AND ib.quantity > 0)`,
        `SELECT COALESCE(SUM(amount), 0) as v FROM customer_collections WHERE collection_date = @t4 AND amount > 0`,
        `SELECT COALESCE(SUM(amount), 0) as v FROM customer_collections WHERE LEFT(collection_date, 7) = LEFT(CONVERT(NVarChar(10), GETDATE(), 120), 7) AND amount > 0`
    ];

    const results = await Promise.all(queries.map(q => ctx.request.query(q)));

    return {
        salesToday: results[0].recordset[0].v,
        salesWeek: results[1].recordset[0].v,
        salesMonth: results[2].recordset[0].v,
        salesCountToday: results[3].recordset[0].v,
        purchasesToday: results[4].recordset[0].v,
        purchasesMonth: results[5].recordset[0].v,
        activeCustomers: results[6].recordset[0].v,
        activeSuppliers: results[7].recordset[0].v,
        activeProducts: results[8].recordset[0].v,
        activeEmployees: results[9].recordset[0].v,
        activeSalesReps: results[10].recordset[0].v,
        totalReceivables: results[11].recordset[0].v,
        totalPayables: results[12].recordset[0].v,
        treasuryBalance: results[13].recordset[0].v,
        inventoryValue: results[14].recordset[0].v,
        lowStockCount: results[15].recordset[0].v,
        outOfStockCount: results[16].recordset[0].v,
        collectionsToday: results[17].recordset[0].v,
        collectionsMonth: results[18].recordset[0].v
    };
}

/**
 * Recent Activity — top N invoices, collections, and purchases.
 * Used by: legacy Dashboard sidebar
 * @param {number|string} [limit=10] - Max items per section
 * @returns {Promise<{invoices: Array, collections: Array, purchases: Array}>}
 */
async function getRecentActivity(limit) {
    limit = parseInt(limit) || 10;
    const ctx = await init(req());
    inp(ctx, 'limit', sql.Int, limit);

    const [invoices, collections, purchases] = await Promise.all([
        ctx.request.query(`SELECT TOP (@limit) i.id, i.invoice_no, i.invoice_date, i.grand_total, i.status, c.customer_name FROM sales_invoices i LEFT JOIN customers c ON i.customer_id = c.id ORDER BY i.id DESC`),
        ctx.request.query(`SELECT TOP (@limit) cc.id, cc.collection_no, cc.collection_date, cc.amount, c.customer_name, cc.payment_method FROM customer_collections cc LEFT JOIN customers c ON cc.customer_id = c.id WHERE cc.amount > 0 ORDER BY cc.id DESC`),
        ctx.request.query(`SELECT TOP (@limit) pi.id, pi.invoice_no, pi.invoice_date, pi.grand_total, s.supplier_name FROM purchase_invoices pi LEFT JOIN suppliers s ON pi.supplier_id = s.id ORDER BY pi.id DESC`)
    ]);

    return { invoices: invoices.recordset, collections: collections.recordset, purchases: purchases.recordset };
}

/**
 * Alerts — low stock items, out-of-stock products, overdue customers (60+ days).
 * Used by: legacy Dashboard, BI-1 Executive Dashboard
 * @returns {Promise<{lowStock: Array, outOfStock: Array, overdueCustomers: Array}>}
 */
async function getAlerts() {
    const ctx = await init(req());
    const [lowStock, outOfStock, overdueCustomers] = await Promise.all([
        ctx.request.query(`SELECT TOP 20 p.id, p.product_code, p.product_name, ib.quantity, p.min_stock, p.unit_name FROM inventory_balances ib JOIN products p ON ib.product_id = p.id WHERE ib.quantity <= p.min_stock ORDER BY (ib.quantity - p.min_stock) ASC`),
        ctx.request.query(`SELECT TOP 20 p.id, p.product_code, p.product_name, p.unit_name FROM products p WHERE p.is_active = 1 AND NOT EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = p.id AND ib.quantity > 0)`),
        ctx.request.query(`SELECT TOP 20 c.id, c.customer_name, COUNT(i.id) as overdue_count, SUM(i.grand_total - i.amount_paid) as overdue_amount FROM sales_invoices i JOIN customers c ON i.customer_id = c.id WHERE i.status NOT IN ('cancelled', 'deleted') AND TRY_CAST(i.invoice_date AS DATE) < DATEADD(day, -60, GETDATE()) AND (i.grand_total - i.amount_paid) > 0 GROUP BY c.id, c.customer_name ORDER BY overdue_amount DESC`)
    ]);

    return { lowStock: lowStock.recordset, outOfStock: outOfStock.recordset, overdueCustomers: overdueCustomers.recordset };
}

/**
 * Sales Chart — daily sales totals for the last N days.
 * Used by: legacy Dashboard chart, BI-1 Executive Dashboard
 * @param {number|string} [days=30] - Number of days to include
 * @returns {Promise<Array>} [{date, total, count}]
 */
async function getSalesChart(days) {
    days = parseInt(days) || 30;
    const ctx = await init(req());
    inp(ctx, 'days', sql.Int, days);
    const result = await ctx.request.query(`
        SELECT 
            CAST(invoice_date AS DATE) as date, 
            SUM(grand_total) as total, 
            COUNT(*) as count
        FROM sales_invoices
        WHERE status NOT IN ('cancelled', 'deleted') 
          AND TRY_CAST(invoice_date AS DATE) >= DATEADD(day, -@days, CAST(GETDATE() AS DATE))
        GROUP BY CAST(invoice_date AS DATE)
        ORDER BY CAST(invoice_date AS DATE)
    `);
    return result.recordset;
}

/**
 * Top Customers by total sales.
 * Used by: legacy Dashboard, BI-1 Executive Dashboard
 * @param {number|string} [limit=5]
 * @returns {Promise<Array>} [{id, customer_name, total_sales}]
 */
async function getTopCustomers(limit) {
    limit = parseInt(limit) || 5;
    const ctx = await init(req());
    inp(ctx, 'limit', sql.Int, limit);
    const result = await ctx.request.query(`
        SELECT TOP (@limit) c.id, c.customer_name, SUM(i.grand_total) as total_sales
        FROM sales_invoices i
        JOIN customers c ON i.customer_id = c.id
        WHERE i.status NOT IN ('cancelled', 'deleted')
        GROUP BY c.id, c.customer_name
        ORDER BY total_sales DESC
    `);
    return result.recordset;
}

/**
 * Top Products by quantity sold.
 * Used by: legacy Dashboard, BI-1 Executive Dashboard
 * @param {number|string} [limit=5]
 * @returns {Promise<Array>} [{id, product_name, total_qty}]
 */
async function getTopProducts(limit) {
    limit = parseInt(limit) || 5;
    const ctx = await init(req());
    inp(ctx, 'limit', sql.Int, limit);
    const result = await ctx.request.query(`
        SELECT TOP (@limit) p.id, p.product_name, SUM(si.quantity) as total_qty
        FROM sales_invoice_items si
        JOIN sales_invoices i ON si.invoice_id = i.id
        JOIN products p ON si.product_id = p.id
        WHERE i.status NOT IN ('cancelled', 'deleted')
        GROUP BY p.id, p.product_name
        ORDER BY total_qty DESC
    `);
    return result.recordset;
}

/**
 * Global Search — invoices, customers, products matching a term.
 * Used by: legacy Dashboard search
 * @param {string} term - Search keyword
 * @returns {Promise<{invoices: Array, customers: Array, products: Array}>}
 */
async function globalSearch(term) {
    const ctx = await init(req());
    const searchTerm = `%${term}%`;
    inp(ctx, 'searchTerm', sql.NVarChar, searchTerm);

    const [invoices, customers, products] = await Promise.all([
        ctx.request.query(`SELECT TOP 5 i.id, i.invoice_no, i.grand_total, c.customer_name as name FROM sales_invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE invoice_no LIKE @searchTerm ORDER BY i.id DESC`),
        ctx.request.query(`SELECT TOP 5 id, customer_code as code, customer_name as name FROM customers WHERE customer_name LIKE @searchTerm OR customer_code LIKE @searchTerm`),
        ctx.request.query(`SELECT TOP 5 id, product_code as code, product_name as name FROM products WHERE product_name LIKE @searchTerm OR product_code LIKE @searchTerm`)
    ]);

    return { invoices: invoices.recordset, customers: customers.recordset, products: products.recordset };
}

/**
 * AR Aging — customer receivables with aging buckets (0-30, 31-60, 61-90, 91-120, 120+).
 * Used by: BI-1 Executive Dashboard, reports module
 * @returns {Promise<Array>} Customer rows with aging breakdown
 */
async function getAgingReceivables() {
    const ctx = await init(req());
    const result = await ctx.request.query(`
        SELECT c.id, c.customer_code, c.customer_name, c.phone,
               c.current_balance, c.credit_limit,
               (c.credit_limit - c.current_balance) AS available_credit,
               CASE
                 WHEN c.current_balance > 0 AND c.last_invoice_date IS NOT NULL
                 THEN DATEDIFF(DAY, TRY_CAST(c.last_invoice_date AS DATE), GETDATE())
                 ELSE 0
               END AS days_outstanding,
               COALESCE((
                 SELECT SUM(i.grand_total - i.amount_paid)
                 FROM sales_invoices i
                 WHERE i.customer_id = c.id
                   AND i.status NOT IN ('cancelled', 'deleted')
                   AND (i.grand_total - i.amount_paid) > 0
                   AND DATEDIFF(DAY, TRY_CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 0 AND 30
               ), 0) AS age_0_30,
               COALESCE((
                 SELECT SUM(i.grand_total - i.amount_paid)
                 FROM sales_invoices i
                 WHERE i.customer_id = c.id
                   AND i.status NOT IN ('cancelled', 'deleted')
                   AND (i.grand_total - i.amount_paid) > 0
                   AND DATEDIFF(DAY, TRY_CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 31 AND 60
               ), 0) AS age_31_60,
               COALESCE((
                 SELECT SUM(i.grand_total - i.amount_paid)
                 FROM sales_invoices i
                 WHERE i.customer_id = c.id
                   AND i.status NOT IN ('cancelled', 'deleted')
                   AND (i.grand_total - i.amount_paid) > 0
                   AND DATEDIFF(DAY, TRY_CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 61 AND 90
               ), 0) AS age_61_90,
               COALESCE((
                 SELECT SUM(i.grand_total - i.amount_paid)
                 FROM sales_invoices i
                 WHERE i.customer_id = c.id
                   AND i.status NOT IN ('cancelled', 'deleted')
                   AND (i.grand_total - i.amount_paid) > 0
                   AND DATEDIFF(DAY, TRY_CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 91 AND 120
               ), 0) AS age_91_120,
               COALESCE((
                 SELECT SUM(i.grand_total - i.amount_paid)
                 FROM sales_invoices i
                 WHERE i.customer_id = c.id
                   AND i.status NOT IN ('cancelled', 'deleted')
                   AND (i.grand_total - i.amount_paid) > 0
                   AND DATEDIFF(DAY, TRY_CAST(i.invoice_date AS DATE), GETDATE()) > 120
               ), 0) AS age_120_plus
        FROM customers c
        WHERE c.is_active = 1 AND c.current_balance > 0
        ORDER BY c.current_balance DESC
    `);
    return result.recordset;
}

/**
 * AP Aging — supplier payables with aging buckets.
 * Uses subquery for last invoice date (suppliers table may lack last_invoice_date column).
 * @returns {Promise<Array>} Supplier rows with aging breakdown
 */
async function getAgingPayables() {
    const ctx = await init(req());
    const result = await ctx.request.query(`
        SELECT s.id, s.supplier_code, s.supplier_name, s.phone,
               s.current_balance,
               COALESCE((
                 SELECT DATEDIFF(DAY, MAX(CAST(pi.invoice_date AS DATE)), GETDATE())
                 FROM purchase_invoices pi
                 WHERE pi.supplier_id = s.id AND pi.status NOT IN ('cancelled', 'deleted')
               ), 0) AS days_outstanding,
               COALESCE((
                 SELECT SUM(pi.grand_total - pi.amount_paid)
                 FROM purchase_invoices pi
                 WHERE pi.supplier_id = s.id
                   AND pi.status NOT IN ('cancelled', 'deleted')
                   AND (pi.grand_total - pi.amount_paid) > 0
                   AND DATEDIFF(DAY, CAST(pi.invoice_date AS DATE), GETDATE()) BETWEEN 0 AND 30
               ), 0) AS age_0_30,
               COALESCE((
                 SELECT SUM(pi.grand_total - pi.amount_paid)
                 FROM purchase_invoices pi
                 WHERE pi.supplier_id = s.id
                   AND pi.status NOT IN ('cancelled', 'deleted')
                   AND (pi.grand_total - pi.amount_paid) > 0
                   AND DATEDIFF(DAY, CAST(pi.invoice_date AS DATE), GETDATE()) BETWEEN 31 AND 60
               ), 0) AS age_31_60,
               COALESCE((
                 SELECT SUM(pi.grand_total - pi.amount_paid)
                 FROM purchase_invoices pi
                 WHERE pi.supplier_id = s.id
                   AND pi.status NOT IN ('cancelled', 'deleted')
                   AND (pi.grand_total - pi.amount_paid) > 0
                   AND DATEDIFF(DAY, CAST(pi.invoice_date AS DATE), GETDATE()) BETWEEN 61 AND 90
               ), 0) AS age_61_90,
               COALESCE((
                 SELECT SUM(pi.grand_total - pi.amount_paid)
                 FROM purchase_invoices pi
                 WHERE pi.supplier_id = s.id
                   AND pi.status NOT IN ('cancelled', 'deleted')
                   AND (pi.grand_total - pi.amount_paid) > 0
                   AND DATEDIFF(DAY, CAST(pi.invoice_date AS DATE), GETDATE()) BETWEEN 91 AND 120
               ), 0) AS age_91_120,
               COALESCE((
                 SELECT SUM(pi.grand_total - pi.amount_paid)
                 FROM purchase_invoices pi
                 WHERE pi.supplier_id = s.id
                   AND pi.status NOT IN ('cancelled', 'deleted')
                   AND (pi.grand_total - pi.amount_paid) > 0
                   AND DATEDIFF(DAY, CAST(pi.invoice_date AS DATE), GETDATE()) > 120
               ), 0) AS age_120_plus
        FROM suppliers s
        WHERE s.is_active = 1 AND s.current_balance > 0
        ORDER BY s.current_balance DESC
    `);
    return result.recordset;
}

/**
 * Inventory Status — total value (cost + retail), low-stock list, out-of-stock count.
 * Used by: BI-1 Executive Dashboard, BI-5 Inventory
 * @returns {Promise<{totalValue: number, totalRetail: number, lowStockItems: Array, outOfStockCount: number}>}
 */
async function getInventoryStatus() {
    const ctx = await init(req());
    const [valueRes, lowRes, outRes] = await Promise.all([
        ctx.request.query(`SELECT COALESCE(SUM(ib.quantity * p.cost_price), 0) AS total_value, COALESCE(SUM(ib.quantity * p.sell_price), 0) AS total_retail FROM inventory_balances ib JOIN products p ON ib.product_id = p.id`),
        ctx.request.query(`SELECT TOP 20 p.id, p.product_code, p.product_name, ib.quantity, p.min_stock, p.unit_name FROM inventory_balances ib JOIN products p ON ib.product_id = p.id WHERE ib.quantity <= p.min_stock ORDER BY (ib.quantity - p.min_stock) ASC`),
        ctx.request.query(`SELECT COUNT(*) as total FROM products p WHERE p.is_active = 1 AND NOT EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = p.id AND ib.quantity > 0)`)
    ]);
    return {
        totalValue: valueRes.recordset[0].total_value,
        totalRetail: valueRes.recordset[0].total_retail,
        lowStockItems: lowRes.recordset,
        outOfStockCount: outRes.recordset[0].total
    };
}

/**
 * Sales by Period — aggregated sales grouped by month or day.
 * Supports optional product/category filters.
 * Used by: reports module, BI-2 Cash Flow
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @param {string} [period=daily|monthly] - Grouping period
 * @param {number|string} [productId] - Filter by product
 * @param {number|string} [categoryId] - Filter by category
 * @returns {Promise<Array>} Period rows with invoice_count, gross_sales, net_sales
 */
async function getSalesByPeriod(from, to, period, productId, categoryId) {
    const ctx = await init(req());
    const dateGroup = period === 'daily' ? 'LEFT(i.invoice_date, 10)' : 'LEFT(i.invoice_date, 7)';
    const wheres = ["i.status NOT IN ('cancelled', 'deleted')"];
    const joins = [];
    if (from && from !== 'undefined' && from !== '') wheres.push('i.invoice_date >= @from');
    if (to && to !== 'undefined' && to !== '') wheres.push('i.invoice_date <= @to');
    if (productId && productId !== 'undefined' && productId !== '') {
        joins.push('JOIN sales_invoice_items ii ON ii.invoice_id = i.id');
        wheres.push('ii.product_id = @productId');
    }
    if (categoryId && categoryId !== 'undefined' && categoryId !== '') {
        joins.push('JOIN sales_invoice_items ii ON ii.invoice_id = i.id');
        joins.push('JOIN products p ON ii.product_id = p.id');
        wheres.push('p.category_id = @categoryId');
    }
    const whereClause = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const joinClause = joins.join(' ');

    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    inp(ctx, 'productId', sql.Int, productId);
    inp(ctx, 'categoryId', sql.Int, categoryId);

    const mainSQL = `
        SELECT ${dateGroup} AS period,
               COUNT(DISTINCT i.id) AS invoice_count,
               COALESCE(SUM(i.subtotal), 0) AS gross_sales,
               COALESCE(SUM(i.discount_amount), 0) AS total_discount,
               COALESCE(SUM(i.tax_amount), 0) AS total_tax,
               COALESCE(SUM(i.grand_total), 0) AS net_sales
        FROM sales_invoices i ${joinClause}
        ${whereClause}
        GROUP BY ${dateGroup}
        ORDER BY period DESC
    `;

    const result = await ctx.request.query(mainSQL);
    return result.recordset;
}

/**
 * Product Sales Report — paginated product performance with sales, returns, inventory.
 * Used by: reports module
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @param {number|string} [categoryId] - Filter by category
 * @param {string} [sortCol] - Sort column (sold_qty, sales_value, profit, margin_pct, product_name)
 * @param {string} [sortDir] - Sort direction (asc|desc)
 * @param {number|string} [page] - Page number
 * @param {number|string} [perPage] - Rows per page
 * @returns {Promise<{rows: Array, total: number}>}
 */
async function getProductSales(from, to, categoryId, sortCol, sortDir, page, perPage) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    inp(ctx, 'categoryId', sql.Int, categoryId);
    const offset = ((parseInt(page) || 1) - 1) * (parseInt(perPage) || 50);
    const size = parseInt(perPage) || 50;
    inp(ctx, 'offset', sql.Int, offset);
    inp(ctx, 'size', sql.Int, size);

    const allowedSort = { sold_qty: 'sold_qty', sales_value: 'sales_value', profit: 'profit', margin_pct: 'margin_pct', product_name: 'product_name' };
    const sortC = allowedSort[sortCol] || 'sales_value';
    const sortD = sortDir === 'asc' ? 'ASC' : 'DESC';

    const wheres = [];
    if (from && from !== 'undefined' && from !== '') wheres.push('i.invoice_date >= @from');
    if (to && to !== 'undefined' && to !== '') wheres.push('i.invoice_date <= @to');
    if (categoryId && categoryId !== 'undefined' && categoryId !== '') wheres.push('p.category_id = @categoryId');
    const whereClause = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';

    const sql = `
WITH product_sales AS (
    SELECT p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, p.sell_price,
           COALESCE(SUM(ii.quantity), 0) AS sold_qty,
           COALESCE(SUM(ii.line_total), 0) AS sales_value,
           COALESCE(SUM(ii.quantity * ii.cost_price), 0) AS cost,
           CASE WHEN COALESCE(SUM(ii.quantity), 0) > 0 THEN COALESCE(SUM(ii.line_total), 0) / SUM(ii.quantity) ELSE 0 END AS avg_price
    FROM products p
    LEFT JOIN sales_invoice_items ii ON ii.product_id = p.id
    LEFT JOIN sales_invoices i ON ii.invoice_id = i.id AND i.status NOT IN ('cancelled', 'deleted')
    ${whereClause}
    GROUP BY p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, p.sell_price
),
product_returns AS (
    SELECT sri.product_id, COALESCE(SUM(sri.quantity), 0) AS returned_qty
    FROM sales_return_items sri
    JOIN sales_returns sr ON sr.id = sri.return_id AND sr.status NOT IN ('cancelled', 'deleted')
    GROUP BY sri.product_id
),
product_inventory AS (
    SELECT ib.product_id, COALESCE(SUM(ib.quantity), 0) AS inventory
    FROM inventory_balances ib
    GROUP BY ib.product_id
)
SELECT ps.*,
       COALESCE(pr.returned_qty, 0) AS returned_qty,
       ps.sold_qty - COALESCE(pr.returned_qty, 0) AS net_qty,
       ps.sales_value - ps.cost AS profit,
       CASE WHEN ps.cost > 0 THEN (ps.sales_value - ps.cost) / ps.cost * 100 ELSE 0 END AS margin_pct,
       COALESCE(pinv.inventory, 0) AS inventory
FROM product_sales ps
LEFT JOIN product_returns pr ON pr.product_id = ps.id
LEFT JOIN product_inventory pinv ON pinv.product_id = ps.id
WHERE ps.sold_qty > 0 OR COALESCE(pr.returned_qty, 0) > 0
ORDER BY ${sortC} ${sortD}
OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`;

    const countSQL = `
SELECT COUNT(DISTINCT ii.product_id) AS total
FROM sales_invoice_items ii
JOIN sales_invoices i ON ii.invoice_id = i.id
${whereClause}`;

    const [dataRes, countRes] = await Promise.all([
        ctx.request.query(sql),
        ctx.request.query(countSQL)
    ]);

    return { rows: dataRes.recordset, total: countRes.recordset[0].total };
}

/**
 * VAT Report — tax collected on sales and reversed on returns, grouped by rate.
 * Used by: reports module, accounting reconciliation
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<{sales: Array, returns: Array}>}
 */
async function getVatReport(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    const wheres = [];
    if (from && from !== 'undefined' && from !== '') wheres.push('i.invoice_date >= @from');
    if (to && to !== 'undefined' && to !== '') wheres.push('i.invoice_date <= @to');
    const whereClause = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const retW = wheres.length ? 'WHERE ' + wheres.join(' AND ').replace(/i\./g, 'sr.') : '';

    const [salesRes, retRes] = await Promise.all([
        ctx.request.query(`
SELECT COALESCE(ii.tax_pct, 0) AS vat_rate,
       COUNT(DISTINCT i.id) AS invoice_count,
       COALESCE(SUM(ii.line_total), 0) AS taxable_sales,
       COALESCE(SUM(ii.line_total * (ii.tax_pct / 100.0)), 0) AS vat_collected
FROM sales_invoice_items ii
JOIN sales_invoices i ON ii.invoice_id = i.id
${whereClause}
GROUP BY ii.tax_pct
ORDER BY vat_rate`),
        ctx.request.query(`
SELECT COALESCE(sri.tax_pct_snapshot, 0) AS vat_rate,
       COUNT(DISTINCT sr.id) AS return_count,
       COALESCE(SUM(sri.line_total), 0) AS taxable_returns,
       COALESCE(SUM(sri.tax_amount_snapshot), 0) AS vat_reversed
FROM sales_return_items sri
JOIN sales_returns sr ON sr.id = sri.return_id
${retW}
GROUP BY sri.tax_pct_snapshot
ORDER BY vat_rate`)
    ]);

    return { sales: salesRes.recordset, returns: retRes.recordset };
}

/**
 * Customer Statement — full transaction history for a single customer.
 * Unions invoices, returns, collections, and related journal entries.
 * Used by: customer accounting reports
 * @param {number|string} customerId
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<{customer: Object|null, transactions: Array}>}
 */
async function getCustomerStatement(customerId, from, to) {
    const ctx = await init(req());
    inp(ctx, 'cid', sql.Int, customerId);
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);

    const wStr = from && from !== 'undefined' && from !== '' ? ' AND i.invoice_date >= @from' : '';
    const wStr2 = to && to !== 'undefined' && to !== '' ? ' AND i.invoice_date <= @to' : '';
    const wStrFull = wStr + wStr2;
    const wStrR = wStrFull.replace(/i\./g, '');
    const wStrC = wStrFull.replace(/i\./g, '');
    const wStrJ = wStrFull;

    const arRes = await ctx.request.query(`SELECT id FROM chart_of_accounts WHERE system_code = 'AR'`);
    const arAccId = arRes.recordset.length > 0 ? arRes.recordset[0].id : null;

    const customerRes = await ctx.request.query(`SELECT * FROM customers WHERE id = @cid`);
    const customer = customerRes.recordset[0];

    if (!customer) return null;

    const unionSQL = `
SELECT invoice_date AS trans_date, invoice_no AS doc_no,
       N'فاتورة مبيعات' AS doc_type, N'فاتورة' AS doc_type_short,
       grand_total AS debit, 0 AS credit,
       'sales_invoice' AS ref_type, id AS ref_id,
       ISNULL(notes,'') AS description, '' AS created_by_name
FROM sales_invoices
WHERE customer_id = @cid AND status NOT IN ('cancelled', 'deleted') ${wStrFull}
UNION ALL
SELECT return_date AS trans_date, return_no AS doc_no,
       N'مرتجع مبيعات' AS doc_type, N'مرتجع' AS doc_type_short,
       0 AS debit, grand_total AS credit,
       'sales_return' AS ref_type, id AS ref_id,
       ISNULL(return_reason,'') AS description, '' AS created_by_name
FROM sales_returns
WHERE customer_id = @cid AND status NOT IN ('cancelled', 'deleted') ${wStrR}
UNION ALL
SELECT collection_date AS trans_date, collection_no AS doc_no,
       N'تحصيل' AS doc_type, N'تحصيل' AS doc_type_short,
       0 AS debit, amount AS credit,
       'collection' AS ref_type, id AS ref_id,
       ISNULL(notes,'') AS description, '' AS created_by_name
FROM customer_collections
WHERE customer_id = @cid ${wStrC}
${arAccId ? `
UNION ALL
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
` : ''}
ORDER BY trans_date ASC, ref_id ASC`;

    inp(ctx, 'arAccId', sql.Int, arAccId);
    const result = await ctx.request.query(unionSQL);

    return { customer, transactions: result.recordset };
}

module.exports = {
    getTrialBalance,
    getBalanceSheet,
    getIncomeStatement,
    getGeneralLedger,
    getDashboardKPIs,
    getRecentActivity,
    getAlerts,
    getSalesChart,
    getTopCustomers,
    getTopProducts,
    globalSearch,
    getAgingReceivables,
    getAgingPayables,
    getInventoryStatus,
    getSalesByPeriod,
    getProductSales,
    getVatReport,
    getCustomerStatement
};
