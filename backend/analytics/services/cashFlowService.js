const cfRepo = require('../repositories/cashFlowRepository');

/**
 * Full Cash Flow Statement — operating, investing, financing activities.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<{operating, investing, financing, summary}>}
 */
async function getCashFlowStatement(from, to) {
    const [collections, payments, expenses, salaries, txns, balances] = await Promise.all([
        cfRepo.getCollections(from, to),
        cfRepo.getSupplierPayments(from, to),
        cfRepo.getExpenses(from, to),
        cfRepo.getSalaryPayments(from, to),
        cfRepo.getTreasuryTransactions(from, to),
        cfRepo.getTreasuryBalances()
    ]);

    const totalCol = collections.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
    const totalPay = payments.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
    const totalExp = expenses.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
    const totalSal = salaries.reduce((s, c) => s + parseFloat(c.amount || 0), 0);

    // Investing: treasury transactions with related_type indicating asset/investment
    const investingTxns = txns.filter(t => t.trans_type === 'out' && (t.description || '').toLowerCase().includes('asset'));
    const totalInvesting = investingTxns.reduce((s, t) => s + parseFloat(t.amount || 0), 0);

    // Financing: remaining treasury inflows/outflows not classified as operating or investing
    const operatingOutflowIds = new Set();
    const classifyAmount = txns.reduce((acc, t) => {
        const amt = parseFloat(t.amount || 0);
        if (t.trans_type === 'in') acc.otherIn += amt;
        else acc.otherOut += amt;
        return acc;
    }, { otherIn: 0, otherOut: 0 });

    const openingCash = balances.reduce((s, a) => s + parseFloat(a.opening_balance || 0), 0);
    const closingCash = balances.reduce((s, a) => s + parseFloat(a.current_balance || 0), 0);

    const operatingInflow = totalCol;
    const operatingOutflow = totalPay + totalExp + totalSal;
    const operatingNet = operatingInflow - operatingOutflow;

    const investingOutflow = totalInvesting;
    const investingNet = -investingOutflow;

    const financingInflow = classifyAmount.otherIn;
    const financingOutflow = classifyAmount.otherOut;
    const financingNet = financingInflow - financingOutflow;

    const totalInflow = operatingInflow + financingInflow;
    const totalOutflow = operatingOutflow + investingOutflow + financingOutflow;

    return {
        operating: {
            inflows: [
                { category: 'Customer Collections', amount: Math.round(operatingInflow), count: collections.length }
            ],
            outflows: [
                { category: 'Supplier Payments', amount: Math.round(totalPay), count: payments.length },
                { category: 'Operating Expenses', amount: Math.round(totalExp), count: expenses.length },
                { category: 'Salaries & Payroll', amount: Math.round(totalSal), count: salaries.length }
            ],
            net: Math.round(operatingNet)
        },
        investing: {
            outflows: [
                { category: 'Asset Purchases', amount: Math.round(totalInvesting), count: investingTxns.length }
            ],
            net: Math.round(investingNet)
        },
        financing: {
            inflows: [{ category: 'Other Receipts', amount: Math.round(classifyAmount.otherIn) }],
            outflows: [{ category: 'Other Payments', amount: Math.round(classifyAmount.otherOut) }],
            net: Math.round(financingNet)
        },
        summary: {
            openingCash: Math.round(openingCash),
            totalInflow: Math.round(totalInflow),
            totalOutflow: Math.round(totalOutflow),
            netCashFlow: Math.round(totalInflow - totalOutflow),
            closingCash: Math.round(closingCash),
            accounts: balances.map(a => ({
                name: a.account_name, type: a.account_type, balance: Math.round(a.current_balance)
            }))
        }
    };
}

/**
 * Cash Flow Summary — simplified opening/inflow/outflow/closing.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<{openingCash, inflows, outflows, closingCash, netChange}>}
 */
async function getCashFlowSummary(from, to) {
    const statement = await getCashFlowStatement(from, to);
    return {
        openingCash: statement.summary.openingCash,
        inflows: statement.summary.totalInflow,
        outflows: statement.summary.totalOutflow,
        closingCash: statement.summary.closingCash,
        netChange: statement.summary.netCashFlow,
        accounts: statement.summary.accounts
    };
}

/**
 * Cash Flow KPIs — operating cash, free cash, burn rate, runway.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<{operatingCash, freeCashFlow, netCash, burnRate, runwayMonths, avgMonthlyInflow, avgMonthlyOutflow}>}
 */
async function getCashFlowKpis(from, to) {
    const [statement, monthly, forecast] = await Promise.all([
        getCashFlowStatement(from, to),
        cfRepo.getMonthlyCashFlow(from, to),
        cfRepo.getCashFlowForecast()
    ]);

    return {
        operatingCash: statement.operating.net,
        freeCashFlow: statement.operating.net - statement.investing.net,
        netCash: statement.summary.netCashFlow,
        burnRate: forecast.avgBurnRate,
        runwayMonths: forecast.runwayMonths,
        avgMonthlyInflow: forecast.avgMonthlyInflow,
        avgMonthlyOutflow: forecast.avgMonthlyOutflow,
        currentCash: statement.summary.closingCash
    };
}

/**
 * Cash Flow Charts — 4 chart datasets for the dashboard.
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<{cashInVsOut, dailyBalance, monthlyTrend, operatingBreakdown}>}
 */
async function getCashFlowCharts(from, to) {
    const [daily, monthly, collections, payments, expenses] = await Promise.all([
        cfRepo.getDailyCashBalance(from, to),
        cfRepo.getMonthlyCashFlow(from, to),
        cfRepo.getCollections(from, to),
        cfRepo.getSupplierPayments(from, to),
        cfRepo.getExpenses(from, to)
    ]);

    return {
        cashInVsOut: [
            { label: 'Cash In', total: Math.round(monthly.inflow) },
            { label: 'Cash Out', total: Math.round(monthly.outflow) }
        ],
        dailyBalance: daily.map(d => ({
            date: d.date,
            netChange: Math.round(d.net_change),
            balance: Math.round(d.balance)
        })),
        monthlyTrend: monthly.months.map(m => ({
            month: m.month,
            inflow: Math.round(m.inflow),
            outflow: Math.round(m.outflow),
            net: Math.round(m.net)
        })),
        operatingBreakdown: [
            { category: 'Collections', amount: Math.round(collections.reduce((s, c) => s + parseFloat(c.amount || 0), 0)) },
            { category: 'Supplier Payments', amount: Math.round(payments.reduce((s, c) => s + parseFloat(c.amount || 0), 0)) },
            { category: 'Expenses', amount: Math.round(expenses.reduce((s, c) => s + parseFloat(c.amount || 0), 0)) }
        ]
    };
}

/**
 * Cash Flow Forecast — projection based on historical averages.
 * @param {number} [lookbackMonths=6]
 * @param {number} [forecastMonths=3]
 * @returns {Promise}
 */
async function getCashFlowForecast(lookbackMonths, forecastMonths) {
    return cfRepo.getCashFlowForecast(lookbackMonths, forecastMonths);
}

module.exports = {
    getCashFlowStatement,
    getCashFlowSummary,
    getCashFlowKpis,
    getCashFlowCharts,
    getCashFlowForecast
};
