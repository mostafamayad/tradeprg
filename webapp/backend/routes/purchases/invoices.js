// ============================================================
// ROUTE: Purchase Invoices
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
 * Check if a purchase invoice can be cancelled.
 * Returns { allowed, reasons[], invoice } — collects ALL blockers.
 */
async function canCancelPurchaseInvoiceAsync(poolOrTx, invoiceId) {
    const request = typeof poolOrTx.request === 'function' ? poolOrTx.request() : poolOrTx;
    const pRand = Math.random().toString(36).substring(2, 7);
    request.input(`ccp_id_${pRand}`, sql.Int, invoiceId);

    const invRes = await request.query(`SELECT id, invoice_no, supplier_id, grand_total, amount_paid, status, invoice_date, store_id FROM purchase_invoices WHERE id = @ccp_id_${pRand}`);
    if (!invRes.recordset[0]) return { allowed: false, reasons: ['الفاتورة غير موجودة'], invoice: null };
    const invoice = invRes.recordset[0];
    if (invoice.status === 'cancelled') return { allowed: false, reasons: ['الفاتورة ملغاة بالفعل'], invoice };

    const reasons = [];

    // Check purchase returns
    {
        const r = Math.random().toString(36).substring(2, 9);
        request.input(`ccp_ret_${r}`, sql.Int, invoiceId);
        const ret = await request.query(`SELECT COUNT(*) as cnt FROM purchase_returns WHERE invoice_id = @ccp_ret_${r} AND status NOT IN ('cancelled', 'deleted')`);
        if (ret.recordset[0].cnt > 0) reasons.push('الفاتورة مرتبطة بمرتجع مشتريات');
    }

    // Check AP payment allocations (includes matching, cheques)
    {
        const r = Math.random().toString(36).substring(2, 9);
        request.input(`ccp_pay_${r}`, sql.Int, invoiceId);
        const pay = await request.query(`SELECT COUNT(*) as cnt FROM ap_payment_allocations WHERE invoice_id = @ccp_pay_${r}`);
        if (pay.recordset[0].cnt > 0) reasons.push('الفاتورة مرتبطة بسداد أو مطابقة');
    }

    // Check legacy payment allocations
    {
        const r = Math.random().toString(36).substring(2, 9);
        request.input(`ccp_leg_${r}`, sql.Int, invoiceId);
        const leg = await request.query(`SELECT COUNT(*) as cnt FROM supplier_payment_allocations WHERE invoice_id = @ccp_leg_${r}`);
        if (leg.recordset[0].cnt > 0) reasons.push('الفاتورة مرتبطة بسداد (نظام سابق)');
    }

    // Check treasury transactions (direct cash payment at creation)
    {
        const r = Math.random().toString(36).substring(2, 9);
        request.input(`ccp_no_${r}`, sql.NVarChar, invoice.invoice_no);
        const tres = await request.query(`SELECT COUNT(*) as cnt FROM treasury_transactions WHERE related_type IN ('supplier', 'purchase_invoice') AND document_no = @ccp_no_${r} AND trans_type='out'`);
        if (tres.recordset[0].cnt > 0) reasons.push('الفاتورة مرتبطة بدفع نقدي من الخزنة');
    }

    return { allowed: reasons.length === 0, reasons, invoice };
}

function formatMoney(val) {
    return (parseFloat(val) || 0).toFixed(2);
}

// ============================================================
// Routes
// ============================================================

router.get('/invoices', asyncHandler(async (req, res) => {
    try {
        const { q, supplier_id, from, to, status } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT TOP 500 i.*, s.supplier_name FROM purchase_invoices i LEFT JOIN suppliers s ON i.supplier_id = s.id WHERE 1=1`;
        
        if (q) { 
            sqlQuery += ` AND (i.invoice_no LIKE @q OR s.supplier_name LIKE @q)`; 
            request.input('q', sql.NVarChar, `%${q}%`); 
        }
        if (supplier_id) { sqlQuery += ` AND i.supplier_id = @supplierId`; request.input('supplierId', sql.Int, supplier_id); }
        if (from) { sqlQuery += ` AND i.invoice_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND i.invoice_date <= @to`; request.input('to', sql.NVarChar, to); }
        if (status) { sqlQuery += ` AND i.status = @status`; request.input('status', sql.NVarChar, status); }
        
        sqlQuery += ` ORDER BY i.id DESC`;
        
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Purchases GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.get('/invoices/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('id', sql.Int, req.params.id);
        
        const invRes = await request.query(`SELECT i.*, s.supplier_name, s.phone as supplier_phone, s.address as supplier_address, st.store_name FROM purchase_invoices i LEFT JOIN suppliers s ON i.supplier_id = s.id LEFT JOIN stores st ON i.store_id = st.id WHERE i.id = @id`);
        const invoice = invRes.recordset[0];
        if (!invoice) return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
        
        const itemsRes = await request.query(`SELECT ii.*, p.product_name, p.product_code, p.unit_name, p.barcode, (ii.quantity - COALESCE(ii.returned_qty, 0)) as remaining_qty FROM purchase_invoice_items ii LEFT JOIN products p ON ii.product_id = p.id WHERE ii.invoice_id = @id`);

        const retAmtRes = await request.query(`SELECT COALESCE(SUM(grand_total), 0) as total FROM purchase_returns WHERE invoice_id = @id AND status NOT IN ('cancelled', 'deleted')`);
        const returnedAmount = parseFloat(retAmtRes.recordset[0]?.total || 0);
        const netTotal = parseFloat(invoice.grand_total || 0) - returnedAmount;

        res.json({ success: true, data: { ...invoice, items: itemsRes.recordset, returned_amount: returnedAmount, net_total: netTotal } });
    } catch (err) {
        console.error('Purchases GET:id error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.post('/invoices', async (req, res) => {
    const { supplier_id, invoice_date, due_date, supplier_invoice_no, store_id, payment_type, discount_amount, tax_amount, amount_paid, notes, items } = req.body;
    if (!supplier_id) return res.status(400).json({ success: false, message: 'المورد مطلوب' });
    if (!items || items.length === 0) return res.status(400).json({ success: false, message: 'لا توجد أصناف' });

    let transaction;
    try {
        const pool = await getPool();
        
        const storeRes = await pool.request().query('SELECT TOP 1 id FROM stores');
        const storeId = store_id || (storeRes.recordset[0] ? storeRes.recordset[0].id : 1);

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        let subtotal = 0;
        const processedItems = items.map(item => {
            const lineTotal = item.quantity * item.cost_price;
            subtotal += lineTotal;
            return { ...item, line_total: lineTotal };
        });

        const productIds = [...new Set(processedItems.map(i => i.product_id))];
        if (productIds.length > 0) {
            const placeholders = productIds.map((_, idx) => `@snapPid_${idx}`).join(',');
            productIds.forEach((pid, idx) => txRequest.input(`snapPid_${idx}`, sql.Int, pid));
            const snapRes = await txRequest.query(`SELECT id, sell_price, unit_name, barcode, product_name FROM products WHERE id IN (${placeholders})`);
            const snapMap = {};
            snapRes.recordset.forEach(r => { snapMap[r.id] = r; });
            processedItems.forEach(item => {
                const snap = snapMap[item.product_id];
                if (snap) {
                    item.sell_price = snap.sell_price || 0;
                    item.snapshot_product_name = snap.product_name;
                    item.snapshot_unit_name = snap.unit_name;
                    item.snapshot_barcode = snap.barcode;
                }
            });
        }

        const disc = discount_amount || 0;
        const tax = tax_amount || 0;
        const grandTotal = subtotal - disc + tax;
        const paid = payment_type === 'cash' ? grandTotal : (amount_paid || 0);
        const remaining = grandTotal - paid;
        
        const invoiceNo = await nextDocNoAsync(txRequest, 'purchases');
        const iDate = invoice_date || new Date().toISOString().slice(0, 10);
        const dDate = due_date || null;

        const invResult = await txRequest
            .input('invoiceNo', sql.NVarChar, invoiceNo)
            .input('supplierInvoiceNo', sql.NVarChar, supplier_invoice_no || '')
            .input('invoiceDate', sql.NVarChar, iDate)
            .input('dueDate', sql.NVarChar, dDate)
            .input('supplierId', sql.Int, supplier_id)
            .input('storeId', sql.Int, storeId)
            .input('paymentType', sql.NVarChar, payment_type || 'cash')
            .input('subtotal', sql.Decimal(18, 2), subtotal)
            .input('discount', sql.Decimal(18, 2), disc)
            .input('tax', sql.Decimal(18, 2), tax)
            .input('grandTotal', sql.Decimal(18, 2), grandTotal)
            .input('paid', sql.Decimal(18, 2), paid)
            .input('remaining', sql.Decimal(18, 2), remaining)
            .input('notes', sql.NVarChar, notes || '')
            .query(`
                INSERT INTO purchase_invoices (invoice_no, supplier_invoice_no, invoice_date, due_date, supplier_id, store_id, payment_type, subtotal, discount_amount, tax_amount, grand_total, amount_paid, remaining, notes, status) 
                OUTPUT INSERTED.id
                VALUES (@invoiceNo, @supplierInvoiceNo, @invoiceDate, @dueDate, @supplierId, @storeId, @paymentType, @subtotal, @discount, @tax, @grandTotal, @paid, @remaining, @notes, 'posted')
            `);
            
        const invoiceId = invResult.recordset[0].id;

        for (let i = 0; i < processedItems.length; i++) {
            const item = processedItems[i];
            txRequest.input(`pi_iid_${i}`, sql.Int, invoiceId);
            txRequest.input(`pi_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`pi_qty_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`pi_cost_${i}`, sql.Decimal(18, 2), item.cost_price);
            txRequest.input(`pi_sell_${i}`, sql.Decimal(18, 2), item.sell_price || 0);
            txRequest.input(`pi_linetot_${i}`, sql.Decimal(18, 2), item.line_total);
            txRequest.input(`pi_sname_${i}`, sql.NVarChar, item.snapshot_product_name || item.product_name || '');
            txRequest.input(`pi_sunit_${i}`, sql.NVarChar, item.snapshot_unit_name || '');
            txRequest.input(`pi_sbar_${i}`, sql.NVarChar, item.snapshot_barcode || '');
            
            await txRequest.query(`
                INSERT INTO purchase_invoice_items (invoice_id, product_id, quantity, cost_price, sell_price, line_total, snapshot_product_name, snapshot_unit_name, snapshot_barcode) 
                VALUES (@pi_iid_${i}, @pi_pid_${i}, @pi_qty_${i}, @pi_cost_${i}, @pi_sell_${i}, @pi_linetot_${i}, @pi_sname_${i}, @pi_sunit_${i}, @pi_sbar_${i})
            `);

            // Read current stock and cost for WAC calculation (per-store)
            txRequest.input(`wac_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`wac_sid_${i}`, sql.Int, storeId);
            const pRes = await txRequest.query(`
                SELECT p.cost_price as old_cost, ISNULL(SUM(ib.quantity), 0) as total_qty
                FROM products p
                LEFT JOIN inventory_balances ib WITH (UPDLOCK) ON ib.product_id = p.id AND ib.store_id = @wac_sid_${i}
                WHERE p.id = @wac_pid_${i}
                GROUP BY p.cost_price
            `);
            const pData = pRes.recordset[0];
            const oldCost = pData ? (pData.old_cost || 0) : 0;
            const oldTotalQty = pData ? (pData.total_qty || 0) : 0;
            const newQty = item.quantity;
            const newCost = item.cost_price;

            // Calculate WAC: (Old Qty * Old Cost + New Qty * New Cost) / Total Qty
            let wac = newCost;
            if (oldTotalQty + newQty > 0) {
                wac = ((oldTotalQty * oldCost) + (newQty * newCost)) / (oldTotalQty + newQty);
            }

            // Add to stock
            const balanceAfter = await updateStockBalanceAsync(txRequest, storeId, item.product_id, item.quantity);

            // Update product cost price with WAC
            txRequest.input(`pu_cost_${i}`, sql.Decimal(18, 2), wac);
            txRequest.input(`pu_pid_${i}`, sql.Int, item.product_id);
            await txRequest.query(`UPDATE products SET cost_price = @pu_cost_${i} WHERE id = @pu_pid_${i}`);
            
            // sell_price is NEVER updated from purchase invoices — snapshot only

            // Stock movement
            txRequest.input(`sm_date_${i}`, sql.NVarChar, iDate);
            txRequest.input(`sm_docno_${i}`, sql.NVarChar, invoiceNo);
            txRequest.input(`sm_sid_${i}`, sql.Int, storeId);
            txRequest.input(`sm_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`sm_qtyin_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`sm_cost_${i}`, sql.Decimal(18, 2), item.cost_price);
            txRequest.input(`sm_bal_${i}`, sql.Decimal(18, 4), balanceAfter);
            txRequest.input(`sm_refid_${i}`, sql.Int, invoiceId);
            await txRequest.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id) 
                VALUES (@sm_date_${i}, 'in', @sm_docno_${i}, @sm_sid_${i}, @sm_pid_${i}, @sm_qtyin_${i}, @sm_cost_${i}, @sm_bal_${i}, @sm_refid_${i})
            `);
        }

        // If cash: deduct from treasury
        if (paid > 0) {
            const tresRes = await txRequest.query(`SELECT TOP 1 id FROM treasury_accounts WHERE account_type = 'cash'`);
            const treasury = tresRes.recordset[0];
            if (treasury) {
                const transNo = await nextDocNoAsync(txRequest, 'treasury');
                await createTreasuryTransactionAsync(txRequest, {
                    transNo, transDate: iDate, transType: 'out', amount: paid,
                    accountId: treasury.id, relatedType: 'purchase_invoice', relatedId: supplier_id,
                    documentNo: invoiceNo, description: `دفع لمورد فاتورة ${invoiceNo}`,
                    userId: req.user ? req.user.id : null
                });
            }
        }

        // --- ACCOUNTING INTEGRATION: Purchase Invoice Accrual ---
        const accAP = await getSystemAccountAsync(txRequest, 'SYS_AP');
        const accInventory = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY');
        const accVatInput = tax > 0 ? await getSystemAccountAsync(txRequest, 'SYS_VAT_INPUT') : null;

        const accrualLines = [
            { account_id: accInventory, debit: subtotal - disc, credit: 0, description: `مخزون فاتورة ${invoiceNo}` },
            { account_id: accAP, debit: 0, credit: grandTotal, description: `استحقاق مورد فاتورة ${invoiceNo}` }
        ];
        if (tax > 0) {
            accrualLines.push({ account_id: accVatInput, debit: tax, credit: 0, description: `ضريبة مدخلات فاتورة ${invoiceNo}` });
        }
        await postJournalEntryAsync(
            txRequest, iDate, `استحقاق فاتورة مشتريات ${invoiceNo}`, accrualLines,
            'purchase_invoice', invoiceId, req.user ? req.user.id : null,
            { module: 'purchases', action: 'create_invoice', document: invoiceNo, isSystem: true }
        );

        // Cash payment JE
        if (paid > 0) {
            const accCash = await getSystemAccountAsync(txRequest, 'SYS_CASH');
            const payLines = [
                { account_id: accAP, debit: paid, credit: 0, description: `دفع نقدي لمورد فاتورة ${invoiceNo}` },
                { account_id: accCash, debit: 0, credit: paid, description: `صرف من الخزينة لمورد فاتورة ${invoiceNo}` }
            ];
            await postJournalEntryAsync(
                txRequest, iDate, `سداد نقدي لفاتورة المشتريات ${invoiceNo}`, payLines,
                'purchase_payment', invoiceId, req.user ? req.user.id : null,
                { module: 'purchases', action: 'payment', document: invoiceNo, isSystem: true }
            );
        }

        await recalcSupplierBalanceAsync(txRequest, supplier_id);
        
        await transaction.commit();
        res.status(201).json({ success: true, message: 'تم حفظ فاتورة المشتريات', invoiceNo, invoiceId, grandTotal });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Purchases POST error:', err);
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

        // Pre-check outside transaction
        const { allowed, reasons, invoice } = await canCancelPurchaseInvoiceAsync(pool, invoiceId);
        if (!allowed) {
            return res.status(400).json({ success: false, message: 'لا يمكن إلغاء الفاتورة', reasons });
        }
        if (!invoice) {
            return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        txRequest.input('txInvId', sql.Int, invoiceId);
        const itemsRes = await txRequest.query('SELECT ii.*, p.cost_price as current_cost FROM purchase_invoice_items ii LEFT JOIN products p ON ii.product_id = p.id WHERE ii.invoice_id = @txInvId');
        const items = itemsRes.recordset;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const costPrice = parseFloat(item.cost_price) || parseFloat(item.current_cost) || 0;
            const balanceAfter = await updateStockBalanceAsync(txRequest, invoice.store_id, item.product_id, -item.quantity);

            txRequest.input(`sm_date_${i}`, sql.NVarChar, invoice.invoice_date || new Date().toISOString().slice(0, 10));
            txRequest.input(`sm_doc_${i}`, sql.NVarChar, `CNCL-${invoice.invoice_no}`);
            txRequest.input(`sm_sid_${i}`, sql.Int, invoice.store_id);
            txRequest.input(`sm_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`sm_qty_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`sm_cost_${i}`, sql.Decimal(18, 2), costPrice);
            txRequest.input(`sm_bal_${i}`, sql.Decimal(18, 4), balanceAfter);
            txRequest.input(`sm_ref_${i}`, sql.Int, invoiceId);
            await txRequest.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, balance_after, reference_id, notes)
                VALUES (@sm_date_${i}, 'cancellation', @sm_doc_${i}, @sm_sid_${i}, @sm_pid_${i}, @sm_qty_${i}, @sm_cost_${i}, @sm_bal_${i}, @sm_ref_${i}, N'إلغاء فاتورة مشتريات ${invoice.invoice_no}')
            `);
        }

        // Reverse ALL journal entries for this invoice by reference_type + reference_id
        txRequest.input('je_ref_type', sql.NVarChar, 'purchase_invoice');
        txRequest.input('je_ref_id', sql.Int, invoiceId);
        const jeRes = await txRequest.query(`
            SELECT id FROM journal_entries 
            WHERE reference_type = @je_ref_type AND reference_id = @je_ref_id
              AND (is_reversed IS NULL OR is_reversed = 0)
        `);
        for (const je of jeRes.recordset) {
            await reverseJournalEntryAsync(txRequest, je.id, `إلغاء فاتورة مشتريات ${invoice.invoice_no}`, req.user ? req.user.id : null);
        }

        await txRequest.query(`UPDATE purchase_invoices SET status = 'cancelled' WHERE id = @txInvId`);
        await recalcSupplierBalanceAsync(txRequest, invoice.supplier_id);

        // Log supplier activity
        {
            const pLog = Math.random().toString(36).substring(2, 9);
            txRequest.input(`sal_sid_${pLog}`, sql.Int, invoice.supplier_id);
            txRequest.input(`sal_type_${pLog}`, sql.NVarChar, 'invoice_cancelled');
            txRequest.input(`sal_desc_${pLog}`, sql.NVarChar, `تم إلغاء فاتورة مشتريات ${invoice.invoice_no} بقيمة ${invoice.grand_total}، عدد الأصناف: ${items.length}${cancelReason ? '، سبب: ' + cancelReason : ''}`);
            txRequest.input(`sal_rt_${pLog}`, sql.NVarChar, 'purchase_invoice');
            txRequest.input(`sal_ri_${pLog}`, sql.Int, invoiceId);
            txRequest.input(`sal_rn_${pLog}`, sql.NVarChar, invoice.invoice_no);
            txRequest.input(`sal_amt_${pLog}`, sql.Decimal(18, 4), invoice.grand_total || 0);
            txRequest.input(`sal_uid_${pLog}`, sql.Int, req.user ? req.user.id : null);
            await txRequest.query(`
                INSERT INTO supplier_activity_log (supplier_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
                VALUES (@sal_sid_${pLog}, @sal_type_${pLog}, @sal_desc_${pLog}, @sal_rt_${pLog}, @sal_ri_${pLog}, @sal_rn_${pLog}, @sal_amt_${pLog}, @sal_uid_${pLog})
            `);
        }

        await transaction.commit();
        await logActivity(req, 'CANCEL', 'purchases', invoice.invoice_no,
            `إلغاء فاتورة مشتريات ${invoice.invoice_no} | المستخدم: ${req.user ? req.user.name : 'النظام'} | التاريخ: ${new Date().toISOString().slice(0, 10)} | الإجمالي: ${invoice.grand_total} | الأصناف: ${items.length}${cancelReason ? ' | سبب: ' + cancelReason : ''}`,
            { invoice_no: invoice.invoice_no, grand_total: invoice.grand_total, items_count: items.length, status: 'cancelled' },
            null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم إلغاء الفاتورة واسترجاع المخزون وعكس القيود المحاسبية' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Purchases cancel error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message });
    }
});

// ============================================================
// UPDATE (EDIT) PURCHASE INVOICE
// ============================================================
router.put('/invoices/:id', async (req, res) => {
    const { supplier_id, invoice_date, due_date, supplier_invoice_no, store_id, payment_type, discount_amount, tax_amount, amount_paid, notes, items } = req.body;
    
    let transaction;
    try {
        const pool = await getPool();
        const invRes = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT * FROM purchase_invoices WHERE id = @id');
        const invoice = invRes.recordset[0];
        
        if (!invoice) return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
        if (!items || items.length === 0) return res.status(400).json({ success: false, message: 'يجب إضافة أصناف في الفاتورة' });
        if (invoice.status === 'cancelled') return res.status(400).json({ success: false, message: 'لا يمكن تعديل فاتورة ملغاة' });

        const retCountRes = await pool.request()
            .input('invId', sql.Int, invoice.id)
            .query(`SELECT COUNT(*) as c FROM purchase_returns WHERE invoice_id = @invId AND status NOT IN ('cancelled', 'deleted')`);
        if (retCountRes.recordset[0].c > 0) {
            return res.status(400).json({ success: false, message: 'لا يمكن تعديل فاتورة تم عمل مرتجع عليها.' });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        txRequest.input('txInvId', sql.Int, invoice.id);
        txRequest.input('txInvNo', sql.NVarChar, invoice.invoice_no);

        // Reverse old items from stock
        const oldItemsRes = await txRequest.query('SELECT * FROM purchase_invoice_items WHERE invoice_id = @txInvId');
        for (let i = 0; i < oldItemsRes.recordset.length; i++) {
            const item = oldItemsRes.recordset[i];
            await updateStockBalanceAsync(txRequest, invoice.store_id, item.product_id, -item.quantity);
        }

        // Reverse old JEs before modifying invoice
        const oldJeRes = await txRequest.query(`
            SELECT id FROM journal_entries
            WHERE reference_type = 'purchase_invoice'
              AND reference_id = @txInvId
              AND (is_reversed IS NULL OR is_reversed = 0)
        `);
        for (const je of oldJeRes.recordset) {
            await reverseJournalEntryAsync(txRequest, je.id, `عكس قيد الفاتورة ${invoice.invoice_no} بسبب التعديل`, req.user ? req.user.id : null);
        }
        // Reverse old payment JE if exists
        const oldPayJeRes = await txRequest.query(`
            SELECT id FROM journal_entries
            WHERE reference_type = 'purchase_payment'
              AND reference_id = @txInvId
              AND (is_reversed IS NULL OR is_reversed = 0)
        `);
        for (const je of oldPayJeRes.recordset) {
            await reverseJournalEntryAsync(txRequest, je.id, `عكس قيد الدفع ${invoice.invoice_no} بسبب التعديل`, req.user ? req.user.id : null);
        }

        await txRequest.query(`DELETE FROM stock_movements WHERE move_type = 'in' AND reference_id = @txInvId AND document_no = @txInvNo`);
        await txRequest.query(`DELETE FROM purchase_invoice_items WHERE invoice_id = @txInvId`);

        const storeId = store_id || invoice.store_id;
        const iDate = invoice_date || invoice.invoice_date;
        const dDate = due_date !== undefined ? due_date : invoice.due_date;

        let subtotal = 0;
        const processedItems = items.map(item => {
            const lineTotal = item.quantity * item.cost_price;
            subtotal += lineTotal;
            return { ...item, line_total: lineTotal };
        });

        const productIds = [...new Set(processedItems.map(i => i.product_id))];
        if (productIds.length > 0) {
            const placeholders = productIds.map((_, idx) => `@snapPid_${idx}`).join(',');
            productIds.forEach((pid, idx) => txRequest.input(`snapPid_${idx}`, sql.Int, pid));
            const snapRes = await txRequest.query(`SELECT id, sell_price, unit_name, barcode, product_name FROM products WHERE id IN (${placeholders})`);
            const snapMap = {};
            snapRes.recordset.forEach(r => { snapMap[r.id] = r; });
            processedItems.forEach(item => {
                const snap = snapMap[item.product_id];
                if (snap) {
                    item.sell_price = snap.sell_price || 0;
                    item.snapshot_product_name = snap.product_name;
                    item.snapshot_unit_name = snap.unit_name;
                    item.snapshot_barcode = snap.barcode;
                }
            });
        }

        const disc = discount_amount || 0;
        const tax = tax_amount || 0;
        const grandTotal = subtotal - disc + tax;
        const paid = amount_paid !== undefined ? parseFloat(amount_paid) : invoice.amount_paid;
        const remaining = Math.max(0, grandTotal - paid);

        for (let i = 0; i < processedItems.length; i++) {
            const item = processedItems[i];
            txRequest.input(`upi_iid_${i}`, sql.Int, invoice.id);
            txRequest.input(`upi_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`upi_qty_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`upi_cost_${i}`, sql.Decimal(18, 2), item.cost_price);
            txRequest.input(`upi_sell_${i}`, sql.Decimal(18, 2), item.sell_price || 0);
            txRequest.input(`upi_linetot_${i}`, sql.Decimal(18, 2), item.line_total);
            txRequest.input(`upi_sname_${i}`, sql.NVarChar, item.snapshot_product_name || item.product_name || '');
            txRequest.input(`upi_sunit_${i}`, sql.NVarChar, item.snapshot_unit_name || '');
            txRequest.input(`upi_sbar_${i}`, sql.NVarChar, item.snapshot_barcode || '');
            
            await txRequest.query(`
                INSERT INTO purchase_invoice_items (invoice_id, product_id, quantity, cost_price, sell_price, line_total, snapshot_product_name, snapshot_unit_name, snapshot_barcode) 
                VALUES (@upi_iid_${i}, @upi_pid_${i}, @upi_qty_${i}, @upi_cost_${i}, @upi_sell_${i}, @upi_linetot_${i}, @upi_sname_${i}, @upi_sunit_${i}, @upi_sbar_${i})
            `);

            // Read current stock and cost for WAC calculation (per-store, ignoring reversed items)
            txRequest.input(`uwac_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`uwac_sid_${i}`, sql.Int, storeId);
            const pRes = await txRequest.query(`
                SELECT p.cost_price as old_cost, ISNULL(SUM(ib.quantity), 0) as total_qty
                FROM products p
                LEFT JOIN inventory_balances ib WITH (UPDLOCK) ON ib.product_id = p.id AND ib.store_id = @uwac_sid_${i}
                WHERE p.id = @uwac_pid_${i}
                GROUP BY p.cost_price
            `);
            const pData = pRes.recordset[0];
            const oldCost = pData ? (pData.old_cost || 0) : 0;
            const oldTotalQty = pData ? (pData.total_qty || 0) : 0;
            const newQty = item.quantity;
            const newCost = item.cost_price;

            let wac = newCost;
            if (oldTotalQty + newQty > 0) {
                wac = ((oldTotalQty * oldCost) + (newQty * newCost)) / (oldTotalQty + newQty);
            }

            const balanceAfter = await updateStockBalanceAsync(txRequest, storeId, item.product_id, item.quantity);

            txRequest.input(`upu_cost_${i}`, sql.Decimal(18, 2), wac);
            txRequest.input(`upu_pid_${i}`, sql.Int, item.product_id);
            await txRequest.query(`UPDATE products SET cost_price = @upu_cost_${i} WHERE id = @upu_pid_${i}`);

            txRequest.input(`usm_date_${i}`, sql.NVarChar, iDate);
            txRequest.input(`usm_docno_${i}`, sql.NVarChar, invoice.invoice_no);
            txRequest.input(`usm_sid_${i}`, sql.Int, storeId);
            txRequest.input(`usm_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`usm_qtyin_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`usm_cost_${i}`, sql.Decimal(18, 2), item.cost_price);
            txRequest.input(`usm_bal_${i}`, sql.Decimal(18, 4), balanceAfter);
            txRequest.input(`usm_refid_${i}`, sql.Int, invoice.id);
            await txRequest.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id) 
                VALUES (@usm_date_${i}, 'in', @usm_docno_${i}, @usm_sid_${i}, @usm_pid_${i}, @usm_qtyin_${i}, @usm_cost_${i}, @usm_bal_${i}, @usm_refid_${i})
            `);
        }

        txRequest.input('ui_sid', sql.Int, supplier_id);
        txRequest.input('ui_date', sql.NVarChar, iDate);
        txRequest.input('ui_ddate', sql.NVarChar, dDate);
        txRequest.input('ui_invno', sql.NVarChar, supplier_invoice_no || '');
        txRequest.input('ui_stid', sql.Int, storeId);
        txRequest.input('ui_ptype', sql.NVarChar, payment_type || invoice.payment_type);
        txRequest.input('ui_sub', sql.Decimal(18, 2), subtotal);
        txRequest.input('ui_damt', sql.Decimal(18, 2), disc);
        txRequest.input('ui_tax', sql.Decimal(18, 2), tax);
        txRequest.input('ui_grand', sql.Decimal(18, 2), grandTotal);
        txRequest.input('ui_paid', sql.Decimal(18, 2), paid);
        txRequest.input('ui_rem', sql.Decimal(18, 2), remaining);
        txRequest.input('ui_notes', sql.NVarChar, notes || '');
        
        await txRequest.query(`
            UPDATE purchase_invoices SET 
            supplier_id = @ui_sid, invoice_date = @ui_date, due_date = @ui_ddate, supplier_invoice_no = @ui_invno, store_id = @ui_stid, payment_type = @ui_ptype,
            subtotal = @ui_sub, discount_amount = @ui_damt, tax_amount = @ui_tax, grand_total = @ui_grand, amount_paid = @ui_paid, remaining = @ui_rem, notes = @ui_notes
            WHERE id = @txInvId
        `);

        // Post new accrual JE with updated values
        const accAP = await getSystemAccountAsync(txRequest, 'SYS_AP');
        const accInventory = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY');
        const accVatInput = tax > 0 ? await getSystemAccountAsync(txRequest, 'SYS_VAT_INPUT') : null;
        const accrualLines = [
            { account_id: accInventory, debit: subtotal - disc, credit: 0, description: `مخزون فاتورة ${invoice.invoice_no}` },
            { account_id: accAP, debit: 0, credit: grandTotal, description: `استحقاق مورد فاتورة ${invoice.invoice_no}` }
        ];
        if (tax > 0) {
            accrualLines.push({ account_id: accVatInput, debit: tax, credit: 0, description: `ضريبة مدخلات فاتورة ${invoice.invoice_no}` });
        }
        await postJournalEntryAsync(
            txRequest, iDate, `استحقاق فاتورة مشتريات ${invoice.invoice_no}`, accrualLines,
            'purchase_invoice', invoice.id, req.user ? req.user.id : null,
            { module: 'purchases', action: 'edit_invoice', document: invoice.invoice_no, isSystem: true }
        );

        // Cash payment JE if paid > 0
        if (paid > 0) {
            const accCash = await getSystemAccountAsync(txRequest, 'SYS_CASH');
            const payLines = [
                { account_id: accAP, debit: paid, credit: 0, description: `دفع نقدي لمورد فاتورة ${invoice.invoice_no}` },
                { account_id: accCash, debit: 0, credit: paid, description: `صرف من الخزينة لمورد فاتورة ${invoice.invoice_no}` }
            ];
            await postJournalEntryAsync(
                txRequest, iDate, `سداد نقدي لفاتورة المشتريات ${invoice.invoice_no}`, payLines,
                'purchase_payment', invoice.id, req.user ? req.user.id : null,
                { module: 'purchases', action: 'payment_edit', document: invoice.invoice_no, isSystem: true }
            );
        }

        await recalcSupplierBalanceAsync(txRequest, supplier_id);
        if (supplier_id !== invoice.supplier_id) {
            await recalcSupplierBalanceAsync(txRequest, invoice.supplier_id);
        }

        await transaction.commit();
        res.json({ success: true, message: 'تم تعديل فاتورة المشتريات بنجاح', invoiceId: invoice.id, invoiceNo: invoice.invoice_no });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Purchases update invoice error:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
    }
});

// ── DELETE Purchase Invoice (Soft Delete) ──
router.delete('/invoices/:id', async (req, res) => {
    if (req.user?.role !== 'admin') {
        await logActivity(req, 'DELETE', 'purchases', req.params.id, 'حذف فاتورة شراء', null, null, 'FAILED', 'لا توجد صلاحية');
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية حذف فواتير الشراء' });
    }
    let transaction;
    try {
        const pool = await getPool();
        const invRes = await pool.request()
            .input('del_id', sql.Int, req.params.id)
            .query(`SELECT * FROM purchase_invoices WHERE id = @del_id`);
        const invoice = invRes.recordset[0];
        if (!invoice) {
            await logActivity(req, 'DELETE', 'purchases', req.params.id, 'حذف فاتورة شراء', null, null, 'FAILED', 'الفاتورة غير موجودة');
            return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
        }
        if (invoice.status === 'cancelled' || invoice.status === 'deleted') {
            await logActivity(req, 'DELETE', 'purchases', req.params.id, 'حذف فاتورة شراء', null, null, 'FAILED', 'الفاتورة ملغاة أو محذوفة');
            return res.status(400).json({ success: false, message: 'الفاتورة ملغاة أو محذوفة مسبقاً' });
        }

        const blockers = [];
        const retRes = await pool.request()
            .input('del_iid', sql.Int, req.params.id)
            .query(`SELECT COUNT(*) as cnt FROM purchase_returns WHERE invoice_id = @del_iid AND status NOT IN ('cancelled', 'deleted')`);
        if (retRes.recordset[0].cnt > 0) {
            blockers.push(`مرتجعات (${retRes.recordset[0].cnt})`);
        }
        if (parseFloat(invoice.amount_paid) > 0) {
            blockers.push('مدفوعات مسجلة');
        }
        if (blockers.length > 0) {
            await logActivity(req, 'DELETE', 'purchases', invoice.invoice_no, 'حذف فاتورة شراء', null, null, 'FAILED', 'مرتبط بمستندات: ' + blockers.join(', '));
            return res.status(400).json({ success: false, message: 'لا يمكن حذف الفاتورة لأنها مرتبطة بـ: ' + blockers.join(', ') });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();
        txRequest.input('del_id', sql.Int, req.params.id);
        await txRequest.query(`UPDATE purchase_invoices SET status = 'deleted' WHERE id = @del_id`);
        await recalcSupplierBalanceAsync(transaction.request(), invoice.supplier_id);
        await transaction.commit();
        await logActivity(req, 'DELETE', 'purchases', invoice.invoice_no, `حذف فاتورة ${invoice.invoice_no}`, { invoice_no: invoice.invoice_no, grand_total: invoice.grand_total }, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم حذف الفاتورة بنجاح' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Purchase invoice DELETE error:', err);
        await logActivity(req, 'DELETE', 'purchases', req.params.id, 'حذف فاتورة شراء', null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message });
    }
});

module.exports = router;
