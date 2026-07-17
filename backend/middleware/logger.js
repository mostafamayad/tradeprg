const { getPool, sql } = require('../database/mssql_db');

async function logActivity(req, operation, module, refNo, affectedRecord, oldValues, newValues, status, reason) {
    try {
        const userId = req.user ? req.user.id : null;
        const userName = req.user ? (req.user.full_name || req.user.username || req.user.email || 'System') : 'System';
        const role = req.user ? (req.user.role || 'user') : 'guest';
        const ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || '';
        const device = (req.headers['user-agent'] || '').substring(0, 500);
        const now = new Date();

        const pool = await getPool();
        await pool.request()
            .input('user_id', sql.Int, userId)
            .input('user_name', sql.NVarChar(255), userName)
            .input('role', sql.NVarChar(50), role)
            .input('module', sql.NVarChar(100), module || 'system')
            .input('operation', sql.NVarChar(50), operation || 'UPDATE')
            .input('ref_no', sql.NVarChar(255), (refNo || '').substring(0, 255))
            .input('affected_record', sql.NVarChar(sql.MAX), (affectedRecord || '').substring(0, 2000))
            .input('old_values', sql.NVarChar(sql.MAX), oldValues ? JSON.stringify(oldValues).substring(0, 4000) : null)
            .input('new_values', sql.NVarChar(sql.MAX), newValues ? JSON.stringify(newValues).substring(0, 4000) : null)
            .input('ip_address', sql.NVarChar(50), (ipAddress || '').substring(0, 50))
            .input('device', sql.NVarChar(500), device)
            .input('status', sql.NVarChar(20), status === 'FAILED' ? 'FAILED' : 'SUCCESS')
            .input('reason', sql.NVarChar(sql.MAX), (reason || '').substring(0, 2000))
            .input('created_at', sql.DateTime, now)
            .query(`
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

                INSERT INTO audit_log (user_id, user_name, role, module, operation, ref_no, affected_record, old_values, new_values, ip_address, device, status, reason, created_at)
                VALUES (@user_id, @user_name, @role, @module, @operation, @ref_no, @affected_record, @old_values, @new_values, @ip_address, @device, @status, @reason, @created_at)
            `);
    } catch (e) {
        console.error('Audit log write error:', e.message);
    }
}

module.exports = logActivity;
