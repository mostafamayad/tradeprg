const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const logActivity = require('../middleware/logger');
const { parsePagination, buildPaginationResponse } = require('../middleware/pagination');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync, recalcCustomerBalanceAsync } = require('../services/accountingEngine');

async function nextSettlementNo(pool) {
    const r = await pool.request().query(`SELECT ISNULL(MAX(CAST(SUBSTRING(settlement_no, 5, LEN(settlement_no)) AS INT)), 0)+1 AS nxt FROM crm_settlements WHERE settlement_no LIKE 'SET-%'`);
    return 'SET-' + String(r.recordset[0].nxt).padStart(5, '0');
}

router.get('/', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = pool.request();
    let w = 'WHERE s.deleted_at IS NULL';
    if (req.query.customer_id) { w += ' AND s.customer_id = @cid'; r.input('cid', sql.Int, req.query.customer_id); }
    if (req.query.type) { w += ' AND s.type = @tp'; r.input('tp', sql.NVarChar, req.query.type); }
    if (req.query.workflow_status) { w += ' AND s.workflow_status = @ws'; r.input('ws', sql.NVarChar, req.query.workflow_status); }
    if (req.query.created_by) { w += ' AND s.created_by = @cby'; r.input('cby', sql.Int, req.query.created_by); }
    if (req.query.date_from) { w += ' AND s.settlement_date >= @df'; r.input('df', sql.NVarChar, req.query.date_from); }
    if (req.query.date_to) { w += ' AND s.settlement_date <= @dt'; r.input('dt', sql.NVarChar, req.query.date_to); }
    if (req.query.reason) { w += ' AND s.reason LIKE @rsn'; r.input('rsn', sql.NVarChar, '%' + req.query.reason + '%'); }
    const { page, limit, offset } = parsePagination(req.query, { limit: 0, maxLimit: 200 });
    const sortWhitelist = ['settlement_date', 'settlement_no', 'type', 'amount', 'workflow_status'];
    let orderBy = 's.settlement_date';
    if (req.query.sort && sortWhitelist.includes(req.query.sort)) orderBy = 's.' + req.query.sort;
    const orderDir = req.query.order === 'ASC' ? 'ASC' : 'DESC';
    if (req.query.q) { w += ' AND (s.settlement_no LIKE @q OR c.customer_name LIKE @q)'; r.input('q', sql.NVarChar, '%' + req.query.q + '%'); }
    let total = 0;
    if (limit > 0) {
        const c = await r.query(`SELECT COUNT(*) AS total FROM crm_settlements s LEFT JOIN customers c ON s.customer_id=c.id ${w}`);
        total = c.recordset[0].total;
    }
    const q = `SELECT s.*, c.customer_name, u.username AS created_by_name FROM crm_settlements s LEFT JOIN customers c ON s.customer_id=c.id LEFT JOIN users u ON s.created_by = u.id ${w} ORDER BY ${orderBy} ${orderDir}${limit > 0 ? ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY` : ''}`;
    const result = await r.query(q);
    // Read-only report summary (debit / credit / net) computed over the same filters
    const sumRes = await r.query(`
        SELECT COUNT(*) AS total_count,
               ISNULL(SUM(CASE WHEN s.type='debit' THEN s.amount ELSE 0 END),0) AS total_debit,
               ISNULL(SUM(CASE WHEN s.type='credit' THEN s.amount ELSE 0 END),0) AS total_credit,
               ISNULL(SUM(CASE WHEN s.type='debit' THEN s.amount ELSE -s.amount END),0) AS net
        FROM crm_settlements s LEFT JOIN customers c ON s.customer_id=c.id ${w}`);
    const resp = { success: true, data: result.recordset, summary: sumRes.recordset[0] };
    const pg = buildPaginationResponse(total, { page, limit });
    if (pg) resp.pagination = pg;
    res.json(resp);
}));

router.get('/summary', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT
            COUNT(*) as total,
            ISNULL(SUM(CASE WHEN type='debit' THEN amount ELSE 0 END), 0) as total_debit,
            ISNULL(SUM(CASE WHEN type='credit' THEN amount ELSE 0 END), 0) as total_credit,
            ISNULL(SUM(CASE WHEN workflow_status='approved' THEN amount ELSE 0 END), 0) as total_approved
        FROM crm_settlements WHERE deleted_at IS NULL
    `);
    res.json({ success: true, data: r.recordset[0] });
}));

// Distinct users who created settlements — for the report "المستخدم" filter.
// Lives under the same 'customers' permission so report viewers can use it.
router.get('/creators', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT DISTINCT s.created_by AS id, u.username, u.full_name
        FROM crm_settlements s
        LEFT JOIN users u ON s.created_by = u.id
        WHERE s.deleted_at IS NULL AND s.created_by IS NOT NULL
        ORDER BY u.username
    `);
    res.json({ success: true, data: r.recordset });
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id).query(`
        SELECT s.*, c.customer_name FROM crm_settlements s LEFT JOIN customers c ON s.customer_id=c.id WHERE s.id = @id
    `);
    if (!r.recordset[0]) return res.status(404).json({ success: false, message: 'التسوية غير موجودة' });
    res.json({ success: true, data: r.recordset[0] });
}));

router.post('/', asyncHandler(async (req, res) => {
    const { customer_id, settlement_date, type, amount, reason, reference_type, reference_id } = req.body;
    if (!customer_id || !type || !amount) return res.status(400).json({ success: false, message: 'العميل والنوع والمبلغ مطلوبين' });
    if (!['debit', 'credit'].includes(type)) return res.status(400).json({ success: false, message: 'النوع يجب أن يكون debit أو credit' });
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        const settNo = await nextSettlementNo(pool);
        txReq.input('sn', sql.NVarChar, settNo); txReq.input('cid', sql.Int, customer_id);
        txReq.input('sd', sql.NVarChar, settlement_date || new Date().toISOString().slice(0, 10));
        txReq.input('tp', sql.NVarChar, type); txReq.input('am', sql.Decimal(18,2), amount);
        txReq.input('rs', sql.NVarChar, reason || null); txReq.input('rt', sql.NVarChar, reference_type || null);
        txReq.input('ri', sql.Int, reference_id || null); txReq.input('cb', sql.Int, req.user.id);
        const ins = await txReq.query(`
            INSERT INTO crm_settlements (settlement_no, customer_id, settlement_date, type, amount, reason, reference_type, reference_id, workflow_status, created_by)
            OUTPUT INSERTED.id VALUES (@sn, @cid, @sd, @tp, @am, @rs, @rt, @ri, 'draft', @cb)
        `);
        await tx.commit();
        await logActivity(req, 'CREATE', 'crm_settlements', null, `تسوية جديدة ${settNo}`, null, null, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم إنشاء التسوية', id: ins.recordset[0].id, settlement_no: settNo });
    } catch (e) { await tx.rollback(); throw e; }
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const { customer_id, settlement_date, type, amount, reason, reference_type, reference_id } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT workflow_status FROM crm_settlements WHERE id=@id`);
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'التسوية غير موجودة' });
    if (existing.recordset[0].workflow_status !== 'draft') return res.status(400).json({ success: false, message: 'يمكن تعديل التسويات في حالة المسودة فقط' });
    await pool.request()
        .input('id', sql.Int, req.params.id).input('cid', sql.Int, customer_id).input('sd', sql.NVarChar, settlement_date || new Date().toISOString().slice(0, 10))
        .input('tp', sql.NVarChar, type).input('am', sql.Decimal(18,2), amount).input('rs', sql.NVarChar, reason || null)
        .input('rt', sql.NVarChar, reference_type || null).input('ri', sql.Int, reference_id || null)
        .input('ub', sql.Int, req.user.id)
        .query(`UPDATE crm_settlements SET customer_id=@cid, settlement_date=@sd, type=@tp, amount=@am, reason=@rs, reference_type=@rt, reference_id=@ri, updated_by=@ub, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل التسوية' });
}));

router.patch('/:id/approve', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        const sett = await txReq.query(`SELECT * FROM crm_settlements WHERE id=${req.params.id}`);
        if (!sett.recordset[0]) { await tx.rollback(); return res.status(404).json({ success: false, message: 'التسوية غير موجودة' }); }
        const s = sett.recordset[0];
        if (s.workflow_status !== 'draft') { await tx.rollback(); return res.status(400).json({ success: false, message: 'يمكن اعتماد التسويات في حالة المسودة فقط' }); }

        await txReq.query(`UPDATE crm_settlements SET workflow_status='approved', updated_by=${req.user.id}, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=${req.params.id}`);

        const accAR = await getSystemAccountAsync(txReq, 'SYS_AR');
        const accOffset = await getSystemAccountAsync(txReq, 'SYS_EXPENSE');

        let lines;
        if (s.type === 'debit') {
            lines = [
                { account_id: accAR, debit: s.amount, credit: 0, description: `تسوية مدينة ${s.settlement_no}` },
                { account_id: accOffset, debit: 0, credit: s.amount, description: `تسوية مدينة ${s.settlement_no}` }
            ];
        } else {
            lines = [
                { account_id: accOffset, debit: s.amount, credit: 0, description: `تسوية دائنة ${s.settlement_no}` },
                { account_id: accAR, debit: 0, credit: s.amount, description: `تسوية دائنة ${s.settlement_no}` }
            ];
        }

        await postJournalEntryAsync(
            txReq, s.settlement_date, `تسوية عميل ${s.settlement_no}`, lines,
            'crm_settlement', s.id, req.user.id,
            { module: 'crm_settlements', action: 'approve', document: s.settlement_no, isSystem: true }
        );

        await recalcCustomerBalanceAsync(txReq, s.customer_id);
        await tx.commit();
        await logActivity(req, 'APPROVE', 'crm_settlements', null, `اعتماد تسوية ${s.settlement_no}`, null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم اعتماد التسوية' });
    } catch (e) { await tx.rollback(); throw e; }
}));

router.patch('/:id/reverse', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        const sett = await txReq.query(`SELECT * FROM crm_settlements WHERE id=${req.params.id}`);
        if (!sett.recordset[0]) { await tx.rollback(); return res.status(404).json({ success: false, message: 'التسوية غير موجودة' }); }
        const s = sett.recordset[0];
        if (s.workflow_status !== 'approved') { await tx.rollback(); return res.status(400).json({ success: false, message: 'يمكن عكس التسويات المعتمدة فقط' }); }

        const origJEs = await txReq.query(`SELECT id FROM journal_entries WHERE reference_type='crm_settlement' AND reference_id=${s.id} AND (is_reversed IS NULL OR is_reversed=0)`);
        for (const je of origJEs.recordset) {
            await reverseJournalEntryAsync(txReq, je.id, `عكس تسوية ${s.settlement_no}`, req.user.id);
        }

        await txReq.query(`UPDATE crm_settlements SET workflow_status='reversed', updated_by=${req.user.id}, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=${req.params.id}`);
        await recalcCustomerBalanceAsync(txReq, s.customer_id);
        await tx.commit();
        await logActivity(req, 'REVERSE', 'crm_settlements', null, `عكس تسوية ${s.settlement_no}`, null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم عكس التسوية' });
    } catch (e) { await tx.rollback(); throw e; }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT workflow_status FROM crm_settlements WHERE id=@id`);
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'التسوية غير موجودة' });
    if (existing.recordset[0].workflow_status !== 'draft') return res.status(400).json({ success: false, message: 'يمكن حذف التسويات في حالة المسودة فقط' });
    await pool.request().input('id', sql.Int, req.params.id).input('db', sql.Int, req.user.id).query(`UPDATE crm_settlements SET deleted_at=CONVERT(VARCHAR(19), GETDATE(), 120), deleted_by=@db WHERE id=@id`);
    res.json({ success: true, message: 'تم حذف التسوية' });
}));

module.exports = router;
