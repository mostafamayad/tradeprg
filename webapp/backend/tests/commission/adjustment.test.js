const Suite = require('../lib/runner');

module.exports = async function () {
    const s = new Suite('Commission — Adjustment Engine (Unit Tests)');

    const adjustmentEngine = require('../../services/commission/adjustmentEngine');
    const repo = require('../../repositories/commissionRepository');

    const orig = {
        createAdjustment: repo.createAdjustment,
        logAudit: repo.logAudit,
        getAdjustmentsByPeriod: repo.getAdjustmentsByPeriod,
        updateAdjustmentStatus: repo.updateAdjustmentStatus,
    };

    let auditLog = [];

    const mockRepo = {
        createAdjustment: async (data) => 1,
        logAudit: async (...args) => { auditLog.push(args); },
        getAdjustmentsByPeriod: async () => [
            { id: 1, company_id: null, rep_id: 4, type: 'manual', amount: 200, workflow_status: 0, reason: 'Bonus for Q1' },
            { id: 2, company_id: null, rep_id: 5, type: 'clawback', amount: -50, workflow_status: 0, reason: 'Return clawback' },
        ],
        updateAdjustmentStatus: async () => {},
    };

    Object.assign(repo, mockRepo);

    await s.run([
        {
            name: 'createClawback: creates negative adjustment',
            fn: async () => {
                auditLog = [];
                const result = await adjustmentEngine.createClawback(
                    { id: 1, effective_rate: 1.5, commission_amount: 75, invoice_no: 'INV-001', company_id: null, rep_id: 4 },
                    3000
                );
                const expected = -(3000 * 1.5 / 100);
                if (result.amount !== expected) throw new Error('Expected ' + expected + ', got ' + result.amount);
                if (!result.adjustmentId) throw new Error('Missing adjustmentId');
                if (auditLog.length === 0) throw new Error('No audit log');
            }
        },
        {
            name: 'createClawback: full return amount',
            fn: async () => {
                const result = await adjustmentEngine.createClawback(
                    { id: 2, effective_rate: 2.0, commission_amount: 100, invoice_no: 'INV-002', company_id: null, rep_id: 4 },
                    5000
                );
                if (result.amount !== -100) throw new Error('Expected -100, got ' + result.amount);
            }
        },
        {
            name: 'createManualAdjustment: valid data → returns id',
            fn: async () => {
                auditLog = [];
                const id = await adjustmentEngine.createManualAdjustment({
                    company_id: null,
                    rep_id: 4,
                    period: '2026-07',
                    type: 'manual',
                    amount: 200,
                    reason: 'Bonus for Q1',
                    approved_by: 1
                });
                if (id !== 1) throw new Error('Expected id 1, got ' + id);
                if (auditLog.length === 0) throw new Error('No audit log');
            }
        },
        {
            name: 'createManualAdjustment: missing reason → throws',
            fn: async () => {
                try {
                    await adjustmentEngine.createManualAdjustment({
                        company_id: null,
                        rep_id: 4,
                        period: '2026-07',
                        type: 'manual',
                        amount: 200,
                        approved_by: 1
                    });
                    throw new Error('Should have thrown');
                } catch (e) {
                    if (e.message.includes('Should have thrown')) throw e;
                    if (!e.message.toLowerCase().includes('reason') && !e.message.toLowerCase().includes('validation failed')) throw new Error('Wrong error: ' + e.message);
                }
            }
        },
        {
            name: 'createManualAdjustment: invalid type → throws',
            fn: async () => {
                try {
                    await adjustmentEngine.createManualAdjustment({
                        company_id: null,
                        rep_id: 4,
                        period: '2026-07',
                        type: 'invalid',
                        amount: 200,
                        reason: 'test',
                        approved_by: 1
                    });
                    throw new Error('Should have thrown');
                } catch (e) {
                    if (e.message.includes('Should have thrown')) throw e;
                    if (!e.message.includes('type')) throw new Error('Wrong error: ' + e.message);
                }
            }
        },
        {
            name: 'approveAdjustment: marks adjustment as approved',
            fn: async () => {
                auditLog = [];
                await adjustmentEngine.approveAdjustment(1, 1);
                if (auditLog.length === 0) throw new Error('No audit log');
            }
        },
        {
            name: 'approveAdjustment: non-existent adjustment → throws',
            fn: async () => {
                try {
                    await adjustmentEngine.approveAdjustment(999, 1);
                    throw new Error('Should have thrown');
                } catch (e) {
                    if (e.message.includes('Should have thrown')) throw e;
                    if (!e.message.includes('not found')) throw new Error('Wrong error: ' + e.message);
                }
            }
        },
    ]);

    Object.assign(repo, orig);

    return s;
};
