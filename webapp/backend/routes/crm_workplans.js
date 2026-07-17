const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const logActivity = require('../middleware/logger');
const { parsePagination, buildPaginationResponse } = require('../middleware/pagination');

router.get('/', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = pool.request();
    let w = 'WHERE 1=1';
    if (req.query.rep_id) { w += ' AND w.rep_id = @rep'; r.input('rep', sql.Int, req.query.rep_id); }
    if (req.query.status) { w += ' AND w.status = @st'; r.input('st', sql.NVarChar, req.query.status); }
    if (req.query.date_from) { w += ' AND w.plan_date >= @df'; r.input('df', sql.NVarChar, req.query.date_from); }
    if (req.query.date_to) { w += ' AND w.plan_date <= @dt'; r.input('dt', sql.NVarChar, req.query.date_to); }
    const { page, limit, offset } = parsePagination(req.query, { limit: 0, maxLimit: 200 });
    const sortWhitelist = ['plan_date', 'rep_id', 'status', 'priority', 'target_count', 'visited_count'];
    let orderBy = 'w.plan_date';
    if (req.query.sort && sortWhitelist.includes(req.query.sort)) orderBy = 'w.' + req.query.sort;
    const orderDir = req.query.order === 'DESC' ? 'DESC' : 'ASC';
    if (req.query.q) { w += ' AND (sr.rep_name LIKE @q OR w.route_name LIKE @q)'; r.input('q', sql.NVarChar, '%' + req.query.q + '%'); }
    let total = 0;
    if (limit > 0) {
        const c = await r.query(`SELECT COUNT(*) AS total FROM crm_workplans w LEFT JOIN sales_reps sr ON w.rep_id = sr.id ${w}`);
        total = c.recordset[0].total;
    }
    const q = `SELECT w.*, sr.rep_name FROM crm_workplans w LEFT JOIN sales_reps sr ON w.rep_id = sr.id ${w} ORDER BY ${orderBy} ${orderDir}${limit > 0 ? ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY` : ''}`;
    const result = await r.query(q);
    const resp = { success: true, data: result.recordset };
    const pg = buildPaginationResponse(total, { page, limit });
    if (pg) resp.pagination = pg;
    res.json(resp);
}));

router.get('/summary', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_count,
            SUM(target_count) as total_targeted,
            SUM(visited_count) as total_visited
        FROM crm_workplans
    `);
    res.json({ success: true, data: r.recordset[0] });
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id).query(`
        SELECT w.*, sr.rep_name FROM crm_workplans w LEFT JOIN sales_reps sr ON w.rep_id = sr.id WHERE w.id = @id
    `);
    if (!r.recordset[0]) return res.status(404).json({ success: false, message: 'خطة السير غير موجودة' });
    const cust = await pool.request().input('id', sql.Int, req.params.id).query(`
        SELECT wc.*, c.customer_name, c.phone, c.city FROM crm_workplan_customers wc
        JOIN customers c ON wc.customer_id = c.id WHERE wc.workplan_id = @id AND wc.deleted_at IS NULL
    `);
    const data = r.recordset[0];
    data.customers = cust.recordset;
    res.json({ success: true, data });
}));

router.post('/', asyncHandler(async (req, res) => {
    const { rep_id, route_name, plan_date, start_time, end_time, priority, notes, customers } = req.body;
    if (!plan_date) return res.status(400).json({ success: false, message: 'التاريخ مطلوب' });
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        const target_count = customers && Array.isArray(customers) ? customers.length : 0;
        txReq.input('r', sql.Int, rep_id || null); txReq.input('rn', sql.NVarChar, route_name || null);
        txReq.input('pd', sql.NVarChar, plan_date); txReq.input('st', sql.NVarChar, start_time || null);
        txReq.input('et', sql.NVarChar, end_time || null); txReq.input('pr', sql.NVarChar, priority || 'medium');
        txReq.input('tc', sql.Int, target_count); txReq.input('ns', sql.NVarChar, notes || null);
        txReq.input('cb', sql.Int, req.user.id);
        const ins = await txReq.query(`
            INSERT INTO crm_workplans (rep_id, route_name, plan_date, start_time, end_time, priority, target_count, notes, created_by)
            OUTPUT INSERTED.id VALUES (@r, @rn, @pd, @st, @et, @pr, @tc, @ns, @cb)
        `);
        const wpId = ins.recordset[0].id;
        if (customers && Array.isArray(customers)) {
            txReq.input('wid', sql.Int, wpId);
            for (let i = 0; i < customers.length; i++) {
                const pC = '_c' + i;
                txReq.input(`cid${pC}`, sql.Int, customers[i].customer_id || customers[i]);
                await txReq.query(`INSERT INTO crm_workplan_customers (workplan_id, customer_id, created_by) VALUES (@wid, @cid${pC}, @cb)`);
            }
        }
        await tx.commit();
        await logActivity(req, 'CREATE', 'crm_workplans', null, `خطة سير جديدة #${wpId}`, null, null, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم إنشاء خطة السير', id: wpId });
    } catch (e) { await tx.rollback(); throw e; }
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const { rep_id, route_name, plan_date, start_time, end_time, priority, notes, customers } = req.body;
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        txReq.input('id', sql.Int, req.params.id); txReq.input('r', sql.Int, rep_id || null);
        txReq.input('rn', sql.NVarChar, route_name || null); txReq.input('pd', sql.NVarChar, plan_date);
        txReq.input('st', sql.NVarChar, start_time || null); txReq.input('et', sql.NVarChar, end_time || null);
        txReq.input('pr', sql.NVarChar, priority || 'medium'); txReq.input('ns', sql.NVarChar, notes || null);
        txReq.input('ub', sql.Int, req.user.id);
        await txReq.query(`UPDATE crm_workplans SET rep_id=@r, route_name=@rn, plan_date=@pd, start_time=@st, end_time=@et, priority=@pr, notes=@ns, updated_by=@ub, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@id`);
        if (customers && Array.isArray(customers)) {
            await txReq.query(`DELETE FROM crm_workplan_customers WHERE workplan_id=@id`);
            for (let i = 0; i < customers.length; i++) {
                const pC = '_c' + i;
                txReq.input(`cid${pC}`, sql.Int, customers[i].customer_id || customers[i]);
                await txReq.query(`INSERT INTO crm_workplan_customers (workplan_id, customer_id, created_by) VALUES (@id, @cid${pC}, @ub)`);
            }
            await txReq.query(`UPDATE crm_workplans SET target_count=${customers.length} WHERE id=@id`);
        }
        await tx.commit();
        await logActivity(req, 'UPDATE', 'crm_workplans', null, `تعديل خطة سير #${req.params.id}`, null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم تعديل خطة السير' });
    } catch (e) { await tx.rollback(); throw e; }
}));

router.patch('/:id/status', asyncHandler(async (req, res) => {
    const { status } = req.body;
    const valid = ['pending', 'completed', 'cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).input('st', sql.NVarChar, status).query(`UPDATE crm_workplans SET status=@st, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@id`);
    res.json({ success: true, message: 'تم تحديث الحالة' });
}));

router.get('/:id/customers', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id).query(`
        SELECT wc.*, c.customer_name, c.phone, c.city FROM crm_workplan_customers wc
        JOIN customers c ON wc.customer_id = c.id WHERE wc.workplan_id = @id AND wc.deleted_at IS NULL
    `);
    res.json({ success: true, data: r.recordset });
}));

router.post('/:id/customers', asyncHandler(async (req, res) => {
    const { customer_id } = req.body;
    if (!customer_id) return res.status(400).json({ success: false, message: 'العميل مطلوب' });
    const pool = await getPool();
    const r = await pool.request().input('wid', sql.Int, req.params.id).input('cid', sql.Int, customer_id).input('cb', sql.Int, req.user.id).query(`
        INSERT INTO crm_workplan_customers (workplan_id, customer_id, created_by) VALUES (@wid, @cid, @cb);
        UPDATE crm_workplans SET target_count = target_count + 1 WHERE id = @wid;
    `);
    res.status(201).json({ success: true, message: 'تم إضافة العميل' });
}));

router.patch('/customers/:id/visit', asyncHandler(async (req, res) => {
    const { visit_notes } = req.body;
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).input('vn', sql.NVarChar, visit_notes || null).input('ub', sql.Int, req.user.id).query(`
        UPDATE crm_workplan_customers SET visit_status='visited', visit_notes=@vn, visited_at=CONVERT(VARCHAR(19), GETDATE(), 120), updated_by=@ub, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@id
    `);
    const wc = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT workplan_id FROM crm_workplan_customers WHERE id=@id`);
    if (wc.recordset[0]) {
        await pool.request().input('wid', sql.Int, wc.recordset[0].workplan_id).query(`UPDATE crm_workplans SET visited_count = (SELECT COUNT(*) FROM crm_workplan_customers WHERE workplan_id=@wid AND visit_status='visited'), updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@wid`);
    }
    res.json({ success: true, message: 'تم تسجيل الزيارة' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).input('db', sql.Int, req.user.id).query(`UPDATE crm_workplans SET deleted_at=CONVERT(VARCHAR(19), GETDATE(), 120), deleted_by=@db WHERE id=@id`);
    res.json({ success: true, message: 'تم حذف خطة السير' });
}));

module.exports = router;
