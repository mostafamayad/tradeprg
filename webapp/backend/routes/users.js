const router = require('express').Router();
const { sql, getPool } = require('../database/mssql_db');
const bcrypt = require('bcryptjs');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');

async function countSuperAdmins(pool) {
    const r = await pool.request().query("SELECT COUNT(*) AS cnt FROM users WHERE is_super_admin = 1 AND is_active = 1");
    return r.recordset[0].cnt;
}

async function isSuperAdmin(userId) {
    const pool = await getPool();
    const result = await pool.request()
        .input('id', sql.Int, userId)
        .query('SELECT is_super_admin FROM users WHERE id = @id');
    return result.recordset.length > 0 && result.recordset[0].is_super_admin === true;
}

async function bumpPermissionsVersion(userIds) {
    if (!userIds || userIds.length === 0) return;
    const pool = await getPool();
    const ids = userIds.filter((v, i, a) => a.indexOf(v) === i);
    const cases = ids.map((_, i) => `WHEN id = @uid${i} THEN permissions_version + 1`).join(' ');
    const batch = pool.request();
    ids.forEach((uid, i) => batch.input(`uid${i}`, sql.Int, uid));
    await batch.query(`UPDATE users SET permissions_version = CASE ${cases} ELSE permissions_version END WHERE id IN (${ids.map((_, i) => `@uid${i}`).join(',')})`);
}

async function ensureAvatarColumn(pool) {
    await pool.request().query(`
        IF COL_LENGTH('users', 'avatar') IS NULL
            ALTER TABLE users ADD avatar NVARCHAR(MAX) NULL
    `);
}

async function logAudit(req, action, targetType, targetId, targetName, oldVal, newVal, details) {
    try {
        const pool = await getPool();
        const ua = (req.headers['user-agent'] || '').substring(0, 500);
        const sessionId = req.headers['x-session-id'] || req.headers['x-device-id'] || null;
        const machineName = req.headers['x-machine-name'] || null;
        await pool.request()
            .input('actor_id', sql.Int, req.user ? req.user.id : null)
            .input('actor_name', sql.NVarChar, req.user ? (req.user.username || '') : '')
            .input('action', sql.NVarChar, action)
            .input('target_type', sql.NVarChar, targetType)
            .input('target_id', sql.Int, targetId)
            .input('target_name', sql.NVarChar, targetName || '')
            .input('old_value', sql.NVarChar(sql.MAX), oldVal ? JSON.stringify(oldVal) : null)
            .input('new_value', sql.NVarChar(sql.MAX), newVal ? JSON.stringify(newVal) : null)
            .input('details', sql.NVarChar(sql.MAX), details || null)
            .input('ip_address', sql.NVarChar, req.ip || req.connection?.remoteAddress || null)
            .input('browser', sql.NVarChar(50), ua.includes('Chrome/') ? 'Chrome' : ua.includes('Firefox/') ? 'Firefox' : ua.includes('Edg/') ? 'Edge' : ua.includes('Safari/') ? 'Safari' : 'Unknown')
            .input('session_id', sql.NVarChar(255), sessionId)
            .input('machine_name', sql.NVarChar(255), machineName)
            .query(`INSERT INTO user_audit_log (actor_id, actor_name, action, target_type, target_id, target_name, old_value, new_value, details, ip_address, browser, session_id, machine_name, created_at)
                    VALUES (@actor_id, @actor_name, @action, @target_type, @target_id, @target_name, @old_value, @new_value, @details, @ip_address, @browser, @session_id, @machine_name, GETDATE())`);
    } catch (e) {
        console.error('[AuditLog]', e.message);
    }
}

router.get('/', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request().query(`
        SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.is_super_admin, u.created_at, u.avatar,
               (SELECT STRING_AGG(r.display_name, N', ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS role_names,
               (SELECT COUNT(*) FROM user_roles ur WHERE ur.user_id = u.id) AS role_count
        FROM users u ORDER BY u.id
    `);
    res.json({ success: true, data: result.recordset });
}));

router.post('/', asyncHandler(async (req, res) => {
    try {
        const { email, password, name, role_ids } = req.body;
        if (!email || !password || !name) {
            logActivity(req, 'CREATE', 'users', null, 'Create user failed - incomplete data', null, { email, name }, 'FAILED', 'Incomplete data');
            return res.status(400).json({ success: false, message: 'البيانات غير مكتملة' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }

        const pool = await getPool();
        const existingResult = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT id FROM users WHERE username = @email');
        if (existingResult.recordset.length > 0) {
            logActivity(req, 'CREATE', 'users', null, 'Create user failed - email exists: ' + email, null, { email, name }, 'FAILED', 'Email already exists');
            return res.status(400).json({ success: false, message: 'البريد الإلكتروني موجود بالفعل' });
        }

        const maxUsersResult = await pool.request().query("SELECT ISNULL((SELECT TOP 1 max_users FROM system_info WHERE max_users IS NOT NULL), 999) AS max_users, (SELECT COUNT(*) FROM users WHERE is_active = 1) AS current_users");
        const { max_users, current_users } = maxUsersResult.recordset[0];
        if (current_users >= max_users) {
            logActivity(req, 'CREATE', 'users', null, 'Create user failed - max users limit reached (' + max_users + ')', null, { current_users, max_users }, 'FAILED', 'User limit reached');
            return res.status(400).json({ success: false, message: 'لقد تجاوزت الحد الأقصى لعدد المستخدمين المسموح به (' + max_users + ')' });
        }

        const hash = bcrypt.hashSync(password, 10);
        const insertResult = await pool.request()
            .input('username', sql.NVarChar, email)
            .input('password_hash', sql.NVarChar, hash)
            .input('full_name', sql.NVarChar, name)
            .input('role', sql.NVarChar, 'user')
            .query(`
                INSERT INTO users (username, password_hash, full_name, role)
                OUTPUT INSERTED.id
                VALUES (@username, @password_hash, @full_name, @role)
            `);

        const newUserId = insertResult.recordset[0].id;

        if (role_ids && Array.isArray(role_ids) && role_ids.length > 0) {
            const batch = role_ids.map((_, i) => `(@userId, @rid${i})`).join(',');
            const reqBatch = pool.request().input('userId', sql.Int, newUserId);
            role_ids.forEach((rid, i) => reqBatch.input(`rid${i}`, sql.Int, rid));
            await reqBatch.query(`INSERT INTO user_roles (user_id, role_id) VALUES ${batch}`);
            await bumpPermissionsVersion([newUserId]);
        }

        logActivity(req, 'CREATE', 'users', null, 'Created user: ' + email, newUserId, { email, name, role_ids: role_ids || [] }, 'SUCCESS', null);
        await logAudit(req, 'CREATE_USER', 'user', newUserId, email, null, { email, name, role_ids }, 'User created');
        res.json({ success: true, message: 'تم إضافة المستخدم بنجاح', data: { id: newUserId } });
    } catch (e) {
        console.error('Error creating user:', e);
        logActivity(req, 'CREATE', 'users', null, 'Create user failed', null, null, 'FAILED', e.message);
        e.status = 500;
        e.message = 'خطأ في حفظ المستخدم';
        throw e;
    }
}));

router.put('/:id', asyncHandler(async (req, res) => {
    try {
        const { name, email, role_ids, is_active } = req.body;
        const targetId = Number(req.params.id);
        const currentUserId = Number(req.user.id);

        if (targetId === currentUserId) {
            return res.status(400).json({ success: false, message: 'لا يمكن تعديل المستخدم الحالي' });
        }
        if (await isSuperAdmin(targetId)) {
            return res.status(403).json({ success: false, message: 'لا يمكن تعديل مدير النظام' });
        }
        if (is_active !== undefined && await isSuperAdmin(targetId)) {
            return res.status(403).json({ success: false, message: 'لا يمكن تعطيل مدير النظام' });
        }

        const pool = await getPool();
        const oldUser = await pool.request()
            .input('id', sql.Int, targetId)
            .query('SELECT username, full_name, is_active FROM users WHERE id = @id');
        if (oldUser.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }
        const oldData = oldUser.recordset[0];

        if (email) {
            const dupCheck = await pool.request()
                .input('email', sql.NVarChar, email)
                .input('id', sql.Int, targetId)
                .query('SELECT id FROM users WHERE username = @email AND id != @id');
            if (dupCheck.recordset.length > 0) {
                return res.status(400).json({ success: false, message: 'البريد الإلكتروني مستخدم بالفعل' });
            }
        }

        const oldRoleIds = await pool.request()
            .input('id', sql.Int, targetId)
            .query('SELECT role_id FROM user_roles WHERE user_id = @id');

        if (name || email) {
            const reqUpdate = pool.request().input('id', sql.Int, targetId);
            const sets = [];
            if (name) { sets.push('full_name = @name'); reqUpdate.input('name', sql.NVarChar, name); }
            if (email) { sets.push('username = @email'); reqUpdate.input('email', sql.NVarChar, email); }
            if (is_active !== undefined) { sets.push('is_active = @is_active'); reqUpdate.input('is_active', sql.Bit, is_active); }
            if (sets.length > 0) {
                await reqUpdate.query(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`);
            }
        }

        if (role_ids && Array.isArray(role_ids)) {
            await pool.request()
                .input('id', sql.Int, targetId)
                .query('DELETE FROM user_roles WHERE user_id = @id');
            if (role_ids.length > 0) {
                const batch = role_ids.map((_, i) => `(@userId, @rid${i})`).join(',');
                const reqBatch = pool.request().input('userId', sql.Int, targetId);
                role_ids.forEach((rid, i) => reqBatch.input(`rid${i}`, sql.Int, rid));
                await reqBatch.query(`INSERT INTO user_roles (user_id, role_id) VALUES ${batch}`);
            }
            await bumpPermissionsVersion([targetId]);
        }

        const changes = {};
        if (name && name !== oldData.full_name) changes.name = { old: oldData.full_name, new: name };
        if (email && email !== oldData.username) changes.email = { old: oldData.username, new: email };
        if (is_active !== undefined && is_active !== oldData.is_active) changes.status = { old: oldData.is_active ? 'active' : 'inactive', new: is_active ? 'active' : 'inactive' };
        if (role_ids) {
            const rIds = oldRoleIds.recordset.map(r => r.role_id);
            if (JSON.stringify(rIds) !== JSON.stringify(role_ids)) changes.roles = { old: rIds, new: role_ids };
        }

        logActivity(req, 'UPDATE', 'users', null, `Updated user ID: ${targetId}`, targetId, changes, 'SUCCESS', null);
        await logAudit(req, 'UPDATE_USER', 'user', targetId, oldData.username, oldData, { name, email, role_ids, is_active }, Object.keys(changes).length > 0 ? JSON.stringify(changes) : null);
        res.json({ success: true, message: 'تم تحديث المستخدم' });
    } catch (e) {
        console.error('Error updating user:', e);
        logActivity(req, 'UPDATE', 'users', null, 'Update user failed for ID: ' + req.params.id, null, null, 'FAILED', e.message);
        e.status = 500;
        e.message = 'خطأ في تحديث المستخدم';
        throw e;
    }
}));

router.put('/:id/roles', asyncHandler(async (req, res) => {
    try {
        const { role_ids } = req.body;
        const targetId = Number(req.params.id);
        const currentUserId = Number(req.user.id);

        if (targetId === currentUserId) {
            return res.status(400).json({ success: false, message: 'لا يمكن تغيير دور المستخدم الحالي' });
        }
        if (await isSuperAdmin(targetId)) {
            return res.status(403).json({ success: false, message: 'لا يمكن تغيير أدوار مدير النظام' });
        }
        if (!Array.isArray(role_ids)) {
            return res.status(400).json({ success: false, message: 'مصفوفة الأدوار مطلوبة' });
        }

        const pool = await getPool();
        const oldRoles = await pool.request()
            .input('id', sql.Int, targetId)
            .query('SELECT role_id FROM user_roles WHERE user_id = @id');
        const oldRoleIds = oldRoles.recordset.map(r => r.role_id);

        await pool.request()
            .input('id', sql.Int, targetId)
            .query('DELETE FROM user_roles WHERE user_id = @id');

        if (role_ids.length > 0) {
            const batch = role_ids.map((_, i) => `(@userId, @rid${i})`).join(',');
            const reqBatch = pool.request().input('userId', sql.Int, targetId);
            role_ids.forEach((rid, i) => reqBatch.input(`rid${i}`, sql.Int, rid));
            await reqBatch.query(`INSERT INTO user_roles (user_id, role_id) VALUES ${batch}`);
        }

        const user = await pool.request()
            .input('id', sql.Int, targetId)
            .query('SELECT username FROM users WHERE id = @id');

        await bumpPermissionsVersion([targetId]);

        logActivity(req, 'UPDATE', 'users', null, `Updated roles for user ID: ${targetId}`, targetId, { old_roles: oldRoleIds, new_roles: role_ids }, 'SUCCESS', null);
        await logAudit(req, 'ASSIGN_ROLES', 'user', targetId, (user.recordset[0] || {}).username, { roles: oldRoleIds }, { roles: role_ids }, 'Roles changed');
        res.json({ success: true, message: 'تم تحديث أدوار المستخدم' });
    } catch (e) {
        console.error('Error updating user roles:', e);
        e.status = 500;
        e.message = 'خطأ في تحديث أدوار المستخدم';
        throw e;
    }
}));

router.put('/:id/password', asyncHandler(async (req, res) => {
    try {
        const { password, current_password } = req.body;
        const targetId = Number(req.params.id);
        const currentUserId = Number(req.user.id);
        const isSelf = targetId === currentUserId;

        if (isSelf && !current_password) {
            return res.status(400).json({ success: false, message: 'كلمة المرور الحالية مطلوبة لتغيير كلمة المرور' });
        }

        if (await isSuperAdmin(targetId) && !isSelf && !await isSuperAdmin(currentUserId)) {
            return res.status(403).json({ success: false, message: 'لا يمكن تغيير كلمة مرور مدير النظام' });
        }
        if (!password) {
            logActivity(req, 'UPDATE', 'users', null, 'Change password failed for user ID: ' + targetId, null, null, 'FAILED', 'Password not provided');
            return res.status(400).json({ success: false, message: 'كلمة المرور مطلوبة' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }

        const pool = await getPool();

        if (isSelf && current_password) {
            const userResult = await pool.request()
                .input('id', sql.Int, targetId)
                .query('SELECT password_hash, username FROM users WHERE id = @id');
            if (userResult.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
            }
            const isMatch = bcrypt.compareSync(current_password, userResult.recordset[0].password_hash);
            if (!isMatch) {
                logActivity(req, 'UPDATE', 'users', null, 'Change password failed for user ID: ' + targetId + ' - wrong current password', targetId, null, 'FAILED', 'Wrong current password');
                return res.status(400).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });
            }
        }

        const hash = bcrypt.hashSync(password, 10);
        await pool.request()
            .input('password_hash', sql.NVarChar, hash)
            .input('id', sql.Int, targetId)
            .query('UPDATE users SET password_hash = @password_hash WHERE id = @id');

        const user = await pool.request()
            .input('id', sql.Int, targetId)
            .query('SELECT username FROM users WHERE id = @id');

        const actorDesc = isSelf ? 'self' : (req.user.username || 'admin');
        logActivity(req, 'UPDATE', 'users', null, `Password changed for user ID: ${targetId} by ${actorDesc}`, targetId, null, 'SUCCESS', null);
        await logAudit(req, isSelf ? 'SELF_CHANGE_PASSWORD' : 'RESET_PASSWORD', 'user', targetId, (user.recordset[0] || {}).username, null, null, `Password changed by ${actorDesc}`);
        res.json({ success: true, message: 'تم تحديث كلمة المرور' });
    } catch (e) {
        console.error('Error updating password:', e);
        logActivity(req, 'UPDATE', 'users', null, 'Change password failed for user ID: ' + req.params.id, null, null, 'FAILED', e.message);
        e.status = 500;
        e.message = 'خطأ في حفظ كلمة المرور';
        throw e;
    }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const targetId = Number(req.params.id);
        const currentUserId = Number(req.user.id);

        if (targetId === currentUserId) {
            return res.status(400).json({ success: false, message: 'لا يمكن حذف المستخدم نفسه' });
        }

        const userResult = await pool.request()
            .input('id', sql.Int, targetId)
            .query('SELECT id, username, is_super_admin FROM users WHERE id = @id');

        const user = userResult.recordset[0];
        if (!user) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }
        if (user.is_super_admin) {
            const saCount = await countSuperAdmins(pool);
            if (saCount <= 1) {
                logActivity(req, 'DELETE', 'users', null, 'Delete user failed - last super admin', null, null, 'FAILED', 'Cannot delete last super admin');
                return res.status(400).json({ success: false, message: 'لا يمكن حذف آخر مدير نظام' });
            }
        }

        await pool.request()
            .input('id', sql.Int, targetId)
            .query('DELETE FROM user_roles WHERE user_id = @id');
        await pool.request()
            .input('id', sql.Int, targetId)
            .query("IF OBJECT_ID(N'user_data_scopes') IS NOT NULL DELETE FROM user_data_scopes WHERE user_id = @id");
        const del = await pool.request()
            .input('id', sql.Int, targetId)
            .query('DELETE FROM users WHERE id = @id');

        if (del.rowsAffected[0] === 0) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        logActivity(req, 'DELETE', 'users', null, 'Deleted user ID: ' + targetId + ' (' + (user.username || '') + ')', targetId, null, 'SUCCESS', null);
        await logAudit(req, 'DELETE_USER', 'user', targetId, user.username, { is_active: true }, null, 'User permanently deleted');
        res.json({ success: true, message: 'تم حذف المستخدم نهائياً' });
    } catch (e) {
        console.error('Error deleting user:', e);
        logActivity(req, 'DELETE', 'users', null, 'Delete user failed for ID: ' + req.params.id, null, null, 'FAILED', e.message);
        if (e.originalError && e.originalError.info && e.originalError.info.number === 547) {
            return res.status(400).json({ success: false, message: 'لا يمكن حذف المستخدم نهائياً لأنه لديه معاملات في النظام. يمكنك تعطيل المستخدم بدلاً من ذلك.' });
        }
        e.status = 500;
        e.message = 'خطأ في حذف المستخدم';
        throw e;
    }
}));

router.put('/:id/toggle-status', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const targetId = Number(req.params.id);
        const currentUserId = Number(req.user.id);

        if (targetId === currentUserId) {
            return res.status(400).json({ success: false, message: 'لا يمكن تعطيل المستخدم الحالي' });
        }
        if (await isSuperAdmin(targetId)) {
            const saCount = await countSuperAdmins(await getPool());
            if (saCount <= 1) {
                return res.status(400).json({ success: false, message: 'لا يمكن تعطيل آخر مدير نظام في النظام' });
            }
            return res.status(403).json({ success: false, message: 'لا يمكن تعطيل مدير النظام' });
        }

        const userResult = await pool.request()
            .input('id', sql.Int, targetId)
            .query('SELECT id, username, is_active FROM users WHERE id = @id');

        if (!userResult.recordset.length) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const currentActive = userResult.recordset[0].is_active;
        const newActive = currentActive ? 0 : 1;
        await pool.request()
            .input('id', sql.Int, targetId)
            .input('is_active', sql.Bit, newActive)
            .query('UPDATE users SET is_active = @is_active WHERE id = @id');

        logActivity(req, 'UPDATE', 'users', null, `Toggled user status ID: ${targetId} to ${newActive ? 'active' : 'disabled'}`, targetId, null, 'SUCCESS', null);
        await logAudit(req, newActive ? 'ENABLE_USER' : 'DISABLE_USER', 'user', targetId, userResult.recordset[0].username, { is_active: currentActive }, { is_active: newActive }, null);
        res.json({ success: true, message: currentActive ? 'تم تعطيل المستخدم' : 'تم تفعيل المستخدم' });
    } catch (e) {
        e.status = 500;
        e.message = 'خطأ في تغيير حالة المستخدم';
        throw e;
    }
}));

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

module.exports = router;
