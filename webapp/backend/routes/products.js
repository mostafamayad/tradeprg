// ROUTE: Products
const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');
router.get('/', asyncHandler(async (req, res) => {
    try {
        const { q, category_id, low_stock, store_id } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT p.*, c.category_name, 
            COALESCE((SELECT SUM(ib.quantity) FROM inventory_balances ib WHERE ib.product_id = p.id), 0) as total_stock
            FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.is_active = 1`;
        
        if (q) { 
            sqlQuery += ` AND (p.product_name LIKE @q OR p.product_code LIKE @q OR p.barcode LIKE @q)`; 
            request.input('q', sql.NVarChar, `%${q}%`); 
        }
        if (category_id) { 
            sqlQuery += ` AND p.category_id = @categoryId`; 
            request.input('categoryId', sql.Int, category_id); 
        }
        if (low_stock === '1') { 
            sqlQuery += ` AND COALESCE((SELECT SUM(quantity) FROM inventory_balances WHERE product_id = p.id), 0) <= p.min_stock`; 
        }
        sqlQuery += ` ORDER BY p.product_name`;
        
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Products GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('id', sql.Int, req.params.id);
        
        const prodRes = await request.query(`SELECT p.*, c.category_name, 
            COALESCE((SELECT SUM(ib.quantity) FROM inventory_balances ib WHERE ib.product_id = p.id), 0) as total_stock
            FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = @id`);
        const product = prodRes.recordset[0];
        
        if (!product) return res.status(404).json({ success: false, message: 'الصنف غير موجود' });
        
        const storeBalancesRes = await request.query(`SELECT ib.quantity, s.store_name FROM inventory_balances ib LEFT JOIN stores s ON ib.store_id = s.id WHERE ib.product_id = @id`);
        const movementsRes = await request.query(`SELECT TOP 50 sm.*, s.store_name FROM stock_movements sm LEFT JOIN stores s ON sm.store_id = s.id WHERE sm.product_id = @id ORDER BY sm.id DESC`);
        
        res.json({ success: true, data: { ...product, storeBalances: storeBalancesRes.recordset, movements: movementsRes.recordset } });
    } catch (err) {
        console.error('Products GET:id error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.post('/', asyncHandler(async (req, res) => {
    const { product_code, product_name, category_id, unit_name, cost_price, sell_price, sell_price2, sell_price3, min_stock, max_stock, barcode, notes } = req.body;
    if (!product_name) {
        logActivity(req, 'CREATE', 'products', null, null, null, null, 'FAILED', 'اسم الصنف مطلوب');
        return res.status(400).json({ success: false, message: 'اسم الصنف مطلوب' });
    }

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = transaction.request();

        let code = product_code;
        if (!code) {
            const lastCodeResult = await request.query('SELECT TOP 1 product_code FROM products WITH (TABLOCKX, HOLDLOCK) ORDER BY id DESC');
            const last = lastCodeResult.recordset[0];
            const lastNum = last && last.product_code ? parseInt(last.product_code.replace(/\D/g, '')) || 0 : 0;
            code = `P-${String(lastNum + 1).padStart(4, '0')}`;
        }
        
        const result = await request
            .input('code', sql.NVarChar, code)
            .input('name', sql.NVarChar, product_name)
            .input('catId', sql.Int, category_id || null)
            .input('unit', sql.NVarChar, unit_name || 'قطعة')
            .input('cost', sql.Decimal(18, 2), cost_price || 0)
            .input('sell1', sql.Decimal(18, 2), sell_price || 0)
            .input('sell2', sql.Decimal(18, 2), sell_price2 || 0)
            .input('sell3', sql.Decimal(18, 2), sell_price3 || 0)
            .input('min_stock', sql.Decimal(18, 2), min_stock || 0)
            .input('max_stock', sql.Decimal(18, 2), max_stock || 0)
            .input('barcode', sql.NVarChar, barcode || null)
            .input('notes', sql.NVarChar, notes || null)
            .query(`
                INSERT INTO products (product_code, product_name, category_id, unit_name, cost_price, sell_price, sell_price2, sell_price3, min_stock, max_stock, barcode, notes) 
                OUTPUT INSERTED.id
                VALUES (@code, @name, @catId, @unit, @cost, @sell1, @sell2, @sell3, @min_stock, @max_stock, @barcode, @notes)
            `);
            
        await transaction.commit();
        logActivity(req, 'CREATE', 'products', code, `تم إنشاء الصنف ${product_name}`, null, { product_name, product_code: code, category_id, unit_name, cost_price, sell_price }, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم إضافة الصنف', id: result.recordset[0].id, code });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logActivity(req, 'CREATE', 'products', null, null, null, null, 'FAILED', err.message);
        console.error('Products POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const { product_name, category_id, unit_name, cost_price, sell_price, sell_price2, sell_price3, min_stock, max_stock, barcode, notes } = req.body;
    try {
        const pool = await getPool();
        const existingResult = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT id FROM products WHERE id = @id');
            
        if (existingResult.recordset.length === 0) {
            logActivity(req, 'UPDATE', 'products', null, `الصنف رقم ${req.params.id} غير موجود`, null, null, 'FAILED', 'الصنف غير موجود');
            return res.status(404).json({ success: false, message: 'الصنف غير موجود' });
        }

        await pool.request()
            .input('name', sql.NVarChar, product_name)
            .input('catId', sql.Int, category_id || null)
            .input('unit', sql.NVarChar, unit_name || 'قطعة')
            .input('cost', sql.Decimal(18, 2), cost_price || 0)
            .input('sell1', sql.Decimal(18, 2), sell_price || 0)
            .input('sell2', sql.Decimal(18, 2), sell_price2 || 0)
            .input('sell3', sql.Decimal(18, 2), sell_price3 || 0)
            .input('min_stock', sql.Decimal(18, 2), min_stock || 0)
            .input('max_stock', sql.Decimal(18, 2), max_stock || 0)
            .input('barcode', sql.NVarChar, barcode || null)
            .input('notes', sql.NVarChar, notes || null)
            .input('id', sql.Int, req.params.id)
            .query(`
                UPDATE products 
                SET product_name=@name, category_id=@catId, unit_name=@unit, cost_price=@cost, sell_price=@sell1, sell_price2=@sell2, sell_price3=@sell3, min_stock=@min_stock, max_stock=@max_stock, barcode=@barcode, notes=@notes 
                WHERE id=@id
            `);
            
        logActivity(req, 'UPDATE', 'products', null, `تم تحديث الصنف ${product_name}`, null, { product_name, category_id, unit_name, cost_price, sell_price }, 'SUCCESS', null);
        res.json({ success: true, message: 'تم تحديث الصنف' });
    } catch (err) {
        logActivity(req, 'UPDATE', 'products', null, null, null, null, 'FAILED', err.message);
        console.error('Products PUT error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('UPDATE products SET is_active = 0 WHERE id = @id');
            
        logActivity(req, 'DELETE', 'products', null, `تم حذف الصنف رقم ${req.params.id}`, null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم حذف الصنف' });
    } catch (err) {
        logActivity(req, 'DELETE', 'products', null, null, null, null, 'FAILED', err.message);
        console.error('Products DELETE error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

// Categories
router.get('/categories/all', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM categories ORDER BY category_name');
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Categories GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.post('/categories', asyncHandler(async (req, res) => {
    try {
        const { category_name } = req.body;
        const pool = await getPool();
        const result = await pool.request()
            .input('name', sql.NVarChar, category_name)
            .query('INSERT INTO categories (category_name) OUTPUT INSERTED.id VALUES (@name)');
            
        res.status(201).json({ success: true, id: result.recordset[0].id });
    } catch (err) {
        console.error('Categories POST error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

module.exports = router;
