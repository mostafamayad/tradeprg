const ar = require('../repositories/agingRepository');

/**
 * AR Aging — full report with detail, summary, KPIs, top delinquent, monthly trend.
 * @param {Object} filters
 * @returns {Promise<Object>}
 */
async function getARAging(filters = {}) {
    const [detail, summary, topDelinquent, monthlyTrend, efficiency] = await Promise.all([
        ar.getARAgingDetail(filters),
        ar.getARAgingSummary(),
        ar.getTopDelinquentCustomers(filters.limit),
        ar.getMonthlyAgingTrend(filters.months),
        ar.getCollectionEfficiency(filters.from, filters.to)
    ]);

    const total = parseFloat(summary.total_balance) || 0;
    const overdueTotal = parseFloat(summary.age_1_30) + parseFloat(summary.age_31_60)
        + parseFloat(summary.age_61_90) + parseFloat(summary.age_90_plus);
    const overduePct = total > 0 ? parseFloat(((overdueTotal / total) * 100).toFixed(1)) : 0;

    return {
        detail,
        summary: {
            ...summary,
            total_balance: total,
            overdue_total: parseFloat(overdueTotal.toFixed(2)),
            overdue_pct: overduePct,
            age_current: parseFloat(summary.age_current) || 0,
            age_1_30: parseFloat(summary.age_1_30) || 0,
            age_31_60: parseFloat(summary.age_31_60) || 0,
            age_61_90: parseFloat(summary.age_61_90) || 0,
            age_90_plus: parseFloat(summary.age_90_plus) || 0
        },
        top_delinquent: topDelinquent,
        monthly_trend: monthlyTrend,
        collection_efficiency: {
            collections_total: parseFloat(efficiency.collections_total) || 0,
            invoices_total: parseFloat(efficiency.invoices_total) || 0,
            efficiency_pct: parseFloat(efficiency.invoices_total) > 0
                ? parseFloat(((efficiency.collections_total / efficiency.invoices_total) * 100).toFixed(1))
                : 0
        }
    };
}

/**
 * AP Aging — full report with detail, summary, top delinquent.
 * @param {Object} filters
 * @returns {Promise<Object>}
 */
async function getAPAging(filters = {}) {
    const [detail, summary, topDelinquent] = await Promise.all([
        ar.getAPAgingDetail(filters),
        ar.getAPAgingSummary(),
        ar.getARAgingDetail({ ...filters, onlyOverdue: true, limit: filters.limit || 10 })
    ]);

    const total = parseFloat(summary.total_balance) || 0;
    const overdueTotal = parseFloat(summary.age_1_30) + parseFloat(summary.age_31_60)
        + parseFloat(summary.age_61_90) + parseFloat(summary.age_90_plus);
    const overduePct = total > 0 ? parseFloat(((overdueTotal / total) * 100).toFixed(1)) : 0;

    return {
        detail,
        summary: {
            ...summary,
            total_balance: total,
            overdue_total: parseFloat(overdueTotal.toFixed(2)),
            overdue_pct: overduePct,
            age_current: parseFloat(summary.age_current) || 0,
            age_1_30: parseFloat(summary.age_1_30) || 0,
            age_31_60: parseFloat(summary.age_31_60) || 0,
            age_61_90: parseFloat(summary.age_61_90) || 0,
            age_90_plus: parseFloat(summary.age_90_plus) || 0
        },
        top_creditors: topDelinquent
    };
}

/**
 * Aging bucket labels for charts.
 * @returns {string[]}
 */
function getBucketLabels() {
    return ['Current', '1-30', '31-60', '61-90', '90+'];
}

module.exports = {
    getARAging,
    getAPAging,
    getBucketLabels
};
