const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync, recalcSupplierBalanceAsync } = require('../services/accountingEngine');
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

async function nextDocNoAsync(txRequest) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`cn_${pRand}`, sql.NVarChar, 'ap_notes');
    const row = await txRequest.query(`
        SELECT prefix, last_number FROM invoice_counters WITH (UPDLOCK) WHERE counter_name = @cn_${pRand}
    `);
    if (!row.recordset[0]) {
        await txRequest.query(`INSERT INTO invoice_counters (counter_name, prefix, last_number) VALUES (@cn_${pRand}, 'APN', 1)`);
        return 'APN-0001';
    }
    const next = row.recordset[0].last_number + 1;
    txRequest.input(`cn_next_${pRand}`, sql.Int, next);
    await txRequest.query(`UPDATE invoice_counters SET last_number = @cn_next_${pRand} WHERE counter_name = @cn_${pRand}`);
    return `${row.recordset[0].prefix}-${String(next).padStart(4, '0')}`;
}

router.get('/', asyncHandler(async (req, res) => {
    try {
        const { q, supplier_id, note_type, status, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT an.*, s.supplier_name, u.username FROM ap_notes an LEFT JOIN suppliers s ON an.supplier_id = s.id LEFT JOIN users u ON an.created_by = u.id WHERE 1=1`;
        if (q) { sqlQuery += ` AND (an.note_no LIKE @q OR s.supplier_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (supplier_id) { sqlQuery += ` AND an.supplier_id = @sid`; request.input('sid', sql.Int, supplier_id); }
        if (note_type) { sqlQuery += ` AND an.note_type = @nt`; request.input('nt', sql.NVarChar, note_type); }
        if (status) { sqlQuery += ` AND an.status = @st`; request.input('st', sql.NVarChar, status); }
        if (from) { sqlQuery += ` AND an.note_date >= @fr`; request.input('fr', sql.Date, from); }
        if (to) { sqlQuery += ` AND an.note_date <= @tr`; request.input('tr', sql.Date, to); }
        sqlQuery += ` ORDER BY an.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logDetailedError('AP Notes GET', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب إشعارات الموردين', error_detail: err.message });
    }
}));

router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('nid', sql.Int, req.params.id)
            .query(`SELECT an.*, s.supplier_name FROM ap_notes an LEFT JOIN suppliers s ON an.supplier_id = s.id WHERE an.id = @nid`);
        if (!result.recordset[0]) return res.status(404).json({ success: false, message: 'الإشعار غير موجود' });
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        logDetailedError('AP Note GET detail', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل الإشعار', error_detail: err.message });
    }
}));

router.post('/', asyncHandler(async (req, res) => {
    try {
        const { supplier_id, note_type, amount, reason, notes, note_date } = req.body;
        const amountValue = num(amount);
        const date = note_date || new Date().toISOString().slice(0, 10);

        if (!supplier_id) return res.status(400).json({ success: false, message: 'المورد مطلوب' });
        if (!note_type || !['debit', 'credit'].includes(note_type)) return res.status(400).json({ success: false, message: 'نوع الإشعار مطلوب (debit / credit)' });
        if (amountValue <= 0) return res.status(400).json({ success: false, message: 'القيمة يجب أن تكون أكبر من صفر' });

        const pool = await getPool();
        const suppReq = pool.request();
        suppReq.input('sid', sql.Int, supplier_id);
        const suppRes = await suppReq.query('SELECT id, supplier_name FROM suppliers WHERE id = @sid');
        if (!suppRes.recordset[0]) return res.status(404).json({ success: false, message: 'المورد غير موجود' });
        const supplierName = suppRes.recordset[0].supplier_name;

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const noteNo = await nextDocNoAsync(txReq);
            const sfx = Math.random().toString(36).substring(2, 9);

            txReq.input('nn_no', sql.NVarChar, noteNo);
            txReq.input('nn_date', sql.NVarChar, date);
            txReq.input('nn_sid', sql.Int, supplier_id);
            txReq.input('nn_type', sql.NVarChar, note_type);
            txReq.input('nn_amt', sql.Decimal(18, 2), amountValue);
            txReq.input('nn_reason', sql.NVarChar, reason || '');
            txReq.input('nn_notes', sql.NVarChar, notes || '');
            txReq.input('nn_uid', sql.Int, req.user ? req.user.id : null);

            const insRes = await txReq.query(`
                INSERT INTO ap_notes (note_no, note_date, supplier_id, note_type, amount, reason, notes, status, created_by)
                OUTPUT INSERTED.id
                VALUES (@nn_no, @nn_date, @nn_sid, @nn_type, @nn_amt, @nn_reason, @nn_notes, 'active', @nn_uid)
            `);
            const noteId = insRes.recordset[0].id;

            // Journal entry
            const accAP = await getSystemAccountAsync(txReq, 'SYS_AP');
            if (note_type === 'debit') {
                // Debit Note: DR Expense / CR SYS_AP — increases supplier balance (we owe more)
                const accExpense = await getSystemAccountAsync(txReq, 'SYS_EXPENSE');
                const jeLines = [
                    { account_id: accExpense, debit: amountValue, credit: 0, description: `إشعار خصم ${noteNo}: ${reason || ''}` },
                    { account_id: accAP, debit: 0, credit: amountValue, description: `إشعار خصم من المورد ${supplierName} بموجب ${noteNo}` }
                ];
                await postJournalEntryAsync(txReq, date, `إشعار خصم ${noteNo}`, jeLines, 'ap_note', noteId, req.user ? req.user.id : null,
                    { module: 'ap_notes', action: 'create_debit_note', document: noteNo, isSystem: true });
            } else {
                // Credit Note: DR SYS_AP / CR Sales — decreases supplier balance (we owe less)
                const accRevenue = await getSystemAccountAsync(txReq, 'SYS_SALES');
                const jeLines = [
                    { account_id: accAP, debit: amountValue, credit: 0, description: `إشعار إضافة ${noteNo}: ${reason || ''}` },
                    { account_id: accRevenue, debit: 0, credit: amountValue, description: `إشعار إضافة للمورد ${supplierName} بموجب ${noteNo}` }
                ];
                await postJournalEntryAsync(txReq, date, `إشعار إضافة ${noteNo}`, jeLines, 'ap_note', noteId, req.user ? req.user.id : null,
                    { module: 'ap_notes', action: 'create_credit_note', document: noteNo, isSystem: true });
            }

            // Recalculate supplier balance
            await recalcSupplierBalanceAsync(txReq, supplier_id);

            // Log supplier activity
            const desc = note_type === 'debit' ? `إشعار خصم ${noteNo} بقيمة ${amountValue}` : `إشعار إضافة ${noteNo} بقيمة ${amountValue}`;
            const pLog = Math.random().toString(36).substring(2, 9);
            txReq.input(`cal_sid_${pLog}`, sql.Int, supplier_id);
            txReq.input(`cal_type_${pLog}`, sql.NVarChar, note_type === 'debit' ? 'debit_note' : 'credit_note');
            txReq.input(`cal_desc_${pLog}`, sql.NVarChar, desc);
            txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'ap_note');
            txReq.input(`cal_ri_${pLog}`, sql.Int, noteId);
            txReq.input(`cal_rn_${pLog}`, sql.NVarChar, noteNo);
            // debit note → positive (increases balance), credit note → negative (decreases balance)
            txReq.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), note_type === 'debit' ? amountValue : -amountValue);
            txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
            await txReq.query(`
                INSERT INTO supplier_activity_log (supplier_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                VALUES (@cal_sid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
            `);

            await tx.commit();

            await logActivity(req, 'CREATE', 'ap_notes', noteNo, desc, null,
                { note_no: noteNo, supplier_id, note_type, amount: amountValue }, 'SUCCESS', null);
            res.status(201).json({ success: true, message: 'تم إنشاء الإشعار بنجاح', id: noteId, note_no: noteNo });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AP Note POST', err);
            await logActivity(req, 'CREATE', 'ap_notes', null, 'إنشاء إشعار', null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في إنشاء الإشعار', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AP Note POST (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const noteId = parseInt(req.params.id);
        if (!noteId || noteId <= 0) return res.status(400).json({ success: false, message: 'رقم الإشعار غير صالح' });

        const pool = await getPool();
        const noteReq = pool.request();
        noteReq.input('nid', sql.Int, noteId);
        const noteRes = await noteReq.query(`SELECT an.*, s.supplier_name FROM ap_notes an LEFT JOIN suppliers s ON an.supplier_id = s.id WHERE an.id = @nid`);
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
                WHERE reference_type = 'ap_note' AND reference_id = @rnid_${sfx} AND (is_reversed IS NULL OR is_reversed = 0)
            `);
            if (jeRes.recordset[0]) {
                await reverseJournalEntryAsync(txReq, jeRes.recordset[0].id,
                    `قيد عكسي لإشعار ${note.note_no}`,
                    req.user ? req.user.id : null);
            }

            // 2. Mark note as reversed
            txReq.input(`rev_st_${sfx}`, sql.NVarChar, 'reversed');
            txReq.input(`rev_at_${sfx}`, sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '));
            await txReq.query(`UPDATE ap_notes SET status = @rev_st_${sfx}, reversed_at = @rev_at_${sfx} WHERE id = @rnid_${sfx}`);

            // 3. Recalculate supplier balance
            if (note.supplier_id) await recalcSupplierBalanceAsync(txReq, note.supplier_id);

            // 4. Log supplier activity
            const desc = `تم عكس ${note.note_type === 'debit' ? 'إشعار خصم' : 'إشعار إضافة'} ${note.note_no}`;
            if (note.supplier_id) {
                const pLog = Math.random().toString(36).substring(2, 9);
                txReq.input(`cal_sid_${pLog}`, sql.Int, note.supplier_id);
                txReq.input(`cal_type_${pLog}`, sql.NVarChar, 'note_reversed');
                txReq.input(`cal_desc_${pLog}`, sql.NVarChar, desc);
                txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'ap_note');
                txReq.input(`cal_ri_${pLog}`, sql.Int, noteId);
                txReq.input(`cal_rn_${pLog}`, sql.NVarChar, note.note_no);
                // Reverse the sign: debit_note was +amount, reversal is -amount; credit_note was -amount, reversal is +amount
                const reversalAmount = note.note_type === 'debit' ? -num(note.amount) : num(note.amount);
                txReq.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), reversalAmount);
                txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
                await txReq.query(`
                    INSERT INTO supplier_activity_log (supplier_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                    VALUES (@cal_sid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
                `);
            }

            await tx.commit();

            await logActivity(req, 'DELETE', 'ap_notes', noteId, desc, null,
                { note_no: note.note_no, supplier_id: note.supplier_id, note_type: note.note_type, amount: note.amount }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم عكس الإشعار بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AP Note DELETE', err);
            await logActivity(req, 'DELETE', 'ap_notes', noteId, `عكس إشعار #${noteId}`, null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في عكس الإشعار', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AP Note DELETE (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

module.exports = router;
