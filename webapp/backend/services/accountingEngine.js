const { sql } = require('../database/mssql_db');

/**
 * Core Accounting Engine
 */

/**
 * Generate Next Journal Entry Number
 * Must be run within an existing transaction.
 */
async function nextJournalNoAsync(txRequest) {
    const rx = Math.random().toString(36).substring(2, 9);
    txRequest.input(`cn_journal_${rx}`, sql.NVarChar, 'journal');
    const row = await txRequest.query(`
        SELECT prefix, last_number 
        FROM invoice_counters WITH (UPDLOCK) 
        WHERE counter_name = @cn_journal_${rx}
    `);
    
    let prefix = 'JE';
    let next = 1;
    
    if (!row.recordset[0]) {
        await txRequest.query(`
            INSERT INTO invoice_counters (counter_name, prefix, last_number) 
            VALUES ('journal', 'JE', 1)
        `);
    } else {
        prefix = row.recordset[0].prefix;
        next = row.recordset[0].last_number + 1;
        txRequest.input(`cn_next_journal_${rx}`, sql.Int, next);
        await txRequest.query(`
            UPDATE invoice_counters 
            SET last_number = @cn_next_journal_${rx} 
            WHERE counter_name = @cn_journal_${rx}
        `);
    }
    return `${prefix}-${String(next).padStart(5, '0')}`;
}

/**
 * Retrieve Account ID by System Code
 */
async function getSystemAccountAsync(txRequest, systemCode) {
    txRequest.input(`gsys_code_${systemCode}`, sql.NVarChar, systemCode);
    const res = await txRequest.query(`
        SELECT id FROM chart_of_accounts WHERE system_code = @gsys_code_${systemCode}
    `);
    if (!res.recordset[0]) {
        console.error(`[AccountingEngine] Missing system account: ${systemCode}. Run chart_of_accounts seeding from server startup.`);
        throw new Error('حساب النظام المطلوب غير موجود في شجرة الحسابات. يرجى التأكد من تهيئة الحسابات الأساسية من الإعدادات.');
    }
    return res.recordset[0].id;
}

/**
 * Complete registry of all ERP system accounts that must exist in chart_of_accounts.
 * Ordered hierarchically: parents before children.
 * code = account_code, parent = parent account_code, sys = system_code (if any).
 */
const REQUIRED_SYSTEM_ACCOUNTS = [
    // ── Level 1: Top categories ──
    { code: '1',  name: 'الأصول',                        type: 'asset' },
    { code: '2',  name: 'الخصوم',                        type: 'liability' },
    { code: '3',  name: 'حقوق الملكية',                  type: 'equity' },
    { code: '4',  name: 'الإيرادات',                     type: 'revenue' },
    { code: '5',  name: 'المصروفات',                     type: 'expense' },

    // ── Level 2: Sub-categories ──
    { code: '11', name: 'الأصول المتداولة',              type: 'asset',   parent: '1' },
    { code: '12', name: 'الأصول الثابتة',                type: 'asset',   parent: '1' },
    { code: '21', name: 'الخصوم المتداولة',              type: 'liability', parent: '2' },
    { code: '22', name: 'الخصوم طويلة الأجل',            type: 'liability', parent: '2' },
    { code: '31', name: 'رأس المال',                     type: 'equity',  parent: '3' },
    { code: '42', name: 'إيرادات أخرى',                  type: 'revenue', parent: '4' },
    { code: '55', name: 'مصروفات عامة وإدارية',           type: 'expense', parent: '5' },

    // ── Level 3: System accounts (have system_code) ──
    { code: '111', name: 'النقدية بالخزينة',              type: 'asset',      parent: '11', sys: 'SYS_CASH' },
    { code: '112', name: 'النقدية بالبنوك',                type: 'asset',      parent: '11', sys: 'SYS_BANK' },
    { code: '113', name: 'العملاء (الذمم المدينة)',        type: 'asset',      parent: '11', sys: 'SYS_AR' },
    { code: '114', name: 'المخزون',                       type: 'asset',      parent: '11', sys: 'SYS_INVENTORY' },
    { code: '115', name: 'ضريبة القيمة المضافة (مدخلات)',  type: 'asset',      parent: '11', sys: 'SYS_VAT_INPUT' },
    { code: '116', name: 'مخزون تالف / منتهي الصلاحية',    type: 'asset',      parent: '11', sys: 'SYS_DAMAGED_INVENTORY' },
    { code: '117', name: 'شيكات تحت التحصيل',              type: 'asset',      parent: '11', sys: 'SYS_AR_CHEQUES' },
    { code: '211', name: 'الموردين (الذمم الدائنة)',       type: 'liability',  parent: '21', sys: 'SYS_AP' },
    { code: '212', name: 'ضريبة القيمة المضافة (مخرجات)',  type: 'liability',  parent: '21', sys: 'SYS_VAT_OUTPUT' },
    { code: '32',  name: 'الأرباح المحتجزة',              type: 'equity',     parent: '3',  sys: 'SYS_RETAINED_EARNINGS' },
    { code: '41',  name: 'إيرادات المبيعات',              type: 'revenue',    parent: '4',  sys: 'SYS_SALES' },
    { code: '43',  name: 'زيادة وتسويات المخزون',          type: 'revenue',    parent: '4',  sys: 'SYS_INVENTORY_SURPLUS' },
    { code: '44',  name: 'مردودات المشتريات',             type: 'revenue',    parent: '4',  sys: 'SYS_PURCHASE_RETURNS' },
    { code: '51',  name: 'تكلفة البضاعة المباعة (COGS)',   type: 'expense',    parent: '5',  sys: 'SYS_COGS' },
    { code: '52',  name: 'مشتريات',                       type: 'expense',    parent: '5',  sys: 'SYS_PURCHASES' },
    { code: '53',  name: 'مصروفات التشغيل',               type: 'expense',    parent: '5',  sys: 'SYS_EXPENSE' },
    { code: '54',  name: 'خسائر توالف مخزون',              type: 'expense',    parent: '5',  sys: 'SYS_INVENTORY_SHORTAGE' },
    { code: '56',  name: 'مردودات المبيعات',              type: 'expense',    parent: '5',  sys: 'SYS_SALES_RETURNS' },
];

/**
 * Seed missing system accounts into chart_of_accounts.
 * Idempotent: never creates duplicates, never modifies existing accounts.
 * Verifies parent accounts exist before inserting children.
 * Should be called once at server startup within its own transaction.
 *
 * @param {object} pool - mssql ConnectionPool
 */
async function seedRequiredSystemAccountsAsync(pool) {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        const txReq = transaction.request();

        // Build a map of account_code → id from existing rows
        const existingRes = await txReq.query(`SELECT id, account_code, system_code FROM chart_of_accounts`);
        const codeToId = {};
        for (const row of existingRes.recordset) {
            codeToId[row.account_code] = row.id;
        }

        const created = [];
        const patched = [];

        for (const acc of REQUIRED_SYSTEM_ACCOUNTS) {
            const existingId = codeToId[acc.code];

            if (existingId) {
                let didPatch = false;
                // Patch system_code if missing
                if (acc.sys) {
                    const before = await txReq.query(`SELECT system_code FROM chart_of_accounts WHERE id = ${existingId}`);
                    await txReq.query(`
                        UPDATE chart_of_accounts
                        SET system_code = '${acc.sys}'
                        WHERE id = ${existingId} AND (system_code IS NULL OR system_code = '')
                    `);
                    const after = await txReq.query(`SELECT system_code FROM chart_of_accounts WHERE id = ${existingId}`);
                    if (after.recordset[0] && after.recordset[0].system_code === acc.sys) {
                        didPatch = true;
                    }
                }
                // Fix parent_id if it differs from registry definition
                if (acc.parent) {
                    const correctParentId = codeToId[acc.parent];
                    if (correctParentId) {
                        const curr = await txReq.query(`SELECT parent_id FROM chart_of_accounts WHERE id = ${existingId}`);
                        const currParentId = curr.recordset[0] ? curr.recordset[0].parent_id : null;
                        if (currParentId !== correctParentId) {
                            await txReq.query(`UPDATE chart_of_accounts SET parent_id = ${correctParentId} WHERE id = ${existingId}`);
                            if (!didPatch) didPatch = true;
                        }
                    }
                }
                if (didPatch) patched.push(acc.sys || acc.code);
                continue;
            }

            // Account does NOT exist — insert it
            const parentId = acc.parent ? codeToId[acc.parent] : null;
            if (acc.parent && !parentId) {
                console.error(`[AccountingEngine] Parent account code ${acc.parent} not found for ${acc.code} (${acc.name}). Skipping.`);
                continue;
            }

            const sysVal = acc.sys ? `'${acc.sys}'` : 'NULL';
            const parentIdVal = parentId != null ? parentId : 'NULL';

            const ins = await txReq.query(`
                INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, is_active, current_balance, system_code)
                OUTPUT INSERTED.id
                VALUES ('${acc.code}', N'${acc.name}', ${parentIdVal}, '${acc.type}', 1, 0, ${sysVal})
            `);
            codeToId[acc.code] = ins.recordset[0].id;
            created.push(acc.sys || acc.code);
        }

        await transaction.commit();

        if (created.length > 0) {
            console.log(`  ✅ Created system accounts: [${created.join(', ')}]`);
        }
        if (patched.length > 0) {
            console.log(`  ✅ Patched system codes: [${patched.join(', ')}]`);
        }
        if (created.length === 0 && patched.length === 0) {
            console.log('  ✅ All ERP system accounts already exist');
        }
    } catch (err) {
        await transaction.rollback();
        console.error('[AccountingEngine] Seed system accounts failed:', err.message);
        throw err;
    }
}

/**
 * Central function to post a Journal Entry (قيد محاسبي)
 * Must be executed within a transaction.
 * 
 * @param {object} txRequest - The sql.Transaction request object
 * @param {string} date - Date of the entry (YYYY-MM-DD)
 * @param {string} description - Explanation of the journal entry
 * @param {Array} lines - Array of objects: { account_id, debit, credit, description }
 * @param {string} refType - Reference module (e.g., 'sales', 'purchases')
 * @param {number} refId - ID of the reference document
 * @param {number} userId - ID of the user creating the entry
 * @param {object} source - { module: string, action: string, document: string, isSystem: boolean }
 */
async function postJournalEntryAsync(txRequest, date, description, lines, refType, refId, userId = null, source = {}) {
    if (!lines || lines.length < 2) {
        throw new Error('القيد المحاسبي يجب أن يحتوي على طرفين (مدين ودائن) على الأقل.');
    }

    // Parameter uniqueness suffix
    const px = Math.random().toString(36).substring(2, 9);

    // Double Posting Protection (Rule 3)
    if (source.module && source.action && source.document) {
        txRequest.input(`dp_mod_${px}`, sql.NVarChar, source.module);
        txRequest.input(`dp_act_${px}`, sql.NVarChar, source.action);
        txRequest.input(`dp_doc_${px}`, sql.NVarChar, source.document);
        let dpExtra = '';
        if (refType && refId) {
            txRequest.input(`dp_rtype_${px}`, sql.NVarChar, refType);
            txRequest.input(`dp_rid_${px}`, sql.Int, refId);
            dpExtra = ` AND reference_type = @dp_rtype_${px} AND reference_id = @dp_rid_${px}`;
        }
        const checkRes = await txRequest.query(`
            SELECT id FROM journal_entries 
            WHERE source_module = @dp_mod_${px} 
              AND source_action = @dp_act_${px} 
              AND source_document = @dp_doc_${px}
              AND (is_reversed IS NULL OR is_reversed = 0)
              ${dpExtra}
        `);
        if (checkRes.recordset.length > 0) {
            throw new Error(`خطأ: المستند رقم ${source.document} الخاص بـ ${source.module}/${source.action} تم ترحيله مسبقاً (قيد رقم ${checkRes.recordset[0].id}).`);
        }
    }

    let totalDebit = 0;
    let totalCredit = 0;

    // Validate balance and calculate totals
    for (const line of lines) {
        if (!line.account_id) throw new Error('حساب مفقود في أحد أطراف القيد.');
        
        const d = parseFloat(line.debit) || 0;
        const c = parseFloat(line.credit) || 0;
        
        if (d < 0 || c < 0) throw new Error('لا يمكن تسجيل قيم سالبة في القيد.');
        if (d > 0 && c > 0) throw new Error('لا يمكن للحساب أن يكون مديناً ودائناً في نفس السطر.');
        
        totalDebit += d;
        totalCredit += c;
    }

    // Floating point precision fix
    totalDebit = Math.round(totalDebit * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;

    if (totalDebit !== totalCredit) {
        throw new Error(`القيد غير متزن! إجمالي المدين (${totalDebit}) لا يساوي إجمالي الدائن (${totalCredit}).`);
    }

    if (totalDebit === 0) {
        throw new Error('لا يمكن تسجيل قيد بقيمة صفر.');
    }

    // Generate Journal Number
    const entryNo = await nextJournalNoAsync(txRequest);

    // Insert Header
    txRequest.input(`je_no_${px}`, sql.NVarChar, entryNo);
    txRequest.input(`je_date_${px}`, sql.NVarChar, date);
    txRequest.input(`je_desc_${px}`, sql.NVarChar, description);
    txRequest.input(`je_rtype_${px}`, sql.NVarChar, refType || null);
    txRequest.input(`je_rid_${px}`, sql.Int, refId || null);
    txRequest.input(`je_tdebit_${px}`, sql.Decimal(18, 2), totalDebit);
    txRequest.input(`je_tcredit_${px}`, sql.Decimal(18, 2), totalCredit);
    txRequest.input(`je_uid_${px}`, sql.Int, userId);
    
    // Tracking fields
    txRequest.input(`je_smod_${px}`, sql.NVarChar, source.module || null);
    txRequest.input(`je_sact_${px}`, sql.NVarChar, source.action || null);
    txRequest.input(`je_sdoc_${px}`, sql.NVarChar, source.document || null);
    txRequest.input(`je_issys_${px}`, sql.Int, source.isSystem ? 1 : 0);

    const jeRes = await txRequest.query(`
        INSERT INTO journal_entries (
            entry_no, entry_date, description, reference_type, reference_id, 
            total_debit, total_credit, created_by, source_module, source_action, source_document, is_system_generated
        )
        OUTPUT INSERTED.id
        VALUES (
            @je_no_${px}, @je_date_${px}, @je_desc_${px}, @je_rtype_${px}, @je_rid_${px}, 
            @je_tdebit_${px}, @je_tcredit_${px}, @je_uid_${px}, @je_smod_${px}, @je_sact_${px}, @je_sdoc_${px}, @je_issys_${px}
        )
    `);
    const entryId = jeRes.recordset[0].id;

    // Insert Lines and Update Account Balances
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const debit = parseFloat(line.debit) || 0;
        const credit = parseFloat(line.credit) || 0;
        const lDesc = line.description || description;

        txRequest.input(`jel_eid_${px}_${i}`, sql.Int, entryId);
        txRequest.input(`jel_aid_${px}_${i}`, sql.Int, line.account_id);
        txRequest.input(`jel_d_${px}_${i}`, sql.Decimal(18, 2), debit);
        txRequest.input(`jel_c_${px}_${i}`, sql.Decimal(18, 2), credit);
        txRequest.input(`jel_desc_${px}_${i}`, sql.NVarChar, lDesc);

        await txRequest.query(`
            INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description)
            VALUES (@jel_eid_${px}_${i}, @jel_aid_${px}_${i}, @jel_d_${px}_${i}, @jel_c_${px}_${i}, @jel_desc_${px}_${i})
        `);

        // Update Account Balance (Assuming debit increases assets/expenses, credit increases liabilities/equity/revenue)
        // Let's rely on account_type to correctly determine +/- or just store absolute debit/credit
        // Actually, a General Ledger calculates balance on the fly, but for performance we update current_balance
        // In modern ERPs, balance is just SUM(debit) - SUM(credit) depending on normal balance
        // We will update current_balance as: current_balance + (debit - credit)
        // Wait, standard accounting: Assets/Expenses increase with Debit. Liabilities/Equity/Revenue increase with Credit.
        
        // Fetch account type
        txRequest.input(`bal_aid_${px}_${i}`, sql.Int, line.account_id);
        const accRes = await txRequest.query(`SELECT account_type FROM chart_of_accounts WHERE id = @bal_aid_${px}_${i}`);
        if (!accRes.recordset[0]) throw new Error(`الحساب رقم ${line.account_id} غير موجود`);
        
        const accType = accRes.recordset[0].account_type;
        let delta = 0;
        
        // Normal Balance Logic:
        // Asset, Expense -> Normal Debit (+ Debit, - Credit)
        // Liability, Equity, Revenue -> Normal Credit (+ Credit, - Debit)
        if (accType === 'asset' || accType === 'expense') {
            delta = debit - credit;
        } else if (accType === 'liability' || accType === 'equity' || accType === 'revenue') {
            delta = credit - debit;
        } else {
            // Default fallback if type is missing/unknown (treat as asset)
            delta = debit - credit;
        }

        txRequest.input(`jel_delta_${px}_${i}`, sql.Decimal(18, 2), delta);
        await txRequest.query(`
            UPDATE chart_of_accounts 
            SET current_balance = COALESCE(current_balance, 0) + @jel_delta_${px}_${i} 
            WHERE id = @bal_aid_${px}_${i}
        `);
    }

    return entryId;
}

/**
 * Reverse a Journal Entry (قيد عكسي)
 * Creates a new journal entry with swapped debits and credits.
 */
async function reverseJournalEntryAsync(txRequest, originalEntryId, description, userId = null) {
    const rx = Math.random().toString(36).substring(2, 9);
    txRequest.input(`rev_orig_id_${rx}`, sql.Int, originalEntryId);
    
    // Fetch original header
    const headRes = await txRequest.query(`SELECT * FROM journal_entries WHERE id = @rev_orig_id_${rx}`);
    const origHead = headRes.recordset[0];
    if (!origHead) throw new Error('القيد الأصلي غير موجود');

    // Fetch original lines
    const linesRes = await txRequest.query(`SELECT * FROM journal_entry_lines WHERE entry_id = @rev_orig_id_${rx}`);
    const origLines = linesRes.recordset;

    // Invert lines
    const revLines = origLines.map(l => ({
        account_id: l.account_id,
        debit: parseFloat(l.credit) || 0, // Swap
        credit: parseFloat(l.debit) || 0, // Swap
        description: `عكس: ${l.description || origHead.description}`
    }));

    const date = new Date().toISOString().slice(0, 10);
    const revDesc = description || `قيد عكسي للقيد رقم ${origHead.entry_no}`;
    
    const source = {
        module: origHead.source_module,
        action: origHead.source_action ? `${origHead.source_action}_cancel` : 'cancel',
        document: origHead.source_document,
        isSystem: true
    };

    const newEntryId = await postJournalEntryAsync(
        txRequest,
        date,
        revDesc,
        revLines,
        origHead.reference_type,
        origHead.reference_id,
        userId,
        source
    );

    // Mark original entry as reversed
    txRequest.input(`rev_new_id_${rx}`, sql.Int, newEntryId);
    await txRequest.query(`
        UPDATE journal_entries 
        SET is_reversed = 1, reversed_by = @rev_new_id_${rx}
        WHERE id = @rev_orig_id_${rx}
    `);

    return newEntryId;
}

/**
 * Recalculate Supplier Balance
 * Must be run within an existing transaction or with a pool request.
 * Formula: opening_balance + SUM(invoices) - SUM(returns) - SUM(non-bounced payments)
 */
async function recalcSupplierBalanceAsync(poolOrTxReq, supplierId) {
    const pRand = Math.random().toString(36).substring(2, 9);
    const request = typeof poolOrTxReq.request === 'function' ? poolOrTxReq.request() : poolOrTxReq;
    request.input(`rsb_sid_${pRand}`, sql.Int, supplierId);

    const sRes = await request.query(`SELECT opening_balance FROM suppliers WHERE id = @rsb_sid_${pRand}`);
    if (!sRes.recordset[0]) return;

    const purRes = await request.query(`SELECT COALESCE(SUM(grand_total), 0) as total FROM purchase_invoices WHERE supplier_id = @rsb_sid_${pRand} AND status NOT IN ('cancelled', 'deleted')`);
    const retRes = await request.query(`SELECT COALESCE(SUM(grand_total), 0) as total FROM purchase_returns WHERE supplier_id = @rsb_sid_${pRand} AND status NOT IN ('cancelled', 'deleted')`);

    const payRes = await request.query(`
        SELECT COALESCE(SUM(sub.amount), 0) as total FROM (
            SELECT sp.amount FROM supplier_payments sp
            LEFT JOIN checks ch ON ch.payment_id = sp.id
            WHERE sp.supplier_id = @rsb_sid_${pRand} AND (ch.id IS NULL OR ch.status NOT IN ('bounced', 'cancelled'))
            UNION ALL
            SELECT ap.amount FROM ap_payments ap
            LEFT JOIN ap_cheques ac ON ac.payment_id = ap.id
            WHERE ap.supplier_id = @rsb_sid_${pRand} AND ap.status = 'active' AND (ac.id IS NULL OR ac.status NOT IN ('returned', 'cancelled'))
            UNION ALL
            SELECT CASE WHEN an.note_type='credit' THEN an.amount ELSE -an.amount END FROM ap_notes an
            WHERE an.supplier_id = @rsb_sid_${pRand} AND an.status = 'active'
        ) sub
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

/**
 * Recalculate Customer Balance
 * Must be run within an existing transaction or with a pool request.
 * Formula: opening_balance + SUM(sales) - SUM(returns) - SUM(collections)
 * Collections include: customer_collections (legacy), ar_payments, ar_notes
 */
async function recalcCustomerBalanceAsync(poolOrTxReq, customerId) {
    const pRand = Math.random().toString(36).substring(2, 9);
    const request = typeof poolOrTxReq.request === 'function' ? poolOrTxReq.request() : poolOrTxReq;
    request.input(`rcb_cid_${pRand}`, sql.Int, customerId);

    const cRes = await request.query(`SELECT opening_balance FROM customers WHERE id = @rcb_cid_${pRand}`);
    if (!cRes.recordset[0]) return;

    const salesRes = await request.query(`SELECT COALESCE(SUM(grand_total), 0) as total FROM sales_invoices WHERE customer_id = @rcb_cid_${pRand} AND status NOT IN ('cancelled', 'deleted')`);
    const returnsRes = await request.query(`SELECT COALESCE(SUM(grand_total), 0) as total FROM sales_returns WHERE customer_id = @rcb_cid_${pRand} AND status NOT IN ('cancelled', 'deleted')`);

    const collectionsRes = await request.query(`
        SELECT COALESCE(SUM(sub.amount), 0) as total FROM (
            SELECT cc.amount FROM customer_collections cc
            LEFT JOIN checks ch ON ch.collection_id = cc.id
            WHERE cc.customer_id = @rcb_cid_${pRand} AND (ch.id IS NULL OR ch.status NOT IN ('bounced', 'cancelled'))
            UNION ALL
            SELECT ap.amount FROM ar_payments ap
            LEFT JOIN ar_cheques ac ON ac.payment_id = ap.id
            WHERE ap.customer_id = @rcb_cid_${pRand} AND ap.status = 'active' AND (ac.id IS NULL OR ac.status NOT IN ('returned', 'cancelled'))
            UNION ALL
            SELECT CASE WHEN an.note_type='debit' THEN an.amount ELSE -an.amount END FROM ar_notes an
            WHERE an.customer_id = @rcb_cid_${pRand} AND an.status = 'active'
        ) sub
    `);

    const opening = cRes.recordset[0].opening_balance || 0;
    const sales = salesRes.recordset[0].total || 0;
    const returns = returnsRes.recordset[0].total || 0;
    const collections = collectionsRes.recordset[0].total || 0;

    const balance = opening + sales - returns - collections;

    request.input(`rcb_bal_${pRand}`, sql.Decimal(18, 2), balance);
    await request.query(`UPDATE customers SET current_balance = @rcb_bal_${pRand} WHERE id = @rcb_cid_${pRand}`);
    return balance;
}

module.exports = {
    postJournalEntryAsync,
    nextJournalNoAsync,
    getSystemAccountAsync,
    reverseJournalEntryAsync,
    seedRequiredSystemAccountsAsync,
    recalcSupplierBalanceAsync,
    recalcCustomerBalanceAsync
};
