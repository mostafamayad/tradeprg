// ============================================================
// ROUTE: Inventory (المخزون)
// GET  /api/inventory/balances           - أرصدة المخزون
// GET  /api/inventory/movements          - حركات المخزون
// GET  /api/inventory/movements/:product - حركة صنف معين
// GET  /api/inventory/transfers          - التحويلات بين المخازن
// POST /api/inventory/transfers          - تحويل بين مخازن
// GET  /api/inventory/damaged            - التالف
// POST /api/inventory/damaged            - تسجيل تالف
// POST /api/inventory/adjust             - تعديل مخزون
// GET  /api/inventory/count              - الجرد الفعلي
// POST /api/inventory/count              - بدء جرد
// ============================================================

const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync } = require('../services/accountingEngine');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');

// ============================================================
// Private Helpers (isolated from helpers.js to avoid breaking
// unmigrated modules that still depend on the SQLite version)
// ============================================================

// Replicates helpers.nextDocNo() — must run inside an existing transaction
// Uses UPDLOCK to prevent two concurrent transactions from getting the same number
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

async function updateStockBalanceAsync(txRequest, storeId, productId, qtyChange, suffix, allowNegative = false) {
    const sfx = suffix || `${storeId}_${productId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    txRequest.input(`usb_sid_${sfx}`, sql.Int, storeId);
    txRequest.input(`usb_pid_${sfx}`, sql.Int, productId);
    txRequest.input(`usb_qty_${sfx}`, sql.Decimal(18, 4), qtyChange);

    const checkRes = await txRequest.query(`
        SELECT ib.quantity, p.product_name 
        FROM inventory_balances ib WITH (UPDLOCK) 
        LEFT JOIN products p ON p.id = ib.product_id
        WHERE ib.store_id = @usb_sid_${sfx} AND ib.product_id = @usb_pid_${sfx}
    `);
    
    let currentQty = 0;
    let pName = `الصنف #${productId}`;
    if (!checkRes.recordset[0]) {
        // Fetch product name just in case
        const pRes = await txRequest.query(`SELECT product_name FROM products WHERE id = @usb_pid_${sfx}`);
        pName = pRes.recordset[0] ? pRes.recordset[0].product_name : pName;
        await txRequest.query(`
            INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (@usb_sid_${sfx}, @usb_pid_${sfx}, 0)
        `);
    } else {
        currentQty = checkRes.recordset[0].quantity;
        pName = checkRes.recordset[0].product_name || pName;
    }

    const newQty = currentQty + qtyChange;
    // Allow small float imprecision
    if (!allowNegative && newQty < -0.0001) {
        throw new Error(`الرصيد غير كافٍ للصنف "${pName}". المطلوب: ${Math.abs(qtyChange)}، المتاح: ${currentQty}`);
    }

    await txRequest.query(`
        UPDATE inventory_balances 
        SET quantity = quantity + @usb_qty_${sfx} 
        WHERE store_id = @usb_sid_${sfx} AND product_id = @usb_pid_${sfx}
    `);
    
    return newQty;
}

// ============================================================
// Routes
// ============================================================

// ── Balances (أرصدة المخزون) ────────────────────────────────
router.get('/balances', asyncHandler(async (req, res) => {
    try {
        const { store_id, product_id, low_stock } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let sqlQuery = `SELECT TOP 1000 ib.*, p.product_code, p.product_name, p.unit_name,
                              p.cost_price, p.sell_price, p.min_stock,
                              s.store_name, s.store_code,
                              (ib.quantity * p.cost_price) as total_value
                       FROM inventory_balances ib
                       LEFT JOIN products p ON ib.product_id = p.id
                       LEFT JOIN stores s ON ib.store_id = s.id
                       WHERE 1=1`;

        if (store_id) { sqlQuery += ` AND ib.store_id = @storeId`; request.input('storeId', sql.Int, store_id); }
        if (product_id) { sqlQuery += ` AND ib.product_id = @productId`; request.input('productId', sql.Int, product_id); }
        if (low_stock === '1') { sqlQuery += ` AND ib.quantity <= p.min_stock`; }
        sqlQuery += ` ORDER BY p.product_name`;

        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Inventory balances GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Movements (حركات المخزون) ───────────────────────────────
router.get('/movements', asyncHandler(async (req, res) => {
    try {
        const { store_id, product_id, from, to, move_type } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let sqlQuery = `SELECT TOP 1000 sm.*, p.product_code, p.product_name, p.unit_name, s.store_name
                       FROM stock_movements sm
                       LEFT JOIN products p ON sm.product_id = p.id
                       LEFT JOIN stores s ON sm.store_id = s.id
                       WHERE 1=1`;

        if (store_id) { sqlQuery += ` AND sm.store_id = @storeId`; request.input('storeId', sql.Int, store_id); }
        if (product_id) { sqlQuery += ` AND sm.product_id = @productId`; request.input('productId', sql.Int, product_id); }
        if (from) { sqlQuery += ` AND sm.move_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND sm.move_date <= @to`; request.input('to', sql.NVarChar, to); }
        if (move_type) { sqlQuery += ` AND sm.move_type = @moveType`; request.input('moveType', sql.NVarChar, move_type); }
        sqlQuery += ` ORDER BY sm.id DESC`;

        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Inventory movements GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Product Card (بطاقة الصنف) ──────────────────────────────
router.get('/card/:productId', asyncHandler(async (req, res) => {
    try {
        const productId = req.params.productId;
        const pool = await getPool();
        const request = pool.request();
        request.input('productId', sql.Int, productId);

        const prodRes = await request.query(`
            SELECT p.*, c.category_name,
                (SELECT COALESCE(SUM(quantity), 0) FROM inventory_balances WHERE product_id = p.id) as total_stock,
                (SELECT COALESCE(SUM(quantity * cost_price), 0) FROM inventory_balances WHERE product_id = p.id) as stock_value
            FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = @productId
        `);
        const product = prodRes.recordset[0];
        if (!product) return res.status(404).json({ success: false, message: 'الصنف غير موجود' });

        const storeBalancesRes = await request.query(`
            SELECT ib.*, s.store_name FROM inventory_balances ib
            LEFT JOIN stores s ON ib.store_id = s.id WHERE ib.product_id = @productId
        `);

        const movementsRes = await request.query(`
            SELECT TOP 200 sm.*, s.store_name FROM stock_movements sm
            LEFT JOIN stores s ON sm.store_id = s.id WHERE sm.product_id = @productId
            ORDER BY sm.move_date DESC, sm.id DESC
        `);

        res.json({ success: true, data: { ...product, storeBalances: storeBalancesRes.recordset, movements: movementsRes.recordset } });
    } catch (err) {
        console.error('Inventory card GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Stock Transfer (تحويل بين مخازن) ───────────────────────
router.post('/transfer', async (req, res) => {
    const { from_store_id, to_store_id, transfer_date, notes, items } = req.body;
    if (!from_store_id || !to_store_id) {
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', 'يجب تحديد المخازن');
        return res.status(400).json({ success: false, message: 'يجب تحديد المخازن' });
    }
    if (from_store_id === to_store_id) {
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', 'لا يمكن التحويل لنفس المخزن');
        return res.status(400).json({ success: false, message: 'لا يمكن التحويل لنفس المخزن' });
    }
    if (!items || items.length === 0) {
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', 'لا توجد أصناف للتحويل');
        return res.status(400).json({ success: false, message: 'لا توجد أصناف للتحويل' });
    }

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        const transferNo = await nextDocNoAsync(txRequest, 'transfer');
        const tDate = transfer_date || new Date().toISOString().slice(0, 10);

        const transferRes = await txRequest
            .input('transferNo', sql.NVarChar, transferNo)
            .input('tDate', sql.NVarChar, tDate)
            .input('fromStoreId', sql.Int, from_store_id)
            .input('toStoreId', sql.Int, to_store_id)
            .input('tNotes', sql.NVarChar, notes || '')
            .query(`
                INSERT INTO stock_transfers (transfer_no, transfer_date, from_store_id, to_store_id, notes, status)
                OUTPUT INSERTED.id
                VALUES (@transferNo, @tDate, @fromStoreId, @toStoreId, @tNotes, 'posted')
            `);
        const transferId = transferRes.recordset[0].id;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            txRequest.input(`ti_tid_${i}`, sql.Int, transferId);
            txRequest.input(`ti_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`ti_qty_${i}`, sql.Decimal(18, 4), item.quantity);

            await txRequest.query(`
                INSERT INTO stock_transfer_items (transfer_id, product_id, quantity)
                VALUES (@ti_tid_${i}, @ti_pid_${i}, @ti_qty_${i})
            `);

            // Get product cost price
            txRequest.input(`pcost_${i}`, sql.Int, item.product_id);
            const pRes = await txRequest.query(`SELECT cost_price FROM products WHERE id = @pcost_${i}`);
            const cost = pRes.recordset[0] ? pRes.recordset[0].cost_price : 0;

            // Deduct from source store
            const balOut = await updateStockBalanceAsync(txRequest, from_store_id, item.product_id, -item.quantity, `out_${i}`);
            txRequest.input(`sm_out_date_${i}`, sql.NVarChar, tDate);
            txRequest.input(`sm_out_docno_${i}`, sql.NVarChar, transferNo);
            txRequest.input(`sm_out_fsid_${i}`, sql.Int, from_store_id);
            txRequest.input(`sm_out_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`sm_out_qty_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`sm_out_refid_${i}`, sql.Int, transferId);
            txRequest.input(`sm_out_cost_${i}`, sql.Decimal(18, 2), cost);
            txRequest.input(`sm_out_bal_${i}`, sql.Decimal(18, 4), balOut);
            txRequest.input(`sm_out_notes_${i}`, sql.NVarChar, `تحويل إلى مخزن ${to_store_id}`);
            await txRequest.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, balance_after, reference_id, notes)
                VALUES (@sm_out_date_${i}, 'transfer', @sm_out_docno_${i}, @sm_out_fsid_${i}, @sm_out_pid_${i}, @sm_out_qty_${i}, @sm_out_cost_${i}, @sm_out_bal_${i}, @sm_out_refid_${i}, @sm_out_notes_${i})
            `);

            // Add to destination store
            const balIn = await updateStockBalanceAsync(txRequest, to_store_id, item.product_id, item.quantity, `in_${i}`);
            txRequest.input(`sm_in_date_${i}`, sql.NVarChar, tDate);
            txRequest.input(`sm_in_docno_${i}`, sql.NVarChar, transferNo);
            txRequest.input(`sm_in_tsid_${i}`, sql.Int, to_store_id);
            txRequest.input(`sm_in_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`sm_in_qty_${i}`, sql.Decimal(18, 4), item.quantity);
            txRequest.input(`sm_in_refid_${i}`, sql.Int, transferId);
            txRequest.input(`sm_in_cost_${i}`, sql.Decimal(18, 2), cost);
            txRequest.input(`sm_in_bal_${i}`, sql.Decimal(18, 4), balIn);
            txRequest.input(`sm_in_notes_${i}`, sql.NVarChar, `تحويل من مخزن ${from_store_id}`);
            await txRequest.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes)
                VALUES (@sm_in_date_${i}, 'transfer', @sm_in_docno_${i}, @sm_in_tsid_${i}, @sm_in_pid_${i}, @sm_in_qty_${i}, @sm_in_cost_${i}, @sm_in_bal_${i}, @sm_in_refid_${i}, @sm_in_notes_${i})
            `);
        }

        await transaction.commit();
        logActivity(req, 'UPDATE', 'inventory', transferNo, `تحويل مخزون من مخزن ${from_store_id} إلى ${to_store_id}`, null, { from_store_id, to_store_id, items_count: items.length, transfer_no: transferNo }, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم تسجيل التحويل', id: transferId });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', err.message);
        console.error('Inventory transfer POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Damaged Stock (تالف) ────────────────────────────────────
router.get('/damaged', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT TOP 500 d.*, p.product_name, p.product_code, s.store_name
            FROM damaged_stock d
            LEFT JOIN products p ON d.product_id = p.id
            LEFT JOIN stores s ON d.store_id = s.id
            ORDER BY d.id DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Inventory damaged GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.post('/damaged', async (req, res) => {
    const { store_id, product_id, quantity, doc_date, reason, notes } = req.body;
    if (!store_id || !product_id || !quantity) {
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', 'بيانات ناقصة');
        return res.status(400).json({ success: false, message: 'بيانات ناقصة' });
    }

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        const docNo = await nextDocNoAsync(txRequest, 'damaged');
        const dDate = doc_date || new Date().toISOString().slice(0, 10);

        const damRes = await txRequest
            .input('docNo', sql.NVarChar, docNo)
            .input('dDate', sql.NVarChar, dDate)
            .input('storeId', sql.Int, store_id)
            .input('productId', sql.Int, product_id)
            .input('quantity', sql.Decimal(18, 4), quantity)
            .input('reason', sql.NVarChar, reason || '')
            .input('dNotes', sql.NVarChar, notes || '')
            .query(`
                INSERT INTO damaged_stock (doc_no, doc_date, store_id, product_id, quantity, reason, notes, status)
                OUTPUT INSERTED.id
                VALUES (@docNo, @dDate, @storeId, @productId, @quantity, @reason, @dNotes, 'posted')
            `);
        const id = damRes.recordset[0].id;

        // Get product cost price
        txRequest.input('d_pcost', sql.Int, product_id);
        const pRes = await txRequest.query(`SELECT cost_price FROM products WHERE id = @d_pcost`);
        const cost = pRes.recordset[0] ? pRes.recordset[0].cost_price : 0;

        const balAfter = await updateStockBalanceAsync(txRequest, store_id, product_id, -quantity, 'dam');
        txRequest.input('sm_dam_date', sql.NVarChar, dDate);
        txRequest.input('sm_dam_docno', sql.NVarChar, docNo);
        txRequest.input('sm_dam_sid', sql.Int, store_id);
        txRequest.input('sm_dam_pid', sql.Int, product_id);
        txRequest.input('sm_dam_qty', sql.Decimal(18, 4), quantity);
        txRequest.input('sm_dam_refid', sql.Int, id);
        txRequest.input('sm_dam_cost', sql.Decimal(18, 2), cost);
        txRequest.input('sm_dam_bal', sql.Decimal(18, 4), balAfter);
        txRequest.input('sm_dam_notes', sql.NVarChar, reason || 'تالف');
        await txRequest.query(`
            INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, balance_after, reference_id, notes)
            VALUES (@sm_dam_date, 'damaged', @sm_dam_docno, @sm_dam_sid, @sm_dam_pid, @sm_dam_qty, @sm_dam_cost, @sm_dam_bal, @sm_dam_refid, @sm_dam_notes)
        `);

        // --- ACCOUNTING INTEGRATION: Damaged inventory ---
        const damValue = Math.abs(quantity) * cost;
        if (damValue > 0) {
            const accDamaged = await getSystemAccountAsync(txRequest, 'SYS_DAMAGED_INVENTORY');
            const accInv = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY');
            const damLines = [
                { account_id: accDamaged, debit: damValue, credit: 0, description: `تالف مخزون ${docNo}` },
                { account_id: accInv, debit: 0, credit: damValue, description: `صرف تالف من المخزون ${docNo}` }
            ];
            await postJournalEntryAsync(
                txRequest, dDate, `تسجيل مخزون تالف ${docNo}`, damLines,
                'inventory_damaged', id, req.user ? req.user.id : null,
                { module: 'inventory', action: 'create_damaged', document: docNo, isSystem: true }
            );
        }

        await transaction.commit();
        logActivity(req, 'UPDATE', 'inventory', docNo, `تسجيل تالف - الصنف ${product_id}`, null, { store_id, product_id, quantity, reason, doc_no: docNo }, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم تسجيل التالف', id });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', err.message);
        console.error('Inventory damaged POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Stock Adjustment (تعديل مخزون) ──────────────────────────
router.post('/adjust', async (req, res) => {
    const { store_id, product_id, quantity, adj_date, reason } = req.body;
    if (!store_id || !product_id || quantity === undefined) {
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', 'بيانات ناقصة');
        return res.status(400).json({ success: false, message: 'بيانات ناقصة' });
    }

    if (!req.user || req.user.role !== 'admin') {
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', 'محاولة تعديل مخزون بدون صلاحية أدمن');
        return res.status(403).json({ success: false, message: 'تعديل المخزون مسموح للإدارة فقط' });
    }

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        const adjNo = await nextDocNoAsync(txRequest, 'adjustment');
        const aDate = adj_date || new Date().toISOString().slice(0, 10);

        const adjRes = await txRequest
            .input('adjNo', sql.NVarChar, adjNo)
            .input('aDate', sql.NVarChar, aDate)
            .input('storeId', sql.Int, store_id)
            .input('productId', sql.Int, product_id)
            .input('quantity', sql.Decimal(18, 4), quantity)
            .input('reason', sql.NVarChar, reason || '')
            .query(`
                INSERT INTO stock_adjustments (adj_no, adj_date, store_id, product_id, quantity, reason, status)
                OUTPUT INSERTED.id
                VALUES (@adjNo, @aDate, @storeId, @productId, @quantity, @reason, 'posted')
            `);
        const id = adjRes.recordset[0].id;

        // Get product cost price
        txRequest.input('adj_pcost', sql.Int, product_id);
        const pRes = await txRequest.query(`SELECT cost_price FROM products WHERE id = @adj_pcost`);
        const cost = pRes.recordset[0] ? pRes.recordset[0].cost_price : 0;

        const balAfter = await updateStockBalanceAsync(txRequest, store_id, product_id, quantity, 'adj');

        const qtyIn = quantity >= 0 ? quantity : 0;
        const qtyOut = quantity < 0 ? Math.abs(quantity) : 0;
        txRequest.input('sm_adj_date', sql.NVarChar, aDate);
        txRequest.input('sm_adj_docno', sql.NVarChar, adjNo);
        txRequest.input('sm_adj_sid', sql.Int, store_id);
        txRequest.input('sm_adj_pid', sql.Int, product_id);
        txRequest.input('sm_adj_qtyIn', sql.Decimal(18, 4), qtyIn);
        txRequest.input('sm_adj_qtyOut', sql.Decimal(18, 4), qtyOut);
        txRequest.input('sm_adj_refid', sql.Int, id);
        txRequest.input('sm_adj_cost', sql.Decimal(18, 2), cost);
        txRequest.input('sm_adj_bal', sql.Decimal(18, 4), balAfter);
        txRequest.input('sm_adj_notes', sql.NVarChar, reason || 'تعديل جرد');
        await txRequest.query(`
            INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, qty_out, cost_price, balance_after, reference_id, notes)
            VALUES (@sm_adj_date, 'adjustment', @sm_adj_docno, @sm_adj_sid, @sm_adj_pid, @sm_adj_qtyIn, @sm_adj_qtyOut, @sm_adj_cost, @sm_adj_bal, @sm_adj_refid, @sm_adj_notes)
        `);

        // --- ACCOUNTING INTEGRATION: Stock adjustment ---
        const adjValue = Math.abs(quantity) * cost;
        if (adjValue > 0) {
            const accInv = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY');
            if (quantity > 0) {
                const accSurplus = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY_SURPLUS');
                const adjLines = [
                    { account_id: accInv, debit: adjValue, credit: 0, description: `زيادة مخزون ${adjNo}` },
                    { account_id: accSurplus, debit: 0, credit: adjValue, description: `فائض مخزون ${adjNo}` }
                ];
                await postJournalEntryAsync(
                    txRequest, aDate, `تسوية زيادة مخزون ${adjNo}`, adjLines,
                    'inventory_adjust', id, req.user ? req.user.id : null,
                    { module: 'inventory', action: 'create_adjustment', document: adjNo, isSystem: true }
                );
            } else {
                const accShortage = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY_SHORTAGE');
                const adjLines = [
                    { account_id: accShortage, debit: adjValue, credit: 0, description: `عجز مخزون ${adjNo}` },
                    { account_id: accInv, debit: 0, credit: adjValue, description: `صرف عجز من المخزون ${adjNo}` }
                ];
                await postJournalEntryAsync(
                    txRequest, aDate, `تسوية عجز مخزون ${adjNo}`, adjLines,
                    'inventory_adjust', id, req.user ? req.user.id : null,
                    { module: 'inventory', action: 'create_adjustment', document: adjNo, isSystem: true }
                );
            }
        }

        await transaction.commit();
        logActivity(req, 'UPDATE', 'inventory', adjNo, `تعديل مخزون - الصنف ${product_id}`, null, { store_id, product_id, quantity, reason, adj_no: adjNo }, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم تعديل المخزون', id });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', err.message);
        console.error('Inventory adjust POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Stock Count (جرد) ───────────────────────────────────────
router.get('/count', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`SELECT TOP 100 * FROM stock_count ORDER BY id DESC`);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Inventory count GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.post('/count/start', async (req, res) => {
    const { store_id, count_date, notes } = req.body;
    if (!store_id) {
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', 'المخزن مطلوب');
        return res.status(400).json({ success: false, message: 'المخزن مطلوب' });
    }

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        const countNo = await nextDocNoAsync(txRequest, 'count');
        const cDate = count_date || new Date().toISOString().slice(0, 10);

        const countRes = await txRequest
            .input('countNo', sql.NVarChar, countNo)
            .input('cDate', sql.NVarChar, cDate)
            .input('storeId', sql.Int, store_id)
            .input('cNotes', sql.NVarChar, notes || '')
            .query(`
                INSERT INTO stock_count (count_no, count_date, store_id, notes, status)
                OUTPUT INSERTED.id
                VALUES (@countNo, @cDate, @storeId, @cNotes, 'in_progress')
            `);
        const countId = countRes.recordset[0].id;

        // Fetch current stock to seed count items
        txRequest.input('ibStoreId', sql.Int, store_id);
        const stockRes = await txRequest.query(`SELECT product_id, quantity FROM inventory_balances WHERE store_id = @ibStoreId`);

        for (let i = 0; i < stockRes.recordset.length; i++) {
            const s = stockRes.recordset[i];
            txRequest.input(`sci_cid_${i}`, sql.Int, countId);
            txRequest.input(`sci_pid_${i}`, sql.Int, s.product_id);
            txRequest.input(`sci_qty_${i}`, sql.Decimal(18, 4), s.quantity);
            await txRequest.query(`
                INSERT INTO stock_count_items (count_id, product_id, system_qty, counted_qty, diff)
                VALUES (@sci_cid_${i}, @sci_pid_${i}, @sci_qty_${i}, 0, 0)
            `);
        }

        await transaction.commit();
        logActivity(req, 'UPDATE', 'inventory', countNo, `بدء جرد للمخزن ${store_id}`, null, { store_id, count_no: countNo, count_date: cDate }, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم بدء الجرد', id: countId });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', err.message);
        console.error('Inventory count start POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});


// GET count details
router.get('/count/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const countRes = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query(`
            SELECT c.*, s.store_name
            FROM stock_count c
            LEFT JOIN stores s ON c.store_id = s.id
            WHERE c.id = @id
        `);
    
    if (countRes.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'الجرد غير موجود' });
    }
    const count = countRes.recordset[0];
    
    const itemsRes = await pool.request()
        .input('cid', sql.Int, req.params.id)
        .query(`
            SELECT i.*, p.product_code, p.product_name 
            FROM stock_count_items i
            LEFT JOIN products p ON i.product_id = p.id
            WHERE i.count_id = @cid
            ORDER BY p.product_name
        `);
    
    res.json({ success: true, count, items: itemsRes.recordset });
}));

// PUT save count draft
router.put('/count/:id/items', async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) {
        return res.status(400).json({ success: false, message: 'بيانات الأصناف غير صحيحة' });
    }
    
    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            await txRequest
                .input(`pid_${i}`, sql.Int, item.product_id)
                .input(`cid_${i}`, sql.Int, req.params.id)
                .input(`cqty_${i}`, sql.Decimal(18,4), item.counted_qty)
                .input(`diff_${i}`, sql.Decimal(18,4), item.diff)
                .query(`
                    UPDATE stock_count_items 
                    SET counted_qty = @cqty_${i}, diff = @diff_${i}
                    WHERE count_id = @cid_${i} AND product_id = @pid_${i}
                `);
        }
        
        // Also update the total_difference on the header
        const totalDiffRes = await txRequest
            .input('sum_cid', sql.Int, req.params.id)
            .query('SELECT SUM(ABS(diff)) as tot FROM stock_count_items WHERE count_id = @sum_cid');
        const totDiff = totalDiffRes.recordset[0].tot || 0;
        
        await txRequest
            .input('hd_cid', sql.Int, req.params.id)
            .input('totDiff', sql.Decimal(18,2), totDiff)
            .query('UPDATE stock_count SET total_difference = @totDiff WHERE id = @hd_cid');
            
        await transaction.commit();
        res.json({ success: true, message: 'تم حفظ المسودة بنجاح' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Save count draft error:', err);
        res.status(500).json({ success: false, message: 'خطأ أثناء حفظ الجرد' });
    }
});

router.post('/count/:id/complete', async (req, res) => {
    let transaction;
    try {
        const pool = await getPool();

        // Read count header outside transaction first
        const countRes = await pool.request()
            .input('countId', sql.Int, req.params.id)
            .query(`SELECT * FROM stock_count WHERE id = @countId`);
        const count = countRes.recordset[0];
        if (!count) {
            logActivity(req, 'UPDATE', 'inventory', null, `الجرد رقم ${req.params.id} غير موجود`, null, null, 'FAILED', 'الجرد غير موجود');
            return res.status(404).json({ success: false, message: 'الجرد غير موجود' });
        }
        if (count.status === 'completed') {
            return res.status(400).json({ success: false, message: 'الجرد مقفل مسبقاً' });
        }
        if (count.status === 'cancelled') {
            return res.status(400).json({ success: false, message: 'الجرد ملغى' });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txRequest = transaction.request();

        // Fetch all items with non-zero diff
        txRequest.input('countIdTx', sql.Int, req.params.id);
        const itemsRes = await txRequest.query(`SELECT * FROM stock_count_items WHERE count_id = @countIdTx AND diff != 0`);

        for (let i = 0; i < itemsRes.recordset.length; i++) {
            const item = itemsRes.recordset[i];
            const diff = item.counted_qty - item.system_qty;
            if (diff === 0) continue;

            // Get product cost price
            txRequest.input(`cnt_pcost_${i}`, sql.Int, item.product_id);
            const pRes = await txRequest.query(`SELECT cost_price FROM products WHERE id = @cnt_pcost_${i}`);
            const cost = pRes.recordset[0] ? pRes.recordset[0].cost_price : 0;

            const balAfter = await updateStockBalanceAsync(txRequest, count.store_id, item.product_id, diff, `cnt_${i}`);

            txRequest.input(`sm_cnt_date_${i}`, sql.NVarChar, count.count_date);
            txRequest.input(`sm_cnt_docno_${i}`, sql.NVarChar, count.count_no);
            txRequest.input(`sm_cnt_sid_${i}`, sql.Int, count.store_id);
            txRequest.input(`sm_cnt_pid_${i}`, sql.Int, item.product_id);
            txRequest.input(`sm_cnt_qtyIn_${i}`, sql.Decimal(18, 4), diff > 0 ? diff : 0);
            txRequest.input(`sm_cnt_qtyOut_${i}`, sql.Decimal(18, 4), diff < 0 ? Math.abs(diff) : 0);
            txRequest.input(`sm_cnt_refid_${i}`, sql.Int, parseInt(req.params.id));
            txRequest.input(`sm_cnt_cost_${i}`, sql.Decimal(18, 2), cost);
            txRequest.input(`sm_cnt_bal_${i}`, sql.Decimal(18, 4), balAfter);
            await txRequest.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, qty_out, cost_price, balance_after, reference_id, notes)
                VALUES (@sm_cnt_date_${i}, 'adjustment', @sm_cnt_docno_${i}, @sm_cnt_sid_${i}, @sm_cnt_pid_${i}, @sm_cnt_qtyIn_${i}, @sm_cnt_qtyOut_${i}, @sm_cnt_cost_${i}, @sm_cnt_bal_${i}, @sm_cnt_refid_${i}, N'فرق جرد')
            `);
        }

        // --- ACCOUNTING INTEGRATION: Count difference (ONE aggregate entry for the whole count) ---
        const surplusRes = await txRequest.query(`
            SELECT SUM((sci.counted_qty - sci.system_qty) * p.cost_price) AS surplus_value
            FROM stock_count_items sci
            JOIN products p ON p.id = sci.product_id
            WHERE sci.count_id = @countIdTx AND (sci.counted_qty - sci.system_qty) > 0
        `);
        const shortageRes = await txRequest.query(`
            SELECT SUM((sci.system_qty - sci.counted_qty) * p.cost_price) AS shortage_value
            FROM stock_count_items sci
            JOIN products p ON p.id = sci.product_id
            WHERE sci.count_id = @countIdTx AND (sci.system_qty - sci.counted_qty) > 0
        `);
        const surplusValue = Math.round((parseFloat(surplusRes.recordset[0].surplus_value) || 0) * 100) / 100;
        const shortageValue = Math.round((parseFloat(shortageRes.recordset[0].shortage_value) || 0) * 100) / 100;

        if (surplusValue > 0 || shortageValue > 0) {
            const accInv = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY');
            const cntLines = [];
            if (surplusValue > 0) {
                const accSurplus = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY_SURPLUS');
                cntLines.push({ account_id: accInv, debit: surplusValue, credit: 0, description: `فائض جرد ${count.count_no}` });
                cntLines.push({ account_id: accSurplus, debit: 0, credit: surplusValue, description: `فائض جرد ${count.count_no}` });
            }
            if (shortageValue > 0) {
                const accShortage = await getSystemAccountAsync(txRequest, 'SYS_INVENTORY_SHORTAGE');
                cntLines.push({ account_id: accShortage, debit: shortageValue, credit: 0, description: `عجز جرد ${count.count_no}` });
                cntLines.push({ account_id: accInv, debit: 0, credit: shortageValue, description: `عجز جرد ${count.count_no}` });
            }
            await postJournalEntryAsync(
                txRequest, count.count_date, `فرق جرد ${count.count_no}`, cntLines,
                'inventory_count', parseInt(req.params.id), req.user ? req.user.id : null,
                { module: 'inventory', action: 'complete_count', document: count.count_no, isSystem: true }
            );
        }

        await txRequest.query(`UPDATE stock_count SET status = 'completed' WHERE id = @countIdTx`);
        await transaction.commit();
        logActivity(req, 'UPDATE', 'inventory', count.count_no, `إقفال جرد رقم ${count.count_no}`, null, { store_id: count.store_id, count_no: count.count_no, status: 'completed' }, 'SUCCESS', null);
        res.json({ success: true, message: 'تم إقفال الجرد وتعديل الفروقات' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logActivity(req, 'UPDATE', 'inventory', null, null, null, null, 'FAILED', err.message);
        console.error('Inventory count complete POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Transfers List ──────────────────────────────────────────
router.get('/transfers', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT TOP 500 t.*, fs.store_name as from_store, ts.store_name as to_store
            FROM stock_transfers t
            LEFT JOIN stores fs ON t.from_store_id = fs.id
            LEFT JOIN stores ts ON t.to_store_id = ts.id
            ORDER BY t.id DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Inventory transfers GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Cancellations (Reverse Movements) ───────────────────────
router.put('/transfer/:id/cancel', async (req, res) => {
    let transaction;
    try {
        const pool = await getPool();
        const tRes = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM stock_transfers WHERE id = @id`);
        const transfer = tRes.recordset[0];
        if (!transfer) return res.status(404).json({ success: false, message: 'التحويل غير موجود' });
        if (transfer.status === 'cancelled') return res.status(400).json({ success: false, message: 'ملغى مسبقاً' });

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txReq = transaction.request();

        const itemsRes = await txReq.input('tid', sql.Int, transfer.id).query(`SELECT * FROM stock_transfer_items WHERE transfer_id = @tid`);
        for (let i = 0; i < itemsRes.recordset.length; i++) {
            const item = itemsRes.recordset[i];
            
            // Revert Destination (subtract what was added)
            // Allow negative because we are reversing a past mistake
            const balIn = await updateStockBalanceAsync(txReq, transfer.to_store_id, item.product_id, -item.quantity, `rev_in_${i}`, true);
            
            // Revert Source (add back what was deducted)
            const balOut = await updateStockBalanceAsync(txReq, transfer.from_store_id, item.product_id, item.quantity, `rev_out_${i}`, true);

            txReq.input(`cpcost_${i}`, sql.Int, item.product_id);
            const pRes = await txReq.query(`SELECT cost_price FROM products WHERE id = @cpcost_${i}`);
            const cost = pRes.recordset[0] ? pRes.recordset[0].cost_price : 0;

            const cDate = new Date().toISOString().slice(0, 10);
            
            // Reverse movement for Destination
            txReq.input(`rc_in_date_${i}`, sql.NVarChar, cDate);
            txReq.input(`rc_in_docno_${i}`, sql.NVarChar, transfer.transfer_no);
            txReq.input(`rc_in_sid_${i}`, sql.Int, transfer.to_store_id);
            txReq.input(`rc_in_pid_${i}`, sql.Int, item.product_id);
            txReq.input(`rc_in_qty_${i}`, sql.Decimal(18, 4), item.quantity);
            txReq.input(`rc_in_refid_${i}`, sql.Int, transfer.id);
            txReq.input(`rc_in_cost_${i}`, sql.Decimal(18, 2), cost);
            txReq.input(`rc_in_bal_${i}`, sql.Decimal(18, 4), balIn);
            await txReq.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, cost_price, balance_after, reference_id, notes)
                VALUES (@rc_in_date_${i}, 'transfer_cancel', @rc_in_docno_${i}, @rc_in_sid_${i}, @rc_in_pid_${i}, @rc_in_qty_${i}, @rc_in_cost_${i}, @rc_in_bal_${i}, @rc_in_refid_${i}, N'إلغاء تحويل (مستلم)')
            `);

            // Reverse movement for Source
            txReq.input(`rc_out_date_${i}`, sql.NVarChar, cDate);
            txReq.input(`rc_out_docno_${i}`, sql.NVarChar, transfer.transfer_no);
            txReq.input(`rc_out_sid_${i}`, sql.Int, transfer.from_store_id);
            txReq.input(`rc_out_pid_${i}`, sql.Int, item.product_id);
            txReq.input(`rc_out_qty_${i}`, sql.Decimal(18, 4), item.quantity);
            txReq.input(`rc_out_refid_${i}`, sql.Int, transfer.id);
            txReq.input(`rc_out_cost_${i}`, sql.Decimal(18, 2), cost);
            txReq.input(`rc_out_bal_${i}`, sql.Decimal(18, 4), balOut);
            await txReq.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes)
                VALUES (@rc_out_date_${i}, 'transfer_cancel', @rc_out_docno_${i}, @rc_out_sid_${i}, @rc_out_pid_${i}, @rc_out_qty_${i}, @rc_out_cost_${i}, @rc_out_bal_${i}, @rc_out_refid_${i}, N'إلغاء تحويل (مرسل)')
            `);
        }

        await txReq.input('x_id', sql.Int, req.params.id).query(`UPDATE stock_transfers SET status = 'cancelled' WHERE id = @x_id`);
        await transaction.commit();
        res.json({ success: true, message: 'تم إلغاء التحويل واسترجاع المخزون' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Cancel transfer error:', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

router.put('/damaged/:id/cancel', async (req, res) => {
    let transaction;
    try {
        const pool = await getPool();
        const dRes = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM damaged_stock WHERE id = @id`);
        const damaged = dRes.recordset[0];
        if (!damaged) return res.status(404).json({ success: false, message: 'السجل غير موجود' });
        if (damaged.status === 'cancelled') return res.status(400).json({ success: false, message: 'ملغى مسبقاً' });

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txReq = transaction.request();

        // Revert (add back what was deducted)
        const balAfter = await updateStockBalanceAsync(txReq, damaged.store_id, damaged.product_id, damaged.quantity, 'rev_dam', true);

        txReq.input(`cd_pid`, sql.Int, damaged.product_id);
        const pRes = await txReq.query(`SELECT cost_price FROM products WHERE id = @cd_pid`);
        const cost = pRes.recordset[0] ? pRes.recordset[0].cost_price : 0;

        const cDate = new Date().toISOString().slice(0, 10);
        txReq.input('rd_date', sql.NVarChar, cDate);
        txReq.input('rd_docno', sql.NVarChar, damaged.doc_no);
        txReq.input('rd_sid', sql.Int, damaged.store_id);
        txReq.input('rd_qty', sql.Decimal(18, 4), damaged.quantity);
        txReq.input('rd_refid', sql.Int, damaged.id);
        txReq.input('rd_cost', sql.Decimal(18, 2), cost);
        txReq.input('rd_bal', sql.Decimal(18, 4), balAfter);

        await txReq.query(`
            INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, cost_price, balance_after, reference_id, notes)
            VALUES (@rd_date, 'damaged_cancel', @rd_docno, @rd_sid, @cd_pid, @rd_qty, @rd_cost, @rd_bal, @rd_refid, N'إلغاء تالف')
        `);

        // Reverse GL entry posted at creation (idempotent)
        txReq.input('je_dam_no', sql.NVarChar, damaged.doc_no);
        const jeResDam = await txReq.query(`
            SELECT id FROM journal_entries
            WHERE source_document = @je_dam_no
              AND (is_reversed IS NULL OR is_reversed = 0)
              AND (reversal_of_id IS NULL)
              AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')
        `);
        for (const je of jeResDam.recordset) {
            await reverseJournalEntryAsync(txReq, je.id, `إلغاء تالف مخزون ${damaged.doc_no}`, req.user ? req.user.id : null);
        }

        await txReq.input('x_id', sql.Int, req.params.id).query(`UPDATE damaged_stock SET status = 'cancelled' WHERE id = @x_id`);
        await transaction.commit();
        res.json({ success: true, message: 'تم إلغاء التالف واسترجاع المخزون' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Cancel damaged error:', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

router.put('/adjust/:id/cancel', async (req, res) => {
    let transaction;
    try {
        const pool = await getPool();
        const aRes = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM stock_adjustments WHERE id = @id`);
        const adjust = aRes.recordset[0];
        if (!adjust) return res.status(404).json({ success: false, message: 'السجل غير موجود' });
        if (adjust.status === 'cancelled') return res.status(400).json({ success: false, message: 'ملغى مسبقاً' });

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txReq = transaction.request();

        // Revert (opposite of what was added/deducted)
        const balAfter = await updateStockBalanceAsync(txReq, adjust.store_id, adjust.product_id, -adjust.quantity, 'rev_adj', true);

        txReq.input(`ca_pid`, sql.Int, adjust.product_id);
        const pRes = await txReq.query(`SELECT cost_price FROM products WHERE id = @ca_pid`);
        const cost = pRes.recordset[0] ? pRes.recordset[0].cost_price : 0;

        const cDate = new Date().toISOString().slice(0, 10);
        const qtyIn = (-adjust.quantity) > 0 ? Math.abs(adjust.quantity) : 0;
        const qtyOut = (-adjust.quantity) < 0 ? Math.abs(adjust.quantity) : 0;

        txReq.input('ra_date', sql.NVarChar, cDate);
        txReq.input('ra_docno', sql.NVarChar, adjust.adj_no);
        txReq.input('ra_sid', sql.Int, adjust.store_id);
        txReq.input('ra_qin', sql.Decimal(18, 4), qtyIn);
        txReq.input('ra_qout', sql.Decimal(18, 4), qtyOut);
        txReq.input('ra_refid', sql.Int, adjust.id);
        txReq.input('ra_cost', sql.Decimal(18, 2), cost);
        txReq.input('ra_bal', sql.Decimal(18, 4), balAfter);

        await txReq.query(`
            INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, qty_out, cost_price, balance_after, reference_id, notes)
            VALUES (@ra_date, 'adjustment_cancel', @ra_docno, @ra_sid, @ca_pid, @ra_qin, @ra_qout, @ra_cost, @ra_bal, @ra_refid, N'إلغاء تسوية')
        `);

        // Reverse GL entry posted at creation (idempotent)
        txReq.input('je_adj_no', sql.NVarChar, adjust.adj_no);
        const jeResAdj = await txReq.query(`
            SELECT id FROM journal_entries
            WHERE source_document = @je_adj_no
              AND (is_reversed IS NULL OR is_reversed = 0)
              AND (reversal_of_id IS NULL)
              AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')
        `);
        for (const je of jeResAdj.recordset) {
            await reverseJournalEntryAsync(txReq, je.id, `إلغاء تسوية مخزون ${adjust.adj_no}`, req.user ? req.user.id : null);
        }

        await txReq.input('x_id', sql.Int, req.params.id).query(`UPDATE stock_adjustments SET status = 'cancelled' WHERE id = @x_id`);
        await transaction.commit();
        res.json({ success: true, message: 'تم إلغاء التسوية واسترجاع المخزون' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Cancel adjust error:', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

router.put('/count/:id/cancel', async (req, res) => {
    let transaction;
    try {
        const pool = await getPool();
        const cRes = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM stock_count WHERE id = @id`);
        const count = cRes.recordset[0];
        if (!count) return res.status(404).json({ success: false, message: 'الجرد غير موجود' });
        if (count.status !== 'completed') return res.status(400).json({ success: false, message: 'الجرد غير مكتمل أو ملغى مسبقاً' });

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const txReq = transaction.request();

        const itemsRes = await txReq.input('cid', sql.Int, count.id).query(`SELECT * FROM stock_count_items WHERE count_id = @cid AND diff != 0`);
        
        for (let i = 0; i < itemsRes.recordset.length; i++) {
            const item = itemsRes.recordset[i];
            const diff = item.counted_qty - item.system_qty;
            
            // Revert diff
            const balAfter = await updateStockBalanceAsync(txReq, count.store_id, item.product_id, -diff, `rev_cnt_${i}`, true);

            txReq.input(`cc_pid_${i}`, sql.Int, item.product_id);
            const pRes = await txReq.query(`SELECT cost_price FROM products WHERE id = @cc_pid_${i}`);
            const cost = pRes.recordset[0] ? pRes.recordset[0].cost_price : 0;

            const cDate = new Date().toISOString().slice(0, 10);
            const qtyIn = (-diff) > 0 ? Math.abs(diff) : 0;
            const qtyOut = (-diff) < 0 ? Math.abs(diff) : 0;

            txReq.input(`rc_date_${i}`, sql.NVarChar, cDate);
            txReq.input(`rc_docno_${i}`, sql.NVarChar, count.count_no);
            txReq.input(`rc_sid_${i}`, sql.Int, count.store_id);
            txReq.input(`rc_qin_${i}`, sql.Decimal(18, 4), qtyIn);
            txReq.input(`rc_qout_${i}`, sql.Decimal(18, 4), qtyOut);
            txReq.input(`rc_refid_${i}`, sql.Int, count.id);
            txReq.input(`rc_cost_${i}`, sql.Decimal(18, 2), cost);
            txReq.input(`rc_bal_${i}`, sql.Decimal(18, 4), balAfter);

            await txReq.query(`
                INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_in, qty_out, cost_price, balance_after, reference_id, notes)
                VALUES (@rc_date_${i}, 'adjustment_cancel', @rc_docno_${i}, @rc_sid_${i}, @cc_pid_${i}, @rc_qin_${i}, @rc_qout_${i}, @rc_cost_${i}, @rc_bal_${i}, @rc_refid_${i}, N'إلغاء فرق جرد')
            `);
        }

        // Reverse GL entries posted at count completion (idempotent)
        txReq.input('je_cnt_no', sql.NVarChar, count.count_no);
        const jeResCnt = await txReq.query(`
            SELECT id FROM journal_entries
            WHERE source_document = @je_cnt_no
              AND (is_reversed IS NULL OR is_reversed = 0)
              AND (reversal_of_id IS NULL)
              AND (source_action IS NULL OR source_action NOT LIKE '%_cancel')
        `);
        for (const je of jeResCnt.recordset) {
            await reverseJournalEntryAsync(txReq, je.id, `إلغاء جرد ${count.count_no}`, req.user ? req.user.id : null);
        }

        await txReq.input('x_id', sql.Int, req.params.id).query(`UPDATE stock_count SET status = 'cancelled' WHERE id = @x_id`);
        await transaction.commit();
        res.json({ success: true, message: 'تم إلغاء الجرد واسترجاع الفروقات' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Cancel count error:', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

module.exports = router;