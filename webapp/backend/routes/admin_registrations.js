// ─── Admin: Manage Registration Requests ────────────────────────────────────
// Mounted under /api/admin/registrations (requires auth)

const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../database/mssql_db');
const bcrypt = require('bcryptjs');

// GET /api/admin/registrations - List all requests
router.get('/', async (req, res) => {
    try {
        const { status = 'all', page = 1, limit = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const pool = await getPool();

        let whereClause = '';
        const request = pool.request()
            .input('offset', sql.Int, offset)
            .input('limit',  sql.Int, parseInt(limit));

        if (status !== 'all') {
            whereClause = 'WHERE r.status = @status';
            request.input('status', sql.NVarChar(20), status);
        }

        const result = await request.query(`
            SELECT r.*, u.full_name AS activated_by_name
            FROM registration_requests r
            LEFT JOIN users u ON r.activated_by = u.id
            ${whereClause}
            ORDER BY r.created_at DESC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `);

        let countResult;
        if (status === 'all') {
            countResult = await pool.request().query('SELECT COUNT(*) AS total FROM registration_requests');
        } else {
            countResult = await pool.request()
                .input('cntStatus', sql.NVarChar(20), status)
                .query('SELECT COUNT(*) AS total FROM registration_requests WHERE status = @cntStatus');
        }

        res.json({ success: true, data: result.recordset, total: countResult.recordset[0]?.total || 0 });
    } catch (err) {
        console.error('[Admin Reg] List error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// PATCH /api/admin/registrations/:id/status - Update status (reject/pending)
router.patch('/:id/status', async (req, res) => {
    try {
        const { status, notes } = req.body;
        if (!['pending', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'حالة غير صحيحة' });
        }
        const pool = await getPool();
        await pool.request()
            .input('id',     sql.Int,          parseInt(req.params.id))
            .input('status', sql.NVarChar(20),  status)
            .input('notes',  sql.NVarChar(sql.MAX), notes || null)
            .query('UPDATE registration_requests SET status = @status, notes = @notes, updated_at = GETDATE() WHERE id = @id');
        res.json({ success: true, message: 'تم التحديث بنجاح' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/admin/registrations/:id/activate - Create user account & activate
router.post('/:id/activate', async (req, res) => {
    try {
        const pool = await getPool();
        const { password } = req.body;
        const activatorId = req.user?.id;

        const regResult = await pool.request()
            .input('id', sql.Int, parseInt(req.params.id))
            .query('SELECT * FROM registration_requests WHERE id = @id');

        if (!regResult.recordset.length) {
            return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        }

        const reg = regResult.recordset[0];
        if (reg.status === 'activated') {
            return res.status(400).json({ success: false, message: 'هذا الطلب مفعّل بالفعل' });
        }

        // Check if user already exists
        const existingUser = await pool.request()
            .input('username', sql.NVarChar(300), reg.email)
            .query('SELECT id FROM users WHERE username = @username');

        let userId;
        const initialPassword = password || 'User@123456';
        if (password) {
            const { validatePassword } = require('../utils/passwordPolicy');
            const pwCheck = validatePassword(password);
            if (!pwCheck.valid) {
                return res.status(400).json({ success: false, message: pwCheck.message });
            }
        }
        if (existingUser.recordset.length > 0) {
            userId = existingUser.recordset[0].id;
        } else {
            const hashed = bcrypt.hashSync(initialPassword, 10);
            const newUser = await pool.request()
                .input('username',      sql.NVarChar(300), reg.email)
                .input('password_hash', sql.NVarChar(500), hashed)
                .input('full_name',     sql.NVarChar(200), reg.full_name)
                .input('role',          sql.NVarChar(50),  'user')
                .query(`
                    INSERT INTO users (username, password_hash, full_name, role)
                    OUTPUT INSERTED.id
                    VALUES (@username, @password_hash, @full_name, @role)
                `);
            userId = newUser.recordset[0].id;
        }

        // Mark registration as activated
        await pool.request()
            .input('id',          sql.Int,      parseInt(req.params.id))
            .input('activated_by', sql.Int,     activatorId || null)
            .query("UPDATE registration_requests SET status = 'activated', activated_by = @activated_by, activated_at = GETDATE(), updated_at = GETDATE() WHERE id = @id");

        res.json({
            success: true,
            message: `تم تفعيل الحساب بنجاح! البريد: ${reg.email} - كلمة المرور: ${initialPassword}`,
            user_id: userId,
            default_password: initialPassword
        });
    } catch (err) {
        console.error('[Admin Reg] Activate error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
