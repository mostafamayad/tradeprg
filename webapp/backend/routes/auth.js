const router = require('express').Router();
const { sql, getPool } = require('../database/mssql_db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');
const parsePermissions = require('../utils/parsePermissions');

const JWT_SECRET = process.env.JWT_SECRET; // Ensured by server.js

// Login
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

        // Generate JWT
        const token = jwt.sign(
            { id: user.id, email: user.username, username: user.username, role: user.role, permissions: user.permissions },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Parse permissions
        const permissions = parsePermissions(user.permissions);

        // Log login activity
        req.user = { id: user.id, username: user.username };
        logActivity(req, 'LOGIN', 'auth', null, 'User login: ' + user.email, null, null, 'SUCCESS', null);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.username,
                name: user.full_name,
                role: user.role,
                permissions: permissions,
                avatar: user.avatar || null
            }
        });

    } catch (err) {
        console.error('Login Error:', err);
        logActivity(req, 'LOGIN', 'auth', null, null, null, null, 'FAILED', err.message);
        err.status = 500;
        err.message = 'خطأ في سيرفر قاعدة البيانات';
        throw err;
    }
}));

// Get Current User (Me)
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

        const permissions = parsePermissions(user.permissions);

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.username,
                name: user.full_name,
                role: user.role,
                permissions: permissions,
                avatar: user.avatar || null
            }
        });

    } catch (err) {
        err.status = err.status || 401;
        err.message = 'صلاحية الجلسة انتهت';
        throw err;
    }
}));

module.exports = router;
