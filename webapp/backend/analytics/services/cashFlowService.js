const cfRepo = require('../repositories/cashFlowRepository');

// reference_type buckets for classifying a GL cash/bank movement.
const OPERATING_IN_REF = ['customer_collection', 'ar_payment', 'ar_cheque', 'crm_settlement'];
const SUPPLIER_OUT_REF = ['supplier_payment', 'ap_payment', 'ap_cheque', 'purchase_invoice', 'purchase_payment'];
const INVESTING_OUT_REF = ['fixed_asset'];
const FINANCE_IN_REF = ['treasury', 'treasury_account', 'transfer', 'ar_note'];
const FINANCE_OUT_REF = ['treasury', 'treasury_account', 'transfer', 'ap_note', 'sales_return'];

/**
 * Classify GL cash movements into operating/investing/financing buckets.
 * A debit on SYS_CASH/SYS_BANK is money-in; a credit is money-out.
 * @param {Array} movements - from cfRepo.getGlCashMovements
 */
function classifyGl(movements) {
    const b = {
        collectIn: 0, collectInCount: 0,
        supplierOut: 0, supplierOutCount: 0,
        expenseOut: 0, expenseOutCount: 0,
        salaryOut: 0, salaryOutCount: 0,
        investingOut: 0, investingOutCount: 0,
        financingIn: 0, financingInCount: 0,
        financingOut: 0, financingOutCount: 0
    };

    movements.forEach(m => {
        const ref = m.reference_type || '';
        const debit = parseFloat(m.debit || 0);
        const credit = parseFloat(m.credit || 0);

        if (debit > 0) {
            if (OPERATING_IN_REF.includes(ref)) { b.collectIn += debit; b.collectInCount++; }
            else { b.financingIn += debit; b.financingInCount++; }
        } else if (credit > 0) {
            if (SUPPLIER_OUT_REF.includes(ref)) { b.supplierOut += credit; b.supplierOutCount++; }
            else if (ref === 'expense') { b.expenseOut += credit; b.expenseOutCount++; }
            else if (ref === 'salary') { b.salaryOut += credit; b.salaryOutCount++; }
            else if (INVESTING_OUT_REF.includes(ref)) { b.investingOut += credit; b.investingOutCount++; }
            else { b.financingOut += credit; b.financingOutCount++; }
        }
    });

    return b;
}

/**
 * Full Cash Flow Statement — operating, investing, financing activities.
 * Fully GL-backed: balances and movements come from journal_entries on
 * SYS_CASH/SYS_BANK (no treasury_transactions / current_balance dependency).
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<{operating, investing, financing, summary}>}
 */
async function getCashFlowStatement(from, to) {
    const [movements, balances] = await Promise.all([
        cfRepo.getGlCashMovements(from, to),
        cfRepo.getGlBalances(from, to)
    ]);

    const b = classifyGl(movements);

    const openingCash = balances.reduce((s, a) => s + parseFloat(a.opening || 0), 0);
    const closingCash = balances.reduce((s, a) => s + parseFloat(a.closing || 0), 0);
    const totalInflow = balances.reduce((s, a) => s + parseFloat(a.inflow || 0), 0);
    const totalOutflow = balances.reduce((s, a) => s + parseFloat(a.outflow || 0), 0);

    const operatingInflow = b.collectIn;
    const operatingOutflow = b.supplierOut + b.expenseOut + b.salaryOut;
    const operatingNet = operatingInflow - operatingOutflow;

    const investingOutflow = b.investingOut;
    const investingNet = -investingOutflow;

    const financingInflow = b.financingIn;
    const financingOutflow = b.financingOut;
    const financingNet = financingInflow - financingOutflow;

    return {
        operating: {
            inflows: [
                { category: 'Customer Collections', amount: Math.round(operatingInflow), count: b.collectInCount }
            ],
            outflows: [
                { category: 'Supplier Payments', amount: Math.round(b.supplierOut), count: b.supplierOutCount },
                { category: 'Operating Expenses', amount: Math.round(b.expenseOut), count: b.expenseOutCount },
                { category: 'Salaries & Payroll', amount: Math.round(b.salaryOut), count: b.salaryOutCount }
            ],
            net: Math.round(operatingNet)
        },
        investing: {
            outflows: [
                { category: 'Asset Purchases', amount: Math.round(investingOutflow), count: b.investingOutCount }
            ],
            net: Math.round(investingNet)
        },
        financing: {
            inflows: [{ category: 'Other Receipts', amount: Math.round(financingInflow), count: b.financingInCount }],
            outflows: [{ category: 'Other Payments', amount: Math.round(financingOutflow), count: b.financingOutCount }],
            net: Math.round(financingNet)
        },
        summary: {
            openingCash: Math.round(openingCash),
            totalInflow: Math.round(totalInflow),
            totalOutflow: Math.round(totalOutflow),
            netCashFlow: Math.round(totalInflow - totalOutflow),
            closingCash: Math.round(closingCash),
            accounts: balances.map(a => ({
                name: a.account_name, type: a.account_type, balance: Math.round(a.closing)
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
    const [daily, monthly, movements] = await Promise.all([
        cfRepo.getDailyCashBalance(from, to),
        cfRepo.getMonthlyCashFlow(from, to),
        cfRepo.getGlCashMovements(from, to)
    ]);

    const b = classifyGl(movements);

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
            { category: 'Collections', amount: Math.round(b.collectIn) },
            { category: 'Supplier Payments', amount: Math.round(b.supplierOut) },
            { category: 'Expenses', amount: Math.round(b.expenseOut + b.salaryOut) }
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
