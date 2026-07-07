const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const { postJournalEntryAsync } = require('../services/accountingEngine');
const asyncHandler = require('../utils/asyncHandler');
const accountRepo = require('../repositories/accountRepository');
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
        const { accountId, from, to, page = 1, pageSize = 50, includeOpening } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const size = Math.min(200, Math.max(1, parseInt(pageSize) || 50));
        const offset = (pageNum - 1) * size;
        const showOpening = includeOpening === 'true' || includeOpening === '1' || includeOpening === '';

        const pool = await getPool();
        const request = pool.request();

        const hasFrom = !!from;
        const hasTo = !!to;
        const hasAccount = !!accountId;

        if (hasAccount) request.input('accId', sql.Int, parseInt(accountId));
        if (hasFrom) request.input('from', sql.NVarChar, from);
        if (hasTo) request.input('to', sql.NVarChar, to);

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

module.exports = router;
