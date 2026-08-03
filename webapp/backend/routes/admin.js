const router = require('express').Router();
const { getPool, resetPool, createDirectConnection, sql } = require('../database/mssql_db');
const { postJournalEntryAsync, getSystemAccountAsync } = require('../services/accountingEngine');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const BACKUP_DIR = path.join(__dirname, '..', 'Backups', 'Auto Backup Before Reset');

function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

// ─── Backup ───

async function createFullBackup(label, customPath) {
    const pool = await getPool();
    const dbRes = await pool.request().query('SELECT DB_NAME() AS db');
    const dbName = dbRes.recordset[0]?.db || 'TradePro';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    let filePath, fileName;
    if (customPath) {
        filePath = customPath;
        fileName = path.basename(customPath);
    } else {
        ensureBackupDir();
        fileName = `ERP_Backup_${label}_${ts}.bak`;
        filePath = path.join(BACKUP_DIR, fileName);
    }
    await pool.request().query(`BACKUP DATABASE [${dbName}] TO DISK = N'${filePath}' WITH INIT, STATS = 10`);
    let fileSize = 0;
    try {
        const stats = fs.statSync(filePath);
        fileSize = stats.size;
    } catch (statErr) {
        try {
            const sizeRes = await pool.request().query(`
                SELECT TOP 1 backup_size / 1048576.0 as size_mb, backup_size as size_bytes
                FROM msdb.dbo.backupset
                WHERE database_name = '${dbName}'
                ORDER BY backup_finish_date DESC
            `);
            fileSize = sizeRes.recordset[0]?.size_bytes || 0;
        } catch (e2) { /* fallback */ }
    }
    return { path: filePath, name: fileName, size: fileSize };
}

// ─── Password verification ───

async function verifyAdminPassword(userId, password) {
    const pool = await getPool();
    const result = await pool.request()
        .input('id', sql.Int, userId)
        .query('SELECT password_hash, role FROM users WHERE id = @id');
    const user = result.recordset[0];
    if (!user) return { valid: false, message: 'المستخدم غير موجود' };
    if (user.role !== 'admin') return { valid: false, message: 'غير مصرح - يجب أن تكون مدير النظام' };
    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) return { valid: false, message: 'كلمة المرور غير صحيحة' };
    return { valid: true };
}

// ─── Integrity check ───

async function verifyIntegrity() {
    const pool = await getPool();
    const results = {};
    const jeRes = await pool.request().query(`
        SELECT ISNULL(SUM(total_debit), 0) as total_debit, ISNULL(SUM(total_credit), 0) as total_credit
        FROM journal_entries WHERE is_reversed IS NULL OR is_reversed = 0
    `);
    const je = jeRes.recordset[0];
    results.journalBalance = parseFloat(je.total_debit).toFixed(2) === parseFloat(je.total_credit).toFixed(2);
    const custRes = await pool.request().query(`
        SELECT COUNT(*) as cnt, ISNULL(SUM(diff), 0) as total_diff FROM (
            SELECT ABS(c.current_balance - (
                COALESCE(c.opening_balance,0) +
                ISNULL((SELECT SUM(grand_total) FROM sales_invoices WHERE customer_id = c.id AND status NOT IN ('cancelled','deleted')), 0) -
                ISNULL((SELECT SUM(grand_total) FROM sales_returns WHERE customer_id = c.id AND status NOT IN ('cancelled','deleted')), 0) -
                ISNULL((SELECT SUM(amount) FROM customer_collections WHERE customer_id = c.id), 0)
            )) as diff FROM customers c
        ) sub
    `);
    results.customersBalanced = parseFloat(custRes.recordset[0]?.total_diff || 0) < 0.01;
    const supRes = await pool.request().query(`
        SELECT COUNT(*) as cnt, ISNULL(SUM(diff), 0) as total_diff FROM (
            SELECT ABS(s.current_balance - (
                COALESCE(s.opening_balance,0) +
                ISNULL((SELECT SUM(grand_total) FROM purchase_invoices WHERE supplier_id = s.id AND status NOT IN ('cancelled','deleted')), 0) -
                ISNULL((SELECT SUM(grand_total) FROM purchase_returns WHERE supplier_id = s.id AND status NOT IN ('cancelled','deleted')), 0) -
                ISNULL((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = s.id), 0)
            )) as diff FROM suppliers s
        ) sub
    `);
    results.suppliersBalanced = parseFloat(supRes.recordset[0]?.total_diff || 0) < 0.01;
    const tresRes = await pool.request().query(`
        SELECT COUNT(*) as cnt, ISNULL(SUM(diff), 0) as total_diff FROM (
            SELECT ABS(t.current_balance - (
                COALESCE(t.opening_balance,0) +
                ISNULL((SELECT SUM(CASE WHEN trans_type='in' THEN amount ELSE -amount END) FROM treasury_transactions WHERE account_id = t.id), 0)
            )) as diff FROM treasury_accounts t
        ) sub
    `);
    results.treasuryBalanced = parseFloat(tresRes.recordset[0]?.total_diff || 0) < 0.01;
    const tbRes = await pool.request().query(`
        SELECT ISNULL(SUM(CASE WHEN account_type IN ('asset','expense') THEN current_balance ELSE 0 END), 0) as total_debit,
               ISNULL(SUM(CASE WHEN account_type IN ('liability','equity','revenue') THEN current_balance ELSE 0 END), 0) as total_credit
        FROM chart_of_accounts
    `);
    const tb = tbRes.recordset[0];
    results.trialBalanceBalanced = parseFloat(tb.total_debit).toFixed(2) === parseFloat(tb.total_credit).toFixed(2);
    results.allPassed = results.journalBalance && results.customersBalanced &&
        results.suppliersBalanced && results.treasuryBalanced && results.trialBalanceBalanced;
    return results;
}

// ════════════════════════════════════════════════════════
// TABLE ORDERS (topological: children before parents)
// ════════════════════════════════════════════════════════

const FACTORY_RESET_ORDER = [
    'activity_logs',
    'audit_log',
    'branches',
    'checks',
    'collection_allocations',
    'customer_activity_log',
    'customer_attachments',
    'customer_groups',
    'customer_notes',
    'customer_visits',
    'damaged_stock',
    'emp_loans',
    'emp_vacations',
    'emp_attendance',
    'emp_penalties',
    'emp_rewards',
    'salary_slips',
    'expenses',
    'inventory_balances',
    'invoice_counters',
    'journal_entry_lines',
    'purchase_invoice_items',
    'purchase_return_items',
    'rep_settlements',
    'rep_targets',
    'return_reasons',
    'sales_invoice_items',
    'sales_return_audit',
    'sales_return_items',
    'stock_adjustments',
    'stock_count_items',
    'stock_movements',
    'stock_transfer_items',
    'supplier_activity_log',
    'supplier_payment_allocations',
    'treasury_transactions',
    'ap_payment_allocations',
    'ar_payment_allocations',
    'ap_payments',
    'ar_payments',
    'ap_cheques',
    'ar_cheques',
    'ar_security_cheques',
    'ap_notes',
    'ar_notes',
    'stock_disposal_items',
    'stock_disposals',
    'crm_workplan_customers',
    'crm_workplans',
    'crm_targets',
    'crm_settlements',
    'asset_movements',
    'asset_depreciation',
    'fixed_assets',
    'asset_categories',
    'customer_collections',
    'chart_of_accounts',
    'journal_entries',
    'purchase_returns',
    'employees',
    'products',
    'sales_returns',
    'stock_count',
    'stock_transfers',
    'supplier_payments',
    'treasury_accounts',
    'purchase_invoices',
    'categories',
    'sales_invoices',
    'stores',
    'suppliers',
    'customers',
    'sales_reps'
];

const YEAR_CLOSE_ORDER = [
    'checks',
    'collection_allocations',
    'customer_activity_log',
    'customer_notes',
    'customer_visits',
    'damaged_stock',
    'emp_loans',
    'emp_vacations',
    'emp_attendance',
    'emp_penalties',
    'emp_rewards',
    'salary_slips',
    'expenses',
    'inventory_balances',
    'journal_entry_lines',
    'purchase_invoice_items',
    'purchase_return_items',
    'rep_settlements',
    'rep_targets',
    'sales_invoice_items',
    'sales_return_audit',
    'sales_return_items',
    'stock_adjustments',
    'stock_count_items',
    'stock_movements',
    'stock_transfer_items',
    'supplier_activity_log',
    'supplier_payment_allocations',
    'treasury_transactions',
    'ap_payment_allocations',
    'ar_payment_allocations',
    'ap_payments',
    'ar_payments',
    'ap_cheques',
    'ar_cheques',
    'ar_security_cheques',
    'ap_notes',
    'ar_notes',
    'stock_disposal_items',
    'stock_disposals',
    'crm_workplan_customers',
    'crm_workplans',
    'crm_settlements',
    'asset_movements',
    'asset_depreciation',
    'customer_collections',
    'journal_entries',
    'purchase_returns',
    'sales_returns',
    'stock_count',
    'stock_transfers',
    'supplier_payments',
    'purchase_invoices',
    'sales_invoices',
    'backup_history'
];

// ─── Generic table delete function ───

async function deleteFromTables(txRequest, tableList, stepLog) {
    for (const tblName of tableList) {
        const quoted = `[${tblName.replace(/]/g, ']]')}]`;
        const exists = await txRequest.query(`SELECT OBJECT_ID('dbo.${quoted}') as oid`);
        if (!exists.recordset[0]?.oid) {
            stepLog.push(`  ~ ${tblName} — skipped (not found)`);
            continue;
        }
        try {
            const del = await txRequest.query(`DELETE FROM ${quoted}`);
            const rows = del.rowsAffected?.[0] ?? 0;
            stepLog.push(`  ✓ ${tblName} (${rows} rows)`);
        } catch (e) {
            const sqlErr = e.originalError?.message || e.message;
            stepLog.push(`  ✗ ${tblName} -> ERROR: ${sqlErr}`);
            throw e;
        }
    }
}

// ─── Reset identity seeds ───

const RESEED_TABLES = [
    'activity_logs','audit_log','branches','categories','chart_of_accounts','checks',
    'collection_allocations','customer_activity_log','customer_attachments','customer_collections',
    'customer_groups','customer_notes','customer_visits','customers','damaged_stock',
    'emp_loans','employees','expenses','inventory_balances','invoice_counters',
    'journal_entries','journal_entry_lines','products','purchase_invoice_items',
    'purchase_invoices','purchase_return_items','purchase_returns',
    'rep_settlements','rep_targets','salary_slips',
    'sales_invoice_items','sales_invoices','sales_reps','sales_return_audit','sales_return_items',
    'sales_returns','stock_adjustments','stock_count','stock_count_items','stock_movements',
    'stock_transfer_items','stock_transfers','stores','supplier_activity_log',
    'supplier_payment_allocations','supplier_payments','suppliers','treasury_accounts',
    'treasury_transactions'
];

async function resetIdentitySeeds(txRequest, stepLog) {
    for (const tbl of RESEED_TABLES) {
        const exists = await txRequest.query(`SELECT OBJECT_ID('[dbo].[${tbl}]') as oid`);
        if (!exists.recordset[0]?.oid) continue;
        await txRequest.query(`DBCC CHECKIDENT ('${tbl}', RESEED, 0)`);
    }
    stepLog.push('✓ All identity seeds reset');
}

// ─── Insert default data after factory reset ───

async function insertDefaults(txRequest, stepLog) {
    // 1. Default store
    await txRequest.query(`
        INSERT INTO stores (store_code, store_name, store_type, status)
        VALUES ('ST-MAIN', N'المخزن الرئيسي', 'main', 'active')
    `);
    stepLog.push('✓ Main store created (ST-MAIN)');

    // 2. Default treasury
    await txRequest.query(`
        INSERT INTO treasury_accounts (account_name, account_type, current_balance, opening_balance)
        VALUES (N'الخزنة الرئيسية', 'cash', 0, 0)
    `);
    stepLog.push('✓ Main treasury created');

    // 3. Default chart of accounts (minimal set)
    await txRequest.query(`
        INSERT INTO chart_of_accounts (account_code, account_name, account_type, is_active, current_balance)
        VALUES
        ('1',     N'الأصول',                'asset',    1, 0),
        ('1.1',   N'الأصول المتداولة',       'asset',    1, 0),
        ('1.1.1', N'النقدية',                'asset',    1, 0),
        ('1.1.2', N'البنوك',                 'asset',    1, 0),
        ('1.1.3', N'المدينون',               'asset',    1, 0),
        ('1.1.4', N'المخزون',                'asset',    1, 0),
        ('1.2',   N'الأصول الثابتة',         'asset',    1, 0),
        ('2',     N'الخصوم',                 'liability',1, 0),
        ('2.1',   N'الخصوم المتداولة',       'liability',1, 0),
        ('2.1.1', N'الدائنون',               'liability',1, 0),
        ('2.2',   N'الخصوم طويلة الأجل',     'liability',1, 0),
        ('3',     N'حقوق الملكية',           'equity',   1, 0),
        ('3.1',   N'رأس المال',              'equity',   1, 0),
        ('3.2',   N'الأرباح المحتجزة',       'equity',   1, 0),
        ('4',     N'الإيرادات',              'revenue',  1, 0),
        ('4.1',   N'إيرادات المبيعات',       'revenue',  1, 0),
        ('4.2',   N'إيرادات أخرى',           'revenue',  1, 0),
        ('5',     N'المصروفات',              'expense',  1, 0),
        ('5.1',   N'مصروفات عمومية',         'expense',  1, 0),
        ('5.2',   N'مصروفات إدارية',         'expense',  1, 0)
    `);
    stepLog.push('✓ Default chart of accounts created (20 accounts)');

    // 4. Default counter records
    await txRequest.query(`
        INSERT INTO invoice_counters (counter_name, prefix, last_number)
        VALUES
        (N'مبيعات',       'S-', 0),
        (N'مشتريات',      'P-', 0),
        (N'مرتجع بيع',    'R-', 0),
        (N'مرتجع شراء',   'PR-',0),
        (N'تحصيل',        'C-', 0),
        (N'دفع',          'PY-',0),
        (N'مصروف',        'E-', 0),
        (N'مخزون',        'ST-',0),
        (N'تحويل',        'TR-',0),
        (N'تسوية',        'AD-',0),
        (N'عرض سعر',      'Q-', 0)
    `);
    stepLog.push('✓ Invoice counters created');

    // 5. Delete non-admin users (keep admin)
    await txRequest.query(`DELETE FROM users WHERE role != 'admin'`);
    stepLog.push('✓ Non-admin users removed');

    // 6. Reset non-admin related settings
    try {
        await txRequest.query(`
            DELETE FROM settings WHERE [key] IN (
                'last_invoice_no','last_purchase_no','session_token','current_fiscal_year'
            )
        `);
    } catch (e) { /* optional cleanup */ }
}

// ─── Verify clean ───

async function verifyClean(txRequest) {
    const tables = [
        'sales_invoices', 'purchase_invoices', 'sales_returns', 'purchase_returns',
        'supplier_payments', 'customer_collections', 'treasury_transactions', 'journal_entries',
        'customers', 'suppliers', 'products', 'stores', 'sales_reps'
    ];
    const counts = {};
    for (const t of tables) {
        const r = await txRequest.query(`SELECT COUNT(*) as cnt FROM [${t}]`);
        counts[t] = r.recordset[0]?.cnt ?? -1;
    }
    return counts;
}

// ════════════════════════════════════════════════════════
// FACTORY RESET — delete EVERYTHING, recreate defaults
// ════════════════════════════════════════════════════════

router.post('/reset', asyncHandler(async (req, res) => {
    const { password, backupPath } = req.body;
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'غير مصرح - يجب أن تكون مدير النظام' });
    }
    const v = await verifyAdminPassword(req.user.id, password);
    if (!v.valid) return res.status(403).json({ success: false, message: v.message });
    if (!backupPath) {
        return res.status(400).json({ success: false, message: 'يرجى تحديد مسار حفظ النسخة الاحتياطية' });
    }

    let backupResult;
    try {
        backupResult = await createFullBackup('Factory_Reset', backupPath);
    } catch (err) {
        const sqlErr = err.originalError?.message || err.message;
        console.error('Backup error (factory reset):', sqlErr, err.originalError || '');
        await logActivity(req, 'RESET', 'admin', null, 'فشل النسخة الاحتياطية قبل إعادة التهيئة', null, null, 'FAILED', sqlErr);
        return res.status(500).json({ success: false, message: 'فشل إنشاء النسخة الاحتياطية: ' + sqlErr + ' - تم إلغاء العملية' });
    }

    const stepLog = ['✓ Backup completed'];
    console.log('✓ Backup completed');

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        stepLog.push('--- Deleting all data ---');
        await deleteFromTables(txRequest, FACTORY_RESET_ORDER, stepLog);

        stepLog.push('--- Resetting identity seeds ---');
        await resetIdentitySeeds(txRequest, stepLog);

        stepLog.push('--- Creating default data ---');
        await insertDefaults(txRequest, stepLog);

        stepLog.push('--- Verification ---');
        const counts = await verifyClean(txRequest);
        for (const [t, c] of Object.entries(counts)) {
            stepLog.push(`  ${t} = ${c} rows`);
        }

        await transaction.commit();
        stepLog.push('✓ COMMIT');

        console.log('=== FACTORY RESET LOG ===');
        stepLog.forEach(l => console.log('  ' + l));
        console.log('=========================');

        await logActivity(req, 'RESET', 'admin', null, 'إعادة تهيئة كاملة للنظام', null,
            { backup: backupResult.name, size: backupResult.size, cleanCounts: counts }, 'SUCCESS', null);

        res.json({
            success: true,
            message: 'تمت إعادة تهيئة النظام بالكامل. البرنامج الآن كأنه مثبت لأول مرة.',
            backup: { name: backupResult.name, path: backupResult.path, size: backupResult.size },
            cleanCounts: counts
        });
    } catch (err) {
        if (transaction) {
            await transaction.rollback();
            stepLog.push('✗ ROLLBACK');
        }
        const sqlErr = err.originalError?.message || err.message;
        stepLog.push(`✗ ERROR: ${sqlErr}`);
        console.log('=== FACTORY RESET LOG (FAILED) ===');
        stepLog.forEach(l => console.log('  ' + l));
        console.log('===================================');
        console.error('Factory reset error:', sqlErr, err.originalError || '');
        await logActivity(req, 'RESET', 'admin', null, 'فشل إعادة التهيئة', null, null, 'FAILED', sqlErr);
        res.status(500).json({ success: false, message: 'خطأ في إعادة التهيئة: ' + sqlErr, stepLog });
    }
}));

// ════════════════════════════════════════════════════════
// YEAR CLOSE — keep master, delete transactions, post opening
// ════════════════════════════════════════════════════════

router.post('/year-close', asyncHandler(async (req, res) => {
    const { password, backupPath } = req.body;
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'غير مصرح - يجب أن يكون مدير النظام' });
    }
    const v = await verifyAdminPassword(req.user.id, password);
    if (!v.valid) return res.status(403).json({ success: false, message: v.message });

    const year = parseInt(req.body.year) || new Date().getFullYear();
    if (isNaN(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ success: false, message: 'سنة غير صالحة.' });
    }
    const currentYear = new Date().getFullYear();
    if (year > currentYear) {
        return res.status(400).json({ success: false, message: `لا يمكن إقفال السنة ${year} لأنها في المستقبل.` });
    }

    const preIntegrity = await verifyIntegrity();
    if (!preIntegrity.allPassed) {
        return res.status(400).json({ success: false, message: 'لا يمكن إقفال السنة والأرصدة غير متوازنة. يرجى مراجعة قسم الصحة.', integrity: preIntegrity });
    }

    const pool0 = await getPool();
    const periodsForYear = await pool0.request()
        .input('yStart', sql.Date, `${year}-01-01`)
        .input('yEnd', sql.Date, `${year}-12-31`)
        .query(`SELECT id, name, status FROM fiscal_periods WHERE start_date <= @yEnd AND end_date >= @yStart ORDER BY start_date`);
    if (periodsForYear.recordset.length === 0) {
        return res.status(400).json({ success: false, message: `لا توجد فترات مالية للسنة ${year}.` });
    }
    const allClosed = periodsForYear.recordset.every(p => p.status === 'closed');
    if (allClosed) {
        return res.status(409).json({ success: false, message: `السنة المالية ${year} مغلقة بالفعل.` });
    }

    let backupResult = { name: 'N/A', path: 'N/A', size: '0 MB' };
    if (backupPath) {
        try {
            backupResult = await createFullBackup('Year_Close', backupPath);
        } catch (err) {
            console.error('Backup error:', err);
            return res.status(500).json({ success: false, message: 'فشل إنشاء النسخة الاحتياطية' });
        }
    }

    let transaction;
    const stepLog = [];
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        const coaBalances = await txRequest.query(`SELECT id, account_code, account_name, current_balance, account_type FROM chart_of_accounts WHERE current_balance != 0`);
        const sysRetainedEarnings = await getSystemAccountAsync(txRequest, 'SYS_RETAINED_EARNINGS');
        const plAccounts = coaBalances.recordset.filter(a => a.account_type === 'revenue' || a.account_type === 'expense');

        let closeTotalDebit = 0, closeTotalCredit = 0;
        let netIncome = 0;
        const closeLines = [];
        for (const acc of plAccounts) {
            const bal = parseFloat(acc.current_balance) || 0;
            if (Math.abs(bal) < 0.01) continue;
            const isRevenue = acc.account_type === 'revenue';
            const isDebitBal = (isRevenue && bal > 0) || (!isRevenue && bal < 0);
            if (isDebitBal) {
                closeLines.push({ account_id: acc.id, debit: Math.abs(bal), credit: 0, description: `إقفال ${acc.account_name}` });
                closeTotalDebit += Math.abs(bal);
            } else {
                closeLines.push({ account_id: acc.id, debit: 0, credit: Math.abs(bal), description: `إقفال ${acc.account_name}` });
                closeTotalCredit += Math.abs(bal);
            }
        }
        netIncome = closeTotalDebit - closeTotalCredit;
        if (closeLines.length > 0 && Math.abs(netIncome) > 0.01) {
            if (netIncome > 0) {
                closeLines.push({ account_id: sysRetainedEarnings, debit: 0, credit: netIncome, description: 'صافي الربح المرحل إلى الأرباح المحتجزة' });
            } else {
                closeLines.push({ account_id: sysRetainedEarnings, debit: Math.abs(netIncome), credit: 0, description: 'صافي الخسارة المرحل إلى الأرباح المحتجزة' });
            }
        }

        if (closeLines.length > 0) {
            await postJournalEntryAsync(txRequest, `${year}-12-31`,
                `قيود إقفال حسابات الإيرادات والمصروفات للسنة ${year}`, closeLines,
                'year_close', null, req.user.id,
                { module: 'admin', action: 'year_close', document: `CLOSING_${year}`, isSystem: true, bypassPeriodLock: true });
        }

        for (const acc of plAccounts) {
            txRequest.input(`coa_pl_${acc.id}`, sql.Int, acc.id);
            await txRequest.query(`UPDATE chart_of_accounts SET current_balance = 0 WHERE id = @coa_pl_${acc.id}`);
        }
        const reBal = parseFloat(coaBalances.recordset.find(a => a.id === sysRetainedEarnings)?.current_balance) || 0;
        const newReBal = reBal + netIncome;
        txRequest.input('coa_re_id', sql.Int, sysRetainedEarnings);
        txRequest.input('coa_re_bal', sql.Decimal(18,2), newReBal);
        await txRequest.query(`UPDATE chart_of_accounts SET current_balance = @coa_re_bal WHERE id = @coa_re_id`);

        const openPeriods = periodsForYear.recordset.filter(p => p.status === 'open');
        for (const fp of openPeriods) {
            txRequest.input(`fp_close_id_${fp.id}`, sql.Int, fp.id);
            txRequest.input(`fp_close_by_${fp.id}`, sql.Int, req.user.id);
            await txRequest.query(`UPDATE fiscal_periods SET status = 'closed', closed_by = @fp_close_by_${fp.id}, closed_at = GETDATE() WHERE id = @fp_close_id_${fp.id}`);
        }
        
        const nextYear = year + 1;
        const nextYearName = `FY ${nextYear}`;
        txRequest.input('fp_ny_name', sql.NVarChar(100), nextYearName);
        txRequest.input('fp_ny_start', sql.Date, `${nextYear}-01-01`);
        txRequest.input('fp_ny_end', sql.Date, `${nextYear}-12-31`);
        txRequest.input('fp_ny_by', sql.Int, req.user.id);
        txRequest.input('fp_ny_notes', sql.NVarChar, `تم إنشاؤها تلقائياً بعد إقفال السنة ${year}`);
        const existingNext = await txRequest.query(`SELECT COUNT(*) as cnt FROM fiscal_periods WHERE name = @fp_ny_name`);
        if (existingNext.recordset[0]?.cnt === 0) {
            await txRequest.query(`INSERT INTO fiscal_periods (name, start_date, end_date, status, opened_by, opened_at, notes) VALUES (@fp_ny_name, @fp_ny_start, @fp_ny_end, 'open', @fp_ny_by, GETDATE(), @fp_ny_notes)`);
        }

        await transaction.commit();

        res.json({
            success: true,
            message: 'تم إقفال السنة المالية بنجاح',
            backup: backupResult,
            fiscal: { year, nextYearPeriod: `FY ${nextYear}` }
        });
    } catch (err) {
        if (transaction) await transaction.rollback();
        const sqlErr = err.originalError?.message || err.message;
        res.status(500).json({ success: false, message: 'خطأ في إقفال السنة: ' + sqlErr });
    }
}));

// ════════════════════════════════════════════════════════
// OTHER ENDPOINTS (unchanged)
// ════════════════════════════════════════════════════════

router.post('/verify-password', asyncHandler(async (req, res) => {
    const { password } = req.body;
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'غير مصرح' });
    }
    const v = await verifyAdminPassword(req.user.id, password);
    if (!v.valid) return res.status(403).json({ success: false, message: v.message });
    res.json({ success: true, message: 'تم التحقق' });
}));

router.post('/manual-backup', asyncHandler(async (req, res) => {
    const { password, backupPath } = req.body;
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'غير مصرح - يجب أن تكون مدير النظام' });
    }
    const v = await verifyAdminPassword(req.user.id, password);
    if (!v.valid) return res.status(403).json({ success: false, message: v.message });
    if (!backupPath) {
        return res.status(400).json({ success: false, message: 'يرجى تحديد مسار حفظ النسخة الاحتياطية' });
    }
    let backupResult;
    try {
        backupResult = await createFullBackup('Manual', backupPath);
    } catch (err) {
        const sqlErr = err.originalError?.message || err.message;
        console.error('Backup error (manual):', sqlErr, err.originalError || '');
        return res.status(500).json({ success: false, message: 'فشل إنشاء النسخة الاحتياطية: ' + sqlErr });
    }
    await logActivity(req, 'BACKUP', 'admin', null, 'إنشاء نسخة احتياطية يدوية', null,
        { backup: backupResult.name, size: backupResult.size }, 'SUCCESS', null);
    res.json({
        success: true, message: 'تم إنشاء النسخة الاحتياطية بنجاح',
        backup: { name: backupResult.name, path: backupResult.path, size: backupResult.size }
    });
}));

router.get('/backups', asyncHandler(async (req, res) => {
    ensureBackupDir();
    let files = [];
    try {
        files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.bak'))
            .map(f => {
                const fp = path.join(BACKUP_DIR, f);
                const stat = fs.statSync(fp);
                return { name: f, path: fp, size: stat.size, modified: stat.mtime };
            })
            .sort((a, b) => b.modified - a.modified);
    } catch (e) { /* ignore */ }
    res.json({ success: true, data: files, dir: BACKUP_DIR });
}));

router.post('/restore', asyncHandler(async (req, res) => {
    const { password, backupFile } = req.body;
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'غير مصرح - يجب أن يكون مدير النظام' });
    }
    const v = await verifyAdminPassword(req.user.id, password);
    if (!v.valid) return res.status(403).json({ success: false, message: v.message });
    if (!backupFile) return res.status(400).json({ success: false, message: 'يجب تحديد ملف النسخة الاحتياطية' });

    let restorePath = backupFile;
    if (!path.isAbsolute(restorePath)) {
        restorePath = path.join(BACKUP_DIR, restorePath);
    }
    // Check if file exists locally, fallback to SQL Server backed-up files if Node can't read it
    let fileExists = false;
    try {
        if (fs.existsSync(restorePath)) { fileExists = true; }
    } catch (e) {
        // Node.js user may not have permissions to read SQL Server backup directory
        fileExists = false;
    }
    if (!fileExists) {
        // Fallback: check msdb.dbo.backupset as we do for backup size
        try {
            const pool = await getPool();
            const chk = await pool.request()
                .input('path', sql.NVarChar, restorePath)
                .query(`SELECT COUNT(*) as cnt FROM msdb.dbo.backupset WHERE physical_device_name = @path`);
            if (chk.recordset[0].cnt > 0) {
                fileExists = true;
            }
        } catch (e2) {
            // If msdb query fails too, just try the restore and let SQL Server validate
            fileExists = true;
        }
    }
    if (!fileExists) {
        return res.status(404).json({ success: false, message: 'ملف النسخة الاحتياطية غير موجود' });
    }

    const stepLog = [];
    try {
        stepLog.push(`✓ Backup file: ${restorePath} (${fs.statSync(restorePath).size} bytes)`);
    } catch (e) {
        stepLog.push(`✓ Backup file: ${restorePath}`);
    }

    let pool;
    try {
        pool = await getPool();
    } catch (err) {
        return res.status(500).json({ success: false, message: 'خطأ في الاتصال بقاعدة البيانات: ' + (err.originalError?.message || err.message), stepLog });
    }

    const dbRes = await pool.request().query('SELECT DB_NAME() AS db');
    const dbName = dbRes.recordset[0]?.db || 'TradePro';
    stepLog.push(`✓ Database: ${dbName}`);

    // 1. Verify backup file integrity
    stepLog.push('--- Verifying backup file ---');
    try {
        await pool.request().query(`RESTORE VERIFYONLY FROM DISK = N'${restorePath}'`);
        stepLog.push('✓ Backup file is valid');
    } catch (err) {
        const sqlErr = err.originalError?.message || err.message;
        stepLog.push(`✗ Backup file invalid: ${sqlErr}`);
        return res.status(400).json({ success: false, message: 'ملف النسخة الاحتياطية تالف أو غير صالح: ' + sqlErr, stepLog });
    }

    // 2. Restore via dedicated connection to master
    stepLog.push('--- Restoring database ---');
    let restoreConn;
    try {
        restoreConn = await createDirectConnection('master');
        // Kill all connections to the target database first
        await restoreConn.request().query(`
            DECLARE @kill NVARCHAR(MAX) = '';
            SELECT @kill = @kill + 'KILL ' + CAST(session_id AS VARCHAR(10)) + ';'
            FROM sys.dm_exec_sessions
            WHERE database_id = DB_ID('${dbName}') AND session_id != @@SPID AND session_id > 50;
            EXEC(@kill);
        `);
        stepLog.push('✓ Existing connections killed');
        await restoreConn.request().query(`ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);
        stepLog.push('✓ Database set to SINGLE_USER');
        await restoreConn.request().query(`RESTORE DATABASE [${dbName}] FROM DISK = N'${restorePath}' WITH REPLACE, RECOVERY`);
        stepLog.push('✓ RESTORE DATABASE completed');
        await restoreConn.request().query(`ALTER DATABASE [${dbName}] SET MULTI_USER`);
        stepLog.push('✓ Database set to MULTI_USER');
    } catch (err) {
        const sqlErr = err.originalError?.message || err.message;
        stepLog.push(`✗ RESTORE failed: ${sqlErr}`);
        console.error('Restore error:', sqlErr, err.originalError || '');
        if (restoreConn) { try { await restoreConn.close(); } catch (e) { /* ignore */ } }
        try {
            const fb = await createDirectConnection('master');
            await fb.request().query(`ALTER DATABASE [${dbName}] SET MULTI_USER`);
            await fb.close();
        } catch (e2) { /* ignore */ }
        await logActivity(req, 'RESTORE', 'admin', null, 'فشل استرجاع النسخة', null, null, 'FAILED', sqlErr);
        return res.status(500).json({ success: false, message: 'فشل استرجاع قاعدة البيانات: ' + sqlErr, stepLog });
    }
    if (restoreConn) { try { await restoreConn.close(); } catch (e) { /* ignore */ } }

    // 4. Reset connection pool — the old connections are stale after RESTORE
    stepLog.push('--- Resetting connection pool ---');
    try {
        await resetPool();
        stepLog.push('✓ Connection pool recreated');
    } catch (err) {
        stepLog.push(`✗ Failed to recreate pool: ${err.message}`);
        return res.status(500).json({ success: false, message: 'فشل إعادة الاتصال بقاعدة البيانات بعد الاسترجاع', stepLog });
    }

    // 5. Runtime verification — query a table to confirm data exists
    stepLog.push('--- Runtime verification ---');
    try {
        const newPool = await getPool();
        const verifyRes = await newPool.request().query(`
            SELECT COUNT(*) as user_cnt FROM users
        `);
        const userCount = verifyRes.recordset[0]?.user_cnt ?? -1;
        stepLog.push(`✓ Users in restored database: ${userCount}`);

        // Count rows across key tables for a health summary
        const healthTables = [
            'users', 'customers', 'suppliers', 'products', 'stores',
            'sales_invoices', 'purchase_invoices', 'chart_of_accounts'
        ];
        const health = {};
        for (const t of healthTables) {
            const r = await newPool.request().query(`SELECT COUNT(*) as cnt FROM [${t}]`);
            health[t] = r.recordset[0]?.cnt ?? -1;
        }
        stepLog.push('✓ Database health check: ' + JSON.stringify(health));
    } catch (err) {
        stepLog.push(`✗ Verification query failed: ${err.message}`);
        return res.status(500).json({ success: false, message: 'تم الاسترجاع ولكن فشل التحقق من البيانات: ' + err.message, stepLog });
    }

    // 6. Log and respond
    await logActivity(req, 'RESTORE', 'admin', null, 'استرجاع نسخة احتياطية', null,
        { file: path.basename(restorePath) }, 'SUCCESS', null);

    console.log('=== RESTORE LOG ===');
    stepLog.forEach(l => console.log('  ' + l));
    console.log('===================');

    res.json({ success: true, message: 'تم استرجاع النسخة الاحتياطية بنجاح', stepLog });
}));

router.get('/integrity', asyncHandler(async (req, res) => {
    const integrity = await verifyIntegrity();
    res.json({ success: true, data: integrity });
}));

module.exports = router;
