// ROUTE: Suppliers
const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');

// Private async helper to recalculate supplier balance
async function recalcSupplierBalanceAsync(poolOrTxReq, supplierId) {
    const { recalcSupplierBalanceAsync: canonical } = require('../services/accountingEngine');
    return canonical(poolOrTxReq, supplierId);
}

router.get('/', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const { q, active, page, limit, sort_by, sort_order } = req.query;

        let conditions = [];
        const params = [];

        if (active === '0') {
            conditions.push('is_active = 0');
        } else if (active === '' || active === 'all') {
            // no filter on active
        } else {
            conditions.push('is_active = 1');
        }

        if (q) {
            conditions.push('(supplier_name LIKE @q OR supplier_code LIKE @q OR phone LIKE @q OR mobile LIKE @q)');
            params.push({ name: 'q', type: sql.NVarChar, value: `%${q}%` });
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // Sorting — whitelist allowed columns to prevent SQL injection
        const allowedSortColumns = ['supplier_code', 'supplier_name', 'phone', 'current_balance', 'id'];
        const sortCol = allowedSortColumns.includes(sort_by) ? sort_by : 'supplier_name';
        const sortDir = sort_order === 'DESC' ? 'DESC' : 'ASC';

        // Pagination
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 15));
        const offset = (pageNum - 1) * limitNum;

        // Count total
        let countReq = pool.request();
        params.forEach(p => countReq.input(p.name, p.type, p.value));
        const countResult = await countReq.query(`SELECT COUNT(*) AS total FROM suppliers ${whereClause}`);
        const total = countResult.recordset[0].total;

        // Fetch data
        let dataReq = pool.request();
        params.forEach(p => dataReq.input(p.name, p.type, p.value));
        const dataResult = await dataReq
            .query(`SELECT * FROM suppliers ${whereClause} ORDER BY ${sortCol} ${sortDir} OFFSET ${offset} ROWS FETCH NEXT ${limitNum} ROWS ONLY`);

        res.json({ success: true, data: dataResult.recordset, total, page: pageNum, limit: limitNum });
    } catch (err) {
        console.error('Suppliers GET error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT * FROM suppliers WHERE id = @id');
        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'المورد غير موجود' });
        }
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        console.error('Suppliers GET by ID error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.post('/', asyncHandler(async (req, res) => {
    const { supplier_code, supplier_name, phone, mobile, email, address, tax_number, opening_balance, notes } = req.body;
    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = transaction.request();
        
        let code = supplier_code;
        
        if (!code) {
            const cntUpd = await request.query(`
                UPDATE invoice_counters SET last_number = last_number + 1
                OUTPUT INSERTED.last_number
                WHERE counter_name = 'suppliers'
            `);
            if (cntUpd.recordset[0]) {
                code = `S-${String(cntUpd.recordset[0].last_number).padStart(4, '0')}`;
            } else {
                await request.query("INSERT INTO invoice_counters (counter_name, prefix, last_number) VALUES ('suppliers', 'S', 1)");
                code = 'S-0001';
            }
        }
        
        const ob = opening_balance || 0;
        
        const result = await request
            .input('code', sql.NVarChar, code)
            .input('name', sql.NVarChar, supplier_name)
            .input('phone', sql.NVarChar, phone)
            .input('mobile', sql.NVarChar, mobile)
            .input('email', sql.NVarChar, email)
            .input('address', sql.NVarChar, address)
            .input('tax', sql.NVarChar, tax_number)
            .input('ob', sql.Decimal(18, 2), ob)
            .input('notes', sql.NVarChar, notes)
            .query(`
                INSERT INTO suppliers (supplier_code, supplier_name, phone, mobile, email, address, tax_number, opening_balance, current_balance, notes)
                OUTPUT INSERTED.id
                VALUES (@code, @name, @phone, @mobile, @email, @address, @tax, @ob, @ob, @notes)
            `);
            
        await transaction.commit();
        logActivity(req, 'CREATE', 'suppliers', code, `تم إنشاء المورد ${supplier_name}`, null, { supplier_name, code, phone, mobile, email, address, tax_number }, 'SUCCESS', null);
        res.status(201).json({ success: true, id: result.recordset[0].id });
    } catch (err) {
        if (transaction) await transaction.rollback();
        if (err.number === 2627) {
            return res.status(400).json({ success: false, message: 'كود المورد أو الهاتف مسجل مسبقاً.' });
        }
        logActivity(req, 'CREATE', 'suppliers', null, null, null, null, 'FAILED', err.message);
        console.error('Suppliers POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const { supplier_name, phone, mobile, email, address, tax_number, opening_balance, notes } = req.body;
    let transaction;
    try {
        const pool = await getPool();
        
        const existingResult = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT id FROM suppliers WHERE id = @id');
            
        if (existingResult.recordset.length === 0) {
            logActivity(req, 'UPDATE', 'suppliers', null, `المورد رقم ${req.params.id} غير موجود`, null, null, 'FAILED', 'المورد غير موجود');
            return res.status(404).json({ success: false, message: 'المورد غير موجود' });
        }
        
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = transaction.request();

        await request
            .input('name', sql.NVarChar, supplier_name)
            .input('phone', sql.NVarChar, phone)
            .input('mobile', sql.NVarChar, mobile)
            .input('email', sql.NVarChar, email)
            .input('address', sql.NVarChar, address)
            .input('tax', sql.NVarChar, tax_number)
            .input('ob', sql.Decimal(18, 2), opening_balance || 0)
            .input('notes', sql.NVarChar, notes)
            .input('id', sql.Int, req.params.id)
            .query(`
                UPDATE suppliers 
                SET supplier_name = @name, phone = @phone, mobile = @mobile, email = @email, address = @address, tax_number = @tax, opening_balance = @ob, notes = @notes 
                WHERE id = @id
            `);
            
        await recalcSupplierBalanceAsync(request, req.params.id);
        
        await transaction.commit();
        logActivity(req, 'UPDATE', 'suppliers', null, `تم تحديث المورد ${supplier_name}`, null, { supplier_name, phone, mobile, email, address, tax_number }, 'SUCCESS', null);
        res.json({ success: true, message: 'تم تحديث المورد' });
    } catch (err) {
        if (transaction) await transaction.rollback();
        if (err.number === 2627) {
            return res.status(400).json({ success: false, message: 'كود المورد أو الهاتف مسجل مسبقاً.' });
        }
        logActivity(req, 'UPDATE', 'suppliers', null, null, null, null, 'FAILED', err.message);
        console.error('Suppliers PUT error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('UPDATE suppliers SET is_active = 0 WHERE id = @id');
            
        logActivity(req, 'DELETE', 'suppliers', null, `تم حذف المورد رقم ${req.params.id}`, null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم حذف المورد' });
    } catch (err) {
        logActivity(req, 'DELETE', 'suppliers', null, null, null, null, 'FAILED', err.message);
        console.error('Suppliers DELETE error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

module.exports = router;
