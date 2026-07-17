// ============================================================
// ROUTE: AP Payments (تسديد فواتير الموردين - سندات الدفع)
// ============================================================
const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync, recalcSupplierBalanceAsync } = require('../services/accountingEngine');
const logActivity = require('../middleware/logger');

// ============================================================
// Error Logger Helper
// ============================================================
function logDetailedError(context, err) {
    console.error(`═══ ${context} Error ═══`);
    console.error('  Message:', err.message);
    console.error('  SQL Error No:', err.number || err.code || 'N/A');
    console.error('  Stack:', err.stack);
    console.error('═══════════════════════════════════════');
}

// ============================================================
// Private Helpers
// ============================================================

function num(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

function invoiceDue(inv) {
    const storedRemaining = num(inv.remaining);
    if (storedRemaining > 0) return storedRemaining;
    return Math.max(0, num(inv.grand_total) - num(inv.amount_paid));
}

async function nextDocNoAsync(txRequest, counterName) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`cn_${pRand}`, sql.NVarChar, counterName);
    const row = await txRequest.query(`
        SELECT prefix, last_number FROM invoice_counters WITH (UPDLOCK) WHERE counter_name = @cn_${pRand}
    `);
    if (!row.recordset[0]) {
        await txRequest.query(`INSERT INTO invoice_counters (counter_name, prefix, last_number) VALUES (@cn_${pRand}, 'APP', 1)`);
        return 'APP-0001';
    }
    const next = row.recordset[0].last_number + 1;
    txRequest.input(`cn_next_${pRand}`, sql.Int, next);
    await txRequest.query(`UPDATE invoice_counters SET last_number = @cn_next_${pRand} WHERE counter_name = @cn_${pRand}`);
    return `${row.recordset[0].prefix}-${String(next).padStart(4, '0')}`;
}

async function refreshInvoiceStatusAsync(txRequest, invoiceId) {
    const srfx = Math.random().toString(36).substring(2, 9);
    txRequest.input(`ris_id_${srfx}`, sql.Int, invoiceId);
    const invRes = await txRequest.query(`SELECT * FROM purchase_invoices WHERE id = @ris_id_${srfx}`);
    const inv = invRes.recordset[0];
    if (!inv || inv.status === 'cancelled') return;
    const retRes = await txRequest.query(`SELECT COALESCE(SUM(grand_total),0) as total FROM purchase_returns WHERE invoice_id = @ris_id_${srfx} AND status NOT IN ('cancelled', 'deleted')`);
    const returnsTotal = retRes.recordset[0].total || 0;
    const allocRes = await txRequest.query(`
        SELECT COALESCE(SUM(apa.allocated_amount), 0) as total FROM ap_payment_allocations apa WHERE apa.invoice_id = @ris_id_${srfx}
    `);
    const totalPaid = allocRes.recordset[0].total || 0;
    const remaining = Math.max(0, num(inv.grand_total) - totalPaid - num(returnsTotal));
    let status = 'pending';
    if (remaining <= 0) status = 'paid';
    else if (totalPaid > 0 || num(returnsTotal) > 0) status = 'partial';
    txRequest.input(`ris_rem_${srfx}`, sql.Decimal(18,2), remaining);
    txRequest.input(`ris_stat_${srfx}`, sql.NVarChar, status);
    await txRequest.query(`UPDATE purchase_invoices SET remaining = @ris_rem_${srfx}, status = @ris_stat_${srfx} WHERE id = @ris_id_${srfx}`);
}

async function postTreasuryOutAsync(txRequest, { date, amount, supplierId, documentNo, description, paymentMethod }) {
    if (paymentMethod === 'check') return null;
    const pfx = Math.random().toString(36).substring(2, 9);
    const wantedType = paymentMethod === 'transfer' ? 'bank' : 'cash';
    txRequest.input(`pt_wt_${pfx}`, sql.NVarChar, wantedType);
    let treasRes = await txRequest.query(`SELECT TOP 1 id FROM treasury_accounts WHERE account_type = @pt_wt_${pfx} ORDER BY id`);
    if (treasRes.recordset.length === 0) {
        treasRes = await txRequest.query(`SELECT TOP 1 id FROM treasury_accounts WHERE account_type = 'cash' ORDER BY id`);
    }
    if (treasRes.recordset.length === 0) return null;
    const treasury = treasRes.recordset[0];
    const transNo = await nextDocNoAsync(txRequest, 'treasury');
    txRequest.input(`pt_tn_${pfx}`, sql.NVarChar, transNo);
    txRequest.input(`pt_td_${pfx}`, sql.NVarChar, date);
    txRequest.input(`pt_amt_${pfx}`, sql.Decimal(18,2), amount);
    txRequest.input(`pt_acc_${pfx}`, sql.Int, treasury.id);
    txRequest.input(`pt_sid_${pfx}`, sql.Int, supplierId);
    txRequest.input(`pt_doc_${pfx}`, sql.NVarChar, documentNo);
    txRequest.input(`pt_desc_${pfx}`, sql.NVarChar, description);
    await txRequest.query(`
        INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
        VALUES (@pt_tn_${pfx}, @pt_td_${pfx}, 'out', @pt_amt_${pfx}, @pt_acc_${pfx}, 'supplier', @pt_sid_${pfx}, @pt_doc_${pfx}, @pt_desc_${pfx})
    `);
    await txRequest.query(`UPDATE treasury_accounts SET current_balance = current_balance - @pt_amt_${pfx} WHERE id = @pt_acc_${pfx}`);
    return transNo;
}

async function allocatePaymentAsync(txRequest, supplierId, paymentId, amount, applyToInvoices = null) {
    let remaining = num(amount);
    const pfx = Math.random().toString(36).substring(2, 9);
    const explicit = Array.isArray(applyToInvoices) && applyToInvoices.length > 0;
    let invoices = [];
    if (explicit) {
        for (let i = 0; i < applyToInvoices.length; i++) {
            const item = applyToInvoices[i];
            const id = item.id || item.invoice_id;
            const sf = pfx + i;
            txRequest.input(`al_invid_${sf}`, sql.Int, id);
            txRequest.input(`al_sid_${sf}`, sql.Int, supplierId);
            const invRes = await txRequest.query(`
                SELECT id, grand_total, amount_paid, remaining FROM purchase_invoices
                WHERE id = @al_invid_${sf} AND supplier_id = @al_sid_${sf} AND status NOT IN ('cancelled', 'deleted')
            `);
            const inv = invRes.recordset[0];
            if (inv) { inv.requested_amount = item.amount || item.apply_amount || item.remaining; invoices.push(inv); }
        }
    } else {
        txRequest.input(`al_sid_all_${pfx}`, sql.Int, supplierId);
        const invRes = await txRequest.query(`
            SELECT id, grand_total, amount_paid, remaining FROM purchase_invoices
            WHERE supplier_id = @al_sid_all_${pfx} AND status NOT IN ('cancelled', 'deleted') AND remaining > 0
            ORDER BY invoice_date ASC, id ASC
        `);
        invoices = invRes.recordset;
    }
    for (let i = 0; i < invoices.length; i++) {
        if (remaining <= 0) break;
        const inv = invoices[i];
        const due = invoiceDue(inv);
        const requested = explicit ? num(inv.requested_amount || due) : due;
        const applyAmount = Math.min(remaining, due, requested);
        if (applyAmount <= 0) continue;
        const sf = pfx + i + '_apply';
        txRequest.input(`al_payid_${sf}`, sql.Int, paymentId);
        txRequest.input(`al_invid_ap_${sf}`, sql.Int, inv.id);
        txRequest.input(`al_amt_${sf}`, sql.Decimal(18,2), applyAmount);
        await txRequest.query(`INSERT INTO ap_payment_allocations (payment_id, invoice_id, allocated_amount) VALUES (@al_payid_${sf}, @al_invid_ap_${sf}, @al_amt_${sf})`);
        await txRequest.query(`
            UPDATE purchase_invoices SET amount_paid = amount_paid + @al_amt_${sf},
                remaining = CASE WHEN remaining - @al_amt_${sf} < 0 THEN 0 ELSE remaining - @al_amt_${sf} END
            WHERE id = @al_invid_ap_${sf}
        `);
        await refreshInvoiceStatusAsync(txRequest, inv.id);
        remaining -= applyAmount;
    }
}

// ============================================================
// Existing GET endpoints (unchanged)
// ============================================================
router.get('/', async (req, res) => {
    try {
        const { q, supplier_id, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT ap.*, s.supplier_name FROM ap_payments ap LEFT JOIN suppliers s ON ap.supplier_id = s.id WHERE 1=1`;
        if (q) { sqlQuery += ` AND (ap.payment_no LIKE @q OR s.supplier_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (supplier_id) { sqlQuery += ` AND ap.supplier_id = @sid`; request.input('sid', sql.Int, supplier_id); }
        if (from) { sqlQuery += ` AND ap.payment_date >= @from`; request.input('from', sql.Date, from); }
        if (to) { sqlQuery += ` AND ap.payment_date <= @to`; request.input('to', sql.Date, to); }
        sqlQuery += ` ORDER BY ap.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logDetailedError('AP Payments GET', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب تسديدات الموردين', error_detail: err.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('pid', sql.Int, req.params.id);
        const ret = await request.query(`SELECT ap.*, s.supplier_name FROM ap_payments ap LEFT JOIN suppliers s ON ap.supplier_id = s.id WHERE ap.id = @pid`);
        if (!ret.recordset[0]) return res.status(404).json({ success: false, message: 'الدفعة غير موجودة' });
        const allocs = await request.query(`SELECT a.*, pi.invoice_no FROM ap_payment_allocations a LEFT JOIN purchase_invoices pi ON a.invoice_id = pi.id WHERE a.payment_id = @pid`);
        res.json({ success: true, data: { ...ret.recordset[0], allocations: allocs.recordset } });
    } catch (err) {
        logDetailedError('AP Payment GET detail', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل الدفعة', error_detail: err.message });
    }
});

router.get('/supplier/:id/unpaid', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('sid', sql.Int, req.params.id)
            .query(`SELECT id, invoice_no, invoice_date, grand_total, amount_paid, remaining FROM purchase_invoices WHERE supplier_id = @sid AND status NOT IN ('cancelled', 'deleted') AND remaining > 0 ORDER BY invoice_date`);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logDetailedError('AP Unpaid invoices', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب الفواتير غير المسددة', error_detail: err.message });
    }
});

router.get('/supplier/:id/statement', async (req, res) => {
    try {
        const { from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        request.input('sid', sql.Int, req.params.id);
        let sqlQuery = `
            SELECT d.* FROM (
                SELECT 'invoice' as type, pi.invoice_no as doc_no, pi.invoice_date as doc_date, pi.grand_total as amount, NULL as ref_no
                FROM purchase_invoices pi WHERE pi.supplier_id = @sid AND pi.status NOT IN ('cancelled', 'deleted')
                UNION ALL
                SELECT 'return', pr.return_no, pr.return_date, -pr.grand_total, NULL
                FROM purchase_returns pr WHERE pr.supplier_id = @sid AND pr.status NOT IN ('cancelled', 'deleted')
                UNION ALL
                SELECT 'payment', ap.payment_no, ap.payment_date, -ap.amount, NULL
                FROM ap_payments ap WHERE ap.supplier_id = @sid AND ap.status = 'active'
                UNION ALL
                SELECT 'note', an.note_no, an.note_date, CASE WHEN an.note_type='debit' THEN -an.amount ELSE an.amount END, NULL
                FROM ap_notes an WHERE an.supplier_id = @sid AND an.status = 'active'
            ) d WHERE 1=1
        `;
        if (from) { sqlQuery += ` AND d.doc_date >= @from`; request.input('from', sql.Date, from); }
        if (to) { sqlQuery += ` AND d.doc_date <= @to`; request.input('to', sql.Date, to); }
        sqlQuery += ` ORDER BY d.doc_date, d.doc_no`;
        const result = await request.query(sqlQuery);
        const openingRes = await request.query(`SELECT opening_balance FROM suppliers WHERE id = @sid`);
        const opening = openingRes.recordset[0] ? openingRes.recordset[0].opening_balance || 0 : 0;
        res.json({ success: true, data: result.recordset, opening_balance: opening });
    } catch (err) {
        logDetailedError('AP Statement', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب كشف الحساب', error_detail: err.message });
    }
});

// ============================================================
// POST / - Create AP Payment (تسديد فاتورة مورد)
// قيد اليومية: من حـ/ الموردين (SYS_AP) / إلى حـ/ النقدية (SYS_CASH/SYS_BANK)
// ============================================================
router.post('/', asyncHandler(async (req, res) => {
    try {
        const { supplier_id, payment_no, payment_date, amount, payment_method, check_no, check_date, bank_name, notes, apply_to_invoices } = req.body;
        const amountValue = num(amount);
        const method = payment_method || 'cash';
        const date = payment_date || new Date().toISOString().slice(0, 10);

        if (!supplier_id) return res.status(400).json({ success: false, message: 'المورد مطلوب' });
        if (amountValue <= 0) return res.status(400).json({ success: false, message: 'قيمة التسديد يجب أن تكون أكبر من صفر' });

        const pool = await getPool();

        if (payment_no) {
            const checkReq = pool.request();
            checkReq.input('pno', sql.NVarChar, payment_no);
            const existingRes = await checkReq.query('SELECT id FROM ap_payments WHERE payment_no = @pno');
            if (existingRes.recordset.length > 0) {
                await logActivity(req, 'CREATE', 'ap_payments', payment_no, 'تسديد فاتورة مورد', null, null, 'FAILED', 'رقم السند مسجل مسبقاً');
                return res.status(400).json({ success: false, code: 'DUPLICATE_PAYMENT_NO', message: 'رقم السند مسجل مسبقاً' });
            }
        }

        const suppReq = pool.request();
        suppReq.input('sid', sql.Int, supplier_id);
        const suppRes = await suppReq.query('SELECT id, supplier_name FROM suppliers WHERE id = @sid');
        const supplier = suppRes.recordset[0];
        if (!supplier) return res.status(404).json({ success: false, message: 'المورد غير موجود' });
        const supplierName = supplier.supplier_name;

        // ── Overpayment Guard ────────────────────────────────────────────
        // Calculate total outstanding balance for this supplier
        const balReq = pool.request();
        balReq.input('bal_sid', sql.Int, supplier_id);
        const balRes = await balReq.query(`
            SELECT ISNULL(SUM(remaining), 0) AS total_remaining
            FROM purchase_invoices
            WHERE supplier_id = @bal_sid
              AND status NOT IN ('cancelled', 'deleted', 'paid')
              AND remaining > 0
        `);
        const totalRemaining = num(balRes.recordset[0]?.total_remaining || 0);

        // If explicit invoices are selected, validate against their specific remaining
        if (Array.isArray(apply_to_invoices) && apply_to_invoices.length > 0) {
            let requestedTotal = 0;
            for (const item of apply_to_invoices) {
                requestedTotal += num(item.amount || item.apply_amount || item.remaining || 0);
            }
            // Allow small rounding difference (0.01)
            if (amountValue > requestedTotal + 0.01) {
                return res.status(400).json({
                    success: false,
                    message: `المبلغ المدخل (${amountValue.toFixed(2)} ج.م) أكبر من مجموع الفواتير المحددة (${requestedTotal.toFixed(2)} ج.م). لا يمكن دفع أكثر مما هو مستحق.`
                });
            }
        } else if (totalRemaining >= 0 && amountValue > totalRemaining + 0.01) {
            // No invoices specified — validate against total supplier balance
            return res.status(400).json({
                success: false,
                message: `المبلغ المدخل (${amountValue.toFixed(2)} ج.م) أكبر من إجمالي مديونية المورد (${totalRemaining.toFixed(2)} ج.م). لا يمكن دفع أكثر مما هو مستحق.`
            });
        }
        // ────────────────────────────────────────────────────────────────

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const payNo = payment_no || await nextDocNoAsync(txReq, 'ap_payments');

            txReq.input('p_payNo', sql.NVarChar, payNo);
            txReq.input('p_sid', sql.Int, supplier_id);
            txReq.input('p_date', sql.NVarChar, date);
            txReq.input('p_amt', sql.Decimal(18, 2), amountValue);
            txReq.input('p_meth', sql.NVarChar, method);
            txReq.input('p_chkno', sql.NVarChar, check_no || null);
            txReq.input('p_chkdate', sql.NVarChar, check_date || null);
            txReq.input('p_bank', sql.NVarChar, bank_name || null);
            txReq.input('p_notes', sql.NVarChar, notes || '');

            const insertRes = await txReq.query(`
                INSERT INTO ap_payments (payment_no, supplier_id, payment_date, amount, payment_method, check_no, check_date, bank_name, notes, status)
                OUTPUT INSERTED.id
                VALUES (@p_payNo, @p_sid, @p_date, @p_amt, @p_meth, @p_chkno, @p_chkdate, @p_bank, @p_notes, 'active')
            `);
            const paymentId = insertRes.recordset[0].id;

            // If check, register in ap_cheques table
            if (method === 'check' && check_no) {
                txReq.input('chk_payid', sql.Int, paymentId);
                await txReq.query(`
                    INSERT INTO ap_cheques (cheque_no, cheque_date, bank_name, amount, supplier_id, payment_id, status, notes)
                    VALUES (@p_chkno, COALESCE(@p_chkdate, @p_date), @p_bank, @p_amt, @p_sid, @chk_payid, 'issued', @p_notes)
                `);
            }

            // Treasury entry for cash/transfer (money OUT)
            await postTreasuryOutAsync(txReq, { date, amount: amountValue, supplierId: supplier_id, documentNo: payNo, description: `تسديد فاتورة مورد ${payNo}`, paymentMethod: method });

            // Allocate to invoices
            await allocatePaymentAsync(txReq, supplier_id, paymentId, amountValue, apply_to_invoices);

            // Recalculate supplier balance
            await recalcSupplierBalanceAsync(txReq, supplier_id);

            // Journal entry: DR SYS_AP / CR Cash(or Bank) — for cash/transfer only
            if (method !== 'check') {
                const accAP = await getSystemAccountAsync(txReq, 'SYS_AP');
                const accCash = await getSystemAccountAsync(txReq, method === 'transfer' ? 'SYS_BANK' : 'SYS_CASH');
                const jeLines = [
                    { account_id: accAP, debit: amountValue, credit: 0, description: `تسديد فاتورة مورد ${payNo}` },
                    { account_id: accCash, debit: 0, credit: amountValue, description: `سداد للمورد ${supplierName} بموجب سند ${payNo}` }
                ];
                await postJournalEntryAsync(txReq, date, `تسديد دفعة ${payNo}`, jeLines, 'ap_payment', paymentId, req.user ? req.user.id : null,
                    { module: 'ap_payments', action: 'create_payment', document: payNo, isSystem: true });
            }

            await tx.commit();
            await logActivity(req, 'CREATE', 'ap_payments', payNo, `سند تسديد ${payNo}`, null, { payment_no: payNo, supplier_id, amount: amountValue, payment_method: method }, 'SUCCESS', null);
            res.status(201).json({ success: true, message: 'تم تسديد فاتورة المورد', id: paymentId, payment_no: payNo });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AP Payment POST', err);
            res.status(500).json({ success: false, message: err.message || 'خطأ في تسديد فاتورة المورد', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AP Payment POST (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// ============================================================
// DELETE /:id - Reverse AP Payment (إلغاء تسديد فاتورة مورد)
// ============================================================
router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const paymentId = parseInt(req.params.id);
        if (!paymentId || paymentId <= 0) return res.status(400).json({ success: false, message: 'رقم الدفعة غير صالح' });

        const pool = await getPool();
        const checkReq = pool.request();
        checkReq.input('pid', sql.Int, paymentId);
        const payRes = await checkReq.query(`SELECT * FROM ap_payments WHERE id = @pid`);
        const payment = payRes.recordset[0];
        if (!payment) return res.status(404).json({ success: false, message: 'الدفعة غير موجودة' });
        if (payment.status === 'reversed') return res.status(400).json({ success: false, message: 'الدفعة ملغية مسبقاً' });

        const suppReq = pool.request();
        suppReq.input('sid', sql.Int, payment.supplier_id);
        const suppRes = await suppReq.query('SELECT supplier_name FROM suppliers WHERE id = @sid');
        const supplierName = suppRes.recordset[0]?.supplier_name || '';

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();
        txReq.input('pid', sql.Int, paymentId);

        try {
            // 1. Restore invoice remaining from allocations
            const allocRes = await txReq.query(`SELECT * FROM ap_payment_allocations WHERE payment_id = @pid`);
            for (const alloc of allocRes.recordset) {
                txReq.input(`inv_restore_${alloc.id}`, sql.Int, alloc.invoice_id);
                txReq.input(`amt_restore_${alloc.id}`, sql.Decimal(18, 2), alloc.allocated_amount);
                await txReq.query(`
                    UPDATE purchase_invoices SET amount_paid = amount_paid - @amt_restore_${alloc.id},
                        remaining = remaining + @amt_restore_${alloc.id} WHERE id = @inv_restore_${alloc.id}
                `);
                await refreshInvoiceStatusAsync(txReq, alloc.invoice_id);
            }

            // 2. Reverse journal entry (cash/transfer only)
            if (payment.payment_method !== 'check') {
                const jeRes = await txReq.query(`
                    SELECT id FROM journal_entries WHERE reference_type = 'ap_payment' AND reference_id = @pid AND (is_reversed IS NULL OR is_reversed = 0)
                `);
                if (jeRes.recordset[0]) {
                    await reverseJournalEntryAsync(txReq, jeRes.recordset[0].id, `قيد عكسي لسند تسديد ${payment.payment_no}`, req.user ? req.user.id : null);
                }
            }

            // 3. Restore treasury (reverse the 'out' transaction)
            if (payment.payment_method !== 'check') {
                const treasRes = await txReq.query(`
                    SELECT id, account_id, amount FROM treasury_transactions
                    WHERE document_no = @pid AND related_type = 'supplier' AND related_id = @pid AND trans_type = 'out'
                `);
                const treasTx = treasRes.recordset[0];
                if (treasTx) {
                    const transNo = await nextDocNoAsync(txReq, 'treasury');
                    txReq.input('rt_tn', sql.NVarChar, transNo);
                    txReq.input('rt_date', sql.NVarChar, new Date().toISOString().slice(0, 10));
                    txReq.input('rt_amt', sql.Decimal(18, 2), payment.amount);
                    txReq.input('rt_acc', sql.Int, treasTx.account_id);
                    txReq.input('rt_sid', sql.Int, payment.supplier_id);
                    txReq.input('rt_doc', sql.NVarChar, `عكس تسديد ${payment.payment_no}`);
                    txReq.input('rt_desc', sql.NVarChar, `عكس تسديد فاتورة مورد ${payment.payment_no}`);
                    await txReq.query(`
                        INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
                        VALUES (@rt_tn, @rt_date, 'in', @rt_amt, @rt_acc, 'supplier', @rt_sid, @rt_doc, @rt_desc)
                    `);
                    await txReq.query(`UPDATE treasury_accounts SET current_balance = current_balance + @rt_amt WHERE id = @rt_acc`);
                }
            }

            // 4. Mark cheque as returned if payment was by cheque
            if (payment.payment_method === 'check' && payment.check_no) {
                txReq.input('chq_no', sql.NVarChar, payment.check_no);
                const chqRes = await txReq.query(`SELECT id FROM ap_cheques WHERE cheque_no = @chq_no AND payment_id = @pid`);
                if (chqRes.recordset[0]) {
                    txReq.input('chq_id', sql.Int, chqRes.recordset[0].id);
                    await txReq.query(`UPDATE ap_cheques SET status = 'returned' WHERE id = @chq_id`);
                }
            }

            // 5. Mark payment as reversed
            txReq.input('rev_status', sql.NVarChar, 'reversed');
            txReq.input('rev_at', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '));
            await txReq.query(`UPDATE ap_payments SET status = @rev_status, reversed_at = @rev_at WHERE id = @pid`);

            // 6. Recalculate supplier balance
            await recalcSupplierBalanceAsync(txReq, payment.supplier_id);

            await tx.commit();
            await logActivity(req, 'DELETE', 'ap_payments', paymentId, `إلغاء سند تسديد ${payment.payment_no}`, null, { payment_no: payment.payment_no, supplier_id: payment.supplier_id, amount: payment.amount }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم إلغاء تسديد فاتورة المورد بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AP Payment DELETE', err);
            res.status(500).json({ success: false, message: err.message || 'خطأ في إلغاء تسديد الفاتورة', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AP Payment DELETE (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// ============================================================
// Matching Endpoints
// ============================================================

// GET /matching/suppliers - Suppliers with outstanding items
router.get('/matching/suppliers', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT DISTINCT s.id, s.supplier_name, s.current_balance FROM suppliers s
            WHERE EXISTS (SELECT 1 FROM ap_payments ap WHERE ap.supplier_id = s.id AND ap.status = 'active'
                AND ap.amount > COALESCE((SELECT SUM(allocated_amount) FROM ap_payment_allocations WHERE payment_id = ap.id), 0))
            OR EXISTS (SELECT 1 FROM purchase_invoices pi WHERE pi.supplier_id = s.id AND pi.status IN ('pending', 'partial') AND pi.remaining > 0)
            ORDER BY s.supplier_name
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logDetailedError('AP Matching suppliers', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب الموردين', error_detail: err.message });
    }
}));

// GET /matching/data/:supplierId - Unmatched payments + unpaid invoices
router.get('/matching/data/:supplierId', asyncHandler(async (req, res) => {
    try {
        const sid = parseInt(req.params.supplierId);
        const pool = await getPool();
        const request = pool.request();
        request.input('sid', sql.Int, sid);
        const paymentsRes = await request.query(`
            SELECT * FROM (
                SELECT ap.id, ap.payment_no, ap.payment_date, ap.amount,
                    COALESCE((SELECT SUM(allocated_amount) FROM ap_payment_allocations WHERE payment_id = ap.id), 0) AS allocated_total,
                    ap.amount - COALESCE((SELECT SUM(allocated_amount) FROM ap_payment_allocations WHERE payment_id = ap.id), 0) AS unallocated
                FROM ap_payments ap WHERE ap.supplier_id = @sid AND ap.status = 'active'
            ) sub WHERE sub.unallocated > 0 ORDER BY sub.payment_date
        `);
        const invoicesRes = await request.query(`
            SELECT pi.id, pi.invoice_no, pi.invoice_date, pi.grand_total, pi.amount_paid, pi.remaining, pi.status
            FROM purchase_invoices pi WHERE pi.supplier_id = @sid AND pi.status IN ('pending', 'partial') AND pi.remaining > 0
            ORDER BY pi.invoice_date
        `);
        res.json({ success: true, data: { payments: paymentsRes.recordset, invoices: invoicesRes.recordset } });
    } catch (err) {
        logDetailedError('AP Matching data', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب بيانات المطابقة', error_detail: err.message });
    }
}));

// POST /matching/save - Save matching allocations
router.post('/matching/save', asyncHandler(async (req, res) => {
    try {
        const { supplier_id, allocations } = req.body;
        if (!supplier_id) return res.status(400).json({ success: false, message: 'المورد مطلوب' });
        if (!Array.isArray(allocations) || allocations.length === 0) return res.status(400).json({ success: false, message: 'يرجى توزيع المبالغ على الفواتير' });
        for (const a of allocations) {
            if (!a.payment_id || !a.invoice_id || a.allocated_amount <= 0)
                return res.status(400).json({ success: false, message: 'بيانات التوزيع غير صالحة', error_detail: `payment_id=${a.payment_id}, invoice_id=${a.invoice_id}, amount=${a.allocated_amount}` });
        }

        const pool = await getPool();
        const suppReq = pool.request();
        suppReq.input('sid', sql.Int, supplier_id);
        const suppRes = await suppReq.query('SELECT id, supplier_name FROM suppliers WHERE id = @sid');
        if (!suppRes.recordset[0]) return res.status(404).json({ success: false, message: 'المورد غير موجود' });
        const supplierName = suppRes.recordset[0].supplier_name;

        const byPayment = {};
        for (const a of allocations) { if (!byPayment[a.payment_id]) byPayment[a.payment_id] = []; byPayment[a.payment_id].push(a); }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();
        try {
            const affectedInvoiceIds = new Set();
            for (const [payIdStr, paymentAllocs] of Object.entries(byPayment)) {
                const paymentId = parseInt(payIdStr);
                const sfx = Math.random().toString(36).substring(2, 9);
                txReq.input(`mp_pid_${sfx}`, sql.Int, paymentId);
                txReq.input(`mp_sid_${sfx}`, sql.Int, supplier_id);
                const payRes = await txReq.query(`
                    SELECT id, payment_no, amount,
                        COALESCE((SELECT SUM(allocated_amount) FROM ap_payment_allocations WHERE payment_id = @mp_pid_${sfx}), 0) AS allocated_total
                    FROM ap_payments WHERE id = @mp_pid_${sfx} AND supplier_id = @mp_sid_${sfx} AND status = 'active'
                `);
                if (!payRes.recordset[0]) throw new Error(`الدفعة رقم ${paymentId} غير موجودة أو ملغية`);
                const payment = payRes.recordset[0];
                const newAllocSum = paymentAllocs.reduce((s, a) => s + num(a.allocated_amount), 0);
                const totalAfter = num(payment.allocated_total) + newAllocSum;
                if (totalAfter > payment.amount) throw new Error(`إجمالي توزيع الدفعة ${payment.payment_no} (${totalAfter}) يتجاوز قيمتها (${payment.amount})`);

                for (let i = 0; i < paymentAllocs.length; i++) {
                    const a = paymentAllocs[i];
                    const asfx = sfx + '_n' + i;
                    txReq.input(`mp_npid_${asfx}`, sql.Int, paymentId);
                    txReq.input(`mp_niid_${asfx}`, sql.Int, a.invoice_id);
                    txReq.input(`mp_namt_${asfx}`, sql.Decimal(18, 2), a.allocated_amount);
                    const invRes = await txReq.query(`
                        SELECT id, invoice_no, grand_total, amount_paid, remaining, status FROM purchase_invoices
                        WHERE id = @mp_niid_${asfx} AND supplier_id = @mp_sid_${sfx}
                    `);
                    if (!invRes.recordset[0]) throw new Error(`الفاتورة رقم ${a.invoice_id} غير موجودة لهذا المورد`);
                    const inv = invRes.recordset[0];
                    if (inv.status === 'cancelled' || inv.status === 'deleted') throw new Error(`لا يمكن توزيع المبلغ على فاتورة ملغية (${inv.invoice_no})`);
                    if (a.allocated_amount > inv.remaining) throw new Error(`المبلغ الموزع (${a.allocated_amount}) يتجاوز المتبقي من الفاتورة ${inv.invoice_no} (${inv.remaining})`);
                    await txReq.query(`INSERT INTO ap_payment_allocations (payment_id, invoice_id, allocated_amount) VALUES (@mp_npid_${asfx}, @mp_niid_${asfx}, @mp_namt_${asfx})`);
                    await txReq.query(`
                        UPDATE purchase_invoices SET amount_paid = amount_paid + @mp_namt_${asfx},
                            remaining = CASE WHEN remaining - @mp_namt_${asfx} < 0 THEN 0 ELSE remaining - @mp_namt_${asfx} END
                        WHERE id = @mp_niid_${asfx}
                    `);
                    affectedInvoiceIds.add(a.invoice_id);
                }
            }
            for (const invId of affectedInvoiceIds) {
                const srfx = Math.random().toString(36).substring(2, 9);
                txRequest.input(`ris_id_${srfx}`, sql.Int, invId);
                const invRes = await txRequest.query(`SELECT * FROM purchase_invoices WHERE id = @ris_id_${srfx}`);
                const inv = invRes.recordset[0];
                if (inv && inv.status !== 'cancelled') {
                    const retRes = await txRequest.query(`SELECT COALESCE(SUM(grand_total),0) as total FROM purchase_returns WHERE invoice_id = @ris_id_${srfx} AND status NOT IN ('cancelled', 'deleted')`);
                    const rTotal = retRes.recordset[0].total || 0;
                    const aRes = await txRequest.query(`SELECT COALESCE(SUM(allocated_amount), 0) as total FROM ap_payment_allocations WHERE invoice_id = @ris_id_${srfx}`);
                    const tPaid = aRes.recordset[0].total || 0;
                    const rem = Math.max(0, num(inv.grand_total) - tPaid - num(rTotal));
                    let st = 'pending';
                    if (rem <= 0) st = 'paid';
                    else if (tPaid > 0 || num(rTotal) > 0) st = 'partial';
                    txRequest.input(`ris_rem_${srfx}`, sql.Decimal(18,2), rem);
                    txRequest.input(`ris_stat_${srfx}`, sql.NVarChar, st);
                    await txRequest.query(`UPDATE purchase_invoices SET remaining = @ris_rem_${srfx}, status = @ris_stat_${srfx} WHERE id = @ris_id_${srfx}`);
                }
            }
            await tx.commit();
            await logActivity(req, 'CREATE', 'ap_payment_matching', null, `مطابقة سداد مع فواتير للمورد ${supplierName}`, null, { supplier_id, supplier_name: supplierName, allocation_count: allocations.length, total: allocations.reduce((s, a) => s + num(a.allocated_amount), 0) }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم حفظ المطابقة بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AP Matching save', err);
            res.status(500).json({ success: false, message: err.message || 'خطأ في حفظ المطابقة', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AP Matching save (outer)', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

module.exports = router;
