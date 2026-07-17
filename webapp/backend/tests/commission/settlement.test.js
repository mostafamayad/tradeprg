const Suite = require('../lib/runner');

module.exports = async function () {
    const s = new Suite('Commission — Settlement Engine (Unit Tests)');

    const settlementEngine = require('../../services/commission/settlementEngine');
    const repo = require('../../repositories/commissionRepository');

    const orig = {
        getPeriodStatus: repo.getPeriodStatus,
        getTransactionsByPeriod: repo.getTransactionsByPeriod,
        updateTransactionStatus: repo.updateTransactionStatus,
        closePeriod: repo.closePeriod,
        openPeriod: repo.openPeriod,
        logAudit: repo.logAudit,
        getTransactionsByIds: repo.getTransactionsByIds,
        createVoucher: repo.createVoucher,
        createVoucherLine: repo.createVoucherLine,
        bulkUpdateStatus: repo.bulkUpdateStatus,
        getNextVoucherNo: repo.getNextVoucherNo,
        updateVoucherStatus: repo.updateVoucherStatus,
    };

    let auditLog = [];
    let lockedPeriods = [];

    const mockRepo = {
        getPeriodStatus: async (period, companyId) => {
            if (lockedPeriods.includes(period)) return { status: 1 };
            return null;
        },
        getTransactionsByPeriod: async (period, companyId) => {
            if (lockedPeriods.includes(period)) {
                return [
                    { id: 104, workflow_status: 3, commission_amount: 80, period, company_id: null, rep_id: 4 },
                    { id: 105, workflow_status: 3, commission_amount: 60, period, company_id: null, rep_id: 5 },
                    { id: 106, workflow_status: 3, commission_amount: 90, period, company_id: null, rep_id: 4 },
                ];
            }
            return [
                { id: 101, workflow_status: 0, commission_amount: 75, period, company_id: null, rep_id: 4 },
                { id: 102, workflow_status: 1, commission_amount: 50, period, company_id: null, rep_id: 4 },
                { id: 103, workflow_status: 2, commission_amount: 100, period, company_id: null, rep_id: 4 },
            ];
        },
        updateTransactionStatus: async () => {},
        closePeriod: async (period) => { lockedPeriods.push(period); },
        openPeriod: async (period) => { lockedPeriods = lockedPeriods.filter(p => p !== period); },
        logAudit: async (...args) => { auditLog.push(args); },
        getTransactionsByIds: async (ids) => {
            const txs = [
                { id: 101, commission_amount: 75, period: '2026-07' },
                { id: 102, commission_amount: 50, period: '2026-07' },
                { id: 103, commission_amount: 100, period: '2026-07' },
            ];
            return txs.filter(t => ids.includes(t.id));
        },
        createVoucher: async () => 1,
        createVoucherLine: async () => {},
        bulkUpdateStatus: async () => {},
        getNextVoucherNo: async () => 'VCH-001',
        updateVoucherStatus: async () => {},
    };

    Object.assign(repo, mockRepo);

    await s.run([
        {
            name: 'lockPeriod: locks 3 transactions with status < 3',
            fn: async () => {
                auditLog = [];
                lockedPeriods = [];
                const result = await settlementEngine.lockPeriod('2026-07', 1);
                if (result.locked !== 3) throw new Error('Expected 3 locked, got ' + result.locked);
                if (result.period !== '2026-07') throw new Error('Wrong period');
                if (auditLog.length < 3) throw new Error('Expected audit logs');
                if (!lockedPeriods.includes('2026-07')) throw new Error('Period should be locked');
            }
        },
        {
            name: 'lockPeriod: period already locked → throws',
            fn: async () => {
                try {
                    await settlementEngine.lockPeriod('2026-07', 1);
                    throw new Error('Should have thrown');
                } catch (e) {
                    if (e.message.includes('Should have thrown')) throw e;
                    if (!e.message.includes('already locked')) throw new Error('Wrong error: ' + e.message);
                }
            }
        },
        {
            name: 'approveTransactions: marks transactions as approved',
            fn: async () => {
                auditLog = [];
                const result = await settlementEngine.approveTransactions([101, 102], 1, null);
                if (result.approved !== 2) throw new Error('Expected 2 approved, got ' + result.approved);
                if (auditLog.length < 2) throw new Error('Expected audit logs');
            }
        },
        {
            name: 'settleTransactions: marks transactions as settled',
            fn: async () => {
                auditLog = [];
                const result = await settlementEngine.settleTransactions([101], 1, null);
                if (result.settled !== 1) throw new Error('Expected 1 settled, got ' + result.settled);
            }
        },
        {
            name: 'createPaymentVoucher: creates voucher with lines',
            fn: async () => {
                auditLog = [];
                const result = await settlementEngine.createPaymentVoucher(4, [101, 102], 1, null);
                if (!result.voucherId) throw new Error('Missing voucherId');
                if (result.voucherNo !== 'VCH-001') throw new Error('Wrong voucherNo');
                if (result.totalAmount !== 125) throw new Error('Wrong total: ' + result.totalAmount);
            }
        },
        {
            name: 'createPaymentVoucher: no transactions → throws',
            fn: async () => {
                orig.getTransactionsByIds = repo.getTransactionsByIds;
                repo.getTransactionsByIds = async () => [];
                try {
                    await settlementEngine.createPaymentVoucher(4, [999], 1, null);
                    throw new Error('Should have thrown');
                } catch (e) {
                    if (e.message.includes('Should have thrown')) throw e;
                    if (!e.message.includes('No transactions')) throw new Error('Wrong error: ' + e.message);
                }
                repo.getTransactionsByIds = orig.getTransactionsByIds;
            }
        },
        {
            name: 'unlockPeriod: unlocks a locked period',
            fn: async () => {
                lockedPeriods = ['2026-07'];
                auditLog = [];
                const result = await settlementEngine.unlockPeriod('2026-07', 1);
                if (result.unlocked !== 3) throw new Error('Expected 3 unlocked, got ' + result.unlocked);
                if (lockedPeriods.includes('2026-07')) throw new Error('Period should be unlocked');
            }
        },
        {
            name: 'unlockPeriod: period not locked → throws',
            fn: async () => {
                lockedPeriods = [];
                try {
                    await settlementEngine.unlockPeriod('2026-05', 1);
                    throw new Error('Should have thrown');
                } catch (e) {
                    if (e.message.includes('Should have thrown')) throw e;
                    if (!e.message.includes('not locked')) throw new Error('Wrong error: ' + e.message);
                }
            }
        },
    ]);

    Object.assign(repo, orig);

    return s;
};
