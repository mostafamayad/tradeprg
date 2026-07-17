const repo = require('../../repositories/commissionRepository');
const snapshotBuilder = require('./snapshotBuilder');
const validator = require('./validator');

async function createClawback(originalTx, returnAmount) {
    const clawbackAmount = -(returnAmount * originalTx.effective_rate / 100);

    const snapshot = snapshotBuilder.buildClawbackSnapshot({
        originalTx,
        returnAmount
    });

    const now = new Date();
    const period = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    const adjustmentId = await repo.createAdjustment({
        company_id: originalTx.company_id,
        rep_id: originalTx.rep_id,
        period,
        type: 'clawback',
        amount: clawbackAmount,
        reason: `Clawback: Return on invoice ${originalTx.invoice_no || 'N/A'}, original commission ${originalTx.commission_amount}`,
        reference_type: 'commission_transaction',
        reference_id: originalTx.id,
        created_by: null
    });

    await repo.logAudit(
        originalTx.company_id,
        'commission_adjustment',
        adjustmentId,
        'created',
        null,
        { type: 'clawback', amount: clawbackAmount, original_tx_id: originalTx.id },
        null
    );

    return { adjustmentId, amount: clawbackAmount };
}

async function createManualAdjustment(data) {
    const errors = validator.validateAdjustment(data);
    if (errors.length > 0) {
        throw new Error('Validation failed: ' + errors.join(', '));
    }

    const adjustmentId = await repo.createAdjustment(data);

    await repo.logAudit(
        data.company_id,
        'commission_adjustment',
        adjustmentId,
        'created',
        null,
        { type: data.type, amount: data.amount, reason: data.reason },
        data.created_by
    );

    return adjustmentId;
}

async function approveAdjustment(id, userId) {
    const adjustments = await repo.getAdjustmentsByPeriod(null);
    const adj = adjustments.find(a => a.id === id);
    if (!adj) throw new Error('Adjustment not found');

    await repo.updateAdjustmentStatus(id, 2, userId);
    await repo.logAudit(adj.company_id, 'commission_adjustment', id, 'approved', { workflow_status: adj.workflow_status }, { workflow_status: 2 }, userId);
}

module.exports = { createClawback, createManualAdjustment, approveAdjustment };
