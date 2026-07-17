// ============================================================
// ROUTE: Supplier Payments
// ============================================================
const router = require('express').Router();
const { getPool, sql } = require('../../database/mssql_db');
const asyncHandler = require('../../utils/asyncHandler');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync, recalcSupplierBalanceAsync } = require('../../services/accountingEngine');
const { updateStockBalanceAsync } = require('../../services/stockEngine');
const { createTreasuryTransactionAsync } = require('../../services/treasuryEngine');
const { nextDocNoAsync } = require('../../services/documentEngine');
const logActivity = require('../../middleware/logger');
const { userHasPermission } = require('../../middleware/permissions');

// ── Supplier Payments (مدفوعات الموردين) ─────────────────
router.get('/payments', asyncHandler(async (req, res) => {
    try {
        const { q, supplier_id, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let sqlQuery = `SELECT sp.*, s.supplier_name FROM supplier_payments sp LEFT JOIN suppliers s ON sp.supplier_id = s.id WHERE 1=1`;
        
        if (q) { 
            sqlQuery += ` AND (sp.payment_no LIKE @q OR s.supplier_name LIKE @q)`; 
            request.input('q', sql.NVarChar, `%${q}%`); 
        }
        if (supplier_id) { sqlQuery += ` AND sp.supplier_id = @supplierId`; request.input('supplierId', sql.Int, supplier_id); }
        if (from) { sqlQuery += ` AND sp.payment_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND sp.payment_date <= @to`; request.input('to', sql.NVarChar, to); }
        
        sqlQuery += ` ORDER BY sp.id DESC`;
        
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Supplier payments GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.post('/payments', async (req, res) => {
    const { payment_no, supplier_id, payment_date, amount, payment_method, notes } = req.body;
    if (!supplier_id || !amount) return res.status(400).json({ success: false, message: 'المورد والمبلغ مطلوبان' });

    let transaction;
    try {
        const pool = await getPool();
        
        if (payment_no) {
            const existing = await pool.request()
                .input('payNo', sql.NVarChar, payment_no)
                .query('SELECT id FROM supplier_payments WHERE payment_no = @payNo');
            if (existing.recordset.length > 0) {
                return res.status(400).json({ success: false, code: 'DUPLICATE_PAYMENT_NO', message: 'رقم السند موجود مسبقاً، الرجاء اختيار رقم آخر.' });
            }
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        const payNo = payment_no ? payment_no : await nextDocNoAsync(txRequest, 'supplier_payments');
        const pDate = payment_date || new Date().toISOString().slice(0, 10);
        
        await txRequest
            .input('spNo', sql.NVarChar, payNo)
            .input('spDate', sql.NVarChar, pDate)
            .input('spSuppId', sql.Int, supplier_id)
            .input('spAmount', sql.Decimal(18, 2), amount)
            .input('spMethod', sql.NVarChar, payment_method || 'cash')
            .input('spNotes', sql.NVarChar, notes || '')
            .query(`
                INSERT INTO supplier_payments (payment_no, payment_date, supplier_id, amount, payment_method, notes) 
                VALUES (@spNo, @spDate, @spSuppId, @spAmount, @spMethod, @spNotes)
            `);

        const tresRes = await txRequest.query(`SELECT TOP 1 id FROM treasury_accounts WHERE account_type = 'cash'`);
        const treasury = tresRes.recordset[0];
        
        if (treasury) {
            const transNo = await nextDocNoAsync(txRequest, 'treasury');
            await createTreasuryTransactionAsync(txRequest, {
                transNo, transDate: pDate, transType: 'out', amount,
                accountId: treasury.id, relatedType: 'supplier_payment', relatedId: supplier_id,
                documentNo: payNo, description: `دفعية للمورد ${payNo}`,
                userId: req.user ? req.user.id : null
            });
        }

        await recalcSupplierBalanceAsync(txRequest, supplier_id);
        
        await transaction.commit();
        res.status(201).json({ success: true, message: 'تم تسجيل الدفعة', payment_no: payNo });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Supplier payments POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

module.exports = router;
