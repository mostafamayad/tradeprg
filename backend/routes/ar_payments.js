// ============================================================
// ROUTE: AR Payments (تسديد فواتير المبيعات - سندات القبض)
// ============================================================
const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync, recalcCustomerBalanceAsync } = require('../services/accountingEngine');
const logActivity = require('../middleware/logger');

// ============================================================
// Error Logger Helper
// ============================================================
function logDetailedError(context, err) {
    console.error(`═══ ${context} Error ═══`);
    console.error('  Message:', err.message);
    console.error('  SQL Error No:', err.number || err.code || 'N/A');
    console.error('  SQL State:', err.state || 'N/A');
    console.error('  SQL:', err.sql || 'N/A');
    console.error('  Original:', err.originalError ? err.originalError.message : 'N/A');
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
        SELECT prefix, last_number 
        FROM invoice_counters WITH (UPDLOCK) 
        WHERE counter_name = @cn_${pRand}
    `);
    if (!row.recordset[0]) {
        await txRequest.query(`
            INSERT INTO invoice_counters (counter_name, prefix, last_number) 
            VALUES (@cn_${pRand}, 'ARP', 1)
        `);
        return 'ARP-0001';
    }
    const next = row.recordset[0].last_number + 1;
    txRequest.input(`cn_next_${pRand}`, sql.Int, next);
    await txRequest.query(`
        UPDATE invoice_counters 
        SET last_number = @cn_next_${pRand} 
        WHERE counter_name = @cn_${pRand}
    `);
    return `${row.recordset[0].prefix}-${String(next).padStart(4, '0')}`;
}

async function refreshInvoiceStatusAsync(txRequest, invoiceId) {
    const srfx = Math.random().toString(36).substring(2, 9);
    txRequest.input(`ris_id_${srfx}`, sql.Int, invoiceId);
    
    const invRes = await txRequest.query(`SELECT * FROM sales_invoices WHERE id = @ris_id_${srfx}`);
    const inv = invRes.recordset[0];
    if (!inv || inv.status === 'cancelled') return;

    const retRes = await txRequest.query(`SELECT COALESCE(SUM(grand_total),0) as total FROM sales_returns WHERE invoice_id = @ris_id_${srfx} AND status NOT IN ('cancelled', 'deleted')`);
    const returnsTotal = retRes.recordset[0].total || 0;

    // Sum allocations from both collection_allocations and ar_payment_allocations
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
    if (remaining <= 0) {
        status = 'paid';
    } else if (totalPaid > 0 || num(returnsTotal) > 0) {
        status = 'partial';
    }

    txRequest.input(`ris_rem_${srfx}`, sql.Decimal(18,2), remaining);
    txRequest.input(`ris_stat_${srfx}`, sql.NVarChar, status);
    await txRequest.query(`UPDATE sales_invoices SET remaining = @ris_rem_${srfx}, status = @ris_stat_${srfx} WHERE id = @ris_id_${srfx}`);
}

async function postTreasuryInAsync(txRequest, { date, amount, customerId, documentNo, description, paymentMethod }) {
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
    txRequest.input(`pt_cid_${pfx}`, sql.Int, customerId);
    txRequest.input(`pt_doc_${pfx}`, sql.NVarChar, documentNo);
    txRequest.input(`pt_desc_${pfx}`, sql.NVarChar, description);

    await txRequest.query(`
        INSERT INTO treasury_transactions 
        (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
        VALUES (@pt_tn_${pfx}, @pt_td_${pfx}, 'in', @pt_amt_${pfx}, @pt_acc_${pfx}, 'customer', @pt_cid_${pfx}, @pt_doc_${pfx}, @pt_desc_${pfx})
    `);

    await txRequest.query(`UPDATE treasury_accounts SET current_balance = current_balance + @pt_amt_${pfx} WHERE id = @pt_acc_${pfx}`);

    return transNo;
}

async function allocatePaymentAsync(txRequest, customerId, paymentId, amount, applyToInvoices = null) {
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
            txRequest.input(`al_cid_${sf}`, sql.Int, customerId);
            const invRes = await txRequest.query(`
                SELECT id, grand_total, amount_paid, remaining 
                FROM sales_invoices 
                WHERE id = @al_invid_${sf} AND customer_id = @al_cid_${sf} AND status NOT IN ('cancelled', 'deleted')
            `);
            const inv = invRes.recordset[0];
            if (inv) {
                inv.requested_amount = item.amount || item.apply_amount || item.remaining;
                invoices.push(inv);
            }
        }
    } else {
        txRequest.input(`al_cid_all_${pfx}`, sql.Int, customerId);
        const invRes = await txRequest.query(`
            SELECT id, grand_total, amount_paid, remaining
            FROM sales_invoices
            WHERE customer_id = @al_cid_all_${pfx} AND status NOT IN ('cancelled', 'deleted') AND remaining > 0
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

        await txRequest.query(`
            INSERT INTO ar_payment_allocations (payment_id, invoice_id, allocated_amount)
            VALUES (@al_payid_${sf}, @al_invid_ap_${sf}, @al_amt_${sf})
        `);

        await txRequest.query(`
            UPDATE sales_invoices
            SET amount_paid = amount_paid + @al_amt_${sf}, 
                remaining = CASE WHEN remaining - @al_amt_${sf} < 0 THEN 0 ELSE remaining - @al_amt_${sf} END
            WHERE id = @al_invid_ap_${sf}
        `);

        await refreshInvoiceStatusAsync(txRequest, inv.id);

        remaining -= applyAmount;
    }
}

// ============================================================
// GET / - List AR Payments
// ============================================================
router.get('/', asyncHandler(async (req, res) => {
    try {
        const { q, customer_id, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT ap.*, c.customer_name FROM ar_payments ap LEFT JOIN customers c ON ap.customer_id = c.id WHERE 1=1`;
        if (q) { sqlQuery += ` AND (ap.payment_no LIKE @q OR c.customer_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (customer_id) { sqlQuery += ` AND ap.customer_id = @cid`; request.input('cid', sql.Int, customer_id); }
        if (from) { sqlQuery += ` AND ap.payment_date >= @from`; request.input('from', sql.Date, from); }
        if (to) { sqlQuery += ` AND ap.payment_date <= @to`; request.input('to', sql.Date, to); }
        sqlQuery += ` ORDER BY ap.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logDetailedError('AR Payments GET', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب تسديدات العملاء', error_detail: err.message });
    }
}));

// ============================================================
// GET /:id - Get AR Payment Detail
// ============================================================
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('pid', sql.Int, req.params.id);
        const ret = await request.query(`SELECT ap.*, c.customer_name FROM ar_payments ap LEFT JOIN customers c ON ap.customer_id = c.id WHERE ap.id = @pid`);
        if (!ret.recordset[0]) return res.status(404).json({ success: false, message: 'الدفعة غير موجودة' });
        const allocs = await request.query(`SELECT a.*, si.invoice_no FROM ar_payment_allocations a LEFT JOIN sales_invoices si ON a.invoice_id = si.id WHERE a.payment_id = @pid`);
        res.json({ success: true, data: { ...ret.recordset[0], allocations: allocs.recordset } });
    } catch (err) {
        logDetailedError('AR Payment GET detail', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل الدفعة', error_detail: err.message });
    }
}));

// ============================================================
// GET /customer/:id/unpaid - Unpaid Invoices for Customer
// ============================================================
router.get('/customer/:id/unpaid', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('cid', sql.Int, req.params.id)
            .query(`SELECT id, invoice_no, invoice_date, grand_total, amount_paid, remaining FROM sales_invoices WHERE customer_id = @cid AND status NOT IN ('cancelled', 'deleted') AND remaining > 0 ORDER BY invoice_date`);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logDetailedError('AR Unpaid invoices', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب الفواتير غير المسددة', error_detail: err.message });
    }
}));

// ============================================================
// GET /customer/:id/statement - Customer Statement
// ============================================================
router.get('/customer/:id/statement', asyncHandler(async (req, res) => {
    try {
        const { from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        request.input('cid', sql.Int, req.params.id);
        let sqlQuery = `
            SELECT d.* FROM (
                SELECT 'invoice' as type, si.invoice_no as doc_no, si.invoice_date as doc_date, si.grand_total as amount, NULL as ref_no
                FROM sales_invoices si WHERE si.customer_id = @cid AND si.status NOT IN ('cancelled', 'deleted')
                UNION ALL
                SELECT 'return', sr.return_no, sr.return_date, -sr.grand_total, NULL
                FROM sales_returns sr WHERE sr.customer_id = @cid AND sr.status NOT IN ('cancelled', 'deleted')
                UNION ALL
                SELECT 'payment', ap.payment_no, ap.payment_date, -ap.amount, NULL
                FROM ar_payments ap WHERE ap.customer_id = @cid AND ap.status = 'active'
                UNION ALL
                SELECT 'note', an.note_no, an.note_date, CASE WHEN an.note_type='debit' THEN an.amount ELSE -an.amount END, NULL
                FROM ar_notes an WHERE an.customer_id = @cid AND an.status = 'active'
            ) d WHERE 1=1
        `;
        if (from) { sqlQuery += ` AND d.doc_date >= @from`; request.input('from', sql.Date, from); }
        if (to) { sqlQuery += ` AND d.doc_date <= @to`; request.input('to', sql.Date, to); }
        sqlQuery += ` ORDER BY d.doc_date, d.doc_no`;
        const result = await request.query(sqlQuery);
        const openingRes = await request.query(`SELECT opening_balance FROM customers WHERE id = @cid`);
        const opening = openingRes.recordset[0] ? openingRes.recordset[0].opening_balance || 0 : 0;
        res.json({ success: true, data: result.recordset, opening_balance: opening });
    } catch (err) {
        logDetailedError('AR Statement', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب كشف الحساب', error_detail: err.message });
    }
}));

// ============================================================
// POST / - Create AR Payment (تسديد فاتورة مبيعات)
// ============================================================
router.post('/', asyncHandler(async (req, res) => {
    try {
        const { customer_id, payment_no, payment_date, amount, payment_method, check_no, check_date, bank_name, notes, apply_to_invoices } = req.body;
        const amountValue = num(amount);
        const method = payment_method || 'cash';
        const date = payment_date || new Date().toISOString().slice(0, 10);

        if (!customer_id) {
            await logActivity(req, 'CREATE', 'ar_payments', null, 'تسديد فاتورة مبيعات', null, null, 'FAILED', 'العميل مطلوب');
            return res.status(400).json({ success: false, message: 'العميل مطلوب' });
        }
        if (amountValue <= 0) {
            await logActivity(req, 'CREATE', 'ar_payments', null, 'تسديد فاتورة مبيعات', null, null, 'FAILED', 'القيمة يجب أن تكون أكبر من صفر');
            return res.status(400).json({ success: false, message: 'قيمة التسديد يجب أن تكون أكبر من صفر' });
        }

        const pool = await getPool();

        if (payment_no) {
            const checkReq = pool.request();
            checkReq.input('pno', sql.NVarChar, payment_no);
            const existingRes = await checkReq.query('SELECT id FROM ar_payments WHERE payment_no = @pno');
            if (existingRes.recordset.length > 0) {
                await logActivity(req, 'CREATE', 'ar_payments', payment_no, 'تسديد فاتورة مبيعات', null, null, 'FAILED', 'رقم السند مسجل مسبقاً');
                return res.status(400).json({ success: false, code: 'DUPLICATE_PAYMENT_NO', message: 'رقم السند مسجل مسبقاً' });
            }
        }

        const custReq = pool.request();
        custReq.input('cid', sql.Int, customer_id);
        const custRes = await custReq.query('SELECT id, current_balance FROM customers WHERE id = @cid');
        const customer = custRes.recordset[0];
        if (!customer) {
            await logActivity(req, 'CREATE', 'ar_payments', payment_no || null, 'تسديد فاتورة مبيعات', null, null, 'FAILED', 'العميل غير موجود');
            return res.status(404).json({ success: false, message: 'العميل غير موجود' });
        }

        // ── Overpayment Guard ────────────────────────────────────────────
        const arBalReq = pool.request();
        arBalReq.input('ar_bal_cid', sql.Int, customer_id);
        const arBalRes = await arBalReq.query(`
            SELECT ISNULL(SUM(remaining), 0) AS total_remaining
            FROM sales_invoices
            WHERE customer_id = @ar_bal_cid
              AND status NOT IN ('cancelled', 'deleted', 'paid')
              AND remaining > 0
        `);
        const arTotalRemaining = num(arBalRes.recordset[0]?.total_remaining || 0);

        if (Array.isArray(apply_to_invoices) && apply_to_invoices.length > 0) {
            let requestedTotal = 0;
            for (const item of apply_to_invoices) {
                requestedTotal += num(item.amount || item.apply_amount || item.remaining || 0);
            }
            if (amountValue > requestedTotal + 0.01) {
                return res.status(400).json({
                    success: false,
                    message: `المبلغ المدخل (${amountValue.toFixed(2)} ج.م) أكبر من مجموع الفواتير المحددة (${requestedTotal.toFixed(2)} ج.م). لا يمكن تحصيل أكثر مما هو مستحق.`
                });
            }
        } else if (arTotalRemaining >= 0 && amountValue > arTotalRemaining + 0.01) {
            return res.status(400).json({
                success: false,
                message: `المبلغ المدخل (${amountValue.toFixed(2)} ج.م) أكبر من إجمالي مديونية العميل (${arTotalRemaining.toFixed(2)} ج.م). لا يمكن تحصيل أكثر مما هو مستحق.`
            });
        }
        // ────────────────────────────────────────────────────────────────

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const payNo = payment_no || await nextDocNoAsync(txReq, 'ar_payments');

            txReq.input('p_payNo', sql.NVarChar, payNo);
            txReq.input('p_cid', sql.Int, customer_id);
            txReq.input('p_date', sql.NVarChar, date);
            txReq.input('p_amt', sql.Decimal(18, 2), amountValue);
            txReq.input('p_meth', sql.NVarChar, method);
            txReq.input('p_chkno', sql.NVarChar, check_no || null);
            txReq.input('p_chkdate', sql.NVarChar, check_date || null);
            txReq.input('p_bank', sql.NVarChar, bank_name || null);
            txReq.input('p_notes', sql.NVarChar, notes || '');

            const insertRes = await txReq.query(`
                INSERT INTO ar_payments
                (payment_no, customer_id, payment_date, amount, payment_method, check_no, check_date, bank_name, notes, status)
                OUTPUT INSERTED.id
                VALUES (@p_payNo, @p_cid, @p_date, @p_amt, @p_meth, @p_chkno, @p_chkdate, @p_bank, @p_notes, 'active')
            `);
            const paymentId = insertRes.recordset[0].id;

            // If check, register in ar_cheques table
            if (method === 'check' && check_no) {
                txReq.input('chk_payid', sql.Int, paymentId);
                await txReq.query(`
                    INSERT INTO ar_cheques (cheque_no, cheque_date, bank_name, amount, customer_id, payment_id, status, notes)
                    VALUES (@p_chkno, COALESCE(@p_chkdate, @p_date), @p_bank, @p_amt, @p_cid, @chk_payid, 'received', @p_notes)
                `);
            }

            // Treasury entry for cash/transfer
            await postTreasuryInAsync(txReq, {
                date,
                amount: amountValue,
                customerId: customer_id,
                documentNo: payNo,
                description: `تسديد فاتورة مبيعات ${payNo}`,
                paymentMethod: method
            });

            // Allocate to invoices
            await allocatePaymentAsync(txReq, customer_id, paymentId, amountValue, apply_to_invoices);

            // Recalculate customer balance
            await recalcCustomerBalanceAsync(txReq, customer_id);

            // --- ACCOUNTING INTEGRATION: AR Payment ---
            if (method !== 'check') {
                const accAR = await getSystemAccountAsync(txReq, 'SYS_AR');
                const accCash = await getSystemAccountAsync(txReq, method === 'transfer' ? 'SYS_BANK' : 'SYS_CASH');
                const colLines = [
                    { account_id: accCash, debit: amountValue, credit: 0, description: `تسديد فاتورة مبيعات ${payNo}` },
                    { account_id: accAR, debit: 0, credit: amountValue, description: `سداد من حساب العميل بموجب سند ${payNo}` }
                ];
                await postJournalEntryAsync(
                    txReq, date, `تسديد دفعة ${payNo}`, colLines,
                    'ar_payment', paymentId, req.user ? req.user.id : null,
                    { module: 'ar_payments', action: 'create_payment', document: payNo, isSystem: true }
                );
            }

            // Log customer activity
            if (customer_id) {
                const pLog = Math.random().toString(36).substring(2, 9);
                txReq.input(`cal_cid_${pLog}`, sql.Int, customer_id);
                txReq.input(`cal_type_${pLog}`, sql.NVarChar, 'payment_created');
                txReq.input(`cal_desc_${pLog}`, sql.NVarChar, `تم تسديد فاتورة مبيعات ${payNo} بقيمة ${amountValue}`);
                txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'ar_payment');
                txReq.input(`cal_ri_${pLog}`, sql.Int, paymentId);
                txReq.input(`cal_rn_${pLog}`, sql.NVarChar, payNo);
                txReq.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), amountValue || 0);
                txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
                await txReq.query(`
                    INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                    VALUES (@cal_cid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
                `);
            }

            await tx.commit();
            await logActivity(req, 'CREATE', 'ar_payments', payNo, `سند تسديد ${payNo}`, null, { payment_no: payNo, customer_id, amount: amountValue, payment_method: method }, 'SUCCESS', null);
            res.status(201).json({ success: true, message: 'تم تسجيل تسديد الفاتورة', id: paymentId, payment_no: payNo });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AR Payment POST', err);
            await logActivity(req, 'CREATE', 'ar_payments', payNo || null, 'تسديد فاتورة مبيعات', null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في تسجيل تسديد الفاتورة', error_detail: err.message, code: err.message && err.message.includes('مسبقاً') ? 'DUPLICATE_POSTING' : null });
        }
    } catch (err) {
        logDetailedError('AR Payment POST (outer)', err);
        await logActivity(req, 'CREATE', 'ar_payments', null, 'تسديد فاتورة مبيعات', null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// ============================================================
// DELETE /:id - Reverse AR Payment (إلغاء تسديد الفاتورة)
// ============================================================
router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const paymentId = parseInt(req.params.id);
        if (!paymentId || paymentId <= 0) {
            return res.status(400).json({ success: false, message: 'رقم الدفعة غير صالح' });
        }

        const pool = await getPool();
        const checkReq = pool.request();
        checkReq.input('pid', sql.Int, paymentId);
        const payRes = await checkReq.query(`SELECT * FROM ar_payments WHERE id = @pid`);
        const payment = payRes.recordset[0];
        if (!payment) {
            await logActivity(req, 'DELETE', 'ar_payments', paymentId, `إلغاء سند تسديد #${paymentId}`, null, null, 'FAILED', 'الدفعة غير موجودة');
            return res.status(404).json({ success: false, message: 'الدفعة غير موجودة' });
        }
        if (payment.status === 'reversed') {
            await logActivity(req, 'DELETE', 'ar_payments', paymentId, `إلغاء سند تسديد #${paymentId}`, null, null, 'FAILED', 'الدفعة ملغية مسبقاً');
            return res.status(400).json({ success: false, message: 'الدفعة ملغية مسبقاً' });
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();
        txReq.input('pid', sql.Int, paymentId);

        try {
            // 1. Restore invoice remaining from allocations
            const allocRes = await txReq.query(`SELECT * FROM ar_payment_allocations WHERE payment_id = @pid`);
            const allocations = allocRes.recordset;

            for (const alloc of allocations) {
                txReq.input(`inv_restore_${alloc.id}`, sql.Int, alloc.invoice_id);
                txReq.input(`amt_restore_${alloc.id}`, sql.Decimal(18, 2), alloc.allocated_amount);

                await txReq.query(`
                    UPDATE sales_invoices
                    SET amount_paid = amount_paid - @amt_restore_${alloc.id},
                        remaining = remaining + @amt_restore_${alloc.id}
                    WHERE id = @inv_restore_${alloc.id}
                `);

                await refreshInvoiceStatusAsync(txReq, alloc.invoice_id);
            }

            // 2. Reverse journal entry if one exists (cash/transfer only)
            if (payment.payment_method !== 'check') {
                const jeRes = await txReq.query(`
                    SELECT id FROM journal_entries
                    WHERE reference_type = 'ar_payment' AND reference_id = @pid AND (is_reversed IS NULL OR is_reversed = 0)
                `);
                if (jeRes.recordset[0]) {
                    await reverseJournalEntryAsync(
                        txReq, jeRes.recordset[0].id,
                        `قيد عكسي لسند تسديد ${payment.payment_no}`,
                        req.user ? req.user.id : null
                    );
                }
            }

            // 3. Restore treasury (reverse the 'in' transaction)
            if (payment.payment_method !== 'check') {
                const treasRes = await txReq.query(`
                    SELECT id, account_id, amount FROM treasury_transactions
                    WHERE document_no = @pid AND related_type = 'customer' AND related_id = @pid AND trans_type = 'in'
                `);
                const treasTx = treasRes.recordset[0];
                if (treasTx) {
                    const transNo = await nextDocNoAsync(txReq, 'treasury');
                    txReq.input('rt_tn', sql.NVarChar, transNo);
                    txReq.input('rt_date', sql.NVarChar, new Date().toISOString().slice(0, 10));
                    txReq.input('rt_amt', sql.Decimal(18, 2), payment.amount);
                    txReq.input('rt_acc', sql.Int, treasTx.account_id);
                    txReq.input('rt_cid', sql.Int, payment.customer_id);
                    txReq.input('rt_doc', sql.NVarChar, `عكس تسديد ${payment.payment_no}`);
                    txReq.input('rt_desc', sql.NVarChar, `عكس تسديد فاتورة مبيعات ${payment.payment_no}`);

                    await txReq.query(`
                        INSERT INTO treasury_transactions
                        (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
                        VALUES (@rt_tn, @rt_date, 'out', @rt_amt, @rt_acc, 'customer', @rt_cid, @rt_doc, @rt_desc)
                    `);

                    await txReq.query(`UPDATE treasury_accounts SET current_balance = current_balance - @rt_amt WHERE id = @rt_acc`);
                }
            }

            // 4. Mark cheque as returned if payment was by cheque
            if (payment.payment_method === 'check' && payment.check_no) {
                txReq.input('chq_no', sql.NVarChar, payment.check_no);
                const chqRes = await txReq.query(`
                    SELECT id FROM ar_cheques WHERE cheque_no = @chq_no AND payment_id = @pid
                `);
                if (chqRes.recordset[0]) {
                    txReq.input('chq_id', sql.Int, chqRes.recordset[0].id);
                    await txReq.query(`
                        UPDATE ar_cheques SET status = 'returned' WHERE id = @chq_id
                    `);
                }
            }

            // 5. Mark payment as reversed
            txReq.input('rev_status', sql.NVarChar, 'reversed');
            txReq.input('rev_at', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '));
            await txReq.query(`
                UPDATE ar_payments
                SET status = @rev_status, reversed_at = @rev_at
                WHERE id = @pid
            `);

            // 6. Recalculate customer balance
            await recalcCustomerBalanceAsync(txReq, payment.customer_id);

            // 7. Log customer activity
            if (payment.customer_id) {
                const pLog = Math.random().toString(36).substring(2, 9);
                txReq.input(`cal_cid_${pLog}`, sql.Int, payment.customer_id);
                txReq.input(`cal_type_${pLog}`, sql.NVarChar, 'payment_reversed');
                txReq.input(`cal_desc_${pLog}`, sql.NVarChar, `تم إلغاء تسديد فاتورة مبيعات ${payment.payment_no} بقيمة ${payment.amount}`);
                txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'ar_payment');
                txReq.input(`cal_ri_${pLog}`, sql.Int, paymentId);
                txReq.input(`cal_rn_${pLog}`, sql.NVarChar, payment.payment_no);
                txReq.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), payment.amount || 0);
                txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
                await txReq.query(`
                    INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                    VALUES (@cal_cid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
                `);
            }

            await tx.commit();
            await logActivity(req, 'DELETE', 'ar_payments', paymentId, `إلغاء سند تسديد ${payment.payment_no}`, null, { payment_no: payment.payment_no, customer_id: payment.customer_id, amount: payment.amount }, 'SUCCESS', null);
            res.json({ success: true, message: 'تم إلغاء تسديد الفاتورة بنجاح' });
        } catch (err) {
            await tx.rollback();
            logDetailedError('AR Payment DELETE', err);
            await logActivity(req, 'DELETE', 'ar_payments', paymentId, `إلغاء سند تسديد #${paymentId}`, null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في إلغاء تسديد الفاتورة', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AR Payment DELETE (outer)', err);
        await logActivity(req, 'DELETE', 'ar_payments', req.params.id, `إلغاء سند تسديد #${req.params.id}`, null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

// ============================================================
// Matching Endpoints (Phase 3)
// ============================================================

// GET /matching/customers - Customers with outstanding items
router.get('/matching/customers', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT DISTINCT c.id, c.customer_name, c.current_balance
            FROM customers c
            WHERE EXISTS (
                SELECT 1 FROM ar_payments ap
                WHERE ap.customer_id = c.id AND ap.status = 'active'
                AND ap.amount > COALESCE((SELECT SUM(allocated_amount) FROM ar_payment_allocations WHERE payment_id = ap.id), 0)
            )
            OR EXISTS (
                SELECT 1 FROM sales_invoices si
                WHERE si.customer_id = c.id AND si.status IN ('pending', 'partial') AND si.remaining > 0
            )
            ORDER BY c.customer_name
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logDetailedError('AR Matching customers', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب العملاء', error_detail: err.message });
    }
}));

// GET /matching/data/:customerId - Unmatched payments + unpaid invoices
router.get('/matching/data/:customerId', asyncHandler(async (req, res) => {
    try {
        const cid = parseInt(req.params.customerId);
        const pool = await getPool();
        const request = pool.request();
        request.input('cid', sql.Int, cid);

        const paymentsRes = await request.query(`
            SELECT * FROM (
                SELECT ap.id, ap.payment_no, ap.payment_date, ap.amount,
                    COALESCE((SELECT SUM(allocated_amount) FROM ar_payment_allocations WHERE payment_id = ap.id), 0) AS allocated_total,
                    ap.amount - COALESCE((SELECT SUM(allocated_amount) FROM ar_payment_allocations WHERE payment_id = ap.id), 0) AS unallocated
                FROM ar_payments ap
                WHERE ap.customer_id = @cid AND ap.status = 'active'
            ) sub
            WHERE sub.unallocated > 0
            ORDER BY sub.payment_date
        `);

        const invoicesRes = await request.query(`
            SELECT si.id, si.invoice_no, si.invoice_date, si.grand_total, 
                si.amount_paid, si.remaining, si.status
            FROM sales_invoices si
            WHERE si.customer_id = @cid AND si.status IN ('pending', 'partial') AND si.remaining > 0
            ORDER BY si.invoice_date
        `);

        res.json({
            success: true,
            data: {
                payments: paymentsRes.recordset,
                invoices: invoicesRes.recordset
            }
        });
    } catch (err) {
        logDetailedError('AR Matching data', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب بيانات المطابقة', error_detail: err.message });
    }
}));

// POST /matching/save - Save matching allocations
router.post('/matching/save', asyncHandler(async (req, res) => {
    try {
        const { customer_id, allocations } = req.body;
        if (!customer_id) {
            await logActivity(req, 'CREATE', 'ar_payment_matching', null, 'مطابقة سداد مع فواتير', null, null, 'FAILED', 'العميل مطلوب');
            return res.status(400).json({ success: false, message: 'العميل مطلوب' });
        }
        if (!Array.isArray(allocations) || allocations.length === 0) {
            await logActivity(req, 'CREATE', 'ar_payment_matching', null, 'مطابقة سداد مع فواتير', null, null, 'FAILED', 'التوزيعات مطلوبة');
            return res.status(400).json({ success: false, message: 'يرجى توزيع المبالغ على الفواتير' });
        }

        for (const a of allocations) {
            if (!a.payment_id || !a.invoice_id || a.allocated_amount <= 0) {
                await logActivity(req, 'CREATE', 'ar_payment_matching', null, 'مطابقة سداد مع فواتير', null, null, 'FAILED', 'بيانات توزيع غير صالحة');
                return res.status(400).json({ success: false, message: 'بيانات التوزيع غير صالحة', error_detail: `payment_id=${a.payment_id}, invoice_id=${a.invoice_id}, amount=${a.allocated_amount}` });
            }
        }

        const pool = await getPool();

        // Verify customer exists
        const custReq = pool.request();
        custReq.input('cid', sql.Int, customer_id);
        const custRes = await custReq.query('SELECT id, customer_name FROM customers WHERE id = @cid');
        if (!custRes.recordset[0]) {
            await logActivity(req, 'CREATE', 'ar_payment_matching', null, 'مطابقة سداد مع فواتير', null, null, 'FAILED', 'العميل غير موجود');
            return res.status(404).json({ success: false, message: 'العميل غير موجود' });
        }
        const customerName = custRes.recordset[0].customer_name;

        // Group allocations by payment_id
        const byPayment = {};
        for (const a of allocations) {
            if (!byPayment[a.payment_id]) byPayment[a.payment_id] = [];
            byPayment[a.payment_id].push(a);
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const affectedInvoiceIds = new Set();

            for (const [payIdStr, paymentAllocs] of Object.entries(byPayment)) {
                const paymentId = parseInt(payIdStr);
                const sfx = Math.random().toString(36).substring(2, 9);

                // Verify payment exists, is active, belongs to customer
                txReq.input(`mp_pid_${sfx}`, sql.Int, paymentId);
                txReq.input(`mp_cid_${sfx}`, sql.Int, customer_id);
                const payRes = await txReq.query(`
                    SELECT id, payment_no, amount,
                        COALESCE((SELECT SUM(allocated_amount) FROM ar_payment_allocations WHERE payment_id = @mp_pid_${sfx}), 0) AS allocated_total
                    FROM ar_payments
                    WHERE id = @mp_pid_${sfx} AND customer_id = @mp_cid_${sfx} AND status = 'active'
                `);
                if (!payRes.recordset[0]) {
                    throw new Error(`الدفعة رقم ${paymentId} غير موجودة أو ملغية`);
                }
                const payment = payRes.recordset[0];

                // Validate: existing + new allocations <= payment amount
                const newAllocSum = paymentAllocs.reduce((s, a) => s + num(a.allocated_amount), 0);
                const totalAfter = num(payment.allocated_total) + newAllocSum;
                if (totalAfter > payment.amount) {
                    throw new Error(`إجمالي توزيع الدفعة ${payment.payment_no} (${totalAfter}) يتجاوز قيمتها (${payment.amount})`);
                }

                // Insert new allocations on top of existing ones
                for (let i = 0; i < paymentAllocs.length; i++) {
                    const a = paymentAllocs[i];
                    const asfx = sfx + '_n' + i;
                    txReq.input(`mp_npid_${asfx}`, sql.Int, paymentId);
                    txReq.input(`mp_niid_${asfx}`, sql.Int, a.invoice_id);
                    txReq.input(`mp_namt_${asfx}`, sql.Decimal(18, 2), a.allocated_amount);

                    // Validate invoice has enough remaining
                    const invRes = await txReq.query(`
                        SELECT id, invoice_no, grand_total, amount_paid, remaining, status
                        FROM sales_invoices
                        WHERE id = @mp_niid_${asfx} AND customer_id = @mp_cid_${sfx}
                    `);
                    if (!invRes.recordset[0]) {
                        throw new Error(`الفاتورة رقم ${a.invoice_id} غير موجودة لهذا العميل`);
                    }
                    const inv = invRes.recordset[0];
                    if (inv.status === 'cancelled' || inv.status === 'deleted') {
                        throw new Error(`لا يمكن توزيع المبلغ على فاتورة ملغية (${inv.invoice_no})`);
                    }
                    if (a.allocated_amount > inv.remaining) {
                        throw new Error(`المبلغ الموزع (${a.allocated_amount}) يتجاوز المتبقي من الفاتورة ${inv.invoice_no} (${inv.remaining})`);
                    }

                    // Insert allocation
                    await txReq.query(`
                        INSERT INTO ar_payment_allocations (payment_id, invoice_id, allocated_amount)
                        VALUES (@mp_npid_${asfx}, @mp_niid_${asfx}, @mp_namt_${asfx})
                    `);

                    // Update invoice
                    await txReq.query(`
                        UPDATE sales_invoices
                        SET amount_paid = amount_paid + @mp_namt_${asfx},
                            remaining = CASE WHEN remaining - @mp_namt_${asfx} < 0 THEN 0 ELSE remaining - @mp_namt_${asfx} END
                        WHERE id = @mp_niid_${asfx}
                    `);

                    affectedInvoiceIds.add(a.invoice_id);
                }
            }

            // Refresh status for all affected invoices
            for (const invId of affectedInvoiceIds) {
                await refreshInvoiceStatusAsync(txReq, invId);
            }

            await tx.commit();

            await logActivity(req, 'CREATE', 'ar_payment_matching', null, `مطابقة سداد مع فواتير للعميل ${customerName}`, null, {
                customer_id,
                customer_name: customerName,
                allocation_count: allocations.length,
                total: allocations.reduce((s, a) => s + num(a.allocated_amount), 0)
            }, 'SUCCESS', null);

            res.json({ success: true, message: 'تم حفظ المطابقة بنجاح' });

        } catch (err) {
            await tx.rollback();
            logDetailedError('AR Matching save', err);
            await logActivity(req, 'CREATE', 'ar_payment_matching', null, 'مطابقة سداد مع فواتير', null, null, 'FAILED', err.message);
            res.status(500).json({ success: false, message: err.message || 'خطأ في حفظ المطابقة', error_detail: err.message });
        }
    } catch (err) {
        logDetailedError('AR Matching save (outer)', err);
        await logActivity(req, 'CREATE', 'ar_payment_matching', null, 'مطابقة سداد مع فواتير', null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'خطأ في الخادم', error_detail: err.message });
    }
}));

module.exports = router;
