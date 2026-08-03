// ============================================================
// ROUTE: Supplier Payments (مدفوعات الموردين)
// ============================================================

const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const { recalcSupplierBalanceAsync, postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync } = require('../services/accountingEngine');

// ============================================================
// Private Helpers
// ============================================================

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

// ── List Payments (analytical report) ───────────────────────
// SINGLE SOURCE OF TRUTH: ap_payments + ap_payment_allocations + suppliers.
// supplier_payments is the legacy (empty) table and is NOT used for reporting.
router.get('/', asyncHandler(async (req, res) => {
    try {
        const { q, supplier_id, created_by, from, to, payment_method, bank, status } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let where = ' WHERE 1=1';
        if (q) { where += ` AND (ap.payment_no LIKE @q OR s.supplier_name LIKE @q OR ap.check_no LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (supplier_id) { where += ` AND ap.supplier_id = @sid`; request.input('sid', sql.Int, supplier_id); }
        if (created_by) { where += ` AND ap.created_by = @cby`; request.input('cby', sql.Int, created_by); }
        if (from) { where += ` AND ap.payment_date >= @from`; request.input('from', sql.Date, from); }
        if (to) { where += ` AND ap.payment_date <= @to`; request.input('to', sql.Date, to); }
        if (payment_method) { where += ` AND ap.payment_method = @pm`; request.input('pm', sql.NVarChar, payment_method); }
        if (bank) { where += ` AND ap.bank_name LIKE @bank`; request.input('bank', sql.NVarChar, `%${bank}%`); }

        // Enrichment: allocated (from ap_payment_allocations), remaining and derived status.
        const inner = `
            SELECT ap.id, ap.payment_no,
                   CONVERT(varchar(10), ap.payment_date, 23) AS payment_date,
                   ap.supplier_id, ap.amount,
                   ap.payment_method, ap.check_no,
                   CONVERT(varchar(10), ap.check_date, 23) AS check_date,
                   ap.bank_name, ap.notes,
                   ap.created_by, ap.created_at, ap.reversed_at,
                   ap.status AS payment_status,
                   s.supplier_code, s.supplier_name, s.phone AS supplier_phone,
                   u.full_name AS created_by_name,
                   COALESCE(alloc.allocated, 0) AS allocated,
                   (ap.amount - COALESCE(alloc.allocated, 0)) AS remaining,
                   CASE
                     WHEN ap.status = 'reversed' THEN 'cancelled'
                     WHEN COALESCE(alloc.allocated, 0) >= ap.amount THEN 'allocated'
                     WHEN COALESCE(alloc.allocated, 0) > 0 THEN 'partial'
                     ELSE 'unallocated'
                   END AS status,
                   CONVERT(varchar(10), chq.due_date, 23) AS cheque_due_date,
                   chq.status AS cheque_status
            FROM ap_payments ap
            LEFT JOIN suppliers s ON ap.supplier_id = s.id
            LEFT JOIN users u ON ap.created_by = u.id
            LEFT JOIN (SELECT payment_id, SUM(allocated_amount) AS allocated
                       FROM ap_payment_allocations GROUP BY payment_id) alloc ON alloc.payment_id = ap.id
            LEFT JOIN ap_cheques chq ON chq.payment_id = ap.id
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
                   COALESCE(SUM(CASE WHEN status<>'cancelled' THEN 1 ELSE 0 END),0) AS active_count,
                   COALESCE(SUM(CASE WHEN status='unallocated' THEN 1 ELSE 0 END),0) AS unallocated_count,
                   COALESCE(SUM(CASE WHEN payment_method='cash' AND status<>'cancelled' THEN amount ELSE 0 END),0) AS cash_amount,
                   COALESCE(SUM(CASE WHEN payment_method='check' AND status<>'cancelled' THEN amount ELSE 0 END),0) AS check_amount,
                   COALESCE(SUM(CASE WHEN payment_method='transfer' AND status<>'cancelled' THEN amount ELSE 0 END),0) AS transfer_amount
            FROM (${inner}) t ${statusWhere}`);
        res.json({ success: true, data: dataRes.recordset, summary: sumRes.recordset[0] });
    } catch (err) {
        console.error('Supplier payments GET error:', err);
        err.status = 500;
        err.message = 'خطأ في الخادم';
        throw err;
    }
}));

// ── Payment Details (Drawer: header + allocations + cheque + journal entries) ──
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('pid', sql.Int, req.params.id);
        const payRes = await request.query(`
            SELECT ap.*, s.supplier_code, s.supplier_name, s.phone AS supplier_phone,
                   u.full_name AS created_by_name
            FROM ap_payments ap
            LEFT JOIN suppliers s ON ap.supplier_id = s.id
            LEFT JOIN users u ON ap.created_by = u.id
            WHERE ap.id = @pid
        `);
        const pay = payRes.recordset[0];
        if (!pay) return res.status(404).json({ success: false, message: 'السند غير موجود' });

        const allocRes = await request.query(`
            SELECT a.*, pi.invoice_no
            FROM ap_payment_allocations a
            LEFT JOIN purchase_invoices pi ON a.invoice_id = pi.id
            WHERE a.payment_id = @pid
        `);
        const chqRes = await request.query(`SELECT * FROM ap_cheques WHERE payment_id = @pid`);
        const jeRes = await request.query(`
            SELECT je.id AS entry_id, je.entry_no, je.entry_date, je.description,
                   je.is_reversed, je.reversal_of_id, je.created_by,
                   u.full_name AS created_by_name,
                   jl.id AS line_id, jl.account_id, jl.debit, jl.credit,
                   jl.description AS line_description,
                   coa.account_code, coa.account_name
            FROM journal_entries je
            LEFT JOIN users u ON je.created_by = u.id
            LEFT JOIN journal_entry_lines jl ON jl.entry_id = je.id
            LEFT JOIN chart_of_accounts coa ON coa.id = jl.account_id
            WHERE je.reference_type = 'ap_payment' AND je.reference_id = @pid
            ORDER BY je.id, jl.id
        `);

        res.json({ success: true, data: { ...pay, allocations: allocRes.recordset, cheques: chqRes.recordset, journal_entries: jeRes.recordset } });
    } catch (err) {
        console.error('Supplier payment detail GET error:', err);
        err.status = 500;
        err.message = 'خطأ في الخادم';
        throw err;
    }
}));

// ── Create Payment ──────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
    try {
        const { supplier_id, payment_no, payment_date, amount, payment_method, check_no, check_date, bank_name, notes } = req.body;
        if (!supplier_id) return res.status(400).json({ success: false, message: 'المورد مطلوب' });
        if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'قيمة الدفعة يجب أن تكون أكبر من صفر' });

        const pool = await getPool();

        const supReq = pool.request();
        supReq.input('sid', sql.Int, supplier_id);
        const supRes = await supReq.query('SELECT id, current_balance FROM suppliers WHERE id = @sid');
        const supplier = supRes.recordset[0];
        if (!supplier) return res.status(404).json({ success: false, message: 'المورد غير موجود' });
        if (supplier.current_balance > 0 && amount > supplier.current_balance) {
            return res.status(400).json({ success: false, message: 'قيمة السداد تتجاوز الرصيد المستحق للمورد (' + Number(supplier.current_balance).toFixed(2) + ')' });
        }
        if (supplier.current_balance <= 0) {
            return res.status(400).json({ success: false, message: 'لا يوجد رصيد مستحق للسداد لهذا المورد' });
        }

        if (payment_no) {
            const checkReq = pool.request();
            checkReq.input('pno', sql.NVarChar, payment_no);
            const existingRes = await checkReq.query('SELECT id FROM supplier_payments WHERE payment_no = @pno');
            if (existingRes.recordset.length > 0) {
                return res.status(400).json({ success: false, code: 'DUPLICATE_PAYMENT_NO', message: 'رقم السند مسجل مسبقاً' });
            }
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();

        try {
            const payNo = payment_no || await nextDocNoAsync(txReq, 'supplier_payments');
            const pDate = payment_date || new Date().toISOString().slice(0, 10);
            const pMethod = payment_method || 'cash';

            txReq.input('p_pno', sql.NVarChar, payNo);
            txReq.input('p_sid', sql.Int, supplier_id);
            txReq.input('p_date', sql.NVarChar, pDate);
            txReq.input('p_amt', sql.Decimal(18,2), amount);
            txReq.input('p_meth', sql.NVarChar, pMethod);
            txReq.input('p_chkno', sql.NVarChar, check_no || null);
            txReq.input('p_chkdate', sql.NVarChar, check_date || null);
            txReq.input('p_bank', sql.NVarChar, bank_name || null);
            txReq.input('p_notes', sql.NVarChar, notes || '');

            const insertRes = await txReq.query(`
                INSERT INTO supplier_payments
                (payment_no, supplier_id, payment_date, amount, payment_method, check_no, check_date, bank_name, notes)
                OUTPUT INSERTED.id
                VALUES (@p_pno, @p_sid, @p_date, @p_amt, @p_meth, @p_chkno, @p_chkdate, @p_bank, @p_notes)
            `);
            const id = insertRes.recordset[0].id;

            if (pMethod === 'check' && check_no) {
                txReq.input('c_id', sql.Int, id);
                txReq.input('c_cdate', sql.NVarChar, check_date || pDate);
                await txReq.query(`
                    INSERT INTO checks (check_no, check_date, due_date, amount, direction, status, supplier_id, bank_name, payment_id, notes)
                    VALUES (@p_chkno, @c_cdate, @p_chkdate, @p_amt, 'outward', 'pending', @p_sid, @p_bank, @c_id, @p_notes)
                `);
            }

            // Allocations Logic
            const allocations = req.body.allocations || [];
            for (let i = 0; i < allocations.length; i++) {
                const alloc = allocations[i];
                if (alloc.allocated_amount > 0) {
                    txReq.input(`al_pid_${i}`, sql.Int, id);
                    txReq.input(`al_iid_${i}`, sql.Int, alloc.invoice_id);
                    txReq.input(`al_amt_${i}`, sql.Decimal(18, 2), alloc.allocated_amount);
                    
                    await txReq.query(`
                        INSERT INTO supplier_payment_allocations (payment_id, invoice_id, allocated_amount) 
                        VALUES (@al_pid_${i}, @al_iid_${i}, @al_amt_${i})
                    `);
                    
                    await txReq.query(`
                        UPDATE purchase_invoices 
                        SET amount_paid = amount_paid + @al_amt_${i}, remaining = remaining - @al_amt_${i} 
                        WHERE id = @al_iid_${i}
                    `);
                    
                    // Update invoice status if fully paid
                    await txReq.query(`
                        UPDATE purchase_invoices 
                        SET status = CASE WHEN remaining <= 0.01 THEN 'paid' ELSE 'partial' END
                        WHERE id = @al_iid_${i} AND status != 'cancelled'
                    `);
                }
            }

            await recalcSupplierBalanceAsync(txReq, supplier_id);

            if (pMethod !== 'check') {
                const accAP = await getSystemAccountAsync(txReq, 'SYS_AP');
                const accCash = await getSystemAccountAsync(txReq, pMethod === 'transfer' ? 'SYS_BANK' : 'SYS_CASH');
                const payLines = [
                    { account_id: accAP, debit: amount, credit: 0, description: `سداد للمورد بموجب سند صرف ${payNo}` },
                    { account_id: accCash, debit: 0, credit: amount, description: `صرف نقدية للمورد ${payNo}` }
                ];
                await postJournalEntryAsync(
                    txReq, pDate, `تسديد دفعة بسند صرف ${payNo}`, payLines,
                    'supplier_payment', id,
                    req.user ? req.user.id : null,
                    { module: 'payments', action: 'create_payment', document: payNo, isSystem: true },
                    supplier_id
                );
            }

            await tx.commit();
            res.status(201).json({ success: true, message: 'تم تسجيل الدفعة', id });
        } catch (err) {
            await tx.rollback();
            throw err;
        }
    } catch (err) {
        console.error('Supplier payment POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
}));

// ── Delete Payment ──────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const preReq = pool.request();
        preReq.input('id', sql.Int, req.params.id);
        const rowRes = await preReq.query('SELECT * FROM supplier_payments WHERE id = @id');
        const row = rowRes.recordset[0];
        if (!row) return res.status(404).json({ success: false, message: 'الدفعة غير موجودة' });

        const tx = new sql.Transaction(pool);
        await tx.begin();
        const txReq = tx.request();
        txReq.input('id', sql.Int, req.params.id);

        try {
            // ── Accounting: reverse the JE for cash/transfer payments ──
            // (previously this was missing → stale GL balance on delete)
            if (row.payment_method !== 'check') {
                const pjeRes = await txReq.query(`
                    SELECT id FROM journal_entries
                    WHERE reference_type = 'supplier_payment' AND reference_id = @id
                      AND (is_reversed IS NULL OR is_reversed = 0)
                `);
                for (const pje of pjeRes.recordset) {
                    await reverseJournalEntryAsync(txReq, pje.id, `قيد عكسي لسند صرف محذوف ${row.payment_no}`, req.user ? req.user.id : null);
                }
            }

            // Reverse Allocations
            const allocsRes = await txReq.query('SELECT invoice_id, allocated_amount FROM supplier_payment_allocations WHERE payment_id = @id');
            for (let i = 0; i < allocsRes.recordset.length; i++) {
                const alloc = allocsRes.recordset[i];
                txReq.input(`rev_iid_${i}`, sql.Int, alloc.invoice_id);
                txReq.input(`rev_amt_${i}`, sql.Decimal(18, 2), alloc.allocated_amount);
                
                await txReq.query(`
                    UPDATE purchase_invoices 
                    SET amount_paid = amount_paid - @rev_amt_${i}, remaining = remaining + @rev_amt_${i} 
                    WHERE id = @rev_iid_${i}
                `);
                
                await txReq.query(`
                    UPDATE purchase_invoices 
                    SET status = CASE WHEN amount_paid <= 0.01 THEN 'posted' ELSE 'partial' END
                    WHERE id = @rev_iid_${i} AND status != 'cancelled'
                `);
            }

            await txReq.query('DELETE FROM supplier_payment_allocations WHERE payment_id = @id');
            await txReq.query('DELETE FROM checks WHERE payment_id = @id');
            await txReq.query('DELETE FROM supplier_payments WHERE id = @id');
            
            await recalcSupplierBalanceAsync(txReq, row.supplier_id);

            await tx.commit();
            res.json({ success: true, message: 'تم حذف الدفعة' });
        } catch (err) {
            await tx.rollback();
            throw err;
        }
    } catch (err) {
        console.error('Supplier payment DELETE error:', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
}));

// ── Supplier Statement (كشف حساب مورد) ──────────────────────
// SINGLE SOURCE OF TRUTH: built exclusively from the General Ledger
// (journal_entries on SYS_AP attributed to the supplier via je.supplier_id).
// Pending/issued cheques have no journal entry → they do NOT appear here
// until their accounting effect is actually posted. Operational documents
// are only LEFT JOINed for display metadata, never for balance.
router.get('/supplier/:id/statement', asyncHandler(async (req, res) => {
    try {
        const { from, to } = req.query;
        const supplierId = req.params.id;

        const pool = await getPool();
        const request = pool.request();
        request.input('sid', sql.Int, supplierId);

        const supRes = await request.query('SELECT * FROM suppliers WHERE id = @sid');
        const supplier = supRes.recordset[0];
        if (!supplier) return res.status(404).json({ success: false, message: 'المورد غير موجود' });

        const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

        const apAccId = await getSystemAccountAsync(request, 'SYS_AP');
        request.input('apAccId', sql.Int, apAccId);

        // رأس القيد الواحد: مدين/دائن من سطر SYS_AP في الأستاذ (GL) فقط
        const selectParts = `
            SELECT je.entry_date AS trans_date,
                   CASE WHEN je.reference_type = 'manual_je' OR je.reference_type IS NULL
                        THEN je.entry_no
                        ELSE COALESCE(NULLIF(je.source_document, ''), je.entry_no)
                   END AS doc_no,
                   je.reference_type,
                   je.reference_id,
                   je.entry_no,
                   je.id AS je_id,
                   je.source_action,
                   jl.debit, jl.credit,
                   ISNULL(jl.description, je.description) AS description,
                   ISNULL(u.full_name, '') AS created_by_name,
                   COALESCE(NULLIF(ap.payment_method,''), NULLIF(sp.payment_method,'')) AS payment_method,
                   COALESCE(NULLIF(ap.bank_name,''), NULLIF(sp.bank_name,'')) AS bank_name,
                   COALESCE(NULLIF(ap.check_no,''), NULLIF(sp.check_no,'')) AS check_no
            FROM journal_entry_lines jl
            JOIN journal_entries je ON je.id = jl.entry_id
            LEFT JOIN users u ON je.created_by = u.id
            LEFT JOIN ap_payments ap ON ap.id = je.reference_id AND je.reference_type = 'ap_payment'
            LEFT JOIN supplier_payments sp ON sp.id = je.reference_id AND je.reference_type = 'supplier_payment'
            WHERE jl.account_id = @apAccId
              AND je.supplier_id = @sid
              AND (je.is_reversed IS NULL OR je.is_reversed = 0)
              AND (je.reversal_of_id IS NULL)
              AND (je.source_action IS NULL OR (je.source_action NOT LIKE '%_cancel' AND je.source_action <> 'cancel'))
        `;

        // ── الرصيد الافتتاحي للفترة: opening_balance + كل الأثر قبل @from ──
        let opening = num(supplier.opening_balance);
        if (from) {
            const openReq = pool.request();
            openReq.input('sid', sql.Int, Number(supplierId));
            openReq.input('apAccId', sql.Int, apAccId);
            openReq.input('from', sql.NVarChar, from);
            const openRows = (await openReq.query(selectParts + ' AND je.entry_date < @from')).recordset;
            opening += openRows.reduce((s, r) => s + (num(r.credit) - num(r.debit)), 0);
        }

        // ── حركات فترة العرض ──
        const periodReq = pool.request();
        periodReq.input('sid', sql.Int, Number(supplierId));
        periodReq.input('apAccId', sql.Int, apAccId);
        if (from) periodReq.input('from', sql.NVarChar, from);
        if (to)   periodReq.input('to',   sql.NVarChar, to);
        let periodSql = selectParts;
        if (from) periodSql += ' AND je.entry_date >= @from';
        if (to)   periodSql += ' AND je.entry_date <= @to';
        periodSql += ' ORDER BY je.entry_date ASC, je.id ASC';
        const rows = (await periodReq.query(periodSql)).recordset;

        // ── أنواع الحركات + التسميات + ملاحظة الفرق بين القيد الأصلي والعكسي ──
        const IS_GL_ONLY = ['purchase_invoice', 'purchase_return', 'supplier_payment', 'ap_payment', 'ap_note'];
        function mapType(raw) {
            if (!raw) return 'journal_entry';
            if (IS_GL_ONLY.includes(raw)) return raw;
            return 'journal_entry';
        }
        function label(raw, action) {
            if (action && String(action).toLowerCase().endsWith('_cancel')) return { t: 'قيد عكسي', s: 'عكس' };
            switch (raw) {
                case 'purchase_invoice': return { t: 'فاتورة شراء', s: 'فاتورة' };
                case 'purchase_return':  return { t: 'مرتجع شراء',  s: 'مرتجع' };
                case 'supplier_payment':
                case 'ap_payment':       return { t: 'سند صرف',     s: 'سند صرف' };
                case 'ap_note':          return { t: 'إشعار',       s: 'إشعار' };
                default:                 return { t: 'قيد يومية',    s: 'قيد' };
            }
        }

        // ── فلاتر اختيارية: نوع الحركة + بحث بالمستند/البيان ──
        const typeFilter = req.query.type;
        const qFilter = req.query.q;
        const mapped = rows.map(r => {
            const l = label(r.reference_type, r.source_action);
            return {
                ref_type: mapType(r.reference_type),
                ref_id: r.reference_id != null ? r.reference_id : r.je_id,
                date: r.trans_date,
                doc_no: r.doc_no,
                doc_type: l.t,
                doc_type_short: l.s,
                debit: num(r.debit),
                credit: num(r.credit),
                description: r.description,
                created_by: r.created_by_name,
                payment_method: r.payment_method,
                bank_name: r.bank_name,
                check_no: r.check_no,
                source_action: r.source_action
            };
        });

        let filtered = mapped;
        if (typeFilter || qFilter) {
            filtered = filtered.filter(r => {
                if (typeFilter && r.ref_type !== typeFilter) return false;
                if (qFilter) {
                    const hay = [r.doc_no, r.description, r.check_no, r.payment_method, r.created_by]
                        .map(v => v == null ? '' : String(v)).join(' ');
                    if (!hay.includes(qFilter)) return false;
                }
                return true;
            });
        }

        // ── تفاصيل المستندات (showDetails) للـ drill-down ──
        if (req.query.showDetails === 'true') {
            const invIds = filtered.filter(r => r.ref_type === 'purchase_invoice').map(r => r.ref_id);
            const retIds = filtered.filter(r => r.ref_type === 'purchase_return').map(r => r.ref_id);

            let itemsByRef = { purchase_invoice: {}, purchase_return: {} };
            let metaByRef = { purchase_invoice: {}, purchase_return: {} };

            if (invIds.length > 0) {
                const dReq = pool.request();
                const idsStr = invIds.join(',');
                const metaRows = (await dReq.query(`SELECT id, subtotal, discount_amount, tax_amount, store_id, supplier_invoice_no FROM purchase_invoices WHERE id IN (${idsStr})`)).recordset;
                metaRows.forEach(m => { metaByRef.purchase_invoice[m.id] = m; });
                const itemRows = (await dReq.query(`
                    SELECT ii.invoice_id, p.product_name, p.product_code, p.unit_name AS unit,
                           ii.quantity, ii.cost_price AS unit_price, ii.line_total AS total
                    FROM purchase_invoice_items ii
                    LEFT JOIN products p ON p.id = ii.product_id
                    WHERE ii.invoice_id IN (${idsStr})
                `)).recordset;
                itemRows.forEach(it => {
                    if (!itemsByRef.purchase_invoice[it.invoice_id]) itemsByRef.purchase_invoice[it.invoice_id] = [];
                    itemsByRef.purchase_invoice[it.invoice_id].push({
                        product_name: it.product_name, product_code: it.product_code, unit: it.unit,
                        quantity: num(it.quantity), unit_price: num(it.unit_price), total: num(it.total)
                    });
                });
            }

            if (retIds.length > 0) {
                const dReq = pool.request();
                const idsStr = retIds.join(',');
                const metaRows = (await dReq.query(`SELECT id, store_id, invoice_id FROM purchase_returns WHERE id IN (${idsStr})`)).recordset;
                metaRows.forEach(m => { metaByRef.purchase_return[m.id] = m; });
                const itemRows = (await dReq.query(`
                    SELECT ri.return_id, p.product_name, p.product_code, p.unit_name AS unit,
                           ri.quantity, ri.cost_price AS unit_price, ri.line_total AS total
                    FROM purchase_return_items ri
                    LEFT JOIN products p ON p.id = ri.product_id
                    WHERE ri.return_id IN (${idsStr})
                `)).recordset;
                itemRows.forEach(it => {
                    if (!itemsByRef.purchase_return[it.return_id]) itemsByRef.purchase_return[it.return_id] = [];
                    itemsByRef.purchase_return[it.return_id].push({
                        product_name: it.product_name, product_code: it.product_code, unit: it.unit,
                        quantity: num(it.quantity), unit_price: num(it.unit_price), total: num(it.total)
                    });
                });
            }

            filtered.forEach(r => {
                if (r.ref_type === 'purchase_invoice' || r.ref_type === 'purchase_return') {
                    r.items = itemsByRef[r.ref_type][r.ref_id] || [];
                    r.subtotal = num((metaByRef[r.ref_type][r.ref_id] || {}).subtotal);
                    r.discount_amount = num((metaByRef[r.ref_type][r.ref_id] || {}).discount_amount);
                    r.tax_amount = num((metaByRef[r.ref_type][r.ref_id] || {}).tax_amount);
                }
            });
        }

        // ── الحساب الجاري (Running Balance) ──
        let running = opening;
        const statement = filtered.map(r => {
            const before = running;
            running += num(r.credit) - num(r.debit);
            return {
                date: r.date, doc_no: r.doc_no,
                doc_type: r.doc_type, doc_type_short: r.doc_type_short,
                debit: num(r.debit), credit: num(r.credit),
                balance_before: before,
                impact: num(r.credit) - num(r.debit),
                balance: running,
                description: r.description,
                created_by: r.created_by,
                payment_method: r.payment_method,
                bank_name: r.bank_name,
                check_no: r.check_no,
                ref_type: r.ref_type, ref_id: r.ref_id,
                items: r.items, subtotal: r.subtotal,
                discount_amount: r.discount_amount, tax_amount: r.tax_amount
            };
        });

        const totalDebit  = statement.reduce((s, r) => s + r.debit, 0);
        const totalCredit = statement.reduce((s, r) => s + r.credit, 0);
        const closing = opening + totalCredit - totalDebit;

        const totalPurchases = statement.filter(r => r.ref_type === 'purchase_invoice').reduce((s, r) => s + r.credit, 0);
        const totalReturns   = statement.filter(r => r.ref_type === 'purchase_return').reduce((s, r) => s + r.debit, 0);
        const totalPayments  = statement.filter(r => ['supplier_payment', 'ap_payment'].includes(r.ref_type)).reduce((s, r) => s + r.debit, 0);
        const totalNotes     = statement.filter(r => r.ref_type === 'ap_note').reduce((s, r) => s + r.credit - r.debit, 0);

        // ── عدد وقيمة الفواتير غير المسددة (مقياس تشغيلي للتقادم، وليس محاسبياً) ──
        let unpaidCount = 0, unpaidAmount = 0;
        try {
            const upReq = pool.request();
            upReq.input('usid', sql.Int, Number(supplierId));
            const upRes = await upReq.query(`
                SELECT COUNT(*) AS cnt, COALESCE(SUM(remaining), 0) AS total
                FROM purchase_invoices
                WHERE supplier_id = @usid AND status NOT IN ('cancelled','deleted') AND remaining > 0
            `);
            const upRow = upRes.recordset[0];
            unpaidCount = Number(upRow?.cnt || 0);
            unpaidAmount = Number(upRow?.total || 0);
        } catch (e) { /* keep zeros on error */ }

        res.json({
            success: true,
            data: {
                supplier: {
                    id: supplier.id, supplier_code: supplier.supplier_code,
                    supplier_name: supplier.supplier_name, phone: supplier.phone,
                    address: supplier.address, tax_number: supplier.tax_number,
                    current_balance: closing
                },
                opening_balance: opening,
                total_debit: totalDebit,
                total_credit: totalCredit,
                closing_balance: closing,
                kpis: {
                    current_balance: closing,
                    total_purchases: totalPurchases,
                    total_returns: totalReturns,
                    total_payments: totalPayments,
                    total_notes: totalNotes,
                    unpaid_invoices: unpaidCount,
                    unpaid_invoices_amount: unpaidAmount,
                    transaction_count: statement.length,
                    opening_balance: opening,
                    closing_balance: closing
                },
                rows: statement
            }
        });
    } catch (err) {
        console.error('Supplier statement GET error:', err);
        err.status = 500;
        err.message = 'خطأ في الخادم';
        throw err;
    }
}));

// Balance preview for payment screen
router.get('/supplier/:id/preview', asyncHandler(async (req, res) => {
    const { getSupplierFullBalance } = require('../services/balanceService');
    const data = await getSupplierFullBalance(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'المورد غير موجود' });
    res.json({ success: true, data });
}));

module.exports = router;
