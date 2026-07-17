// ============================================================
// ROUTE: Sales Invoices
// ============================================================

const router = require('express').Router();
const { getPool, sql } = require('../../database/mssql_db');
const { postJournalEntryAsync, reverseJournalEntryAsync, getSystemAccountAsync, recalcCustomerBalanceAsync } = require('../../services/accountingEngine');
const { updateStockBalanceAsync } = require('../../services/stockEngine');
const { nextDocNoAsync } = require('../../services/documentEngine');
const { createTreasuryTransactionAsync } = require('../../services/treasuryEngine');
const { userHasPermission } = require('../../middleware/permissions');
const logActivity = require('../../middleware/logger');
const asyncHandler = require('../../utils/asyncHandler');

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

/**
 * Check if a sales invoice can be cancelled.
 * Returns { allowed, reasons[], invoice } — collects ALL blockers.
 */
async function canCancelSalesInvoiceAsync(poolOrTx, invoiceId) {
    const request = typeof poolOrTx.request === 'function' ? poolOrTx.request() : poolOrTx;
    const pRand = Math.random().toString(36).substring(2, 7);
    request.input(`ccs_id_${pRand}`, sql.Int, invoiceId);

    const invRes = await request.query(`SELECT id, invoice_no, customer_id, grand_total, amount_paid, status, invoice_date, store_id FROM sales_invoices WHERE id = @ccs_id_${pRand}`);
    if (!invRes.recordset[0]) return { allowed: false, reasons: ['الفاتورة غير موجودة'], invoice: null };
    const invoice = invRes.recordset[0];
    if (invoice.status === 'cancelled') return { allowed: false, reasons: ['الفاتورة ملغاة بالفعل'], invoice };

    const reasons = [];

    // Check sales returns
    {
        const r = Math.random().toString(36).substring(2, 9);
        request.input(`ccs_ret_${r}`, sql.Int, invoiceId);
        const ret = await request.query(`SELECT COUNT(*) as cnt FROM sales_returns WHERE invoice_id = @ccs_ret_${r} AND status NOT IN ('cancelled', 'deleted')`);
        if (ret.recordset[0].cnt > 0) reasons.push('الفاتورة مرتبطة بمرتجع مبيعات');
    }

    // Check collection allocations
    {
        const r = Math.random().toString(36).substring(2, 9);
        request.input(`ccs_col_${r}`, sql.Int, invoiceId);
        const col = await request.query(`SELECT COUNT(*) as cnt FROM collection_allocations WHERE invoice_id = @ccs_col_${r}`);
        if (col.recordset[0].cnt > 0) reasons.push('الفاتورة مرتبطة بتحصيل نقدي');
    }

    // Check AR payment allocations (includes matching, cheques)
    {
        const r = Math.random().toString(36).substring(2, 9);
        request.input(`ccs_pay_${r}`, sql.Int, invoiceId);
        const pay = await request.query(`SELECT COUNT(*) as cnt FROM ar_payment_allocations WHERE invoice_id = @ccs_pay_${r}`);
        if (pay.recordset[0].cnt > 0) reasons.push('الفاتورة مرتبطة بسداد أو مطابقة');
    }

    return { allowed: reasons.length === 0, reasons, invoice };
}

async function updateInvoiceStatusAsync(txRequest, invoiceId) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`uis_inv_${pRand}`, sql.Int, invoiceId);
    
    const invRes = await txRequest.query(`SELECT * FROM sales_invoices WHERE id = @uis_inv_${pRand}`);
    const inv = invRes.recordset[0];
    if (!inv || inv.status === 'cancelled') return;

    const retRes = await txRequest.query(`SELECT COALESCE(SUM(grand_total),0) as total FROM sales_returns WHERE invoice_id = @uis_inv_${pRand} AND status NOT IN ('cancelled', 'deleted')`);
    const returnsTotal = retRes.recordset[0].total || 0;

    const effectiveRemaining = inv.grand_total - inv.amount_paid - returnsTotal;
    const newRemaining = Math.max(0, effectiveRemaining);
    
    let newStatus;
    if (inv.status === 'cancelled') {
        newStatus = 'cancelled';
    } else if (newRemaining <= 0) {
        newStatus = 'paid';
    } else if (inv.amount_paid > 0 || returnsTotal > 0) {
        newStatus = 'partial';
    } else {
        newStatus = inv.payment_type === 'credit' ? 'pending' : 'pending';
    }

    txRequest.input(`uis_rem_${pRand}`, sql.Decimal(18, 2), newRemaining);
    txRequest.input(`uis_stat_${pRand}`, sql.NVarChar, newStatus);
    await txRequest.query(`UPDATE sales_invoices SET remaining = @uis_rem_${pRand}, status = @uis_stat_${pRand} WHERE id = @uis_inv_${pRand}`);
}

async function updateInvoiceReturnStatusAsync(txRequest, invoiceId) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`urs_inv_${pRand}`, sql.Int, invoiceId);

    await txRequest.query(`
        UPDATE ii
        SET ii.returned_qty = COALESCE((
            SELECT SUM(sri.quantity)
            FROM sales_return_items sri
            INNER JOIN sales_returns sr ON sr.id = sri.return_id
            WHERE sr.invoice_id = @urs_inv_${pRand}
              AND sr.status NOT IN ('cancelled', 'deleted')
              AND sri.product_id = ii.product_id
        ), 0)
        FROM sales_invoice_items ii
        WHERE ii.invoice_id = @urs_inv_${pRand}
    `);

    const statusRes = await txRequest.query(`
        SELECT
            COUNT(*) as total_items,
            SUM(CASE WHEN COALESCE(returned_qty, 0) >= quantity THEN 1 ELSE 0 END) as fully_returned,
            SUM(CASE WHEN COALESCE(returned_qty, 0) > 0 THEN 1 ELSE 0 END) as any_returned
        FROM sales_invoice_items
        WHERE invoice_id = @urs_inv_${pRand}
    `);
    const row = statusRes.recordset[0];
    let newReturnStatus = 'Normal';
    if (row && row.total_items > 0) {
        if (row.fully_returned >= row.total_items) {
            newReturnStatus = 'Fully Returned';
        } else if (row.any_returned > 0) {
            newReturnStatus = 'Partially Returned';
        }
    }

    txRequest.input(`urs_stat_${pRand}`, sql.NVarChar, newReturnStatus);
    await txRequest.query(`UPDATE sales_invoices SET return_status = @urs_stat_${pRand} WHERE id = @urs_inv_${pRand}`);
}

function computeInvoiceStatus(grandTotal, amountPaid, paymentType) {
    const remaining = grandTotal - amountPaid;
    if (remaining <= 0) return 'paid';
    if (amountPaid > 0) return 'partial';
    if (paymentType === 'credit') return 'pending';
    return 'pending';
}

// ============================================================
// Routes
// ============================================================

router.get('/invoices', async (req, res) => {
    try {
        const { q, customer_id, from, to, status, payment_type } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT TOP 500 i.*, c.customer_name, c.phone as customer_phone, r.rep_name 
                   FROM sales_invoices i 
                   LEFT JOIN customers c ON i.customer_id = c.id 
                   LEFT JOIN sales_reps r ON i.rep_id = r.id 
                   WHERE 1=1`;
        
        if (q) { sqlQuery += ` AND (i.invoice_no LIKE @q OR c.customer_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (customer_id) { sqlQuery += ` AND i.customer_id = @customerId`; request.input('customerId', sql.Int, customer_id); }
        if (from) { sqlQuery += ` AND i.invoice_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND i.invoice_date <= @to`; request.input('to', sql.NVarChar, to); }
        if (status) { sqlQuery += ` AND i.status = @status`; request.input('status', sql.NVarChar, status); }
        if (payment_type) { sqlQuery += ` AND i.payment_type = @paymentType`; request.input('paymentType', sql.NVarChar, payment_type); }
        
        sqlQuery += ` ORDER BY i.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Sales GET error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

router.get('/invoices/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('id', sql.Int, req.params.id);
        
        const invRes = await request.query(`SELECT i.*, c.customer_name, c.phone as customer_phone, c.address, r.rep_name 
            FROM sales_invoices i 
            LEFT JOIN customers c ON i.customer_id = c.id 
            LEFT JOIN sales_reps r ON i.rep_id = r.id 
            WHERE i.id = @id`);
        const invoice = invRes.recordset[0];
        if (!invoice) return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });

        const itemsRes = await request.query(`SELECT ii.*, p.product_name, p.unit_name, p.barcode,
                (ii.quantity - COALESCE(ii.returned_qty, 0)) as remaining_qty
            FROM sales_invoice_items ii 
            LEFT JOIN products p ON ii.product_id = p.id 
            WHERE ii.invoice_id = @id`);

        const retAmtRes = await request.query(`SELECT COALESCE(SUM(grand_total), 0) as returned_amount
            FROM sales_returns WHERE invoice_id = @id AND status NOT IN ('cancelled', 'deleted')`);
        const returnedAmount = retAmtRes.recordset[0].returned_amount;

        res.json({ success: true, data: {
            ...invoice,
            items: itemsRes.recordset,
            returned_amount: Number(returnedAmount),
            net_total: Number(invoice.grand_total) - Number(returnedAmount)
        } });
    } catch (err) {
        console.error('Sales GET:id error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});



router.post('/invoices', async (req, res) => {
    const { invoice_no, customer_id, invoice_date, due_date, rep_id, store_id, payment_type, invoice_type, discount_amount, discount_pct, tax_amount, amount_paid, notes, items } = req.body;

    if (!customer_id) {
        await logActivity(req, 'CREATE', 'sales', req.body.invoice_no || null, 'إنشاء فاتورة مبيعات', null, null, 'FAILED', 'العميل مطلوب');
        return res.status(400).json({ success: false, message: 'العميل مطلوب' });
    }
    if (!items || items.length === 0) {
        await logActivity(req, 'CREATE', 'sales', req.body.invoice_no || null, 'إنشاء فاتورة مبيعات', null, null, 'FAILED', 'لا توجد أصناف في الفاتورة');
        return res.status(400).json({ success: false, message: 'لا توجد أصناف في الفاتورة' });
    }

    let transaction;
    try {
        const pool = await getPool();
        
        if (invoice_no) {
            const existing = await pool.request()
                .input('invNo', sql.NVarChar, invoice_no)
                .query('SELECT id FROM sales_invoices WHERE invoice_no = @invNo');
            if (existing.recordset.length > 0) {
                await logActivity(req, 'CREATE', 'sales', invoice_no, 'إنشاء فاتورة مبيعات', null, null, 'FAILED', 'رقم الفاتورة موجود مسبقاً');
                return res.status(400).json({ success: false, code: 'DUPLICATE_INVOICE_NO', invoice_no, message: 'رقم الفاتورة موجود مسبقاً، الرجاء اختيار رقم آخر.' });
            }
        }

        const storeRes = await pool.request().query("SELECT TOP 1 id FROM stores WHERE store_type = 'main' ORDER BY id ASC");
        const storeId = (store_id && parseInt(store_id) > 0) ? parseInt(store_id) : (storeRes.recordset[0] ? parseInt(storeRes.recordset[0].id) : 6);

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            txRequest.input(`chk_sid_${i}`, sql.Int, storeId);
            txRequest.input(`chk_pid_${i}`, sql.Int, item.product_id);
            
            const stock = await txRequest.query(`
                SELECT ib.quantity, p.product_name, p.cost_price 
                FROM products p WITH (UPDLOCK)
                LEFT JOIN inventory_balances ib WITH (UPDLOCK) ON p.id = ib.product_id AND ib.store_id = @chk_sid_${i}
                WHERE p.id = @chk_pid_${i}
            `);
            const pInfo = stock.recordset[0];
            if (!pInfo) {
                await transaction.rollback();
                await logActivity(req, 'CREATE', 'sales', req.body.invoice_no || null, 'إنشاء فاتورة مبيعات', null, null, 'FAILED', 'الصنف غير موجود');
                return res.status(400).json({ success: false, message: 'الصنف غير موجود' });
            }
            const available = pInfo.quantity || 0;
            if (available < item.quantity) {
                await transaction.rollback();
                await logActivity(req, 'CREATE', 'sales', req.body.invoice_no || null, 'إنشاء فاتورة مبيعات', null, null, 'FAILED', `المخزون غير كافٍ للصنف: ${pInfo.product_name}`);
                return res.status(400).json({ success: false, message: `المخزون غير كافٍ للصنف: ${pInfo.product_name} (المتاح: ${available})` });
            }
            item.db_cost_price = pInfo.cost_price || 0;
        }

        let subtotal = 0;
        let totalCost = 0;
        const processedItems = items.map(item => {
            const lineTotal = (item.quantity * item.unit_price) * (1 - (item.discount_pct || 0) / 100);
            subtotal += lineTotal;
            totalCost += (item.db_cost_price * item.quantity);
            return { ...item, line_total: lineTotal };
        });

        const disc = discount_amount || (subtotal * (discount_pct || 0) / 100);
        const tax = tax_amount || 0;
        const grandTotal = subtotal - disc + tax;
        const paid = amount_paid !== undefined ? parseFloat(amount_paid) : 0;
        
        if (paid > grandTotal + 0.01) {
            await transaction.rollback();
            await logActivity(req, 'CREATE', 'sales', invoice_no || null, 'إنشاء فاتورة مبيعات', null, null, 'FAILED', 'المبلغ المدفوع أكبر من الإجمالي');
            return res.status(400).json({ success: false, message: 'المبلغ المدفوع لا يمكن أن يكون أكبر من إجمالي الفاتورة' });
        }
        
        const remaining = grandTotal - paid;
        
        if (payment_type === 'credit' || remaining > 0) {
            txRequest.input('cl_cid', sql.Int, customer_id);
            const custRes = await txRequest.query('SELECT credit_limit, current_balance FROM customers WITH (UPDLOCK) WHERE id = @cl_cid');
            const cust = custRes.recordset[0];
            if (cust && cust.credit_limit > 0) {
                const newBalance = (cust.current_balance || 0) + remaining;
                if (newBalance > cust.credit_limit) {
                    await transaction.rollback();
                    await logActivity(req, 'CREATE', 'sales', invoice_no || null, 'إنشاء فاتورة مبيعات', null, null, 'FAILED', 'تجاوز الحد الائتماني');
                    return res.status(400).json({ success: false, message: `تتجاوز الفاتورة الحد الائتماني للعميل. (الرصيد المتوقع: ${newBalance.toFixed(2)}، الحد: ${cust.credit_limit.toFixed(2)})` });
                }
            }
        }

        const initialStatus = computeInvoiceStatus(grandTotal, paid, payment_type || 'cash');
        const invoiceNo = invoice_no ? invoice_no : await nextDocNoAsync(txRequest, 'sales');
        const iDate = invoice_date || new Date().toISOString().slice(0, 10);
        const dDate = due_date || null;

        const invResult = await txRequest
            .input('invoiceNo', sql.NVarChar, invoiceNo)
            .input('invoiceDate', sql.NVarChar, iDate)
            .input('dueDate', sql.NVarChar, dDate)
            .input('customerId', sql.Int, customer_id)
            .input('repId', sql.Int, rep_id || null)
            .input('storeId', sql.Int, storeId)
            .input('paymentType', sql.NVarChar, payment_type || 'cash')
            .input('invoiceType', sql.NVarChar, invoice_type || 'normal')
            .input('subtotal', sql.Decimal(18, 2), subtotal)
            .input('discountAmt', sql.Decimal(18, 2), disc)
            .input('discountPct', sql.Decimal(18, 2), discount_pct || 0)
            .input('taxAmt', sql.Decimal(18, 2), tax)
            .input('grandTotal', sql.Decimal(18, 2), grandTotal)
            .input('amountPaid', sql.Decimal(18, 2), paid)
            .input('remaining', sql.Decimal(18, 2), remaining)
            .input('notes', sql.NVarChar, notes || '')
            .input('status', sql.NVarChar, initialStatus)
            .query(`
                INSERT INTO sales_invoices 
                (invoice_no, invoice_date, due_date, customer_id, rep_id, store_id, payment_type, invoice_type, subtotal, discount_amount, discount_pct, tax_amount, grand_total, amount_paid, remaining, notes, status) 
                OUTPUT INSERTED.id
                VALUES (@invoiceNo, @invoiceDate, @dueDate, @customerId, @repId, @storeId, @paymentType, @invoiceType, @subtotal, @discountAmt, @discountPct, @taxAmt, @grandTotal, @amountPaid, @remaining, @notes, @status)
            `);
        
        const invoiceId = invResult.recordset[0].id;

        for (let i = 0; i < processedItems.length; i++) {
            const item = processedItems[i];
            txRequest.input(`si_iid_${i}`, sql.Int, invoiceId);
            txRequest.input(`si_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`si_qty_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`si_price_${i}`, sql.Decimal(18, 2), item.unit_price);
            txRequest.input(`si_cost_${i}`, sql.Decimal(18, 2), item.db_cost_price);
            const discAmt = item.discount_amount || (item.quantity * item.unit_price * (item.discount_pct || 0) / 100);
            txRequest.input(`si_dpct_${i}`, sql.Decimal(18, 2), item.discount_pct || 0);
            txRequest.input(`si_damt_${i}`, sql.Decimal(18, 2), discAmt);
            txRequest.input(`si_linetot_${i}`, sql.Decimal(18, 2), item.line_total);

            await txRequest.query(`
                INSERT INTO sales_invoice_items (invoice_id, product_id, quantity, unit_price, cost_price, discount_pct, discount_amount, line_total) 
                VALUES (@si_iid_${i}, @si_pid_${i}, @si_qty_${i}, @si_price_${i}, @si_cost_${i}, @si_dpct_${i}, @si_damt_${i}, @si_linetot_${i})
            `);

            const balanceAfter = await updateStockBalanceAsync(txRequest, storeId, item.product_id, -item.quantity);

            txRequest.input(`sm_date_${i}`, sql.NVarChar, iDate);
            txRequest.input(`sm_docno_${i}`, sql.NVarChar, invoiceNo);
            txRequest.input(`sm_sid_${i}`, sql.Int, storeId);
            txRequest.input(`sm_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`sm_qtyout_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`sm_cost_${i}`, sql.Decimal(18, 2), item.db_cost_price);
            txRequest.input(`sm_sell_${i}`, sql.Decimal(18, 2), item.unit_price);
            txRequest.input(`sm_bal_${i}`, sql.Decimal(18, 4), balanceAfter);
            txRequest.input(`sm_refid_${i}`, sql.Int, invoiceId);
            
            await txRequest.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, sell_price, balance_after, reference_id) 
                VALUES (@sm_date_${i}, 'out', @sm_docno_${i}, @sm_sid_${i}, @sm_pid_${i}, @sm_qtyout_${i}, @sm_cost_${i}, @sm_sell_${i}, @sm_bal_${i}, @sm_refid_${i})
            `);
        }

        // --- ACCOUNTING INTEGRATION: Sales & COGS ---
        const accAR = await getSystemAccountAsync(txRequest, 'SYS_AR');
        const accSales = await getSystemAccountAsync(txRequest, 'SYS_SALES');
        const accVatOut = tax > 0 ? await getSystemAccountAsync(txRequest, 'SYS_VAT_OUTPUT') : null;
        
        const accCogs = await getSystemAccountAsync(txRequest, 'SYS_COGS');
        const accInv = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY');

        // 1. Accrual Entry
        const accrualLines = [
            { account_id: accAR, debit: grandTotal, credit: 0, description: `استحقاق فاتورة مبيعات ${invoiceNo}` },
            { account_id: accSales, debit: 0, credit: subtotal - disc, description: `إيراد مبيعات فاتورة ${invoiceNo}` }
        ];
        if (tax > 0) {
            accrualLines.push({ account_id: accVatOut, debit: 0, credit: tax, description: `ضريبة مخرجات فاتورة ${invoiceNo}` });
        }
        await postJournalEntryAsync(
            txRequest, iDate, `استحقاق فاتورة مبيعات ${invoiceNo}`, accrualLines,
            'sales_invoice', invoiceId, req.user ? req.user.id : null,
            { module: 'sales', action: 'create_invoice', document: invoiceNo, isSystem: true }
        );

        // 2. COGS Entry
        if (totalCost > 0) {
            const cogsLines = [
                { account_id: accCogs, debit: totalCost, credit: 0, description: `تكلفة البضاعة المباعة لفاتورة ${invoiceNo}` },
                { account_id: accInv, debit: 0, credit: totalCost, description: `صرف مخزون لفاتورة ${invoiceNo}` }
            ];
            await postJournalEntryAsync(
                txRequest, iDate, `تكلفة البضاعة لفاتورة ${invoiceNo}`, cogsLines,
                'sales_invoice_cogs', invoiceId, req.user ? req.user.id : null,
                { module: 'sales', action: 'cogs', document: invoiceNo, isSystem: true }
            );
        }

        if (paid > 0) {
            const colNo = await nextDocNoAsync(txRequest, 'collections');
            const tresRes = await txRequest.query(`SELECT TOP 1 id FROM treasury_accounts WHERE account_type = 'cash'`);
            const treasury = tresRes.recordset[0];
            
            if (treasury) {
                const transNo = await nextDocNoAsync(txRequest, 'treasury');
                await createTreasuryTransactionAsync(txRequest, {
                    transNo, transDate: iDate, transType: 'in', amount: paid,
                    accountId: treasury.id, relatedType: 'sales_invoice', relatedId: customer_id,
                    documentNo: colNo, description: `تحصيل فاتورة ${invoiceNo}`,
                    userId: req.user ? req.user.id : null
                });
            }
            
            txRequest.input('cc_colno', sql.NVarChar, colNo);
            txRequest.input('cc_date', sql.NVarChar, iDate);
            txRequest.input('cc_cid', sql.Int, customer_id);
            txRequest.input('cc_amt', sql.Decimal(18, 2), paid);
            txRequest.input('cc_notes', sql.NVarChar, `تحصيل نقدي عند إصدار الفاتورة ${invoiceNo}`);
            
            const colResult = await txRequest.query(`
                INSERT INTO customer_collections (collection_no, collection_date, customer_id, amount, payment_method, notes) 
                OUTPUT INSERTED.id
                VALUES (@cc_colno, @cc_date, @cc_cid, @cc_amt, 'cash', @cc_notes)
            `);
            const colId = colResult.recordset[0].id;
            
            txRequest.input('ca_colid', sql.Int, colId);
            txRequest.input('ca_invid', sql.Int, invoiceId);
            txRequest.input('ca_amt', sql.Decimal(18, 2), paid);
            await txRequest.query(`INSERT INTO collection_allocations (collection_id, invoice_id, amount) VALUES (@ca_colid, @ca_invid, @ca_amt)`);

            // --- ACCOUNTING INTEGRATION: Cash Collection ---
            const accCash = await getSystemAccountAsync(txRequest, 'SYS_CASH');
            const colLines = [
                { account_id: accCash, debit: paid, credit: 0, description: `تحصيل نقدي مبدئي لفاتورة ${invoiceNo}` },
                { account_id: accAR, debit: 0, credit: paid, description: `سداد جزء من مديونية العميل لفاتورة ${invoiceNo}` }
            ];
            await postJournalEntryAsync(
                txRequest, iDate, `تحصيل مبيعات للفاتورة ${invoiceNo}`, colLines,
                'customer_collection', colId, req.user ? req.user.id : null,
                { module: 'collections', action: 'create_collection', document: colNo, isSystem: true }
            );
        }

        await recalcCustomerBalanceAsync(txRequest, customer_id);

        // Log customer activity
        if (customer_id) {
            const pLog = Math.random().toString(36).substring(2, 9);
            txRequest.input(`cal_cid_${pLog}`, sql.Int, customer_id);
            txRequest.input(`cal_type_${pLog}`, sql.NVarChar, 'invoice_created');
            txRequest.input(`cal_desc_${pLog}`, sql.NVarChar, `تم إنشاء فاتورة مبيعات ${invoiceNo} بقيمة ${grandTotal}`);
            txRequest.input(`cal_rt_${pLog}`, sql.NVarChar, 'sales_invoice');
            txRequest.input(`cal_ri_${pLog}`, sql.Int, invoiceId);
            txRequest.input(`cal_rn_${pLog}`, sql.NVarChar, invoiceNo);
            txRequest.input(`cal_amt_${pLog}`, sql.Decimal(18,4), grandTotal || 0);
            txRequest.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
            await txRequest.query(`
                INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                VALUES (@cal_cid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
            `);
        }

        await transaction.commit();
        await logActivity(req, 'CREATE', 'sales', invoiceNo, `فاتورة مبيعات ${invoiceNo}`, null, { invoice_no: invoiceNo, customer_id, grand_total: grandTotal, items_count: items.length, payment_type }, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم حفظ الفاتورة بنجاح', invoiceNo, invoiceId, grandTotal, remaining });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Sales POST error:', err);
        await logActivity(req, 'CREATE', 'sales', req.body.invoice_no || null, 'إنشاء فاتورة مبيعات', null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

router.put('/invoices/:id/cancel', async (req, res) => {
    const invoiceId = parseInt(req.params.id);
    if (!invoiceId) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    const cancelReason = req.body.reason || '';

    let transaction;
    try {
        const pool = await getPool();

        const { allowed, reasons, invoice } = await canCancelSalesInvoiceAsync(pool, invoiceId);
        if (!allowed) {
            await logActivity(req, 'CANCEL', 'sales', String(invoiceId), 'رفض إلغاء فاتورة مبيعات', null, { reasons }, 'FAILED', reasons.join(' | '));
            return res.status(400).json({ success: false, message: 'لا يمكن إلغاء الفاتورة', reasons });
        }
        if (!invoice) {
            await logActivity(req, 'CANCEL', 'sales', String(invoiceId), 'إلغاء فاتورة مبيعات', null, null, 'FAILED', 'الفاتورة غير موجودة');
            return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        txRequest.input('txInvId', sql.Int, invoiceId);
        const itemsRes = await txRequest.query('SELECT ii.*, p.cost_price as current_cost FROM sales_invoice_items ii LEFT JOIN products p ON ii.product_id = p.id WHERE ii.invoice_id = @txInvId');
        const items = itemsRes.recordset;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const costPrice = parseFloat(item.cost_price) || parseFloat(item.current_cost) || 0;
            const balanceAfter = await updateStockBalanceAsync(txRequest, invoice.store_id, item.product_id, +item.quantity);

            txRequest.input(`sm_date_${i}`, sql.NVarChar, invoice.invoice_date || new Date().toISOString().slice(0, 10));
            txRequest.input(`sm_doc_${i}`, sql.NVarChar, `CNCL-${invoice.invoice_no}`);
            txRequest.input(`sm_sid_${i}`, sql.Int, invoice.store_id);
            txRequest.input(`sm_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`sm_qty_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`sm_cost_${i}`, sql.Decimal(18, 2), costPrice);
            txRequest.input(`sm_bal_${i}`, sql.Decimal(18, 4), balanceAfter);
            txRequest.input(`sm_ref_${i}`, sql.Int, invoiceId);
            await txRequest.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes)
                VALUES (@sm_date_${i}, 'cancellation', @sm_doc_${i}, @sm_sid_${i}, @sm_pid_${i}, @sm_qty_${i}, @sm_cost_${i}, @sm_bal_${i}, @sm_ref_${i}, N'إلغاء فاتورة مبيعات ${invoice.invoice_no}')
            `);
        }

        txRequest.input('je_ref_type', sql.NVarChar, 'sales_invoice');
        txRequest.input('je_ref_id', sql.Int, invoiceId);
        const jeRes = await txRequest.query(`
            SELECT id FROM journal_entries 
            WHERE reference_type IN ('sales_invoice', 'sales_invoice_cogs')
              AND reference_id = @je_ref_id
              AND (is_reversed IS NULL OR is_reversed = 0)
        `);
        for (const je of jeRes.recordset) {
            await reverseJournalEntryAsync(txRequest, je.id, `إلغاء فاتورة مبيعات ${invoice.invoice_no}`, req.user ? req.user.id : null);
        }

        await txRequest.query(`UPDATE sales_invoices SET status = 'cancelled' WHERE id = @txInvId`);
        await recalcCustomerBalanceAsync(txRequest, invoice.customer_id);

        {
            const pLog = Math.random().toString(36).substring(2, 9);
            txRequest.input(`cal_cid_${pLog}`, sql.Int, invoice.customer_id);
            txRequest.input(`cal_type_${pLog}`, sql.NVarChar, 'invoice_cancelled');
            txRequest.input(`cal_desc_${pLog}`, sql.NVarChar, `تم إلغاء فاتورة مبيعات ${invoice.invoice_no} بقيمة ${invoice.grand_total}، عدد الأصناف: ${items.length}${cancelReason ? '، سبب: ' + cancelReason : ''}`);
            txRequest.input(`cal_rt_${pLog}`, sql.NVarChar, 'sales_invoice');
            txRequest.input(`cal_ri_${pLog}`, sql.Int, invoiceId);
            txRequest.input(`cal_rn_${pLog}`, sql.NVarChar, invoice.invoice_no);
            txRequest.input(`cal_amt_${pLog}`, sql.Decimal(18, 4), invoice.grand_total || 0);
            txRequest.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
            await txRequest.query(`
                INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                VALUES (@cal_cid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
            `);
        }

        await transaction.commit();
        await logActivity(req, 'CANCEL', 'sales', invoice.invoice_no,
            `إلغاء فاتورة مبيعات ${invoice.invoice_no} | المستخدم: ${req.user ? req.user.name : 'النظام'} | التاريخ: ${new Date().toISOString().slice(0, 10)} | الإجمالي: ${invoice.grand_total} | الأصناف: ${items.length}${cancelReason ? ' | سبب: ' + cancelReason : ''}`,
            { invoice_no: invoice.invoice_no, grand_total: invoice.grand_total, items_count: items.length, status: 'cancelled' },
            null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم إلغاء الفاتورة واسترجاع المخزون وعكس القيود المحاسبية' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Sales cancel error:', err);
        await logActivity(req, 'CANCEL', 'sales', String(invoiceId), `فشل إلغاء فاتورة #${invoiceId}`, null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message });
    }
});

router.post('/invoices/:id/pay', async (req, res) => {
    const { amount, payment_date, payment_method, check_no, check_date, bank_name, notes } = req.body;
    const payAmt = parseFloat(amount);
    if (!payAmt || payAmt <= 0) return res.status(400).json({ success: false, message: 'المبلغ غير صحيح' });

    let transaction;
    try {
        const pool = await getPool();
        const invRes = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT * FROM sales_invoices WHERE id = @id');
        const invoice = invRes.recordset[0];
        
        if (!invoice) return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
        if (invoice.status === 'cancelled') return res.status(400).json({ success: false, message: 'الفاتورة ملغاة' });

        const remainingDue = Math.max(0, parseFloat(invoice.remaining || (invoice.grand_total - invoice.amount_paid)) || 0);
        if (remainingDue <= 0) return res.status(400).json({ success: false, message: 'الفاتورة مسددة بالفعل' });
        if (payAmt > remainingDue + 0.01) return res.status(400).json({ success: false, message: 'المبلغ أكبر من المتبقي على الفاتورة' });

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        const payDate = payment_date || new Date().toISOString().slice(0, 10);
        const method = payment_method || 'cash';
        const newPaid = (invoice.amount_paid || 0) + payAmt;
        const newRemaining = Math.max(0, remainingDue - payAmt);
        const newStatus = newRemaining <= 0 ? 'paid' : 'partial';

        txRequest.input('updPaid', sql.Decimal(18, 2), newPaid);
        txRequest.input('updRem', sql.Decimal(18, 2), newRemaining);
        txRequest.input('updStatus', sql.NVarChar, newStatus);
        txRequest.input('updInvId', sql.Int, invoice.id);
        await txRequest.query('UPDATE sales_invoices SET amount_paid = @updPaid, remaining = @updRem, status = @updStatus WHERE id = @updInvId');

        const colNo = await nextDocNoAsync(txRequest, 'collections');
        txRequest.input('cc_colno', sql.NVarChar, colNo);
        txRequest.input('cc_date', sql.NVarChar, payDate);
        txRequest.input('cc_cid', sql.Int, invoice.customer_id);
        txRequest.input('cc_amt', sql.Decimal(18, 2), payAmt);
        txRequest.input('cc_meth', sql.NVarChar, method);
        txRequest.input('cc_chkno', sql.NVarChar, check_no || null);
        txRequest.input('cc_chkdate', sql.NVarChar, check_date || null);
        txRequest.input('cc_bank', sql.NVarChar, bank_name || null);
        txRequest.input('cc_notes', sql.NVarChar, notes || `دفعة فاتورة ${invoice.invoice_no}`);

        const colResult = await txRequest.query(`
            INSERT INTO customer_collections 
            (collection_no, collection_date, customer_id, amount, payment_method, check_no, check_date, bank_name, notes)
            OUTPUT INSERTED.id
            VALUES (@cc_colno, @cc_date, @cc_cid, @cc_amt, @cc_meth, @cc_chkno, @cc_chkdate, @cc_bank, @cc_notes)
        `);
        const colId = colResult.recordset[0].id;

        txRequest.input('ca_colid', sql.Int, colId);
        txRequest.input('ca_invid', sql.Int, invoice.id);
        txRequest.input('ca_amt', sql.Decimal(18, 2), payAmt);
        await txRequest.query(`INSERT INTO collection_allocations (collection_id, invoice_id, amount) VALUES (@ca_colid, @ca_invid, @ca_amt)`);

        if (method === 'check' && check_no) {
            txRequest.input('chk_no', sql.NVarChar, check_no);
            txRequest.input('chk_date', sql.NVarChar, check_date || payDate);
            txRequest.input('chk_due', sql.NVarChar, check_date || null);
            txRequest.input('chk_amt', sql.Decimal(18, 2), payAmt);
            txRequest.input('chk_cid', sql.Int, invoice.customer_id);
            txRequest.input('chk_bank', sql.NVarChar, bank_name || null);
            txRequest.input('chk_colid', sql.Int, colId);
            txRequest.input('chk_notes', sql.NVarChar, notes || '');
            await txRequest.query(`
                INSERT INTO checks (check_no, check_date, due_date, amount, direction, status, customer_id, bank_name, collection_id, notes)
                VALUES (@chk_no, @chk_date, @chk_due, @chk_amt, 'inward', 'pending', @chk_cid, @chk_bank, @chk_colid, @chk_notes)
            `);
        }

        const wantedType = method === 'transfer' ? 'bank' : 'cash';
        let treasury = null;
        if (method !== 'check') {
            txRequest.input('tresType', sql.NVarChar, wantedType);
            let tresRes = await txRequest.query(`SELECT TOP 1 id FROM treasury_accounts WHERE account_type = @tresType ORDER BY id`);
            if (!tresRes.recordset[0]) {
                tresRes = await txRequest.query(`SELECT TOP 1 id FROM treasury_accounts WHERE account_type = 'cash' ORDER BY id`);
            }
            treasury = tresRes.recordset[0];
        }

        if (treasury) {
            const transNo = await nextDocNoAsync(txRequest, 'treasury');
            await createTreasuryTransactionAsync(txRequest, {
                transNo, transDate: payDate, transType: 'in', amount: payAmt,
                accountId: treasury.id, relatedType: 'sales_invoice', relatedId: invoice.customer_id,
                documentNo: colNo, description: `دفعة فاتورة ${invoice.invoice_no}`,
                userId: req.user ? req.user.id : null
            });
        }

        // --- ACCOUNTING INTEGRATION: Cash/Bank/Check Collection ---
        if (method !== 'check') {
            const accAR = await getSystemAccountAsync(txRequest, 'SYS_AR');
            const accCash = await getSystemAccountAsync(txRequest, method === 'transfer' ? 'SYS_BANK' : 'SYS_CASH');
            const colLines = [
                { account_id: accCash, debit: payAmt, credit: 0, description: `تحصيل لفاتورة المبيعات ${invoice.invoice_no}` },
                { account_id: accAR, debit: 0, credit: payAmt, description: `سداد من حساب العميل لفاتورة ${invoice.invoice_no}` }
            ];
            await postJournalEntryAsync(
                txRequest, payDate, `سداد دفعة لفاتورة ${invoice.invoice_no}`, colLines,
                'customer_collection', colId, req.user ? req.user.id : null,
                { module: 'collections', action: 'create_collection', document: colNo, isSystem: true }
            );
        }

        await updateInvoiceStatusAsync(txRequest, invoice.id);
        await recalcCustomerBalanceAsync(txRequest, invoice.customer_id);

        await transaction.commit();
        res.json({ success: true, message: 'تم تسجيل الدفعة بنجاح', collection_no: colNo });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Sales pay error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

router.post('/invoices/fix-status', async (req, res) => {
    let transaction;
    try {
        const pool = await getPool();
        
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        const invRes = await txRequest.query(`SELECT id FROM sales_invoices WHERE status NOT IN ('cancelled', 'deleted')`);
        const invoices = invRes.recordset;
        let fixed = 0;
        
        for (const inv of invoices) {
            await updateInvoiceStatusAsync(txRequest, inv.id);
            await updateInvoiceReturnStatusAsync(txRequest, inv.id);
            fixed++;
        }

        await transaction.commit();
        res.json({ success: true, message: `تم إصلاح ${fixed} فاتورة`, fixed });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Sales fix-status error:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// ============================================================
// DELETE INVOICE (BLOCKED BY ACCOUNTING RULE 4)
// ============================================================
router.delete('/invoices/:id', async (req, res) => {
    let transaction;
    try {
        if (!req.user || (req.user.role !== 'admin' && !userHasPermission(req, 'sales.delete_invoice'))) {
            await logActivity(req, 'DELETE', 'sales', req.params.id, 'حذف فاتورة', null, null, 'FAILED', 'لا توجد صلاحية');
            return res.status(403).json({ success: false, message: 'ليس لديك صلاحية حذف الفواتير' });
        }

        const pool = await getPool();
        const invRes = await pool.request()
            .input('del_id', sql.Int, req.params.id)
            .query('SELECT * FROM sales_invoices WHERE id = @del_id');
        const invoice = invRes.recordset[0];
        if (!invoice) {
            await logActivity(req, 'DELETE', 'sales', req.params.id, 'حذف فاتورة', null, null, 'FAILED', 'الفاتورة غير موجودة');
            return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
        }
        if (invoice.status === 'cancelled' || invoice.status === 'deleted') {
            await logActivity(req, 'DELETE', 'sales', req.params.id, 'حذف فاتورة', null, null, 'FAILED', 'الفاتورة ملغاة أو محذوفة مسبقاً');
            return res.status(400).json({ success: false, message: 'هذه الفاتورة ملغاة أو محذوفة بالفعل' });
        }

        // ── Dependency scan ──
        const blockers = [];

        // 1. Sales returns linked to this invoice
        const retRes = await pool.request()
            .input('del_rid', sql.Int, req.params.id)
            .query(`SELECT COUNT(*) as cnt FROM sales_returns WHERE invoice_id = @del_rid AND status NOT IN ('cancelled', 'deleted')`);
        if (retRes.recordset[0].cnt > 0) {
            blockers.push(`مرتجعات (${retRes.recordset[0].cnt})`);
        }

        // 2. Amount paid (any payment = collections or cash payments recorded)
        if (parseFloat(invoice.amount_paid) > 0) {
            blockers.push('مدفوعات / تحصيلات مسجلة');
        }

        if (blockers.length > 0) {
            await logActivity(req, 'DELETE', 'sales', invoice.invoice_no, 'حذف فاتورة', null, null, 'FAILED', 'مرتبط بمستندات: ' + blockers.join(', '));
            return res.status(400).json({
                success: false,
                message: 'لا يمكن حذف الفاتورة لأنها مرتبطة بالمستندات التالية:\n• ' + blockers.join('\n• ') + '\n\nقم بإلغاء الفاتورة بدلاً من الحذف.'
            });
        }

        // ── Soft-delete: set status to deleted ──
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txReq = transaction.request();
        txReq.input('sd_id', sql.Int, req.params.id);
        await txReq.query(`UPDATE sales_invoices SET status = 'deleted' WHERE id = @sd_id`);

        if (invoice.customer_id) {
            await recalcCustomerBalanceAsync(txReq, invoice.customer_id);
        }

        await transaction.commit();
        await logActivity(req, 'DELETE', 'sales', invoice.invoice_no, `حذف فاتورة ${invoice.invoice_no}`, { invoice_no: invoice.invoice_no, grand_total: invoice.grand_total }, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم حذف الفاتورة بنجاح' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Sales delete invoice error:', err);
        await logActivity(req, 'DELETE', 'sales', req.params.id, 'حذف فاتورة', null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// ============================================================
// UPDATE (EDIT) INVOICE
// ============================================================
router.put('/invoices/:id', async (req, res) => {
    const { customer_id, invoice_date, due_date, rep_id, store_id, payment_type, invoice_type, discount_pct, tax_amount, amount_paid, notes, items } = req.body;
    
    let transaction;
    try {
        const pool = await getPool();
        const invRes = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT * FROM sales_invoices WHERE id = @id');
        const invoice = invRes.recordset[0];
        
        if (!invoice) {
            await logActivity(req, 'UPDATE', 'sales', req.params.id, 'تعديل فاتورة مبيعات', null, null, 'FAILED', 'الفاتورة غير موجودة');
            return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
        }
        if (!items || items.length === 0) {
            await logActivity(req, 'UPDATE', 'sales', invoice.invoice_no, 'تعديل فاتورة مبيعات', null, null, 'FAILED', 'يجب إضافة أصناف في الفاتورة');
            return res.status(400).json({ success: false, message: 'يجب إضافة أصناف في الفاتورة' });
        }
        if (invoice.status === 'cancelled' || invoice.status === 'deleted') {
            await logActivity(req, 'UPDATE', 'sales', invoice.invoice_no, 'تعديل فاتورة مبيعات', null, null, 'FAILED', 'الفاتورة ملغاة');
            return res.status(400).json({ success: false, message: 'لا يمكن تعديل فاتورة ملغاة أو محذوفة' });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        txRequest.input('txInvId', sql.Int, invoice.id);
        txRequest.input('txInvNo', sql.NVarChar, invoice.invoice_no);

        const oldItemsRes = await txRequest.query('SELECT * FROM sales_invoice_items WHERE invoice_id = @txInvId');
        const oldItemsMap = {};
        for (let i = 0; i < oldItemsRes.recordset.length; i++) {
            const item = oldItemsRes.recordset[i];
            oldItemsMap[item.product_id] = item.cost_price;
            await updateStockBalanceAsync(txRequest, invoice.store_id, item.product_id, +item.quantity);
        }

        const oldJeRes = await txRequest.query(`
            SELECT id FROM journal_entries
            WHERE reference_type IN ('sales_invoice', 'sales_invoice_cogs')
              AND reference_id = @txInvId
              AND (is_reversed IS NULL OR is_reversed = 0)
        `);
        for (const je of oldJeRes.recordset) {
            await reverseJournalEntryAsync(
                txRequest, je.id,
                `عكس قيد الفاتورة ${invoice.invoice_no} بسبب التعديل`,
                req.user ? req.user.id : null
            );
        }

        await txRequest.query(`DELETE FROM stock_movements WHERE move_type = 'out' AND reference_id = @txInvId AND document_no = @txInvNo`);
        await txRequest.query(`DELETE FROM sales_invoice_items WHERE invoice_id = @txInvId`);

        const storeId = store_id || invoice.store_id;
        const iDate = invoice_date || invoice.invoice_date;
        const dDate = due_date !== undefined ? due_date : invoice.due_date;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            txRequest.input(`chk_sid_${i}`, sql.Int, storeId);
            txRequest.input(`chk_pid_${i}`, sql.Int, item.product_id);
            
            const stock = await txRequest.query(`
                SELECT ib.quantity, p.product_name, p.cost_price 
                FROM products p WITH (UPDLOCK)
                LEFT JOIN inventory_balances ib WITH (UPDLOCK) ON p.id = ib.product_id AND ib.store_id = @chk_sid_${i}
                WHERE p.id = @chk_pid_${i}
            `);
            const pInfo = stock.recordset[0];
            if (!pInfo) {
                await transaction.rollback();
                await logActivity(req, 'UPDATE', 'sales', invoice.invoice_no, 'تعديل فاتورة مبيعات', null, null, 'FAILED', 'الصنف غير موجود');
                return res.status(400).json({ success: false, message: 'الصنف غير موجود' });
            }
            
            const available = pInfo.quantity || 0;
            if (available < item.quantity) {
                await transaction.rollback();
                await logActivity(req, 'UPDATE', 'sales', invoice.invoice_no, 'تعديل فاتورة مبيعات', null, null, 'FAILED', `المخزون غير كافٍ للصنف: ${pInfo.product_name}`);
                return res.status(400).json({ success: false, message: `المخزون غير كافٍ للصنف: ${pInfo.product_name} (المتاح: ${available})` });
            }

            if (oldItemsMap[item.product_id] !== undefined) {
                item.db_cost_price = oldItemsMap[item.product_id];
            } else {
                item.db_cost_price = pInfo.cost_price || 0;
            }
        }

        let subtotal = 0;
        for (const item of items) {
            subtotal += (item.quantity * item.unit_price);
        }
        const disc = (subtotal * (discount_pct || 0) / 100);
        const tax = tax_amount || 0;
        const grandTotal = subtotal - disc + tax;

        const paid = amount_paid !== undefined ? parseFloat(amount_paid) : invoice.amount_paid;
        if (paid > grandTotal + 0.01) {
            await transaction.rollback();
            await logActivity(req, 'UPDATE', 'sales', invoice.invoice_no, 'تعديل فاتورة مبيعات', null, null, 'FAILED', 'الإجمالي الجديد أقل من المبلغ المدفوع');
            return res.status(400).json({ success: false, message: 'لا يمكن تعديل الفاتورة لأن إجماليها الجديد أقل من المبلغ المدفوع بالفعل.' });
        }

        const remaining = Math.max(0, grandTotal - paid);
        
        const pType = payment_type || invoice.payment_type;
        if (pType === 'credit' || remaining > 0) {
            txRequest.input('cl_cid', sql.Int, customer_id);
            const custRes = await txRequest.query('SELECT credit_limit, current_balance FROM customers WITH (UPDLOCK) WHERE id = @cl_cid');
            const cust = custRes.recordset[0];
            if (cust && cust.credit_limit > 0) {
                const oldRemaining = Math.max(0, invoice.grand_total - invoice.amount_paid);
                const newBalance = (cust.current_balance || 0) - oldRemaining + remaining;
                if (newBalance > cust.credit_limit) {
                    await transaction.rollback();
                    await logActivity(req, 'UPDATE', 'sales', invoice.invoice_no, 'تعديل فاتورة مبيعات', null, null, 'FAILED', 'تجاوز الحد الائتماني');
                    return res.status(400).json({ success: false, message: `تتجاوز الفاتورة الحد الائتماني للعميل. (الرصيد المتوقع: ${newBalance.toFixed(2)}، الحد: ${cust.credit_limit.toFixed(2)})` });
                }
            }
        }

        const newStatus = computeInvoiceStatus(grandTotal, paid, pType);

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            txRequest.input(`usi_iid_${i}`, sql.Int, invoice.id);
            txRequest.input(`usi_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`usi_qty_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`usi_price_${i}`, sql.Decimal(18, 2), item.unit_price);
            txRequest.input(`usi_cost_${i}`, sql.Decimal(18, 2), item.db_cost_price);
            txRequest.input(`usi_dpct_${i}`, sql.Decimal(18, 2), item.discount_pct || 0);
            txRequest.input(`usi_linetot_${i}`, sql.Decimal(18, 2), item.quantity * item.unit_price);

            await txRequest.query(`
                INSERT INTO sales_invoice_items (invoice_id, product_id, quantity, unit_price, cost_price, discount_pct, discount_amount, line_total) 
                VALUES (@usi_iid_${i}, @usi_pid_${i}, @usi_qty_${i}, @usi_price_${i}, @usi_cost_${i}, @usi_dpct_${i}, 0, @usi_linetot_${i})
            `);

            const balanceAfter = await updateStockBalanceAsync(txRequest, storeId, item.product_id, -item.quantity);

            txRequest.input(`usm_date_${i}`, sql.NVarChar, iDate);
            txRequest.input(`usm_docno_${i}`, sql.NVarChar, invoice.invoice_no);
            txRequest.input(`usm_sid_${i}`, sql.Int, storeId);
            txRequest.input(`usm_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`usm_qtyout_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`usm_cost_${i}`, sql.Decimal(18, 2), item.db_cost_price);
            txRequest.input(`usm_sell_${i}`, sql.Decimal(18, 2), item.unit_price);
            txRequest.input(`usm_bal_${i}`, sql.Decimal(18, 4), balanceAfter);
            txRequest.input(`usm_refid_${i}`, sql.Int, invoice.id);
            
            await txRequest.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, sell_price, balance_after, reference_id) 
                VALUES (@usm_date_${i}, 'out', @usm_docno_${i}, @usm_sid_${i}, @usm_pid_${i}, @usm_qtyout_${i}, @usm_cost_${i}, @usm_sell_${i}, @usm_bal_${i}, @usm_refid_${i})
            `);
        }

        txRequest.input('ui_cid', sql.Int, customer_id);
        txRequest.input('ui_date', sql.NVarChar, iDate);
        txRequest.input('ui_ddate', sql.NVarChar, dDate);
        txRequest.input('ui_repid', sql.Int, rep_id || null);
        txRequest.input('ui_sid', sql.Int, storeId);
        txRequest.input('ui_ptype', sql.NVarChar, pType);
        txRequest.input('ui_itype', sql.NVarChar, invoice_type || invoice.invoice_type);
        txRequest.input('ui_sub', sql.Decimal(18, 2), subtotal);
        txRequest.input('ui_damt', sql.Decimal(18, 2), disc);
        txRequest.input('ui_dpct', sql.Decimal(18, 2), discount_pct || 0);
        txRequest.input('ui_tax', sql.Decimal(18, 2), tax);
        txRequest.input('ui_grand', sql.Decimal(18, 2), grandTotal);
        txRequest.input('ui_paid', sql.Decimal(18, 2), paid);
        txRequest.input('ui_rem', sql.Decimal(18, 2), remaining);
        txRequest.input('ui_notes', sql.NVarChar, notes || '');
        txRequest.input('ui_status', sql.NVarChar, newStatus);
        
        await txRequest.query(`
            UPDATE sales_invoices SET 
            customer_id = @ui_cid, invoice_date = @ui_date, due_date = @ui_ddate, rep_id = @ui_repid, store_id = @ui_sid, payment_type = @ui_ptype, invoice_type = @ui_itype, 
            subtotal = @ui_sub, discount_amount = @ui_damt, discount_pct = @ui_dpct, tax_amount = @ui_tax, grand_total = @ui_grand, amount_paid = @ui_paid, remaining = @ui_rem, notes = @ui_notes, status = @ui_status
            WHERE id = @txInvId
        `);

        // Recreate journal entries with new values (full reverse+recreate, not delta)
        const accAR = await getSystemAccountAsync(txRequest, 'SYS_AR');
        const accSales = await getSystemAccountAsync(txRequest, 'SYS_SALES');
        const accVatOut = tax > 0 ? await getSystemAccountAsync(txRequest, 'SYS_VAT_OUTPUT') : null;
        const accCogs = await getSystemAccountAsync(txRequest, 'SYS_COGS');
        const accInv = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY');

        // 1. Accrual Entry
        const accrualLines = [
            { account_id: accAR, debit: grandTotal, credit: 0, description: `استحقاق فاتورة مبيعات ${invoice.invoice_no}` },
            { account_id: accSales, debit: 0, credit: subtotal - disc, description: `إيراد مبيعات فاتورة ${invoice.invoice_no}` }
        ];
        if (tax > 0) {
            accrualLines.push({ account_id: accVatOut, debit: 0, credit: tax, description: `ضريبة مخرجات فاتورة ${invoice.invoice_no}` });
        }
        await postJournalEntryAsync(
            txRequest, iDate, `استحقاق فاتورة مبيعات ${invoice.invoice_no}`, accrualLines,
            'sales_invoice', invoice.id, req.user ? req.user.id : null,
            { module: 'sales', action: 'create_invoice', document: invoice.invoice_no, isSystem: true }
        );

        // 2. COGS Entry
        const totalCost = items.reduce((sum, it) => sum + (it.quantity * (it.db_cost_price || 0)), 0);
        if (totalCost > 0) {
            const cogsLines = [
                { account_id: accCogs, debit: totalCost, credit: 0, description: `تكلفة البضاعة المباعة لفاتورة ${invoice.invoice_no}` },
                { account_id: accInv, debit: 0, credit: totalCost, description: `صرف مخزون لفاتورة ${invoice.invoice_no}` }
            ];
            await postJournalEntryAsync(
                txRequest, iDate, `تكلفة البضاعة لفاتورة ${invoice.invoice_no}`, cogsLines,
                'sales_invoice_cogs', invoice.id, req.user ? req.user.id : null,
                { module: 'sales', action: 'cogs', document: invoice.invoice_no, isSystem: true }
            );
        }

        await recalcCustomerBalanceAsync(txRequest, customer_id);
        if (customer_id !== invoice.customer_id) {
            await recalcCustomerBalanceAsync(txRequest, invoice.customer_id);
        }

        await transaction.commit();
        await logActivity(req, 'UPDATE', 'sales', invoice.invoice_no, `تعديل فاتورة مبيعات ${invoice.invoice_no}`, { invoice_no: invoice.invoice_no, grand_total: invoice.grand_total, subtotal: invoice.subtotal }, { invoice_no: invoice.invoice_no, grand_total: grandTotal, subtotal }, 'SUCCESS', null);
        res.json({ success: true, message: 'تم تعديل الفاتورة بنجاح', invoiceId: invoice.id, invoiceNo: invoice.invoice_no });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Sales update invoice error:', err);
        await logActivity(req, 'UPDATE', 'sales', invoice ? invoice.invoice_no : req.params.id, 'تعديل فاتورة مبيعات', null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

module.exports = router;
