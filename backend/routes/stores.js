const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');

router.get('/', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM stores ORDER BY id');
    res.json({ success: true, data: result.recordset });
}));

router.get('/dependencies/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await getPool();
    const deps = [];

    async function checkTable(table, column, label, condition = '1=1') {
        const r = await pool.request()
            .input('id', sql.Int, id)
            .query(`SELECT COUNT(*) as cnt FROM [${table}] WHERE ${column} = @id AND ${condition}`);
        const cnt = r.recordset[0]?.cnt || 0;
        if (cnt > 0) deps.push({ table, label, count: cnt });
    }

    await checkTable('inventory_balances', 'store_id', 'أرصدة مخزون', 'quantity != 0');
    await checkTable('stock_movements', 'store_id', 'حركات مخزنية');
    await checkTable('sales_invoices', 'store_id', 'فواتير بيع');
    await checkTable('purchase_invoices', 'store_id', 'فواتير شراء');
    await checkTable('sales_returns', 'store_id', 'مرتجعات بيع');
    await checkTable('purchase_returns', 'store_id', 'مرتجعات شراء');
    await checkTable('stock_transfers', 'from_store_id', 'تحويلات مخزنية (مرسل)', `from_store_id = @id`);
    await checkTable('stock_transfers', 'to_store_id', 'تحويلات مخزنية (مستقبل)', `to_store_id = @id`);
    await checkTable('damaged_stock', 'store_id', 'توالف ورواكد');
    await checkTable('stock_count', 'store_id', 'جرد مخزني');
    await checkTable('stock_adjustments', 'store_id', 'تسويات مخزنية');
    try {
        const colCheck = await pool.request().query("SELECT COL_LENGTH('products', 'default_warehouse_id') as col_exists");
        if (colCheck.recordset[0]?.col_exists !== null) {
            await checkTable('products', 'default_warehouse_id', 'أصناف مرتبطة');
        }
    } catch (e) { /* column doesn't exist, skip */ }

    res.json({ success: true, data: deps, hasDependencies: deps.length > 0 });
}));

router.post('/', asyncHandler(async (req, res) => {
    const { store_code, store_name, store_type, notes, status } = req.body;
    if (!store_code || !store_name) {
        return res.status(400).json({ success: false, message: 'الكود والاسم مطلوبان' });
    }
    const pool = await getPool();
    const check = await pool.request()
        .input('code', sql.NVarChar, store_code)
        .query('SELECT id FROM stores WHERE store_code = @code');
    if (check.recordset.length > 0) {
        return res.status(409).json({ success: false, message: 'كود المخزن موجود بالفعل' });
    }
    const result = await pool.request()
        .input('store_code', sql.NVarChar, store_code)
        .input('store_name', sql.NVarChar, store_name)
        .input('store_type', sql.NVarChar, store_type || 'main')
        .input('notes', sql.NVarChar, notes || '')
        .input('status', sql.NVarChar, status || 'active')
        .query(`INSERT INTO stores (store_code, store_name, store_type, notes${status ? ', status' : ''}) 
                VALUES (@store_code, @store_name, @store_type, @notes${status ? ', @status' : ''});
                SELECT SCOPE_IDENTITY() as id`);
    const newId = result.recordset[0]?.id;
    res.json({ success: true, data: { id: newId }, message: 'تم إضافة المخزن بنجاح' });
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { store_code, store_name, store_type, notes, status } = req.body;
    if (!store_code || !store_name) {
        return res.status(400).json({ success: false, message: 'الكود والاسم مطلوبان' });
    }
    const pool = await getPool();
    const dup = await pool.request()
        .input('code', sql.NVarChar, store_code)
        .input('id', sql.Int, id)
        .query('SELECT id FROM stores WHERE store_code = @code AND id != @id');
    if (dup.recordset.length > 0) {
        return res.status(409).json({ success: false, message: 'كود المخزن موجود بالفعل لمخزن آخر' });
    }
    await pool.request()
        .input('id', sql.Int, id)
        .input('store_code', sql.NVarChar, store_code)
        .input('store_name', sql.NVarChar, store_name)
        .input('store_type', sql.NVarChar, store_type || 'main')
        .input('notes', sql.NVarChar, notes || '')
        .input('status', sql.NVarChar, status || 'active')
        .query(`UPDATE stores SET store_code=@store_code, store_name=@store_name, store_type=@store_type, notes=@notes, status=@status WHERE id=@id`);
    res.json({ success: true, message: 'تم تحديث المخزن بنجاح' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await getPool();
    const storeCheck = await pool.request()
        .input('id', sql.Int, id)
        .query('SELECT id, store_code, store_name, store_type FROM stores WHERE id = @id');
    if (!storeCheck.recordset[0]) {
        return res.status(404).json({ success: false, message: 'المخزن غير موجود' });
    }
    const store = storeCheck.recordset[0];
    const systemCodes = ['ST-MAIN', 'ST001', 'ST-DAMAGED', 'ST-INSP'];
    if (systemCodes.includes(store.store_code)) {
        return res.status(400).json({ success: false, message: 'لا يمكن حذف المخازن النظامية (الرئيسي، التوالف، الفحص)' });
    }
    let productUnion = '';
    try {
        const tblCheck = await pool.request().query("SELECT OBJECT_ID('products') as oid");
        if (tblCheck.recordset[0]?.oid) {
            const colCheck = await pool.request().query("SELECT COL_LENGTH('products', 'default_warehouse_id') as col_exists");
            if (colCheck.recordset[0]?.col_exists !== null) {
                productUnion = `UNION ALL SELECT N'أصناف مرتبطة' as label, COUNT(*) FROM products WHERE default_warehouse_id = @id`;
            }
        }
    } catch (e) { /* skip */ }
    const depsRes = await pool.request()
        .input('id', sql.Int, id)
        .query(`
            SELECT 'أرصدة مخزون' as label, COUNT(*) as cnt FROM inventory_balances WHERE store_id = @id AND quantity != 0
            UNION ALL SELECT 'حركات مخزنية' as label, COUNT(*) FROM stock_movements WHERE store_id = @id
            UNION ALL SELECT 'فواتير بيع' as label, COUNT(*) FROM sales_invoices WHERE store_id = @id
            UNION ALL SELECT 'فواتير شراء' as label, COUNT(*) FROM purchase_invoices WHERE store_id = @id
            UNION ALL SELECT 'مرتجعات بيع' as label, COUNT(*) FROM sales_returns WHERE store_id = @id
            UNION ALL SELECT 'مرتجعات شراء' as label, COUNT(*) FROM purchase_returns WHERE store_id = @id
            UNION ALL SELECT 'تحويلات مخزنية (مرسل)' as label, COUNT(*) FROM stock_transfers WHERE from_store_id = @id
            UNION ALL SELECT 'تحويلات مخزنية (مستقبل)' as label, COUNT(*) FROM stock_transfers WHERE to_store_id = @id
            UNION ALL SELECT 'توالف ورواكد' as label, COUNT(*) FROM damaged_stock WHERE store_id = @id
            UNION ALL SELECT 'جرد مخزني' as label, COUNT(*) FROM stock_count WHERE store_id = @id
            UNION ALL SELECT 'تسويات مخزنية' as label, COUNT(*) FROM stock_adjustments WHERE store_id = @id
            ${productUnion}
        `);
    const deps = depsRes.recordset.filter(d => d.cnt > 0);
    if (deps.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'لا يمكن حذف المخزن لأنه مرتبط بالبيانات التالية',
            dependencies: deps
        });
    }
    await pool.request()
        .input('id', sql.Int, id)
        .query('DELETE FROM stores WHERE id = @id');
    res.json({ success: true, message: 'تم حذف المخزن بنجاح' });
}));

module.exports = router;
