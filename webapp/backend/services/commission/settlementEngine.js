const repo = require('../../repositories/commissionRepository');

async function lockPeriod(period, userId, companyId = null) {
    const periodStatus = await repo.getPeriodStatus(period, companyId);
    if (periodStatus && periodStatus.status === 1) {
        throw new Error('Period ' + period + ' is already locked');
    }

    const transactions = await repo.getTransactionsByPeriod(period, companyId);
    const unlocked = transactions.filter(t => t.workflow_status < 3);

    for (const tx of unlocked) {
        await repo.updateTransactionStatus(tx.id, 3, null, 'lock');
        await repo.logAudit(tx.company_id, 'commission_transaction', tx.id, 'locked', { workflow_status: tx.workflow_status }, { workflow_status: 3 }, userId);
    }

    await repo.closePeriod(period, userId, companyId);

    await repo.logAudit(companyId, 'commission_period', 0, 'locked', { period, status: 0 }, { period, status: 1 }, userId);

    return { locked: unlocked.length, period };
}

async function unlockPeriod(period, userId, companyId = null) {
    const periodStatus = await repo.getPeriodStatus(period, companyId);
    if (!periodStatus || periodStatus.status === 0) {
        throw new Error('Period ' + period + ' is not locked');
    }

    const transactions = await repo.getTransactionsByPeriod(period, companyId);
    const locked = transactions.filter(t => t.workflow_status === 3);

    for (const tx of locked) {
        await repo.logAudit(tx.company_id, 'commission_transaction', tx.id, 'unlocked', { workflow_status: 3 }, { workflow_status: 2 }, userId);
    }

    await repo.openPeriod(period, companyId);
    await repo.logAudit(companyId, 'commission_period', 0, 'unlocked', { period, status: 1 }, { period, status: 0 }, userId);

    return { unlocked: locked.length, period };
}

async function approveTransactions(ids, userId, companyId = null) {
    await repo.bulkUpdateStatus(ids, 2, userId);
    for (const id of ids) {
        await repo.logAudit(companyId, 'commission_transaction', id, 'approved', { workflow_status: 1 }, { workflow_status: 2 }, userId);
    }
    return { approved: ids.length };
}

async function settleTransactions(ids, userId, companyId = null) {
    await repo.bulkUpdateStatus(ids, 3, userId);
    for (const id of ids) {
        await repo.logAudit(companyId, 'commission_transaction', id, 'settled', { workflow_status: 2 }, { workflow_status: 3 }, userId);
    }
    return { settled: ids.length };
}

async function createPaymentVoucher(repId, transactionIds, userId, companyId = null) {
    const voucherNo = await repo.getNextVoucherNo();
    const transactions = await repo.getTransactionsByIds(transactionIds);

    if (transactions.length === 0) throw new Error('No transactions found');

    const totalAmount = transactions.reduce((sum, t) => sum + (t.commission_amount || 0), 0);
    const now = new Date();
    const voucherDate = now.toISOString().split('T')[0];

    const voucherId = await repo.createVoucher({
        company_id: companyId,
        voucher_no: voucherNo,
        voucher_date: voucherDate,
        rep_id: repId,
        period: transactions[0].period,
        total_amount: totalAmount,
        created_by: userId
    });

    for (const tx of transactions) {
        await repo.createVoucherLine(voucherId, tx.id, tx.commission_amount);
    }

    await repo.logAudit(companyId, 'commission_voucher', voucherId, 'created', null, { voucher_no: voucherNo, total: totalAmount }, userId);

    return { voucherId, voucherNo, totalAmount };
}

async function approveVoucher(id, userId) {
    await repo.updateVoucherStatus(id, 2, userId);
    await repo.logAudit(null, 'commission_voucher', id, 'approved', { workflow_status: 0 }, { workflow_status: 2 }, userId);
}

async function payVoucher(id, userId) {
    await repo.updateVoucherStatus(id, 3, userId);
    await repo.logAudit(null, 'commission_voucher', id, 'paid', { workflow_status: 2 }, { workflow_status: 3 }, userId);
}

async function getSettlementBatch(period, companyId = null) {
    const summary = await repo.getCommissionSummary(period, companyId);
    return summary;
}

async function getRepLedger(repId, period, companyId = null) {
    return await repo.getRepLedger(repId, period, companyId);
}

module.exports = {
    lockPeriod,
    unlockPeriod,
    approveTransactions,
    settleTransactions,
    createPaymentVoucher,
    approveVoucher,
    payVoucher,
    getSettlementBatch,
    getRepLedger
};
