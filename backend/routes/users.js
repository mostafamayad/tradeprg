const router = require('express').Router();
const { sql, getPool } = require('../database/mssql_db');
const bcrypt = require('bcryptjs');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');

// Helper to check if admin (basic middleware could go here, but doing it in route for simplicity)

// Get all users
router.get('/', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT id, username, full_name, role, permissions, is_active, created_at, avatar FROM users');
        res.json({ success: true, data: result.recordset });
    } catch (e) {
        console.error('Error fetching users:', e);
        e.status = 500;
        e.message = 'خطأ في جلب المستخدمين';
        throw e;
    }
}));

// Create user
router.post('/', asyncHandler(async (req, res) => {
    try {
        const { email, password, name, permissions } = req.body;
        if (!email || !password || !name) {
            logActivity(req, 'CREATE', 'users', null, 'Create user failed - incomplete data', null, { email, name }, 'FAILED', 'Incomplete data');
            return res.status(400).json({ success: false, message: 'البيانات غير مكتملة' });
        }

        const pool = await getPool();
        
        const existingResult = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT id FROM users WHERE username = @email');
            
        if (existingResult.recordset.length > 0) {
            logActivity(req, 'CREATE', 'users', null, 'Create user failed - email exists: ' + email, null, { email, name }, 'FAILED', 'Email already exists');
            return res.status(400).json({ success: false, message: 'البريد الإلكتروني موجود بالفعل' });
        }

        const hash = bcrypt.hashSync(password, 10);
        const perms = JSON.stringify(permissions || []);

        const insertResult = await pool.request()
            .input('username', sql.NVarChar, email)
            .input('password_hash', sql.NVarChar, hash)
            .input('full_name', sql.NVarChar, name)
            .input('role', sql.NVarChar, 'user')
            .input('permissions', sql.NVarChar, perms)
            .query(`
                INSERT INTO users (username, password_hash, full_name, role, permissions) 
                OUTPUT INSERTED.id
                VALUES (@username, @password_hash, @full_name, @role, @permissions)
            `);

        logActivity(req, 'CREATE', 'users', null, 'Created user: ' + email, null, { id: insertResult.recordset[0].id, email, name, role: 'user', permissions: permissions || [] }, 'SUCCESS', null);
        res.json({ success: true, message: 'تم إضافة المستخدم بنجاح', data: { id: insertResult.recordset[0].id } });
    } catch (e) {
        console.error('Error creating user:', e);
        logActivity(req, 'CREATE', 'users', null, 'Create user failed', null, null, 'FAILED', e.message);
        e.status = 500;
        e.message = 'خطأ في حفظ المستخدم';
        throw e;
    }
}));

// Update user permissions
router.put('/:id/permissions', asyncHandler(async (req, res) => {
    try {
        const { permissions } = req.body;
        const perms = JSON.stringify(permissions || []);
        
        const pool = await getPool();
        await pool.request()
            .input('permissions', sql.NVarChar, perms)
            .input('id', sql.Int, req.params.id)
            .query('UPDATE users SET permissions = @permissions WHERE id = @id');
            
        logActivity(req, 'UPDATE', 'users', null, 'Updated permissions for user ID: ' + req.params.id, null, { permissions }, 'SUCCESS', null);
        res.json({ success: true, message: 'تم تحديث الصلاحيات' });
    } catch (e) {
        console.error('Error updating permissions:', e);
        logActivity(req, 'UPDATE', 'users', null, 'Update permissions failed for user ID: ' + req.params.id, null, null, 'FAILED', e.message);
        e.status = 500;
        e.message = 'خطأ في حفظ الصلاحيات';
        throw e;
    }
}));

// Update user password
router.put('/:id/password', asyncHandler(async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            logActivity(req, 'UPDATE', 'users', null, 'Change password failed for user ID: ' + req.params.id, null, null, 'FAILED', 'Password not provided');
            return res.status(400).json({ success: false, message: 'كلمة المرور مطلوبة' });
        }

        const hash = bcrypt.hashSync(password, 10);
        
        const pool = await getPool();
        await pool.request()
            .input('password_hash', sql.NVarChar, hash)
            .input('id', sql.Int, req.params.id)
            .query('UPDATE users SET password_hash = @password_hash WHERE id = @id');
            
        logActivity(req, 'UPDATE', 'users', null, 'Changed password for user ID: ' + req.params.id, null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم تحديث كلمة المرور' });
    } catch (e) {
        console.error('Error updating password:', e);
        logActivity(req, 'UPDATE', 'users', null, 'Change password failed for user ID: ' + req.params.id, null, null, 'FAILED', e.message);
        e.status = 500;
        e.message = 'خطأ في حفظ كلمة المرور';
        throw e;
    }
}));

// ─── Avatar (must be defined before /:id to avoid route conflict) ───

async function ensureAvatarColumn(pool) {
  await pool.request().query(`
    IF COL_LENGTH('users', 'avatar') IS NULL
      ALTER TABLE users ADD avatar NVARCHAR(MAX) NULL
  `);
}

// POST /api/users/avatar - upload avatar (base64)
router.post('/avatar', asyncHandler(async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ success: false, message: 'لم يتم إرسال الصورة' });
    const pool = await getPool();
    await ensureAvatarColumn(pool);
    await pool.request()
      .input('avatar', sql.NVarChar(sql.MAX), avatar)
      .input('id', sql.Int, req.user.id)
      .query("UPDATE users SET avatar = @avatar WHERE id = @id");
    res.json({ success: true, message: 'تم حفظ الصورة الشخصية' });
  } catch (e) {
    console.error('[Avatar POST]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
}));

// DELETE /api/users/avatar - remove avatar
router.delete('/avatar', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    await ensureAvatarColumn(pool);
    await pool.request()
      .input('id', sql.Int, req.user.id)
      .query("UPDATE users SET avatar = NULL WHERE id = @id");
    res.json({ success: true, message: 'تم حذف الصورة الشخصية' });
  } catch (e) {
    console.error('[Avatar DELETE]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
}));

// Delete (Deactivate) user
router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        
        // Prevent deleting admin
        const userResult = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT username FROM users WHERE id = @id');
            
        const user = userResult.recordset[0];
        
            if (user && user.id === 1 && user.role === 'admin') {
            logActivity(req, 'DELETE', 'users', null, 'Delete user failed - cannot delete primary admin', null, null, 'FAILED', 'Cannot delete primary admin');
            return res.status(400).json({ success: false, message: 'لا يمكن حذف المدير الأساسي' });
        }

        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM users WHERE id = @id');
            
        logActivity(req, 'DELETE', 'users', null, 'Deleted user ID: ' + req.params.id + (user ? ' (' + user.username + ')' : ''), null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم حذف المستخدم' });
    } catch (e) {
        console.error('Error deleting user:', e);
        logActivity(req, 'DELETE', 'users', null, 'Delete user failed for ID: ' + req.params.id, null, null, 'FAILED', e.message);
        e.status = 500;
        e.message = 'خطأ في حذف المستخدم';
        throw e;
    }
}));

module.exports = router;
