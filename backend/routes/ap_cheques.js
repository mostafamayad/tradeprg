const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const { postJournalEntryAsync, getSystemAccountAsync, recalcSupplierBalanceAsync } = require('../services/accountingEngine');
const logActivity = require('../middleware/logger');

function num(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

function logDetailedError(context, err) {
    console.error(`═══ ${context} Error ═══`);
    console.error('  Message:', err.message);
    console.error('  Stack:', err.stack);
    console.error('═══════════════════════════════════════');
}

async function refreshInvoiceStatusAsync(txRequest, invoiceId) {
    const srfx = Math.random().toString(36).substring(2, 9);
    txRequest.input(`ris_id_${srfx}`, sql.Int, invoiceId);
    const invRes = await txRequest.query(`SELECT * FROM purchase_invoices WHERE id = @ris_id_${srfx}`);
    const inv = invRes.recordset[0];
    if (!inv || inv.status === 'cancelled') return;
    const retRes = await txRequest.query(`SELECT COALESCE(SUM(grand_total),0) as total FROM purchase_returns WHERE invoice_id = @ris_id_${srfx} AND status NOT IN ('cancelled', 'deleted')`);
    const returnsTotal = retRes.recordset[0].total || 0;
    const allocRes = await txRequest.query(`SELECT COALESCE(SUM(apa.allocated_amount), 0) as total FROM ap_payment_allocations apa WHERE apa.invoice_id = @ris_id_${srfx}`);
    const totalPaid = allocRes.recordset[0].total || 0;
    const remaining = Math.max(0, num(inv.grand_total) - totalPaid - num(returnsTotal));
    let status = 'pending';
    if (remaining <= 0) status = 'paid';
    else if (totalPaid > 0 || num(returnsTotal) > 0) status = 'partial';
    txRequest.input(`ris_rem_${srfx}`, sql.Decimal(18,2), remaining);
    txRequest.input(`ris_stat_${srfx}`, sql.NVarChar, status);
    await txRequest.query(`UPDATE purchase_invoices SET remaining = @ris_rem_${srfx}, status = @ris_stat_${srfx} WHERE id = @ris_id_${srfx}`);
}

router.get('/', async (req, res) => {
    try {
        const { q, status, supplier_id, bank_name, due_from, due_to, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT ac.*, s.supplier_name FROM ap_cheques ac LEFT JOIN suppliers s ON ac.supplier_id = s.id WHERE 1=1`;
        if (q) { sqlQuery += ` AND (ac.cheque_no LIKE @q OR s.supplier_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (status) { sqlQuery += ` AND ac.status = @st`; request.input('st', sql.NVarChar, status); }
        if (supplier_id) { sqlQuery += ` AND ac.supplier_id = @sid`; request.input('sid', sql.Int, supplier_id); }
        if (bank_name) { sqlQuery += ` AND ac.bank_name LIKE @bn`; request.input('bn', sql.NVarChar, `%${bank_name}%`); }
        if (due_from) { sqlQuery += ` AND ac.due_date >= @df`; request.input('df', sql.Date, due_from); }
        if (due_to) { sqlQuery += ` AND ac.due_date <= @dt`; request.input('dt', sql.Date, due_to); }
        if (from) { sqlQuery += ` AND ac.cheque_date >= @fr`; request.input('fr', sql.Date, from); }
        if (to) { sqlQuery += ` AND ac.cheque_date <= @tr`; request.input('tr', sql.Date, to); }
        sqlQuery += ` ORDER BY ac.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logDetailedError('AP Cheques GET', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب شيكات الموردين', error_detail: err.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('cid', sql.Int, req.params.id)
            .query(`SELECT ac.*, s.supplier_name FROM ap_cheques ac LEFT JOIN suppliers s ON ac.supplier_id = s.id WHERE ac.id = @cid`);
        if (!result.recordset[0]) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        logDetailedError('AP Cheque GET detail', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل الشيك', error_detail: err.message });
    }
});

router.post('/', asyncHandler(async (req, res) => {
    const { cheque_no, cheque_date, due_date, amount, bank_name, supplier_id, notes } = req.body;
    if (!cheque_no) return res.status(400).json({ success: false, message: 'رقم الشيك مطلوب' });
    if (!amount || num(amount) <= 0) return res.status(400).json({ success: false, message: 'مبلغ الشيك مطلوب ويجب أن يكون أكبر من صفر' });
    const pool = await getPool();
    const result = await pool.request()
        .input('cn', sql.NVarChar, cheque_no)
        .input('cd', sql.Date, cheque_date || new Date().toISOString().slice(0, 10))
        .input('dd', sql.Date, due_date || null)
        .input('amt', sql.Decimal(18, 2), num(amount))
        .input('bn', sql.NVarChar, bank_name || null)
        .input('sid', sql.Int, supplier_id || null)
        .input('nt', sql.NVarChar, notes || null)
        .input('cb', sql.Int, req.user ? req.user.id : null)
        .input('sd', sql.Date, new Date().toISOString().slice(0, 10))
        .query(`INSERT INTO ap_cheques (cheque_no, cheque_date, due_date, amount, bank_name, supplier_id, status, status_date, notes, created_by)
                OUTPUT INSERTED.id
                VALUES (@cn, @cd, @dd, @amt, @bn, @sid, 'issued', @sd, @nt, @cb)`);
    const newId = result.recordset[0].id;
    await logActivity(req, 'CREATE', 'ap_cheques', newId, `إنشاء شيك مورد ${cheque_no}`, null, { cheque_no, amount: num(amount), bank_name }, 'SUCCESS', null);
    res.json({ success: true, message: 'تم إنشاء الشيك بنجاح', data: { id: newId } });
}));

router.patch('/:id/status', async (req, res) => {
    try {
        const { status, notes } = req.body;
        if (!status) return res.status(400).json({ success: false, message: 'الحالة مطلوبة' });
        if (!['issued', 'cleared', 'returned', 'cancelled'].includes(status)) {
            return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
        }
        const pool = await getPool();
        await pool.request()
            .input('cid', sql.Int, req.params.id)
            .input('st', sql.NVarChar, status)
            .input('sdate', sql.Date, new Date().toISOString().slice(0, 10))
            .query(`UPDATE ap_cheques SET status = @st, status_date = @sdate WHERE id = @cid`);
        res.json({ success: true, message: 'تم تحديث حالة الشيك' });
    } catch (err) {
        logDetailedError('AP Cheque status update', err);
        res.status(500).json({ success: false, message: 'خطأ في تحديث حالة الشيك', error_detail: err.message });
    }
});

// PATCH /:id/clear - تصفية الشيك (issued → cleared)
// Accounting: DR SYS_AP / CR Cash + treasury OUT (money leaves)
router.patch('/:id/clear', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const chkReq = pool.request();
        chkReq.input('cid', sql.Int, req.params.id);
        const chkRes = await chkReq.query(`
            SELECT ac.*, ap.id as payment_id, ap.payment_no, ap.supplier_id, ap.payment_date, ap.amount
            FROM ap_cheques ac
            LEFT JOIN ap_payments ap ON ap.id = ac.payment_id
            WHERE ac.id = @cid
        `);
        const ch = chkRes.recordset[0];
        if (!ch) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
        if (ch.status !== 'issued') return res.status(400).json({ success: false, message: `لا يمكن تصفية شيك بحالة ${ch.status}. يجب أن يكون مصدر` });

        const amountValue = num(ch.amount);
        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const sfx = Math.random().toString(36).substring(2, 9);
            txReq.input(`ch_sid_${sfx}`, sql.Int, ch.supplier_id);
            txReq.input(`ch_amt_${sfx}`, sql.Decimal(18, 2), amountValue);

            // 1. Journal entry: DR SYS_AP / CR Cash
            const accAP = await getSystemAccountAsync(txReq, 'SYS_AP');
            const accCash = await getSystemAccountAsync(txReq, 'SYS_CASH');
            const jeLines = [
                { account_id: accAP, debit: amountValue, credit: 0, description: `تصفية شيك ${ch.cheque_no}` },
                { account_id: accCash, debit: 0, credit: amountValue, description: `صرف شيك للمورد بموجب ${ch.cheque_no}` }
            ];
            await postJournalEntryAsync(
                txReq, new Date().toISOString().slice(0, 10),
                `تصفية شيك ${ch.cheque_no}`,
                jeLines, 'ap_cheque', ch.id,
                req.user ? req.user.id : null,
                { module: 'ap_cheques', action: 'clear', document: ch.cheque_no, isSystem: true }
            );

            // 2. Treasury OUT (cash decrease)
            let treasRes = await txReq.query(`SELECT TOP 1 id FROM treasury_accounts WHERE account_type = 'cash' ORDER BY id`);
            if (treasRes.recordset.length === 0) {
                treasRes = await txReq.query(`SELECT TOP 1 id FROM treasury_accounts WHERE account_type = 'bank' ORDER BY id`);
            }
            if (treasRes.recordset.length > 0) {
                const treasuryId = treasRes.recordset[0].id;
                const transNo = 'CLR-' + ch.cheque_no;
                txReq.input(`tr_tn_${sfx}`, sql.NVarChar, transNo);
                txReq.input(`tr_tid_${sfx}`, sql.Int, treasuryId);
                txReq.input(`tr_sid_${sfx}`, sql.Int, ch.supplier_id);
                txReq.input(`tr_desc_${sfx}`, sql.NVarChar, `صرف شيك ${ch.cheque_no}`);
                await txReq.query(`
                    INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
                    VALUES (@tr_tn_${sfx}, GETDATE(), 'out', @ch_amt_${sfx}, @tr_tid_${sfx}, 'supplier', @tr_sid_${sfx}, @tr_tn_${sfx}, @tr_desc_${sfx})
                `);
                await txReq.query(`UPDATE treasury_accounts SET current_balance = current_balance - @ch_amt_${sfx} WHERE id = @tr_tid_${sfx}`);
            }

            // 3. Update cheque status
            txReq.input(`ch_st_${sfx}`, sql.NVarChar, 'cleared');
            txReq.input(`ch_sd_${sfx}`, sql.Date, new Date().toISOString().slice(0, 10));
            txReq.input(`ch_id_${sfx}`, sql.Int, ch.id);
            await txReq.query(`UPDATE ap_cheques SET status = @ch_st_${sfx}, status_date = @ch_sd_${sfx} WHERE id = @ch_id_${sfx}`);

            await tx.commit();

            await logActivity(req, 'UPDATE', 'ap_cheques', ch.id, `تصفية شيك ${ch.cheque_no}`, null,
                { cheque_id: ch.id, cheque_no: ch.cheque_no, amount: amountValue, action: 'clear' }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم تصفية الشيك بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AP Cheque clear', err);
            await logActivity(req, 'UPDATE', 'ap_cheques', ch.id, `تصفية شيك ${ch.cheque_no}`, null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في تصفية الشيك', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AP Cheque clear (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// PATCH /:id/return - إرجاع الشيك (issued → returned)
router.patch('/:id/return', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const chkReq = pool.request();
        chkReq.input('cid', sql.Int, req.params.id);
        const chkRes = await chkReq.query(`
            SELECT ac.*, ap.id as payment_id, ap.payment_no, ap.supplier_id, ap.amount,
                s.supplier_name
            FROM ap_cheques ac
            LEFT JOIN ap_payments ap ON ap.id = ac.payment_id
            LEFT JOIN suppliers s ON s.id = ac.supplier_id
            WHERE ac.id = @cid
        `);
        const ch = chkRes.recordset[0];
        if (!ch) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
        if (ch.status !== 'issued') {
            return res.status(400).json({ success: false, message: `لا يمكن إرجاع شيك بحالة ${ch.status}. يجب أن يكون مصدر` });
        }
        if (!ch.payment_id) return res.status(400).json({ success: false, message: 'الشيك غير مرتبط بدفعة' });

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const sfx = Math.random().toString(36).substring(2, 9);
            txReq.input(`ch_pid_${sfx}`, sql.Int, ch.payment_id);

            // 1. Restore invoice remaining from allocations
            const allocRes = await txReq.query(`SELECT * FROM ap_payment_allocations WHERE payment_id = @ch_pid_${sfx}`);
            for (const alloc of allocRes.recordset) {
                const asfx = sfx + '_a' + alloc.id;
                txReq.input(`aiid_${asfx}`, sql.Int, alloc.invoice_id);
                txReq.input(`aamt_${asfx}`, sql.Decimal(18, 2), alloc.allocated_amount);
                await txReq.query(`
                    UPDATE purchase_invoices
                    SET amount_paid = amount_paid - @aamt_${asfx},
                        remaining = remaining + @aamt_${asfx}
                    WHERE id = @aiid_${asfx}
                `);
                await refreshInvoiceStatusAsync(txReq, alloc.invoice_id);
            }

            // 2. Delete allocations
            await txReq.query(`DELETE FROM ap_payment_allocations WHERE payment_id = @ch_pid_${sfx}`);

            // 3. Mark payment as reversed
            txReq.input(`ch_rev_${sfx}`, sql.NVarChar, 'reversed');
            txReq.input(`ch_rev_at_${sfx}`, sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '));
            await txReq.query(`UPDATE ap_payments SET status = @ch_rev_${sfx}, reversed_at = @ch_rev_at_${sfx} WHERE id = @ch_pid_${sfx}`);

            // 4. Mark cheque as returned
            txReq.input(`ch_rst_${sfx}`, sql.NVarChar, 'returned');
            txReq.input(`ch_rsd_${sfx}`, sql.Date, new Date().toISOString().slice(0, 10));
            await txReq.query(`UPDATE ap_cheques SET status = @ch_rst_${sfx}, status_date = @ch_rsd_${sfx} WHERE id = @cid`);

            // 5. Recalculate supplier balance
            if (ch.supplier_id) await recalcSupplierBalanceAsync(txReq, ch.supplier_id);

            // 6. Log supplier activity
            if (ch.supplier_id) {
                const pLog = Math.random().toString(36).substring(2, 9);
                txReq.input(`cal_sid_${pLog}`, sql.Int, ch.supplier_id);
                txReq.input(`cal_type_${pLog}`, sql.NVarChar, 'cheque_returned');
                txReq.input(`cal_desc_${pLog}`, sql.NVarChar, `تم إرجاع شيك ${ch.cheque_no} بقيمة ${ch.amount}`);
                txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'ap_cheque');
                txReq.input(`cal_ri_${pLog}`, sql.Int, ch.id);
                txReq.input(`cal_rn_${pLog}`, sql.NVarChar, ch.cheque_no);
                txReq.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), ch.amount || 0);
                txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
                await txReq.query(`
                    INSERT INTO supplier_activity_log (supplier_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                    VALUES (@cal_sid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
                `);
            }

            await tx.commit();

            await logActivity(req, 'UPDATE', 'ap_cheques', ch.id, `إرجاع شيك ${ch.cheque_no}`, null,
                { cheque_id: ch.id, cheque_no: ch.cheque_no, amount: ch.amount, action: 'return' }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم إرجاع الشيك وعكس الدفعة بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AP Cheque return', err);
            await logActivity(req, 'UPDATE', 'ap_cheques', ch.id, `إرجاع شيك ${ch.cheque_no}`, null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في إرجاع الشيك', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AP Cheque return (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// PATCH /:id/cancel - إلغاء الشيك (issued → cancelled)
router.patch('/:id/cancel', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const chkReq = pool.request();
        chkReq.input('cid', sql.Int, req.params.id);
        const chkRes = await chkReq.query(`
            SELECT ac.*, ap.id as payment_id, ap.payment_no, ap.supplier_id, ap.amount,
                s.supplier_name
            FROM ap_cheques ac
            LEFT JOIN ap_payments ap ON ap.id = ac.payment_id
            LEFT JOIN suppliers s ON s.id = ac.supplier_id
            WHERE ac.id = @cid
        `);
        const ch = chkRes.recordset[0];
        if (!ch) return res.status(404).json({ success: false, message: 'الشيك غير موجود' });
        if (ch.status !== 'issued') {
            return res.status(400).json({ success: false, message: `لا يمكن إلغاء شيك بحالة ${ch.status}. يجب أن يكون مصدر` });
        }
        if (!ch.payment_id) return res.status(400).json({ success: false, message: 'الشيك غير مرتبط بدفعة' });

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const sfx = Math.random().toString(36).substring(2, 9);
            txReq.input(`ch_pid_${sfx}`, sql.Int, ch.payment_id);

            // 1. Restore invoice remaining from allocations
            const allocRes = await txReq.query(`SELECT * FROM ap_payment_allocations WHERE payment_id = @ch_pid_${sfx}`);
            for (const alloc of allocRes.recordset) {
                const asfx = sfx + '_a' + alloc.id;
                txReq.input(`aiid_${asfx}`, sql.Int, alloc.invoice_id);
                txReq.input(`aamt_${asfx}`, sql.Decimal(18, 2), alloc.allocated_amount);
                await txReq.query(`
                    UPDATE purchase_invoices
                    SET amount_paid = amount_paid - @aamt_${asfx},
                        remaining = remaining + @aamt_${asfx}
                    WHERE id = @aiid_${asfx}
                `);
                await refreshInvoiceStatusAsync(txReq, alloc.invoice_id);
            }

            // 2. Delete allocations
            await txReq.query(`DELETE FROM ap_payment_allocations WHERE payment_id = @ch_pid_${sfx}`);

            // 3. Mark payment as reversed
            txReq.input(`ch_rev_${sfx}`, sql.NVarChar, 'reversed');
            txReq.input(`ch_rev_at_${sfx}`, sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '));
            await txReq.query(`UPDATE ap_payments SET status = @ch_rev_${sfx}, reversed_at = @ch_rev_at_${sfx} WHERE id = @ch_pid_${sfx}`);

            // 4. Mark cheque as cancelled
            txReq.input(`ch_cst_${sfx}`, sql.NVarChar, 'cancelled');
            txReq.input(`ch_csd_${sfx}`, sql.Date, new Date().toISOString().slice(0, 10));
            await txReq.query(`UPDATE ap_cheques SET status = @ch_cst_${sfx}, status_date = @ch_csd_${sfx} WHERE id = @cid`);

            // 5. Recalculate supplier balance
            if (ch.supplier_id) await recalcSupplierBalanceAsync(txReq, ch.supplier_id);

            // 6. Log supplier activity
            if (ch.supplier_id) {
                const pLog = Math.random().toString(36).substring(2, 9);
                txReq.input(`cal_sid_${pLog}`, sql.Int, ch.supplier_id);
                txReq.input(`cal_type_${pLog}`, sql.NVarChar, 'cheque_cancelled');
                txReq.input(`cal_desc_${pLog}`, sql.NVarChar, `تم إلغاء شيك ${ch.cheque_no} بقيمة ${ch.amount}`);
                txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'ap_cheque');
                txReq.input(`cal_ri_${pLog}`, sql.Int, ch.id);
                txReq.input(`cal_rn_${pLog}`, sql.NVarChar, ch.cheque_no);
                txReq.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), ch.amount || 0);
                txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
                await txReq.query(`
                    INSERT INTO supplier_activity_log (supplier_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                    VALUES (@cal_sid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
                `);
            }

            await tx.commit();

            await logActivity(req, 'UPDATE', 'ap_cheques', ch.id, `إلغاء شيك ${ch.cheque_no}`, null,
                { cheque_id: ch.id, cheque_no: ch.cheque_no, amount: ch.amount, action: 'cancel' }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم إلغاء الشيك وعكس الدفعة بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AP Cheque cancel', err);
            await logActivity(req, 'UPDATE', 'ap_cheques', ch.id, `إلغاء شيك ${ch.cheque_no}`, null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في إلغاء الشيك', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AP Cheque cancel (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

module.exports = router;
