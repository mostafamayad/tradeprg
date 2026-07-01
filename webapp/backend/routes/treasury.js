// ============================================================
// ROUTE: Treasury (الخزينة والبنوك)
// ============================================================

const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');

// ============================================================
// Private Helper: nextDocNoAsync
// Replicates helpers.nextDocNo() without modifying helpers.js.
// Must be called with a transaction request object.
// Uses UPDLOCK to prevent duplicate document numbers under concurrent requests.
// ============================================================
async function nextDocNoAsync(txRequest, counterName) {
    txRequest.input(`cn_${counterName}`, sql.NVarChar, counterName);
    const row = await txRequest.query(`
        SELECT prefix, last_number 
        FROM invoice_counters WITH (UPDLOCK) 
        WHERE counter_name = @cn_${counterName}
    `);
    if (!row.recordset[0]) return 'DOC-0001';
    const next = row.recordset[0].last_number + 1;
    txRequest.input(`cn_next_${counterName}`, sql.Int, next);
    await txRequest.query(`
        UPDATE invoice_counters 
        SET last_number = @cn_next_${counterName} 
        WHERE counter_name = @cn_${counterName}
    `);
    return `${row.recordset[0].prefix}-${String(next).padStart(4, '0')}`;
}

// ── Treasury Accounts (الحسابات) ───────────────────────────
router.get('/accounts', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM treasury_accounts ORDER BY id');
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Treasury accounts GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.post('/accounts', asyncHandler(async (req, res) => {
    const { account_name, account_type, bank_name, account_no, opening_balance } = req.body;
    if (!account_name) return res.status(400).json({ success: false, message: 'اسم الحساب مطلوب' });
    try {
        const pool = await getPool();
        const ob = opening_balance || 0;
        const result = await pool.request()
            .input('account_name', sql.NVarChar, account_name)
            .input('account_type', sql.NVarChar, account_type || 'cash')
            .input('bank_name', sql.NVarChar, bank_name || null)
            .input('account_no', sql.NVarChar, account_no || null)
            .input('ob', sql.Decimal(18, 2), ob)
            .query(`
                INSERT INTO treasury_accounts (account_name, account_type, bank_name, account_no, opening_balance, current_balance)
                OUTPUT INSERTED.id
                VALUES (@account_name, @account_type, @bank_name, @account_no, @ob, @ob)
            `);
        res.status(201).json({ success: true, id: result.recordset[0].id });
    } catch (err) {
        console.error('Treasury accounts POST error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Transactions ────────────────────────────────────────────
router.get('/transactions', asyncHandler(async (req, res) => {
    try {
        const { account_id, from, to, trans_type } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let sqlQuery = `SELECT TOP 500 t.*, ta.account_name, ta.bank_name
                       FROM treasury_transactions t
                       LEFT JOIN treasury_accounts ta ON t.account_id = ta.id
                       WHERE 1=1`;

        if (account_id) { sqlQuery += ` AND t.account_id = @accountId`; request.input('accountId', sql.Int, account_id); }
        if (from) { sqlQuery += ` AND t.trans_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND t.trans_date <= @to`; request.input('to', sql.NVarChar, to); }
        if (trans_type) { sqlQuery += ` AND t.trans_type = @transType`; request.input('transType', sql.NVarChar, trans_type); }
        sqlQuery += ` ORDER BY t.id DESC`;

        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Treasury transactions GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.post('/transactions', asyncHandler(async (req, res) => {
    const { account_id, trans_date, trans_type, amount, related_type, related_id, document_no, description } = req.body;
    if (!account_id || !amount || !trans_type) return res.status(400).json({ success: false, message: 'بيانات ناقصة' });

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        const transNo = await nextDocNoAsync(txRequest, 'treasury');
        const tDate = trans_date || new Date().toISOString().slice(0, 10);

        const result = await txRequest
            .input('transNo', sql.NVarChar, transNo)
            .input('tDate', sql.NVarChar, tDate)
            .input('transType', sql.NVarChar, trans_type)
            .input('amount', sql.Decimal(18, 2), amount)
            .input('accountId', sql.Int, account_id)
            .input('relatedType', sql.NVarChar, related_type || null)
            .input('relatedId', sql.Int, related_id || null)
            .input('documentNo', sql.NVarChar, document_no || null)
            .input('description', sql.NVarChar, description || '')
            .query(`
                INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
                OUTPUT INSERTED.id
                VALUES (@transNo, @tDate, @transType, @amount, @accountId, @relatedType, @relatedId, @documentNo, @description)
            `);

        // Atomic balance update: + for 'in', - for 'out'
        const delta = trans_type === 'in' ? amount : -amount;
        txRequest.input('delta', sql.Decimal(18, 2), delta);
        txRequest.input('balAccId', sql.Int, account_id);
        await txRequest.query(`
            UPDATE treasury_accounts SET current_balance = current_balance + @delta WHERE id = @balAccId
        `);

        await transaction.commit();
        res.status(201).json({ success: true, message: 'تم تسجيل الحركة', id: result.recordset[0].id });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Treasury transactions POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

// ── Expense / Receipt (مصروفات/إيرادات أخرى) ────────────────
router.get('/expenses', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT TOP 500 e.*, ta.account_name, c.account_name as coa_name
            FROM expenses e
            LEFT JOIN treasury_accounts ta ON e.treasury_id = ta.id
            LEFT JOIN chart_of_accounts c ON e.account_id = c.id
            ORDER BY e.id DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Treasury expenses GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.post('/expenses', asyncHandler(async (req, res) => {
    const { expense_date, expense_type, account_id, treasury_id, amount, description } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'قيمة المصروف مطلوبة' });

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        const expNo = await nextDocNoAsync(txRequest, 'expense');
        const eDate = expense_date || new Date().toISOString().slice(0, 10);

        const expResult = await txRequest
            .input('expNo', sql.NVarChar, expNo)
            .input('eDate', sql.NVarChar, eDate)
            .input('expType', sql.NVarChar, expense_type || 'general')
            .input('accountId', sql.Int, account_id || null)
            .input('treasuryId', sql.Int, treasury_id || null)
            .input('amount', sql.Decimal(18, 2), amount)
            .input('description', sql.NVarChar, description || '')
            .query(`
                INSERT INTO expenses (expense_no, expense_date, expense_type, account_id, treasury_id, amount, description)
                OUTPUT INSERTED.id
                VALUES (@expNo, @eDate, @expType, @accountId, @treasuryId, @amount, @description)
            `);
        const id = expResult.recordset[0].id;

        // If linked to a treasury account: register an 'out' treasury transaction + debit balance
        // Both inserts are inside the same transaction — either both succeed or both rollback
        if (treasury_id) {
            const transNo = await nextDocNoAsync(txRequest, 'treasury');
            txRequest.input('transNo', sql.NVarChar, transNo);
            txRequest.input('tDate', sql.NVarChar, eDate);
            txRequest.input('txAmount', sql.Decimal(18, 2), amount);
            txRequest.input('txTreasuryId', sql.Int, treasury_id);
            txRequest.input('txExpId', sql.Int, id);
            txRequest.input('txExpNo', sql.NVarChar, expNo);
            txRequest.input('txDesc', sql.NVarChar, description || '');
            await txRequest.query(`
                INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
                VALUES (@transNo, @tDate, 'out', @txAmount, @txTreasuryId, 'expense', @txExpId, @txExpNo, @txDesc)
            `);
            txRequest.input('expDelta', sql.Decimal(18, 2), amount);
            txRequest.input('expAccId', sql.Int, treasury_id);
            await txRequest.query(`
                UPDATE treasury_accounts SET current_balance = current_balance - @expDelta WHERE id = @expAccId
            `);
        }

        await transaction.commit();
        res.status(201).json({ success: true, message: 'تم تسجيل المصروف', id });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Treasury expenses POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

// ── Summary (ملخص) ─────────────────────────────────────────
router.get('/summary', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();

        const accountsRes = await request.query('SELECT * FROM treasury_accounts ORDER BY id');
        const totalInRes = await request.query(`SELECT COALESCE(SUM(amount), 0) as v FROM treasury_transactions WHERE trans_type = 'in'`);
        const totalOutRes = await request.query(`SELECT COALESCE(SUM(amount), 0) as v FROM treasury_transactions WHERE trans_type = 'out'`);

        const accounts = accountsRes.recordset;
        const totalIn = totalInRes.recordset[0].v;
        const totalOut = totalOutRes.recordset[0].v;

        res.json({
            success: true,
            data: {
                accounts,
                total_in: totalIn,
                total_out: totalOut,
                net: totalIn - totalOut,
                total_balance: accounts.reduce((s, a) => s + (a.current_balance || 0), 0)
            }
        });
    } catch (err) {
        console.error('Treasury summary GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

module.exports = router;