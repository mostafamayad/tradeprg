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

// Canonical active-JE predicate (isolation: excludes reversed/cancelled entries).
// Pass the SQL alias used for journal_entries, e.g. activeJECond('je').
function activeJECond(al) {
    return `(${al}.is_reversed IS NULL OR ${al}.is_reversed = 0)`
        + ` AND (${al}.reversal_of_id IS NULL)`
        + ` AND (${al}.source_action IS NULL OR (${al}.source_action NOT LIKE '%_cancel' AND ${al}.source_action <> 'cancel'))`;
}

// System code(s) treated as cash/bank — the source of truth for cash flow.
const GL_CASH_SYSTEM_CODES = ['SYS_CASH', 'SYS_BANK'];

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
        SELECT ap.payment_date AS date, ap.amount, c.customer_name, ap.payment_method
        FROM ar_payments ap
        LEFT JOIN customers c ON ap.customer_id = c.id
        WHERE ap.status = 'active'
        ${from ? 'AND ap.payment_date >= @from' : ''}
        ${to ? 'AND ap.payment_date <= @to' : ''}
        ORDER BY ap.payment_date
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
 * GL Cash Movements — every debit/credit line touching a GL cash/bank account.
 * Sources all cash flow classification from the journal (SYS_CASH/SYS_BANK),
 * replacing the old treasury_transactions table. Uses the canonical active-JE
 * predicate so reversed/cancelled entries are excluded.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<Array>} [{date, debit, credit, account_id, system_code, reference_type}]
 */
async function getGlCashMovements(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    const codes = GL_CASH_SYSTEM_CODES.map(c => `'${c}'`).join(',');
    const result = await ctx.request.query(`
        SELECT je.entry_date AS date, jl.debit, jl.credit, jl.account_id,
               a.system_code, je.reference_type
        FROM journal_entry_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        JOIN chart_of_accounts a ON a.id = jl.account_id
        ${whereDate(from, to, 'je.entry_date')}
          AND a.system_code IN (${codes})
          AND ${activeJECond('je')}
        ORDER BY je.entry_date, je.id
    `);
    return result.recordset;
}

/**
 * GL Cash/Bank Balances — opening, closing, net, inflow and outflow per cash
 * account, all computed from the journal instead of treasury_accounts.current_balance.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<Array>} [{account_name, account_type, system_code, opening, closing, net, inflow, outflow}]
 */
async function getGlBalances(from, to) {
    const ctx = await init(req());
    const hasFrom = from && from !== 'undefined' && from !== '';
    const hasTo = to && to !== 'undefined' && to !== '';
    if (hasFrom) ctx.request.input('from', sql.NVarChar, from);
    if (hasTo) ctx.request.input('to', sql.NVarChar, to);

    const openCond = hasFrom ? 'je.entry_date < @from' : '1 = 0';
    const closeCond = hasTo ? 'je.entry_date <= @to' : '1 = 1';
    const periodParts = [];
    if (hasFrom) periodParts.push('je.entry_date >= @from');
    if (hasTo) periodParts.push('je.entry_date <= @to');
    const periodCond = periodParts.length ? periodParts.join(' AND ') : '1 = 0';

    const codes = GL_CASH_SYSTEM_CODES.map(c => `'${c}'`).join(',');
    const result = await ctx.request.query(`
        SELECT a.system_code, a.account_name, a.account_type,
               COALESCE(SUM(CASE WHEN ${openCond} THEN jl.debit - jl.credit ELSE 0 END), 0) AS opening,
               COALESCE(SUM(CASE WHEN ${closeCond} THEN jl.debit - jl.credit ELSE 0 END), 0) AS closing,
               COALESCE(SUM(CASE WHEN ${periodCond} THEN jl.debit - jl.credit ELSE 0 END), 0) AS net,
               COALESCE(SUM(CASE WHEN ${periodCond} THEN jl.debit ELSE 0 END), 0) AS inflow,
               COALESCE(SUM(CASE WHEN ${periodCond} THEN jl.credit ELSE 0 END), 0) AS outflow
        FROM journal_entry_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        JOIN chart_of_accounts a ON a.id = jl.account_id
        WHERE a.system_code IN (${codes})
          AND ${activeJECond('je')}
        GROUP BY a.system_code, a.account_name, a.account_type
        ORDER BY a.system_code
    `);
    return result.recordset;
}

/**
 * Daily Cash Balance — computed from GL cash/bank movements.
 * Uses a running sum over journal cash lines to compute the balance at each
 * day's end (starting from the GL opening balance before the period).
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<Array>} [{date, net_change, balance}]
 */
async function getDailyCashBalance(from, to) {
    const ctx = await init(req());
    const hasFrom = from && from !== 'undefined' && from !== '';
    const hasTo = to && to !== 'undefined' && to !== '';
    if (hasFrom) ctx.request.input('from', sql.NVarChar, from);
    if (hasTo) ctx.request.input('to', sql.NVarChar, to);

    const openCond = hasFrom ? 'je.entry_date < @from' : '1 = 0';
    const periodParts = [];
    if (hasFrom) periodParts.push('je.entry_date >= @from');
    if (hasTo) periodParts.push('je.entry_date <= @to');
    const periodWhere = periodParts.length ? 'AND ' + periodParts.join(' AND ') : '';

    const codes = GL_CASH_SYSTEM_CODES.map(c => `'${c}'`).join(',');
    const result = await ctx.request.query(`
        SELECT CAST(je.entry_date AS DATE) AS date,
               SUM(jl.debit - jl.credit) AS net_change,
               SUM(CASE WHEN ${openCond} THEN jl.debit - jl.credit ELSE 0 END) AS opening
        FROM journal_entry_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        JOIN chart_of_accounts a ON a.id = jl.account_id
        WHERE a.system_code IN (${codes})
          AND ${activeJECond('je')}
          ${periodWhere}
        GROUP BY CAST(je.entry_date AS DATE)
        ORDER BY date
    `);

    const opening = result.recordset.length ? parseFloat(result.recordset[0].opening || 0) : 0;
    let running = opening;
    return result.recordset.map(r => {
        running += parseFloat(r.net_change || 0);
        return {
            date: r.date,
            net_change: parseFloat(r.net_change || 0),
            balance: running
        };
    });
}

/**
 * Monthly Cash Flow Summary — aggregated by month from GL cash/bank lines.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<{inflow: number, outflow: number, net: number, months: Array}>}
 */
async function getMonthlyCashFlow(from, to) {
    const ctx = await init(req());
    inp(ctx, 'from', sql.NVarChar, from);
    inp(ctx, 'to', sql.NVarChar, to);
    const codes = GL_CASH_SYSTEM_CODES.map(c => `'${c}'`).join(',');
    const result = await ctx.request.query(`
        SELECT CONVERT(VARCHAR(7), je.entry_date, 120) AS month,
               SUM(jl.debit) AS inflow,
               SUM(jl.credit) AS outflow
        FROM journal_entry_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        JOIN chart_of_accounts a ON a.id = jl.account_id
        ${whereDate(from, to, 'je.entry_date')}
          AND a.system_code IN (${codes})
          AND ${activeJECond('je')}
        GROUP BY CONVERT(VARCHAR(7), je.entry_date, 120)
        ORDER BY month
    `);

    const months = (result.recordset || []).map(m => ({
        month: m.month,
        inflow: parseFloat(m.inflow || 0),
        outflow: parseFloat(m.outflow || 0),
        net: parseFloat(m.inflow || 0) - parseFloat(m.outflow || 0)
    }));

    const totalInflow = months.reduce((s, m) => s + m.inflow, 0);
    const totalOutflow = months.reduce((s, m) => s + m.outflow, 0);

    return { inflow: totalInflow, outflow: totalOutflow, net: totalInflow - totalOutflow, months };
}

/**
 * Cash Flow Forecast — simple projection using historical GL averages.
 * Current cash is the GL closing balance of cash/bank accounts (not the stored
 * treasury current_balance column).
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
    const balances = await getGlBalances(null, to);
    const currentCash = balances.reduce((s, a) => s + parseFloat(a.closing || 0), 0);

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
    getGlCashMovements,
    getGlBalances,
    getDailyCashBalance,
    getMonthlyCashFlow,
    getCashFlowForecast
};
