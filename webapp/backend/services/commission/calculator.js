const repo = require('../../repositories/commissionRepository');
const tierEngine = require('./tierEngine');
const snapshotBuilder = require('./snapshotBuilder');
const validator = require('./validator');

async function calculateForCollection(collection) {
    const errors = validator.validateCollectionForCommission(collection);
    if (errors.length > 0) {
        throw new Error('Validation failed: ' + errors.join(', '));
    }

    const rep = await repo.getRepById(collection.rep_id);
    if (!rep) throw new Error('Rep not found: ' + collection.rep_id);

    const planId = rep.plan_id;
    if (!planId) throw new Error('Rep ' + rep.rep_name + ' has no commission plan assigned');

    const plan = await repo.getPlanById(planId);
    if (!plan) throw new Error('Commission plan not found: ' + planId);

    const tiers = await repo.getTiersForPlan(planId);

    const now = new Date();
    const period = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    const periodStatus = await repo.getPeriodStatus(period, collection.company_id);
    if (!validator.validatePeriodOpen(periodStatus)) {
        throw new Error('Commission period ' + period + ' is closed');
    }

    const achievement = await repo.getRepAchievement(rep.id, period);
    const totalNetSales = (achievement.total_sales || 0) - (achievement.total_returns || 0);
    const target = rep.target_amount || plan.base_rate;
    const achievementPct = target > 0 ? Math.round(totalNetSales / target * 100 * 100) / 100 : 0;

    const tier = tierEngine.getEffectiveTier(tiers, achievementPct);
    const effectiveRate = tierEngine.calculateEffectiveRate(plan.base_rate, tier ? tier.multiplier : 1.0);

    const allocations = await repo.getAllocationsForCollection(collection.id);
    const results = [];

    if (allocations && allocations.length > 0) {
        for (const alloc of allocations) {
            const allocAmount = alloc.amount || collection.amount;
            const commissionAmount = tierEngine.calculateCommissionAmount(allocAmount, effectiveRate);

            const snapshot = snapshotBuilder.buildSnapshot({
                rep,
                collection,
                allocation: { ...alloc, customer_name: collection.customer_name },
                plan,
                tier,
                achievementPct,
                effectiveRate,
                commissionAmount
            });

            results.push({
                company_id: collection.company_id || null,
                rep_id: rep.id,
                plan_id: planId,
                collection_id: collection.id,
                collection_amount: allocAmount,
                rep_name: rep.rep_name,
                customer_name: collection.customer_name || null,
                invoice_no: alloc.invoice_no || null,
                collection_no: collection.collection_no || null,
                invoice_date: alloc.invoice_date || null,
                collection_date: collection.collection_date,
                period,
                base_rate: plan.base_rate,
                achievement_pct: achievementPct,
                tier_multiplier: tier ? tier.multiplier : 1.0,
                effective_rate: effectiveRate,
                commission_amount: commissionAmount,
                snapshot,
                notes: null
            });
        }
    } else {
        const commissionAmount = tierEngine.calculateCommissionAmount(collection.amount, effectiveRate);

        const snapshot = snapshotBuilder.buildSnapshot({
            rep,
            collection,
            allocation: { amount: collection.amount, customer_name: collection.customer_name },
            plan,
            tier,
            achievementPct,
            effectiveRate,
            commissionAmount
        });

        results.push({
            company_id: collection.company_id || null,
            rep_id: rep.id,
            plan_id: planId,
            collection_id: collection.id,
            collection_amount: collection.amount,
            rep_name: rep.rep_name,
            customer_name: collection.customer_name || null,
            invoice_no: collection.invoice_no || null,
            collection_no: collection.collection_no || null,
            invoice_date: collection.invoice_date || null,
            collection_date: collection.collection_date,
            period,
            base_rate: plan.base_rate,
            achievement_pct: achievementPct,
            tier_multiplier: tier ? tier.multiplier : 1.0,
            effective_rate: effectiveRate,
            commission_amount: commissionAmount,
            snapshot,
            notes: null
        });
    }

    return results;
}

module.exports = { calculateForCollection };
