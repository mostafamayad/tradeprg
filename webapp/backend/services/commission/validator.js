function validateCollectionForCommission(collection) {
    const errors = [];
    if (!collection) { errors.push('Collection not found'); return errors; }
    if (!collection.id) errors.push('Collection ID is required');
    if (!collection.customer_id) errors.push('Customer ID is required');
    if (!collection.rep_id) errors.push('Rep ID is required — collection must be linked to a rep');
    if (!collection.amount || collection.amount <= 0) errors.push('Collection amount must be greater than 0');
    return errors;
}

function validateReturnForCommission(returnData) {
    const errors = [];
    if (!returnData) errors.push('Return not found');
    if (!returnData.invoice_id) errors.push('Return must be linked to an invoice');
    if (!returnData.grand_total || returnData.grand_total <= 0) errors.push('Return amount must be greater than 0');
    return errors;
}

function validateAdjustment(data) {
    const errors = [];
    if (!data.reason || data.reason.trim() === '') errors.push('Reason is required for adjustments');
    if (!data.approved_by) errors.push('Approval is required for adjustments');
    if (!data.amount || data.amount === 0) errors.push('Amount cannot be zero');
    if (!['bonus', 'penalty', 'manual', 'clawback'].includes(data.type)) errors.push('Invalid adjustment type');
    return errors;
}

function validatePeriodOpen(periodStatus) {
    return !periodStatus || periodStatus.status === 0;
}

function validateNotLocked(workflowStatus) {
    return workflowStatus < 3;
}

module.exports = {
    validateCollectionForCommission,
    validateReturnForCommission,
    validateAdjustment,
    validatePeriodOpen,
    validateNotLocked
};
