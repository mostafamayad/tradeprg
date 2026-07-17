const asyncHandler = require('../utils/asyncHandler');
// ============================================================
// ROUTE: Sales Invoices
// ============================================================

const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync, recalcCustomerBalanceAsync } = require('../services/accountingEngine');
const logActivity = require('../middleware/logger');

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
// Private Helpers (isolated from helpers.js)
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

async function updateStockBalanceAsync(txRequest, storeId, productId, qtyChange) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`usb_sid_${pRand}`, sql.Int, storeId);
    txRequest.input(`usb_pid_${pRand}`, sql.Int, productId);
    txRequest.input(`usb_qty_${pRand}`, sql.Decimal(18, 4), qtyChange);

    await txRequest.query(`
        IF NOT EXISTS (SELECT 1 FROM inventory_balances WHERE store_id = @usb_sid_${pRand} AND product_id = @usb_pid_${pRand})
        BEGIN
            INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (@usb_sid_${pRand}, @usb_pid_${pRand}, 0)
        END
        UPDATE inventory_balances 
        SET quantity = quantity + @usb_qty_${pRand} 
        WHERE store_id = @usb_sid_${pRand} AND product_id = @usb_pid_${pRand}
    `);
    const balRes = await txRequest.query(`SELECT quantity FROM inventory_balances WHERE store_id = @usb_sid_${pRand} AND product_id = @usb_pid_${pRand}`);
    return balRes.recordset[0] ? balRes.recordset[0].quantity : 0;
}

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

    // Update returned_qty on each invoice item from non-cancelled returns
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

    // Compute return_status
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

        // Compute returned amount for this invoice
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



router.post('/invoices', asyncHandler(async (req, res) => {
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
            txRequest.input(`si_dpct_${i}`, sql.Decimal(18, 2), item.discount_pct || 0);
            txRequest.input(`si_linetot_${i}`, sql.Decimal(18, 2), item.line_total);

            await txRequest.query(`
                INSERT INTO sales_invoice_items (invoice_id, product_id, quantity, unit_price, cost_price, discount_pct, discount_amount, line_total) 
                VALUES (@si_iid_${i}, @si_pid_${i}, @si_qty_${i}, @si_price_${i}, @si_cost_${i}, @si_dpct_${i}, 0, @si_linetot_${i})
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
                txRequest.input('tt_transno', sql.NVarChar, transNo);
                txRequest.input('tt_date', sql.NVarChar, iDate);
                txRequest.input('tt_amt', sql.Decimal(18, 2), paid);
                txRequest.input('tt_accid', sql.Int, treasury.id);
                txRequest.input('tt_relid', sql.Int, customer_id);
                txRequest.input('tt_docno', sql.NVarChar, colNo);
                txRequest.input('tt_desc', sql.NVarChar, `تحصيل فاتورة ${invoiceNo}`);
                
                await txRequest.query(`
                    INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description) 
                    VALUES (@tt_transno, @tt_date, 'in', @tt_amt, @tt_accid, 'customer', @tt_relid, @tt_docno, @tt_desc)
                `);
                
                txRequest.input('ta_paid', sql.Decimal(18, 2), paid);
                txRequest.input('ta_accid', sql.Int, treasury.id);
                await txRequest.query(`UPDATE treasury_accounts SET current_balance = current_balance + @ta_paid WHERE id = @ta_accid`);
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
        let creditWarning = false;
        if (customer_id) {
            try {
                const pool = await getPool();
                const custRes = await pool.request()
                    .input("cw_cid", sql.Int, customer_id)
                    .query("SELECT credit_limit, current_balance FROM customers WHERE id = @cw_cid");
                if (custRes.recordset.length > 0) {
                    const cust = custRes.recordset[0];
                    if (cust.credit_limit > 0 && cust.current_balance > cust.credit_limit) {
                        creditWarning = true; var newBalance = cust.current_balance; var limit = cust.credit_limit;
                    }
                }
            } catch (cwErr) { console.error("Credit warning check failed:", cwErr); }
        }
        res.status(201).json({ success: true, message: 'تم حفظ الفاتورة بنجاح', invoiceNo, invoiceId, grandTotal, remaining, creditWarning, newBalance, creditLimit: limit });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Sales POST error:', err);
        await logActivity(req, 'CREATE', 'sales', req.body.invoice_no || null, 'إنشاء فاتورة مبيعات', null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.put('/invoices/:id/cancel', async (req, res) => {
    const invoiceId = parseInt(req.params.id);
    if (!invoiceId) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    const cancelReason = req.body.reason || '';

    let transaction;
    try {
        const pool = await getPool();

        // Pre-check outside transaction
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

        // Reverse ALL journal entries for this invoice by source_document
        txRequest.input('je_inv_no', sql.NVarChar, invoice.invoice_no);
        const jeRes = await txRequest.query(`
            SELECT id FROM journal_entries 
            WHERE source_document = @je_inv_no 
              AND (is_reversed IS NULL OR is_reversed = 0)
              AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')
        `);
        for (const je of jeRes.recordset) {
            await reverseJournalEntryAsync(txRequest, je.id, `إلغاء فاتورة مبيعات ${invoice.invoice_no}`, req.user ? req.user.id : null);
        }

        await txRequest.query(`UPDATE sales_invoices SET status = 'cancelled' WHERE id = @txInvId`);
        await recalcCustomerBalanceAsync(txRequest, invoice.customer_id);

        // Log customer activity
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
            txRequest.input('tt_transno', sql.NVarChar, transNo);
            txRequest.input('tt_date', sql.NVarChar, payDate);
            txRequest.input('tt_amt', sql.Decimal(18, 2), payAmt);
            txRequest.input('tt_accid', sql.Int, treasury.id);
            txRequest.input('tt_relid', sql.Int, invoice.customer_id);
            txRequest.input('tt_docno', sql.NVarChar, colNo);
            txRequest.input('tt_desc', sql.NVarChar, `دفعة فاتورة ${invoice.invoice_no}`);
            
            await txRequest.query(`
                INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description) 
                VALUES (@tt_transno, @tt_date, 'in', @tt_amt, @tt_accid, 'customer', @tt_relid, @tt_docno, @tt_desc)
            `);
            
            txRequest.input('ta_paid', sql.Decimal(18, 2), payAmt);
            txRequest.input('ta_accid', sql.Int, treasury.id);
            await txRequest.query(`UPDATE treasury_accounts SET current_balance = current_balance + @ta_paid WHERE id = @ta_accid`);
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

// ── Collections (Payments from Customers) ─────────────────
router.get('/collections', async (req, res) => {
    try {
        const { q, customer_id, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT cc.*, c.customer_name FROM customer_collections cc LEFT JOIN customers c ON cc.customer_id = c.id WHERE 1=1`;
        
        if (q) { sqlQuery += ` AND (cc.collection_no LIKE @q OR c.customer_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (customer_id) { sqlQuery += ` AND cc.customer_id = @customerId`; request.input('customerId', sql.Int, customer_id); }
        if (from) { sqlQuery += ` AND cc.collection_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND cc.collection_date <= @to`; request.input('to', sql.NVarChar, to); }
        
        sqlQuery += ` ORDER BY cc.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Sales collections GET error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});


// ============================================================
// Sales Returns (ERP-Standard Workflow)
// Implements:
//  1) No returns on cancelled / fully-returned invoices
//  2) Quantity guard: cannot exceed sold - already returned
//  3) Snapshot prices / discount / tax from original invoice
//  4) Mandatory return reason
//  5) Per-item product condition (saleable|damaged|expired|inspection)
//  6) Automatic store routing by condition
//  7) Stock via inventory_movements (not direct balance update)
//  8) Accounting: revenue reversal + COGS reversal (per condition)
//  9) Cost snapshot taken from sales_invoice_items (frozen)
// 10) Duplicate prevention inside transaction
// 11) User permissions: free_return / return_to_* / approve_return
// 12) Audit trail table sales_return_audit
// 13) Workflow: draft -> pending_approval -> approved | reversed
// ============================================================

// ── Permission helper (reads from JWT user.permissions) ──
function userHasPermission(req, perm) {
    if (!req.user) return false;
    if (req.user.role === 'admin') return true;
    let perms = [];
    try {
        const raw = req.user.permissions;
        perms = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
    } catch (e) { perms = []; }
    return perms.includes('*') || perms.includes(perm);
}

async function writeAuditAsync(txRequest, { return_id, action, actor, from_status, to_status, reason, metadata, client_ip, device_info }) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`au_retid_${pRand}`, sql.Int, return_id);
    txRequest.input(`au_act_${pRand}`, sql.NVarChar, action);
    txRequest.input(`au_actorid_${pRand}`, sql.Int, actor ? actor.id : null);
    txRequest.input(`au_actorun_${pRand}`, sql.NVarChar, actor ? (actor.username || actor.email || '') : null);
    txRequest.input(`au_at_${pRand}`, sql.NVarChar, new Date().toISOString());
    txRequest.input(`au_reason_${pRand}`, sql.NVarChar, reason || null);
    txRequest.input(`au_from_${pRand}`, sql.NVarChar, from_status || null);
    txRequest.input(`au_to_${pRand}`, sql.NVarChar, to_status || null);
    txRequest.input(`au_meta_${pRand}`, sql.NVarChar, metadata ? JSON.stringify(metadata) : null);
    txRequest.input(`au_ip_${pRand}`, sql.NVarChar, client_ip || null);
    txRequest.input(`au_dev_${pRand}`, sql.NVarChar, device_info || null);
    await txRequest.query(`
        INSERT INTO sales_return_audit
            (return_id, action, actor_user_id, actor_username, action_at, reason, from_status, to_status, metadata, client_ip, device_info)
        VALUES
            (@au_retid_${pRand}, @au_act_${pRand}, @au_actorid_${pRand}, @au_actorun_${pRand},
             @au_at_${pRand}, @au_reason_${pRand}, @au_from_${pRand}, @au_to_${pRand},
             @au_meta_${pRand}, @au_ip_${pRand}, @au_dev_${pRand})
    `);
}

// Find special store IDs by type (cached at request scope)
async function getSpecialStoresAsync(request) {
    const pRand = Math.random().toString(36).substring(2, 9);
    request.input(`gs_p_${pRand}`, sql.NVarChar, 'damaged');
    const damagedRes = await request.query(`SELECT id FROM stores WHERE store_type = @gs_p_${pRand}`);
    request.input(`gs_p2_${pRand}`, sql.NVarChar, 'inspection');
    const inspRes = await request.query(`SELECT id FROM stores WHERE store_type = @gs_p2_${pRand}`);
    request.input(`gs_p3_${pRand}`, sql.NVarChar, 'main');
    const mainRes = await request.query(`SELECT TOP 1 id FROM stores WHERE store_type = @gs_p3_${pRand} ORDER BY id ASC`);
    return {
        damaged: damagedRes.recordset[0] ? damagedRes.recordset[0].id : null,
        inspection: inspRes.recordset[0] ? inspRes.recordset[0].id : null,
        main: mainRes.recordset[0] ? mainRes.recordset[0].id : null
    };
}

// Map condition → destination store
function resolveDestinationStore(condition, specialStores, userMainStoreId) {
    switch (condition) {
        case 'saleable':   return userMainStoreId || specialStores.main;
        case 'damaged':    return specialStores.damaged;
        case 'expired':    return specialStores.damaged;     // منتهي الصلاحية = توالف
        case 'inspection': return specialStores.inspection;
        default:           return specialStores.inspection;
    }
}

// ── List of sales returns ────────────────────────────────
router.get('/returns', async (req, res) => {
    try {
        const { q, customer_id, invoice_id, from, to, status, workflow_status } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let filterCancelled = true;
        // For invoice history, include all returns (even cancelled/reversed)
        if (invoice_id) filterCancelled = false;
        let sqlQuery = `SELECT TOP 500 r.*, c.customer_name, s.store_name,
                              u_created.username as created_by_username,
                              u_approved.username as approved_by_username,
                              (SELECT COUNT(*) FROM sales_return_items WHERE return_id = r.id) as items_count
                   FROM sales_returns r
                   LEFT JOIN customers c ON r.customer_id = c.id
                   LEFT JOIN stores s ON r.store_id = s.id
                   LEFT JOIN users u_created ON r.created_by = u_created.id
                   LEFT JOIN users u_approved ON r.approved_by = u_approved.id`;
        if (filterCancelled) { sqlQuery += ` WHERE r.status NOT IN ('cancelled', 'deleted')`; }
        else { sqlQuery += ` WHERE 1=1`; }

        if (q)            { sqlQuery += ` AND (r.return_no LIKE @q OR c.customer_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (customer_id)  { sqlQuery += ` AND r.customer_id = @customerId`; request.input('customerId', sql.Int, customer_id); }
        if (invoice_id)   { sqlQuery += ` AND r.invoice_id = @invId`; request.input('invId', sql.Int, invoice_id); }
        if (from)         { sqlQuery += ` AND r.return_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to)           { sqlQuery += ` AND r.return_date <= @to`; request.input('to', sql.NVarChar, to); }
        if (status)       { sqlQuery += ` AND r.status = @status`; request.input('status', sql.NVarChar, status); }
        if (workflow_status) { sqlQuery += ` AND r.workflow_status = @wf`; request.input('wf', sql.NVarChar, workflow_status); }

        sqlQuery += ` ORDER BY r.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Sales returns GET error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Dashboard statistics for returns ──
router.get('/returns/dashboard', async (req, res) => {
    try {
        const pool = await getPool();
        const today = new Date().toISOString().slice(0, 10);
        const monthStart = new Date();
        monthStart.setDate(1);
        const monthStartStr = monthStart.toISOString().slice(0, 10);

        const todayRes = await pool.request()
            .input('td', sql.NVarChar, today)
            .query(`SELECT COUNT(*) as count, COALESCE(SUM(grand_total),0) as amount FROM sales_returns WHERE CAST(return_date AS DATE) = CAST(@td AS DATE) AND status NOT IN ('cancelled', 'deleted')`);

        const monthRes = await pool.request()
            .input('ms', sql.NVarChar, monthStartStr)
            .query(`SELECT COUNT(*) as count, COALESCE(SUM(grand_total),0) as amount FROM sales_returns WHERE return_date >= @ms AND status NOT IN ('cancelled', 'deleted')`);

        const topProducts = await pool.request().query(`
            SELECT TOP 10 p.product_name, SUM(sri.quantity) as qty, SUM(sri.quantity * sri.cost_price_snapshot) as cost_value
            FROM sales_return_items sri
            INNER JOIN sales_returns sr ON sr.id = sri.return_id AND sr.status NOT IN ('cancelled', 'deleted')
            INNER JOIN products p ON p.id = sri.product_id
            GROUP BY p.product_name ORDER BY SUM(sri.quantity) DESC
        `);

        const salesRes = await pool.request().query(`SELECT COALESCE(SUM(grand_total),0) as total FROM sales_invoices WHERE status NOT IN ('cancelled', 'deleted')`);
        const returnRes = await pool.request().query(`SELECT COALESCE(SUM(grand_total),0) as total FROM sales_returns WHERE status NOT IN ('cancelled', 'deleted')`);
        const totalSales = parseFloat(salesRes.recordset[0].total) || 0;
        const totalReturns = parseFloat(returnRes.recordset[0].total) || 0;
        const returnRate = totalSales > 0 ? ((totalReturns / totalSales) * 100).toFixed(2) : '0.00';

        const byCondition = await pool.request().query(`
            SELECT product_condition, COUNT(*) as count, SUM(quantity) as qty
            FROM sales_return_items sri INNER JOIN sales_returns sr ON sr.id = sri.return_id AND sr.status NOT IN ('cancelled', 'deleted')
            GROUP BY product_condition
        `);

        res.json({ success: true, data: {
            today: todayRes.recordset[0], month: monthRes.recordset[0],
            top_products: topProducts.recordset, return_rate: returnRate,
            total_sales: totalSales, total_returns: totalReturns,
            by_condition: byCondition.recordset
        } });
    } catch (err) {
        console.error('Return dashboard error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── ERP Reports for returns ──
router.get('/returns/reports', async (req, res) => {
    try {
        const { type, customer_id, product_id, rep_id, from, to, warehouse, condition, status } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let where = 'WHERE sr.status != \'cancelled\'';
        if (customer_id) { where += ' AND sr.customer_id = @cid'; request.input('cid', sql.Int, customer_id); }
        if (product_id) { where += ' AND sri.product_id = @pid'; request.input('pid', sql.Int, product_id); }
        if (rep_id) { where += ' AND sr.rep_id = @rid'; request.input('rid', sql.Int, rep_id); }
        if (from) { where += ' AND sr.return_date >= @frm'; request.input('frm', sql.NVarChar, from); }
        if (to) { where += ' AND sr.return_date <= @to'; request.input('to', sql.NVarChar, to); }
        if (warehouse) { where += ' AND sr.store_id = @wid'; request.input('wid', sql.Int, warehouse); }
        if (condition) { where += ' AND sri.product_condition = @cond'; request.input('cond', sql.NVarChar, condition); }
        if (status) { where += ' AND sr.workflow_status = @wfs'; request.input('wfs', sql.NVarChar, status); }

        let query;
        switch (type) {
            case 'by_customer':
                query = `SELECT c.id, c.customer_name, COUNT(*) as return_count, COALESCE(SUM(sr.grand_total),0) as total_amount
                    FROM sales_returns sr INNER JOIN customers c ON c.id = sr.customer_id ${where}
                    GROUP BY c.id, c.customer_name ORDER BY total_amount DESC`; break;
            case 'by_product':
                query = `SELECT p.id, p.product_name, p.product_code, SUM(sri.quantity) as total_qty,
                    COALESCE(SUM(sri.quantity * sri.cost_price_snapshot),0) as total_cost,
                    COALESCE(SUM(sri.quantity * sri.unit_price),0) as total_value
                    FROM sales_return_items sri INNER JOIN products p ON p.id = sri.product_id
                    INNER JOIN sales_returns sr ON sr.id = sri.return_id ${where}
                    GROUP BY p.id, p.product_name, p.product_code ORDER BY total_qty DESC`; break;
            case 'by_rep':
                query = `SELECT sr.rep_id, r.rep_name, COUNT(*) as return_count, COALESCE(SUM(sr.grand_total),0) as total_amount
                    FROM sales_returns sr LEFT JOIN sales_reps r ON r.id = sr.rep_id ${where}
                    GROUP BY sr.rep_id, r.rep_name ORDER BY total_amount DESC`; break;
            case 'by_date':
                query = `SELECT sr.return_date, COUNT(*) as return_count, COALESCE(SUM(sr.grand_total),0) as total_amount
                    FROM sales_returns sr ${where}
                    GROUP BY sr.return_date ORDER BY sr.return_date DESC`; break;
            default:
                query = `SELECT sr.id, sr.return_no, sr.return_date, sr.grand_total, sr.workflow_status,
                    c.customer_name, COALESCE(sri_sum.qty,0) as items_count
                    FROM sales_returns sr
                    LEFT JOIN customers c ON c.id = sr.customer_id
                    LEFT JOIN (SELECT return_id, SUM(quantity) as qty FROM sales_return_items GROUP BY return_id) sri_sum ON sri_sum.return_id = sr.id
                    ${where} ORDER BY sr.id DESC`; break;
        }
        const r = await request.query(query);
        res.json({ success: true, data: r.recordset, type: type || 'detail' });
    } catch (err) {
        console.error('Return reports error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Get single return with items + audit trail ───────────
router.get('/returns/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('rid', sql.Int, req.params.id);

        const rRes = await request.query(`
            SELECT r.*, c.customer_name, c.phone as customer_phone, c.address,
                   s.store_name,
                   u_created.username as created_by_username,
                   u_approved.username as approved_by_username
            FROM sales_returns r
            LEFT JOIN customers c ON r.customer_id = c.id
            LEFT JOIN stores s ON r.store_id = s.id
            LEFT JOIN users u_created ON r.created_by = u_created.id
            LEFT JOIN users u_approved ON r.approved_by = u_approved.id
            WHERE r.id = @rid
        `);
        const ret = rRes.recordset[0];
        if (!ret) return res.status(404).json({ success: false, message: 'المرتجع غير موجود' });

        const itemsRes = await request.query(`
            SELECT sri.*, p.product_name, p.product_code, p.unit_name,
                   ds.store_name as destination_store_name
            FROM sales_return_items sri
            LEFT JOIN products p ON sri.product_id = p.id
            LEFT JOIN stores ds ON sri.destination_store_id = ds.id
            WHERE sri.return_id = @rid
        `);

        const auditRes = await request.query(`
            SELECT * FROM sales_return_audit WHERE return_id = @rid ORDER BY id ASC
        `);

        res.json({ success: true, data: { ...ret, items: itemsRes.recordset, audit: auditRes.recordset } });
    } catch (err) {
        console.error('Sales return GET:id error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Standard return reasons (dropdown source) ────────────
router.get('/returns/reasons/list', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT code, label_ar FROM return_reasons WHERE is_active = 1 ORDER BY code
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        logDetailedError('Sales Return Reasons', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب أسباب المرتجع', error_detail: err.message });
    }
});

// ── Available qty per invoice item (UI helper) ───────────
router.get('/returns/available-qty/:invoiceId', async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('iid', sql.Int, req.params.invoiceId);

        const r = await request.query(`
            SELECT ii.id as invoice_item_id, ii.product_id, p.product_name, p.product_code, p.barcode, p.unit_name,
                   ii.quantity as sold_qty, ii.unit_price, ii.discount_pct, ii.tax_pct, ii.cost_price,
                   ISNULL((
                       SELECT SUM(sri.quantity)
                       FROM sales_return_items sri
                       INNER JOIN sales_returns sr ON sr.id = sri.return_id
                       WHERE sr.invoice_id = @iid AND sr.status NOT IN ('cancelled', 'deleted') AND sri.product_id = ii.product_id
                   ), 0) as already_returned,
                   (ii.quantity - ISNULL((
                       SELECT SUM(sri.quantity)
                       FROM sales_return_items sri
                       INNER JOIN sales_returns sr ON sr.id = sri.return_id
                       WHERE sr.invoice_id = @iid AND sr.status NOT IN ('cancelled', 'deleted') AND sri.product_id = ii.product_id
                   ), 0)) as remaining_returnable
            FROM sales_invoice_items ii
            LEFT JOIN products p ON ii.product_id = p.id
            WHERE ii.invoice_id = @iid
            ORDER BY ii.id
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        console.error('Available qty error:', err);
res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});
// ── Create sales return (full ERP workflow) ──────────────
router.post('/returns', asyncHandler(async (req, res) => {
    const {
        customer_id, invoice_id, return_date, store_id,
        return_reason, reason_code, notes,
        items, workflow_status, client_ip, device_info,
        is_free_return
    } = req.body;

    // ── Basic validation ──
    if (!customer_id) {
        await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'العميل مطلوب');
        return res.status(400).json({ success: false, message: 'العميل مطلوب' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
        await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'لا توجد أصناف');
        return res.status(400).json({ success: false, message: 'لا توجد أصناف في المرتجع' });
    }
    if (!reason_code && !return_reason) {
        await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'سبب المرتجع إلزامي');
        return res.status(400).json({ success: false, message: 'سبب المرتجع إلزامي' });
    }

    // Free-return (without invoice) requires explicit permission
    if (!invoice_id && !is_free_return) {
        await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'يجب تحديد رقم الفاتورة');
        return res.status(400).json({ success: false, message: 'يجب تحديد رقم الفاتورة، أو طلب صلاحية المرتجع الحر' });
    }
    if (!invoice_id && is_free_return && !userHasPermission(req, 'sales.free_return')) {
        await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'لا توجد صلاحية');
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية إنشاء مرتجع بدون فاتورة' });
    }

    // Validate per-item mandatory fields
    for (const it of items) {
        if (!it.product_id) {
            await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'product_id مطلوب');
            return res.status(400).json({ success: false, message: 'كل صنف يجب أن يحتوي على product_id' });
        }
        if (!it.quantity || it.quantity <= 0) {
            await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'الكمية يجب أن تكون أكبر من صفر');
            return res.status(400).json({ success: false, message: 'الكمية يجب أن تكون أكبر من صفر' });
        }
        if (!it.product_condition || !['saleable', 'damaged', 'expired', 'inspection'].includes(it.product_condition)) {
            await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'حالة المنتج غير صالحة');
            return res.status(400).json({ success: false, message: 'حالة المنتج إلزامية (saleable|damaged|expired|inspection)' });
        }
        if (!it.reason_code && !it.reason_notes) {
            await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'سبب المرتجع لكل صنف إلزامي');
            return res.status(400).json({ success: false, message: 'سبب المرتجع لكل صنف إلزامي' });
        }
    }

    let transaction;
    try {
        const pool = await getPool();
        const specialStores = await getSpecialStoresAsync(pool.request());

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // ── Rule 1: invoice must exist + not cancelled ──
        let invoice = null;
        let invoiceItemMap = {};
        if (invoice_id) {
            const txRequest1 = transaction.request();
            txRequest1.input('srt_invid', sql.Int, invoice_id);
            const invRes = await txRequest1.query(`SELECT id, customer_id, status, payment_type FROM sales_invoices WHERE id = @srt_invid`);
            invoice = invRes.recordset[0];
            if (!invoice) {
                await transaction.rollback();
                await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'الفاتورة غير موجودة');
                return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
            }
            if (invoice.status === 'cancelled') {
                await transaction.rollback();
                await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'فاتورة ملغاة');
                return res.status(400).json({ success: false, message: 'لا يمكن إنشاء مرتجع لفاتورة ملغاة' });
            }
            // Rule 7 removed: per-item remaining_qty validation handles multiple returns
            if (String(invoice.customer_id) !== String(customer_id)) {
                await transaction.rollback();
                await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'العميل لا يطابق الفاتورة');
                return res.status(400).json({ success: false, message: 'العميل لا يطابق عميل الفاتورة' });
            }

            // ── Rule 2: snapshot original items + per-product guard ──
            const origItemsRes = await txRequest1.query(`
                SELECT id, product_id, quantity, unit_price, discount_pct, tax_pct, cost_price
                FROM sales_invoice_items WHERE invoice_id = @srt_invid
            `);
            for (const row of origItemsRes.recordset) {
                invoiceItemMap[row.product_id] = row;
            }

            const prevReturnsRes = await txRequest1.query(`
                SELECT sri.product_id, SUM(sri.quantity) as returned
                FROM sales_return_items sri
                INNER JOIN sales_returns sr ON sr.id = sri.return_id
                WHERE sr.invoice_id = @srt_invid AND sr.status NOT IN ('cancelled', 'deleted')
                GROUP BY sri.product_id
            `);
            const prevMap = {};
            for (const row of prevReturnsRes.recordset) prevMap[row.product_id] = parseFloat(row.returned) || 0;

            // Rule 10: duplicate prevention inside transaction
            // (additional safety: validate each return item hasn't been fully returned already at invoice-item level)
            for (const it of items) {
                const orig = invoiceItemMap[it.product_id];
                if (!orig) {
                    await transaction.rollback();
                    await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', `الصنف #${it.product_id} غير موجود`);
                    return res.status(400).json({ success: false, message: `الصنف #${it.product_id} غير موجود في الفاتورة الأصلية` });
                }
                const sold = parseFloat(orig.quantity) || 0;
                const prev = prevMap[it.product_id] || 0;
                const remaining = sold - prev;
                if (parseFloat(it.quantity) > remaining + 0.0001) {
                    await transaction.rollback();
                    await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', `الكمية تتجاوز المتاح للإرجاع للصنف #${it.product_id}`);
                    return res.status(400).json({
                        success: false,
                        message: `الصنف "${orig.product_name || it.product_id}": المباع ${sold}، المُرجع سابقاً ${prev}، المتاح للإرجاع ${remaining}`
                    });
                }
            }
        }

        // ── Rule 3: snapshot prices from original (anti-tampering) ──
        // The client may send unit_price/discount_pct/tax_pct/cost_price,
        // but we ALWAYS override them with values from the original sales_invoice_items.
        let subtotal = 0, totalTax = 0, totalDiscount = 0;
        const enrichedItems = items.map(it => {
            let snapUnit = parseFloat(it.unit_price) || 0;
            let snapDiscountPct = parseFloat(it.discount_pct) || 0;
            let snapTaxPct = parseFloat(it.tax_pct) || 0;
            let snapCost = parseFloat(it.cost_price) || 0;
            let origInvoiceItemId = null;
            if (invoice_id) {
                const orig = invoiceItemMap[it.product_id];
                if (orig) {
                    snapUnit = parseFloat(orig.unit_price) || 0;
                    snapDiscountPct = parseFloat(orig.discount_pct) || 0;
                    snapTaxPct = parseFloat(orig.tax_pct) || 0;
                    snapCost = parseFloat(orig.cost_price) || 0;
                    origInvoiceItemId = orig.id;
                }
            }
            const qty = parseFloat(it.quantity);
            const gross = qty * snapUnit;
            const discAmount = gross * (snapDiscountPct / 100);
            const net = gross - discAmount;
            const taxAmount = net * (snapTaxPct / 100);
            subtotal += net;
            totalDiscount += discAmount;
            totalTax += taxAmount;
            return {
                ...it,
                unit_price: snapUnit,
                discount_pct: snapDiscountPct,
                tax_pct: snapTaxPct,
                cost_price_snapshot: snapCost,
                discount_amount_snapshot: discAmount,
                tax_amount_snapshot: taxAmount,
                original_invoice_item_id: origInvoiceItemId
            };
        });
        const grandTotal = subtotal + totalTax;

        // ── Credit limit check: warn if return creates credit beyond limit ──
        if (customer_id && grandTotal > 0) {
            try {
                const clReq = transaction.request();
                const clRand = Math.random().toString(36).substring(2, 7);
                clReq.input(`cl_cid_${clRand}`, sql.Int, customer_id);
                const custRes = await clReq.query(`SELECT current_balance, credit_limit FROM customers WHERE id = @cl_cid_${clRand}`);
                if (custRes.recordset[0]) {
                    const curBal = parseFloat(custRes.recordset[0].current_balance) || 0;
                    const credLim = parseFloat(custRes.recordset[0].credit_limit) || 0;
                    const projectedBal = curBal - grandTotal;
                    if (credLim > 0 && projectedBal < -credLim) {
                        console.warn(`Credit limit warning: Customer ${customer_id} projected balance ${projectedBal} exceeds negative credit limit ${-credLim}`);
                    }
                }
            } catch (e) { /* non-blocking warning check */ }
        }

        // ── Rule 5/6: resolve destination store per item condition ──
        const userMainStore = store_id || specialStores.main;
        for (const ei of enrichedItems) {
            ei.destination_store_id = resolveDestinationStore(ei.product_condition, specialStores, userMainStore);
            if (!ei.destination_store_id) {
                await transaction.rollback();
                await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', 'مخزن وجهة غير موجود');
                return res.status(500).json({
                    success: false,
                    message: `لم يتم العثور على مخزن وجهة لحالة "${ei.product_condition}". تأكد من إنشاء مخزن الفحص/التوالف.`
                });
            }
        }

        const retNo = await nextDocNoAsync(transaction.request(), 'sales_returns');
        const rDate = return_date || new Date().toISOString().slice(0, 10);
        const wfStatus = ['draft', 'pending_approval', 'approved', 'reversed'].includes(workflow_status)
            ? workflow_status
            : (enrichedItems.some(i => i.product_condition === 'inspection') ? 'pending_approval' : 'approved');

        // ── Insert return header ──
        const hdrReq = transaction.request();
        hdrReq.input('srt_retNo', sql.NVarChar, retNo);
        hdrReq.input('srt_invId', sql.Int, invoice_id || null);
        hdrReq.input('srt_customerId', sql.Int, customer_id);
        hdrReq.input('srt_rDate', sql.NVarChar, rDate);
        hdrReq.input('srt_storeId', sql.Int, userMainStore);
        hdrReq.input('srt_subtotal', sql.Decimal(18, 4), subtotal);
        hdrReq.input('srt_disc', sql.Decimal(18, 4), totalDiscount);
        hdrReq.input('srt_tax', sql.Decimal(18, 4), totalTax);
        hdrReq.input('srt_total', sql.Decimal(18, 4), grandTotal);
        hdrReq.input('srt_reason', sql.NVarChar, return_reason || reason_code || '');
        hdrReq.input('srt_reasonCode', sql.NVarChar, reason_code || null);
        hdrReq.input('srt_notes', sql.NVarChar, notes || '');
        hdrReq.input('srt_status', sql.NVarChar, 'posted');
        hdrReq.input('srt_wf', sql.NVarChar, wfStatus);
        hdrReq.input('srt_createdBy', sql.Int, req.user ? req.user.id : null);
        hdrReq.input('srt_approvedBy', sql.Int, wfStatus === 'approved' && req.user ? req.user.id : null);
        hdrReq.input('srt_approvedAt', sql.NVarChar, wfStatus === 'approved' ? new Date().toISOString() : null);
        hdrReq.input('srt_isFree', sql.Bit, !invoice_id ? 1 : 0);
        hdrReq.input('srt_ip', sql.NVarChar, client_ip || req.ip || '');
        hdrReq.input('srt_dev', sql.NVarChar, (device_info || req.headers['user-agent'] || '').substring(0, 250));
        const retInsert = await hdrReq.query(`
                INSERT INTO sales_returns
                  (return_no, invoice_id, customer_id, return_date, store_id,
                   subtotal, discount_amount, tax_amount, grand_total,
                   return_reason, reason_code, notes, status, workflow_status,
                   created_by, approved_by, approved_at,
                   is_free_return, client_ip, device_info)
                OUTPUT INSERTED.id
                VALUES
                  (@srt_retNo, @srt_invId, @srt_customerId, @srt_rDate, @srt_storeId,
                   @srt_subtotal, @srt_disc, @srt_tax, @srt_total,
                   @srt_reason, @srt_reasonCode, @srt_notes, @srt_status, @srt_wf,
                   @srt_createdBy, @srt_approvedBy, @srt_approvedAt,
                   @srt_isFree, @srt_ip, @srt_dev)
            `);
        const returnId = retInsert.recordset[0].id;

        // ── Insert return items + stock movement + balance update ──
        // Rule 7: stock via inventory_movements + balance update
        for (let i = 0; i < enrichedItems.length; i++) {
            const ei = enrichedItems[i];
            const lineTotal = (ei.quantity * ei.unit_price) - ei.discount_amount_snapshot + ei.tax_amount_snapshot;

            const itReq = transaction.request();
            itReq.input(`sri_retid`, sql.Int, returnId);
            itReq.input(`sri_pid`, sql.Int, ei.product_id);
            itReq.input(`sri_qty`, sql.Decimal(18, 4), ei.quantity);
            itReq.input(`sri_price`, sql.Decimal(18, 4), ei.unit_price);
            itReq.input(`sri_linetot`, sql.Decimal(18, 4), lineTotal);
            itReq.input(`sri_orig`, sql.Int, ei.original_invoice_item_id);
            itReq.input(`sri_cost`, sql.Decimal(18, 4), ei.cost_price_snapshot);
            itReq.input(`sri_discP`, sql.Decimal(18, 4), ei.discount_pct);
            itReq.input(`sri_discA`, sql.Decimal(18, 4), ei.discount_amount_snapshot);
            itReq.input(`sri_taxP`, sql.Decimal(18, 4), ei.tax_pct);
            itReq.input(`sri_taxA`, sql.Decimal(18, 4), ei.tax_amount_snapshot);
            itReq.input(`sri_cond`, sql.NVarChar, ei.product_condition);
            itReq.input(`sri_dest`, sql.Int, ei.destination_store_id);
            itReq.input(`sri_rCode`, sql.NVarChar, ei.reason_code || reason_code || null);
            itReq.input(`sri_rNotes`, sql.NVarChar, ei.reason_notes || '');

            await itReq.query(`
                INSERT INTO sales_return_items
                  (return_id, product_id, quantity, unit_price, line_total,
                   original_invoice_item_id, cost_price_snapshot,
                   discount_pct_snapshot, discount_amount_snapshot,
                   tax_pct_snapshot, tax_amount_snapshot,
                   product_condition, destination_store_id, reason_code, reason_notes)
                VALUES
                  (@sri_retid, @sri_pid, @sri_qty, @sri_price, @sri_linetot,
                   @sri_orig, @sri_cost,
                   @sri_discP, @sri_discA,
                   @sri_taxP, @sri_taxA,
                   @sri_cond, @sri_dest, @sri_rCode, @sri_rNotes)
            `);

            // Only update stock balance if approved (inspection items wait for approval)
            if (wfStatus === 'approved') {
                const balanceAfter = await updateStockBalanceAsync(
                    transaction.request(), ei.destination_store_id, ei.product_id, +ei.quantity
                );

                // inventory_movements audit
                const smReq = transaction.request();
                smReq.input(`sm_date`, sql.NVarChar, rDate);
                smReq.input(`sm_docno`, sql.NVarChar, retNo);
                smReq.input(`sm_sid`, sql.Int, ei.destination_store_id);
                smReq.input(`sm_pid`, sql.Int, ei.product_id);
                smReq.input(`sm_qtyin`, sql.Decimal(18, 4), ei.quantity);
                smReq.input(`sm_cost`, sql.Decimal(18, 4), ei.cost_price_snapshot);
                smReq.input(`sm_sell`, sql.Decimal(18, 4), ei.unit_price);
                smReq.input(`sm_bal`, sql.Decimal(18, 4), balanceAfter);
                smReq.input(`sm_refid`, sql.Int, returnId);
                smReq.input(`sm_cond`, sql.NVarChar, ei.product_condition);

                await smReq.query(`
                    INSERT INTO stock_movements
                      (move_date, move_type, document_no, store_id, product_id,
                       qty_in, cost_price, sell_price, balance_after, reference_id, notes)
                    VALUES
                      (@sm_date, 'return_in', @sm_docno, @sm_sid, @sm_pid,
                       @sm_qtyin, @sm_cost, @sm_sell, @sm_bal, @sm_refid,
                       @sm_cond)
                `);
            }
        }

        // ── Rule 8: accounting entries ──
        if (wfStatus === 'approved' && grandTotal > 0) {
            const accAR = await getSystemAccountAsync(transaction.request(), 'SYS_AR');
            const accSalesReturn = await getSystemAccountAsync(transaction.request(), 'SYS_SALES_RETURNS');
            const accCogs = await getSystemAccountAsync(transaction.request(), 'SYS_COGS');
            const accInv = await getSystemAccountAsync(transaction.request(), 'SYS_INVENTORY');
            const accDamagedInv = await getSystemAccountAsync(transaction.request(), 'SYS_DAMAGED_INVENTORY');

            // Fetch VAT Output account (may not exist if no tax is used)
            let accVatOutput = null;
            try { accVatOutput = await getSystemAccountAsync(transaction.request(), 'SYS_VAT_OUTPUT'); } catch (e) { /* no VAT account configured */ }

            // Revenue reversal: Debit Sales Returns (contra-revenue), Debit VAT Output (reverse tax liability), Credit AR (reduce customer debt)
            const reversalLines = [
                { account_id: accSalesReturn, debit: subtotal, credit: 0, description: `مردودات مبيعات للفاتورة ${invoice_id ? '#' + invoice_id : 'بدون فاتورة'}` },
                { account_id: accAR, debit: 0, credit: grandTotal, description: `تخفيض مديونية العميل` }
            ];
            if (totalTax > 0 && accVatOutput) {
                reversalLines.splice(1, 0, { account_id: accVatOutput, debit: totalTax, credit: 0, description: `عكس ضريبة مخرجات` });
            } else if (totalTax > 0) {
                reversalLines.splice(1, 0, { account_id: accAR, debit: totalTax, credit: 0, description: `ضريبة مردودات` });
            }
            await postJournalEntryAsync(
                transaction.request(), rDate, `مردودات مبيعات ${retNo}`,
                reversalLines,
                'sales_return', returnId, req.user ? req.user.id : null,
                { module: 'sales_returns', action: 'create_return', document: retNo, isSystem: true }
            );

            // COGS reversal split by condition
            let saleableCost = 0, damagedCost = 0;
            for (const ei of enrichedItems) {
                const c = (ei.cost_price_snapshot || 0) * ei.quantity;
                if (ei.product_condition === 'saleable') saleableCost += c;
                else if (ei.product_condition === 'damaged' || ei.product_condition === 'expired') damagedCost += c;
                // inspection items: no COGS reversal yet — wait for approval
            }

            // Saleable → Main inventory
            if (saleableCost > 0) {
                await postJournalEntryAsync(
                    transaction.request(), rDate, `استرداد مخزون قابل للبيع ${retNo}`,
                    [
                        { account_id: accInv, debit: saleableCost, credit: 0, description: 'استرداد مخزون قابل للبيع' },
                        { account_id: accCogs, debit: 0, credit: saleableCost, description: 'عكس تكلفة بضاعة مباعة' }
                    ],
                    'sales_return_cogs_saleable', returnId, req.user ? req.user.id : null,
                    { module: 'sales_returns', action: 'cogs_saleable', document: retNo, isSystem: true }
                );
            }
            // Damaged → Damaged inventory (NOT main)
            if (damagedCost > 0) {
                const acc = accDamagedInv || accInv;
                await postJournalEntryAsync(
                    transaction.request(), rDate, `تحويل لمخزن التوالف ${retNo}`,
                    [
                        { account_id: acc, debit: damagedCost, credit: 0, description: 'بضاعة تالفة / منتهية' },
                        { account_id: accCogs, debit: 0, credit: damagedCost, description: 'عكس تكلفة بضاعة (توالف)' }
                    ],
                    'sales_return_cogs_damaged', returnId, req.user ? req.user.id : null,
                    { module: 'sales_returns', action: 'cogs_damaged', document: retNo, isSystem: true }
                );
            }
            // Inspection: NO accounting entry yet — COGS reversal and inventory update happen on approval
        }

        if (invoice_id) {
            await updateInvoiceStatusAsync(transaction.request(), invoice_id);
            await updateInvoiceReturnStatusAsync(transaction.request(), invoice_id);
        }
        await recalcCustomerBalanceAsync(transaction.request(), customer_id);

        // ── Rule 12: audit trail ──
        await writeAuditAsync(transaction.request(), {
            return_id: returnId,
            action: 'created',
            actor: req.user,
            from_status: null,
            to_status: wfStatus,
            reason: return_reason || reason_code,
            metadata: { items: enrichedItems.length, grand_total: grandTotal },
            client_ip: client_ip || req.ip,
            device_info: device_info || req.headers['user-agent']
        });
        if (wfStatus === 'approved') {
            await writeAuditAsync(transaction.request(), {
                return_id: returnId,
                action: 'approved',
                actor: req.user,
                from_status: 'draft',
                to_status: 'approved',
                reason: 'auto-approved on create',
                metadata: null,
                client_ip: client_ip || req.ip,
                device_info: device_info || req.headers['user-agent']
            });
        }

        // Log customer activity
        if (customer_id) {
            const pLog = Math.random().toString(36).substring(2, 9);
            const logReq = transaction.request();
            logReq.input(`cal_cid_${pLog}`, sql.Int, customer_id);
            logReq.input(`cal_type_${pLog}`, sql.NVarChar, 'return_created');
            logReq.input(`cal_desc_${pLog}`, sql.NVarChar, `تم تسجيل مرتجع ${retNo} بقيمة ${grandTotal}`);
            logReq.input(`cal_rt_${pLog}`, sql.NVarChar, 'sales_return');
            logReq.input(`cal_ri_${pLog}`, sql.Int, returnId);
            logReq.input(`cal_rn_${pLog}`, sql.NVarChar, retNo);
            logReq.input(`cal_amt_${pLog}`, sql.Decimal(18,4), grandTotal || 0);
            logReq.input(`cal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
            await logReq.query(`
                INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                VALUES (@cal_cid_${pLog}, @cal_type_${pLog}, @cal_desc_${pLog}, @cal_rt_${pLog}, @cal_ri_${pLog}, @cal_rn_${pLog}, @cal_amt_${pLog}, @cal_uid_${pLog})
            `);
        }

        await transaction.commit();
        await logActivity(req, 'CREATE', 'sales_returns', retNo, `مرتجع مبيعات ${retNo}`, null, { return_no: retNo, customer_id, invoice_id, grand_total: grandTotal, items_count: enrichedItems.length, workflow_status: wfStatus }, 'SUCCESS', null);

        try {
            const commissionEmitter = require('../services/commission/emitter');
            let returnRepId = null;
            let returnInvoiceNo = null;
            if (invoice_id) {
                const invResult = await pool.request().input('iid', sql.Int, invoice_id).query('SELECT rep_id, invoice_no FROM sales_invoices WHERE id = @iid');
                if (invResult.recordset.length > 0) {
                    returnRepId = invResult.recordset[0].rep_id;
                    returnInvoiceNo = invResult.recordset[0].invoice_no;
                }
            }
            commissionEmitter.emit('return.posted', {
                returnData: { id: returnId, invoice_id, invoice_no: returnInvoiceNo, grand_total: grandTotal },
                repId: returnRepId
            });
        } catch (e) {
            console.warn('[Commission] Emit return failed:', e.message);
        }

        res.status(201).json({
            success: true,
            message: wfStatus === 'pending_approval'
                ? 'تم تسجيل طلب المرتجع وبانتظار الاعتماد'
                : 'تم تسجيل المرتجع واعتماده',
            id: returnId,
            workflow_status: wfStatus
        });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logDetailedError('Sales Returns POST', err);
        await logActivity(req, 'CREATE', 'sales_returns', null, 'إنشاء مرتجع مبيعات', null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'خطأ في حفظ مرتجع المبيعات', error_detail: err.message });
    }
}));

// ── Approve a pending return (Rule: inspection→saleable/damaged) ──
router.post('/returns/:id/approve', async (req, res) => {
    const returnId = parseInt(req.params.id);
    if (!returnId) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });

    if (!userHasPermission(req, 'sales.approve_return')) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية اعتماد المرتجعات' });
    }

    let transaction;
    try {
        const pool = await getPool();
        const specialStores = await getSpecialStoresAsync(pool.request());

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        txRequest.input('ap_rid', sql.Int, returnId);
        const rRes = await txRequest.query(`SELECT * FROM sales_returns WHERE id = @ap_rid`);
        const ret = rRes.recordset[0];
        if (!ret) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'المرتجع غير موجود' });
        }
        if (ret.workflow_status === 'approved') {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'المرتجع معتمد مسبقاً' });
        }
        if (ret.workflow_status === 'reversed') {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'لا يمكن اعتماد مرتجع معكوس' });
        }
        if (ret.status === 'cancelled') {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'لا يمكن اعتماد مرتجع ملغي' });
        }

        const itemsRes = await txRequest.query(`
            SELECT * FROM sales_return_items WHERE return_id = @ap_rid
        `);
        const items = itemsRes.recordset;
        const rDate = ret.return_date;

        // For each item still in inspection: route to its current destination
        // (which was already set at creation). For items approved as-is, just create stock movements.
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const destStoreId = it.destination_store_id || specialStores.inspection || ret.store_id;

            // Update stock balance
            const balanceAfter = await updateStockBalanceAsync(txRequest, destStoreId, it.product_id, +it.quantity);

            txRequest.input(`ap_sm_date_${i}`, sql.NVarChar, rDate);
            txRequest.input(`ap_sm_doc_${i}`, sql.NVarChar, ret.return_no);
            txRequest.input(`ap_sm_sid_${i}`, sql.Int, destStoreId);
            txRequest.input(`ap_sm_pid_${i}`, sql.Int, it.product_id);
            txRequest.input(`ap_sm_qin_${i}`, sql.Decimal(18, 4), it.quantity);
            txRequest.input(`ap_sm_cost_${i}`, sql.Decimal(18, 4), it.cost_price_snapshot || 0);
            txRequest.input(`ap_sm_sell_${i}`, sql.Decimal(18, 4), it.unit_price);
            txRequest.input(`ap_sm_bal_${i}`, sql.Decimal(18, 4), balanceAfter);
            txRequest.input(`ap_sm_refid_${i}`, sql.Int, returnId);
            txRequest.input(`ap_sm_cond_${i}`, sql.NVarChar, it.product_condition);

            await txRequest.query(`
                INSERT INTO stock_movements
                  (move_date, move_type, document_no, store_id, product_id,
                   qty_in, cost_price, sell_price, balance_after, reference_id, notes)
                VALUES
                  (@ap_sm_date_${i}, 'return_in_approved', @ap_sm_doc_${i}, @ap_sm_sid_${i}, @ap_sm_pid_${i},
                   @ap_sm_qin_${i}, @ap_sm_cost_${i}, @ap_sm_sell_${i}, @ap_sm_bal_${i}, @ap_sm_refid_${i},
                   @ap_sm_cond_${i})
            `);
        }

        // ── Accounting entries (only if not already posted) ──
        const existingEntries = await txRequest.query(`
            SELECT COUNT(*) as cnt FROM journal_entries
            WHERE reference_type = 'sales_return' AND reference_id = @ap_rid
        `);
        if (existingEntries.recordset[0].cnt === 0 && parseFloat(ret.grand_total) > 0) {
            const accAR = await getSystemAccountAsync(transaction.request(), 'SYS_AR');
            const accSalesReturn = await getSystemAccountAsync(transaction.request(), 'SYS_SALES_RETURNS');
            const accCogs = await getSystemAccountAsync(transaction.request(), 'SYS_COGS');
            const accInv = await getSystemAccountAsync(transaction.request(), 'SYS_INVENTORY');
            const accDamagedInv = await getSystemAccountAsync(transaction.request(), 'SYS_DAMAGED_INVENTORY');
            let accVatOutput = null;
            try { accVatOutput = await getSystemAccountAsync(transaction.request(), 'SYS_VAT_OUTPUT'); } catch (e) {}

            const apSubtotal = parseFloat(ret.subtotal) || 0;
            const apTax = parseFloat(ret.tax_amount) || 0;

            // Revenue reversal
            const reversalLines = [
                { account_id: accSalesReturn, debit: apSubtotal, credit: 0, description: `مردودات مبيعات ${ret.return_no}` },
                { account_id: accAR, debit: 0, credit: ret.grand_total, description: `تخفيض مديونية العميل` }
            ];
            if (apTax > 0 && accVatOutput) {
                reversalLines.splice(1, 0, { account_id: accVatOutput, debit: apTax, credit: 0, description: `عكس ضريبة مخرجات` });
            } else if (apTax > 0) {
                reversalLines.splice(1, 0, { account_id: accAR, debit: apTax, credit: 0, description: `ضريبة مردودات` });
            }
            await postJournalEntryAsync(
                transaction.request(), rDate, `مردودات مبيعات ${ret.return_no}`,
                reversalLines,
                'sales_return', returnId, req.user ? req.user.id : null,
                { module: 'sales_returns', action: 'create_return', document: ret.return_no, isSystem: true }
            );

            // COGS reversal split by condition
            let saleableCost = 0, damagedCost = 0;
            for (const it of items) {
                const c = (parseFloat(it.cost_price_snapshot) || 0) * parseFloat(it.quantity);
                if (it.product_condition === 'saleable' || it.product_condition === 'inspection') saleableCost += c;
                else if (it.product_condition === 'damaged' || it.product_condition === 'expired') damagedCost += c;
            }

            if (saleableCost > 0) {
                await postJournalEntryAsync(
                    transaction.request(), rDate, `استرداد مخزون قابل للبيع ${ret.return_no}`,
                    [
                        { account_id: accInv, debit: saleableCost, credit: 0, description: 'استرداد مخزون قابل للبيع' },
                        { account_id: accCogs, debit: 0, credit: saleableCost, description: 'عكس تكلفة بضاعة مباعة' }
                    ],
                    'sales_return_cogs_saleable', returnId, req.user ? req.user.id : null,
                    { module: 'sales_returns', action: 'cogs_saleable', document: ret.return_no, isSystem: true }
                );
            }
            if (damagedCost > 0) {
                const acc = accDamagedInv || accInv;
                await postJournalEntryAsync(
                    transaction.request(), rDate, `تحويل لمخزن التوالف ${ret.return_no}`,
                    [
                        { account_id: acc, debit: damagedCost, credit: 0, description: 'بضاعة تالفة / منتهية' },
                        { account_id: accCogs, debit: 0, credit: damagedCost, description: 'عكس تكلفة بضاعة (توالف)' }
                    ],
                    'sales_return_cogs_damaged', returnId, req.user ? req.user.id : null,
                    { module: 'sales_returns', action: 'cogs_damaged', document: ret.return_no, isSystem: true }
                );
            }
        }

        // Flip workflow_status → approved
        txRequest.input('ap_approvedBy', sql.Int, req.user.id);
        txRequest.input('ap_approvedAt', sql.NVarChar, new Date().toISOString());
        await txRequest.query(`
            UPDATE sales_returns
            SET workflow_status='approved', approved_by=@ap_approvedBy, approved_at=@ap_approvedAt
            WHERE id=@ap_rid
        `);

        await writeAuditAsync(txRequest, {
            return_id: returnId,
            action: 'approved',
            actor: req.user,
            from_status: ret.workflow_status,
            to_status: 'approved',
            reason: null,
            metadata: null,
            client_ip: req.ip,
            device_info: req.headers['user-agent']
        });

        if (ret.invoice_id) {
            await updateInvoiceStatusAsync(txRequest, ret.invoice_id);
            await updateInvoiceReturnStatusAsync(txRequest, ret.invoice_id);
        }
        await recalcCustomerBalanceAsync(txRequest, ret.customer_id);

        await transaction.commit();
        res.json({ success: true, message: 'تم اعتماد المرتجع وإضافة المخزون' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Approve return error:', err);
res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message });
    }
});
// ── Reverse an existing return (Rule 12: never delete) ───
router.post('/returns/:id/reverse', asyncHandler(async (req, res) => {
    const returnId = parseInt(req.params.id);
    if (!returnId) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });

    if (!userHasPermission(req, 'sales.approve_return')) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية عكس المرتجعات' });
    }

    const reason = (req.body && req.body.reason) || 'عكس مرتجع';

    let transaction;
    try {
        const pool = await getPool();

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        txRequest.input('rv_rid', sql.Int, returnId);
        const rRes = await txRequest.query(`SELECT * FROM sales_returns WHERE id = @rv_rid`);
        const original = rRes.recordset[0];
        if (!original) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'المرتجع غير موجود' });
        }
        if (original.workflow_status === 'reversed') {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'المرتجع معكوس مسبقاً' });
        }
        if (original.status === 'cancelled') {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'المرتجع ملغي' });
        }

        const itemsRes = await txRequest.query(`SELECT * FROM sales_return_items WHERE return_id = @rv_rid`);
        const items = itemsRes.recordset;

        // Pull stock OUT (if it was added) for each item
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const destStoreId = it.destination_store_id || original.store_id;
            const balanceAfter = await updateStockBalanceAsync(txRequest, destStoreId, it.product_id, -it.quantity);

            txRequest.input(`rv_sm_date_${i}`, sql.NVarChar, original.return_date);
            txRequest.input(`rv_sm_doc_${i}`, sql.NVarChar, `RV-${original.return_no}`);
            txRequest.input(`rv_sm_sid_${i}`, sql.Int, destStoreId);
            txRequest.input(`rv_sm_pid_${i}`, sql.Int, it.product_id);
            txRequest.input(`rv_sm_qout_${i}`, sql.Decimal(18, 4), it.quantity);
            txRequest.input(`rv_sm_bal_${i}`, sql.Decimal(18, 4), balanceAfter);
            txRequest.input(`rv_sm_refid_${i}`, sql.Int, returnId);
            await txRequest.query(`
                INSERT INTO stock_movements
                  (move_date, move_type, document_no, store_id, product_id,
                   qty_out, balance_after, reference_id, notes)
                VALUES
                  (@rv_sm_date_${i}, 'return_reversal', @rv_sm_doc_${i}, @rv_sm_sid_${i}, @rv_sm_pid_${i},
                   @rv_sm_qout_${i}, @rv_sm_bal_${i}, @rv_sm_refid_${i}, 'عكس مرتجع ${original.return_no}')
            `);
        }

        // Reverse original journal entries (if they were posted)
        try {
            const { reverseJournalEntryAsync } = require('../services/accountingEngine');
            const jRes = await txRequest.query(`
                SELECT id FROM journal_entries
                WHERE (reference_type='sales_return' AND reference_id=@rv_rid)
                   OR (reference_type LIKE 'sales_return_%' AND reference_id=@rv_rid)
            `);
            for (const j of jRes.recordset) {
                try { await reverseJournalEntryAsync(txRequest, j.id, `عكس قيد المرتجع ${original.return_no}`, req.user ? req.user.id : null); } catch (e) {}
            }
        } catch (e) {}

        // Flip workflow_status → reversed (do NOT delete)
        txRequest.input('rv_by', sql.Int, req.user ? req.user.id : null);
        txRequest.input('rv_at', sql.NVarChar, new Date().toISOString());
        await txRequest.query(`
            UPDATE sales_returns
            SET workflow_status='reversed', reversed_by=@rv_by, reversed_at=@rv_at, status='cancelled'
            WHERE id=@rv_rid
        `);

        await writeAuditAsync(txRequest, {
            return_id: returnId,
            action: 'reversed',
            actor: req.user,
            from_status: original.workflow_status,
            to_status: 'reversed',
            reason: reason,
            metadata: null,
            client_ip: req.ip,
            device_info: req.headers['user-agent']
        });

        if (original.invoice_id) {
            await updateInvoiceStatusAsync(txRequest, original.invoice_id);
            await updateInvoiceReturnStatusAsync(txRequest, original.invoice_id);
        }
        await recalcCustomerBalanceAsync(txRequest, original.customer_id);

        await transaction.commit();
        res.json({ success: true, message: 'تم عكس المرتجع بنجاح (لم يُحذف)' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Reverse return error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message });
    }
}));

// ── Reject a pending return ──
router.post('/returns/:id/reject', async (req, res) => {
    const returnId = parseInt(req.params.id);
    if (!returnId) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    if (!userHasPermission(req, 'sales.approve_return')) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية رفض المرتجعات' });
    }
    const rejectReason = (req.body && req.body.reason) || 'مرفوض';
    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();
        txRequest.input('rj_rid', sql.Int, returnId);
        const rRes = await txRequest.query(`SELECT * FROM sales_returns WHERE id = @rj_rid`);
        const ret = rRes.recordset[0];
        if (!ret) { await transaction.rollback(); return res.status(404).json({ success: false, message: 'المرتجع غير موجود' }); }
        if (ret.workflow_status !== 'pending_approval') {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'يمكن رفض المرتجعات التي بانتظار الاعتماد فقط' });
        }
        await txRequest.query(`
            UPDATE sales_returns SET workflow_status='rejected', status='cancelled' WHERE id=@rj_rid
        `);
        await writeAuditAsync(txRequest, {
            return_id: returnId, action: 'rejected', actor: req.user,
            from_status: ret.workflow_status, to_status: 'rejected',
            reason: rejectReason, metadata: null,
            client_ip: req.ip, device_info: req.headers['user-agent']
        });
        if (ret.invoice_id) {
            await updateInvoiceStatusAsync(txRequest, ret.invoice_id);
            await updateInvoiceReturnStatusAsync(txRequest, ret.invoice_id);
        }
        await recalcCustomerBalanceAsync(txRequest, ret.customer_id);
        await transaction.commit();
        res.json({ success: true, message: 'تم رفض المرتجع' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Reject return error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message });
    }
});

// ── Submit a draft return for approval ──
router.post('/returns/:id/submit', async (req, res) => {
    const returnId = parseInt(req.params.id);
    if (!returnId) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();
        txRequest.input('sb_rid', sql.Int, returnId);
        const rRes = await txRequest.query(`SELECT * FROM sales_returns WHERE id = @sb_rid`);
        const ret = rRes.recordset[0];
        if (!ret) { await transaction.rollback(); return res.status(404).json({ success: false, message: 'المرتجع غير موجود' }); }
        if (ret.workflow_status !== 'draft') {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'يمكن تقديم المسودات فقط للاعتماد' });
        }
        await txRequest.query(`
            UPDATE sales_returns SET workflow_status='pending_approval' WHERE id=@sb_rid
        `);
        await writeAuditAsync(txRequest, {
            return_id: returnId, action: 'submitted', actor: req.user,
            from_status: 'draft', to_status: 'pending_approval',
            reason: null, metadata: null,
            client_ip: req.ip, device_info: req.headers['user-agent']
        });
        await transaction.commit();
        res.json({ success: true, message: 'تم تقديم المرتجع للاعتماد' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Submit return error:', err);
res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message });
    }
});
// ── Edit an existing return (recalculates everything atomically) ──
router.put('/returns/:id', async (req, res) => {
    const returnId = parseInt(req.params.id);
    if (!returnId) return res.status(400).json({ success: false, message: 'معرّف غير صالح' });

    if (!userHasPermission(req, 'sales.approve_return')) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية تعديل المرتجعات' });
    }

    const { items, reason_code, reason_notes, return_date } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'لا توجد أصناف في المرتجع' });
    }

    let transaction;
    try {
        const pool = await getPool();
        const specialStores = await getSpecialStoresAsync(pool.request());

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        txRequest.input('er_rid', sql.Int, returnId);
        const origRes = await txRequest.query(`SELECT * FROM sales_returns WHERE id = @er_rid`);
        const origReturn = origRes.recordset[0];
        if (!origReturn) { await transaction.rollback(); return res.status(404).json({ success: false, message: 'المرتجع غير موجود' }); }
        if (origReturn.workflow_status === 'reversed') { await transaction.rollback(); return res.status(400).json({ success: false, message: 'لا يمكن تعديل مرتجع معكوس' }); }

        const origItemsRes = await txRequest.query(`SELECT * FROM sales_return_items WHERE return_id = @er_rid`);
        const origItems = origItemsRes.recordset;

        // ── Over-return validation (if linked to an invoice) ──
        if (origReturn.invoice_id) {
            // For each new item, compute: sold - previously_returned (excluding current) + new_qty <= sold
            // i.e. new_qty + prev_non_current_returned <= sold
            const invItemsRes = await txRequest.query(`
                SELECT ii.product_id, ii.quantity as sold_qty,
                       ISNULL((SELECT SUM(sri2.quantity) FROM sales_return_items sri2
                               INNER JOIN sales_returns sr2 ON sr2.id = sri2.return_id
                               WHERE sr2.invoice_id = ${origReturn.invoice_id}
                                 AND sr2.status NOT IN ('cancelled', 'deleted')
                                 AND sr2.id != ${returnId}
                                 AND sri2.product_id = ii.product_id), 0) as prev_returned
                FROM sales_invoice_items ii WHERE ii.invoice_id = ${origReturn.invoice_id}
            `);
            // Build validation map from invoice items
            const invMap = {};
            for (const iv of invItemsRes.recordset) invMap[iv.product_id] = { sold: parseFloat(iv.sold_qty) || 0, prevRet: parseFloat(iv.prev_returned) || 0 };
            for (const it of items) {
                if (!it.product_id) continue;
                const iv = invMap[it.product_id];
                if (iv) {
                    const maxQty = iv.sold - iv.prevRet;
                    if (parseFloat(it.quantity) > maxQty + 0.0001) {
                        await transaction.rollback();
                        return res.status(400).json({ success: false, message: `الصنف #${it.product_id}: الكمية تتجاوز المتاح للإرجاع (المتاح: ${maxQty})` });
                    }
                }
            }
        }

        // 1. Reverse old stock movements (if they exist — return was approved)
        for (const oit of origItems) {
            const destStoreId = oit.destination_store_id || origReturn.store_id;
            await updateStockBalanceAsync(txRequest, destStoreId, oit.product_id, -oit.quantity);
            txRequest.input(`ersm_doc_${oit.id}`, sql.NVarChar, `EDIT-${origReturn.return_no}`);
            txRequest.input(`ersm_sid_${oit.id}`, sql.Int, destStoreId);
            txRequest.input(`ersm_pid_${oit.id}`, sql.Int, oit.product_id);
            txRequest.input(`ersm_qout_${oit.id}`, sql.Decimal(18,4), oit.quantity);
            await txRequest.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, reference_id, notes)
                VALUES (GETDATE(), 'return_edit_reversal', @ersm_doc_${oit.id}, @ersm_sid_${oit.id}, @ersm_pid_${oit.id}, @ersm_qout_${oit.id}, @er_rid, N'عكس تعديل مرتجع ${origReturn.return_no}')
            `);
        }

        // 2. Reverse old journal entries (if any)
        const jeRes = await txRequest.query(`
            SELECT id FROM journal_entries
            WHERE (reference_type='sales_return' AND reference_id=@er_rid)
               OR (reference_type LIKE 'sales_return_%' AND reference_id=@er_rid)
        `);
        const { reverseJournalEntryAsync } = require('../services/accountingEngine');
        for (const j of jeRes.recordset) {
            try { await reverseJournalEntryAsync(txRequest, j.id, `عكس تعديل مرتجع ${origReturn.return_no}`, req.user ? req.user.id : null); } catch (e) {}
        }

        // 3. Delete old return items
        await txRequest.query(`DELETE FROM sales_return_items WHERE return_id = @er_rid`);

        // 4. Recompute enriched items from new data
        let subtotal = 0, totalTax = 0, totalDiscount = 0;
        const enrichedItems = [];
        for (const it of items) {
            if (!it.product_id || !it.quantity || it.quantity <= 0) {
                await transaction.rollback();
                return res.status(400).json({ success: false, message: 'بيانات الصنف غير صالحة' });
            }
            const qty = parseFloat(it.quantity);
            const unitPrice = parseFloat(it.unit_price) || 0;
            const discPct = parseFloat(it.discount_pct) || 0;
            const taxPct = parseFloat(it.tax_pct) || 0;
            const costPrice = parseFloat(it.cost_price) || 0;
            const gross = qty * unitPrice;
            const discAmt = gross * (discPct / 100);
            const net = gross - discAmt;
            const taxAmt = net * (taxPct / 100);
            subtotal += net;
            totalDiscount += discAmt;
            totalTax += taxAmt;
            const destStoreId = resolveDestinationStore(it.product_condition || 'saleable', specialStores, origReturn.store_id);
            enrichedItems.push({ ...it, quantity: qty, unit_price: unitPrice, discount_pct: discPct, tax_pct: taxPct, cost_price_snapshot: costPrice, discount_amount_snapshot: discAmt, tax_amount_snapshot: taxAmt, destination_store_id: destStoreId, original_invoice_item_id: it.original_invoice_item_id || null });
        }
        const grandTotal = subtotal + totalTax;

        // 5. Re-insert return items + stock movements
        for (let i = 0; i < enrichedItems.length; i++) {
            const ei = enrichedItems[i];
            const lineTotal = (ei.quantity * ei.unit_price) - ei.discount_amount_snapshot + ei.tax_amount_snapshot;
            const itReq = transaction.request();
            itReq.input(`eri_retid`, sql.Int, returnId);
            itReq.input(`eri_pid`, sql.Int, ei.product_id);
            itReq.input(`eri_qty`, sql.Decimal(18,4), ei.quantity);
            itReq.input(`eri_price`, sql.Decimal(18,4), ei.unit_price);
            itReq.input(`eri_ltot`, sql.Decimal(18,4), lineTotal);
            itReq.input(`eri_orig`, sql.Int, ei.original_invoice_item_id);
            itReq.input(`eri_cost`, sql.Decimal(18,4), ei.cost_price_snapshot);
            itReq.input(`eri_discP`, sql.Decimal(18,4), ei.discount_pct);
            itReq.input(`eri_discA`, sql.Decimal(18,4), ei.discount_amount_snapshot);
            itReq.input(`eri_taxP`, sql.Decimal(18,4), ei.tax_pct);
            itReq.input(`eri_taxA`, sql.Decimal(18,4), ei.tax_amount_snapshot);
            itReq.input(`eri_cond`, sql.NVarChar, ei.product_condition || 'saleable');
            itReq.input(`eri_dest`, sql.Int, ei.destination_store_id);
            itReq.input(`eri_rCode`, sql.NVarChar, ei.reason_code || reason_code || null);
            itReq.input(`eri_rNotes`, sql.NVarChar, ei.reason_notes || '');
            await itReq.query(`
                INSERT INTO sales_return_items (return_id, product_id, quantity, unit_price, line_total, original_invoice_item_id, cost_price_snapshot, discount_pct_snapshot, discount_amount_snapshot, tax_pct_snapshot, tax_amount_snapshot, product_condition, destination_store_id, reason_code, reason_notes)
                VALUES (@eri_retid, @eri_pid, @eri_qty, @eri_price, @eri_ltot, @eri_orig, @eri_cost, @eri_discP, @eri_discA, @eri_taxP, @eri_taxA, @eri_cond, @eri_dest, @eri_rCode, @eri_rNotes)
            `);

            const balanceAfter = await updateStockBalanceAsync(transaction.request(), ei.destination_store_id, ei.product_id, +ei.quantity);
            const smReq = transaction.request();
            smReq.input(`ersm_date`, sql.NVarChar, return_date || origReturn.return_date);
            smReq.input(`ersm_doc`, sql.NVarChar, origReturn.return_no);
            smReq.input(`ersm_sid`, sql.Int, ei.destination_store_id);
            smReq.input(`ersm_pid`, sql.Int, ei.product_id);
            smReq.input(`ersm_qin`, sql.Decimal(18,4), ei.quantity);
            smReq.input(`ersm_cost`, sql.Decimal(18,4), ei.cost_price_snapshot);
            smReq.input(`ersm_sell`, sql.Decimal(18,4), ei.unit_price);
            smReq.input(`ersm_bal`, sql.Decimal(18,4), balanceAfter);
            smReq.input(`ersm_refid`, sql.Int, returnId);
            smReq.input(`ersm_cond`, sql.NVarChar, ei.product_condition || 'saleable');
            await smReq.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, sell_price, balance_after, reference_id, notes)
                VALUES (@ersm_date, 'return_in_edit', @ersm_doc, @ersm_sid, @ersm_pid, @ersm_qin, @ersm_cost, @ersm_sell, @ersm_bal, @ersm_refid, @ersm_cond)
            `);
        }

        // 6. Re-create accounting entries
        if (grandTotal > 0) {
            const accAR = await getSystemAccountAsync(transaction.request(), 'SYS_AR');
            const accSalesReturn = await getSystemAccountAsync(transaction.request(), 'SYS_SALES_RETURNS');
            const accCogs = await getSystemAccountAsync(transaction.request(), 'SYS_COGS');
            const accInv = await getSystemAccountAsync(transaction.request(), 'SYS_INVENTORY');
            const accDamagedInv = await getSystemAccountAsync(transaction.request(), 'SYS_DAMAGED_INVENTORY');
            let accVatOutput = null;
            try { accVatOutput = await getSystemAccountAsync(transaction.request(), 'SYS_VAT_OUTPUT'); } catch (e) {}

            const reversalLines = [
                { account_id: accSalesReturn, debit: subtotal, credit: 0, description: `مردودات مبيعات (تعديل) ${origReturn.return_no}` },
                { account_id: accAR, debit: 0, credit: grandTotal, description: `تخفيض مديونية العميل (تعديل)` }
            ];
            if (totalTax > 0 && accVatOutput) {
                reversalLines.splice(1, 0, { account_id: accVatOutput, debit: totalTax, credit: 0, description: `عكس ضريبة مخرجات (تعديل)` });
            } else if (totalTax > 0) {
                reversalLines.splice(1, 0, { account_id: accAR, debit: totalTax, credit: 0, description: `ضريبة مردودات (تعديل)` });
            }
            await postJournalEntryAsync(transaction.request(), return_date || origReturn.return_date, `مردودات مبيعات (تعديل) ${origReturn.return_no}`, reversalLines, 'sales_return', returnId, req.user ? req.user.id : null, { module: 'sales_returns', action: 'edit_return', document: origReturn.return_no, isSystem: true });

            let saleableCost = 0, damagedCost = 0;
            for (const ei of enrichedItems) {
                const c = (ei.cost_price_snapshot || 0) * ei.quantity;
                if (ei.product_condition === 'saleable' || ei.product_condition === 'inspection') saleableCost += c;
                else if (ei.product_condition === 'damaged' || ei.product_condition === 'expired') damagedCost += c;
            }
            if (saleableCost > 0) {
                await postJournalEntryAsync(transaction.request(), return_date || origReturn.return_date, `استرداد مخزون (تعديل) ${origReturn.return_no}`, [
                    { account_id: accInv, debit: saleableCost, credit: 0, description: 'استرداد مخزون (تعديل)' },
                    { account_id: accCogs, debit: 0, credit: saleableCost, description: 'عكس تكلفة بضاعة (تعديل)' }
                ], 'sales_return_cogs_saleable', returnId, req.user ? req.user.id : null, { module: 'sales_returns', action: 'edit_cogs_saleable', document: origReturn.return_no, isSystem: true });
            }
            if (damagedCost > 0) {
                const acc = accDamagedInv || accInv;
                await postJournalEntryAsync(transaction.request(), return_date || origReturn.return_date, `تحويل توالف (تعديل) ${origReturn.return_no}`, [
                    { account_id: acc, debit: damagedCost, credit: 0, description: 'بضاعة تالفة (تعديل)' },
                    { account_id: accCogs, debit: 0, credit: damagedCost, description: 'عكس تكلفة بضاعة توالف (تعديل)' }
                ], 'sales_return_cogs_damaged', returnId, req.user ? req.user.id : null, { module: 'sales_returns', action: 'edit_cogs_damaged', document: origReturn.return_no, isSystem: true });
            }
        }

        // 7. Update return header
        txRequest.input('er_sub', sql.Decimal(18,4), subtotal);
        txRequest.input('er_disc', sql.Decimal(18,4), totalDiscount);
        txRequest.input('er_tax', sql.Decimal(18,4), totalTax);
        txRequest.input('er_total', sql.Decimal(18,4), grandTotal);
        txRequest.input('er_rCode', sql.NVarChar, reason_code || origReturn.reason_code);
        txRequest.input('er_rNotes', sql.NVarChar, reason_notes || origReturn.notes);
        await txRequest.query(`
            UPDATE sales_returns SET subtotal=@er_sub, discount_amount=@er_disc, tax_amount=@er_tax, grand_total=@er_total, reason_code=@er_rCode, notes=@er_rNotes WHERE id=@er_rid
        `);

        // 8. Recalculate invoice + customer
        if (origReturn.invoice_id) {
            await updateInvoiceStatusAsync(txRequest, origReturn.invoice_id);
            await updateInvoiceReturnStatusAsync(txRequest, origReturn.invoice_id);
        }
        await recalcCustomerBalanceAsync(txRequest, origReturn.customer_id);

        // 9. Audit
        await writeAuditAsync(txRequest, {
            return_id: returnId, action: 'edited', actor: req.user,
            from_status: origReturn.workflow_status, to_status: origReturn.workflow_status,
            reason: 'تعديل مرتجع', metadata: { old_items: origItems.length, new_items: items.length },
            client_ip: req.ip, device_info: req.headers['user-agent']
        });

await transaction.commit();
        res.json({ success: true, message: 'تم تعديل المرتجع وإعادة حساب كل القيود', id: returnId });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Edit return error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message });
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

        // Update customer balance
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
                // Adjust for current invoice replacement: subtract old invoice impact, add new invoice impact
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
