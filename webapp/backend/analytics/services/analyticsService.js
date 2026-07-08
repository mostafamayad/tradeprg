const repo = require('../repositories/analyticsRepository');

/**
 * KPI Summary — aggregate of all dashboard KPIs + top customers/products.
 * Used by: BI-0 legacy Dashboard, BI-1 Executive Dashboard
 * @returns {Promise<{revenue, expenses, profit, customers, suppliers, cash, inventory, operations, topCustomers, topProducts}>}
 */
async function getKpiSummary() {
    const kpis = await repo.getDashboardKPIs();
    const topCustomers = await repo.getTopCustomers(5);
    const topProducts = await repo.getTopProducts(5);

    const netIncome = kpis.salesMonth - kpis.purchasesMonth;
    const grossMargin = kpis.salesMonth > 0
        ? ((kpis.salesMonth - kpis.purchasesMonth) / kpis.salesMonth * 100).toFixed(1)
        : 0;

    return {
        revenue: {
            today: kpis.salesToday,
            week: kpis.salesWeek,
            month: kpis.salesMonth,
            trend: kpis.salesMonth > 0 ? 'up' : 'down'
        },
        expenses: {
            today: kpis.purchasesToday,
            month: kpis.purchasesMonth
        },
        profit: {
            month: netIncome,
            grossMargin: parseFloat(grossMargin)
        },
        customers: {
            total: kpis.activeCustomers,
            receivables: kpis.totalReceivables
        },
        suppliers: {
            total: kpis.activeSuppliers,
            payables: kpis.totalPayables
        },
        cash: {
            treasury: kpis.treasuryBalance,
            collectionsToday: kpis.collectionsToday,
            collectionsMonth: kpis.collectionsMonth
        },
        inventory: {
            value: kpis.inventoryValue,
            lowStock: kpis.lowStockCount,
            outOfStock: kpis.outOfStockCount,
            products: kpis.activeProducts
        },
        operations: {
            salesCountToday: kpis.salesCountToday,
            employees: kpis.activeEmployees,
            salesReps: kpis.activeSalesReps
        },
        topCustomers,
        topProducts
    };
}

/**
 * Financial KPIs — balance sheet totals + income statement + ratios.
 * Used by: BI-1 Executive Dashboard, BI-7 Financial Reports
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @returns {Promise<{balanceSheet, incomeStatement, ratios}>}
 */
async function getFinancialKpis(from, to) {
    const bs = await repo.getBalanceSheet(from, to);
    const is = await repo.getIncomeStatement(from, to);

    const totalAssets = bs.accounts
        .filter(a => a.account_type === 'asset')
        .reduce((sum, a) => sum + (a.opening_debit - a.opening_credit + a.period_debit - a.period_credit), 0);

    const totalLiabilities = bs.accounts
        .filter(a => a.account_type === 'liability')
        .reduce((sum, a) => sum + (a.opening_credit - a.opening_debit + a.period_credit - a.period_debit), 0);

    const totalEquity = bs.accounts
        .filter(a => a.account_type === 'equity')
        .reduce((sum, a) => sum + (a.opening_credit - a.opening_debit + a.period_credit - a.period_debit), 0);

    const netIncome = bs.netIncome
        ? (bs.netIncome.revenue_net || 0) - (bs.netIncome.expense_net || 0)
        : 0;

    const totalRevenue = is
        .filter(a => a.account_type === 'revenue')
        .reduce((sum, a) => sum + (a.period_credit - a.period_debit), 0);

    const totalExpenses = is
        .filter(a => a.account_type === 'expense')
        .reduce((sum, a) => sum + (a.period_debit - a.period_credit), 0);

    return {
        balanceSheet: {
            totalAssets: Math.abs(totalAssets),
            totalLiabilities: Math.abs(totalLiabilities),
            totalEquity: Math.abs(totalEquity) + netIncome,
            netIncome
        },
        incomeStatement: {
            totalRevenue: Math.abs(totalRevenue),
            totalExpenses: Math.abs(totalExpenses),
            netProfit: Math.abs(totalRevenue) - Math.abs(totalExpenses)
        },
        ratios: {
            currentRatio: totalLiabilities !== 0 ? (totalAssets / totalLiabilities).toFixed(2) : null,
            profitMargin: totalRevenue !== 0 ? ((netIncome / totalRevenue) * 100).toFixed(1) : 0
        }
    };
}

/**
 * Sales KPIs — grouped by period with aggregated totals.
 * Used by: BI-1, reports module
 * @param {string} [from] - Start date
 * @param {string} [to] - End date
 * @param {string} [period] - 'daily' or 'monthly'
 * @returns {Promise<{byPeriod: Array, totals: {invoiceCount, grossSales, totalDiscount, totalTax, netSales}, avgInvoice: number}>}
 */
async function getSalesKpis(from, to, period) {
    const byPeriod = await repo.getSalesByPeriod(from, to, period);

    const totals = byPeriod.reduce((acc, row) => {
        acc.invoiceCount += row.invoice_count;
        acc.grossSales += parseFloat(row.gross_sales) || 0;
        acc.totalDiscount += parseFloat(row.total_discount) || 0;
        acc.totalTax += parseFloat(row.total_tax) || 0;
        acc.netSales += parseFloat(row.net_sales) || 0;
        return acc;
    }, { invoiceCount: 0, grossSales: 0, totalDiscount: 0, totalTax: 0, netSales: 0 });

    return {
        byPeriod,
        totals,
        avgInvoice: totals.invoiceCount > 0 ? totals.netSales / totals.invoiceCount : 0
    };
}

/**
 * Cash Flow KPIs — treasury, collections, AR/AP summary.
 * Used by: BI-2 Cash Flow Dashboard
 * @returns {Promise<{treasuryBalance, collectionsToday, collectionsMonth, receivables, payables, netCashPosition}>}
 */
async function getCashFlowKpis() {
    const kpis = await repo.getDashboardKPIs();
    return {
        treasuryBalance: kpis.treasuryBalance,
        collectionsToday: kpis.collectionsToday,
        collectionsMonth: kpis.collectionsMonth,
        receivables: kpis.totalReceivables,
        payables: kpis.totalPayables,
        netCashPosition: kpis.treasuryBalance + kpis.totalReceivables - kpis.totalPayables
    };
}

/**
 * Inventory KPIs — total value, low stock, out of stock.
 * Used by: BI-1, BI-5 Inventory Reports
 * @returns {Promise<{totalValue, totalRetail, lowStockItems, outOfStockCount}>}
 */
async function getInventoryKpis() {
    const status = await repo.getInventoryStatus();
    return status;
}

/**
 * Executive Dashboard — single aggregated endpoint.
 * Combines KPIs, sales chart, aging (AR/AP), top customers/products, alerts, inventory.
 * Uses 8 parallel queries — designed for a single-request dashboard load.
 * Used by: BI-1 Executive Dashboard UI
 * @returns {Promise<{kpis, charts, topCustomers, topProducts, alerts, inventory}>}
 */
async function getExecutiveDashboard() {
    const [kpis, salesChart, agingAr, agingAp, topCust, topProd, alerts, invStatus] = await Promise.all([
        repo.getDashboardKPIs(),
        repo.getSalesChart(30),
        repo.getAgingReceivables(),
        repo.getAgingPayables(),
        repo.getTopCustomers(5),
        repo.getTopProducts(5),
        repo.getAlerts(),
        repo.getInventoryStatus()
    ]);

    const totalAr = agingAr.reduce((s, c) => s + parseFloat(c.current_balance || 0), 0);
    const totalAp = agingAp.reduce((s, c) => s + parseFloat(c.current_balance || 0), 0);
    const overdueAr = agingAr.filter(c => c.days_outstanding > 60).length;
    const overdueAp = agingAp.filter(c => c.days_outstanding > 60).length;

    return {
        kpis: {
            salesToday: kpis.salesToday,
            salesMonth: kpis.salesMonth,
            cash: kpis.treasuryBalance,
            banks: 0,
            receivables: kpis.totalReceivables,
            payables: kpis.totalPayables,
            netProfit: kpis.salesMonth - kpis.purchasesMonth,
            grossProfit: kpis.salesMonth > 0
                ? (kpis.salesMonth - kpis.purchasesMonth) / kpis.salesMonth * 100
                : 0,
            inventoryValue: kpis.inventoryValue,
            vat: 0,
            expenses: kpis.purchasesMonth,
            customers: kpis.activeCustomers,
            salesCountToday: kpis.salesCountToday,
            collectionsMonth: kpis.collectionsMonth
        },
        charts: {
            salesTrend: salesChart.map(r => ({ date: r.date, total: r.total, count: r.count })),
            arAging: [
                { bucket: '0-30', total: agingAr.reduce((s, c) => s + parseFloat(c.age_0_30 || 0), 0) },
                { bucket: '31-60', total: agingAr.reduce((s, c) => s + parseFloat(c.age_31_60 || 0), 0) },
                { bucket: '61-90', total: agingAr.reduce((s, c) => s + parseFloat(c.age_61_90 || 0), 0) },
                { bucket: '91-120', total: agingAr.reduce((s, c) => s + parseFloat(c.age_91_120 || 0), 0) },
                { bucket: '120+', total: agingAr.reduce((s, c) => s + parseFloat(c.age_120_plus || 0), 0) }
            ],
            apAging: [
                { bucket: '0-30', total: agingAp.reduce((s, c) => s + parseFloat(c.age_0_30 || 0), 0) },
                { bucket: '31-60', total: agingAp.reduce((s, c) => s + parseFloat(c.age_31_60 || 0), 0) },
                { bucket: '61-90', total: agingAp.reduce((s, c) => s + parseFloat(c.age_61_90 || 0), 0) },
                { bucket: '91-120', total: agingAp.reduce((s, c) => s + parseFloat(c.age_91_120 || 0), 0) },
                { bucket: '120+', total: agingAp.reduce((s, c) => s + parseFloat(c.age_120_plus || 0), 0) }
            ]
        },
        topCustomers: topCust.map(c => ({ name: c.customer_name, total: c.total_sales })),
        topProducts: topProd.map(p => ({ name: p.product_name, qty: p.total_qty })),
        alerts: {
            lowStock: alerts.lowStock.map(p => ({
                id: p.id, code: p.product_code, name: p.product_name,
                quantity: p.quantity, minStock: p.min_stock, unit: p.unit_name
            })),
            outOfStock: alerts.outOfStock.map(p => ({
                id: p.id, code: p.product_code, name: p.product_name
            })),
            overdueCustomers: alerts.overdueCustomers.map(c => ({
                id: c.id, name: c.customer_name, count: c.overdue_count, amount: c.overdue_amount
            })),
            totalReceivables: totalAr,
            totalPayables: totalAp,
            overdueReceivablesCount: overdueAr,
            overduePayablesCount: overdueAp
        },
        inventory: {
            totalValue: invStatus.totalValue,
            totalRetail: invStatus.totalRetail,
            lowStockCount: invStatus.lowStockItems.length,
            outOfStockCount: invStatus.outOfStockCount
        }
    };
}

module.exports = {
    getKpiSummary,
    getFinancialKpis,
    getSalesKpis,
    getCashFlowKpis,
    getInventoryKpis,
    getExecutiveDashboard
};
