const cache = require('./../cache/analyticsCache');

/**
 * TTL configuration per endpoint type (milliseconds).
 * 0 = no caching (live data like search, GL, customer statement).
 * Cache keys combine endpoint name + full request URL.
 */
const TTL = {
    EXECUTIVE_DASHBOARD: 30000,
    KPI_SUMMARY: 30000,
    KPI_FINANCIAL: 60000,
    KPI_SALES: 60000,
    KPI_CASHFLOW: 60000,
    KPI_INVENTORY: 60000,
    TRIAL_BALANCE: 60000,
    BALANCE_SHEET: 60000,
    INCOME_STATEMENT: 60000,
    GENERAL_LEDGER: 0,
    CHART_SALES: 60000,
    AGING_RECEIVABLES: 60000,
    AGING_PAYABLES: 60000,
    SALES_BY_PERIOD: 60000,
    PRODUCT_SALES: 60000,
    TOP_CUSTOMERS: 60000,
    TOP_PRODUCTS: 60000,
    VAT_REPORT: 60000,
    CUSTOMER_STATEMENT: 0,
    DASHBOARD_KPIS: 30000,
    DASHBOARD_RECENT: 60000,
    DASHBOARD_ALERTS: 60000,
    DASHBOARD_SEARCH: 0,
    INVENTORY_STATUS: 60000,
    AGING_AR: 60000,
    AGING_AP: 60000,
    AGING_TOP_DELINQUENT: 60000,
    AGING_MONTHLY_TREND: 60000,
    INVENTORY_DASHBOARD: 60000,
    PROFITABILITY_DASHBOARD: 60000
};

/**
 * Standard API response envelope.
 * Every endpoint returns: { success, data, generatedAt, executionTime }
 * @param {import('express').Response} res
 * @param {*} data - Response payload
 * @param {number} [startTime] - Date.now() before handler execution
 */
function respond(res, data, startTime) {
    return res.json({
        success: true,
        data,
        generatedAt: new Date().toISOString(),
        executionTime: startTime ? Date.now() - startTime : 0
    });
}

/**
 * Express middleware that caches the response for a given TTL.
 * Intercepts res.json() to store the serialized response before sending.
 * Cache key = `${cacheKey}:${req.originalUrl}`
 *
 * @param {string} cacheKey - Logical grouping prefix
 * @param {number} ttlMs - Time-to-live (0 = skip cache)
 * @returns {import('express').RequestHandler}
 */
function cacheMiddleware(cacheKey, ttlMs) {
    return (req, res, next) => {
        if (!ttlMs) return next();
        const key = `${cacheKey}:${req.originalUrl}`;
        const cached = cache.get(key);
        if (cached) {
            cached._cached = true;
            return res.json(cached);
        }
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            if (body && body.success) cache.set(key, body, ttlMs);
            return originalJson(body);
        };
        next();
    };
}

module.exports = { respond, cacheMiddleware, TTL };
