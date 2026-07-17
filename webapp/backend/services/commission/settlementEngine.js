const repo = require('../../repositories/commissionRepository');
const { getPool, sql } = require('../../database/mssql_db');

async function postApprovalJournalEntry(transactions, userId) {
    if (!transactions.length) return null;
    const pool = await getPool();
    const now = new Date().toISOString().split('T')[0];
    const totalAmount = transactions.reduce((s, t) => s + (t.commission_amount || 0), 0);
    if (totalAmount <= 0) return null;

    const expenseAcc = await pool.request().query(`SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_COMMISSION_EXPENSE'`);
    const payableAcc = await pool.request().query(`SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_COMMISSION_PAYABLE'`);
    if (!expenseAcc.recordset[0] || !payableAcc.recordset[0]) throw new Error('Commission COA accounts not found (551/221)');

    const expenseId = expenseAcc.recordset[0].id;
    const payableId = payableAcc.recordset[0].id;
    const counterResult = await pool.request().query(`SELECT ISNULL(MAX(CAST(SUBSTRING(entry_no, 3, LEN(entry_no)) AS INT)), 0) + 1 AS next_no FROM journal_entries`);
    const entryNo = 'JE' + String(counterResult.recordset[0].next_no).padStart(6, '0');
    const period = transactions[0].period;

    const jeResult = await pool.request()
        .input('entryNo', sql.NVarChar, entryNo)
        .input('entryDate', sql.NVarChar, now)
        .input('desc', sql.NVarChar, `عمولات المندوبين - ${period}`)
        .input('total', sql.Decimal(18, 2), totalAmount)
        .input('userId', sql.Int, userId)
        .query(`INSERT INTO journal_entries (entry_no, entry_date, description, total_debit, total_credit, created_by, source_module, source_action, is_system_generated)
                OUTPUT INSERTED.id
                VALUES (@entryNo, @entryDate, @desc, @total, @total, @userId, 'commission', 'approve', 1)`);
    const jeId = jeResult.recordset[0].id;

    await pool.request()
        .input('jeId', sql.Int, jeId).input('expenseId', sql.Int, expenseId)
        .input('total', sql.Decimal(18, 2), totalAmount).input('desc', sql.NVarChar, 'مصروف عمولات')
        .query(`INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description) VALUES (@jeId, @expenseId, @total, 0, @desc)`);

    await pool.request()
        .input('jeId', sql.Int, jeId).input('payableId', sql.Int, payableId)
        .input('total', sql.Decimal(18, 2), totalAmount).input('desc', sql.NVarChar, 'عمولات مستحقة للمندوبين')
        .query(`INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description) VALUES (@jeId, @payableId, 0, @total, @desc)`);

    for (const t of transactions) {
        await pool.request()
            .input('txId', sql.Int, t.id).input('jeId', sql.Int, jeId)
            .query(`UPDATE commission_transactions SET is_posted_to_gl = 1, journal_entry_id = @jeId WHERE id = @txId`);
    }

    return jeId;
}

async function postPaymentJournalEntry(voucher, transactions, userId) {
    const pool = await getPool();
    const now = new Date().toISOString().split('T')[0];
    const totalAmount = voucher.total_amount;
    if (totalAmount <= 0) return null;

    const payableAcc = await pool.request().query(`SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_COMMISSION_PAYABLE'`);
    const treasuryAcc = await pool.request().query(`SELECT TOP 1 id FROM treasury_accounts WHERE is_active = 1`);
    if (!payableAcc.recordset[0]) throw new Error('Commission Payable account not found (221)');

    const payableId = payableAcc.recordset[0].id;
    const treasuryId = treasuryAcc.recordset[0] ? treasuryAcc.recordset[0].id : null;
    const counterResult = await pool.request().query(`SELECT ISNULL(MAX(CAST(SUBSTRING(entry_no, 3, LEN(entry_no)) AS INT)), 0) + 1 AS next_no FROM journal_entries`);
    const entryNo = 'JE' + String(counterResult.recordset[0].next_no).padStart(6, '0');

    const jeResult = await pool.request()
        .input('entryNo', sql.NVarChar, entryNo)
        .input('entryDate', sql.NVarChar, now)
        .input('desc', sql.NVarChar, `صرف عمولات - ${voucher.voucher_no}`)
        .input('total', sql.Decimal(18, 2), totalAmount)
        .input('userId', sql.Int, userId)
        .query(`INSERT INTO journal_entries (entry_no, entry_date, description, total_debit, total_credit, created_by, source_module, source_action, is_system_generated)
                OUTPUT INSERTED.id
                VALUES (@entryNo, @entryDate, @desc, @total, @total, @userId, 'commission', 'pay', 1)`);
    const jeId = jeResult.recordset[0].id;

    await pool.request()
        .input('jeId', sql.Int, jeId).input('payableId', sql.Int, payableId)
        .input('total', sql.Decimal(18, 2), totalAmount).input('desc', sql.NVarChar, 'صرف عمولات مستحقة')
        .query(`INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description) VALUES (@jeId, @payableId, @total, 0, @desc)`);

    if (treasuryId) {
        await pool.request()
            .input('jeId', sql.Int, jeId).input('treasuryId', sql.Int, treasuryId)
            .input('total', sql.Decimal(18, 2), totalAmount).input('desc', sql.NVarChar, 'دفع عمولات من الخزينة')
            .query(`INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description) VALUES (@jeId, @treasuryId, 0, @total, @desc)`);
    }

    for (const t of transactions) {
        await pool.request()
            .input('txId', sql.Int, t.id).input('jeId', sql.Int, jeId)
            .query(`UPDATE commission_transactions SET is_paid = 1 WHERE id = @txId`);
    }

    await pool.request()
        .input('jeId', sql.Int, jeId).input('vId', sql.Int, voucher.id)
        .query(`UPDATE commission_payment_vouchers SET journal_entry_id = @jeId WHERE id = @vId`);

    return jeId;
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
    await repo.bulkUpdateStatus(ids, 2, userId);
    for (const id of ids) {
        await repo.logAudit(companyId, 'commission_transaction', id, 'approved', { workflow_status: 1 }, { workflow_status: 2 }, userId);
    }
    let jeId = null;
    try {
        jeId = await postApprovalJournalEntry(transactions, userId);
    } catch (e) {
        console.error('[Commission] GL posting failed on approve:', e.message);
    }
    return { approved: ids.length, jeId };
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
    settleTransactions,
    createPaymentVoucher,
    approveVoucher,
    payVoucher,
    getSettlementBatch,
    getRepLedger
};
