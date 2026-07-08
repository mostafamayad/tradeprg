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
function whereDate(from, to, col) {
    const clauses = [];
    if (from && from !== 'undefined' && from !== '') clauses.push(col + ' >= @from');
    if (to && to !== 'undefined' && to !== '') clauses.push(col + ' <= @to');
    return clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
}

/**
 * Customer Collections — operating cash inflow.
 * @param {string} [from] - Start date (YYYY-MM-DD)
 * @param {string} [to] - End date
 * @returns {Promise<Array>} [{date, amount, customer_name, payment_method}]
 */
async function getCollections(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    const result = await ctx.request.query(`
        SELECT cc.collection_date AS date, cc.amount, c.customer_name, cc.payment_method
        FROM customer_collections cc
        LEFT JOIN customers c ON cc.customer_id = c.id
        ${whereDate(from, to, 'cc.collection_date')}
        ORDER BY cc.collection_date
    `);
    return result.recordset;
}

/**
 * Supplier Payments — operating cash outflow for inventory/COGS.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<Array>} [{date, amount, supplier_name, payment_method}]
 */
async function getSupplierPayments(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    const result = await ctx.request.query(`
        SELECT sp.payment_date AS date, sp.amount, s.supplier_name, sp.payment_method
        FROM supplier_payments sp
        LEFT JOIN suppliers s ON sp.supplier_id = s.id
        ${whereDate(from, to, 'sp.payment_date')}
        ORDER BY sp.payment_date
    `);
    return result.recordset;
}

/**
 * Expenses — operating cash outflow for SG&A.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<Array>} [{date, amount, expense_type, description}]
 */
async function getExpenses(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    const result = await ctx.request.query(`
        SELECT e.expense_date AS date, e.amount, e.expense_type, e.description
        FROM expenses e
        ${whereDate(from, to, 'e.expense_date')}
        ORDER BY e.expense_date
    `);
    return result.recordset;
}

/**
 * Salary Slips — operating cash outflow for payroll.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<Array>} [{date, amount, employee_name}]
 */
async function getSalaryPayments(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    const result = await ctx.request.query(`
        SELECT ss.created_at AS date, ss.net_salary AS amount, e.emp_name AS employee_name
        FROM salary_slips ss
        LEFT JOIN employees e ON ss.emp_id = e.id
        ${whereDate(from, to, 'ss.created_at')}
        ORDER BY ss.created_at
    `);
    return result.recordset;
}

/**
 * Treasury Transactions — all movements across all treasury accounts.
 * trans_type = 'in' (inflow) or 'out' (outflow).
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<Array>} [{date, amount, trans_type, account_name, description}]
 */
async function getTreasuryTransactions(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    const result = await ctx.request.query(`
        SELECT tt.trans_date AS date, tt.amount, tt.trans_type, ta.account_name, tt.description
        FROM treasury_transactions tt
        LEFT JOIN treasury_accounts ta ON tt.account_id = ta.id
        ${whereDate(from, to, 'tt.trans_date')}
        ORDER BY tt.trans_date
    `);
    return result.recordset;
}

/**
 * Treasury Accounts — current balance of all cash/bank accounts.
 * @returns {Promise<Array>} [{id, account_name, account_type, current_balance}]
 */
async function getTreasuryBalances() {
    const ctx = await init(req());
    const result = await ctx.request.query(`
        SELECT id, account_name, account_type, current_balance
        FROM treasury_accounts
        ORDER BY account_name
    `);
    return result.recordset;
}

/**
 * Daily Cash Balance — computed from treasury transactions.
 * Uses a running sum to compute the balance at each day's end.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<Array>} [{date, balance}]
 */
async function getDailyCashBalance(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    const whereClause = whereDate(from, to, 'tt.trans_date');
    const result = await ctx.request.query(`
WITH daily AS (
    SELECT CAST(tt.trans_date AS DATE) AS date,
           SUM(CASE WHEN tt.trans_type = 'in' THEN tt.amount ELSE -tt.amount END) AS net_change
    FROM treasury_transactions tt
    ${whereClause}
    GROUP BY CAST(tt.trans_date AS DATE)
)
SELECT date, net_change,
       SUM(net_change) OVER(ORDER BY date ROWS UNBOUNDED PRECEDING) AS balance
FROM daily
ORDER BY date
    `);
    return result.recordset;
}

/**
 * Monthly Cash Flow Summary — aggregated by month.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<{inflow: number, outflow: number, net: number, months: Array}>}
 */
async function getMonthlyCashFlow(from, to) {
    const [collections, payments, expenses, salaries] = await Promise.all([
        getCollections(from, to),
        getSupplierPayments(from, to),
        getExpenses(from, to),
        getSalaryPayments(from, to)
    ]);

    const inflowByMonth = {};
    const outflowByMonth = {};

    const monthKey = (d) => (d || '').slice(0, 7);

    collections.forEach(c => {
        const m = monthKey(c.date);
        inflowByMonth[m] = (inflowByMonth[m] || 0) + parseFloat(c.amount || 0);
    });

    [...payments, ...expenses, ...salaries].forEach(t => {
        const m = monthKey(t.date);
        outflowByMonth[m] = (outflowByMonth[m] || 0) + parseFloat(t.amount || 0);
    });

    const allMonths = new Set([...Object.keys(inflowByMonth), ...Object.keys(outflowByMonth)]);
    const months = Array.from(allMonths).sort().map(m => ({
        month: m,
        inflow: inflowByMonth[m] || 0,
        outflow: outflowByMonth[m] || 0,
        net: (inflowByMonth[m] || 0) - (outflowByMonth[m] || 0)
    }));

    const totalInflow = Object.values(inflowByMonth).reduce((s, v) => s + v, 0);
    const totalOutflow = Object.values(outflowByMonth).reduce((s, v) => s + v, 0);

    return { inflow: totalInflow, outflow: totalOutflow, net: totalInflow - totalOutflow, months };
}

/**
 * Cash Flow Forecast — simple projection using historical averages.
 * @param {number} [lookbackMonths=6] - Months of history to average
 * @param {number} [forecastMonths=3] - Months to project
 * @returns {Promise<{avgMonthlyInflow, avgMonthlyOutflow, avgBurn, runway, forecast: Array}>}
 */
async function getCashFlowForecast(lookbackMonths, forecastMonths) {
    lookbackMonths = parseInt(lookbackMonths) || 6;
    forecastMonths = parseInt(forecastMonths) || 3;

    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - lookbackMonths);
    const from = fromDate.toISOString().slice(0, 10);

    const summary = await getMonthlyCashFlow(from, to);
    const balances = await getTreasuryBalances();
    const currentCash = balances.reduce((s, a) => s + parseFloat(a.current_balance || 0), 0);

    const monthsWithData = summary.months.filter(m => m.inflow > 0 || m.outflow > 0);
    const avgInflow = monthsWithData.length > 0
        ? monthsWithData.reduce((s, m) => s + m.inflow, 0) / monthsWithData.length : 0;
    const avgOutflow = monthsWithData.length > 0
        ? monthsWithData.reduce((s, m) => s + m.outflow, 0) / monthsWithData.length : 0;
    const avgBurn = avgOutflow - avgInflow;
    const runway = avgBurn > 0 ? (currentCash / avgBurn) : 999;

    const forecast = [];
    let projectedCash = currentCash;
    for (let i = 1; i <= forecastMonths; i++) {
        const d = new Date();
        d.setMonth(d.getMonth() + i);
        projectedCash = projectedCash + avgInflow - avgOutflow;
        forecast.push({
            month: d.toISOString().slice(0, 7),
            projectedInflow: Math.round(avgInflow),
            projectedOutflow: Math.round(avgOutflow),
            projectedBalance: Math.round(projectedCash)
        });
    }

    return {
        currentCash,
        avgMonthlyInflow: Math.round(avgInflow),
        avgMonthlyOutflow: Math.round(avgOutflow),
        avgBurnRate: Math.round(avgBurn),
        runwayMonths: runway > 990 ? 'infinity' : Math.round(runway),
        forecast
    };
}

module.exports = {
    getCollections,
    getSupplierPayments,
    getExpenses,
    getSalaryPayments,
    getTreasuryTransactions,
    getTreasuryBalances,
    getDailyCashBalance,
    getMonthlyCashFlow,
    getCashFlowForecast
};
