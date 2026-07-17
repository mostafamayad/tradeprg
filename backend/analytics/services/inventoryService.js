const repo = require('../repositories/inventoryRepository');
const path = require('path');
const fs = require('fs');

let _healthConfig = null;
function getHealthConfig() {
    if (_healthConfig) return _healthConfig;
    try {
        _healthConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/healthScore.json'), 'utf8'));
    } catch (e) {
        _healthConfig = {
            negativeStockWeight: 25, deadStockWeight: 15, lowStockWeight: 20,
            healthyTurnoverBonus: 15, balancedAbcBonus: 20, damagedStockWeight: 10,
            noOverstockBonus: 25, targetTurnoverMin: 3,
            targetAbcRatioMin: 0.3, targetAbcRatioMax: 0.7,
            deadStockPctPenaltyFactor: 0.3, lowStockPctPenaltyFactor: 0.4,
            damagedPctPenaltyFactor: 0.2, negativePerItemPenalty: 5
        };
    }
    return _healthConfig;
}

/**
 * Compute ABC classes from sorted value array.
 * A=70%, B=20%, C=10%
 */
function classifyABC(items) {
    if (!items || items.length === 0) return { a: [], b: [], c: [] };
    const total = items.reduce((s, r) => s + parseFloat(r.total_value || 0), 0);
    if (total === 0) return { a: [], b: [], c: [] };
    let cum = 0;
    const a = [], b = [], c = [];
    items.forEach(r => {
        const pct = cum / total;
        if (pct < 0.7) { a.push(r); cum += parseFloat(r.total_value); }
        else if (pct < 0.9) { b.push(r); cum += parseFloat(r.total_value); }
        else { c.push(r); }
    });
    return { a, b, c };
}

/**
 * XYZ from CV: X < 0.5, Y 0.5-1.0, Z > 1.0
 */
function classifyXYZ(items) {
    if (!items) return { x: [], y: [], z: [] };
    const x = [], y = [], z = [];
    items.forEach(r => {
        const cv = parseFloat(r.cv || 999);
        if (cv < 0.5) x.push(r);
        else if (cv <= 1.0) y.push(r);
        else z.push(r);
    });
    return { x, y, z };
}

/**
 * Inventory Health Score (0-100).
 */
function computeHealthScore({
    hasNegativeStock, negativeCount,
    deadStockValue, totalInventoryValue,
    lowStockCount, totalProducts,
    turnoverRatio,
    abcBalance,
    damagedValue
}) {
    const cfg = getHealthConfig();
    let score = 100;
    if (hasNegativeStock) score -= Math.min(cfg.negativeStockWeight, negativeCount * cfg.negativePerItemPenalty);
    if (totalInventoryValue > 0) {
        const deadPct = deadStockValue / totalInventoryValue;
        score -= Math.min(cfg.deadStockWeight, deadPct * 100 * cfg.deadStockPctPenaltyFactor);
    }
    if (totalProducts > 0) {
        const lowPct = lowStockCount / totalProducts;
        score -= Math.min(cfg.lowStockWeight, lowPct * 100 * cfg.lowStockPctPenaltyFactor);
    }
    if (turnoverRatio > 0 && turnoverRatio < 1) score -= 5;
    else if (turnoverRatio >= cfg.targetTurnoverMin) score += cfg.healthyTurnoverBonus;
    if (abcBalance > cfg.targetAbcRatioMin && abcBalance < cfg.targetAbcRatioMax) score += cfg.balancedAbcBonus;
    else if (abcBalance >= cfg.targetAbcRatioMax) score += Math.round(cfg.balancedAbcBonus / 2);
    if (damagedValue > 0) {
        const dmgPct = damagedValue / (totalInventoryValue || 1);
        score -= Math.min(cfg.damagedStockWeight, dmgPct * 100 * cfg.damagedPctPenaltyFactor);
    }
    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Aggregated Inventory Dashboard — single endpoint payload.
 * @param {Object} [opts]
 * @param {string} [opts.from]
 * @param {string} [opts.to]
 * @param {number} [opts.deadDays]
 * @param {number} [opts.trendMonths]
 * @param {number} [opts.xyzMonths]
 * @param {number} [opts.topLimit]
 */
async function getInventoryDashboard(opts = {}) {
    const from = opts.from || '2026-01-01';
    const to = opts.to || '2026-12-31';
    const deadDays = parseInt(opts.deadDays) || 90;
    const trendMonths = parseInt(opts.trendMonths) || 12;
    const xyzMonths = parseInt(opts.xyzMonths) || 6;
    const topLimit = parseInt(opts.topLimit) || 20;

    const [
        inventoryValue,
        stockMovements,
        turnover,
        deadStock,
        fastMoving,
        slowMoving,
        reorderSuggestions,
        negativeStock,
        warehouseSummary,
        abcItems,
        xyzItems,
        valueTrend,
        damagedStock
    ] = await Promise.all([
        repo.getInventoryValue(),
        repo.getStockMovement(from, to),
        repo.getInventoryTurnover(from, to),
        repo.getDeadStock(deadDays),
        repo.getFastMoving(topLimit, from, to),
        repo.getSlowMoving(topLimit, from, to),
        repo.getReorderSuggestions(),
        repo.getNegativeStock(),
        repo.getWarehouseSummary(),
        repo.getABCAnalysis(),
        repo.getXYZAnalysis(xyzMonths),
        repo.getInventoryValueTrend(trendMonths),
        repo.getDamagedStock()
    ]);

    // ── KPIs ──────────────────────────────────────────────
    const totalQty = inventoryValue.reduce((s, r) => s + parseFloat(r.quantity || 0), 0);
    const totalCostValue = inventoryValue.reduce((s, r) => s + parseFloat(r.cost_value || 0), 0);
    const totalSellValue = inventoryValue.reduce((s, r) => s + parseFloat(r.sell_value || 0), 0);
    const damagedQty = damagedStock.reduce((s, r) => s + parseFloat(r.total_damaged_qty || 0), 0);
    const damagedValue = damagedStock.reduce((s, r) => s + parseFloat(r.total_damaged_value || 0), 0);
    const negativeCount = negativeStock.length;
    const hasNegative = negativeCount > 0;
    const lowStockCount = reorderSuggestions.length;
    const totalProducts = inventoryValue.length + negativeCount;

    const cogs = parseFloat(turnover.cogs) || 0;
    const avgInv = parseFloat(turnover.avg_inventory_value) || 1;
    const turnoverRatio = avgInv > 0 ? parseFloat((cogs / avgInv).toFixed(2)) : 0;
    const daysOnHand = turnoverRatio > 0 ? Math.round(365 / turnoverRatio) : 0;

    const deadStockValue = deadStock.reduce((s, r) => s + parseFloat(r.total_value || 0), 0);
    const deadPct = totalCostValue > 0 ? parseFloat(((deadStockValue / totalCostValue) * 100).toFixed(1)) : 0;

    // ── ABC Analysis ──────────────────────────────────────
    const abc = classifyABC(abcItems);
    const abcCoverage = totalCostValue > 0
        ? parseFloat(((abc.a.reduce((s, r) => s + parseFloat(r.total_value || 0), 0) / totalCostValue) * 100).toFixed(1))
        : 0;

    // ── XYZ Analysis ──────────────────────────────────────
    const xyz = classifyXYZ(xyzItems);

    // ── Health Score ──────────────────────────────────────
    const abcBalance = abc.a.length / (abcItems.length || 1);
    const healthScore = computeHealthScore({
        hasNegativeStock: hasNegative,
        negativeCount,
        deadStockValue,
        totalInventoryValue: totalCostValue,
        lowStockCount,
        totalProducts,
        turnoverRatio,
        abcBalance,
        damagedValue
    });

    // ── Alerts ────────────────────────────────────────────
    const alerts = {
        negative_stock: negativeStock.map(r => ({
            product_name: r.product_name,
            quantity: parseFloat(r.quantity),
            store_name: r.store_name,
            value: parseFloat(r.negative_value)
        })),
        low_stock: reorderSuggestions.map(r => ({
            product_name: r.product_name,
            current: parseFloat(r.current_quantity),
            min: parseFloat(r.min_stock || 0),
            max: parseFloat(r.max_stock || 0),
            suggested_order: parseFloat(r.suggested_order_qty || 0)
        })),
        dead_stock: deadStock.map(r => ({
            product_name: r.product_name,
            quantity: parseFloat(r.quantity),
            value: parseFloat(r.total_value),
            days_inactive: r.days_since_last_movement
        }))
    };

    return {
        kpis: {
            inventory_value: parseFloat(totalCostValue.toFixed(2)),
            sell_value: parseFloat(totalSellValue.toFixed(2)),
            available_qty: totalQty,
            reserved_qty: 0,
            damaged_qty: damagedQty,
            damaged_value: parseFloat(damagedValue.toFixed(2)),
            negative_count: negativeCount,
            low_stock_count: lowStockCount,
            turnover_ratio: turnoverRatio,
            days_on_hand: daysOnHand,
            dead_stock_pct: deadPct,
            fast_moving_count: fastMoving.length,
            slow_moving_count: slowMoving.length,
            abc_coverage: abcCoverage,
            product_count: totalProducts
        },
        health_score: healthScore,
        abc: {
            a_count: abc.a.length,
            b_count: abc.b.length,
            c_count: abc.c.length,
            a_value: parseFloat(abc.a.reduce((s, r) => s + parseFloat(r.total_value || 0), 0).toFixed(2)),
            b_value: parseFloat(abc.b.reduce((s, r) => s + parseFloat(r.total_value || 0), 0).toFixed(2)),
            c_value: parseFloat(abc.c.reduce((s, r) => s + parseFloat(r.total_value || 0), 0).toFixed(2)),
            items: abcItems.map(r => ({
                product_name: r.product_name,
                value: parseFloat(r.total_value || 0)
            }))
        },
        xyz: {
            x_count: xyz.x.length,
            y_count: xyz.y.length,
            z_count: xyz.z.length,
            items: {
                x: xyz.x.slice(0, 10),
                y: xyz.y.slice(0, 10),
                z: xyz.z.slice(0, 10)
            }
        },
        charts: {
            value_trend: valueTrend,
            stock_movement: {
                in: stockMovements.filter(m => parseFloat(m.qty_in) > 0).reduce((s, r) => s + parseFloat(r.qty_in), 0),
                out: stockMovements.filter(m => parseFloat(m.qty_out) > 0).reduce((s, r) => s + parseFloat(r.qty_out), 0),
                transfer: stockMovements.filter(m => m.move_type === 'transfer').length,
                disposal: stockMovements.filter(m => m.move_type === 'disposal').length,
                adjustment: stockMovements.filter(m => m.move_type === 'cancellation' || m.move_type === 'adjustment').length,
                records: stockMovements.slice(0, 100)
            },
            abc_pie: {
                a: parseFloat(abc.a.reduce((s, r) => s + parseFloat(r.total_value || 0), 0).toFixed(2)),
                b: parseFloat(abc.b.reduce((s, r) => s + parseFloat(r.total_value || 0), 0).toFixed(2)),
                c: parseFloat(abc.c.reduce((s, r) => s + parseFloat(r.total_value || 0), 0).toFixed(2))
            },
            dead_stock_top: deadStock.slice(0, topLimit),
            warehouse_comparison: warehouseSummary.map(w => ({
                name: w.store_name,
                value: parseFloat(w.total_cost_value || 0),
                qty: parseFloat(w.total_quantity || 0),
                count: parseInt(w.product_count || 0)
            })),
            fast_moving: fastMoving.slice(0, 10),
            slow_moving: slowMoving.slice(0, 10)
        },
        warehouses: warehouseSummary,
        alerts,
        summaries: {
            reorder_suggestions: reorderSuggestions,
            negative_stock: negativeStock,
            dead_stock: deadStock
        }
    };
}

module.exports = { getInventoryDashboard };
