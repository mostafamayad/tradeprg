const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const repo = require('../repositories/analyticsRepository');
const service = require('../services/analyticsService');
const cfService = require('../services/cashFlowService');
const agingService = require('../services/agingService');
const inventoryService = require('../services/inventoryService');
const { respond, cacheMiddleware, TTL } = require('../utils/analyticsResponse');

// ─── v1 Router ──────────────────────────────────────────
const v1 = require('express').Router();

// ── Executive Dashboard ─────────────────────────────────
v1.get('/executive-dashboard',
    cacheMiddleware('exec-dash', TTL.EXECUTIVE_DASHBOARD),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const result = await service.getExecutiveDashboard();
        respond(res, result, start);
    })
);

// ── KPI Endpoints ───────────────────────────────────────
v1.get('/kpi/summary',
    cacheMiddleware('kpi-summary', TTL.KPI_SUMMARY),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const result = await service.getKpiSummary();
        respond(res, result, start);
    })
);

v1.get('/kpi/financial',
    cacheMiddleware('kpi-financial', TTL.KPI_FINANCIAL),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to } = req.query;
        const result = await service.getFinancialKpis(from, to);
        respond(res, result, start);
    })
);

v1.get('/kpi/sales',
    cacheMiddleware('kpi-sales', TTL.KPI_SALES),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to, period } = req.query;
        const result = await service.getSalesKpis(from, to, period);
        respond(res, result, start);
    })
);

v1.get('/kpi/cashflow',
    cacheMiddleware('kpi-cashflow', TTL.KPI_CASHFLOW),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const result = await service.getCashFlowKpis();
        respond(res, result, start);
    })
);

v1.get('/kpi/inventory',
    cacheMiddleware('kpi-inventory', TTL.KPI_INVENTORY),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const result = await service.getInventoryKpis();
        respond(res, result, start);
    })
);

// ── Financial Statements ────────────────────────────────
v1.get('/trial-balance',
    cacheMiddleware('trial-balance', TTL.TRIAL_BALANCE),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to, accountType, includeZero } = req.query;
        const result = await repo.getTrialBalance(from, to, accountType, includeZero);
        respond(res, result, start);
    })
);

v1.get('/balance-sheet',
    cacheMiddleware('balance-sheet', TTL.BALANCE_SHEET),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to, includeZero } = req.query;
        const result = await repo.getBalanceSheet(from, to, includeZero);
        respond(res, result, start);
    })
);

v1.get('/income-statement',
    cacheMiddleware('income-statement', TTL.INCOME_STATEMENT),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to, includeZero } = req.query;
        const result = await repo.getIncomeStatement(from, to, includeZero);
        respond(res, result, start);
    })
);

v1.get('/general-ledger',
    cacheMiddleware('general-ledger', TTL.GENERAL_LEDGER),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to, accountId, search, refType, createdBy, page, pageSize } = req.query;
        const result = await repo.getGeneralLedger(from, to, accountId, search, refType, createdBy, page, pageSize);
        respond(res, result, start);
    })
);

// ── Charts ──────────────────────────────────────────────
v1.get('/chart/sales',
    cacheMiddleware('chart-sales', TTL.CHART_SALES),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { days } = req.query;
        const result = await repo.getSalesChart(days);
        respond(res, result, start);
    })
);

// ── Aging (BI-3) ────────────────────────────────────────
v1.get('/aging/ar',
    cacheMiddleware('aging-ar', TTL.AGING_AR),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const result = await agingService.getARAging(req.query);
        respond(res, result, start);
    })
);

v1.get('/aging/ap',
    cacheMiddleware('aging-ap', TTL.AGING_AP),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const result = await agingService.getAPAging(req.query);
        respond(res, result, start);
    })
);

// ── Sales Reports ───────────────────────────────────────
v1.get('/sales/by-period',
    cacheMiddleware('sales-by-period', TTL.SALES_BY_PERIOD),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to, period, productId, categoryId } = req.query;
        const result = await repo.getSalesByPeriod(from, to, period, productId, categoryId);
        respond(res, result, start);
    })
);

v1.get('/sales/products',
    cacheMiddleware('product-sales', TTL.PRODUCT_SALES),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to, categoryId, sortCol, sortDir, page, perPage } = req.query;
        const result = await repo.getProductSales(from, to, categoryId, sortCol, sortDir, page, perPage);
        respond(res, result, start);
    })
);

v1.get('/sales/top-customers',
    cacheMiddleware('top-customers', TTL.TOP_CUSTOMERS),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { limit } = req.query;
        const result = await repo.getTopCustomers(limit);
        respond(res, result, start);
    })
);

v1.get('/sales/top-products',
    cacheMiddleware('top-products', TTL.TOP_PRODUCTS),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { limit } = req.query;
        const result = await repo.getTopProducts(limit);
        respond(res, result, start);
    })
);

v1.get('/vat-report',
    cacheMiddleware('vat-report', TTL.VAT_REPORT),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to } = req.query;
        const result = await repo.getVatReport(from, to);
        respond(res, result, start);
    })
);

// ── Customer / Supplier ─────────────────────────────────
v1.get('/customer-statement/:id',
    cacheMiddleware('customer-statement', TTL.CUSTOMER_STATEMENT),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to } = req.query;
        const result = await repo.getCustomerStatement(req.params.id, from, to);
        if (!result) return res.status(404).json({ success: false, message: 'Customer not found' });
        respond(res, result, start);
    })
);

// ── Dashboard Data ──────────────────────────────────────
v1.get('/dashboard/kpis',
    cacheMiddleware('dashboard-kpis', TTL.DASHBOARD_KPIS),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const result = await repo.getDashboardKPIs();
        respond(res, result, start);
    })
);

v1.get('/dashboard/recent',
    cacheMiddleware('dashboard-recent', TTL.DASHBOARD_RECENT),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { limit } = req.query;
        const result = await repo.getRecentActivity(limit);
        respond(res, result, start);
    })
);

v1.get('/dashboard/alerts',
    cacheMiddleware('dashboard-alerts', TTL.DASHBOARD_ALERTS),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const result = await repo.getAlerts();
        respond(res, result, start);
    })
);

v1.get('/dashboard/search',
    cacheMiddleware('dashboard-search', TTL.DASHBOARD_SEARCH),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { q } = req.query;
        if (!q) return respond(res, { invoices: [], customers: [], products: [] }, start);
        const result = await repo.globalSearch(q);
        respond(res, result, start);
    })
);

// ── Inventory ───────────────────────────────────────────
v1.get('/inventory/status',
    cacheMiddleware('inventory-status', TTL.INVENTORY_STATUS),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const result = await repo.getInventoryStatus();
        respond(res, result, start);
    })
);

v1.get('/inventory/dashboard',
    cacheMiddleware('inventory-dashboard', TTL.INVENTORY_DASHBOARD),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const result = await inventoryService.getInventoryDashboard(req.query);
        respond(res, result, start);
    })
);

// ── Cash Flow (BI-2) ────────────────────────────────────
v1.get('/cash-flow/statement',
    cacheMiddleware('cf-statement', TTL.KPI_CASHFLOW),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to } = req.query;
        const result = await cfService.getCashFlowStatement(from, to);
        respond(res, result, start);
    })
);

v1.get('/cash-flow/summary',
    cacheMiddleware('cf-summary', TTL.KPI_CASHFLOW),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to } = req.query;
        const result = await cfService.getCashFlowSummary(from, to);
        respond(res, result, start);
    })
);

v1.get('/cash-flow/kpis',
    cacheMiddleware('cf-kpis', TTL.KPI_CASHFLOW),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to } = req.query;
        const result = await cfService.getCashFlowKpis(from, to);
        respond(res, result, start);
    })
);

v1.get('/cash-flow/charts',
    cacheMiddleware('cf-charts', TTL.KPI_CASHFLOW),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { from, to } = req.query;
        const result = await cfService.getCashFlowCharts(from, to);
        respond(res, result, start);
    })
);

v1.get('/cash-flow/forecast',
    cacheMiddleware('cf-forecast', TTL.KPI_FINANCIAL),
    asyncHandler(async (req, res) => {
        const start = Date.now();
        const { lookbackMonths, forecastMonths } = req.query;
        const result = await cfService.getCashFlowForecast(lookbackMonths, forecastMonths);
        respond(res, result, start);
    })
);

// ── Cache Admin ─────────────────────────────────────────
v1.get('/admin/cache-stats', asyncHandler(async (req, res) => {
    const cache = require('../cache/analyticsCache');
    respond(res, cache.stats());
}));

v1.post('/admin/cache-clear', asyncHandler(async (req, res) => {
    const cache = require('../cache/analyticsCache');
    cache.clear();
    respond(res, { message: 'Cache cleared' });
}));

// ── Mount v1 ────────────────────────────────────────────
router.use('/v1', v1);

// ── Version info at root ───────────────────────────────
router.get('/', (req, res) => {
    res.json({
        success: true,
        data: {
            versions: ['v1'],
            current: 'v1',
            endpoints: v1.stack
                .filter(layer => layer.route)
                .map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} /api/analytics/v1${layer.route.path}`)
        }
    });
});

module.exports = router;
