// ============================================================
// ROUTE: Purchase Returns
// ============================================================
const router = require('express').Router();
const { getPool, sql } = require('../../database/mssql_db');
const asyncHandler = require('../../utils/asyncHandler');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync, recalcSupplierBalanceAsync } = require('../../services/accountingEngine');
const { updateStockBalanceAsync } = require('../../services/stockEngine');
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
                const accInv = await getSystemAccountAsync(transaction.request(), 'SYS_INVENTORY');
                let accVatInput = null;
                if (returnTax > 0) {
                    try { accVatInput = await getSystemAccountAsync(transaction.request(), 'SYS_VAT_INPUT'); } catch (e) {}
                }
                const lines = [
                    { account_id: accAP, debit: returnGrandTotal, credit: 0, description: `تخفيض ذمم دائنة لمرتجع مشتريات ${retNo}` }
                ];
                if (returnTax > 0 && accVatInput) {
                    lines.push({ account_id: accInv, debit: 0, credit: returnSubtotal - returnDiscount, description: `مردودات مشتريات (مخزون) ${retNo}` });
                    lines.push({ account_id: accVatInput, debit: 0, credit: returnTax, description: `عكس ضريبة مدخلات لمرتجع ${retNo}` });
                } else {
                    lines.push({ account_id: accInv, debit: 0, credit: returnGrandTotal, description: `مردودات مشتريات (مخزون) ${retNo}` });
                }
                await postJournalEntryAsync(
                    transaction.request(), rDate, `مردودات مشتريات ${retNo}`,
                    lines,
                    'purchase_return', returnId, req.user ? req.user.id : null,
                    { module: 'purchase_returns', action: 'create_return', document: retNo, isSystem: true }
                );
            }

            await updatePurchaseReturnStatusAsync(transaction.request(), invoice_id);

        } else {
            // ── MANUAL (free) return: no invoice linked ──
            // Validate inventory with UPDLOCK/HOLDLOCK
            for (const it of items) {
                const chkReq = transaction.request();
                const pRand = Math.random().toString(36).substring(2, 7);
                chkReq.input(`chk_pid_${pRand}`, sql.Int, it.product_id);
                chkReq.input(`chk_sid_${pRand}`, sql.Int, store_id);
                const chkRes = await chkReq.query(`
                    SELECT ISNULL(ib.quantity, 0) as qty
                    FROM products p WITH (UPDLOCK, HOLDLOCK)
                    LEFT JOIN inventory_balances ib WITH (UPDLOCK, HOLDLOCK) ON ib.product_id = p.id AND ib.store_id = @chk_sid_${pRand}
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

            // Accounting: Debit AP, Credit Purchase Returns
            if (returnGrandTotal > 0) {
                const accAP = await getSystemAccountAsync(transaction.request(), 'SYS_AP');
                const accInv = await getSystemAccountAsync(transaction.request(), 'SYS_INVENTORY');
                await postJournalEntryAsync(
                    transaction.request(), rDate, `مردودات مشتريات يدوي ${retNo}`,
                    [
                        { account_id: accAP, debit: returnGrandTotal, credit: 0, description: `تخفيض ذمم دائنة لمرتجع يدوي ${retNo}` },
                        { account_id: accInv, debit: 0, credit: returnGrandTotal, description: `مردودات مشتريات (مخزون) يدوي ${retNo}` }
                    ],
                    'purchase_return', returnId, req.user ? req.user.id : null,
                    { module: 'purchase_returns', action: 'create_manual_return', document: retNo, isSystem: true }
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

        const returnGrandTotal = isManual ? returnSubtotal : returnSubtotal;
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
