// ============================================================
// ROUTE: AR Notes (إشعارات خصم/إضافة للعملاء)
// ============================================================
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync, recalcCustomerBalanceAsync } = require('../services/accountingEngine');
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
    console.error('  Stack:', err.stack);
    console.error('═══════════════════════════════════════');
}

async function nextDocNoAsync(txRequest) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`cn_${pRand}`, sql.NVarChar, 'ar_notes');
    const row = await txRequest.query(`
        SELECT prefix, last_number FROM invoice_counters WITH (UPDLOCK) WHERE counter_name = @cn_${pRand}
    `);
    if (!row.recordset[0]) {
        await txRequest.query(`INSERT INTO invoice_counters (counter_name, prefix, last_number) VALUES (@cn_${pRand}, 'ARN', 1)`);
        return 'ARN-0001';
    }
    const next = row.recordset[0].last_number + 1;
    txRequest.input(`cn_next_${pRand}`, sql.Int, next);
    await txRequest.query(`UPDATE invoice_counters SET last_number = @cn_next_${pRand} WHERE counter_name = @cn_${pRand}`);
    return `${row.recordset[0].prefix}-${String(next).padStart(4, '0')}`;
}

// ============================================================
// GET / - List AR Notes with filters
// ============================================================
router.get('/', asyncHandler(async (req, res) => {
    try {
        const { q, customer_id, note_type, status, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT an.*, c.customer_name, u.username FROM ar_notes an LEFT JOIN customers c ON an.customer_id = c.id LEFT JOIN users u ON an.created_by = u.id WHERE 1=1`;
        if (q) { sqlQuery += ` AND (an.note_no LIKE @q OR c.customer_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (customer_id) { sqlQuery += ` AND an.customer_id = @cid`; request.input('cid', sql.Int, customer_id); }
        if (note_type) { sqlQuery += ` AND an.note_type = @nt`; request.input('nt', sql.NVarChar, note_type); }
        if (status) { sqlQuery += ` AND an.status = @st`; request.input('st', sql.NVarChar, status); }
        if (from) { sqlQuery += ` AND an.note_date >= @fr`; request.input('fr', sql.Date, from); }
        if (to) { sqlQuery += ` AND an.note_date <= @tr`; request.input('tr', sql.Date, to); }
        sqlQuery += ` ORDER BY an.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logDetailedError('AR Notes GET', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب إشعارات العملاء', error_detail: err.message });
    }
}));

// ============================================================
// GET /:id - Detail
// ============================================================
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('nid', sql.Int, req.params.id)
            .query(`SELECT an.*, c.customer_name FROM ar_notes an LEFT JOIN customers c ON an.customer_id = c.id WHERE an.id = @nid`);
        if (!result.recordset[0]) return res.status(404).json({ success: false, message: 'الإشعار غير موجود' });
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        logDetailedError('AR Note GET detail', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل الإشعار', error_detail: err.message });
    }
}));

// ============================================================
// POST / - Create AR Note (إشعار خصم/إضافة)
// التأثيرات:
//   - Debit Note:  DR العملاء / CR إيرادات (SYS_SALES)
//   - Credit Note: DR مصروفات (SYS_EXPENSE) / CR العملاء
//   - تحديث رصيد العميل
//   - تسجيل النشاط
// ============================================================
router.post('/', asyncHandler(async (req, res) => {
    try {
        const { customer_id, note_type, amount, reason, notes, note_date } = req.body;
        const amountValue = num(amount);
        const date = note_date || new Date().toISOString().slice(0, 10);

        if (!customer_id) return res.status(400).json({ success: false, message: 'العميل مطلوب' });
        if (!note_type || !['debit', 'credit'].includes(note_type)) return res.status(400).json({ success: false, message: 'نوع الإشعار مطلوب (debit / credit)' });
        if (amountValue <= 0) return res.status(400).json({ success: false, message: 'القيمة يجب أن تكون أكبر من صفر' });

        const pool = await getPool();

        const custReq = pool.request();
        custReq.input('cid', sql.Int, customer_id);
        const custRes = await custReq.query('SELECT id, customer_name FROM customers WHERE id = @cid');
        if (!custRes.recordset[0]) return res.status(404).json({ success: false, message: 'العميل غير موجود' });
        const customerName = custRes.recordset[0].customer_name;

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const noteNo = await nextDocNoAsync(txReq);
            const sfx = Math.random().toString(36).substring(2, 9);

            txReq.input('nn_no', sql.NVarChar, noteNo);
            txReq.input('nn_date', sql.NVarChar, date);
            txReq.input('nn_cid', sql.Int, customer_id);
            txReq.input('nn_type', sql.NVarChar, note_type);
            txReq.input('nn_amt', sql.Decimal(18, 2), amountValue);
            txReq.input('nn_reason', sql.NVarChar, reason || '');
            txReq.input('nn_notes', sql.NVarChar, notes || '');
            txReq.input('nn_uid', sql.Int, req.user ? req.user.id : null);

            // 1. Insert note
            const insRes = await txReq.query(`
                INSERT INTO ar_notes (note_no, note_date, customer_id, note_type, amount, reason, notes, status, created_by)
                OUTPUT INSERTED.id
                VALUES (@nn_no, @nn_date, @nn_cid, @nn_type, @nn_amt, @nn_reason, @nn_notes, 'active', @nn_uid)
            `);
            const noteId = insRes.recordset[0].id;

            // 2. Journal entry
            const accAR = await getSystemAccountAsync(txReq, 'SYS_AR');
            if (note_type === 'debit') {
                // Debit Note: DR AR / CR Sales (other income proxy)
                const accRevenue = await getSystemAccountAsync(txReq, 'SYS_SALES');
                const jeLines = [
                    { account_id: accAR, debit: amountValue, credit: 0, description: `إشعار خصم ${noteNo}: ${reason || ''}` },
                    { account_id: accRevenue, debit: 0, credit: amountValue, description: `إشعار خصم للعميل ${customerName} بموجب ${noteNo}` }
                ];
                await postJournalEntryAsync(txReq, date, `إشعار خصم ${noteNo}`, jeLines, 'ar_note', noteId, req.user ? req.user.id : null,
                    { module: 'ar_notes', action: 'create_debit_note', document: noteNo, isSystem: true });
            } else {
                // Credit Note: DR Expense / CR AR
                const accExpense = await getSystemAccountAsync(txReq, 'SYS_EXPENSE');
                const jeLines = [
                    { account_id: accExpense, debit: amountValue, credit: 0, description: `إشعار إضافة للعميل ${customerName} بموجب ${noteNo}` },
                    { account_id: accAR, debit: 0, credit: amountValue, description: `إشعار إضافة ${noteNo}: ${reason || ''}` }
                ];
                await postJournalEntryAsync(txReq, date, `إشعار إضافة ${noteNo}`, jeLines, 'ar_note', noteId, req.user ? req.user.id : null,
                    { module: 'ar_notes', action: 'create_credit_note', document: noteNo, isSystem: true });
            }

            // 3. Recalculate customer balance
            await recalcCustomerBalanceAsync(txReq, customer_id);

            // 4. Log customer activity
            const desc = note_type === 'debit' ? `إشعار خصم ${noteNo} بقيمة ${amountValue}` : `إشعار إضافة ${noteNo} بقيمة ${amountValue}`;
            const pLog = Math.random().toString(36).substring(2, 9);
            txReq.input(`cal_cid_${pLog}`, sql.Int, customer_id);
            txReq.input(`cal_type_${pLog}`, sql.NVarChar, note_type === 'debit' ? 'debit_note' : 'credit_note');
            txReq.input(`cal_desc_${pLog}`, sql.NVarChar, desc);
            txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'ar_note');
            txReq.input(`cal_ri_${pLog}`, sql.Int, noteId);
            txReq.input(`cal_rn_${pLog}`, sql.NVarChar, noteNo);
            txReq.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), note_type === 'debit' ? amountValue : -amountValue);
            txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
            await txReq.query(`
                INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                VALUES (@cal_cid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
            `);

            await tx.commit();

            await logActivity(req, 'CREATE', 'ar_notes', noteNo, desc, null,
                { note_no: noteNo, customer_id, note_type, amount: amountValue }, 'SUCCESS', null);
            res.status(201).json({ success: true, message: 'تم إنشاء الإشعار بنجاح', id: noteId, note_no: noteNo });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AR Note POST', err);
            await logActivity(req, 'CREATE', 'ar_notes', null, 'إنشاء إشعار', null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في إنشاء الإشعار', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AR Note POST (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// ============================================================
// DELETE /:id - Reverse AR Note (عكس الإشعار)
// - لا حذف فعلي، فقط عكس
// - إنشاء قيد عكسي
// - تحديث الرصيد
// - تغيير الحالة إلى reversed
// ============================================================
router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const noteId = parseInt(req.params.id);
        if (!noteId || noteId <= 0) return res.status(400).json({ success: false, message: 'رقم الإشعار غير صالح' });

        const pool = await getPool();
        const noteReq = pool.request();
        noteReq.input('nid', sql.Int, noteId);
        const noteRes = await noteReq.query(`SELECT an.*, c.customer_name FROM ar_notes an LEFT JOIN customers c ON an.customer_id = c.id WHERE an.id = @nid`);
        const note = noteRes.recordset[0];
        if (!note) return res.status(404).json({ success: false, message: 'الإشعار غير موجود' });
        if (note.status === 'reversed') return res.status(400).json({ success: false, message: 'الإشعار ملغي مسبقاً' });

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const sfx = Math.random().toString(36).substring(2, 9);
            txReq.input(`rnid_${sfx}`, sql.Int, noteId);

            // 1. Reverse journal entry
            const jeRes = await txReq.query(`
                SELECT id FROM journal_entries
                WHERE reference_type = 'ar_note' AND reference_id = @rnid_${sfx} AND (is_reversed IS NULL OR is_reversed = 0)
            `);
            if (jeRes.recordset[0]) {
                await reverseJournalEntryAsync(txReq, jeRes.recordset[0].id,
                    `قيد عكسي لإشعار ${note.note_no}`,
                    req.user ? req.user.id : null);
            }

            // 2. Mark note as reversed
            txReq.input(`rev_st_${sfx}`, sql.NVarChar, 'reversed');
            txReq.input(`rev_at_${sfx}`, sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '));
            await txReq.query(`UPDATE ar_notes SET status = @rev_st_${sfx}, reversed_at = @rev_at_${sfx} WHERE id = @rnid_${sfx}`);

            // 3. Recalculate customer balance
            if (note.customer_id) await recalcCustomerBalanceAsync(txReq, note.customer_id);

            // 4. Log customer activity
            const desc = `تم عكس ${note.note_type === 'debit' ? 'إشعار خصم' : 'إشعار إضافة'} ${note.note_no}`;
            if (note.customer_id) {
                const pLog = Math.random().toString(36).substring(2, 9);
                txReq.input(`cal_cid_${pLog}`, sql.Int, note.customer_id);
                txReq.input(`cal_type_${pLog}`, sql.NVarChar, 'note_reversed');
                txReq.input(`cal_desc_${pLog}`, sql.NVarChar, desc);
                txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'ar_note');
                txReq.input(`cal_ri_${pLog}`, sql.Int, noteId);
                txReq.input(`cal_rn_${pLog}`, sql.NVarChar, note.note_no);
                const reversalAmount = note.note_type === 'debit' ? -num(note.amount) : num(note.amount);
                txReq.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), reversalAmount);
                txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
                await txReq.query(`
                    INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                    VALUES (@cal_cid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
                `);
            }

            await tx.commit();

            await logActivity(req, 'DELETE', 'ar_notes', noteId, desc, null,
                { note_no: note.note_no, customer_id: note.customer_id, note_type: note.note_type, amount: note.amount }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم عكس الإشعار بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AR Note DELETE', err);
            await logActivity(req, 'DELETE', 'ar_notes', noteId, `عكس إشعار #${noteId}`, null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في عكس الإشعار', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AR Note DELETE (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

module.exports = router;
