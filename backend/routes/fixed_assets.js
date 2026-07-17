const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const logActivity = require('../middleware/logger');
const { parsePagination, buildPaginationResponse } = require('../middleware/pagination');
const { postJournalEntryAsync, getSystemAccountAsync, reverseJournalEntryAsync } = require('../services/accountingEngine');

// ── Helpers ──
async function nextAssetCode(pool) {
    const r = await pool.request().query(`SELECT ISNULL(MAX(CAST(SUBSTRING(asset_code, 4, LEN(asset_code)) AS INT)), 0)+1 AS nxt FROM fixed_assets WHERE asset_code LIKE 'FA-%'`);
    return 'FA-' + String(r.recordset[0].nxt).padStart(5, '0');
}

async function nextMovementNo(pool) {
    const r = await pool.request().query(`SELECT ISNULL(MAX(CAST(SUBSTRING(movement_no, 4, LEN(movement_no)) AS INT)), 0)+1 AS nxt FROM asset_movements WHERE movement_no LIKE 'MV-%'`);
    return 'MV-' + String(r.recordset[0].nxt).padStart(5, '0');
}

// ── Asset Categories ──
router.get('/categories', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().query(`SELECT * FROM asset_categories WHERE deleted_at IS NULL ORDER BY name`);
    res.json({ success: true, data: r.recordset });
}));

router.post('/categories', asyncHandler(async (req, res) => {
    const { name, description, useful_life_months, depreciation_method, parent_id } = req.body;
    if (!name || !useful_life_months) return res.status(400).json({ success: false, message: 'الاسم وعدد شهور العمر الإنتاجي مطلوبان' });
    const pool = await getPool();
    const r = await pool.request()
        .input('nm', sql.NVarChar, name).input('desc', sql.NVarChar, description || null)
        .input('ulm', sql.Decimal(5,1), useful_life_months).input('dm', sql.NVarChar, depreciation_method || 'straight-line')
        .input('pid', sql.Int, parent_id || null).input('cb', sql.Int, req.user.id)
        .query(`INSERT INTO asset_categories (name, description, useful_life_months, depreciation_method, parent_id, created_by) OUTPUT INSERTED.id VALUES (@nm, @desc, @ulm, @dm, @pid, @cb)`);
    await logActivity(req, 'CREATE', 'asset_categories', null, `فئة أصول جديدة: ${name}`, null, null, 'SUCCESS', null);
    res.status(201).json({ success: true, message: 'تم إنشاء الفئة', id: r.recordset[0].id });
}));

router.put('/categories/:id', asyncHandler(async (req, res) => {
    const { name, description, useful_life_months, depreciation_method, parent_id } = req.body;
    const pool = await getPool();
    await pool.request()
        .input('id', sql.Int, req.params.id).input('nm', sql.NVarChar, name).input('desc', sql.NVarChar, description || null)
        .input('ulm', sql.Decimal(5,1), useful_life_months).input('dm', sql.NVarChar, depreciation_method || 'straight-line')
        .input('pid', sql.Int, parent_id || null).input('ub', sql.Int, req.user.id)
        .query(`UPDATE asset_categories SET name=@nm, description=@desc, useful_life_months=@ulm, depreciation_method=@dm, parent_id=@pid, updated_by=@ub, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل الفئة' });
}));

router.delete('/categories/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const used = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT COUNT(*) AS cnt FROM fixed_assets WHERE category_id=@id AND deleted_at IS NULL`);
    if (used.recordset[0].cnt > 0) return res.status(400).json({ success: false, message: 'لا يمكن حذف فئة مرتبطة بأصول' });
    await pool.request().input('id', sql.Int, req.params.id).input('db', sql.Int, req.user.id).query(`UPDATE asset_categories SET deleted_at=CONVERT(VARCHAR(19), GETDATE(), 120), deleted_by=@db WHERE id=@id`);
    res.json({ success: true, message: 'تم حذف الفئة' });
}));

// ── Fixed Assets CRUD ──
router.get('/', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = pool.request();
    let w = 'WHERE a.deleted_at IS NULL';
    if (req.query.category_id) { w += ' AND a.category_id = @cat'; r.input('cat', sql.Int, req.query.category_id); }
    if (req.query.asset_status) { w += ' AND a.asset_status = @st'; r.input('st', sql.NVarChar, req.query.asset_status); }
    if (req.query.q) { w += ' AND (a.asset_name LIKE @q OR a.asset_code LIKE @q)'; r.input('q', sql.NVarChar, '%' + req.query.q + '%'); }
    const { page, limit, offset } = parsePagination(req.query, { limit: 0, maxLimit: 200 });
    const sortWhitelist = ['asset_code', 'asset_name', 'purchase_date', 'purchase_cost', 'asset_status'];
    let orderBy = 'a.created_at';
    if (req.query.sort && sortWhitelist.includes(req.query.sort)) orderBy = 'a.' + req.query.sort;
    const orderDir = req.query.order === 'ASC' ? 'ASC' : 'DESC';
    let total = 0;
    if (limit > 0) {
        const c = await r.query(`SELECT COUNT(*) AS total FROM fixed_assets a ${w}`);
        total = c.recordset[0].total;
    }
    const q = `SELECT a.*, c.name AS category_name FROM fixed_assets a LEFT JOIN asset_categories c ON a.category_id=c.id ${w} ORDER BY ${orderBy} ${orderDir}${limit > 0 ? ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY` : ''}`;
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
            COUNT(*) AS total_assets,
            ISNULL(SUM(purchase_cost), 0) AS total_cost,
            ISNULL(SUM(accumulated_depreciation), 0) AS total_depreciation,
            ISNULL(SUM(CASE WHEN asset_status='active' THEN purchase_cost - accumulated_depreciation ELSE 0 END), 0) AS total_nbv,
            COUNT(CASE WHEN asset_status='active' THEN 1 END) AS active_assets,
            ISNULL(SUM(CASE WHEN asset_status='active' AND purchase_cost - accumulated_depreciation <= 0 THEN 1 ELSE 0 END), 0) AS fully_depreciated
        FROM fixed_assets WHERE deleted_at IS NULL
    `);
    res.json({ success: true, data: r.recordset[0] });
}));

router.get('/dashboard', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT
            COUNT(*) AS total_assets,
            ISNULL(SUM(purchase_cost), 0) AS total_cost,
            ISNULL(SUM(accumulated_depreciation), 0) AS total_acc_depreciation,
            ISNULL(SUM(CASE WHEN asset_status='active' THEN purchase_cost - accumulated_depreciation ELSE 0 END), 0) AS total_net_book_value,
            COUNT(CASE WHEN asset_status='active' AND (purchase_cost - accumulated_depreciation) > 0 THEN 1 END) AS depreciable_assets,
            COUNT(CASE WHEN asset_status='active' AND (purchase_cost - accumulated_depreciation) <= 0 THEN 1 END) AS expired_assets
        FROM fixed_assets WHERE deleted_at IS NULL
    `);
    res.json({ success: true, data: r.recordset[0] });
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id).query(`
        SELECT a.*, c.name AS category_name FROM fixed_assets a
        LEFT JOIN asset_categories c ON a.category_id=c.id WHERE a.id=@id
    `);
    if (!r.recordset[0]) return res.status(404).json({ success: false, message: 'الأصل غير موجود' });
    res.json({ success: true, data: r.recordset[0] });
}));

router.get('/:id/depreciation', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().input('aid', sql.Int, req.params.id).query(`
        SELECT d.*, je.entry_no FROM asset_depreciation d
        LEFT JOIN journal_entries je ON d.journal_entry_id=je.id
        WHERE d.asset_id=@aid ORDER BY d.period_date DESC
    `);
    res.json({ success: true, data: r.recordset });
}));

router.post('/', asyncHandler(async (req, res) => {
    const { asset_name, category_id, purchase_date, purchase_cost, salvage_value, useful_life_months, source_type, location, serial_number, notes } = req.body;
    if (!asset_name || !category_id || !purchase_date || purchase_cost == null) return res.status(400).json({ success: false, message: 'اسم الأصل والفئة وتاريخ الشراء والتكلفة مطلوبة' });
    if (!useful_life_months || useful_life_months <= 0) return res.status(400).json({ success: false, message: 'العمر الإنتاجي بالأشهر مطلوب' });
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        const code = await nextAssetCode(pool);
        txReq.input('catId', sql.Int, category_id);
        const catCheck = await txReq.query(`SELECT useful_life_months FROM asset_categories WHERE id=@catId`);
        const catLife = catCheck.recordset[0] ? catCheck.recordset[0].useful_life_months : useful_life_months;
        txReq.input('code', sql.NVarChar, code); txReq.input('nm', sql.NVarChar, asset_name);
        txReq.input('cat', sql.Int, category_id); txReq.input('pd', sql.NVarChar, purchase_date);
        txReq.input('pc', sql.Decimal(18,2), purchase_cost); txReq.input('sv', sql.Decimal(18,2), salvage_value || 0);
        txReq.input('ulm', sql.Decimal(5,1), catLife); txReq.input('loc', sql.NVarChar, location || null);
        txReq.input('sn', sql.NVarChar, serial_number || null); txReq.input('nt', sql.NVarChar, notes || null);
        txReq.input('cb', sql.Int, req.user.id);
        const ins = await txReq.query(`
            INSERT INTO fixed_assets (asset_code, asset_name, category_id, purchase_date, purchase_cost, salvage_value, useful_life_months, depreciation_method, location, serial_number, notes, asset_status, created_by)
            OUTPUT INSERTED.id VALUES (@code, @nm, @cat, @pd, @pc, @sv, @ulm, 'straight-line', @loc, @sn, @nt, 'active', @cb)
        `);
        const assetId = ins.recordset[0].id;

        // Create JE if source is not from purchase invoice
        if (source_type === 'opening_balance' || source_type === 'capital') {
            const accFA = await getSystemAccountAsync(txReq, 'SYS_FIXED_ASSET');
            let accCredit;
            if (source_type === 'capital') accCredit = await getSystemAccountAsync(txReq, 'SYS_CAPITAL');
            else accCredit = await getSystemAccountAsync(txReq, 'SYS_RETAINED_EARNINGS');
            await postJournalEntryAsync(
                txReq, purchase_date, `تسجيل أصل ثابت ${code} - ${asset_name}`,
                [
                    { account_id: accFA, debit: purchase_cost, credit: 0, description: `شراء ${asset_name}` },
                    { account_id: accCredit, debit: 0, credit: purchase_cost, description: `مقابل تسجيل ${code}` }
                ],
                'fixed_asset', assetId, req.user.id,
                { module: 'fixed_assets', action: 'create', document: code, isSystem: true }
            );
        }
        await tx.commit();
        await logActivity(req, 'CREATE', 'fixed_assets', null, `أصل ثابت جديد ${code}`, null, null, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم إنشاء الأصل', id: assetId, asset_code: code });
    } catch (e) { await tx.rollback(); throw e; }
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const { asset_name, purchase_date, purchase_cost, salvage_value, useful_life_months, location, serial_number, notes } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT asset_status, accumulated_depreciation FROM fixed_assets WHERE id=@id`);
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'الأصل غير موجود' });
    const asset = existing.recordset[0];
    if (asset.asset_status !== 'active') return res.status(400).json({ success: false, message: 'يمكن تعديل الأصول النشطة فقط' });
    if (asset.accumulated_depreciation > 0) return res.status(400).json({ success: false, message: 'لا يمكن تعديل أصل بدأ إهلاكه' });
    await pool.request()
        .input('id', sql.Int, req.params.id).input('nm', sql.NVarChar, asset_name).input('pd', sql.NVarChar, purchase_date || null)
        .input('pc', sql.Decimal(18,2), purchase_cost).input('sv', sql.Decimal(18,2), salvage_value || 0)
        .input('ulm', sql.Decimal(5,1), useful_life_months || null).input('loc', sql.NVarChar, location || null)
        .input('sn', sql.NVarChar, serial_number || null).input('nt', sql.NVarChar, notes || null)
        .input('ub', sql.Int, req.user.id)
        .query(`UPDATE fixed_assets SET asset_name=@nm, purchase_date=@pd, purchase_cost=@pc, salvage_value=@sv, useful_life_months=@ulm, location=@loc, serial_number=@sn, notes=@nt, updated_by=@ub, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل الأصل' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT asset_status, accumulated_depreciation FROM fixed_assets WHERE id=@id`);
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'الأصل غير موجود' });
    const asset = existing.recordset[0];
    if (asset.asset_status !== 'active') return res.status(400).json({ success: false, message: 'يمكن حذف الأصول النشطة فقط' });
    if (asset.accumulated_depreciation > 0) return res.status(400).json({ success: false, message: 'لا يمكن حذف أصل بدأ إهلاكه' });
    await pool.request().input('id', sql.Int, req.params.id).input('db', sql.Int, req.user.id)
        .query(`UPDATE fixed_assets SET deleted_at=CONVERT(VARCHAR(19), GETDATE(), 120), deleted_by=@db WHERE id=@id`);
    res.json({ success: true, message: 'تم حذف الأصل' });
}));

// ── Depreciation Engine (Straight-Line, No Duplicates) ──
router.post('/:id/depreciate', asyncHandler(async (req, res) => {
    const { period_date } = req.body;
    if (!period_date) return res.status(400).json({ success: false, message: 'تاريخ الفترة مطلوب' });
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        txReq.input('faid', sql.Int, req.params.id);
        const assetRes = await txReq.query(`SELECT * FROM fixed_assets WHERE id=@faid`);
        if (!assetRes.recordset[0]) { await tx.rollback(); return res.status(404).json({ success: false, message: 'الأصل غير موجود' }); }
        const a = assetRes.recordset[0];
        if (a.asset_status !== 'active') { await tx.rollback(); return res.status(400).json({ success: false, message: 'يمكن إهلاك الأصول النشطة فقط' }); }
        if (a.purchase_cost - a.accumulated_depreciation <= 0) { await tx.rollback(); return res.status(400).json({ success: false, message: 'الأصل مستهلك بالكامل' }); }

        txReq.input('pdate', sql.NVarChar, period_date);

        // Prevent duplicate
        const dupCheck = await txReq.query(`SELECT id FROM asset_depreciation WHERE asset_id=@faid AND period_date=@pdate`);
        if (dupCheck.recordset[0]) { await tx.rollback(); return res.status(400).json({ success: false, message: 'تم إهلاك هذا الأصل في هذه الفترة مسبقاً' }); }

        const monthlyDep = (a.purchase_cost - a.salvage_value) / a.useful_life_months;
        const newAccum = a.accumulated_depreciation + monthlyDep;
        const actualDep = newAccum > a.purchase_cost ? (a.purchase_cost - a.accumulated_depreciation) : monthlyDep;
        const finalAccum = a.accumulated_depreciation + actualDep;

        const accDepExp = await getSystemAccountAsync(txReq, 'SYS_DEPRECIATION_EXPENSE');
        const accAccum = await getSystemAccountAsync(txReq, 'SYS_ACCUM_DEPRECIATION');

        const jeId = await postJournalEntryAsync(
            txReq, period_date, `إهلاك ${a.asset_code} - ${a.asset_name}`,
            [
                { account_id: accDepExp, debit: actualDep, credit: 0, description: `إهلاك شهر ${period_date}` },
                { account_id: accAccum, debit: 0, credit: actualDep, description: `مجمع إهلاك ${a.asset_code}` }
            ],
            'fixed_asset_depreciation', a.id, req.user.id,
            { module: 'fixed_assets', action: 'depreciate', document: a.asset_code, isSystem: true }
        );

        txReq.input('fact', sql.Decimal(18,2), finalAccum);
        txReq.input('ub', sql.Int, req.user.id);
        // Update asset accumulated_depreciation
        await txReq.query(`UPDATE fixed_assets SET accumulated_depreciation=@fact, updated_by=@ub, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@faid`);

        txReq.input('dact', sql.Decimal(18,2), actualDep);
        txReq.input('jeid', sql.Int, jeId);
        // Record depreciation
        await txReq.query(`
            INSERT INTO asset_depreciation (asset_id, period_date, depreciation_amount, accumulated_after, journal_entry_id, created_by)
            VALUES (@faid, @pdate, @dact, @fact, @jeid, @ub)
        `);

        await tx.commit();
        await logActivity(req, 'DEPRECIATE', 'fixed_assets', null, `إهلاك ${a.asset_code} - ${actualDep} لشهر ${period_date}`, null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم إهلاك الأصل', depreciation: actualDep, accumulated: finalAccum });
    } catch (e) { await tx.rollback(); throw e; }
}));

router.post('/depreciate-batch', asyncHandler(async (req, res) => {
    const { period_date } = req.body;
    if (!period_date) return res.status(400).json({ success: false, message: 'تاريخ الفترة مطلوب' });
    const pool = await getPool();
    const active = await pool.request()
        .input('bpPeriod', sql.NVarChar, period_date)
        .query(`
        SELECT * FROM fixed_assets WHERE asset_status='active' AND deleted_at IS NULL
        AND (purchase_cost - accumulated_depreciation) > 0
        AND id NOT IN (SELECT asset_id FROM asset_depreciation WHERE period_date=@bpPeriod)
    `);
    let done = 0, errors = 0;
    for (const asset of active.recordset) {
        const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
        try {
            const monthlyDep = (asset.purchase_cost - asset.salvage_value) / asset.useful_life_months;
            const newAccum = asset.accumulated_depreciation + monthlyDep;
            const actualDep = newAccum > asset.purchase_cost ? (asset.purchase_cost - asset.accumulated_depreciation) : monthlyDep;
            const finalAccum = asset.accumulated_depreciation + actualDep;

            const accDepExp = await getSystemAccountAsync(txReq, 'SYS_DEPRECIATION_EXPENSE');
            const accAccum = await getSystemAccountAsync(txReq, 'SYS_ACCUM_DEPRECIATION');

            const jeId = await postJournalEntryAsync(
                txReq, period_date, `إهلاك ${asset.asset_code} - ${asset.asset_name}`,
                [
                    { account_id: accDepExp, debit: actualDep, credit: 0, description: `إهلاك شهر ${period_date}` },
                    { account_id: accAccum, debit: 0, credit: actualDep, description: `مجمع إهلاك ${asset.asset_code}` }
                ],
                'fixed_asset_depreciation', asset.id, req.user.id,
                { module: 'fixed_assets', action: 'depreciate_batch', document: asset.asset_code, isSystem: true }
            );

            txReq.input('bFact', sql.Decimal(18,2), finalAccum);
            txReq.input('bUb', sql.Int, req.user.id);
            txReq.input('bId', sql.Int, asset.id);
            txReq.input('bDact', sql.Decimal(18,2), actualDep);
            txReq.input('bJeid', sql.Int, jeId);
            txReq.input('bPeriod', sql.NVarChar, period_date);

            await txReq.query(`UPDATE fixed_assets SET accumulated_depreciation=@bFact, updated_by=@bUb, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@bId`);
            await txReq.query(`
                INSERT INTO asset_depreciation (asset_id, period_date, depreciation_amount, accumulated_after, journal_entry_id, created_by)
                VALUES (@bId, @bPeriod, @bDact, @bFact, @bJeid, @bUb)
            `);
            await tx.commit();
            done++;
        } catch (e) { await tx.rollback(); errors++; }
    }
    await logActivity(req, 'DEPRECIATE_BATCH', 'fixed_assets', null, `إهلاك دفعة لـ ${done} أصل (${errors} أخطاء) لشهر ${period_date}`, null, null, 'SUCCESS', null);
    res.json({ success: true, message: `تم إهلاك ${done} أصل (${errors} فشل)`, processed: done, failed: errors });
}));

// ── Asset Movements (Disposal / Sell / Transfer) ──
router.post('/:id/dispose', asyncHandler(async (req, res) => {
    const { movement_date, notes } = req.body;
    if (!movement_date) return res.status(400).json({ success: false, message: 'تاريخ التصرف مطلوب' });
    const pool = await getPool();
    const asset = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM fixed_assets WHERE id=@id`);
    if (!asset.recordset[0]) return res.status(404).json({ success: false, message: 'الأصل غير موجود' });
    const a = asset.recordset[0];
    if (a.asset_status !== 'active') return res.status(400).json({ success: false, message: 'يمكن التصرف في الأصول النشطة فقط' });
    const mvNo = await nextMovementNo(pool);
    const r = await pool.request()
        .input('mn', sql.NVarChar, mvNo).input('aid', sql.Int, a.id).input('mt', sql.NVarChar, 'disposal')
        .input('md', sql.NVarChar, movement_date).input('nt', sql.NVarChar, notes || null)
        .input('cb', sql.Int, req.user.id)
        .query(`INSERT INTO asset_movements (movement_no, asset_id, movement_type, movement_date, workflow_status, notes, created_by) OUTPUT INSERTED.id VALUES (@mn, @aid, @mt, @md, 'draft', @nt, @cb)`);
    await logActivity(req, 'CREATE', 'asset_movements', null, `تصرف في أصل ${a.asset_code} - مسودة ${mvNo}`, null, null, 'SUCCESS', null);
    res.status(201).json({ success: true, message: 'تم إنشاء إجراء التصرف (مسودة)', id: r.recordset[0].id, movement_no: mvNo });
}));

router.post('/:id/sell', asyncHandler(async (req, res) => {
    const { movement_date, selling_price, buyer_name, notes } = req.body;
    if (!movement_date || selling_price == null) return res.status(400).json({ success: false, message: 'تاريخ البيع وسعر البيع مطلوبان' });
    const pool = await getPool();
    const asset = await pool.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM fixed_assets WHERE id=@id`);
    if (!asset.recordset[0]) return res.status(404).json({ success: false, message: 'الأصل غير موجود' });
    const a = asset.recordset[0];
    if (a.asset_status !== 'active') return res.status(400).json({ success: false, message: 'يمكن بيع الأصول النشطة فقط' });
    const mvNo = await nextMovementNo(pool);
    const r = await pool.request()
        .input('mn', sql.NVarChar, mvNo).input('aid', sql.Int, a.id).input('mt', sql.NVarChar, 'sale')
        .input('md', sql.NVarChar, movement_date).input('am', sql.Decimal(18,2), selling_price)
        .input('buy', sql.NVarChar, buyer_name || null).input('nt', sql.NVarChar, notes || null)
        .input('cb', sql.Int, req.user.id)
        .query(`INSERT INTO asset_movements (movement_no, asset_id, movement_type, movement_date, amount, buyer_name, workflow_status, notes, created_by) OUTPUT INSERTED.id VALUES (@mn, @aid, @mt, @md, @am, @buy, 'draft', @nt, @cb)`);
    await logActivity(req, 'CREATE', 'asset_movements', null, `بيع أصل ${a.asset_code} - مسودة ${mvNo}`, null, null, 'SUCCESS', null);
    res.status(201).json({ success: true, message: 'تم إنشاء إجراء البيع (مسودة)', id: r.recordset[0].id, movement_no: mvNo });
}));

router.post('/:id/transfer', asyncHandler(async (req, res) => {
    const { movement_date, from_location, to_location, notes } = req.body;
    if (!movement_date || !to_location) return res.status(400).json({ success: false, message: 'تاريخ النقل والموقع الجديد مطلوبان' });
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        txReq.input('tfId', sql.Int, req.params.id);
        const assetRes = await txReq.query(`SELECT * FROM fixed_assets WHERE id=@tfId`);
        if (!assetRes.recordset[0]) { await tx.rollback(); return res.status(404).json({ success: false, message: 'الأصل غير موجود' }); }
        const a = assetRes.recordset[0];
        if (a.asset_status !== 'active') { await tx.rollback(); return res.status(400).json({ success: false, message: 'يمكن نقل الأصول النشطة فقط' }); }
        txReq.input('tfLoc', sql.NVarChar, to_location);
        txReq.input('tfUb', sql.Int, req.user.id);
        await txReq.query(`UPDATE fixed_assets SET location=@tfLoc, updated_by=@tfUb, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@tfId`);
        const mvNo = await nextMovementNo(pool);
        txReq.input('tfMn', sql.NVarChar, mvNo);
        txReq.input('tfMv', sql.NVarChar, 'transfer');
        txReq.input('tfMd', sql.NVarChar, movement_date);
        txReq.input('tfFrom', sql.NVarChar, from_location || a.location);
        txReq.input('tfNotes', sql.NVarChar, notes || null);
        await txReq.query(`INSERT INTO asset_movements (movement_no, asset_id, movement_type, movement_date, from_location, to_location, workflow_status, notes, created_by) VALUES (@tfMn, @tfId, @tfMv, @tfMd, @tfFrom, @tfLoc, 'posted', @tfNotes, @tfUb)`);
        await tx.commit();
        res.json({ success: true, message: 'تم نقل الأصل', movement_no: mvNo });
    } catch (e) { await tx.rollback(); throw e; }
}));

// ── Approve / Post / Reverse Movements (Disposal & Sell) ──
function getMovementJoin(mid, txReq) {
    txReq.input('gmid', sql.Int, mid);
    return txReq.query(`SELECT m.*, a.asset_code, a.asset_name, a.purchase_cost, a.accumulated_depreciation, a.salvage_value, a.useful_life_months, a.asset_status AS cur_status FROM asset_movements m JOIN fixed_assets a ON m.asset_id=a.id WHERE m.id=@gmid`);
}

router.patch('/movements/:id/approve', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        const movRes = await getMovementJoin(req.params.id, txReq);
        if (!movRes.recordset[0]) { await tx.rollback(); return res.status(404).json({ success: false, message: 'الإجراء غير موجود' }); }
        const m = movRes.recordset[0];
        if (m.workflow_status !== 'draft') { await tx.rollback(); return res.status(400).json({ success: false, message: 'يمكن اعتماد المسودات فقط' }); }
        txReq.input('apUb', sql.Int, req.user.id).input('apId', sql.Int, m.id);
        await txReq.query(`UPDATE asset_movements SET workflow_status='approved', updated_by=@apUb, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@apId`);
        await tx.commit();
        res.json({ success: true, message: 'تم اعتماد الإجراء' });
    } catch (e) { await tx.rollback(); throw e; }
}));

router.patch('/movements/:id/post', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        const movRes = await getMovementJoin(req.params.id, txReq);
        if (!movRes.recordset[0]) { await tx.rollback(); return res.status(404).json({ success: false, message: 'الإجراء غير موجود' }); }
        const m = movRes.recordset[0];
        if (m.workflow_status !== 'approved') { await tx.rollback(); return res.status(400).json({ success: false, message: 'يمكن ترحيل الإجراءات المعتمدة فقط' }); }
        if (m.cur_status !== 'active') { await tx.rollback(); return res.status(400).json({ success: false, message: 'الأصل غير نشط' }); }

        const accFA = await getSystemAccountAsync(txReq, 'SYS_FIXED_ASSET');
        const accAccum = await getSystemAccountAsync(txReq, 'SYS_ACCUM_DEPRECIATION');
        const accGainLoss = await getSystemAccountAsync(txReq, 'SYS_GAIN_LOSS_ASSET');

        let lines, newStatus, jeDesc;
        if (m.movement_type === 'disposal') {
            const nbv = m.purchase_cost - m.accumulated_depreciation;
            lines = [
                { account_id: accAccum, debit: m.accumulated_depreciation, credit: 0, description: `تخريد ${m.asset_code}` },
                { account_id: accGainLoss, debit: nbv > 0 ? nbv : 0, credit: 0, description: `خسارة تخريد ${m.asset_code}` },
                { account_id: accFA, debit: 0, credit: m.purchase_cost, description: `إخراج ${m.asset_code} من سجل الأصول` }
            ];
            if (nbv <= 0) lines = lines.filter(l => l.debit > 0 || l.credit > 0);
            newStatus = 'disposed';
            jeDesc = `تخريد أصل ${m.asset_code} - ${m.asset_name}`;
        } else if (m.movement_type === 'sale') {
            const nbv = m.purchase_cost - m.accumulated_depreciation;
            const gainLoss = m.amount - nbv;
            lines = [
                { account_id: accAccum, debit: m.accumulated_depreciation, credit: 0, description: `إهلاك متراكم ${m.asset_code}` },
                { account_id: accFA, debit: 0, credit: m.purchase_cost, description: `إخراج ${m.asset_code} من سجل الأصول` }
            ];
            // We need a cash/bank account for selling price - use SYS_CASH
            const accCash = await getSystemAccountAsync(txReq, 'SYS_CASH');
            lines.push({ account_id: accCash, debit: m.amount, credit: 0, description: `ثمن بيع ${m.asset_code}` });
            if (gainLoss > 0) {
                lines.push({ account_id: accGainLoss, debit: 0, credit: gainLoss, description: `ربح بيع ${m.asset_code}` });
            } else if (gainLoss < 0) {
                lines.push({ account_id: accGainLoss, debit: Math.abs(gainLoss), credit: 0, description: `خسارة بيع ${m.asset_code}` });
            }
            newStatus = 'sold';
            jeDesc = `بيع أصل ${m.asset_code} - ${m.asset_name} بقيمة ${m.amount}`;
        }

        const jeId = await postJournalEntryAsync(
            txReq, m.movement_date, jeDesc, lines,
            'fixed_asset_movement', m.id, req.user.id,
            { module: 'fixed_assets', action: m.movement_type, document: m.movement_no, isSystem: true }
        );

        txReq.input('pSt', sql.NVarChar, newStatus).input('pUb', sql.Int, req.user.id).input('pAid', sql.Int, m.asset_id).input('pJe', sql.Int, jeId || null).input('pMid', sql.Int, m.id);
        await txReq.query(`UPDATE fixed_assets SET asset_status=@pSt, updated_by=@pUb, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@pAid`);
        await txReq.query(`UPDATE asset_movements SET workflow_status='posted', journal_entry_id=@pJe, updated_by=@pUb, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@pMid`);

        await tx.commit();
        await logActivity(req, 'POST', 'asset_movements', null, `ترحيل ${m.movement_no} - ${m.asset_code}`, null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم ترحيل الإجراء', journal_entry_id: jeId });
    } catch (e) { await tx.rollback(); throw e; }
}));

router.patch('/movements/:id/reverse', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const tx = new sql.Transaction(pool); await tx.begin(); const txReq = tx.request();
    try {
        const movRes = await getMovementJoin(req.params.id, txReq);
        if (!movRes.recordset[0]) { await tx.rollback(); return res.status(404).json({ success: false, message: 'الإجراء غير موجود' }); }
        const m = movRes.recordset[0];
        if (m.workflow_status !== 'posted') { await tx.rollback(); return res.status(400).json({ success: false, message: 'يمكن عكس الإجراءات المرحلة فقط' }); }

        txReq.input('rvMid', sql.Int, m.id);
        const origJEs = await txReq.query(`SELECT id FROM journal_entries WHERE reference_type='fixed_asset_movement' AND reference_id=@rvMid AND (is_reversed IS NULL OR is_reversed=0)`);
        for (const je of origJEs.recordset) {
            await reverseJournalEntryAsync(txReq, je.id, `عكس ${m.movement_no}`, req.user.id);
        }

        txReq.input('rvUb', sql.Int, req.user.id).input('rvAid', sql.Int, m.asset_id);
        await txReq.query(`UPDATE fixed_assets SET asset_status='active', updated_by=@rvUb, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@rvAid`);
        await txReq.query(`UPDATE asset_movements SET workflow_status='reversed', updated_by=@rvUb, updated_at=CONVERT(VARCHAR(19), GETDATE(), 120) WHERE id=@rvMid`);

        await tx.commit();
        await logActivity(req, 'REVERSE', 'asset_movements', null, `عكس ${m.movement_no}`, null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم عكس الإجراء' });
    } catch (e) { await tx.rollback(); throw e; }
}));

// ── Reports ──
router.get('/reports/register', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT a.*, c.name AS category_name FROM fixed_assets a
        LEFT JOIN asset_categories c ON a.category_id=c.id
        WHERE a.deleted_at IS NULL ORDER BY a.purchase_date
    `);
    res.json({ success: true, data: r.recordset });
}));

router.get('/reports/depreciation-schedule', asyncHandler(async (req, res) => {
    const pool = await getPool();
    let w = '';
    if (req.query.asset_id) { w = ' WHERE d.asset_id = ' + parseInt(req.query.asset_id); }
    const r = await pool.request().query(`
        SELECT d.*, a.asset_code, a.asset_name, je.entry_no FROM asset_depreciation d
        JOIN fixed_assets a ON d.asset_id=a.id
        LEFT JOIN journal_entries je ON d.journal_entry_id=je.id
        ${w} ORDER BY d.period_date DESC
    `);
    res.json({ success: true, data: r.recordset });
}));

router.get('/reports/movement', asyncHandler(async (req, res) => {
    const pool = await getPool();
    let w = 'WHERE m.deleted_at IS NULL';
    if (req.query.asset_id) { w += ' AND m.asset_id = ' + parseInt(req.query.asset_id); }
    if (req.query.movement_type) { w += " AND m.movement_type = '" + req.query.movement_type + "'"; }
    const r = await pool.request().query(`
        SELECT m.*, a.asset_code, a.asset_name FROM asset_movements m
        JOIN fixed_assets a ON m.asset_id=a.id
        ${w} ORDER BY m.movement_date DESC
    `);
    res.json({ success: true, data: r.recordset });
}));

module.exports = router;
