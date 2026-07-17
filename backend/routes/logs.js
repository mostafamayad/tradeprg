const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/logs - paginated + filtered audit log
router.get('/', asyncHandler(async (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'عفواً، لا تملك صلاحية للوصول إلى هذا السجل.' });
    }

    try {
        const pool = await getPool();

        // Ensure the audit_log table exists
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[audit_log]') AND type in (N'U'))
            BEGIN
                CREATE TABLE [dbo].[audit_log](
                    [id] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
                    [user_id] [int] NULL,
                    [user_name] [nvarchar](255) NULL,
                    [role] [nvarchar](50) NULL,
                    [module] [nvarchar](100) NULL,
                    [operation] [nvarchar](50) NULL,
                    [ref_no] [nvarchar](255) NULL,
                    [affected_record] [nvarchar](max) NULL,
                    [old_values] [nvarchar](max) NULL,
                    [new_values] [nvarchar](max) NULL,
                    [ip_address] [nvarchar](50) NULL,
                    [device] [nvarchar](500) NULL,
                    [status] [nvarchar](20) NULL DEFAULT ('SUCCESS'),
                    [reason] [nvarchar](max) NULL,
                    [created_at] [datetime] NULL DEFAULT (getdate())
                )
            END
        `);

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(10, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        const filters = [];
        const filterParams = [];

        if (req.query.user_name) {
            filters.push('user_name LIKE @user_name');
            filterParams.push({ name: 'user_name', type: sql.NVarChar(255), value: '%' + req.query.user_name + '%' });
        }
        if (req.query.module) {
            filters.push('module = @module');
            filterParams.push({ name: 'module', type: sql.NVarChar(100), value: req.query.module });
        }
        if (req.query.operation) {
            filters.push('operation = @operation');
            filterParams.push({ name: 'operation', type: sql.NVarChar(50), value: req.query.operation });
        }
        if (req.query.ref_no) {
            filters.push('ref_no LIKE @ref_no');
            filterParams.push({ name: 'ref_no', type: sql.NVarChar(255), value: '%' + req.query.ref_no + '%' });
        }
        if (req.query.status) {
            filters.push('status = @status');
            filterParams.push({ name: 'status', type: sql.NVarChar(20), value: req.query.status });
        }
        if (req.query.date_from) {
            filters.push('created_at >= @date_from');
            filterParams.push({ name: 'date_from', type: sql.DateTime, value: new Date(req.query.date_from) });
        }
        if (req.query.date_to) {
            filters.push('created_at <= @date_to');
            filterParams.push({ name: 'date_to', type: sql.DateTime, value: new Date(req.query.date_to + 'T23:59:59') });
        }

        const whereClause = filters.length ? 'WHERE ' + filters.join(' AND ') : '';

        // Count total
        const countReq = pool.request();
        for (const p of filterParams) countReq.input(p.name, p.type, p.value);
        const countResult = await countReq.query('SELECT COUNT(*) AS total FROM audit_log ' + whereClause);
        const total = countResult.recordset[0].total;

        // Fetch page
        const dataReq = pool.request();
        for (const p of filterParams) dataReq.input(p.name, p.type, p.value);
        const dataResult = await dataReq.query(
            'SELECT * FROM audit_log ' + whereClause + ' ORDER BY id DESC OFFSET ' + offset + ' ROWS FETCH NEXT ' + limit + ' ROWS ONLY'
        );

        res.json({
            success: true,
            data: dataResult.recordset,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (e) {
        console.error('Error fetching audit logs:', e);
        e.status = 500;
        e.message = 'حدث خطأ في الخادم';
        throw e;
    }
}));

// GET /api/logs/export - export all logs as CSV
router.get('/export', asyncHandler(async (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM audit_log ORDER BY id DESC');

        const rows = result.recordset;
        const csv = [
            'ID,User,Role,Module,Operation,Reference,Record,IP,Status,Time',
            ...rows.map(r =>
                [r.id, r.user_name, r.role, r.module, r.operation, r.ref_no,
                 (r.affected_record || '').replace(/"/g, '""'),
                 r.ip_address, r.status, r.created_at].join(',')
            )
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=audit_log.csv');
        res.send('\uFEFF' + csv);
    } catch (e) {
        console.error('Error exporting audit logs:', e);
        e.status = 500;
        e.message = 'Export failed';
        throw e;
    }
}));

// Logout tracking endpoint
router.post('/logout', async (req, res) => {
    const logActivity = require('../middleware/logger');
    logActivity(req, 'LOGOUT', 'auth', null, 'User logout', null, null, 'SUCCESS', null);
    res.json({ success: true });
});

module.exports = router;
