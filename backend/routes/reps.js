const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const logActivity = require('../middleware/logger');
const validate = require('../middleware/validate');
const { repSchema } = require('../validators');

router.get('/', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM sales_reps WHERE is_active = 1');
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Reps GET Error:', err);
        res.status(500).json({ success: false, message: 'خطأ في سيرفر قاعدة البيانات' });
    }
});

router.get('/manage', async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        let whereClause = 'WHERE 1=1';

        if (req.query.q) {
            whereClause += ' AND (rep_code LIKE @q OR rep_name LIKE @q OR phone LIKE @q)';
            request.input('q', sql.NVarChar(200), `%${req.query.q}%`);
        }

        if (req.query.status === '0' || req.query.status === '1') {
            whereClause += ' AND is_active = @status';
            request.input('status', sql.Int, parseInt(req.query.status, 10));
        }

        if (req.query.region) {
            whereClause += ' AND region = @region';
            request.input('region', sql.NVarChar(200), req.query.region);
        }

        const SORT_WHITELIST = ['rep_name', 'rep_code', 'region', 'commission_rate', 'target_amount', 'is_active'];
        let orderBy = 'rep_name';
        if (req.query.sort && SORT_WHITELIST.includes(req.query.sort)) {
            orderBy = req.query.sort;
        }
        const orderDir = req.query.order === 'DESC' ? 'DESC' : 'ASC';

        const page = Math.max(1, parseInt(req.query.page) || 1);
        let limit = 0;
        if (req.query.limit !== undefined && req.query.limit !== null && req.query.limit !== '') {
            const parsed = parseInt(req.query.limit);
            if (parsed > 0) limit = Math.min(200, parsed);
        }
        const offset = (page - 1) * limit;

        let total = 0;
        if (limit > 0) {
            const countResult = await request.query(`SELECT COUNT(*) AS total FROM sales_reps ${whereClause}`);
            total = countResult.recordset[0].total;
        }

        let sql_query = `SELECT id, rep_code, rep_name, phone, region, target_amount, commission_rate, is_active FROM sales_reps ${whereClause} ORDER BY ${orderBy} ${orderDir}`;
        if (limit > 0) {
            sql_query += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
        }

        const result = await request.query(sql_query);

        const response = { success: true, data: result.recordset };
        if (limit > 0) {
            response.pagination = { page, limit, total, pages: Math.ceil(total / limit) };
        }
        res.json(response);
    } catch (err) {
        console.error('Reps Manage GET Error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT * FROM sales_reps WHERE id = @id');
        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'المندوب غير موجود' });
        }
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        console.error('Reps GET:id Error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

router.post('/', validate(repSchema), async (req, res) => {
    const { rep_code, rep_name, phone, region, target_amount, commission_rate } = req.validated;

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = transaction.request();

        let code = rep_code;
        if (!code) {
            const lastResult = await request.query('SELECT TOP 1 rep_code FROM sales_reps WITH (TABLOCKX, HOLDLOCK) ORDER BY id DESC');
            const last = lastResult.recordset[0];
            const lastNum = last && last.rep_code ? parseInt(last.rep_code.replace(/\D/g, '')) || 0 : 0;
            code = 'R-' + String(lastNum + 1).padStart(4, '0');
        }

        const result = await request
            .input('rep_code', sql.NVarChar, code)
            .input('rep_name', sql.NVarChar, rep_name)
            .input('phone', sql.NVarChar, phone || null)
            .input('region', sql.NVarChar, region || null)
            .input('target_amount', sql.Decimal(18, 4), target_amount || 0)
            .input('commission_rate', sql.Decimal(18, 4), commission_rate || 0)
            .query(`
                INSERT INTO sales_reps (rep_code, rep_name, phone, region, target_amount, commission_rate)
                OUTPUT INSERTED.id
                VALUES (@rep_code, @rep_name, @phone, @region, @target_amount, @commission_rate)
            `);

        await transaction.commit();
        logActivity(req, 'CREATE', 'reps', code, `تم إنشاء المندوب ${rep_name}`, null, { rep_code: code, rep_name, phone, region, target_amount: Number(target_amount || 0), commission_rate: Number(commission_rate || 0) }, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم إضافة المندوب', id: result.recordset[0].id, rep_code: code });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Reps POST Error:', err);
        if (err.number === 2627 || err.message?.includes('UNIQUE')) {
            return res.status(409).json({ success: false, message: 'كود المندوب موجود مسبقاً' });
        }
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

router.put('/:id', validate(repSchema), async (req, res) => {
    const { rep_code, rep_name, phone, region, target_amount, commission_rate } = req.validated;
    try {
        const pool = await getPool();
        const existing = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT rep_name, phone, region, target_amount, commission_rate FROM sales_reps WHERE id = @id');

        if (existing.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'المندوب غير موجود' });
        }

        const oldRep = existing.recordset[0];
        const oldValues = {};
        const newValues = {};
        if (oldRep.rep_name !== rep_name) { oldValues.rep_name = oldRep.rep_name; newValues.rep_name = rep_name; }
        if (String(oldRep.phone || '') !== String(phone || '')) { oldValues.phone = oldRep.phone; newValues.phone = phone || null; }
        if (String(oldRep.region || '') !== String(region || '')) { oldValues.region = oldRep.region; newValues.region = region || null; }
        if (Number(oldRep.target_amount) !== Number(target_amount || 0)) { oldValues.target_amount = oldRep.target_amount; newValues.target_amount = Number(target_amount || 0); }
        if (Number(oldRep.commission_rate) !== Number(commission_rate || 0)) { oldValues.commission_rate = oldRep.commission_rate; newValues.commission_rate = Number(commission_rate || 0); }

        await pool.request()
            .input('rep_code', sql.NVarChar, rep_code)
            .input('rep_name', sql.NVarChar, rep_name)
            .input('phone', sql.NVarChar, phone || null)
            .input('region', sql.NVarChar, region || null)
            .input('target_amount', sql.Decimal(18, 4), target_amount || 0)
            .input('commission_rate', sql.Decimal(18, 4), commission_rate || 0)
            .input('id', sql.Int, req.params.id)
            .query(`
                UPDATE sales_reps
                SET rep_code = @rep_code, rep_name = @rep_name, phone = @phone, region = @region,
                    target_amount = @target_amount, commission_rate = @commission_rate
                WHERE id = @id
            `);

        logActivity(req, 'UPDATE', 'reps', null, `تم تحديث المندوب ${rep_name}`, Object.keys(oldValues).length ? oldValues : null, Object.keys(newValues).length ? newValues : null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم تحديث المندوب' });
    } catch (err) {
        console.error('Reps PUT Error:', err);
        if (err.number === 2627 || err.message?.includes('UNIQUE')) {
            return res.status(409).json({ success: false, message: 'كود المندوب موجود مسبقاً' });
        }
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

router.put('/:id/toggle', async (req, res) => {
    try {
        const pool = await getPool();
        const existing = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT id, rep_name, is_active FROM sales_reps WHERE id = @id');

        if (existing.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'المندوب غير موجود' });
        }

        const current = existing.recordset[0].is_active;
        const newStatus = current ? 0 : 1;

        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('is_active', sql.Int, newStatus)
            .query('UPDATE sales_reps SET is_active = @is_active WHERE id = @id');

        const action = newStatus ? 'ACTIVATE' : 'DEACTIVATE';
        const rep_name = existing.recordset[0].rep_name;
        logActivity(req, action, 'reps', null, `تم ${newStatus ? 'تفعيل' : 'إلغاء تنشيط'} المندوب ${rep_name}`, { is_active: current }, { is_active: newStatus }, 'SUCCESS', null);
        res.json({ success: true, message: newStatus ? 'تم تفعيل المندوب' : 'تم إلغاء تنشيط المندوب', is_active: newStatus });
    } catch (err) {
        console.error('Reps Toggle Error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Rep Statement (كشف حساب المندوب) ──
router.get('/:id/statement', async (req, res) => {
    try {
        const { from, to, page, limit } = req.query;
        const repId = req.params.id;

        const pool = await getPool();

        const repResult = await pool.request()
            .input('id', sql.Int, repId)
            .query('SELECT * FROM sales_reps WHERE id = @id');
        const rep = repResult.recordset[0];
        if (!rep) return res.status(404).json({ success: false, message: 'المندوب غير موجود' });

        // Opening balance (aggregate before from date)
        let openingBalance = 0;
        if (from) {
            const obReq = pool.request().input('rid', sql.Int, repId).input('from', sql.NVarChar(50), from);
            const obResult = await obReq.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN src = 'sales' THEN amount ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN src IN ('collection','return') THEN amount ELSE 0 END), 0) AS total_credit
                FROM (
                    SELECT 'sales' AS src, grand_total AS amount FROM sales_invoices WHERE rep_id = @rid AND status != 'cancelled' AND invoice_date < @from
                    UNION ALL
                    SELECT 'collection', amount FROM customer_collections WHERE rep_id = @rid AND collection_date < @from
                    UNION ALL
                    SELECT 'return', sr.grand_total FROM sales_returns sr JOIN sales_invoices i ON sr.invoice_id = i.id WHERE i.rep_id = @rid AND sr.status != 'cancelled' AND sr.return_date < @from
                ) t
            `);
            const ob = obResult.recordset[0];
            openingBalance = Math.round(((ob.total_debit || 0) - (ob.total_credit || 0)) * 100) / 100;
        }

        // Movement rows within date range
        const movReq = pool.request();
        movReq.input('rid', sql.Int, repId);
        if (from) movReq.input('from', sql.NVarChar(50), from);
        if (to) movReq.input('to', sql.NVarChar(50), to);

        let movSql = `
            SELECT invoice_date AS trans_date, invoice_no AS doc_no, N'فاتورة مبيعات' AS doc_type_label, 'sales' AS movement_type,
                   grand_total AS debit, 0 AS credit, c.customer_name AS partner_name, i.notes, i.id AS ref_id, 1 AS _sort
            FROM sales_invoices i
            LEFT JOIN customers c ON i.customer_id = c.id
            WHERE i.rep_id = @rid AND i.status != 'cancelled'`;
        if (from) movSql += ` AND i.invoice_date >= @from`;
        if (to) movSql += ` AND i.invoice_date <= @to`;

        movSql += `
            UNION ALL
            SELECT return_date, return_no, N'مرتجع مبيعات', 'return',
                   0, sr.grand_total, c.customer_name, sr.return_reason, sr.id, 2
            FROM sales_returns sr
            JOIN sales_invoices i ON sr.invoice_id = i.id
            LEFT JOIN customers c ON sr.customer_id = c.id
            WHERE i.rep_id = @rid AND sr.status != 'cancelled'`;
        if (from) movSql += ` AND sr.return_date >= @from`;
        if (to) movSql += ` AND sr.return_date <= @to`;

        movSql += `
            UNION ALL
            SELECT collection_date, collection_no, N'تحصيل', 'collection',
                   0, cc.amount, c.customer_name, cc.notes, cc.id, 3
            FROM customer_collections cc
            LEFT JOIN customers c ON cc.customer_id = c.id
            WHERE cc.rep_id = @rid`;
        if (from) movSql += ` AND cc.collection_date >= @from`;
        if (to) movSql += ` AND cc.collection_date <= @to`;

        movSql += ` ORDER BY trans_date ASC, _sort ASC, ref_id ASC`;

        const movResult = await movReq.query(movSql);
        const rows = movResult.recordset;

        let running = openingBalance;
        let totalSales = 0, totalCollections = 0, totalReturns = 0;
        const movements = rows.map(r => {
            const debit = parseFloat(r.debit) || 0;
            const credit = parseFloat(r.credit) || 0;
            running += debit - credit;
            if (r.movement_type === 'sales') totalSales += debit;
            else if (r.movement_type === 'collection') totalCollections += credit;
            else if (r.movement_type === 'return') totalReturns += credit;
            return {
                trans_date: r.trans_date ? String(r.trans_date).slice(0, 10) : '',
                doc_no: r.doc_no || '',
                doc_type_label: r.doc_type_label || '',
                movement_type: r.movement_type || '',
                partner_name: r.partner_name || '',
                notes: r.notes || '',
                debit,
                credit,
                balance: Math.round(running * 100) / 100,
                ref_id: r.ref_id
            };
        });

        const netSales = Math.round((totalSales - totalReturns) * 100) / 100;
        const commission = Math.round((netSales * (parseFloat(rep.commission_rate) || 0) / 100) * 100) / 100;
        const lastBalance = movements.length > 0 ? movements[movements.length - 1].balance : 0;

        // Pagination
        let paginatedMovements = movements;
        let pagination = null;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(0, parseInt(limit) || 0);
        if (limitNum > 0 && limitNum <= 200) {
            const total = movements.length;
            const pages = Math.ceil(total / limitNum);
            const start = (pageNum - 1) * limitNum;
            paginatedMovements = movements.slice(start, start + limitNum);
            pagination = { page: pageNum, limit: limitNum, total, pages };
        }

        res.json({
            success: true,
            data: {
                entity: { id: rep.id, name: rep.rep_name, code: rep.rep_code },
                openingBalance,
                movements: paginatedMovements,
                summary: {
                    totalSales: Math.round(totalSales * 100) / 100,
                    totalCollections: Math.round(totalCollections * 100) / 100,
                    totalReturns: Math.round(totalReturns * 100) / 100,
                    netSales,
                    commission,
                    commissionRate: parseFloat(rep.commission_rate) || 0,
                    finalBalance: lastBalance,
                    netPosition: Math.round((lastBalance - commission) * 100) / 100,
                    openingBalance
                },
                pagination
            }
        });
    } catch (err) {
        console.error('Rep statement error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

module.exports = router;