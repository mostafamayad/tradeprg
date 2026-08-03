// ============================================================
// ROUTE: Customer Collections (تحصيلات العملاء - قبض نقدي/شيك)
// GET    /api/collections                  - List collections
// GET    /api/collections/:id              - Get one with details
// POST   /api/collections                  - Create new collection
// DELETE /api/collections/:id              - Cancel collection
// GET    /api/collections/customer/:id     - All collections for one customer
// ============================================================

const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync, recalcCustomerBalanceAsync } = require('../services/accountingEngine');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');

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
    if (!row.recordset[0]) return 'DOC-0001';
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

    const retRes = await txRequest.query(`SELECT COALESCE(SUM(grand_total),0) as total FROM sales_returns WHERE invoice_id = @ris_id_${srfx} AND status != 'cancelled'`);
    const returnsTotal = retRes.recordset[0].total || 0;

    const remaining = Math.max(0, num(inv.grand_total) - num(inv.amount_paid) - num(returnsTotal));
    let status = 'pending';
    if (remaining <= 0) {
        status = 'paid';
    } else if (num(inv.amount_paid) > 0 || num(returnsTotal) > 0) {
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

async function allocateCollectionAsync(txRequest, customerId, collectionId, amount, applyToInvoices = null) {
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
                WHERE id = @al_invid_${sf} AND customer_id = @al_cid_${sf} AND status != 'cancelled'
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
            WHERE customer_id = @al_cid_all_${pfx} AND status != 'cancelled' AND remaining > 0
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
        txRequest.input(`al_colid_${sf}`, sql.Int, collectionId);
        txRequest.input(`al_invid_ap_${sf}`, sql.Int, inv.id);
        txRequest.input(`al_amt_${sf}`, sql.Decimal(18,2), applyAmount);

        await txRequest.query(`
            INSERT INTO collection_allocations (collection_id, invoice_id, amount)
            VALUES (@al_colid_${sf}, @al_invid_ap_${sf}, @al_amt_${sf})
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

// ── List Collections ──────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
    try {
        const { q, customer_id, rep_id, from, to, payment_method, bank, status } = req.query;
        const pool = await getPool();
        const request = pool.request();

        // المصدر الحقيقي لسندات القبض هو ar_payments (نفس مصدر شاشة تحصيلات العملاء).
        // customer_collections هي الجدول القديم وليست مصدر الحقيقة بعد الآن.
        let where = ' WHERE 1=1';
        if (q) { where += ` AND (ap.payment_no LIKE @q OR c.customer_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (customer_id) { where += ` AND ap.customer_id = @cid`; request.input('cid', sql.Int, customer_id); }
        if (rep_id) { where += ` AND c.rep_id = @rid`; request.input('rid', sql.Int, rep_id); }
        if (from) { where += ` AND ap.payment_date >= @from`; request.input('from', sql.Date, from); }
        if (to) { where += ` AND ap.payment_date <= @to`; request.input('to', sql.Date, to); }
        if (payment_method) { where += ` AND ap.payment_method = @pm`; request.input('pm', sql.NVarChar, payment_method); }
        if (bank) { where += ` AND ap.bank_name LIKE @bank`; request.input('bank', sql.NVarChar, `%${bank}%`); }

        // Enrichment: allocated (from ar_payment_allocations), remaining and derived status.
        const inner = `
            SELECT ap.id, ap.payment_no AS collection_no,
                   CONVERT(varchar(10), ap.payment_date, 23) AS collection_date,
                   ap.customer_id, ap.amount,
                   ap.payment_method, ap.check_no, ap.check_date, ap.bank_name, ap.notes,
                   ap.created_by, ap.created_at, ap.status AS payment_status,
                   c.rep_id, c.customer_name, c.customer_code, c.phone, r.rep_name,
                   COALESCE(alloc.allocated, 0) AS allocated,
                   (ap.amount - COALESCE(alloc.allocated, 0)) AS remaining,
                   CASE
                     WHEN ap.status = 'reversed' THEN 'cancelled'
                     WHEN COALESCE(alloc.allocated, 0) >= ap.amount THEN 'allocated'
                     WHEN COALESCE(alloc.allocated, 0) > 0 THEN 'partial'
                     ELSE 'unallocated'
                   END AS status
            FROM ar_payments ap
            LEFT JOIN customers c ON ap.customer_id = c.id
            LEFT JOIN sales_reps r ON c.rep_id = r.id
            LEFT JOIN (SELECT payment_id, SUM(allocated_amount) AS allocated
                       FROM ar_payment_allocations GROUP BY payment_id) alloc ON alloc.payment_id = ap.id
            ${where}
        `;

        let statusWhere = '';
        if (status) { statusWhere = ' WHERE t.status = @st'; request.input('st', sql.NVarChar, status); }

        const dataRes = await request.query(`SELECT TOP 1000 * FROM (${inner}) t ${statusWhere} ORDER BY t.id DESC`);
        const sumRes = await request.query(`
            SELECT COUNT(*) AS total_count,
                   COALESCE(SUM(amount),0) AS total_amount,
                   COALESCE(SUM(allocated),0) AS total_allocated,
                   COALESCE(SUM(remaining),0) AS total_remaining,
                   COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) AS reversed_count,
                   COALESCE(SUM(CASE WHEN status<>'cancelled' THEN 1 ELSE 0 END),0) AS active_count
            FROM (${inner}) t ${statusWhere}`);
        res.json({ success: true, data: dataRes.recordset, summary: sumRes.recordset[0] });
    } catch (err) {
        console.error(err);
        err.status = 500;
        err.message = 'خطأ في الخادم';
        throw err;
    }
}));

// ── Get Single Collection ─────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('id', sql.Int, req.params.id);
        const dataRes = await request.query(`SELECT cc.*, c.customer_name, c.customer_code, c.phone, c.address, r.rep_name
            FROM customer_collections cc
            LEFT JOIN customers c ON cc.customer_id = c.id
            LEFT JOIN sales_reps r ON cc.rep_id = r.id
            WHERE cc.id = @id`);
        const row = dataRes.recordset[0];
        if (!row) return res.status(404).json({ success: false, message: 'التحصيل غير موجود' });
        res.json({ success: true, data: row });
    } catch (err) {
        console.error(err);
        err.status = 500;
        err.message = 'خطأ في الخادم';
        throw err;
    }
}));

// ── Get Customer Statement (كشف حساب) ──────────────────────
router.get('/customer/:id/statement', asyncHandler(async (req, res) => {
    try {
        const { from, to } = req.query;
        const customerId = req.params.id;
        const pool = await getPool();
        const request = pool.request();
        request.input('cid', sql.Int, customerId);

        const custRes = await request.query(`SELECT * FROM customers WHERE id = @cid`);
        const customer = custRes.recordset[0];
        if (!customer) return res.status(404).json({ success: false, message: 'العميل غير موجود' });

        let sqlQuery = `SELECT invoice_date as date, invoice_no as doc_no, N'فاتورة مبيعات' as type,
                          grand_total as debit, 0 as credit, notes, id as ref_id, 'sales' as ref_type
                   FROM sales_invoices WHERE customer_id = @cid AND status != 'cancelled'`;
        if (from) { sqlQuery += ` AND invoice_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND invoice_date <= @to`; request.input('to', sql.NVarChar, to); }

        sqlQuery += ` UNION ALL
                 SELECT return_date as date, return_no as doc_no, N'مرتجع مبيعات' as type,
                        0 as debit, grand_total as credit, return_reason as notes, id, 'sales_return'
                 FROM sales_returns WHERE customer_id = @cid AND status != 'cancelled'`;
        if (from) { sqlQuery += ` AND return_date >= @from`; }
        if (to) { sqlQuery += ` AND return_date <= @to`; }

        sqlQuery += ` UNION ALL
                 SELECT collection_date as date, collection_no as doc_no,
                        CASE WHEN amount >= 0 THEN N'تحصيل من العميل' ELSE N'رصيد افتتاحي' END as type,
                        0 as debit, ABS(amount) as credit, notes, id, 'collection'
                 FROM customer_collections WHERE customer_id = @cid`;
        if (from) { sqlQuery += ` AND collection_date >= @from`; }
        if (to) { sqlQuery += ` AND collection_date <= @to`; }

        sqlQuery += ` ORDER BY date ASC, ref_id ASC`;

        const rowsRes = await request.query(sqlQuery);
        const rows = rowsRes.recordset;

        let running = customer.opening_balance || 0;
        const statement = rows.map(r => {
            running += (r.debit || 0) - (r.credit || 0);
            return { ...r, balance: running };
        });

        res.json({
            success: true,
            data: {
                customer,
                opening_balance: customer.opening_balance || 0,
                total_debit: statement.reduce((s, r) => s + (r.debit || 0), 0),
                total_credit: statement.reduce((s, r) => s + (r.credit || 0), 0),
                current_balance: customer.current_balance || 0,
                rows: statement
            }
        });
    } catch (err) {
        console.error(err);
        err.status = 500;
        err.message = 'خطأ في الخادم';
        throw err;
    }
}));

// ── Create Collection ─────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
    try {
        const { customer_id, rep_id, collection_no, collection_date, amount, payment_method, check_no, check_date, bank_name, notes, apply_to_invoices } = req.body;
        const amountValue = num(amount);
        const method = payment_method || 'cash';
        const date = collection_date || new Date().toISOString().slice(0,10);

        if (!customer_id) {
            await logActivity(req, 'CREATE', 'collections', null, 'تسجيل تحصيل', null, null, 'FAILED', 'العميل مطلوب');
            return res.status(400).json({ success: false, message: 'العميل مطلوب' });
        }
        if (amountValue <= 0) {
            await logActivity(req, 'CREATE', 'collections', null, 'تسجيل تحصيل', null, null, 'FAILED', 'القيمة يجب أن تكون أكبر من صفر');
            return res.status(400).json({ success: false, message: 'قيمة التحصيل يجب أن تكون أكبر من صفر' });
        }

        const pool = await getPool();

        if (collection_no) {
            const checkReq = pool.request();
            checkReq.input('cno', sql.NVarChar, collection_no);
            const existingRes = await checkReq.query('SELECT id FROM customer_collections WHERE collection_no = @cno');
            if (existingRes.recordset.length > 0) {
                await logActivity(req, 'CREATE', 'collections', collection_no, 'تسجيل تحصيل', null, null, 'FAILED', 'رقم السند مسجل مسبقاً');
                return res.status(400).json({ success: false, code: 'DUPLICATE_COLLECTION_NO', message: 'رقم السند مسجل مسبقاً' });
            }
        }

        const custReq = pool.request();
        custReq.input('cid', sql.Int, customer_id);
        const custRes = await custReq.query('SELECT id, current_balance FROM customers WHERE id = @cid');
        const customer = custRes.recordset[0];
        if (!customer) {
            await logActivity(req, 'CREATE', 'collections', collection_no || null, 'تسجيل تحصيل', null, null, 'FAILED', 'العميل غير موجود');
            return res.status(404).json({ success: false, message: 'العميل غير موجود' });
        }
        if (customer.current_balance > 0 && amountValue > customer.current_balance) {
            await logActivity(req, 'CREATE', 'collections', collection_no || null, 'تسجيل تحصيل', null, null, 'FAILED', 'قيمة التحصيل تتجاوز الرصيد المستحق');
            return res.status(400).json({ success: false, message: 'قيمة التحصيل تتجاوز الرصيد المستحق للعميل (' + Number(customer.current_balance).toFixed(2) + ')' });
        }
        if (customer.current_balance <= 0) {
            await logActivity(req, 'CREATE', 'collections', collection_no || null, 'تسجيل تحصيل', null, null, 'FAILED', 'لا يوجد رصيد مستحق للتحصيل');
            return res.status(400).json({ success: false, message: 'لا يوجد رصيد مستحق للتحصيل من هذا العميل' });
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const colNo = collection_no || await nextDocNoAsync(txReq, 'collections');
            
            txReq.input('c_colNo', sql.NVarChar, colNo);
            txReq.input('c_cid', sql.Int, customer_id);
            txReq.input('c_rid', sql.Int, rep_id || null);
            txReq.input('c_date', sql.NVarChar, date);
            txReq.input('c_amt', sql.Decimal(18,2), amountValue);
            txReq.input('c_meth', sql.NVarChar, method);
            txReq.input('c_chkno', sql.NVarChar, check_no || null);
            txReq.input('c_chkdate', sql.NVarChar, check_date || null);
            txReq.input('c_bank', sql.NVarChar, bank_name || null);
            txReq.input('c_notes', sql.NVarChar, notes || '');

            const insertRes = await txReq.query(`
                INSERT INTO customer_collections
                (collection_no, customer_id, rep_id, collection_date, amount, payment_method, check_no, check_date, bank_name, notes)
                OUTPUT INSERTED.id
                VALUES (@c_colNo, @c_cid, @c_rid, @c_date, @c_amt, @c_meth, @c_chkno, @c_chkdate, @c_bank, @c_notes)
            `);
            const collectionId = insertRes.recordset[0].id;

            // If check, register in checks table
            if (method === 'check' && check_no) {
                txReq.input('chk_colid', sql.Int, collectionId);
                await txReq.query(`
                    INSERT INTO checks (check_no, check_date, due_date, amount, direction, status, customer_id, bank_name, collection_id, notes)
                    VALUES (@c_chkno, COALESCE(@c_chkdate, @c_date), COALESCE(@c_chkdate, NULL), @c_amt, 'inward', 'pending', @c_cid, @c_bank, @chk_colid, @c_notes)
                `);
            }

            await postTreasuryInAsync(txReq, {
                date,
                amount: amountValue,
                customerId: customer_id,
                documentNo: colNo,
                description: `تحصيل سند قبض \${colNo}`,
                paymentMethod: method
            });

            await allocateCollectionAsync(txReq, customer_id, collectionId, amountValue, apply_to_invoices);
            await recalcCustomerBalanceAsync(txReq, customer_id);

            // --- ACCOUNTING INTEGRATION: Customer Collection ---
            if (method !== 'check') {
                const accAR = await getSystemAccountAsync(txReq, 'SYS_AR');
                const accCash = await getSystemAccountAsync(txReq, method === 'transfer' ? 'SYS_BANK' : 'SYS_CASH');
                const colLines = [
                    { account_id: accCash, debit: amountValue, credit: 0, description: `تحصيل سند قبض ${colNo}` },
                    { account_id: accAR, debit: 0, credit: amountValue, description: `سداد من حساب العميل بموجب سند ${colNo}` }
                ];
                await postJournalEntryAsync(
                    txReq, date, `سداد دفعة بسند قبض ${colNo}`, colLines,
                    'customer_collection', collectionId, req.user ? req.user.id : null,
                    { module: 'collections', action: 'create_collection', document: colNo, isSystem: true }
                );
            }

            // Log customer activity
            if (customer_id) {
                const pLog = Math.random().toString(36).substring(2, 9);
                txReq.input(`cal_cid_${pLog}`, sql.Int, customer_id);
                txReq.input(`cal_type_${pLog}`, sql.NVarChar, 'collection_created');
                txReq.input(`cal_desc_${pLog}`, sql.NVarChar, `تم تسجيل تحصيل ${colNo} بقيمة ${amountValue}`);
                txReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'customer_collection');
                txReq.input(`cal_ri_${pLog}`, sql.Int, collectionId);
                txReq.input(`cal_rn_${pLog}`, sql.NVarChar, colNo);
                txReq.input(`cal_amt_${pLog}`, sql.Decimal(18,4), amountValue || 0);
                txReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
                await txReq.query(`
                    INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                    VALUES (@cal_cid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
                `);
            }

            await tx.commit();
            await logActivity(req, 'CREATE', 'collections', colNo, `سند تحصيل ${colNo}`, null, { collection_no: colNo, customer_id, amount: amountValue, payment_method: method }, 'SUCCESS', null);

            try {
                const commissionEmitter = require('../services/commission/emitter');
                commissionEmitter.emit('collection.created', {
                    collection: {
                        id: collectionId,
                        customer_id,
                        rep_id: rep_id,
                        amount: amountValue,
                        collection_no: colNo,
                        collection_date: date,
                        company_id: null,
                        customer_name: null,
                        invoice_no: null,
                        invoice_date: null
                    }
                });
            } catch (e) {
                console.warn('[Commission] Emit failed:', e.message);
            }

            res.status(201).json({ success: true, message: 'تم تسجيل التحصيل', id: collectionId, collection_no: colNo });
        } catch (err) {
            await tx.rollback();
            await logActivity(req, 'CREATE', 'collections', colNo || null, 'تسجيل تحصيل', null, null, 'FAILED', err.message);
            throw err;
        }
    } catch (err) {
        console.error(err);
        await logActivity(req, 'CREATE', 'collections', null, 'تسجيل تحصيل', null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
}));

// ── Delete / Cancel Collection (BLOCKED BY ACCOUNTING RULE 4) ─────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
    await logActivity(req, 'DELETE', 'collections', req.params.id, `حذف سند تحصيل #${req.params.id}`, null, null, 'FAILED', 'الحذف المباشر للسندات غير مسموح');
    return res.status(400).json({ success: false, message: 'وفقاً لسياسة المحاسبة الجديدة، يُمنع الحذف المباشر للسندات. يرجى استخدام عملية العكس أو الإلغاء المحاسبي بدلاً من ذلك.' });
}));

// ── Customer Aging (أعمار الديون) ──────────────────────────
router.get('/reports/aging', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const dataRes = await pool.request().query(`
            SELECT c.id, c.customer_code, c.customer_name, c.phone,
                   c.current_balance,
                   c.credit_limit,
                   COALESCE(SUM(CASE WHEN CAST(invoice_date AS DATE) >= DATEADD(day, -30, GETDATE()) THEN grand_total - amount_paid ELSE 0 END), 0) as age_0_30,
                   COALESCE(SUM(CASE WHEN CAST(invoice_date AS DATE) >= DATEADD(day, -60, GETDATE()) AND CAST(invoice_date AS DATE) < DATEADD(day, -30, GETDATE()) THEN grand_total - amount_paid ELSE 0 END), 0) as age_31_60,
                   COALESCE(SUM(CASE WHEN CAST(invoice_date AS DATE) >= DATEADD(day, -90, GETDATE()) AND CAST(invoice_date AS DATE) < DATEADD(day, -60, GETDATE()) THEN grand_total - amount_paid ELSE 0 END), 0) as age_61_90,
                   COALESCE(SUM(CASE WHEN CAST(invoice_date AS DATE) < DATEADD(day, -90, GETDATE()) THEN grand_total - amount_paid ELSE 0 END), 0) as age_over_90
            FROM customers c
            LEFT JOIN sales_invoices i ON i.customer_id = c.id AND i.status != 'cancelled' AND (grand_total - amount_paid) > 0
            WHERE c.is_active = 1
            GROUP BY c.id, c.customer_code, c.customer_name, c.phone, c.current_balance, c.credit_limit
            HAVING c.current_balance > 0
            ORDER BY c.current_balance DESC
        `);
        res.json({ success: true, data: dataRes.recordset });
    } catch (err) {
        console.error(err);
        err.status = 500;
        err.message = 'خطأ في الخادم';
        throw err;
    }
}));

// ── Customer Unpaid Invoices ───────────────────────────────
router.get('/customer/:id/unpaid', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('id', sql.Int, req.params.id);
        const invRes = await request.query(`
            SELECT id, invoice_no, invoice_date, grand_total, amount_paid, remaining, payment_type
            FROM sales_invoices
            WHERE customer_id = @id AND status != 'cancelled' AND remaining > 0
            ORDER BY invoice_date ASC
        `);
        res.json({ success: true, data: invRes.recordset });
    } catch (err) {
        console.error(err);
        err.status = 500;
        err.message = 'خطأ في الخادم';
        throw err;
    }
}));

// Balance preview for collection screen
router.get('/customer/:id/preview', asyncHandler(async (req, res) => {
    const { getCustomerFullBalance } = require('../services/balanceService');
    const data = await getCustomerFullBalance(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    res.json({ success: true, data });
}));

module.exports = router;
