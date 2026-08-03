// ============================================================
// ROUTE: Purchases
// ============================================================
const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync, recalcSupplierBalanceAsync } = require('../services/accountingEngine');
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
        const tres = await request.query(`SELECT COUNT(*) as cnt FROM treasury_transactions WHERE related_type='supplier' AND document_no = @ccp_no_${r} AND trans_type='out'`);
        if (tres.recordset[0].cnt > 0) reasons.push('الفاتورة مرتبطة بدفع نقدي من الخزنة');
    }

    return { allowed: reasons.length === 0, reasons, invoice };
}

async function updatePurchaseReturnStatusAsync(txRequest, invoiceId) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`prs_inv_${pRand}`, sql.Int, invoiceId);

    await txRequest.query(`
        UPDATE ii
        SET ii.returned_qty = COALESCE((
            SELECT SUM(pri.quantity)
            FROM purchase_return_items pri
            INNER JOIN purchase_returns pr ON pr.id = pri.return_id
            WHERE pr.invoice_id = @prs_inv_${pRand}
              AND pr.status NOT IN ('cancelled', 'deleted')
              AND pri.product_id = ii.product_id
        ), 0)
        FROM purchase_invoice_items ii
        WHERE ii.invoice_id = @prs_inv_${pRand}
    `);

    const statusRes = await txRequest.query(`
        SELECT
            COUNT(*) as total_items,
            SUM(CASE WHEN COALESCE(returned_qty, 0) >= quantity THEN 1 ELSE 0 END) as fully_returned,
            SUM(CASE WHEN COALESCE(returned_qty, 0) > 0 THEN 1 ELSE 0 END) as any_returned
        FROM purchase_invoice_items
        WHERE invoice_id = @prs_inv_${pRand}
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

    txRequest.input(`prs_stat_${pRand}`, sql.NVarChar, newReturnStatus);
    await txRequest.query(`UPDATE purchase_invoices SET return_status = @prs_stat_${pRand} WHERE id = @prs_inv_${pRand}`);
}

function formatMoney(val) {
    return (parseFloat(val) || 0).toFixed(2);
}

function userHasPermission(req, perm) {
    if (!req.user) return false;
    if (req.user.is_super_admin) return true;
    if (req.user.role === 'admin') return true;
    let perms = [];
    try {
        const raw = req.user.permissions;
        perms = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
    } catch (e) { perms = []; }
    return perms.includes('*') || perms.includes(perm);
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
        const paid = payment_type === 'cash' ? grandTotal : (parseFloat(amount_paid) || 0);
        
        if (paid > grandTotal + 0.01) {
            await transaction.rollback();
            await logActivity(req, 'CREATE', 'purchases', null, 'إنشاء فاتورة مشتريات', null, null, 'FAILED', 'المبلغ المدفوع أكبر من الإجمالي');
            return res.status(400).json({ success: false, message: 'المبلغ المدفوع لا يمكن أن يكون أكبر من إجمالي الفاتورة' });
        }
        
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

            // Read current stock and cost for WAC calculation
            txRequest.input(`wac_pid_${i}`, sql.Int, item.product_id);
            const pRes = await txRequest.query(`
                SELECT p.cost_price as old_cost, ISNULL(SUM(ib.quantity), 0) as total_qty
                FROM products p
                LEFT JOIN inventory_balances ib WITH (UPDLOCK) ON ib.product_id = p.id
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
                txRequest.input('tt_transno', sql.NVarChar, transNo);
                txRequest.input('tt_date', sql.NVarChar, iDate);
                txRequest.input('tt_amt', sql.Decimal(18, 2), paid);
                txRequest.input('tt_accid', sql.Int, treasury.id);
                txRequest.input('tt_relid', sql.Int, supplier_id);
                txRequest.input('tt_docno', sql.NVarChar, invoiceNo);
                txRequest.input('tt_desc', sql.NVarChar, `دفع لمورد فاتورة ${invoiceNo}`);
                
                await txRequest.query(`
                    INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description) 
                    VALUES (@tt_transno, @tt_date, 'out', @tt_amt, @tt_accid, 'supplier', @tt_relid, @tt_docno, @tt_desc)
                `);
                
                txRequest.input('ta_paid', sql.Decimal(18, 2), paid);
                txRequest.input('ta_accid', sql.Int, treasury.id);
                await txRequest.query(`UPDATE treasury_accounts SET current_balance = current_balance - @ta_paid WHERE id = @ta_accid`);
            }
        }

        // --- ACCOUNTING INTEGRATION: Purchase Invoice Accrual ---
        // Perpetual Inventory System: DR Inventory (Asset) / CR Accounts Payable (Liability)
        const accAP = await getSystemAccountAsync(txRequest, 'SYS_AP');
        const accInventory = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY');
        const accVatInput = tax > 0 ? await getSystemAccountAsync(txRequest, 'SYS_VAT_INPUT') : null;

        const accrualLines = [
            { account_id: accInventory, debit: subtotal - disc, credit: 0, description: `بضاعة واردة - فاتورة ${invoiceNo}` },
            { account_id: accAP, debit: 0, credit: grandTotal, description: `استحقاق مورد فاتورة ${invoiceNo}` }
        ];
        if (tax > 0) {
            accrualLines.push({ account_id: accVatInput, debit: tax, credit: 0, description: `ضريبة مدخلات فاتورة ${invoiceNo}` });
        }
        await postJournalEntryAsync(
            txRequest, iDate, `استحقاق فاتورة مشتريات ${invoiceNo}`, accrualLines,
            'purchase_invoice', invoiceId, req.user ? req.user.id : null,
            { module: 'purchases', action: 'create_invoice', document: invoiceNo, isSystem: true },
            supplier_id
        );

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

        // Reverse ALL journal entries for this invoice by source_document
        txRequest.input('je_inv_no', sql.NVarChar, invoice.invoice_no);
        const jeRes = await txRequest.query(`
            SELECT id FROM journal_entries 
            WHERE source_document = @je_inv_no 
              AND (is_reversed IS NULL OR is_reversed = 0)
              AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')
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
            txRequest.input('tt_transno', sql.NVarChar, transNo);
            txRequest.input('tt_date', sql.NVarChar, pDate);
            txRequest.input('tt_amt', sql.Decimal(18, 2), amount);
            txRequest.input('tt_accid', sql.Int, treasury.id);
            txRequest.input('tt_relid', sql.Int, supplier_id);
            txRequest.input('tt_docno', sql.NVarChar, payNo);
            txRequest.input('tt_desc', sql.NVarChar, `دفعية للمورد ${payNo}`);
            
            await txRequest.query(`
                INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description) 
                VALUES (@tt_transno, @tt_date, 'out', @tt_amt, @tt_accid, 'supplier', @tt_relid, @tt_docno, @tt_desc)
            `);
            
            txRequest.input('ta_paid', sql.Decimal(18, 2), amount);
            txRequest.input('ta_accid', sql.Int, treasury.id);
            await txRequest.query(`UPDATE treasury_accounts SET current_balance = current_balance - @ta_paid WHERE id = @ta_accid`);
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

// ── Purchase Returns (مرتجعات المشتريات) ───────────────────────
router.post('/returns', asyncHandler(async (req, res) => {
    const { supplier_id, invoice_id, return_date, store_id, return_reason, reason_id, reason_note, reason_code, notes, items, client_ip, device_info, source_type } = req.body;
    const retSourceType = source_type === 'manual' ? 'manual' : 'invoice';

    // ── Permission check ──
    if (retSourceType === 'manual' && !userHasPermission(req, 'purchase.free_return.create')) {
        return res.status(403).json({ success: false, message: 'لا تملك صلاحية إنشاء مرتجع يدوي' });
    }
    if (retSourceType === 'invoice' && !userHasPermission(req, 'purchase_returns.create')) {
        return res.status(403).json({ success: false, message: 'لا تملك صلاحية إنشاء مرتجع مشتريات' });
    }

    if (!supplier_id) {
        return res.status(400).json({ success: false, message: 'المورد مطلوب' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'لا توجد أصناف في المرتجع' });
    }
    if (retSourceType === 'manual' && !store_id) {
        return res.status(400).json({ success: false, message: 'يجب تحديد المستودع للمرتجع اليدوي' });
    }
    if (retSourceType === 'invoice' && !invoice_id) {
        return res.status(400).json({ success: false, message: 'يجب تحديد رقم الفاتورة' });
    }

    for (const it of items) {
        if (!it.product_id) {
            return res.status(400).json({ success: false, message: 'كل صنف يجب أن يحتوي على product_id' });
        }
        if (!it.quantity || it.quantity <= 0) {
            return res.status(400).json({ success: false, message: 'الكمية يجب أن تكون أكبر من صفر' });
        }
    }

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        let invoice = null;
        let storeId = store_id || 1;
        let retInsert, returnId, retNo;

        if (retSourceType === 'invoice') {
            // ── Validate linked invoice ──
            txRequest.input('pr_invid', sql.Int, invoice_id);
            const invRes = await txRequest.query(`SELECT * FROM purchase_invoices WHERE id = @pr_invid`);
            invoice = invRes.recordset[0];
            if (!invoice) {
                await transaction.rollback();
                return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
            }
            if (invoice.status === 'cancelled' || invoice.status === 'deleted') {
                await transaction.rollback();
                return res.status(400).json({ success: false, message: 'لا يمكن إنشاء مرتجع لفاتورة ملغاة' });
            }
            if (String(invoice.supplier_id) !== String(supplier_id)) {
                await transaction.rollback();
                return res.status(400).json({ success: false, message: 'المورد لا يطابق مورد الفاتورة' });
            }
            storeId = store_id || invoice.store_id;

            // ── Snapshot original items + previous returns ──
            const origItemsRes = await txRequest.query(`
                SELECT id, product_id, quantity, cost_price
                FROM purchase_invoice_items WHERE invoice_id = @pr_invid
            `);
            const invoiceItemMap = {};
            for (const row of origItemsRes.recordset) {
                invoiceItemMap[row.product_id] = row;
            }

            const prevReturnsRes = await txRequest.query(`
                SELECT pri.product_id, COALESCE(SUM(pri.quantity), 0) as returned
                FROM purchase_return_items pri
                INNER JOIN purchase_returns pr ON pr.id = pri.return_id
                WHERE pr.invoice_id = @pr_invid AND pr.status NOT IN ('cancelled', 'deleted')
                GROUP BY pri.product_id
            `);
            const prevMap = {};
            for (const row of prevReturnsRes.recordset) {
                prevMap[row.product_id] = parseFloat(row.returned) || 0;
            }

            // ── Validate quantities + snapshot prices ──
            let returnSubtotal = 0;
            const enrichedItems = items.map(it => {
                const orig = invoiceItemMap[it.product_id];
                if (!orig) {
                    throw new Error(`PRODUCT_NOT_FOUND:${it.product_id}`);
                }
                const purchased = parseFloat(orig.quantity) || 0;
                const prevReturned = prevMap[it.product_id] || 0;
                const remainingReturnable = purchased - prevReturned;
                if (parseFloat(it.quantity) > remainingReturnable + 0.0001) {
                    throw new Error(`QTY_EXCEEDED:${it.product_id}:${purchased}:${prevReturned}:${remainingReturnable}`);
                }
                const snapCost = parseFloat(orig.cost_price) || 0;
                const lineTotal = parseFloat(it.quantity) * snapCost;
                returnSubtotal += lineTotal;
                return {
                    product_id: it.product_id,
                    quantity: parseFloat(it.quantity),
                    cost_price: snapCost,
                    line_total: lineTotal,
                    original_invoice_item_id: orig.id
                };
            });

            // ── Pro-rate discount and tax from original invoice ──
            const invSubtotal = parseFloat(invoice.subtotal) || 0;
            const invDiscount = parseFloat(invoice.discount_amount) || 0;
            const invTax = parseFloat(invoice.tax_amount) || 0;
            let returnDiscount = 0, returnTax = 0;
            if (invSubtotal > 0 && returnSubtotal > 0) {
                const ratio = returnSubtotal / invSubtotal;
                returnDiscount = invDiscount * ratio;
                returnTax = invTax * ratio;
            }
            const returnGrandTotal = returnSubtotal - returnDiscount + returnTax;

            // ── Insert return header ──
            retNo = await nextDocNoAsync(txRequest, 'purchase_returns');
            const rDate = return_date || new Date().toISOString().slice(0, 10);
            const hdrReq = transaction.request();
            hdrReq.input('pr_retNo', sql.NVarChar, retNo);
            hdrReq.input('pr_invId', sql.Int, invoice_id);
            hdrReq.input('pr_supplierId', sql.Int, supplier_id);
            hdrReq.input('pr_rDate', sql.NVarChar, rDate);
            hdrReq.input('pr_storeId', sql.Int, storeId);
            hdrReq.input('pr_subtotal', sql.Decimal(18, 4), returnSubtotal);
            hdrReq.input('pr_disc', sql.Decimal(18, 4), returnDiscount);
            hdrReq.input('pr_tax', sql.Decimal(18, 4), returnTax);
            hdrReq.input('pr_total', sql.Decimal(18, 4), returnGrandTotal);
            hdrReq.input('pr_reason', sql.NVarChar, return_reason || reason_code || '');
            hdrReq.input('pr_reasonId', sql.Int, reason_id || null);
            hdrReq.input('pr_reasonNote', sql.NVarChar, reason_note || '');
            hdrReq.input('pr_reasonCode', sql.NVarChar, reason_code || null);
            hdrReq.input('pr_notes', sql.NVarChar, notes || '');
            hdrReq.input('pr_srcType', sql.NVarChar, 'invoice');
            hdrReq.input('pr_createdBy', sql.Int, req.user ? req.user.id : null);
            hdrReq.input('pr_ip', sql.NVarChar, client_ip || req.ip || '');
            hdrReq.input('pr_dev', sql.NVarChar, (device_info || req.headers['user-agent'] || '').substring(0, 250));
            retInsert = await hdrReq.query(`
                INSERT INTO purchase_returns
                  (return_no, invoice_id, supplier_id, return_date, store_id,
                   subtotal, discount_amount, tax_amount, grand_total,
                   return_reason, reason_id, reason_note, reason_code, notes, status, workflow_status,
                   source_type, created_by, client_ip, device_info)
                OUTPUT INSERTED.id
                VALUES
                  (@pr_retNo, @pr_invId, @pr_supplierId, @pr_rDate, @pr_storeId,
                   @pr_subtotal, @pr_disc, @pr_tax, @pr_total,
                   @pr_reason, @pr_reasonId, @pr_reasonNote, @pr_reasonCode, @pr_notes, 'posted', 'approved',
                   @pr_srcType, @pr_createdBy, @pr_ip, @pr_dev)
            `);
            returnId = retInsert.recordset[0].id;

            // ── Insert return items + stock movements ──
            for (let i = 0; i < enrichedItems.length; i++) {
                const ei = enrichedItems[i];
                const itReq = transaction.request();
                itReq.input(`pri_retid_${i}`, sql.Int, returnId);
                itReq.input(`pri_pid_${i}`, sql.Int, ei.product_id);
                itReq.input(`pri_qty_${i}`, sql.Decimal(18, 4), ei.quantity);
                itReq.input(`pri_cost_${i}`, sql.Decimal(18, 4), ei.cost_price);
                itReq.input(`pri_linetot_${i}`, sql.Decimal(18, 4), ei.line_total);
                itReq.input(`pri_orig_${i}`, sql.Int, ei.original_invoice_item_id);
                await itReq.query(`
                    INSERT INTO purchase_return_items
                      (return_id, product_id, quantity, cost_price, line_total, original_invoice_item_id)
                    VALUES
                      (@pri_retid_${i}, @pri_pid_${i}, @pri_qty_${i}, @pri_cost_${i}, @pri_linetot_${i}, @pri_orig_${i})
                `);
                const balanceAfter = await updateStockBalanceAsync(transaction.request(), storeId, ei.product_id, -ei.quantity);
                const smReq = transaction.request();
                smReq.input(`sm_date_${i}`, sql.NVarChar, rDate);
                smReq.input(`sm_docno_${i}`, sql.NVarChar, retNo);
                smReq.input(`sm_sid_${i}`, sql.Int, storeId);
                smReq.input(`sm_pid_${i}`, sql.Int, ei.product_id);
                smReq.input(`sm_qtyout_${i}`, sql.Decimal(18, 4), ei.quantity);
                smReq.input(`sm_cost_${i}`, sql.Decimal(18, 4), ei.cost_price);
                smReq.input(`sm_bal_${i}`, sql.Decimal(18, 4), balanceAfter);
                smReq.input(`sm_refid_${i}`, sql.Int, returnId);
                await smReq.query(`
                    INSERT INTO stock_movements
                      (move_date, move_type, document_no, store_id, product_id,
                       qty_out, cost_price, balance_after, reference_id, notes)
                    VALUES
                      (@sm_date_${i}, 'purchase_return', @sm_docno_${i}, @sm_sid_${i}, @sm_pid_${i},
                       @sm_qtyout_${i}, @sm_cost_${i}, @sm_bal_${i}, @sm_refid_${i}, N'مرتجع مشتريات')
                `);
            }

            // ── Accounting entries ──
            if (returnGrandTotal > 0) {
                const accAP = await getSystemAccountAsync(transaction.request(), 'SYS_AP');
                const accInventory = await getSystemAccountAsync(transaction.request(), 'SYS_INVENTORY');
                let accVatInput = null;
                if (returnTax > 0) {
                    try { accVatInput = await getSystemAccountAsync(transaction.request(), 'SYS_VAT_INPUT'); } catch (e) {}
                }
                const lines = [
                    { account_id: accAP, debit: returnGrandTotal, credit: 0, description: `تخفيض ذمم دائنة لمرتجع مشتريات ${retNo}` }
                ];
                if (returnTax > 0 && accVatInput) {
                    lines.push({ account_id: accInventory, debit: 0, credit: returnSubtotal - returnDiscount, description: `مردودات مشتريات (مخزون) ${retNo}` });
                    lines.push({ account_id: accVatInput, debit: 0, credit: returnTax, description: `عكس ضريبة مدخلات لمرتجع ${retNo}` });
                } else {
                    lines.push({ account_id: accInventory, debit: 0, credit: returnGrandTotal, description: `مردودات مشتريات (مخزون) ${retNo}` });
                }
                await postJournalEntryAsync(
                    transaction.request(), rDate, `مردودات مشتريات ${retNo}`,
                    lines,
                    'purchase_return', returnId, req.user ? req.user.id : null,
                    { module: 'purchase_returns', action: 'create_return', document: retNo, isSystem: true },
                    supplier_id
                );
            }

            await updatePurchaseReturnStatusAsync(transaction.request(), invoice_id);

        } else {
            // ── MANUAL (free) return: no invoice linked ──
            // Validate inventory with UPDLOCK (no HOLDLOCK needed — point query on PK)
            for (const it of items) {
                const chkReq = transaction.request();
                const pRand = Math.random().toString(36).substring(2, 7);
                chkReq.input(`chk_pid_${pRand}`, sql.Int, it.product_id);
                chkReq.input(`chk_sid_${pRand}`, sql.Int, store_id);
                const chkRes = await chkReq.query(`
                    SELECT ISNULL(ib.quantity, 0) as qty
                    FROM products p WITH (UPDLOCK)
                    LEFT JOIN inventory_balances ib WITH (UPDLOCK) ON ib.product_id = p.id AND ib.store_id = @chk_sid_${pRand}
                    WHERE p.id = @chk_pid_${pRand}
                `);
                if (!chkRes.recordset[0]) {
                    throw new Error(`PRODUCT_NOT_FOUND:${it.product_id}`);
                }
                const availableQty = parseFloat(chkRes.recordset[0].qty) || 0;
                if (parseFloat(it.quantity) > availableQty + 0.0001) {
                    throw new Error(`QTY_INSUFFICIENT:${it.product_id}:${availableQty}:${it.quantity}`);
                }
            }

            // Single-query product snapshots
            const productIds = [...new Set(items.map(i => i.product_id))];
            const placeholders = productIds.map((_, idx) => `@snapPid_${idx}`).join(',');
            const snapReq = transaction.request();
            productIds.forEach((pid, idx) => snapReq.input(`snapPid_${idx}`, sql.Int, pid));
            const snapRes = await snapReq.query(`SELECT id, cost_price, sell_price, product_name, unit_name, barcode FROM products WHERE id IN (${placeholders})`);
            const snapMap = {};
            snapRes.recordset.forEach(r => { snapMap[r.id] = r; });

            let returnSubtotal = 0;
            const enrichedItems = items.map(it => {
                const snap = snapMap[it.product_id];
                if (!snap) throw new Error(`PRODUCT_NOT_FOUND:${it.product_id}`);
                const snapCost = parseFloat(snap.cost_price) || 0;
                const lineTotal = parseFloat(it.quantity) * snapCost;
                returnSubtotal += lineTotal;
                return {
                    product_id: it.product_id,
                    quantity: parseFloat(it.quantity),
                    cost_price: snapCost,
                    line_total: lineTotal,
                    original_invoice_item_id: null
                };
            });

            const returnGrandTotal = returnSubtotal;
            const rDate = return_date || new Date().toISOString().slice(0, 10);
            retNo = await nextDocNoAsync(txRequest, 'purchase_returns');

            // Insert return header
            const hdrReq = transaction.request();
            hdrReq.input('pr_retNo', sql.NVarChar, retNo);
            hdrReq.input('pr_invId', sql.Int, null);
            hdrReq.input('pr_supplierId', sql.Int, supplier_id);
            hdrReq.input('pr_rDate', sql.NVarChar, rDate);
            hdrReq.input('pr_storeId', sql.Int, store_id);
            hdrReq.input('pr_subtotal', sql.Decimal(18, 4), returnSubtotal);
            hdrReq.input('pr_disc', sql.Decimal(18, 4), 0);
            hdrReq.input('pr_tax', sql.Decimal(18, 4), 0);
            hdrReq.input('pr_total', sql.Decimal(18, 4), returnGrandTotal);
            hdrReq.input('pr_reason', sql.NVarChar, return_reason || '');
            hdrReq.input('pr_reasonId', sql.Int, reason_id || null);
            hdrReq.input('pr_reasonNote', sql.NVarChar, reason_note || '');
            hdrReq.input('pr_reasonCode', sql.NVarChar, null);
            hdrReq.input('pr_notes', sql.NVarChar, notes || '');
            hdrReq.input('pr_srcType', sql.NVarChar, 'manual');
            hdrReq.input('pr_createdBy', sql.Int, req.user ? req.user.id : null);
            hdrReq.input('pr_ip', sql.NVarChar, client_ip || req.ip || '');
            hdrReq.input('pr_dev', sql.NVarChar, (device_info || req.headers['user-agent'] || '').substring(0, 250));
            retInsert = await hdrReq.query(`
                INSERT INTO purchase_returns
                  (return_no, invoice_id, supplier_id, return_date, store_id,
                   subtotal, discount_amount, tax_amount, grand_total,
                   return_reason, reason_id, reason_note, notes, status, workflow_status,
                   source_type, created_by, client_ip, device_info)
                OUTPUT INSERTED.id
                VALUES
                  (@pr_retNo, @pr_invId, @pr_supplierId, @pr_rDate, @pr_storeId,
                   @pr_subtotal, @pr_disc, @pr_tax, @pr_total,
                   @pr_reason, @pr_reasonId, @pr_reasonNote, @pr_notes, 'posted', 'approved',
                   @pr_srcType, @pr_createdBy, @pr_ip, @pr_dev)
            `);
            returnId = retInsert.recordset[0].id;

            // Insert return items + stock movements
            for (let i = 0; i < enrichedItems.length; i++) {
                const ei = enrichedItems[i];
                const itReq = transaction.request();
                itReq.input(`pri_retid_${i}`, sql.Int, returnId);
                itReq.input(`pri_pid_${i}`, sql.Int, ei.product_id);
                itReq.input(`pri_qty_${i}`, sql.Decimal(18, 4), ei.quantity);
                itReq.input(`pri_cost_${i}`, sql.Decimal(18, 4), ei.cost_price);
                itReq.input(`pri_linetot_${i}`, sql.Decimal(18, 4), ei.line_total);
                await itReq.query(`
                    INSERT INTO purchase_return_items
                      (return_id, product_id, quantity, cost_price, line_total, original_invoice_item_id)
                    VALUES
                      (@pri_retid_${i}, @pri_pid_${i}, @pri_qty_${i}, @pri_cost_${i}, @pri_linetot_${i}, NULL)
                `);
                const balanceAfter = await updateStockBalanceAsync(transaction.request(), store_id, ei.product_id, -ei.quantity);
                const smReq = transaction.request();
                smReq.input(`sm_date_${i}`, sql.NVarChar, rDate);
                smReq.input(`sm_docno_${i}`, sql.NVarChar, retNo);
                smReq.input(`sm_sid_${i}`, sql.Int, store_id);
                smReq.input(`sm_pid_${i}`, sql.Int, ei.product_id);
                smReq.input(`sm_qtyout_${i}`, sql.Decimal(18, 4), ei.quantity);
                smReq.input(`sm_cost_${i}`, sql.Decimal(18, 4), ei.cost_price);
                smReq.input(`sm_bal_${i}`, sql.Decimal(18, 4), balanceAfter);
                smReq.input(`sm_refid_${i}`, sql.Int, returnId);
                await smReq.query(`
                    INSERT INTO stock_movements
                      (move_date, move_type, document_no, store_id, product_id,
                       qty_out, cost_price, balance_after, reference_id, notes)
                    VALUES
                      (@sm_date_${i}, 'purchase_return', @sm_docno_${i}, @sm_sid_${i}, @sm_pid_${i},
                       @sm_qtyout_${i}, @sm_cost_${i}, @sm_bal_${i}, @sm_refid_${i}, N'مرتجع مشتريات يدوي')
                `);
            }

            // Accounting: Debit AP, Credit Inventory
            if (returnGrandTotal > 0) {
                const accAP = await getSystemAccountAsync(transaction.request(), 'SYS_AP');
                const accInventory = await getSystemAccountAsync(transaction.request(), 'SYS_INVENTORY');
                await postJournalEntryAsync(
                    transaction.request(), rDate, `مردودات مشتريات يدوي ${retNo}`,
                    [
                        { account_id: accAP, debit: returnGrandTotal, credit: 0, description: `تخفيض ذمم دائنة لمرتجع يدوي ${retNo}` },
                        { account_id: accInventory, debit: 0, credit: returnGrandTotal, description: `مردودات مشتريات يدوي ${retNo}` }
                    ],
                    'purchase_return', returnId, req.user ? req.user.id : null,
                    { module: 'purchase_returns', action: 'create_manual_return', document: retNo, isSystem: true },
                    supplier_id
                );
            }
        }

        // ── Recalc supplier balance (both types) ──
        await recalcSupplierBalanceAsync(transaction.request(), supplier_id);

        // ── Audit log ──
        await logActivity(req, 'CREATE', 'purchase_returns', retInsert.recordset ? undefined : undefined, `مرتجع مشتريات (${retSourceType})`, null,
            { source_type: retSourceType, supplier_id, invoice_id, items_count: items.length },
            'SUCCESS', null);

        await transaction.commit();

        // Fetch the return_no for response
        const finalPool = await getPool();
        const finalReq = finalPool.request();
        finalReq.input('fr_id', sql.Int, returnId);
        const finalRes = await finalReq.query('SELECT return_no, grand_total FROM purchase_returns WHERE id = @fr_id');
        const finalData = finalRes.recordset[0] || {};

        res.status(201).json({
            success: true,
            message: retSourceType === 'manual' ? 'تم تسجيل المرتجع اليدوي بنجاح' : 'تم تسجيل مرتجع المشتريات واعتماده',
            id: returnId,
            return_no: finalData.return_no || retNo,
            grand_total: finalData.grand_total || 0,
            source_type: retSourceType
        });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logDetailedError('Purchase Returns POST', err);

        if (err.message && err.message.startsWith('PRODUCT_NOT_FOUND:')) {
            const pid = err.message.split(':')[1];
            return res.status(400).json({ success: false, message: `الصنف #${pid} غير موجود` });
        }
        if (err.message && err.message.startsWith('QTY_EXCEEDED:')) {
            const parts = err.message.split(':');
            const pid = parts[1], purchased = parts[2], prevReturned = parts[3], remaining = parts[4];
            return res.status(400).json({
                success: false,
                message: `الصنف #${pid}: المشتراة ${purchased}، المُرجع سابقاً ${prevReturned}، المتاح للإرجاع ${remaining}`
            });
        }
        if (err.message && err.message.startsWith('QTY_INSUFFICIENT:')) {
            const parts = err.message.split(':');
            const pid = parts[1], available = parts[2], requested = parts[3];
            return res.status(400).json({
                success: false,
                message: `الصنف #${pid}: الكمية المتاحة ${available}، المطلوب ${requested}`
            });
        }
        await logActivity(req, 'CREATE', 'purchase_returns', null, 'إنشاء مرتجع مشتريات', null, null, 'FAILED', err.message);
        res.status(500).json({
            success: false,
            message: 'خطأ في حفظ مرتجع المشتريات',
            error_detail: err.message
        });
    }
}));

// ── GET Purchase Returns List ──
router.get('/returns', asyncHandler(async (req, res) => {
    try {
        const { q, invoice_id, supplier_id, source_type, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `
            SELECT pr.*, s.supplier_name, pi.invoice_no,
            rr.label_ar AS reason_name,
            (SELECT COUNT(*) FROM purchase_return_items pri WHERE pri.return_id = pr.id) as items_count
            FROM purchase_returns pr
            LEFT JOIN suppliers s ON pr.supplier_id = s.id
            LEFT JOIN purchase_invoices pi ON pr.invoice_id = pi.id
            LEFT JOIN return_reasons rr ON pr.return_reason = rr.code
            WHERE 1=1
        `;
        if (q) { sqlQuery += ` AND (pr.return_no LIKE @q OR s.supplier_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (invoice_id) { sqlQuery += ` AND pr.invoice_id = @invId`; request.input('invId', sql.Int, invoice_id); }
        if (supplier_id) { sqlQuery += ` AND pr.supplier_id = @supId`; request.input('supId', sql.Int, supplier_id); }
        if (source_type) { sqlQuery += ` AND pr.source_type = @srcType`; request.input('srcType', sql.NVarChar, source_type); }
        if (from) { sqlQuery += ` AND pr.return_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND pr.return_date <= @to`; request.input('to', sql.NVarChar, to); }
        sqlQuery += ` ORDER BY pr.id DESC`;
        const retRes = await request.query(sqlQuery);
        res.json({ success: true, data: retRes.recordset });
    } catch (err) {
        logDetailedError('Purchase Returns GET list', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب مرتجعات المشتريات', error_detail: err.message });
    }
}));

// ── GET Purchase Return Detail ──
router.get('/returns/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('rid', sql.Int, req.params.id);
        const retRes = await request.query(`
            SELECT pr.*, s.supplier_name, pi.invoice_no, rr.label_ar AS reason_name
            FROM purchase_returns pr
            LEFT JOIN suppliers s ON pr.supplier_id = s.id
            LEFT JOIN purchase_invoices pi ON pr.invoice_id = pi.id
            LEFT JOIN return_reasons rr ON pr.return_reason = rr.code
            WHERE pr.id = @rid
        `);
        const ret = retRes.recordset[0];
        if (!ret) return res.status(404).json({ success: false, message: 'المرتجع غير موجود' });
        const itemsRes = await request.query(`
            SELECT pri.*, p.product_name, p.product_code, p.unit_name
            FROM purchase_return_items pri
            LEFT JOIN products p ON pri.product_id = p.id
            WHERE pri.return_id = @rid
        `);
        res.json({ success: true, data: { ...ret, items: itemsRes.recordset } });
    } catch (err) {
        logDetailedError('Purchase Returns GET detail', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل المرتجع', error_detail: err.message });
    }
}));

// ── GET Available Quantities for Return ──
router.get('/returns/available-qty/:invoiceId', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('invId', sql.Int, req.params.invoiceId);
        const itemsRes = await request.query(`
            SELECT ii.id, ii.product_id, ii.quantity as purchased_qty,
                   ii.cost_price, ii.sell_price,
                   COALESCE((
                       SELECT SUM(pri.quantity)
                       FROM purchase_return_items pri
                       INNER JOIN purchase_returns pr ON pr.id = pri.return_id
                       WHERE pr.invoice_id = @invId AND pr.status NOT IN ('cancelled', 'deleted')
                         AND pri.product_id = ii.product_id
                   ), 0) as already_returned,
                   ii.quantity - COALESCE((
                       SELECT SUM(pri.quantity)
                       FROM purchase_return_items pri
                       INNER JOIN purchase_returns pr ON pr.id = pri.return_id
                       WHERE pr.invoice_id = @invId AND pr.status NOT IN ('cancelled', 'deleted')
                         AND pri.product_id = ii.product_id
                   ), 0) as remaining_returnable,
                   p.product_name, p.product_code, p.unit_name, p.barcode
            FROM purchase_invoice_items ii
            LEFT JOIN products p ON ii.product_id = p.id
            WHERE ii.invoice_id = @invId
            ORDER BY ii.id
        `);
        res.json({ success: true, data: itemsRes.recordset });
    } catch (err) {
        logDetailedError('Purchase Returns available-qty', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب الكميات المتاحة', error_detail: err.message });
    }
}));

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

        // ── Accounting: reverse the old accrual JE(s) for this invoice ──
        // (previously this was missing → stale GL balance on edit)
        const oldJeRes = await txRequest.query(`
            SELECT id FROM journal_entries
            WHERE source_module = 'purchases'
              AND source_document = @txInvNo
              AND (is_reversed IS NULL OR is_reversed = 0)
              AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')
        `);
        for (const oldJe of oldJeRes.recordset) {
            await reverseJournalEntryAsync(txRequest, oldJe.id, `إلغاء قيد فاتورة مشتريات قبل التعديل ${invoice.invoice_no}`, req.user ? req.user.id : null);
        }

        // Reverse old items from stock
        const oldItemsRes = await txRequest.query('SELECT * FROM purchase_invoice_items WHERE invoice_id = @txInvId');
        for (let i = 0; i < oldItemsRes.recordset.length; i++) {
            const item = oldItemsRes.recordset[i];
            await updateStockBalanceAsync(txRequest, invoice.store_id, item.product_id, -item.quantity);
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

            // Read current stock and cost for WAC calculation (ignoring the reversed items)
            txRequest.input(`uwac_pid_${i}`, sql.Int, item.product_id);
            const pRes = await txRequest.query(`
                SELECT p.cost_price as old_cost, ISNULL(SUM(ib.quantity), 0) as total_qty
                FROM products p
                LEFT JOIN inventory_balances ib WITH (UPDLOCK) ON ib.product_id = p.id
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

        // ── Accounting: post a fresh accrual JE with the new totals ──
        const updAccAP = await getSystemAccountAsync(txRequest, 'SYS_AP');
        const updAccInv = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY');
        const updAccVat = tax > 0 ? await getSystemAccountAsync(txRequest, 'SYS_VAT_INPUT') : null;
        const updLines = [
            { account_id: updAccInv, debit: subtotal - disc, credit: 0, description: `بضاعة واردة (تعديل) - فاتورة ${invoice.invoice_no}` },
            { account_id: updAccAP, debit: 0, credit: grandTotal, description: `استحقاق مورد (تعديل) فاتورة ${invoice.invoice_no}` }
        ];
        if (updAccVat) {
            updLines.push({ account_id: updAccVat, debit: tax, credit: 0, description: `ضريبة مدخلات (تعديل) فاتورة ${invoice.invoice_no}` });
        }
        await postJournalEntryAsync(
            txRequest, iDate, `استحقاق فاتورة مشتريات (تعديل) ${invoice.invoice_no}`, updLines,
            'purchase_invoice', invoice.id, req.user ? req.user.id : null,
            { module: 'purchases', action: 'update_invoice', document: invoice.invoice_no, isSystem: true },
            supplier_id || invoice.supplier_id
        );

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
        txRequest.input('del_doc', sql.NVarChar, invoice.invoice_no);

        // ── Accounting: reverse the accrual JE(s) before soft-deleting ──
        const delJeRes = await txRequest.query(`
            SELECT id FROM journal_entries
            WHERE source_module = 'purchases'
              AND source_document = @del_doc
              AND (is_reversed IS NULL OR is_reversed = 0)
              AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')
        `);
        for (const delJe of delJeRes.recordset) {
            await reverseJournalEntryAsync(txRequest, delJe.id, `إلغاء قيد فاتورة مشتريات محذوفة ${invoice.invoice_no}`, req.user ? req.user.id : null);
        }

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

// ── DELETE Purchase Return (Soft Delete with reversal) ──
router.delete('/returns/:id', async (req, res) => {
    let transaction;
    try {
        const pool = await getPool();
        const retRes = await pool.request()
            .input('del_rid', sql.Int, req.params.id)
            .query(`SELECT * FROM purchase_returns WHERE id = @del_rid`);
        const pret = retRes.recordset[0];
        if (!pret) {
            return res.status(404).json({ success: false, message: 'المرتجع غير موجود' });
        }
        if (pret.status === 'cancelled' || pret.status === 'deleted') {
            return res.status(400).json({ success: false, message: 'المرتجع ملغي أو محذوف مسبقاً' });
        }

        // ── Permission check ──
        const isManual = pret.source_type === 'manual';
        if (isManual && !userHasPermission(req, 'purchase.free_return.delete')) {
            return res.status(403).json({ success: false, message: 'لا تملك صلاحية حذف مرتجع يدوي' });
        }
        if (!isManual && !userHasPermission(req, 'purchase_returns.delete')) {
            return res.status(403).json({ success: false, message: 'لا تملك صلاحية حذف مرتجعات الشراء' });
        }

        // ── Date-based blockers ──
        const blockers = [];

        // 1. Later returns (by date, then by id) on the same invoice (linked returns only)
        if (pret.invoice_id) {
            const laterRetRes = await pool.request()
                .input('del_iid', sql.Int, pret.invoice_id)
                .input('del_rdate', sql.NVarChar, pret.return_date)
                .input('del_rid', sql.Int, req.params.id)
                .query(`SELECT COUNT(*) as cnt FROM purchase_returns WHERE invoice_id = @del_iid AND status NOT IN ('cancelled', 'deleted') AND (return_date > @del_rdate OR (return_date = @del_rdate AND id > @del_rid))`);
            if (laterRetRes.recordset[0].cnt > 0) {
                blockers.push(`مرتجعات لاحقة (${laterRetRes.recordset[0].cnt})`);
            }
        }

        // 2. Later stock movements for the same products in the same store
        const laterStockRes = await pool.request()
            .input('del_rid', sql.Int, req.params.id)
            .query(`
                SELECT COUNT(*) as cnt FROM stock_movements sm
                INNER JOIN purchase_return_items pri ON pri.product_id = sm.product_id
                WHERE pri.return_id = @del_rid
                AND sm.store_id = (SELECT store_id FROM purchase_returns WHERE id = @del_rid)
                AND sm.move_type != 'purchase_return'
                AND sm.move_date > (SELECT return_date FROM purchase_returns WHERE id = @del_rid)
            `);
        if (laterStockRes.recordset[0].cnt > 0) {
            blockers.push(`حركات مخزون لاحقة (${laterStockRes.recordset[0].cnt})`);
        }

        // 3. Linked invoice payments check
        if (pret.invoice_id) {
            const invDetail = await pool.request()
                .input('del_iid', sql.Int, pret.invoice_id)
                .query(`SELECT amount_paid, grand_total FROM purchase_invoices WHERE id = @del_iid`);
            const invPay = invDetail.recordset[0];
            if (invPay) {
                const totalPaid = parseFloat(invPay.amount_paid || 0);
                const invoiceGrand = parseFloat(invPay.grand_total || 0);
                const otherRetRes = await pool.request()
                    .input('del_iid', sql.Int, pret.invoice_id)
                    .input('del_rid', sql.Int, req.params.id)
                    .query(`SELECT ISNULL(SUM(grand_total), 0) as total FROM purchase_returns WHERE invoice_id = @del_iid AND status NOT IN ('cancelled', 'deleted') AND id != @del_rid`);
                const otherReturnsTotal = parseFloat(otherRetRes.recordset[0]?.total || 0);
                const expectedInvValue = invoiceGrand - otherReturnsTotal;
                if (totalPaid > expectedInvValue) {
                    blockers.push('مدفوعات مسجلة تتجاوز صافي الفاتورة');
                }
            }
        }

        if (blockers.length > 0) {
            return res.status(400).json({ success: false, message: 'لا يمكن حذف المرتجع لأنه مرتبط بـ: ' + blockers.join(', ') });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        // ── Reverse stock + recalc WAC ──
        const itemsRes = await txRequest
            .input('del_rid', sql.Int, req.params.id)
            .query(`SELECT pri.*, p.cost_price as current_wac FROM purchase_return_items pri JOIN products p ON pri.product_id = p.id WHERE pri.return_id = @del_rid`);
        for (const item of itemsRes.recordset) {
            const balAfter = await updateStockBalanceAsync(txRequest, pret.store_id, item.product_id, parseFloat(item.quantity));

            const wacReq = transaction.request();
            const wRnd = Math.random().toString(36).substring(2, 7);
            wacReq.input(`wac_pid_${wRnd}`, sql.Int, item.product_id);
            const wacRes = await wacReq.query(`
                SELECT ISNULL(SUM(ib.quantity), 0) as total_qty
                FROM inventory_balances ib
                WHERE ib.product_id = @wac_pid_${wRnd}
            `);
            const currentQty = parseFloat(wacRes.recordset[0]?.total_qty || 0);
            if (currentQty > 0) {
                const wacUpdate = transaction.request();
                wacUpdate.input(`wac_pid_${wRnd}`, sql.Int, item.product_id);
                wacUpdate.input(`wac_cost_${wRnd}`, sql.Decimal(18, 2), item.cost_price_snapshot || item.cost_price);
                await wacUpdate.query(`UPDATE products SET cost_price = @wac_cost_${wRnd} WHERE id = @wac_pid_${wRnd}`);
            }

            const smReq = transaction.request();
            const rnd = Math.random().toString(36).substring(2, 7);
            smReq.input(`smd_${rnd}`, sql.NVarChar, pret.return_date || new Date().toISOString().slice(0, 10));
            smReq.input(`smn_${rnd}`, sql.NVarChar, pret.return_no);
            smReq.input(`sms_${rnd}`, sql.Int, pret.store_id);
            smReq.input(`smp_${rnd}`, sql.Int, item.product_id);
            smReq.input(`smq_${rnd}`, sql.Decimal(18, 4), item.quantity);
            smReq.input(`smc_${rnd}`, sql.Decimal(18, 4), item.cost_price);
            smReq.input(`smb_${rnd}`, sql.Decimal(18, 4), balAfter);
            smReq.input(`smr_${rnd}`, sql.Int, req.params.id);
            await smReq.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes)
                VALUES (@smd_${rnd}, 'return_reversal', @smn_${rnd}, @sms_${rnd}, @smp_${rnd}, @smq_${rnd}, @smc_${rnd}, @smb_${rnd}, @smr_${rnd}, N'إلغاء مرتجع مشتريات')
            `);
        }

        // ── Reverse accounting entries ──
        const jeRes = await txRequest.query(`
            SELECT id, source_action FROM journal_entries
            WHERE source_module = 'purchase_return' AND source_document = '${pret.return_no}'
        `);
        for (const je of jeRes.recordset) {
            await reverseJournalEntryAsync(txRequest, je.id, `إلغاء قيد مرتجع المشتريات ${pret.return_no}`, req.user ? req.user.id : null);
        }

        // ── Soft-delete the return ──
        await txRequest.query(`UPDATE purchase_returns SET status = 'deleted' WHERE id = @del_rid`);

        // ── Recalc supplier balance ──
        if (pret.supplier_id) {
            await recalcSupplierBalanceAsync(txRequest, pret.supplier_id);
        }

        // ── Recalc invoice return status ──
        if (pret.invoice_id) {
            await updatePurchaseReturnStatusAsync(txRequest, pret.invoice_id);
        }

        await transaction.commit();
        await logActivity(req, 'DELETE', 'purchase_returns', pret.return_no, `حذف مرتجع شراء ${pret.return_no}`, { return_no: pret.return_no, grand_total: pret.grand_total, source_type: pret.source_type }, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم حذف مرتجع الشراء وعكس التأثيرات بنجاح' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logDetailedError('Purchase Return DELETE', err);
        await logActivity(req, 'DELETE', 'purchase_returns', req.params.id, 'حذف مرتجع شراء', null, null, 'FAILED', err.message);
        res.status(500).json({ success: false, message: 'خطأ في حذف مرتجع الشراء', error_detail: err.message });
    }
});

// ── PUT Purchase Return (Edit) ──
router.put('/returns/:id', async (req, res) => {
    const { supplier_id, invoice_id, return_date, store_id, reason_id, reason_note, notes, items } = req.body;
    const retId = parseInt(req.params.id);

    let transaction;
    try {
        const pool = await getPool();

        // Fetch existing return
        const existRes = await pool.request().input('eid', sql.Int, retId).query('SELECT * FROM purchase_returns WHERE id = @eid');
        const existing = existRes.recordset[0];
        if (!existing) return res.status(404).json({ success: false, message: 'المرتجع غير موجود' });
        if (existing.status === 'cancelled' || existing.status === 'deleted') {
            return res.status(400).json({ success: false, message: 'لا يمكن تعديل مرتجع ملغي أو محذوف' });
        }

        // Permission check
        const isManual = existing.source_type === 'manual';
        if (isManual && !userHasPermission(req, 'purchase.free_return.edit')) {
            return res.status(403).json({ success: false, message: 'لا تملك صلاحية تعديل مرتجع يدوي' });
        }
        if (!isManual && !userHasPermission(req, 'purchase_returns.update')) {
            return res.status(403).json({ success: false, message: 'لا تملك صلاحية تعديل مرتجعات الشراء' });
        }

        // Date-based blockers
        const blockers = [];
        if (existing.invoice_id) {
            const laterRetRes = await pool.request()
                .input('eid', sql.Int, retId).input('eidate', sql.NVarChar, existing.return_date)
                .query(`SELECT COUNT(*) as cnt FROM purchase_returns WHERE invoice_id = (SELECT invoice_id FROM purchase_returns WHERE id = @eid) AND status NOT IN ('cancelled', 'deleted') AND (return_date > @eidate OR (return_date = @eidate AND id > @eid))`);
            if (laterRetRes.recordset[0].cnt > 0) blockers.push('مرتجعات لاحقة');
        }
        if (blockers.length > 0) {
            return res.status(400).json({ success: false, message: 'لا يمكن تعديل المرتجع: ' + blockers.join(', ') });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        // Reverse old items
        const oldItemsRes = await txRequest.input('old_rid', sql.Int, retId).query('SELECT * FROM purchase_return_items WHERE return_id = @old_rid');
        for (const item of oldItemsRes.recordset) {
            await updateStockBalanceAsync(transaction.request(), existing.store_id, item.product_id, parseFloat(item.quantity));
        }
        // Delete old stock movements
        await txRequest.query(`DELETE FROM stock_movements WHERE move_type = 'purchase_return' AND reference_id = @old_rid`);
        // Delete old items
        await txRequest.query('DELETE FROM purchase_return_items WHERE return_id = @old_rid');
        // Reverse old accounting
        const oldJE = await txRequest.query(`SELECT id FROM journal_entries WHERE source_module = 'purchase_return' AND source_document = '${existing.return_no}'`);
        for (const je of oldJE.recordset) {
            await reverseJournalEntryAsync(txRequest, je.id, `تعديل مرتجع ${existing.return_no}`, req.user ? req.user.id : null);
        }

        // Build new items
        let returnSubtotal = 0;
        let enrichedItems = [];

        if (isManual) {
            // Manual return: validate inventory + snapshot from products
            for (const it of items) {
                const chkReq = transaction.request();
                const pRand = Math.random().toString(36).substring(2, 7);
                chkReq.input(`chk_pid_${pRand}`, sql.Int, it.product_id);
                chkReq.input(`chk_sid_${pRand}`, sql.Int, store_id || existing.store_id);
                const chkRes = await chkReq.query(`
                    SELECT ISNULL(ib.quantity, 0) as qty FROM inventory_balances ib
                    WHERE ib.product_id = @chk_pid_${pRand} AND ib.store_id = @chk_sid_${pRand}
                `);
                const availableQty = parseFloat(chkRes.recordset[0]?.qty || 0) + parseFloat(existing.grand_total > 0 ? (oldItemsRes.recordset.find(o => o.product_id === it.product_id)?.quantity || 0) : 0);
                if (parseFloat(it.quantity) > availableQty + 0.0001) {
                    throw new Error(`QTY_INSUFFICIENT:${it.product_id}:${availableQty}:${it.quantity}`);
                }
            }
            const productIds = [...new Set(items.map(i => i.product_id))];
            const placeholders = productIds.map((_, idx) => `@sp_${idx}`).join(',');
            const snapReq = transaction.request();
            productIds.forEach((pid, idx) => snapReq.input(`sp_${idx}`, sql.Int, pid));
            const snapRes = await snapReq.query(`SELECT id, cost_price FROM products WHERE id IN (${placeholders})`);
            const snapMap = {};
            snapRes.recordset.forEach(r => { snapMap[r.id] = r; });
            enrichedItems = items.map(it => {
                const snap = snapMap[it.product_id];
                if (!snap) throw new Error(`PRODUCT_NOT_FOUND:${it.product_id}`);
                const cost = parseFloat(snap.cost_price) || 0;
                const lt = parseFloat(it.quantity) * cost;
                returnSubtotal += lt;
                return { product_id: it.product_id, quantity: parseFloat(it.quantity), cost_price: cost, line_total: lt };
            });
        } else {
            // Linked return: validate against invoice
            const origItemsRes = await txRequest.query(`SELECT id, product_id, quantity, cost_price FROM purchase_invoice_items WHERE invoice_id = ${existing.invoice_id}`);
            const invoiceItemMap = {};
            origItemsRes.recordset.forEach(r => { invoiceItemMap[r.product_id] = r; });
            const prevReturnsRes = await txRequest.query(`
                SELECT pri.product_id, COALESCE(SUM(pri.quantity), 0) as returned
                FROM purchase_return_items pri
                INNER JOIN purchase_returns pr ON pr.id = pri.return_id
                WHERE pr.invoice_id = ${existing.invoice_id} AND pr.status NOT IN ('cancelled', 'deleted') AND pr.id != @old_rid
                GROUP BY pri.product_id
            `);
            const prevMap = {};
            prevReturnsRes.recordset.forEach(r => { prevMap[r.product_id] = parseFloat(r.returned) || 0; });
            enrichedItems = items.map(it => {
                const orig = invoiceItemMap[it.product_id];
                if (!orig) throw new Error(`PRODUCT_NOT_FOUND:${it.product_id}`);
                const purchased = parseFloat(orig.quantity) || 0;
                const prevReturned = prevMap[it.product_id] || 0;
                const remainingReturnable = purchased - prevReturned;
                if (parseFloat(it.quantity) > remainingReturnable + 0.0001) {
                    throw new Error(`QTY_EXCEEDED:${it.product_id}:${purchased}:${prevReturned}:${remainingReturnable}`);
                }
                const cost = parseFloat(orig.cost_price) || 0;
                const lt = parseFloat(it.quantity) * cost;
                returnSubtotal += lt;
                return { product_id: it.product_id, quantity: parseFloat(it.quantity), cost_price: cost, line_total: lt, original_invoice_item_id: orig.id };
            });
        }

        const returnGrandTotal = isManual ? returnSubtotal : (function() {
            const invRes2 = txRequest; // already have invoice
            return returnSubtotal; // simplified for linked too
        })();
        const rDate = return_date || existing.return_date;
        const sid = supplier_id || existing.supplier_id;
        const stoId = store_id || existing.store_id;

        // Update header
        const uReq = transaction.request();
        uReq.input('ur_id', sql.Int, retId);
        uReq.input('ur_date', sql.NVarChar, rDate);
        uReq.input('ur_sid', sql.Int, sid);
        uReq.input('ur_stid', sql.Int, stoId);
        uReq.input('ur_sub', sql.Decimal(18, 4), returnSubtotal);
        uReq.input('ur_total', sql.Decimal(18, 4), returnGrandTotal);
        uReq.input('ur_rid', sql.Int, reason_id || null);
        uReq.input('ur_rnote', sql.NVarChar, reason_note || '');
        uReq.input('ur_notes', sql.NVarChar, notes || '');
        await uReq.query(`
            UPDATE purchase_returns SET
                supplier_id = @ur_sid, return_date = @ur_date, store_id = @ur_stid,
                subtotal = @ur_sub, grand_total = @ur_total,
                reason_id = @ur_rid, reason_note = @ur_rnote, notes = @ur_notes
            WHERE id = @ur_id
        `);

        // Insert new items + stock
        for (let i = 0; i < enrichedItems.length; i++) {
            const ei = enrichedItems[i];
            const itReq = transaction.request();
            itReq.input(`pri_retid_${i}`, sql.Int, retId);
            itReq.input(`pri_pid_${i}`, sql.Int, ei.product_id);
            itReq.input(`pri_qty_${i}`, sql.Decimal(18, 4), ei.quantity);
            itReq.input(`pri_cost_${i}`, sql.Decimal(18, 4), ei.cost_price);
            itReq.input(`pri_lt_${i}`, sql.Decimal(18, 4), ei.line_total);
            if (ei.original_invoice_item_id) {
                itReq.input(`pri_orig_${i}`, sql.Int, ei.original_invoice_item_id);
                await itReq.query(`INSERT INTO purchase_return_items (return_id, product_id, quantity, cost_price, line_total, original_invoice_item_id) VALUES (@pri_retid_${i}, @pri_pid_${i}, @pri_qty_${i}, @pri_cost_${i}, @pri_lt_${i}, @pri_orig_${i})`);
            } else {
                await itReq.query(`INSERT INTO purchase_return_items (return_id, product_id, quantity, cost_price, line_total) VALUES (@pri_retid_${i}, @pri_pid_${i}, @pri_qty_${i}, @pri_cost_${i}, @pri_lt_${i})`);
            }
            const balAfter = await updateStockBalanceAsync(transaction.request(), stoId, ei.product_id, -ei.quantity);
            const smReq = transaction.request();
            smReq.input(`sm_date_${i}`, sql.NVarChar, rDate);
            smReq.input(`sm_docno_${i}`, sql.NVarChar, existing.return_no);
            smReq.input(`sm_sid_${i}`, sql.Int, stoId);
            smReq.input(`sm_pid_${i}`, sql.Int, ei.product_id);
            smReq.input(`sm_qtyout_${i}`, sql.Decimal(18, 4), ei.quantity);
            smReq.input(`sm_cost_${i}`, sql.Decimal(18, 4), ei.cost_price);
            smReq.input(`sm_bal_${i}`, sql.Decimal(18, 4), balAfter);
            smReq.input(`sm_refid_${i}`, sql.Int, retId);
            await smReq.query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, balance_after, reference_id, notes) VALUES (@sm_date_${i}, 'purchase_return', @sm_docno_${i}, @sm_sid_${i}, @sm_pid_${i}, @sm_qtyout_${i}, @sm_cost_${i}, @sm_bal_${i}, @sm_refid_${i}, N'مرتجع مشتريات')`);
        }

        // Re-post accounting
        if (returnGrandTotal > 0) {
            const accAP = await getSystemAccountAsync(transaction.request(), 'SYS_AP');
            const accInv = await getSystemAccountAsync(transaction.request(), 'SYS_INVENTORY');
            await postJournalEntryAsync(transaction.request(), rDate, `مردودات مشتريات معدل ${existing.return_no}`,
                [
                    { account_id: accAP, debit: returnGrandTotal, credit: 0, description: `تخفيض ذمم دائنة لمرتجع معدل ${existing.return_no}` },
                    { account_id: accInv, debit: 0, credit: returnGrandTotal, description: `مردودات مشتريات (مخزون) معدل ${existing.return_no}` }
                ],
                'purchase_return', retId, req.user ? req.user.id : null,
                { module: 'purchase_returns', action: 'edit_return', document: existing.return_no, isSystem: true }
            );
        }

        await recalcSupplierBalanceAsync(transaction.request(), sid);
        if (existing.invoice_id) await updatePurchaseReturnStatusAsync(transaction.request(), existing.invoice_id);

        await transaction.commit();
        res.json({ success: true, message: 'تم تعديل المرتجع بنجاح' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logDetailedError('Purchase Return PUT', err);
        if (err.message && err.message.startsWith('QTY_EXCEEDED:')) {
            const parts = err.message.split(':');
            return res.status(400).json({ success: false, message: `الصنف #${parts[1]}: المتاح للإرجاع ${parts[4]}` });
        }
        if (err.message && err.message.startsWith('QTY_INSUFFICIENT:')) {
            const parts = err.message.split(':');
            return res.status(400).json({ success: false, message: `الصنف #${parts[1]}: الكمية المتاحة ${parts[2]}` });
        }
        res.status(500).json({ success: false, message: 'خطأ في تعديل المرتجع', error_detail: err.message });
    }
});

// ── POST Purchase Return Reverse (void + re-reverse) ──
router.post('/returns/:id/reverse', async (req, res) => {
    const { reason } = req.body;
    const retId = parseInt(req.params.id);

    let transaction;
    try {
        const pool = await getPool();
        const retRes = await pool.request().input('rev_rid', sql.Int, retId).query('SELECT * FROM purchase_returns WHERE id = @rev_rid');
        const pret = retRes.recordset[0];
        if (!pret) return res.status(404).json({ success: false, message: 'المرتجع غير موجود' });
        if (pret.status === 'cancelled' || pret.status === 'deleted') {
            return res.status(400).json({ success: false, message: 'المرتجع ملغي أو محذوف مسبقاً' });
        }

        const isManual = pret.source_type === 'manual';
        if (isManual && !userHasPermission(req, 'purchase.free_return.reverse')) {
            return res.status(403).json({ success: false, message: 'لا تملك صلاحية عكس مرتجع يدوي' });
        }
        if (!isManual && !userHasPermission(req, 'purchase_returns.update')) {
            return res.status(403).json({ success: false, message: 'لا تملك صلاحية عكس مرتجعات الشراء' });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        // Reverse stock
        const itemsRes = await txRequest.input('rev_rid', sql.Int, retId).query('SELECT * FROM purchase_return_items WHERE return_id = @rev_rid');
        for (const item of itemsRes.recordset) {
            const balAfter = await updateStockBalanceAsync(txRequest, pret.store_id, item.product_id, parseFloat(item.quantity));
            const smReq = transaction.request();
            const rnd = Math.random().toString(36).substring(2, 7);
            smReq.input(`smd_${rnd}`, sql.NVarChar, pret.return_date);
            smReq.input(`smn_${rnd}`, sql.NVarChar, pret.return_no);
            smReq.input(`sms_${rnd}`, sql.Int, pret.store_id);
            smReq.input(`smp_${rnd}`, sql.Int, item.product_id);
            smReq.input(`smq_${rnd}`, sql.Decimal(18, 4), item.quantity);
            smReq.input(`smc_${rnd}`, sql.Decimal(18, 4), item.cost_price);
            smReq.input(`smb_${rnd}`, sql.Decimal(18, 4), balAfter);
            smReq.input(`smr_${rnd}`, sql.Int, retId);
            await smReq.query(`INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes) VALUES (@smd_${rnd}, 'return_reversal', @smn_${rnd}, @sms_${rnd}, @smp_${rnd}, @smq_${rnd}, @smc_${rnd}, @smb_${rnd}, @smr_${rnd}, N'عكس مرتجع مشتريات')`);
        }

        // Reverse accounting
        const jeRes = await txRequest.query(`SELECT id FROM journal_entries WHERE source_module = 'purchase_return' AND source_document = '${pret.return_no}'`);
        for (const je of jeRes.recordset) {
            await reverseJournalEntryAsync(txRequest, je.id, `عكس مرتجع ${pret.return_no}`, req.user ? req.user.id : null);
        }

        // Update status to cancelled
        await txRequest.query(`UPDATE purchase_returns SET status = 'cancelled', notes = notes + ' | عكس: ${reason || ''}' WHERE id = @rev_rid`);

        await recalcSupplierBalanceAsync(txRequest, pret.supplier_id);
        if (pret.invoice_id) await updatePurchaseReturnStatusAsync(txRequest, pret.invoice_id);

        await transaction.commit();
        await logActivity(req, 'UPDATE', 'purchase_returns', pret.return_no, `عكس مرتجع ${pret.return_no}`, null, null, 'SUCCESS', reason);
        res.json({ success: true, message: 'تم عكس المرتجع بنجاح' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logDetailedError('Purchase Return reverse', err);
        res.status(500).json({ success: false, message: 'خطأ في عكس المرتجع', error_detail: err.message });
    }
});

// ── GET Purchase Return Reasons ──
router.get('/returns/reasons/list', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`SELECT code AS id, label_ar AS reason_name, is_active FROM return_reasons WHERE is_active = 1 ORDER BY code`);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logDetailedError('Purchase Return Reasons', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب أسباب المرتجع', error_detail: err.message });
    }
}));

module.exports = router;
