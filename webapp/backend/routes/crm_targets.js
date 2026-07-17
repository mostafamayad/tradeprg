const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const logActivity = require('../middleware/logger');
const { parsePagination, buildPaginationResponse } = require('../middleware/pagination');

router.get('/', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = pool.request();
    let w = 'WHERE t.deleted_at IS NULL';
    if (req.query.rep_id) { w += ' AND t.rep_id = @rep'; r.input('rep', sql.Int, req.query.rep_id); }
    if (req.query.period_month) { w += ' AND t.period_month = @pm'; r.input('pm', sql.Int, req.query.period_month); }
    if (req.query.period_year) { w += ' AND t.period_year = @py'; r.input('py', sql.Int, req.query.period_year); }
    const { page, limit, offset } = parsePagination(req.query, { limit: 0, maxLimit: 200 });
    const sortWhitelist = ['period_year', 'period_month', 'target_amount', 'commission_pct'];
    let orderBy = 't.period_year, t.period_month';
    if (req.query.sort && sortWhitelist.includes(req.query.sort)) orderBy = 't.' + req.query.sort;
    const orderDir = req.query.order === 'ASC' ? 'ASC' : 'DESC';
    let total = 0;
    if (limit > 0) {
        const c = await r.query(`SELECT COUNT(*) AS total FROM crm_targets t ${w}`);
        total = c.recordset[0].total;
    }
    const q = `SELECT t.*, sr.rep_name FROM crm_targets t LEFT JOIN sales_reps sr ON t.rep_id = sr.id ${w} ORDER BY ${orderBy} ${orderDir}${limit > 0 ? ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY` : ''}`;
    const result = await r.query(q);
    for (const row of result.recordset) {
        if (row.rep_id && row.period_month && row.period_year) {
            try {
                const a = await pool.request()
                    .input('rid', sql.Int, row.rep_id)
                    .input('pm', sql.Int, row.period_month)
                    .input('py', sql.Int, row.period_year)
                    .query(`SELECT ISNULL(SUM(CASE WHEN status='confirmed' THEN net_total ELSE 0 END), 0) AS ach FROM sales_invoices WHERE rep_id=@rid AND MONTH(invoice_date)=@pm AND YEAR(invoice_date)=@py AND deleted_at IS NULL`);
                row.achieved_amount = a.recordset[0].ach;
            } catch (e) { row.achieved_amount = 0; }
        }
    }
    const resp = { success: true, data: result.recordset };
    const pg = buildPaginationResponse(total, { page, limit });
    if (pg) resp.pagination = pg;
    res.json(resp);
}));

router.get('/summary', asyncHandler(async (req, res) => {
    const pool = await getPool();
    let w = 'WHERE t.deleted_at IS NULL';
    const r = pool.request();
    if (req.query.period_month) { w += ' AND t.period_month = @pm'; r.input('pm', sql.Int, req.query.period_month); }
    if (req.query.period_year) { w += ' AND t.period_year = @py'; r.input('py', sql.Int, req.query.period_year); }
    if (req.query.rep_id) { w += ' AND t.rep_id = @rep'; r.input('rep', sql.Int, req.query.rep_id); }
    const agg = await r.query(`
        SELECT COUNT(*) AS total_targets, ISNULL(SUM(target_amount),0) AS total_target, ISNULL(SUM(commission_amount),0) AS total_commission
        FROM crm_targets t ${w}
    `);
    const s = agg.recordset[0];
    let totalAchieved = 0;
    const targets = await pool.request().query(`SELECT t.id, t.rep_id, t.period_month, t.period_year, t.target_amount FROM crm_targets t WHERE t.deleted_at IS NULL`);
    for (const t of targets.recordset) {
        try {
            const a = await pool.request()
                .input('rid', sql.Int, t.rep_id)
                .input('pm', sql.Int, t.period_month)
                .input('py', sql.Int, t.period_year)
                .query(`SELECT ISNULL(SUM(CASE WHEN status='confirmed' THEN net_total ELSE 0 END), 0) AS ach FROM sales_invoices WHERE rep_id=@rid AND MONTH(invoice_date)=@pm AND YEAR(invoice_date)=@py AND deleted_at IS NULL`);
            totalAchieved += Number(a.recordset[0].ach) || 0;
        } catch (e) {}
    }
    s.total_achieved = totalAchieved;
    s.avg_achievement_pct = s.total_target > 0 ? ((totalAchieved / s.total_target) * 100).toFixed(2) : 0;
    res.json({ success: true, data: s });
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id).query(`
        SELECT t.*, sr.rep_name FROM crm_targets t LEFT JOIN sales_reps sr ON t.rep_id = sr.id WHERE t.id = @id
    `);
    if (!r.recordset[0]) return res.status(404).json({ success: false, message: 'الهدف غير موجود' });
    const row = r.recordset[0];
    if (row.rep_id && row.period_month && row.period_year) {
        try {
            const a = await pool.request()
                .input('rid', sql.Int, row.rep_id)
                .input('pm', sql.Int, row.period_month)
                .input('py', sql.Int, row.period_year)
                .query(`SELECT ISNULL(SUM(CASE WHEN status='confirmed' THEN net_total ELSE 0 END), 0) AS ach FROM sales_invoices WHERE rep_id=@rid AND MONTH(invoice_date)=@pm AND YEAR(invoice_date)=@py AND deleted_at IS NULL`);
            row.achieved_amount = a.recordset[0].ach;
        } catch (e) { row.achieved_amount = 0; }
    }
    res.json({ success: true, data: row });
}));

router.post('/', asyncHandler(async (req, res) => {
    const { rep_id, period_month, period_year, target_amount, commission_pct, commission_amount, notes } = req.body;
    if (!rep_id || !period_month || !period_year) return res.status(400).json({ success: false, message: 'المندوب والشهر والسنة مطلوبين' });
    const pool = await getPool();
    const dup = await pool.request().input('r', sql.Int, rep_id).input('pm', sql.Int, period_month).input('py', sql.Int, period_year).query(`SELECT id FROM crm_targets WHERE rep_id=@r AND period_month=@pm AND period_year=@py AND deleted_at IS NULL`);
    if (dup.recordset[0]) return res.status(409).json({ success: false, message: 'يوجد هدف مكرر لهذا المندوب في نفس الشهر' });
    const r = await pool.request()
        .input('r', sql.Int, rep_id).input('pm', sql.Int, period_month).input('py', sql.Int, period_year)
        .input('ta', sql.Decimal(18,2), target_amount || 0).input('cp', sql.Decimal(5,2), commission_pct || 0)
        .input('ca', sql.Decimal(18,2), commission_amount || 0).input('ns', sql.NVarChar, notes || null)
        .input('cb', sql.Int, req.user.id)
        .query(`INSERT INTO crm_targets (rep_id, period_month, period_year, target_amount, commission_pct, commission_amount, notes, created_by) OUTPUT INSERTED.id VALUES (@r, @pm, @py, @ta, @cp, @ca, @ns, @cb)`);
    await logActivity(req, 'CREATE', 'crm_targets', null, `هدف جديد للشهر ${period_month}/${period_year}`, null, null, 'SUCCESS', null);
    res.status(201).json({ success: true, message: 'تم إنشاء الهدف', id: r.recordset[0].id });
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const { target_amount, commission_pct, commission_amount, notes } = req.body;
    const pool = await getPool();
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('ta', sql.Decimal(18,2), target_amount || 0).input('cp', sql.Decimal(5,2), commission_pct || 0)
        .input('ca', sql.Decimal(18,2), commission_amount || 0).input('ns', sql.NVarChar, notes || null)
        .input('ub', sql.Int, req.user.id)
        .query(`UPDATE crm_targets SET target_amount=@ta, commission_pct=@cp, commission_amount=@ca, notes=@ns, updated_by=@ub, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل الهدف' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).input('db', sql.Int, req.user.id).query(`UPDATE crm_targets SET deleted_at=CONVERT(VARCHAR(19), GETDATE(), 120), deleted_by=@db WHERE id=@id`);
    res.json({ success: true, message: 'تم حذف الهدف' });
}));

module.exports = router;
