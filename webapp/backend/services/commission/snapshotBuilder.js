const SCHEMA_VERSION = '1.0';
const CALCULATION_VERSION = '1.0';

function buildSnapshot({ rep, collection, allocation, plan, tier, achievementPct, effectiveRate, commissionAmount }) {
    return JSON.stringify({
        schema_version: SCHEMA_VERSION,
        calculation_version: CALCULATION_VERSION,
        rep_id: rep.id,
        rep_name: rep.rep_name,
        rep_code: rep.rep_code,
        customer_id: collection.customer_id,
        customer_name: allocation.customer_name || null,
        invoice_id: allocation.invoice_id,
        invoice_no: allocation.invoice_no || null,
        invoice_date: allocation.invoice_date || null,
        collection_id: collection.id,
        collection_no: collection.collection_no || null,
        collection_date: collection.collection_date,
        collection_amount: allocation.amount || collection.amount,
        plan_id: plan.id,
        plan_name: plan.plan_name,
        base_rate: plan.base_rate,
        target_amount: rep.target_amount || 0,
        achievement_pct: achievementPct,
        tier_id: tier ? tier.id : null,
        tier_label: tier ? tier.tier_label : 'Flat',
        tier_multiplier: tier ? tier.multiplier : 1.0,
        effective_rate: effectiveRate,
        commission_amount: commissionAmount,
        formula: `${allocation.amount || collection.amount} × ${plan.base_rate}% × ${tier ? tier.multiplier + ' (tier)' : '1.0'} = ${commissionAmount}`,
        calculated_at: new Date().toISOString(),
        engine_version: CALCULATION_VERSION
    });
}

function buildClawbackSnapshot({ originalTx, returnAmount }) {
    return JSON.stringify({
        schema_version: SCHEMA_VERSION,
        calculation_version: CALCULATION_VERSION,
        type: 'clawback',
        original_transaction_id: originalTx.id,
        original_commission: originalTx.commission_amount,
        return_amount: returnAmount,
        effective_rate: originalTx.effective_rate,
        clawback_amount: -(returnAmount * originalTx.effective_rate / 100),
        formula: `Clawback: ${returnAmount} × ${originalTx.effective_rate}% = ${-(returnAmount * originalTx.effective_rate / 100)}`,
        calculated_at: new Date().toISOString(),
        engine_version: CALCULATION_VERSION
    });
}

module.exports = { buildSnapshot, buildClawbackSnapshot, SCHEMA_VERSION, CALCULATION_VERSION };
