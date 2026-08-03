const { getPool, sql } = require('../database/mssql_db');

function parseUserAgent(ua) {
    const result = { browser: 'Unknown', os: 'Unknown', device: 'Unknown' };
    if (!ua) return result;
    if (ua.includes('Chrome/') && !ua.includes('Edg/')) result.browser = 'Chrome';
    else if (ua.includes('Firefox/')) result.browser = 'Firefox';
    else if (ua.includes('Edg/')) result.browser = 'Edge';
    else if (ua.includes('Safari/')) result.browser = 'Safari';
    else if (ua.includes('MSIE') || ua.includes('Trident/')) result.browser = 'IE';
    if (ua.includes('Windows')) result.os = 'Windows';
    else if (ua.includes('Mac OS')) result.os = 'macOS';
    else if (ua.includes('Linux')) result.os = 'Linux';
    else if (ua.includes('Android')) result.os = 'Android';
    else if (ua.includes('iOS') || ua.includes('iPhone')) result.os = 'iOS';
    if (ua.includes('Mobile')) result.device = 'Mobile';
    else if (ua.includes('Tablet') || ua.includes('iPad')) result.device = 'Tablet';
    else result.device = 'Desktop';
    return result;
}

async function logActivity(req, operation, module, refNo, affectedRecord, oldValues, newValues, status, reason) {
    try {
        const userId = req.user ? req.user.id : null;
        const userName = req.user ? (req.user.full_name || req.user.username || req.user.email || 'System') : 'System';
        const role = req.user ? (req.user.role || 'user') : 'guest';
        const ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || '';
        const ua = (req.headers['user-agent'] || '').substring(0, 500);
        const parsed = parseUserAgent(ua);
        const sessionId = req.headers['x-session-id'] || req.headers['x-device-id'] || null;
        const machineName = req.headers['x-machine-name'] || null;
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
            .input('device', sql.NVarChar(500), ua)
            .input('browser', sql.NVarChar(50), parsed.browser)
            .input('os', sql.NVarChar(50), parsed.os)
            .input('device_type', sql.NVarChar(50), parsed.device)
            .input('session_id', sql.NVarChar(255), sessionId)
            .input('machine_name', sql.NVarChar(255), machineName)
            .input('status', sql.NVarChar(20), status === 'FAILED' ? 'FAILED' : 'SUCCESS')
            .input('reason', sql.NVarChar(sql.MAX), (reason || '').substring(0, 2000))
            .input('created_at', sql.DateTime, now)
            .query(`
                INSERT INTO audit_log (user_id, user_name, role, module, operation, ref_no, affected_record, old_values, new_values, ip_address, device, browser, os, device_type, session_id, machine_name, status, reason, created_at)
                VALUES (@user_id, @user_name, @role, @module, @operation, @ref_no, @affected_record, @old_values, @new_values, @ip_address, @device, @browser, @os, @device_type, @session_id, @machine_name, @status, @reason, @created_at)
            `);
    } catch (e) {
        console.error('Audit log write error:', e.message);
    }
}

module.exports = logActivity;
