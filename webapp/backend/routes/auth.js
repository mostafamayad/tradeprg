const router = require('express').Router();
const { sql, getPool } = require('../database/mssql_db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');
const parsePermissions = require('../utils/parsePermissions');

const JWT_SECRET = process.env.JWT_SECRET;

async function resolveUserPermissions(pool, userId, fallbackPermissions) {
    try {
        const userResult = await pool.request()
            .input('id', sql.Int, userId)
            .query('SELECT is_super_admin FROM users WHERE id = @id');
        if (userResult.recordset.length === 0) return { permissions: [], role_ids: [] };

        const user = userResult.recordset[0];
        if (user.is_super_admin) {
            const allPerms = await pool.request()
                .query("SELECT code FROM permissions");
            return {
                permissions: allPerms.recordset.map(p => p.code),
                role_ids: [],
                is_super_admin: true
            };
        }

        const roleResult = await pool.request()
            .input('id', sql.Int, userId)
            .query('SELECT role_id FROM user_roles WHERE user_id = @id');
        const role_ids = roleResult.recordset.map(r => r.role_id);

        if (role_ids.length === 0) {
            return { permissions: fallbackPermissions || [], role_ids: [], is_super_admin: false };
        }

        const permResult = await pool.request()
            .input('id', sql.Int, userId)
            .query(`SELECT DISTINCT p.code FROM permissions p
                    JOIN role_permissions rp ON rp.permission_id = p.id
                    JOIN user_roles ur ON ur.role_id = rp.role_id
                    WHERE ur.user_id = @id`);
        return {
            permissions: permResult.recordset.map(p => p.code),
            role_ids,
            is_super_admin: false
        };
    } catch (err) {
        console.warn('[AUTH] RBAC tables not ready yet. Falling back to legacy permissions:', err.message);
        return {
            permissions: fallbackPermissions || [],
            role_ids: [],
            is_super_admin: false
        };
    }
}

async function resolveUserRolesDisplay(pool, userId, isSuperAdmin) {
    if (isSuperAdmin) return '\u0645\u062f\u064a\u0631 \u0627\u0644\u0646\u0638\u0627\u0645';
    try {
        const roleNames = await pool.request()
            .input('id', sql.Int, userId)
            .query(`SELECT STRING_AGG(r.display_name, N', ') AS role_names
                    FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = @id`);
        return roleNames.recordset[0]?.role_names || '\u0645\u0633\u062a\u062e\u062f\u0645';
    } catch (err) {
        console.warn('[AUTH] Error resolving display roles (tables may not exist yet):', err.message);
        return '\u0645\u0633\u062a\u062e\u062f\u0645';
    }
}

router.post('/login', asyncHandler(async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            logActivity(req, 'LOGIN', 'auth', null, null, null, null, 'FAILED', 'Missing email or password');
            return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور مطلوبة' });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('username', sql.NVarChar, email)
            .query('SELECT * FROM users WHERE username = @username AND is_active = 1');

        const user = result.recordset[0];

        if (!user) {
            logActivity(req, 'LOGIN', 'auth', null, 'Login attempt: ' + email, null, null, 'FAILED', 'User not found');
            return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        const isMatch = bcrypt.compareSync(password, user.password_hash);
        if (!isMatch) {
            logActivity(req, 'LOGIN', 'auth', null, 'Login attempt: ' + email, null, null, 'FAILED', 'Invalid password');
            return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        let fallbackPerms = [];
        try { fallbackPerms = parsePermissions(user.permissions); } catch (e) {}

        const { permissions, role_ids, is_super_admin } = await resolveUserPermissions(pool, user.id, fallbackPerms);

        const permVersion = user.permissions_version || 1;

        await pool.request()
            .input('id', sql.Int, user.id)
            .input('ip', sql.NVarChar(50), (req.ip || req.connection?.remoteAddress || '').substring(0, 50))
            .input('now', sql.DateTime, new Date())
            .query('UPDATE users SET last_login_at = @now, last_login_ip = @ip WHERE id = @id');

        const token = jwt.sign(
            {
                id: user.id,
                email: user.username,
                username: user.username,
                role: user.role,
                permissions: permissions,
                role_ids: role_ids,
                is_super_admin: is_super_admin,
                permissions_version: permVersion
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        req.user = { id: user.id, username: user.username };
        logActivity(req, 'LOGIN', 'auth', null, 'User login: ' + user.email, null, null, 'SUCCESS', null);

        const displayRoles = await resolveUserRolesDisplay(pool, user.id, is_super_admin);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.username,
                name: user.full_name,
                full_name: user.full_name,
                role: user.role,
                permissions: permissions,
                role_ids: role_ids,
                is_super_admin: is_super_admin,
                display_roles: displayRoles,
                avatar: user.avatar || null,
                permissions_version: permVersion
            }
        });

    } catch (err) {
        console.error('[AUTH] Login Error:', err);
        console.error('[AUTH] Stack:', err.stack);
        logActivity(req, 'LOGIN', 'auth', null, null, null, null, 'FAILED', err.message);
        err.status = 500;
        err.message = 'خطأ في سيرفر قاعدة البيانات';
        throw err;
    }
}));

router.get('/me', asyncHandler(async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'غير مصرح' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, decoded.id)
            .query('SELECT * FROM users WHERE id = @id AND is_active = 1');

        const user = result.recordset[0];

        if (!user) {
            return res.status(401).json({ success: false, message: 'المستخدم غير موجود' });
        }

        let fallbackPerms = [];
        try { fallbackPerms = parsePermissions(user.permissions); } catch (e) {}

        const { permissions, role_ids, is_super_admin } = await resolveUserPermissions(pool, user.id, fallbackPerms);
        const displayRoles = await resolveUserRolesDisplay(pool, user.id, is_super_admin);

        const currentVersion = user.permissions_version || 1;
        const tokenVersion = decoded.permissions_version || 0;

        res.json({
            success: true,
            permissions_changed: currentVersion > tokenVersion,
            permissions_version: currentVersion,
            user: {
                id: user.id,
                email: user.username,
                name: user.full_name,
                full_name: user.full_name,
                role: user.role,
                permissions: permissions,
                role_ids: role_ids,
                is_super_admin: is_super_admin,
                display_roles: displayRoles,
                avatar: user.avatar || null,
                permissions_version: currentVersion
            }
        });

    } catch (err) {
        console.error('[AUTH] /me Error:', err);
        console.error('[AUTH] Stack:', err.stack);
        err.status = err.status || 401;
        err.message = 'صلاحية الجلسة انتهت';
        throw err;
    }
}));

module.exports = router;
