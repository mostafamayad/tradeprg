const repo = require('../../repositories/commissionRepository');
const { getPool, sql } = require('../../database/mssql_db');
const { postJournalEntryAsync, getSystemAccountAsync } = require('../accountingEngine');

async function postApprovalJournalEntry(transactions, userId) {
    if (!transactions.length) return null;
    const pool = await getPool();
    const now = new Date().toISOString().split('T')[0];
    const totalAmount = transactions.reduce((s, t) => s + (t.commission_amount || 0), 0);
    if (totalAmount <= 0) return null;
    const period = transactions[0].period;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    const txReq = transaction.request();
    try {
        const expenseId = await getSystemAccountAsync(txReq, 'SYS_COMMISSION_EXPENSE');
        const payableId = await getSystemAccountAsync(txReq, 'SYS_COMMISSION_PAYABLE');

        const jeId = await postJournalEntryAsync(
            txReq, now, `عمولات المندوبين - ${period}`,
            [
                { account_id: expenseId, debit: totalAmount, credit: 0, description: 'مصروف عمولات' },
                { account_id: payableId, debit: 0, credit: totalAmount, description: 'عمولات مستحقة للمندوبين' }
            ],
            'commission', null, userId,
            { module: 'commission', action: 'approve', document: period, isSystem: true }
        );

        for (const t of transactions) {
            await txReq
                .input('txId', sql.Int, t.id).input('jeId', sql.Int, jeId)
                .query(`UPDATE commission_transactions SET is_posted_to_gl = 1, journal_entry_id = @jeId WHERE id = @txId`);
        }

        await transaction.commit();
        return jeId;
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
}

async function postPaymentJournalEntry(voucher, transactions, userId) {
    const pool = await getPool();
    const now = new Date().toISOString().split('T')[0];
    const totalAmount = voucher.total_amount;
    if (totalAmount <= 0) return null;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    const txReq = transaction.request();
    try {
        const payableId = await getSystemAccountAsync(txReq, 'SYS_COMMISSION_PAYABLE');
        const treasuryRes = await txReq.query(`SELECT TOP 1 id FROM treasury_accounts`);
        const treasuryId = treasuryRes.recordset[0] ? treasuryRes.recordset[0].id : null;

        const lines = [
            { account_id: payableId, debit: totalAmount, credit: 0, description: 'صرف عمولات مستحقة' }
        ];
        if (treasuryId) {
            lines.push({ account_id: treasuryId, debit: 0, credit: totalAmount, description: 'دفع عمولات من الخزينة' });
        }

        const jeId = await postJournalEntryAsync(
            txReq, now, `صرف عمولات - ${voucher.voucher_no}`, lines,
            'commission', voucher.id, userId,
            { module: 'commission', action: 'pay', document: voucher.voucher_no, isSystem: true }
        );

        for (const t of transactions) {
            await txReq
                .input('txId', sql.Int, t.id)
                .query(`UPDATE commission_transactions SET is_paid = 1 WHERE id = @txId`);
        }

        await txReq
            .input('jeId', sql.Int, jeId).input('vId', sql.Int, voucher.id)
            .query(`UPDATE commission_payment_vouchers SET journal_entry_id = @jeId WHERE id = @vId`);

        await transaction.commit();
        return jeId;
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
}

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
    const transactions = await repo.getTransactionsByIds(ids);
    const invalid = transactions.filter(t => t.workflow_status > 1);
    if (invalid.length > 0) {
        throw new Error('Some transactions already approved or locked (ids: ' + invalid.map(t => t.id).join(', ') + ')');
    }
    await repo.bulkUpdateStatus(ids, 2, userId);
    for (const id of ids) {
        await repo.logAudit(companyId, 'commission_transaction', id, 'approved', { workflow_status: 1 }, { workflow_status: 2 }, userId);
    }
    return { approved: ids.length };
}

async function postToGL(ids, userId, companyId = null) {
    const transactions = await repo.getTransactionsByIds(ids);
    if (!transactions.length) throw new Error('No transactions found');
    const invalid = transactions.filter(t => t.workflow_status !== 2 || t.is_posted_to_gl);
    if (invalid.length > 0) {
        throw new Error('Some transactions are not approved or already posted (ids: ' + invalid.map(t => t.id).join(', ') + ')');
    }
    const jeId = await postApprovalJournalEntry(transactions, userId);
    for (const id of ids) {
        await repo.logAudit(companyId, 'commission_transaction', id, 'posted_to_gl', { is_posted_to_gl: 0 }, { is_posted_to_gl: 1, journal_entry_id: jeId }, userId);
    }
    return { posted: ids.length, jeId };
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
    const voucher = await repo.getVoucherById(id);
    if (!voucher) throw new Error('Voucher not found');
    const transactions = await repo.getTransactionsByIds(voucher.lines.map(l => l.transaction_id));
    await repo.updateVoucherStatus(id, 3, userId);
    await repo.logAudit(null, 'commission_voucher', id, 'paid', { workflow_status: 2 }, { workflow_status: 3 }, userId);
    let jeId = null;
    try {
        jeId = await postPaymentJournalEntry(voucher, transactions, userId);
    } catch (e) {
        console.error('[Commission] GL posting failed on pay:', e.message);
    }
    return { paid: true, jeId };
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
    postToGL,
    settleTransactions,
    createPaymentVoucher,
    approveVoucher,
    payVoucher,
    getSettlementBatch,
    getRepLedger
};
