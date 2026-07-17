// ============================================================
// ROUTE: AR Cheques (شيكات العملاء - دورة حياة كاملة)
// ============================================================
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const { postJournalEntryAsync, getSystemAccountAsync, recalcCustomerBalanceAsync } = require('../services/accountingEngine');
const logActivity = require('../middleware/logger');

// ============================================================
// Helpers
// ============================================================
function num(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

function logDetailedError(context, err) {
    console.error(`═══ ${context} Error ═══`);
    console.error('  Message:', err.message);
    console.error('  SQL Error No:', err.number || err.code || 'N/A');
    console.error('  Stack:', err.stack);
    console.error('═══════════════════════════════════════');
}

async function refreshInvoiceStatusAsync(txRequest, invoiceId) {
    const srfx = Math.random().toString(36).substring(2, 9);
    txRequest.input(`ris_id_${srfx}`, sql.Int, invoiceId);
    const invRes = await txRequest.query(`SELECT * FROM sales_invoices WHERE id = @ris_id_${srfx}`);
    const inv = invRes.recordset[0];
    if (!inv || inv.status === 'cancelled') return;
    const retRes = await txRequest.query(`SELECT COALESCE(SUM(grand_total),0) as total FROM sales_returns WHERE invoice_id = @ris_id_${srfx} AND status NOT IN ('cancelled', 'deleted')`);
    const returnsTotal = retRes.recordset[0].total || 0;
    const allocRes = await txRequest.query(`
        SELECT COALESCE(SUM(sub.amount), 0) as total FROM (
            SELECT COALESCE(SUM(ca.amount), 0) as amount FROM collection_allocations ca WHERE ca.invoice_id = @ris_id_${srfx}
            UNION ALL
            SELECT COALESCE(SUM(apa.allocated_amount), 0) as amount FROM ar_payment_allocations apa WHERE apa.invoice_id = @ris_id_${srfx}
        ) sub
    `);
    const totalPaid = allocRes.recordset[0].total || 0;
    const remaining = Math.max(0, num(inv.grand_total) - totalPaid - num(returnsTotal));
    let status = 'pending';
    if (remaining <= 0) status = 'paid';
    else if (totalPaid > 0 || num(returnsTotal) > 0) status = 'partial';
    txRequest.input(`ris_rem_${srfx}`, sql.Decimal(18,2), remaining);
    txRequest.input(`ris_stat_${srfx}`, sql.NVarChar, status);
    await txRequest.query(`UPDATE sales_invoices SET remaining = @ris_rem_${srfx}, status = @ris_stat_${srfx} WHERE id = @ris_id_${srfx}`);
}

async function nextDocNoAsync(txRequest, counterName) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`cn_${pRand}`, sql.NVarChar, counterName);
    const row = await txRequest.query(`
        SELECT prefix, last_number FROM invoice_counters WITH (UPDLOCK) WHERE counter_name = @cn_${pRand}
    `);
    if (!row.recordset[0]) {
        await txRequest.query(`INSERT INTO invoice_counters (counter_name, prefix, last_number) VALUES (@cn_${pRand}, 'TXN', 1)`);
        return 'TXN-0001';
    }
    const next = row.recordset[0].last_number + 1;
    txRequest.input(`cn_next_${pRand}`, sql.Int, next);
    await txRequest.query(`UPDATE invoice_counters SET last_number = @cn_next_${pRand} WHERE counter_name = @cn_${pRand}`);
    return `${row.recordset[0].prefix}-${String(next).padStart(4, '0')}`;
}

// ============================================================
// Existing GET endpoints (unchanged)
// ============================================================
router.get('/', async (req, res) => {
    try {
        const { q, status, customer_id, bank_name, due_from, due_to, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT ac.*, c.customer_name FROM ar_cheques ac LEFT JOIN customers c ON ac.customer_id = c.id WHERE 1=1`;
        if (q) { sqlQuery += ` AND (ac.cheque_no LIKE @q OR c.customer_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (status) { sqlQuery += ` AND ac.status = @st`; request.input('st', sql.NVarChar, status); }
        if (customer_id) { sqlQuery += ` AND ac.customer_id = @cid`; request.input('cid', sql.Int, customer_id); }
        if (bank_name) { sqlQuery += ` AND ac.bank_name LIKE @bn`; request.input('bn', sql.NVarChar, `%${bank_name}%`); }
        if (due_from) { sqlQuery += ` AND (ac.due_date >= @df OR ac.due_date IS NULL)`; request.input('df', sql.Date, due_from); }
        if (due_to) { sqlQuery += ` AND (ac.due_date <= @dt OR ac.due_date IS NULL)`; request.input('dt', sql.Date, due_to); }
        if (from) { sqlQuery += ` AND ac.cheque_date >= @fr`; request.input('fr', sql.Date, from); }
        if (to) { sqlQuery += ` AND ac.cheque_date <= @tr`; request.input('tr', sql.Date, to); }
        sqlQuery += ` ORDER BY ac.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('AR Cheques GET error:', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب شيكات العملاء', error_detail: err.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('cid', sql.Int, req.params.id)
            .query(`SELECT ac.*, c.customer_name FROM ar_cheques ac LEFT JOIN customers c ON ac.customer_id = c.id WHERE ac.id = @cid`);
        if (!result.recordset[0]) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        console.error('AR Cheque GET detail error:', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل الشيك', error_detail: err.message });
    }
});

// ============================================================
// PATCH /:id/status - Generic status update (legacy, kept for
// backward compatibility). New code uses dedicated endpoints.
// ============================================================
router.patch('/:id/status', async (req, res) => {
    try {
        const { status, notes } = req.body;
        if (!status) return res.status(400).json({ success: false, message: 'الحالة مطلوبة' });
        if (!['received', 'deposited', 'collected', 'returned', 'cancelled'].includes(status)) {
            return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
        }
        const pool = await getPool();
        await pool.request()
            .input('cid', sql.Int, req.params.id)
            .input('st', sql.NVarChar, status)
            .input('sdate', sql.Date, new Date().toISOString().slice(0, 10))
            .query(`UPDATE ar_cheques SET status = @st, status_date = @sdate WHERE id = @cid`);
        res.json({ success: true, message: 'تم تحديث حالة الشيك' });
    } catch (err) {
        console.error('AR Cheque status update error:', err);
        res.status(500).json({ success: false, message: 'خطأ في تحديث حالة الشيك', error_detail: err.message });
    }
});

// ============================================================
// PATCH /:id/deposit - إيداع الشيك في البنك (received → deposited)
// القيد المحاسبي:
//   مدين: شيكات تحت التحصيل (SYS_AR_CHEQUES)
//   دائن: العملاء (SYS_AR)
// ============================================================
router.patch('/:id/deposit', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const chkReq = pool.request();
        chkReq.input('cid', sql.Int, req.params.id);
        const chkRes = await chkReq.query(`
            SELECT ac.*, ap.payment_no, ap.customer_id FROM ar_cheques ac
            LEFT JOIN ar_payments ap ON ap.id = ac.payment_id
            WHERE ac.id = @cid
        `);
        const ch = chkRes.recordset[0];
        if (!ch) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
        if (ch.status !== 'received') return res.status(400).json({ success: false, message: `لا يمكن إيداع شيك بحالة ${ch.status}. يجب أن يكون الحالة مستلم` });
        if (!ch.customer_id) return res.status(400).json({ success: false, message: 'الشيك غير مرتبط بعميل' });

        const amountValue = num(ch.amount);
        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const sfx = Math.random().toString(36).substring(2, 9);

            // 1. Journal entry: DR Cheques Under Collection / CR AR
            const accARCheques = await getSystemAccountAsync(txReq, 'SYS_AR_CHEQUES');
            const accAR = await getSystemAccountAsync(txReq, 'SYS_AR');
            const jeLines = [
                { account_id: accARCheques, debit: amountValue, credit: 0, description: `إيداع شيك ${ch.cheque_no} بالبنك` },
                { account_id: accAR, debit: 0, credit: amountValue, description: `إيداع شيك ${ch.cheque_no} بالبنك` }
            ];
            await postJournalEntryAsync(
                txReq, new Date().toISOString().slice(0, 10),
                `إيداع شيك ${ch.cheque_no}`,
                jeLines, 'ar_cheque', ch.id,
                req.user ? req.user.id : null,
                { module: 'ar_cheques', action: 'deposit', document: ch.cheque_no, isSystem: true }
            );

            // 2. Update cheque status
            txReq.input(`ch_st_${sfx}`, sql.NVarChar, 'deposited');
            txReq.input(`ch_sd_${sfx}`, sql.Date, new Date().toISOString().slice(0, 10));
            txReq.input(`ch_id_${sfx}`, sql.Int, ch.id);
            await txReq.query(`UPDATE ar_cheques SET status = @ch_st_${sfx}, status_date = @ch_sd_${sfx} WHERE id = @ch_id_${sfx}`);

            await tx.commit();

            await logActivity(req, 'UPDATE', 'ar_cheques', ch.id, `إيداع شيك ${ch.cheque_no}`, null, { cheque_id: ch.id, cheque_no: ch.cheque_no, amount: amountValue, action: 'deposit' }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم إيداع الشيك بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AR Cheque deposit', err);
            await logActivity(req, 'UPDATE', 'ar_cheques', ch.id, `إيداع شيك ${ch.cheque_no}`, null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: 'خطأ في إيداع الشيك', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AR Cheque deposit (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// ============================================================
// PATCH /:id/collect - تحصيل الشيك من البنك (deposited → collected)
// القيد المحاسبي:
//   مدين: البنك (SYS_BANK)
//   دائن: شيكات تحت التحصيل (SYS_AR_CHEQUES)
// ============================================================
router.patch('/:id/collect', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const chkReq = pool.request();
        chkReq.input('cid', sql.Int, req.params.id);
        const chkRes = await chkReq.query(`
            SELECT ac.*, ap.id as payment_id, ap.payment_no, ap.customer_id, ap.payment_date, ap.amount
            FROM ar_cheques ac
            LEFT JOIN ar_payments ap ON ap.id = ac.payment_id
            WHERE ac.id = @cid
        `);
        const ch = chkRes.recordset[0];
        if (!ch) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
        if (ch.status !== 'deposited') return res.status(400).json({ success: false, message: `لا يمكن تحصيل شيك بحالة ${ch.status}. يجب أن يكون الحالة مودع` });

        const amountValue = num(ch.amount);
        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const sfx = Math.random().toString(36).substring(2, 9);

            // 1. Journal entry: DR Bank / CR Cheques Under Collection
            const accBank = await getSystemAccountAsync(txReq, 'SYS_BANK');
            const accARCheques = await getSystemAccountAsync(txReq, 'SYS_AR_CHEQUES');
            const jeLines = [
                { account_id: accBank, debit: amountValue, credit: 0, description: `تحصيل شيك ${ch.cheque_no} من البنك` },
                { account_id: accARCheques, debit: 0, credit: amountValue, description: `تحصيل شيك ${ch.cheque_no} من البنك` }
            ];
            await postJournalEntryAsync(
                txReq, new Date().toISOString().slice(0, 10),
                `تحصيل شيك ${ch.cheque_no}`,
                jeLines, 'ar_cheque', ch.id,
                req.user ? req.user.id : null,
                { module: 'ar_cheques', action: 'collect', document: ch.cheque_no, isSystem: true }
            );

            // 2. Treasury/Bank transaction (for visibility in treasury movements)
            let treasRes = await txReq.query(`SELECT TOP 1 id FROM treasury_accounts WHERE account_type = 'bank' ORDER BY id`);
            if (treasRes.recordset.length > 0) {
                const treasuryId = treasRes.recordset[0].id;
                const transNo = await nextDocNoAsync(txReq, 'treasury');
                txReq.input(`tr_tn_${sfx}`, sql.NVarChar, transNo);
                txReq.input(`tr_tid_${sfx}`, sql.Int, treasuryId);
                txReq.input(`tr_chid_${sfx}`, sql.Int, ch.id);
                txReq.input(`tr_cust_${sfx}`, sql.Int, ch.customer_id || null);
                txReq.input(`tr_desc_${sfx}`, sql.NVarChar, `تحصيل شيك ${ch.cheque_no}`);
                txReq.input(`tr_amt_${sfx}`, sql.Decimal(18, 2), amountValue);

                const tDate = new Date().toISOString().slice(0, 10);
                txReq.input(`tr_tdate_${sfx}`, sql.NVarChar, tDate);
                await txReq.query(`
                    INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
                    VALUES (@tr_tn_${sfx}, @tr_tdate_${sfx}, 'in', @tr_amt_${sfx}, @tr_tid_${sfx}, 'ar_cheque', @tr_chid_${sfx}, @tr_chid_${sfx}, @tr_desc_${sfx})
                `);
                await txReq.query(`UPDATE treasury_accounts SET current_balance = current_balance + @tr_amt_${sfx} WHERE id = @tr_tid_${sfx}`);
            }

            // 3. Update cheque status
            txReq.input(`ch_st_${sfx}`, sql.NVarChar, 'collected');
            txReq.input(`ch_sd_${sfx}`, sql.Date, new Date().toISOString().slice(0, 10));
            txReq.input(`ch_id_${sfx}`, sql.Int, ch.id);
            await txReq.query(`UPDATE ar_cheques SET status = @ch_st_${sfx}, status_date = @ch_sd_${sfx} WHERE id = @ch_id_${sfx}`);

            await tx.commit();

            await logActivity(req, 'UPDATE', 'ar_cheques', ch.id, `تحصيل شيك ${ch.cheque_no}`, null,
                { cheque_id: ch.id, cheque_no: ch.cheque_no, amount: amountValue, action: 'collect' }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم تحصيل الشيك بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AR Cheque collect', err);
            await logActivity(req, 'UPDATE', 'ar_cheques', ch.id, `تحصيل شيك ${ch.cheque_no}`, null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في تحصيل الشيك', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AR Cheque collect (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// ============================================================
// PATCH /:id/return - إرجاع الشيك (received/deposited → returned)
// عكس كامل:
//   - إذا كانت الحالة deposited: عكس قيد الإيداع (مدين العملاء / دائن شيكات تحت التحصيل)
//   - إعادة فتح الفاتورة المرتبطة + رصيد العميل
// ============================================================
router.patch('/:id/return', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const chkReq = pool.request();
        chkReq.input('cid', sql.Int, req.params.id);
        const chkRes = await chkReq.query(`
            SELECT ac.*, ap.id as payment_id, ap.payment_no, ap.customer_id, ap.amount,
                c.customer_name
            FROM ar_cheques ac
            LEFT JOIN ar_payments ap ON ap.id = ac.payment_id
            LEFT JOIN customers c ON c.id = ac.customer_id
            WHERE ac.id = @cid
        `);
        const ch = chkRes.recordset[0];
        if (!ch) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
        if (ch.status !== 'received' && ch.status !== 'deposited') {
            return res.status(400).json({ success: false, message: `لا يمكن إرجاع شيك بحالة ${ch.status}. يجب أن يكون مستلم أو مودع` });
        }

        const wasDeposited = ch.status === 'deposited';
        const amountValue = num(ch.amount);
        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const sfx = Math.random().toString(36).substring(2, 9);

            // 0. Reverse deposit journal entry if cheque was deposited
            if (wasDeposited) {
                const accARCheques = await getSystemAccountAsync(txReq, 'SYS_AR_CHEQUES');
                const accAR = await getSystemAccountAsync(txReq, 'SYS_AR');
                const revJeLines = [
                    { account_id: accAR, debit: amountValue, credit: 0, description: `عكس إيداع شيك ${ch.cheque_no}` },
                    { account_id: accARCheques, debit: 0, credit: amountValue, description: `عكس إيداع شيك ${ch.cheque_no}` }
                ];
                await postJournalEntryAsync(
                    txReq, new Date().toISOString().slice(0, 10),
                    `عكس إيداع شيك ${ch.cheque_no}`,
                    revJeLines, 'ar_cheque', ch.id,
                    req.user ? req.user.id : null,
                    { module: 'ar_cheques', action: 'return_deposit', document: ch.cheque_no, isSystem: true }
                );
            }

            // 1. Restore invoice remaining from allocations (only if linked to a payment)
            if (ch.payment_id) {
                txReq.input(`ch_pid_${sfx}`, sql.Int, ch.payment_id);
                const allocRes = await txReq.query(`SELECT * FROM ar_payment_allocations WHERE payment_id = @ch_pid_${sfx}`);
                for (const alloc of allocRes.recordset) {
                    const asfx = sfx + '_a' + alloc.id;
                    txReq.input(`aiid_${asfx}`, sql.Int, alloc.invoice_id);
                    txReq.input(`aamt_${asfx}`, sql.Decimal(18, 2), alloc.allocated_amount);
                    await txReq.query(`
                        UPDATE sales_invoices
                        SET amount_paid = amount_paid - @aamt_${asfx},
                            remaining = remaining + @aamt_${asfx}
                        WHERE id = @aiid_${asfx}
                    `);
                    await refreshInvoiceStatusAsync(txReq, alloc.invoice_id);
                }

                // 2. Delete allocations
                await txReq.query(`DELETE FROM ar_payment_allocations WHERE payment_id = @ch_pid_${sfx}`);

                // 3. Mark payment as reversed
                txReq.input(`ch_rev_${sfx}`, sql.NVarChar, 'reversed');
                txReq.input(`ch_rev_at_${sfx}`, sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '));
                await txReq.query(`UPDATE ar_payments SET status = @ch_rev_${sfx}, reversed_at = @ch_rev_at_${sfx} WHERE id = @ch_pid_${sfx}`);
            }

            // 4. Mark cheque as returned
            txReq.input(`cid_${sfx}`, sql.Int, req.params.id);
            txReq.input(`ch_rst_${sfx}`, sql.NVarChar, 'returned');
            txReq.input(`ch_rsd_${sfx}`, sql.Date, new Date().toISOString().slice(0, 10));
            await txReq.query(`UPDATE ar_cheques SET status = @ch_rst_${sfx}, status_date = @ch_rsd_${sfx} WHERE id = @cid_${sfx}`);

            // 5. Recalculate customer balance (adds back the payment amount)
            if (ch.customer_id) await recalcCustomerBalanceAsync(txReq, ch.customer_id);

            // 6. Log customer activity
            if (ch.customer_id) {
                const pLog = Math.random().toString(36).substring(2, 9);
                txReq.input(`cal_cid_${pLog}`, sql.Int, ch.customer_id);
                txReq.input(`cal_type_${pLog}`, sql.NVarChar, 'cheque_returned');
                txReq.input(`cal_desc_${pLog}`, sql.NVarChar, `تم إرجاع شيك ${ch.cheque_no} بقيمة ${ch.amount}`);
                txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'ar_cheque');
                txReq.input(`cal_ri_${pLog}`, sql.Int, ch.id);
                txReq.input(`cal_rn_${pLog}`, sql.NVarChar, ch.cheque_no);
                txReq.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), ch.amount || 0);
                txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
                await txReq.query(`
                    INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                    VALUES (@cal_cid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
                `);
            }

            await tx.commit();

            await logActivity(req, 'UPDATE', 'ar_cheques', ch.id, `إرجاع شيك ${ch.cheque_no}`, null,
                { cheque_id: ch.id, cheque_no: ch.cheque_no, amount: ch.amount, action: 'return' }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم إرجاع الشيك وعكس الدفعة بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AR Cheque return', err);
            await logActivity(req, 'UPDATE', 'ar_cheques', ch.id, `إرجاع شيك ${ch.cheque_no}`, null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في إرجاع الشيك', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AR Cheque return (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// ============================================================
// PATCH /:id/cancel - إلغاء الشيك (received → cancelled)
// لا يوجد قيد محاسبي لعكسه لأن الشيك لم يتم إيداعه بعد
// فقط عكس تخصيصات الدفعة إن وجدت
// ============================================================
router.patch('/:id/cancel', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const chkReq = pool.request();
        chkReq.input('cid', sql.Int, req.params.id);
        const chkRes = await chkReq.query(`
            SELECT ac.*, ap.id as payment_id, ap.payment_no, ap.customer_id, ap.amount,
                c.customer_name
            FROM ar_cheques ac
            LEFT JOIN ar_payments ap ON ap.id = ac.payment_id
            LEFT JOIN customers c ON c.id = ac.customer_id
            WHERE ac.id = @cid
        `);
        const ch = chkRes.recordset[0];
        if (!ch) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
        if (ch.status !== 'received') {
            return res.status(400).json({ success: false, message: `لا يمكن إلغاء شيك بحالة ${ch.status}. يجب أن يكون مستلم` });
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const sfx = Math.random().toString(36).substring(2, 9);

            // 1. Restore invoice remaining from allocations (only if linked to a payment)
            if (ch.payment_id) {
                txReq.input(`ch_pid_${sfx}`, sql.Int, ch.payment_id);
                const allocRes = await txReq.query(`SELECT * FROM ar_payment_allocations WHERE payment_id = @ch_pid_${sfx}`);
                for (const alloc of allocRes.recordset) {
                    const asfx = sfx + '_a' + alloc.id;
                    txReq.input(`aiid_${asfx}`, sql.Int, alloc.invoice_id);
                    txReq.input(`aamt_${asfx}`, sql.Decimal(18, 2), alloc.allocated_amount);
                    await txReq.query(`
                        UPDATE sales_invoices
                        SET amount_paid = amount_paid - @aamt_${asfx},
                            remaining = remaining + @aamt_${asfx}
                        WHERE id = @aiid_${asfx}
                    `);
                    await refreshInvoiceStatusAsync(txReq, alloc.invoice_id);
                }

                // 2. Delete allocations
                await txReq.query(`DELETE FROM ar_payment_allocations WHERE payment_id = @ch_pid_${sfx}`);

                // 3. Mark payment as reversed
                txReq.input(`ch_rev_${sfx}`, sql.NVarChar, 'reversed');
                txReq.input(`ch_rev_at_${sfx}`, sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '));
                await txReq.query(`UPDATE ar_payments SET status = @ch_rev_${sfx}, reversed_at = @ch_rev_at_${sfx} WHERE id = @ch_pid_${sfx}`);
            }

            // 4. Mark cheque as cancelled
            txReq.input(`cid_${sfx}`, sql.Int, req.params.id);
            txReq.input(`ch_cst_${sfx}`, sql.NVarChar, 'cancelled');
            txReq.input(`ch_csd_${sfx}`, sql.Date, new Date().toISOString().slice(0, 10));
            await txReq.query(`UPDATE ar_cheques SET status = @ch_cst_${sfx}, status_date = @ch_csd_${sfx} WHERE id = @cid_${sfx}`);

            // 5. Recalculate customer balance
            if (ch.customer_id) await recalcCustomerBalanceAsync(txReq, ch.customer_id);

            // 6. Log customer activity
            if (ch.customer_id) {
                const pLog = Math.random().toString(36).substring(2, 9);
                txReq.input(`cal_cid_${pLog}`, sql.Int, ch.customer_id);
                txReq.input(`cal_type_${pLog}`, sql.NVarChar, 'cheque_cancelled');
                txReq.input(`cal_desc_${pLog}`, sql.NVarChar, `تم إلغاء شيك ${ch.cheque_no} بقيمة ${ch.amount}`);
                txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'ar_cheque');
                txReq.input(`cal_ri_${pLog}`, sql.Int, ch.id);
                txReq.input(`cal_rn_${pLog}`, sql.NVarChar, ch.cheque_no);
                txReq.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), ch.amount || 0);
                txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
                await txReq.query(`
                    INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                    VALUES (@cal_cid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
                `);
            }

            await tx.commit();

            await logActivity(req, 'UPDATE', 'ar_cheques', ch.id, `إلغاء شيك ${ch.cheque_no}`, null,
                { cheque_id: ch.id, cheque_no: ch.cheque_no, amount: ch.amount, action: 'cancel' }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم إلغاء الشيك وعكس الدفعة بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AR Cheque cancel', err);
            await logActivity(req, 'UPDATE', 'ar_cheques', ch.id, `إلغاء شيك ${ch.cheque_no}`, null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في إلغاء الشيك', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AR Cheque cancel (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// ============================================================
// POST / - Create a new AR cheque
// ============================================================
router.post('/', asyncHandler(async (req, res) => {
    const { cheque_no, cheque_date, due_date, amount, bank_name, account_no, customer_id, notes } = req.body;
    if (!cheque_no) return res.status(400).json({ success: false, message: 'رقم الشيك مطلوب' });
    if (!amount || num(amount) <= 0) return res.status(400).json({ success: false, message: 'مبلغ الشيك مطلوب ويجب أن يكون أكبر من صفر' });
    const pool = await getPool();
    const result = await pool.request()
        .input('cn', sql.NVarChar, cheque_no)
        .input('cd', sql.Date, cheque_date || new Date().toISOString().slice(0, 10))
        .input('dd', sql.Date, due_date || null)
        .input('amt', sql.Decimal(18, 2), num(amount))
        .input('bn', sql.NVarChar, bank_name || null)
        .input('ano', sql.NVarChar, account_no || null)
        .input('cid', sql.Int, customer_id || null)
        .input('nt', sql.NVarChar, notes || null)
        .input('cb', sql.Int, req.user ? req.user.id : null)
        .input('sd', sql.Date, new Date().toISOString().slice(0, 10))
        .query(`INSERT INTO ar_cheques (cheque_no, cheque_date, due_date, amount, bank_name, account_no, customer_id, status, status_date, notes, created_by)
                OUTPUT INSERTED.id
                VALUES (@cn, @cd, @dd, @amt, @bn, @ano, @cid, 'received', @sd, @nt, @cb)`);
    const newId = result.recordset[0].id;
    await logActivity(req, 'CREATE', 'ar_cheques', newId, `إنشاء شيك ${cheque_no}`, null, { cheque_no, amount: num(amount), bank_name }, 'SUCCESS', null);
    res.json({ success: true, message: 'تم إنشاء الشيك بنجاح', id: newId });
}));

// ============================================================
// PUT /:id - Update cheque details
// ============================================================
router.put('/:id', asyncHandler(async (req, res) => {
    const { cheque_no, cheque_date, due_date, amount, bank_name, account_no, customer_id, notes } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT status FROM ar_cheques WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
    if (existing.recordset[0].status !== 'received') return res.status(400).json({ success: false, message: 'يمكن تعديل شيكات المستلمة فقط' });
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('cn', sql.NVarChar, cheque_no)
        .input('cd', sql.Date, cheque_date || null)
        .input('dd', sql.Date, due_date || null)
        .input('amt', sql.Decimal(18, 2), num(amount))
        .input('bn', sql.NVarChar, bank_name || null)
        .input('ano', sql.NVarChar, account_no || null)
        .input('cid', sql.Int, customer_id || null)
        .input('nt', sql.NVarChar, notes || null)
        .input('ub', sql.Int, req.user ? req.user.id : null)
        .query(`UPDATE ar_cheques SET cheque_no=@cn, cheque_date=@cd, due_date=@dd, amount=@amt, bank_name=@bn, account_no=@ano, customer_id=@cid, notes=@nt, updated_at=GETDATE() WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل الشيك بنجاح' });
}));

// ============================================================
// DELETE /:id - Delete cheque (only if received)
// ============================================================
router.delete('/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT status, cheque_no FROM ar_cheques WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
    if (existing.recordset[0].status !== 'received') return res.status(400).json({ success: false, message: 'يمكن حذف شيكات المستلمة فقط' });
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM ar_cheques WHERE id = @id');
    await logActivity(req, 'DELETE', 'ar_cheques', req.params.id, `حذف شيك ${existing.recordset[0].cheque_no}`, null, null, 'SUCCESS', null);
    res.json({ success: true, message: 'تم حذف الشيك بنجاح' });
}));

module.exports = router;
