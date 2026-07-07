const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const { postJournalEntryAsync, reverseJournalEntryAsync } = require('../services/accountingEngine');
const asyncHandler = require('../utils/asyncHandler');
const accountRepo = require('../repositories/accountRepository');
const fiscalRepo = require('../repositories/fiscalPeriodRepository');
// ── Fiscal Periods ──────────────────────────────────────────

// GET all fiscal periods
router.get('/fiscal-periods', asyncHandler(async (req, res) => {
    const periods = await fiscalRepo.getAll();
    res.json({ success: true, data: periods });
}));

// GET active fiscal period
router.get('/fiscal-periods/active', asyncHandler(async (req, res) => {
    const period = await fiscalRepo.getActive();
    res.json({ success: true, data: period || null });
}));

// GET single fiscal period
router.get('/fiscal-periods/:id', asyncHandler(async (req, res) => {
    const period = await fiscalRepo.getById(parseInt(req.params.id));
    if (!period) {
        return res.status(404).json({ success: false, message: 'الفترة المالية غير موجودة' });
    }
    res.json({ success: true, data: period });
}));

// POST create fiscal period
router.post('/fiscal-periods', asyncHandler(async (req, res) => {
    const { name, start_date, end_date } = req.body;
    if (!name || !start_date || !end_date) {
        return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة: الاسم، تاريخ البداية، تاريخ النهاية' });
    }
    if (new Date(end_date) < new Date(start_date)) {
        return res.status(400).json({ success: false, message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية' });
    }
    const period = await fiscalRepo.create({ name, startDate: start_date, endDate: end_date, userId: req.user ? req.user.id : null });
    res.status(201).json({ success: true, message: 'تم إنشاء الفترة المالية بنجاح', data: period });
}));

// POST close fiscal period
router.post('/fiscal-periods/:id/close', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const period = await fiscalRepo.getById(id);
    if (!period) {
        return res.status(404).json({ success: false, message: 'الفترة المالية غير موجودة' });
    }
    if (period.status === 'closed') {
        return res.status(400).json({ success: false, message: 'الفترة المالية مغلقة بالفعل' });
    }
    const closed = await fiscalRepo.close(id, req.user ? req.user.id : null);
    if (!closed) {
        return res.status(400).json({ success: false, message: 'تعذر إغلاق الفترة المالية' });
    }
    res.json({ success: true, message: 'تم إغلاق الفترة المالية بنجاح', data: closed });
}));

// POST reopen fiscal period (requires permission)
router.post('/fiscal-periods/:id/reopen', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const period = await fiscalRepo.getById(id);
    if (!period) {
        return res.status(404).json({ success: false, message: 'الفترة المالية غير موجودة' });
    }
    if (period.status === 'open') {
        return res.status(400).json({ success: false, message: 'الفترة المالية مفتوحة بالفعل' });
    }
    const opened = await fiscalRepo.open(id, req.user ? req.user.id : null);
    if (!opened) {
        return res.status(400).json({ success: false, message: 'تعذر إعادة فتح الفترة المالية' });
    }
    res.json({ success: true, message: 'تم إعادة فتح الفترة المالية بنجاح', data: opened });
}));

// PUT update fiscal period (name/notes only)
router.put('/fiscal-periods/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const period = await fiscalRepo.getById(id);
    if (!period) {
        return res.status(404).json({ success: false, message: 'الفترة المالية غير موجودة' });
    }
    const { notes } = req.body;
    const pool = await getPool();
    const r = await pool.request()
        .input('id', sql.Int, id)
        .input('notes', sql.NVarChar(sql.MAX), notes || null)
        .query(`UPDATE fiscal_periods SET notes = @notes OUTPUT INSERTED.* WHERE id = @id`);
    res.json({ success: true, message: 'تم تحديث الفترة المالية بنجاح', data: r.recordset[0] });
}));

// ── Chart of Accounts (COA) ─────────────────────────────────

// Seed Default COA
router.post('/coa/seed', asyncHandler(async (req, res) => {
    let transaction;
    try {
        const pool = await getPool();
        const existing = await pool.request().query('SELECT COUNT(*) as cnt FROM chart_of_accounts');
        if (existing.recordset[0].cnt > 0) {
            return res.status(400).json({ success: false, message: 'شجرة الحسابات موجودة مسبقاً.' });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txReq = transaction.request();

        // Level 1: Main Categories
        const categories = [
            { code: '1', name: 'الأصول', type: 'asset' },
            { code: '2', name: 'الخصوم', type: 'liability' },
            { code: '3', name: 'حقوق الملكية', type: 'equity' },
            { code: '4', name: 'الإيرادات', type: 'revenue' },
            { code: '5', name: 'المصروفات', type: 'expense' }
        ];

        const insertedCats = {};
        for (const cat of categories) {
            const res = await txReq.query(`
                INSERT INTO chart_of_accounts (account_code, account_name, account_type, is_active, current_balance)
                OUTPUT INSERTED.id
                VALUES ('${cat.code}', N'${cat.name}', '${cat.type}', 1, 0)
            `);
            insertedCats[cat.code] = res.recordset[0].id;
        }

        // Level 2 & 3
        const subAccounts = [
            // Assets
            { code: '11', name: 'الأصول المتداولة', type: 'asset', parent: '1' },
            { code: '111', name: 'النقدية بالخزينة', type: 'asset', parent: '11', sys: 'SYS_CASH' },
            { code: '112', name: 'النقدية بالبنوك', type: 'asset', parent: '11', sys: 'SYS_BANK' },
            { code: '113', name: 'العملاء (الذمم المدينة)', type: 'asset', parent: '11', sys: 'SYS_AR' },
            { code: '114', name: 'المخزون', type: 'asset', parent: '11', sys: 'SYS_INVENTORY' },
            { code: '115', name: 'ضريبة القيمة المضافة (مدخلات)', type: 'asset', parent: '11', sys: 'SYS_VAT_INPUT' },
            { code: '12', name: 'الأصول الثابتة', type: 'asset', parent: '1' },
            
            // Liabilities
            { code: '21', name: 'الخصوم المتداولة', type: 'liability', parent: '2' },
            { code: '211', name: 'الموردين (الذمم الدائنة)', type: 'liability', parent: '21', sys: 'SYS_AP' },
            { code: '212', name: 'ضريبة القيمة المضافة (مخرجات)', type: 'liability', parent: '21', sys: 'SYS_VAT_OUTPUT' },
            
            // Equity
            { code: '31', name: 'رأس المال', type: 'equity', parent: '3' },
            { code: '32', name: 'الأرباح المحتجزة', type: 'equity', parent: '3', sys: 'SYS_RETAINED_EARNINGS' },
            
            // Revenue
            { code: '41', name: 'إيرادات المبيعات', type: 'revenue', parent: '4', sys: 'SYS_SALES' },
            { code: '42', name: 'إيرادات أخرى', type: 'revenue', parent: '4' },
            { code: '43', name: 'زيادة وتسويات المخزون', type: 'revenue', parent: '4', sys: 'SYS_INVENTORY_SURPLUS' },
            
            // Expenses
            { code: '51', name: 'تكلفة البضاعة المباعة (COGS)', type: 'expense', parent: '5', sys: 'SYS_COGS' },
            { code: '52', name: 'مشتريات', type: 'expense', parent: '5', sys: 'SYS_PURCHASES' },
            { code: '53', name: 'مصروفات التشغيل', type: 'expense', parent: '5', sys: 'SYS_EXPENSE' },
            { code: '54', name: 'خسائر توالف مخزون', type: 'expense', parent: '5', sys: 'SYS_INVENTORY_SHORTAGE' },
            { code: '55', name: 'مصروفات عامة وإدارية', type: 'expense', parent: '5' },
            
            // Returns (Contra-Revenue/Contra-Expense handled as Expenses/Revenues respectively or separate)
            { code: '56', name: 'مردودات المبيعات', type: 'expense', parent: '5', sys: 'SYS_SALES_RETURNS' },
            { code: '44', name: 'مردودات المشتريات', type: 'revenue', parent: '4', sys: 'SYS_PURCHASE_RETURNS' }
        ];

        const insertedSubs = { ...insertedCats };
        for (const sub of subAccounts) {
            const parentId = insertedSubs[sub.parent];
            const sysCode = sub.sys ? `'${sub.sys}'` : 'NULL';
            const res = await txReq.query(`
                INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, is_active, current_balance, system_code)
                OUTPUT INSERTED.id
                VALUES ('${sub.code}', N'${sub.name}', ${parentId}, '${sub.type}', 1, 0, ${sysCode})
            `);
            insertedSubs[sub.code] = res.recordset[0].id;
        }

        await transaction.commit();
        res.json({ success: true, message: 'تم إنشاء شجرة الحسابات الأساسية بنجاح.' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('COA Seed Error:', err);
        res.status(500).json({ success: false, message: 'خطأ أثناء تهيئة الحسابات' });
    }
}));

// GET Accounts (List or Tree)
router.get('/accounts', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT a.*, p.account_name as parent_name 
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_id = p.id
            ORDER BY a.account_code ASC
        `);
        
        const accounts = result.recordset;
        res.json({ success: true, data: accounts });
    } catch (err) {
        console.error('GET Accounts Error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// GET Accounts Tree (Hierarchical)
router.get('/accounts/tree', asyncHandler(async (req, res) => {
    try {
        const tree = await accountRepo.getTree();
        res.json({ success: true, data: tree });
    } catch (err) {
        console.error('GET Accounts Tree Error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

// GET Account by ID
router.get('/accounts/:id', asyncHandler(async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: 'معرف الحساب مطلوب' });
        const account = await accountRepo.getById(id);
        if (!account) return res.status(404).json({ success: false, message: 'الحساب غير موجود' });
        res.json({ success: true, data: account });
    } catch (err) {
        console.error('GET Account By ID Error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

// POST Create Account
router.post('/accounts', asyncHandler(async (req, res) => {
    try {
        const errors = await accountRepo.validateCreate(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join(' | ') });
        }
        const id = await accountRepo.create(req.body);
        res.json({ success: true, message: 'تم إنشاء الحساب بنجاح', id });
    } catch (err) {
        console.error('POST Create Account Error:', err);
        res.status(500).json({ success: false, message: err.message || 'خطأ في الخادم' });
    }
}));

// PUT Update Account
router.put('/accounts/:id', asyncHandler(async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: 'معرف الحساب مطلوب' });
        const errors = await accountRepo.validateUpdate(req.body, id);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join(' | ') });
        }
        await accountRepo.update(id, req.body);
        res.json({ success: true, message: 'تم تحديث الحساب بنجاح' });
    } catch (err) {
        console.error('PUT Update Account Error:', err);
        res.status(500).json({ success: false, message: err.message || 'خطأ في الخادم' });
    }
}));

// PATCH Toggle Account Active Status
router.patch('/accounts/:id/toggle', asyncHandler(async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: 'معرف الحساب مطلوب' });

        const account = await accountRepo.getById(id);
        if (!account) return res.status(404).json({ success: false, message: 'الحساب غير موجود' });
        if (account.system_code) {
            return res.status(400).json({ success: false, message: 'لا يمكن تعطيل حساب نظامي ("' + account.account_name + '")' });
        }
        if (await accountRepo.hasChildren(id)) {
            return res.status(400).json({ success: false, message: 'لا يمكن تعطيل حساب لديه أبناء. قم بنقل أو حذف الأبناء أولاً' });
        }

        await accountRepo.toggleStatus(id);
        const updated = await accountRepo.getById(id);
        res.json({ success: true, message: 'تم تغيير حالة الحساب بنجاح', data: updated });
    } catch (err) {
        console.error('PATCH Toggle Account Error:', err);
        res.status(500).json({ success: false, message: err.message || 'خطأ في الخادم' });
    }
}));

// ── Journal Entries ──────────────────────────────────────────

// List Journal Entries
router.get('/journals', asyncHandler(async (req, res) => {
    try {
        const { from, to, ref_type } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let sqlQuery = `
            SELECT TOP 500 * FROM journal_entries WHERE 1=1
        `;

        if (from) { sqlQuery += ` AND entry_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND entry_date <= @to`; request.input('to', sql.NVarChar, to); }
        if (ref_type) { sqlQuery += ` AND reference_type = @refType`; request.input('refType', sql.NVarChar, ref_type); }
        
        sqlQuery += ` ORDER BY id DESC`;

        const result = await request.query(sqlQuery);
        
        // Fetch lines for the retrieved entries
        if (result.recordset.length > 0) {
            const entryIds = result.recordset.map(e => e.id);
            const linesRes = await request.query(`
                SELECT l.*, a.account_name, a.account_code 
                FROM journal_entry_lines l
                JOIN chart_of_accounts a ON l.account_id = a.id
                WHERE l.entry_id IN (${entryIds.join(',')})
            `);
            
            // Group lines by entry
            result.recordset.forEach(entry => {
                entry.lines = linesRes.recordset.filter(l => l.entry_id === entry.id);
            });
        }

        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('GET Journals Error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// Manual Journal Entry (For testing / manual adjustments)
router.post('/journals', asyncHandler(async (req, res) => {
    const { date, description, lines } = req.body;
    
    if (!date || !description || !lines || lines.length === 0) {
        return res.status(400).json({ success: false, message: 'بيانات القيد غير مكتملة' });
    }

    // Check fiscal period is not closed
    if (await fiscalRepo.isDateInClosedPeriod(date)) {
        return res.status(403).json({ success: false, message: 'لا يمكن ترحيل القيود في فترة مالية مغلقة' });
    }

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txReq = transaction.request();

        const userId = req.user ? req.user.id : null;

        const entryId = await postJournalEntryAsync(
            txReq,
            date,
            description,
            lines,
            'manual_je',
            null,
            userId,
            { module: 'accounting', action: 'manual_entry', document: 'N/A', isSystem: false }
        );

        await transaction.commit();
        res.json({ success: true, message: 'تم حفظ القيد المحاسبي بنجاح', id: entryId });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('POST Journal Error:', err);
        res.status(400).json({ success: false, message: err.message || 'خطأ في الخادم' });
    }
}));

// Journal Browser with Pagination, Search, Filters
router.get('/journals/browser', asyncHandler(async (req, res) => {
    try {
        const { page = 1, pageSize = 20, from, to, ref_type, ref_id, search, sortBy, sortDirection, account_id, created_by, minAmount, maxAmount } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const size = Math.min(100, Math.max(1, parseInt(pageSize) || 20));
        const offset = (pageNum - 1) * size;

        const pool = await getPool();
        const request = pool.request();

        const ALLOWED_SORT = { entry_no: 'j.entry_no', entry_date: 'j.entry_date', total_debit: 'j.total_debit', total_credit: 'j.total_credit', id: 'j.id', reference_type: 'j.reference_type', description: 'j.description' };
        const sortCol = ALLOWED_SORT[sortBy] || 'j.id';
        const sortDir = (sortDirection && sortDirection.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

        let where = ' WHERE 1=1';
        let whereLines = '';
        if (from) { where += ' AND j.entry_date >= @from'; request.input('from', sql.NVarChar, from); }
        if (to) { where += ' AND j.entry_date <= @to'; request.input('to', sql.NVarChar, to); }
        if (ref_type) { where += ' AND j.reference_type = @refType'; request.input('refType', sql.NVarChar, ref_type); }
        if (ref_id) { where += ' AND j.reference_id = @refId'; request.input('refId', sql.Int, parseInt(ref_id)); }
        if (search) { where += ' AND (j.description LIKE @search OR j.entry_no LIKE @search)'; request.input('search', sql.NVarChar, '%' + search + '%'); }
        if (created_by) { where += ' AND j.created_by = @createdBy'; request.input('createdBy', sql.Int, parseInt(created_by)); }
        if (minAmount) { where += ' AND j.total_debit >= @minAmt'; request.input('minAmt', sql.Decimal(18,2), parseFloat(minAmount)); }
        if (maxAmount) { where += ' AND j.total_debit <= @maxAmt'; request.input('maxAmt', sql.Decimal(18,2), parseFloat(maxAmount)); }
        if (account_id) { whereLines = ' AND l.account_id = @accId'; request.input('accId', sql.Int, parseInt(account_id)); }

        // When filtering by account_id, we need a subquery to find matching journal entries
        let fromClause = 'FROM journal_entries j';
        if (account_id) {
            // Filter by entries that have a line with the specified account
            fromClause = `FROM (SELECT DISTINCT j.* FROM journal_entries j JOIN journal_entry_lines l ON j.id = l.entry_id${whereLines}) j`;
            // The WHERE clause is applied in the outer query
            const countResult = await request.query(`SELECT COUNT(*) AS total ${fromClause}${where}`);
            const total = countResult.recordset[0].total;
            const totalPages = Math.ceil(total / size);

            const result = await request.query(`
                SELECT j.* ${fromClause}${where} ORDER BY ${sortCol} ${sortDir} OFFSET ${offset} ROWS FETCH NEXT ${size} ROWS ONLY
            `);

            if (result.recordset.length > 0) {
                const entryIds = result.recordset.map(e => e.id);
                const linesRes = await request.query(`
                    SELECT l.*, a.account_name, a.account_code 
                    FROM journal_entry_lines l
                    JOIN chart_of_accounts a ON l.account_id = a.id
                    WHERE l.entry_id IN (${entryIds.join(',')})
                `);
                result.recordset.forEach(entry => {
                    entry.lines = linesRes.recordset.filter(l => l.entry_id === entry.id);
                });
            }

            return res.json({ success: true, data: result.recordset, total, page: pageNum, pageSize: size, totalPages });
        }

        const countResult = await request.query(`SELECT COUNT(*) AS total ${fromClause}${where}`);
        const total = countResult.recordset[0].total;
        const totalPages = Math.ceil(total / size);

        const result = await request.query(`
            SELECT j.* ${fromClause}${where} ORDER BY ${sortCol} ${sortDir} OFFSET ${offset} ROWS FETCH NEXT ${size} ROWS ONLY
        `);

        if (result.recordset.length > 0) {
            const entryIds = result.recordset.map(e => e.id);
            const linesRes = await request.query(`
                SELECT l.*, a.account_name, a.account_code 
                FROM journal_entry_lines l
                JOIN chart_of_accounts a ON l.account_id = a.id
                WHERE l.entry_id IN (${entryIds.join(',')})
            `);
            result.recordset.forEach(entry => {
                entry.lines = linesRes.recordset.filter(l => l.entry_id === entry.id);
            });
        }

        res.json({ success: true, data: result.recordset, total, page: pageNum, pageSize: size, totalPages });
    } catch (err) {
        console.error('GET Journals Browser Error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Reverse Journal ─────────────────────────────────────────────

// POST /journals/:id/reverse — Reverse a journal entry (creates new entry, never deletes)
router.post('/journals/:id/reverse', asyncHandler(async (req, res) => {
    try {
        const journalId = parseInt(req.params.id);
        if (!journalId) return res.status(400).json({ success: false, message: 'رقم القيد غير صحيح' });

        const pool = await getPool();
        const request = pool.request();
        request.input('jid', sql.Int, journalId);

        // 1) Verify journal exists and get its date
        const jRes = await request.query('SELECT id, entry_no, entry_date, is_reversed FROM journal_entries WHERE id = @jid');
        if (!jRes.recordset[0]) {
            return res.status(404).json({ success: false, message: 'القيد غير موجود' });
        }
        const journal = jRes.recordset[0];

        // 2) Check not already reversed
        if (journal.is_reversed) {
            return res.status(400).json({ success: false, message: 'هذا القيد تم عكسه مسبقاً' });
        }

        // 3) Fiscal period check — block reversal in closed period
        if (journal.entry_date) {
            const dateStr = typeof journal.entry_date === 'string' ? journal.entry_date.split('T')[0] : new Date(journal.entry_date).toISOString().split('T')[0];
            if (await fiscalRepo.isDateInClosedPeriod(dateStr)) {
                return res.status(403).json({ success: false, message: 'لا يمكن عكس قيد في فترة مالية مغلقة' });
            }
        }

        // 4) Execute reversal in a transaction
        const transaction = pool.transaction();
        await transaction.begin();
        try {
            const txReq = transaction.request();
            const desc = req.body.description || `قيد عكسي للقيد ${journal.entry_no}`;
            const userId = req.user ? req.user.id : null;

            const newEntryId = await reverseJournalEntryAsync(txReq, journalId, desc, userId);

            // Also set reversal_of_id on the new entry for bidirectional linking
            txReq.input('newId', sql.Int, newEntryId);
            txReq.input('origId', sql.Int, journalId);
            await txReq.query('UPDATE journal_entries SET reversal_of_id = @origId WHERE id = @newId');

            await transaction.commit();

            // Fetch the new entry number for response
            const newEntryReq = pool.request();
            newEntryReq.input('neId', sql.Int, newEntryId);
            const neRes = await newEntryReq.query('SELECT id, entry_no, entry_date FROM journal_entries WHERE id = @neId');

            res.json({
                success: true,
                message: `تم عكس القيد ${journal.entry_no} بنجاح`,
                reversal: neRes.recordset[0]
            });
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }
    } catch (err) {
        console.error('POST Reverse Journal Error:', err);
        err.status = err.status || 500;
        err.message = err.message || 'خطأ في عكس القيد';
        throw err;
    }
}));

// ── Ledger ──────────────────────────────────────────────────

// General Ledger Statement (كشف حساب أستاذ)
router.get('/ledger/:accountId', asyncHandler(async (req, res) => {
    try {
        const accountId = req.params.accountId;
        const { from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        
        request.input('accId', sql.Int, accountId);

        // Verify account exists
        const accRes = await request.query(`SELECT account_name, account_code, current_balance FROM chart_of_accounts WHERE id = @accId`);
        if (!accRes.recordset[0]) {
            return res.status(404).json({ success: false, message: 'الحساب غير موجود' });
        }
        
        let sqlQuery = `
            SELECT l.debit, l.credit, l.description as line_desc, 
                   j.entry_no, j.entry_date, j.description as journal_desc, j.reference_type
            FROM journal_entry_lines l
            JOIN journal_entries j ON l.entry_id = j.id
            WHERE l.account_id = @accId
        `;

        if (from) { sqlQuery += ` AND j.entry_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND j.entry_date <= @to`; request.input('to', sql.NVarChar, to); }
        
        sqlQuery += ` ORDER BY j.entry_date ASC, j.id ASC`;

        const linesRes = await request.query(sqlQuery);

        res.json({
            success: true,
            account: accRes.recordset[0],
            lines: linesRes.recordset
        });
    } catch (err) {
        console.error('GET Ledger Error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Trial Balance ───────────────────────────────────────────────

// Trial Balance (ميزان المراجعة) based on journal_entry_lines
router.get('/trial-balance', asyncHandler(async (req, res) => {
    try {
        const { from, to, accountType, includeZero } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let openingWhere = ' WHERE 1=0';  // No opening balance without a "from" cutoff
        let periodWhere = ' WHERE 1=1';

        if (from) {
            openingWhere = ' WHERE j.entry_date < @from';
            periodWhere += ' AND j.entry_date >= @from';
            request.input('from', sql.NVarChar, from);
        }
        if (to) {
            periodWhere += ' AND j.entry_date <= @to';
            request.input('to', sql.NVarChar, to);
        }

        const accTypeFilter = accountType ? ' AND a.account_type = @accType' : '';
        if (accountType) request.input('accType', sql.NVarChar, accountType);

        const zeroFilter = includeZero === 'false' || includeZero === '0'
            ? ' AND (ISNULL(o.opening_debit, 0) + ISNULL(o.opening_credit, 0) + ISNULL(p.period_debit, 0) + ISNULL(p.period_credit, 0) <> 0)'
            : '';

        const sqlQuery = `
            WITH opening AS (
                SELECT
                    l.account_id,
                    SUM(ISNULL(l.debit, 0)) AS opening_debit,
                    SUM(ISNULL(l.credit, 0)) AS opening_credit
                FROM journal_entry_lines l
                JOIN journal_entries j ON l.entry_id = j.id
                ${openingWhere}
                GROUP BY l.account_id
            ),
            period AS (
                SELECT
                    l.account_id,
                    SUM(ISNULL(l.debit, 0)) AS period_debit,
                    SUM(ISNULL(l.credit, 0)) AS period_credit
                FROM journal_entry_lines l
                JOIN journal_entries j ON l.entry_id = j.id
                ${periodWhere}
                GROUP BY l.account_id
            )
            SELECT
                a.id AS account_id,
                a.account_code,
                a.account_name,
                a.account_type,
                ISNULL(o.opening_debit, 0) AS opening_debit,
                ISNULL(o.opening_credit, 0) AS opening_credit,
                ISNULL(p.period_debit, 0) AS period_debit,
                ISNULL(p.period_credit, 0) AS period_credit
            FROM chart_of_accounts a
            LEFT JOIN opening o ON a.id = o.account_id
            LEFT JOIN period p ON a.id = p.account_id
            WHERE 1=1 ${accTypeFilter} ${zeroFilter}
            ORDER BY a.account_code
        `;

        const result = await request.query(sqlQuery);
        const accounts = result.recordset.map(function (r) {
            return {
                account_id: r.account_id,
                account_code: r.account_code,
                account_name: r.account_name,
                account_type: r.account_type,
                opening_debit: Number(r.opening_debit || 0),
                opening_credit: Number(r.opening_credit || 0),
                period_debit: Number(r.period_debit || 0),
                period_credit: Number(r.period_credit || 0),
                closing_debit: Number(r.opening_debit || 0) + Number(r.period_debit || 0),
                closing_credit: Number(r.opening_credit || 0) + Number(r.period_credit || 0)
            };
        });

        var totalDebit = 0, totalCredit = 0;
        for (var i = 0; i < accounts.length; i++) {
            totalDebit = Math.round((totalDebit + accounts[i].closing_debit) * 100) / 100;
            totalCredit = Math.round((totalCredit + accounts[i].closing_credit) * 100) / 100;
        }

        res.json({
            success: true,
            data: accounts,
            summary: {
                totalDebit: totalDebit,
                totalCredit: totalCredit,
                balanced: Math.abs(totalDebit - totalCredit) < 0.01
            }
        });
    } catch (err) {
        console.error('GET Trial Balance Error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── General Ledger ─────────────────────────────────────────

// General Ledger (الأستاذ العام / كشف حساب) — running balance via SQL window function
router.get('/general-ledger', asyncHandler(async (req, res) => {
    try {
        const { accountId, from, to, page = 1, pageSize = 50, includeOpening, search, reference_type, created_by } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const size = Math.min(200, Math.max(1, parseInt(pageSize) || 50));
        const offset = (pageNum - 1) * size;
        const showOpening = includeOpening === 'true' || includeOpening === '1' || includeOpening === '';

        const pool = await getPool();
        const request = pool.request();

        const hasFrom = !!from;
        const hasTo = !!to;
        const hasAccount = !!accountId;
        const hasSearch = !!search;
        const hasRefType = !!reference_type;
        const hasCreatedBy = !!created_by;

        if (hasAccount) request.input('accId', sql.Int, parseInt(accountId));
        if (hasFrom) request.input('from', sql.NVarChar, from);
        if (hasTo) request.input('to', sql.NVarChar, to);
        if (hasSearch) request.input('search', sql.NVarChar, '%' + search + '%');
        if (hasRefType) request.input('refType', sql.NVarChar, reference_type);
        if (hasCreatedBy) request.input('createdBy', sql.Int, parseInt(created_by));

        // 1) Opening balance before "from" date (only if from is provided)
        let openingRows = [];
        if (hasFrom) {
            const openingSQL = `
                SELECT
                    l.account_id,
                    SUM(ISNULL(l.debit, 0)) AS opening_debit,
                    SUM(ISNULL(l.credit, 0)) AS opening_credit
                FROM journal_entry_lines l
                JOIN journal_entries j ON l.entry_id = j.id
                WHERE j.entry_date < @from
                    ${hasAccount ? 'AND l.account_id = @accId' : ''}
                    ${hasRefType ? 'AND j.reference_type = @refType' : ''}
                    ${hasCreatedBy ? 'AND j.created_by = @createdBy' : ''}
                GROUP BY l.account_id
            `;
            const ores = await request.query(openingSQL);
            openingRows = ores.recordset;
        }

        // 2) Period movements with running net via window function
        //    We compute running_net across ALL matched rows per account (unbounded preceding)
        //    then paginate the outer query
        const movSQL = `
        WITH period_raw AS (
            SELECT
                l.account_id,
                a.account_code,
                a.account_name,
                a.account_type,
                j.entry_date,
                j.id AS journal_id,
                j.reference_type,
                j.entry_no AS ref_number,
                COALESCE(l.description, j.description) AS line_description,
                ISNULL(l.debit, 0) AS debit,
                ISNULL(l.credit, 0) AS credit
            FROM journal_entry_lines l
            JOIN journal_entries j ON l.entry_id = j.id
            JOIN chart_of_accounts a ON l.account_id = a.id
            WHERE 1=1
                ${hasFrom ? 'AND j.entry_date >= @from' : ''}
                ${hasTo ? 'AND j.entry_date <= @to' : ''}
                ${hasAccount ? 'AND l.account_id = @accId' : ''}
                ${hasSearch ? 'AND (j.description LIKE @search OR j.entry_no LIKE @search OR COALESCE(l.description, j.description) LIKE @search)' : ''}
                ${hasRefType ? 'AND j.reference_type = @refType' : ''}
                ${hasCreatedBy ? 'AND j.created_by = @createdBy' : ''}
        ),
        with_running AS (
            SELECT *,
                SUM(debit - credit) OVER(
                    PARTITION BY account_id
                    ORDER BY entry_date, journal_id
                    ROWS UNBOUNDED PRECEDING
                ) AS running_net,
                COUNT(*) OVER() AS total_count
            FROM period_raw
        )
        SELECT *
        FROM with_running
        ORDER BY account_code, entry_date, journal_id
        OFFSET ${offset} ROWS
        FETCH NEXT ${size} ROWS ONLY
        `;
        const movRes = await request.query(movSQL);
        const totalCount = movRes.recordset.length > 0 ? movRes.recordset[0].total_count : 0;
        const totalPages = Math.ceil(totalCount / size);

        // 3) Build opening map for quick lookup
        const openingMap = {};
        for (let i = 0; i < openingRows.length; i++) {
            const o = openingRows[i];
            openingMap[o.account_id] = {
                debit: Number(o.opening_debit || 0),
                credit: Number(o.opening_credit || 0)
            };
        }

        // 4) Assemble rows (opening + movements) per account
        const accountsMap = {};
        const accountsOrder = [];

        // Process movement rows, injecting opening balance
        for (let i = 0; i < movRes.recordset.length; i++) {
            const r = movRes.recordset[i];
            const aid = r.account_id;

            if (!accountsMap[aid]) {
                const op = openingMap[aid] || { debit: 0, credit: 0 };
                accountsMap[aid] = {
                    account_id: aid,
                    account_code: r.account_code,
                    account_name: r.account_name,
                    account_type: r.account_type,
                    opening_debit: op.debit,
                    opening_credit: op.credit,
                    opening_net: op.debit - op.credit,
                    lines: []
                };
                accountsOrder.push(aid);
            }

            const a = accountsMap[aid];
            const periodNet = Number(r.running_net || 0);
            const cumulativeNet = a.opening_net + periodNet;

            a.lines.push({
                entry_date: r.entry_date,
                journal_id: r.journal_id,
                reference_type: r.reference_type,
                ref_number: r.ref_number,
                description: r.line_description,
                debit: Number(r.debit || 0),
                credit: Number(r.credit || 0),
                running_balance: Math.round(Math.abs(cumulativeNet) * 100) / 100,
                running_balance_type: cumulativeNet >= 0 ? 'Dr' : 'Cr'
            });
        }

        // Add opening row as first line for each account (if showOpening)
        if (showOpening && hasFrom) {
            for (let oi = 0; oi < accountsOrder.length; oi++) {
                const a = accountsMap[accountsOrder[oi]];
                if (a.opening_debit > 0 || a.opening_credit > 0) {
                    a.lines.unshift({
                        is_opening: true,
                        entry_date: from,
                        journal_id: null,
                        reference_type: null,
                        ref_number: null,
                        description: 'رصيد أول المدة',
                        debit: a.opening_debit,
                        credit: a.opening_credit,
                        running_balance: Math.round(Math.abs(a.opening_net) * 100) / 100,
                        running_balance_type: a.opening_net >= 0 ? 'Dr' : 'Cr'
                    });
                }
            }
        }

        // 5) Compute totals per account
        for (let oi = 0; oi < accountsOrder.length; oi++) {
            const a = accountsMap[accountsOrder[oi]];
            let tDebit = 0, tCredit = 0;
            for (let li = 0; li < a.lines.length; li++) {
                tDebit = Math.round((tDebit + a.lines[li].debit) * 100) / 100;
                tCredit = Math.round((tCredit + a.lines[li].credit) * 100) / 100;
            }
            a.totals = { debit: tDebit, credit: tCredit };

            const lastLine = a.lines[a.lines.length - 1];
            if (lastLine) {
                a.closing_debit = lastLine.running_balance_type === 'Dr' ? lastLine.running_balance : 0;
                a.closing_credit = lastLine.running_balance_type === 'Cr' ? lastLine.running_balance : 0;
            } else {
                a.closing_debit = a.opening_net >= 0 ? Math.abs(a.opening_net) : 0;
                a.closing_credit = a.opening_net < 0 ? Math.abs(a.opening_net) : 0;
            }
        }

        // 6) For single account: ensure account exists in chart_of_accounts
        if (hasAccount) {
            // If account wasn't found in movements/opening, fetch it directly
            if (!accountsMap[accountId]) {
                const accCheck = await pool.request()
                    .input('id', sql.Int, parseInt(accountId))
                    .query('SELECT id, account_code, account_name, account_type FROM chart_of_accounts WHERE id = @id');
                if (!accCheck.recordset[0]) {
                    return res.status(404).json({ success: false, message: 'الحساب غير موجود' });
                }
                const ac = accCheck.recordset[0];
                const op = openingMap[accountId] || { debit: 0, credit: 0 };
                accountsMap[accountId] = {
                    account_id: ac.id,
                    account_code: ac.account_code,
                    account_name: ac.account_name,
                    account_type: ac.account_type,
                    opening_debit: op.debit,
                    opening_credit: op.credit,
                    opening_net: op.debit - op.credit,
                    lines: []
                };
            }

            const a = accountsMap[accountId];
            // Inject opening row for single account (opening injection at step 5 only covers accountsOrder)
            if (showOpening && hasFrom && a.lines.length === 0 && (a.opening_debit > 0 || a.opening_credit > 0)) {
                a.lines.push({
                    is_opening: true,
                    entry_date: from,
                    journal_id: null,
                    reference_type: null,
                    ref_number: null,
                    description: 'رصيد أول المدة',
                    debit: a.opening_debit,
                    credit: a.opening_credit,
                    running_balance: Math.round(Math.abs(a.opening_net) * 100) / 100,
                    running_balance_type: a.opening_net >= 0 ? 'Dr' : 'Cr'
                });
            }
            // Ensure totals
            if (!a.totals || a.lines.length === 0) {
                let tDebit = 0, tCredit = 0;
                for (let li = 0; li < a.lines.length; li++) {
                    tDebit = Math.round((tDebit + a.lines[li].debit) * 100) / 100;
                    tCredit = Math.round((tCredit + a.lines[li].credit) * 100) / 100;
                }
                a.totals = { debit: tDebit, credit: tCredit };
            }
            if (!a.closing_debit && !a.closing_credit) {
                const lastLine = a.lines[a.lines.length - 1];
                if (lastLine) {
                    a.closing_debit = lastLine.running_balance_type === 'Dr' ? lastLine.running_balance : 0;
                    a.closing_credit = lastLine.running_balance_type === 'Cr' ? lastLine.running_balance : 0;
                } else {
                    a.closing_debit = a.opening_net >= 0 ? Math.abs(a.opening_net) : 0;
                    a.closing_credit = a.opening_net < 0 ? Math.abs(a.opening_net) : 0;
                }
            }

            return res.json({
                success: true,
                account: {
                    id: a.account_id,
                    code: a.account_code,
                    name: a.account_name,
                    type: a.account_type
                },
                openingBalance: { debit: a.opening_debit, credit: a.opening_credit },
                data: a.lines,
                totals: a.totals,
                closingBalance: { debit: a.closing_debit, credit: a.closing_credit },
                page: pageNum,
                pageSize: size,
                total: totalCount,
                totalPages: totalPages
            });
        }

        // All accounts: return grouped
        const resultAccounts = [];
        for (let oi = 0; oi < accountsOrder.length; oi++) {
            const a = accountsMap[accountsOrder[oi]];
            resultAccounts.push({
                account: { id: a.account_id, code: a.account_code, name: a.account_name, type: a.account_type },
                openingBalance: { debit: a.opening_debit, credit: a.opening_credit },
                data: a.lines,
                totals: a.totals,
                closingBalance: { debit: a.closing_debit, credit: a.closing_credit }
            });
        }

        res.json({
            success: true,
            accounts: resultAccounts,
            page: pageNum,
            pageSize: size,
            total: totalCount,
            totalPages: totalPages
        });

    } catch (err) {
        console.error('GET General Ledger Error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Balance Sheet ──────────────────────────────────────────────

// Balance Sheet (الميزانية العمومية) — Assets = Liabilities + Equity
router.get('/balance-sheet', asyncHandler(async (req, res) => {
    try {
        const { from, to, includeZero } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let openingWhere = ' WHERE 1=0';
        let periodWhere = ' WHERE 1=1';
        if (from) {
            openingWhere = ' WHERE j.entry_date < @from';
            periodWhere += ' AND j.entry_date >= @from';
            request.input('from', sql.NVarChar, from);
        }
        if (to) {
            periodWhere += ' AND j.entry_date <= @to';
            request.input('to', sql.NVarChar, to);
        }

        // Balance Sheet: default exclude zero-balance accounts (pass includeZero=true to show all)
        const showZero = includeZero === 'true' || includeZero === '1';
        const zeroFilter = showZero ? '' : ' AND (ISNULL(o.opening_debit, 0) + ISNULL(o.opening_credit, 0) + ISNULL(p.period_debit, 0) + ISNULL(p.period_credit, 0) <> 0)';

        const sqlQuery = `
            WITH opening AS (
                SELECT l.account_id,
                       SUM(ISNULL(l.debit, 0)) AS opening_debit,
                       SUM(ISNULL(l.credit, 0)) AS opening_credit
                FROM journal_entry_lines l
                JOIN journal_entries j ON l.entry_id = j.id
                ${openingWhere}
                GROUP BY l.account_id
            ),
            period AS (
                SELECT l.account_id,
                       SUM(ISNULL(l.debit, 0)) AS period_debit,
                       SUM(ISNULL(l.credit, 0)) AS period_credit
                FROM journal_entry_lines l
                JOIN journal_entries j ON l.entry_id = j.id
                ${periodWhere}
                GROUP BY l.account_id
            )
            SELECT
                a.id AS account_id,
                a.account_code,
                a.account_name,
                a.account_type,
                a.parent_id,
                ISNULL(o.opening_debit, 0) AS opening_debit,
                ISNULL(o.opening_credit, 0) AS opening_credit,
                ISNULL(p.period_debit, 0) AS period_debit,
                ISNULL(p.period_credit, 0) AS period_credit
            FROM chart_of_accounts a
            LEFT JOIN opening o ON a.id = o.account_id
            LEFT JOIN period p ON a.id = p.account_id
            WHERE a.account_type IN ('asset', 'liability', 'equity') ${zeroFilter}
            ORDER BY a.account_code
        `;

        const result = await request.query(sqlQuery);
        const rows = result.recordset.map(function (r) {
            const opD = Math.round(Number(r.opening_debit || 0) * 100) / 100;
            const opC = Math.round(Number(r.opening_credit || 0) * 100) / 100;
            const perD = Math.round(Number(r.period_debit || 0) * 100) / 100;
            const perC = Math.round(Number(r.period_credit || 0) * 100) / 100;
            return {
                account_id: r.account_id,
                account_code: r.account_code,
                account_name: r.account_name,
                account_type: r.account_type,
                parent_id: r.parent_id,
                opening_debit: opD,
                opening_credit: opC,
                period_debit: perD,
                period_credit: perC,
                closing_debit: Math.round((opD + perD) * 100) / 100,
                closing_credit: Math.round((opC + perC) * 100) / 100
            };
        });

        // Group accounts by type
        const grouped = {};
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (!grouped[r.account_type]) grouped[r.account_type] = [];
            grouped[r.account_type].push(r);
        }

        // Section/group configuration by code prefix
        const config = [
            {
                type: 'asset', name: 'الأصول',
                groups: [
                    { match: function (c) { return c.indexOf('1.1') === 0 || c === '11' || (c.length > 2 && c.indexOf('11') === 0 && c !== '1'); }, name: 'الأصول المتداولة' },
                    { match: function (c) { return c.indexOf('1.2') === 0 || c === '12' || (c.length > 2 && c.indexOf('12') === 0 && c !== '1'); }, name: 'الأصول الثابتة' },
                    { match: function (c) { return c.indexOf('99') === 0; }, name: 'أصول أخرى' }
                ]
            },
            {
                type: 'liability', name: 'الخصوم',
                groups: [
                    { match: function (c) { return c.indexOf('2.1') === 0 || c === '21' || (c.length > 2 && c.indexOf('21') === 0 && c !== '2'); }, name: 'الخصوم المتداولة' },
                    { match: function (c) { return c.indexOf('2.2') === 0 || c === '22' || (c.length > 2 && c.indexOf('22') === 0 && c !== '2'); }, name: 'الخصوم طويلة الأجل' }
                ]
            },
            {
                type: 'equity', name: 'حقوق الملكية',
                groups: [
                    { match: function (c) { return c.indexOf('3.1') === 0 || c === '31' || (c.length > 2 && c.indexOf('31') === 0 && c !== '3'); }, name: 'رأس المال' },
                    { match: function (c) { return c.indexOf('3.2') === 0 || c === '32' || (c.length > 2 && c.indexOf('32') === 0 && c !== '3'); }, name: 'الأرباح المحتجزة' }
                ]
            }
        ];

        var sections = [];
        var totalAssets = { opening: 0, closing: 0 };
        var totalLiabEq = { opening: 0, closing: 0 };

        for (var si = 0; si < config.length; si++) {
            var cfg = config[si];
            var accs = grouped[cfg.type] || [];

            var secGroups = [];
            var unassigned = [];

            for (var ai = 0; ai < accs.length; ai++) {
                var ac = accs[ai];
                var assigned = false;
                for (var gi = 0; gi < cfg.groups.length; gi++) {
                    if (cfg.groups[gi].match(ac.account_code)) {
                        if (!cfg.groups[gi]._items) cfg.groups[gi]._items = [];
                        cfg.groups[gi]._items.push(ac);
                        assigned = true;
                        break;
                    }
                }
                if (!assigned) unassigned.push(ac);
            }

            for (var gi = 0; gi < cfg.groups.length; gi++) {
                var grp = cfg.groups[gi];
                var items = grp._items || [];
                if (items.length === 0) continue;
                var gOpen = 0, gClose = 0;
                var gAccs = [];
                for (var ii = 0; ii < items.length; ii++) {
                    var it = items[ii];
                    var netOpen = Math.round((cfg.type === 'asset' ? it.opening_debit - it.opening_credit : it.opening_credit - it.opening_debit) * 100) / 100;
                    var netClose = Math.round((cfg.type === 'asset' ? it.closing_debit - it.closing_credit : it.closing_credit - it.closing_debit) * 100) / 100;
                    gOpen = Math.round((gOpen + netOpen) * 100) / 100;
                    gClose = Math.round((gClose + netClose) * 100) / 100;
                    gAccs.push({ account_id: it.account_id, account_code: it.account_code, account_name: it.account_name, opening: netOpen, closing: netClose });
                }
                secGroups.push({ name: grp.name, accounts: gAccs, totals: { opening: gOpen, closing: gClose } });
            }

            if (unassigned.length > 0) {
                var uOpen = 0, uClose = 0;
                var uAccs = [];
                for (var ui = 0; ui < unassigned.length; ui++) {
                    var ua = unassigned[ui];
                    var uNetOpen = Math.round((cfg.type === 'asset' ? ua.opening_debit - ua.opening_credit : ua.opening_credit - ua.opening_debit) * 100) / 100;
                    var uNetClose = Math.round((cfg.type === 'asset' ? ua.closing_debit - ua.closing_credit : ua.closing_credit - ua.closing_debit) * 100) / 100;
                    uOpen = Math.round((uOpen + uNetOpen) * 100) / 100;
                    uClose = Math.round((uClose + uNetClose) * 100) / 100;
                    uAccs.push({ account_id: ua.account_id, account_code: ua.account_code, account_name: ua.account_name, opening: uNetOpen, closing: uNetClose });
                }
                secGroups.push({ name: 'أخرى', accounts: uAccs, totals: { opening: uOpen, closing: uClose } });
            }

            var secOpen = 0, secClose = 0;
            for (var sgi = 0; sgi < secGroups.length; sgi++) {
                secOpen = Math.round((secOpen + secGroups[sgi].totals.opening) * 100) / 100;
                secClose = Math.round((secClose + secGroups[sgi].totals.closing) * 100) / 100;
            }
            var secTotal = { opening: secOpen, closing: secClose };
            if (cfg.type === 'asset') {
                totalAssets.opening = Math.round((totalAssets.opening + secOpen) * 100) / 100;
                totalAssets.closing = Math.round((totalAssets.closing + secClose) * 100) / 100;
            } else {
                totalLiabEq.opening = Math.round((totalLiabEq.opening + secOpen) * 100) / 100;
                totalLiabEq.closing = Math.round((totalLiabEq.closing + secClose) * 100) / 100;
            }
            sections.push({ type: cfg.type, name: cfg.name, groups: secGroups, totals: secTotal });
        }

        // 4) Compute total accumulated net income from revenue/expense accounts as of `to` date
        //    Balance sheet must include ALL net income that hasn't been closed to retained earnings
        var netIncome = 0;
        try {
            var niRequest = pool.request();
            var niWhere = ' WHERE 1=1';
            if (to) { niWhere += ' AND j.entry_date <= @niTo'; niRequest.input('niTo', sql.NVarChar, to); }
            var niSQL = '\
                SELECT \
                    SUM(CASE WHEN a.account_type = \'revenue\' THEN ISNULL(l.credit, 0) - ISNULL(l.debit, 0) ELSE 0 END) AS revenue_net,\
                    SUM(CASE WHEN a.account_type = \'expense\' THEN ISNULL(l.debit, 0) - ISNULL(l.credit, 0) ELSE 0 END) AS expense_net\
                FROM journal_entry_lines l\
                JOIN journal_entries j ON l.entry_id = j.id\
                JOIN chart_of_accounts a ON l.account_id = a.id\
                ' + niWhere;
            var niRes = await niRequest.query(niSQL);
            var revNet = Math.round(Number(niRes.recordset[0].revenue_net || 0) * 100) / 100;
            var expNet = Math.round(Number(niRes.recordset[0].expense_net || 0) * 100) / 100;
            netIncome = Math.round((revNet - expNet) * 100) / 100;
        } catch (e) {
            console.error('Net income computation error:', e);
            netIncome = 0;
        }

        // 5) Inject net income into equity section
        if (netIncome !== 0) {
            for (var si2 = 0; si2 < sections.length; si2++) {
                if (sections[si2].type === 'equity') {
                    var foundNiGroup = false;
                    for (var gni = 0; gni < sections[si2].groups.length; gni++) {
                        if (sections[si2].groups[gni].name === 'صافي الدخل للفترة') {
                            sections[si2].groups[gni].accounts[0].closing = netIncome;
                            sections[si2].groups[gni].totals.closing = netIncome;
                            foundNiGroup = true;
                            break;
                        }
                    }
                    if (!foundNiGroup) {
                        sections[si2].groups.push({
                            name: 'صافي الدخل للفترة',
                            accounts: [{ account_id: null, account_code: '', account_name: 'صافي الدخل للفترة', opening: 0, closing: netIncome }],
                            totals: { opening: 0, closing: netIncome }
                        });
                    }
                    // Recompute equity section total
                    var eqOpen = 0, eqClose = 0;
                    for (var egi = 0; egi < sections[si2].groups.length; egi++) {
                        eqOpen = Math.round((eqOpen + sections[si2].groups[egi].totals.opening) * 100) / 100;
                        eqClose = Math.round((eqClose + sections[si2].groups[egi].totals.closing) * 100) / 100;
                    }
                    sections[si2].totals.opening = eqOpen;
                    sections[si2].totals.closing = eqClose;
                    break;
                }
            }
            // Recompute total Liabilities + Equity
            totalLiabEq = { opening: 0, closing: 0 };
            for (var ri = 0; ri < sections.length; ri++) {
                if (sections[ri].type !== 'asset') {
                    totalLiabEq.opening = Math.round((totalLiabEq.opening + sections[ri].totals.opening) * 100) / 100;
                    totalLiabEq.closing = Math.round((totalLiabEq.closing + sections[ri].totals.closing) * 100) / 100;
                }
            }
        }

        var balanced = Math.abs(totalAssets.closing - totalLiabEq.closing) < 0.01;

        res.json({
            success: true,
            date: to || new Date().toISOString().split('T')[0],
            from: from || null,
            to: to || null,
            sections: sections,
            totals: {
                totalAssets: totalAssets,
                totalLiabilitiesAndEquity: totalLiabEq,
                balanced: balanced
            }
        });
    } catch (err) {
        console.error('GET Balance Sheet Error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Income Statement ───────────────────────────────────────────

// Income Statement (قائمة الدخل) — Revenue - Expenses = Net Income
router.get('/income-statement', asyncHandler(async (req, res) => {
    try {
        const { from, to, includeZero } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let openingWhere = ' WHERE 1=0';
        let periodWhere = ' WHERE 1=1';
        if (from) {
            openingWhere = ' WHERE j.entry_date < @from';
            periodWhere += ' AND j.entry_date >= @from';
            request.input('from', sql.NVarChar, from);
        }
        if (to) {
            periodWhere += ' AND j.entry_date <= @to';
            request.input('to', sql.NVarChar, to);
        }

        const showZero = includeZero === 'true' || includeZero === '1';
        const zeroFilter = showZero ? '' : ' AND (ISNULL(p.period_debit, 0) + ISNULL(p.period_credit, 0) <> 0)';

        const sqlQuery = `
            WITH opening AS (
                SELECT l.account_id,
                       SUM(ISNULL(l.debit, 0)) AS opening_debit,
                       SUM(ISNULL(l.credit, 0)) AS opening_credit
                FROM journal_entry_lines l
                JOIN journal_entries j ON l.entry_id = j.id
                ${openingWhere}
                GROUP BY l.account_id
            ),
            period AS (
                SELECT l.account_id,
                       SUM(ISNULL(l.debit, 0)) AS period_debit,
                       SUM(ISNULL(l.credit, 0)) AS period_credit
                FROM journal_entry_lines l
                JOIN journal_entries j ON l.entry_id = j.id
                ${periodWhere}
                GROUP BY l.account_id
            )
            SELECT
                a.id AS account_id,
                a.account_code,
                a.account_name,
                a.account_type,
                a.parent_id,
                ISNULL(o.opening_debit, 0) AS opening_debit,
                ISNULL(o.opening_credit, 0) AS opening_credit,
                ISNULL(p.period_debit, 0) AS period_debit,
                ISNULL(p.period_credit, 0) AS period_credit
            FROM chart_of_accounts a
            LEFT JOIN opening o ON a.id = o.account_id
            LEFT JOIN period p ON a.id = p.account_id
            WHERE a.account_type IN ('revenue', 'expense') ${zeroFilter}
            ORDER BY a.account_type, a.account_code
        `;

        const result = await request.query(sqlQuery);
        const rows = result.recordset.map(function (r) {
            const opD = Math.round(Number(r.opening_debit || 0) * 100) / 100;
            const opC = Math.round(Number(r.opening_credit || 0) * 100) / 100;
            const perD = Math.round(Number(r.period_debit || 0) * 100) / 100;
            const perC = Math.round(Number(r.period_credit || 0) * 100) / 100;
            return {
                account_id: r.account_id,
                account_code: r.account_code,
                account_name: r.account_name,
                account_type: r.account_type,
                parent_id: r.parent_id,
                opening_debit: opD,
                opening_credit: opC,
                period_debit: perD,
                period_credit: perC,
                closing_debit: Math.round((opD + perD) * 100) / 100,
                closing_credit: Math.round((opC + perC) * 100) / 100
            };
        });

        // Group by type
        const byType = {};
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (!byType[r.account_type]) byType[r.account_type] = [];
            byType[r.account_type].push(r);
        }

        // Config for revenue/expense subgroups
        const revGroups = [
            { match: function (c) { return c.indexOf('4.1') === 0 || c === '41' || (c.length > 2 && c.indexOf('41') === 0 && c !== '4'); }, name: 'إيرادات المبيعات' },
            { match: function (c) { return c.indexOf('4.2') === 0 || c === '42' || (c.length > 2 && c.indexOf('42') === 0 && c !== '4'); }, name: 'إيرادات أخرى' },
            { match: function (c) { return c.indexOf('43') === 0; }, name: 'مردودات المبيعات' },
            { match: function (c) { return c.indexOf('44') === 0; }, name: 'مشتريات مرتجعة' }
        ];
        const expGroups = [
            { match: function (c) { return c.indexOf('51') === 0; }, name: 'تكلفة البضاعة المباعة' },
            { match: function (c) { return c.indexOf('52') === 0; }, name: 'المشتريات' },
            { match: function (c) { return c.indexOf('53') === 0; }, name: 'مصروفات عمومية' },
            { match: function (c) { return c.indexOf('54') === 0; }, name: 'نقص المخزون' },
            { match: function (c) { return c.indexOf('55') === 0; }, name: 'مصروفات أخرى' },
            { match: function (c) { return c.indexOf('56') === 0; }, name: 'مردودات المبيعات' }
        ];

        // Helper: compute net for an account given its type
        function netVal(ac, field, isExpense) {
            return Math.round((isExpense ? ac[field + '_debit'] - ac[field + '_credit'] : ac[field + '_credit'] - ac[field + '_debit']) * 100) / 100;
        }

        // Helper: build section groups for revenue or expense
        function buildSection(accs, groups, isExpense) {
            var secGroups = [];
            var unassigned = [];
            for (var ai = 0; ai < accs.length; ai++) {
                var ac = accs[ai];
                var assigned = false;
                for (var gi = 0; gi < groups.length; gi++) {
                    if (groups[gi].match(ac.account_code)) {
                        if (!groups[gi]._items) groups[gi]._items = [];
                        groups[gi]._items.push(ac);
                        assigned = true;
                        break;
                    }
                }
                if (!assigned) unassigned.push(ac);
            }
            for (var gi = 0; gi < groups.length; gi++) {
                var grp = groups[gi];
                var items = grp._items || [];
                if (items.length === 0) continue;
                var gPer = 0, gCls = 0;
                var gAccs = [];
                for (var ii = 0; ii < items.length; ii++) {
                    var it = items[ii];
                    var pn = netVal(it, 'period', isExpense);
                    var cn = netVal(it, 'closing', isExpense);
                    gPer = Math.round((gPer + pn) * 100) / 100;
                    gCls = Math.round((gCls + cn) * 100) / 100;
                    gAccs.push({ account_id: it.account_id, account_code: it.account_code, account_name: it.account_name, period: pn, closing: cn });
                }
                secGroups.push({ name: grp.name, accounts: gAccs, totals: { period: gPer, closing: gCls } });
            }
            if (unassigned.length > 0) {
                var uPer = 0, uCls = 0;
                var uAccs = [];
                for (var ui = 0; ui < unassigned.length; ui++) {
                    var ua = unassigned[ui];
                    var upn = netVal(ua, 'period', isExpense);
                    var ucn = netVal(ua, 'closing', isExpense);
                    uPer = Math.round((uPer + upn) * 100) / 100;
                    uCls = Math.round((uCls + ucn) * 100) / 100;
                    uAccs.push({ account_id: ua.account_id, account_code: ua.account_code, account_name: ua.account_name, period: upn, closing: ucn });
                }
                secGroups.push({ name: 'أخرى', accounts: uAccs, totals: { period: uPer, closing: uCls } });
            }
            var secPer = 0, secCls = 0;
            for (var sgi = 0; sgi < secGroups.length; sgi++) {
                secPer = Math.round((secPer + secGroups[sgi].totals.period) * 100) / 100;
                secCls = Math.round((secCls + secGroups[sgi].totals.closing) * 100) / 100;
            }
            return { groups: secGroups, totals: { period: secPer, closing: secCls } };
        }

        var revData = buildSection(byType['revenue'] || [], revGroups, false);
        var expData = buildSection(byType['expense'] || [], expGroups, true);

        var totalRevenue = revData.totals.closing;
        var totalExpenses = expData.totals.closing;
        var netIncome = Math.round((totalRevenue - totalExpenses) * 100) / 100;

        res.json({
            success: true,
            date: to || new Date().toISOString().split('T')[0],
            from: from || null,
            to: to || null,
            revenue: { name: 'الإيرادات', groups: revData.groups, totals: revData.totals },
            expenses: { name: 'المصروفات', groups: expData.groups, totals: expData.totals },
            netIncome: netIncome,
            totals: {
                totalRevenue: totalRevenue,
                totalExpenses: totalExpenses,
                netIncome: netIncome
            }
        });
    } catch (err) {
        console.error('GET Income Statement Error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

module.exports = router;
