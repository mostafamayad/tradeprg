const repo = require('../repositories/profitabilityRepository');

/**
 * Aggregated Profitability Dashboard — single endpoint payload.
 * 4 levels: Company, Branch, Sales Rep, Product.
 * @param {Object} [opts]
 * @param {string} [opts.from]
 * @param {string} [opts.to]
 */
async function getProfitabilityDashboard(opts = {}) {
    const from = opts.from || '2026-01-01';
    const to = opts.to || '2026-12-31';

    const [
        company,
        monthlyTrend,
        byBranch,
        byRep,
        byProduct,
        topCustomers,
        topProducts,
        byCategory,
        topReps
    ] = await Promise.all([
        repo.getCompanyProfitability(from, to),
        repo.getMonthlyProfitTrend(),
        repo.getProfitByBranch(from, to),
        repo.getProfitBySalesRep(from, to),
        repo.getProfitByProduct(from, to),
        repo.getTopCustomersByProfit(from, to),
        repo.getTopProductsByProfit(from, to),
        repo.getProfitByCategory(from, to),
        repo.getTopSalesRepsByProfit(from, to)
    ]);

    // ── Company KPIs ──────────────────────────────────────
    const revenue = parseFloat(company.total_revenue) || 0;
    const cogs = parseFloat(company.total_cogs) || 0;
    const grossProfit = parseFloat((revenue - cogs).toFixed(2));
    const grossMargin = revenue > 0 ? parseFloat(((grossProfit / revenue) * 100).toFixed(1)) : 0;
    const netMargin = revenue > 0 ? parseFloat(((grossProfit / revenue) * 100).toFixed(1)) : 0;

    // ── Per-level KPIs ────────────────────────────────────
    const branchKPIs = byBranch.map(b => ({
        store_name: b.store_name,
        revenue: parseFloat(b.revenue),
        cogs: parseFloat(b.cogs),
        profit: parseFloat((parseFloat(b.revenue) - parseFloat(b.cogs)).toFixed(2)),
        margin: parseFloat(b.revenue) > 0
            ? parseFloat((((parseFloat(b.revenue) - parseFloat(b.cogs)) / parseFloat(b.revenue)) * 100).toFixed(1))
            : 0,
        invoice_count: parseInt(b.invoice_count)
    }));

    const repKPIs = byRep.map(r => ({
        rep_name: r.rep_name,
        region: r.region,
        revenue: parseFloat(r.revenue),
        cogs: parseFloat(r.cogs),
        profit: parseFloat((parseFloat(r.revenue) - parseFloat(r.cogs)).toFixed(2)),
        margin: parseFloat(r.revenue) > 0
            ? parseFloat((((parseFloat(r.revenue) - parseFloat(r.cogs)) / parseFloat(r.revenue)) * 100).toFixed(1))
            : 0,
        invoice_count: parseInt(r.invoice_count)
    }));

    const productKPIs = byProduct.map(p => ({
        product_name: p.product_name,
        category: p.category_name,
        revenue: parseFloat(p.revenue),
        cogs: parseFloat(p.cogs),
        profit: parseFloat((parseFloat(p.revenue) - parseFloat(p.cogs)).toFixed(2)),
        margin: parseFloat(p.revenue) > 0
            ? parseFloat((((parseFloat(p.revenue) - parseFloat(p.cogs)) / parseFloat(p.revenue)) * 100).toFixed(1))
            : 0,
        qty_sold: parseInt(p.qty_sold)
    }));

    // ── Top 10 lists ──────────────────────────────────────
    const top10Customers = topCustomers.map(c => ({
        customer_name: c.customer_name,
        region: c.region,
        revenue: parseFloat(c.revenue),
        cogs: parseFloat(c.cogs),
        profit: parseFloat((parseFloat(c.revenue) - parseFloat(c.cogs)).toFixed(2)),
        margin: parseFloat(c.revenue) > 0
            ? parseFloat((((parseFloat(c.revenue) - parseFloat(c.cogs)) / parseFloat(c.revenue)) * 100).toFixed(1))
            : 0
    }));

    const top10Products = topProducts.map(p => ({
        product_name: p.product_name,
        revenue: parseFloat(p.revenue),
        cogs: parseFloat(p.cogs),
        profit: parseFloat((parseFloat(p.revenue) - parseFloat(p.cogs)).toFixed(2)),
        margin: parseFloat(p.revenue) > 0
            ? parseFloat((((parseFloat(p.revenue) - parseFloat(p.cogs)) / parseFloat(p.revenue)) * 100).toFixed(1))
            : 0,
        qty_sold: parseInt(p.qty_sold)
    }));

    const top10Reps = topReps.map(r => ({
        rep_name: r.rep_name,
        region: r.region,
        revenue: parseFloat(r.revenue),
        cogs: parseFloat(r.cogs),
        profit: parseFloat((parseFloat(r.revenue) - parseFloat(r.cogs)).toFixed(2)),
        margin: parseFloat(r.revenue) > 0
            ? parseFloat((((parseFloat(r.revenue) - parseFloat(r.cogs)) / parseFloat(r.revenue)) * 100).toFixed(1))
            : 0,
        commission_rate: parseFloat(r.commission_rate) || 0
    }));

    // ── Category breakdown ────────────────────────────────
    const categoryKPIs = byCategory.map(c => ({
        category: c.category_name,
        revenue: parseFloat(c.revenue),
        cogs: parseFloat(c.cogs),
        profit: parseFloat((parseFloat(c.revenue) - parseFloat(c.cogs)).toFixed(2)),
        margin: parseFloat(c.revenue) > 0
            ? parseFloat((((parseFloat(c.revenue) - parseFloat(c.cogs)) / parseFloat(c.revenue)) * 100).toFixed(1))
            : 0
    }));

    // ── Monthly trend with profit ─────────────────────────
    const trend = monthlyTrend.map(m => ({
        month: m.month,
        revenue: parseFloat(m.revenue),
        cogs: parseFloat(m.cogs),
        profit: parseFloat((parseFloat(m.revenue) - parseFloat(m.cogs)).toFixed(2)),
        margin: parseFloat(m.revenue) > 0
            ? parseFloat((((parseFloat(m.revenue) - parseFloat(m.cogs)) / parseFloat(m.revenue)) * 100).toFixed(1))
            : 0
    }));

    return {
        company: {
            revenue,
            cogs,
            gross_profit: grossProfit,
            gross_margin: grossMargin,
            net_margin: netMargin,
            invoice_count: parseInt(company.invoice_count)
        },
        kpis: {
            revenue,
            cogs,
            gross_profit: grossProfit,
            gross_margin: grossMargin,
            net_margin: netMargin,
            avg_profit_per_invoice: parseInt(company.invoice_count) > 0
                ? parseFloat((grossProfit / parseInt(company.invoice_count)).toFixed(2))
                : 0
        },
        levels: {
            branch: branchKPIs,
            sales_rep: repKPIs,
            product: productKPIs,
            category: categoryKPIs
        },
        charts: {
            profit_trend: trend,
            margin_by_branch: branchKPIs.map(b => ({
                name: b.store_name,
                margin: b.margin,
                profit: b.profit
            })),
            profit_by_rep: repKPIs.map(r => ({
                name: r.rep_name,
                profit: r.profit,
                margin: r.margin
            })),
            profit_by_category: categoryKPIs.map(c => ({
                category: c.category,
                profit: c.profit,
                margin: c.margin
            })),
            pareto_80_20: productKPIs.slice(0, 20).map((p, i) => ({
                rank: i + 1,
                product: p.product_name,
                profit: p.profit,
                cumulative_pct: 0
            }))
        },
        top10: {
            customers: top10Customers,
            products: top10Products,
            sales_reps: top10Reps
        }
    };
}

module.exports = { getProfitabilityDashboard };
