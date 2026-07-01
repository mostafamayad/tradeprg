// ============================================================
// ROUTE: Supplier Payments (مدفوعات الموردين)
// ============================================================

const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');

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

async function recalcSupplierBalanceAsync(poolOrTxReq, supplierId) {
    const pRand = Math.random().toString(36).substring(2, 9);
    const request = typeof poolOrTxReq.request === 'function' ? poolOrTxReq.request() : poolOrTxReq;
    request.input(`rsb_sid_${pRand}`, sql.Int, supplierId);

    const sRes = await request.query(`SELECT opening_balance FROM suppliers WHERE id = @rsb_sid_${pRand}`);
    if (!sRes.recordset[0]) return;
    
    const purRes = await request.query(`SELECT COALESCE(SUM(grand_total), 0) as total FROM purchase_invoices WHERE supplier_id = @rsb_sid_${pRand} AND status != 'cancelled'`);
    const retRes = await request.query(`SELECT COALESCE(SUM(grand_total), 0) as total FROM purchase_returns WHERE supplier_id = @rsb_sid_${pRand} AND status != 'cancelled'`);
    
    const payRes = await request.query(`
        SELECT COALESCE(SUM(sp.amount), 0) as total 
        FROM supplier_payments sp
        LEFT JOIN checks ch ON ch.payment_id = sp.id
        WHERE sp.supplier_id = @rsb_sid_${pRand} AND (ch.id IS NULL OR ch.status NOT IN ('bounced', 'cancelled'))
    `);

    const opening = sRes.recordset[0].opening_balance || 0;
    const purchases = purRes.recordset[0].total || 0;
    const returns = retRes.recordset[0].total || 0;
    const payments = payRes.recordset[0].total || 0;

    const balance = opening + purchases - returns - payments;
    
    request.input(`rsb_bal_${pRand}`, sql.Decimal(18, 2), balance);
    await request.query(`UPDATE suppliers SET current_balance = @rsb_bal_${pRand} WHERE id = @rsb_sid_${pRand}`);
    return balance;
}

// ── List Payments ───────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
    try {
        const { q, supplier_id, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let sqlQuery = `SELECT TOP 500 sp.*, s.supplier_name, s.supplier_code
                   FROM supplier_payments sp
                   LEFT JOIN suppliers s ON sp.supplier_id = s.id
                   WHERE 1=1`;
        
        if (q) { 
            sqlQuery += ` AND (sp.payment_no LIKE @q OR s.supplier_name LIKE @q)`; 
            request.input('q', sql.NVarChar, `%${q}%`); 
        }
        if (supplier_id) { 
            sqlQuery += ` AND sp.supplier_id = @sid`; 
            request.input('sid', sql.Int, supplier_id); 
        }
        if (from) { 
            sqlQuery += ` AND sp.payment_date >= @from`; 
            request.input('from', sql.NVarChar, from); 
        }
        if (to) { 
            sqlQuery += ` AND sp.payment_date <= @to`; 
            request.input('to', sql.NVarChar, to); 
        }
        sqlQuery += ` ORDER BY sp.id DESC`;

        const dataRes = await request.query(sqlQuery);
        res.json({ success: true, data: dataRes.recordset });
    } catch (err) {
        console.error('Supplier payments GET error:', err);
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

        let pSql = `SELECT N'فاتورة' as type, invoice_date as date, invoice_no as doc_no,
                           0 as debit, grand_total as credit, id, 'purchase' as ref_type
                    FROM purchase_invoices WHERE supplier_id = @sid AND status != 'cancelled'`;
        if (from) { pSql += ` AND invoice_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { pSql += ` AND invoice_date <= @to`; request.input('to', sql.NVarChar, to); }

        let rSql = `SELECT N'مرتجع' as type, return_date as date, return_no as doc_no,
                           grand_total as debit, 0 as credit, id, 'purchase_return' as ref_type
                    FROM purchase_returns WHERE supplier_id = @sid AND status != 'cancelled'`;
        if (from) { rSql += ` AND return_date >= @from`; }
        if (to) { rSql += ` AND return_date <= @to`; }

        let paySql = `SELECT N'دفعة' as type, payment_date as date, payment_no as doc_no,
                             amount as debit, 0 as credit, id, 'payment' as ref_type
                      FROM supplier_payments WHERE supplier_id = @sid`;
        if (from) { paySql += ` AND payment_date >= @from`; }
        if (to) { paySql += ` AND payment_date <= @to`; }

        const sqlQuery = `${pSql} UNION ALL ${rSql} UNION ALL ${paySql} ORDER BY date ASC, id ASC`;
        
        const rowsRes = await request.query(sqlQuery);
        const rows = rowsRes.recordset;

        let running = supplier.opening_balance || 0;
        const statement = rows.map(r => {
            running += (r.credit || 0) - (r.debit || 0);
            return { ...r, balance: running };
        });

        res.json({
            success: true,
            data: {
                supplier,
                opening_balance: supplier.opening_balance || 0,
                total_credit: statement.reduce((s, r) => s + (r.credit || 0), 0),
                total_debit: statement.reduce((s, r) => s + (r.debit || 0), 0),
                current_balance: supplier.current_balance || 0,
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

module.exports = router;
