const Suite = require('../lib/runner');

module.exports = async function () {
    const s = new Suite('Commission — Validator (Unit Tests)');

    const { validateCollectionForCommission, validateReturnForCommission, validateAdjustment, validatePeriodOpen, validateNotLocked } = require('../../services/commission/validator');

    await s.run([
        {
            name: 'Valid collection → no errors',
            fn: () => {
                const errors = validateCollectionForCommission({ id: 1, customer_id: 1, rep_id: 1, amount: 5000 });
                if (errors.length > 0) throw new Error('Expected 0 errors, got: ' + errors.join(', '));
            }
        },
        {
            name: 'Collection without rep_id → error',
            fn: () => {
                const errors = validateCollectionForCommission({ id: 1, customer_id: 1, amount: 5000 });
                if (errors.length === 0) throw new Error('Expected error for missing rep_id');
            }
        },
        {
            name: 'Collection with 0 amount → error',
            fn: () => {
                const errors = validateCollectionForCommission({ id: 1, customer_id: 1, rep_id: 1, amount: 0 });
                if (errors.length === 0) throw new Error('Expected error for 0 amount');
            }
        },
        {
            name: 'Null collection → error',
            fn: () => {
                const errors = validateCollectionForCommission(null);
                if (errors.length === 0) throw new Error('Expected error for null');
            }
        },
        {
            name: 'Valid return → no errors',
            fn: () => {
                const errors = validateReturnForCommission({ id: 1, invoice_id: 1, grand_total: 3000 });
                if (errors.length > 0) throw new Error('Expected 0 errors, got: ' + errors.join(', '));
            }
        },
        {
            name: 'Return without invoice_id → error',
            fn: () => {
                const errors = validateReturnForCommission({ id: 1, grand_total: 3000 });
                if (errors.length === 0) throw new Error('Expected error for missing invoice_id');
            }
        },
        {
            name: 'Valid adjustment → no errors',
            fn: () => {
                const errors = validateAdjustment({ type: 'bonus', amount: 500, reason: 'Excellent performance', approved_by: 1 });
                if (errors.length > 0) throw new Error('Expected 0 errors, got: ' + errors.join(', '));
            }
        },
        {
            name: 'Adjustment without reason → error',
            fn: () => {
                const errors = validateAdjustment({ type: 'bonus', amount: 500, approved_by: 1 });
                if (errors.length === 0) throw new Error('Expected error for missing reason');
            }
        },
        {
            name: 'Adjustment without approved_by → error',
            fn: () => {
                const errors = validateAdjustment({ type: 'bonus', amount: 500, reason: 'test' });
                if (errors.length === 0) throw new Error('Expected error for missing approved_by');
            }
        },
        {
            name: 'Adjustment with 0 amount → error',
            fn: () => {
                const errors = validateAdjustment({ type: 'manual', amount: 0, reason: 'test', approved_by: 1 });
                if (errors.length === 0) throw new Error('Expected error for 0 amount');
            }
        },
        {
            name: 'Invalid adjustment type → error',
            fn: () => {
                const errors = validateAdjustment({ type: 'invalid', amount: 100, reason: 'test', approved_by: 1 });
                if (errors.length === 0) throw new Error('Expected error for invalid type');
            }
        },
        {
            name: 'Period OPEN (status 0) → valid',
            fn: () => {
                if (!validatePeriodOpen({ status: 0 })) throw new Error('Expected true');
            }
        },
        {
            name: 'Period null (no record = OPEN) → valid',
            fn: () => {
                if (!validatePeriodOpen(null)) throw new Error('Expected true for null period');
            }
        },
        {
            name: 'Period CLOSED (status 1) → invalid',
            fn: () => {
                if (validatePeriodOpen({ status: 1 })) throw new Error('Expected false for closed period');
            }
        },
        {
            name: 'Status 0 (pending) → not locked',
            fn: () => {
                if (!validateNotLocked(0)) throw new Error('Expected true');
            }
        },
        {
            name: 'Status 2 (approved) → not locked',
            fn: () => {
                if (!validateNotLocked(2)) throw new Error('Expected true');
            }
        },
        {
            name: 'Status 3 (locked) → IS locked',
            fn: () => {
                if (validateNotLocked(3)) throw new Error('Expected false for locked');
            }
        },
    ]);

    return s;
};
