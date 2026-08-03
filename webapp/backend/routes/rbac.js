const router = require('express').Router();
const { sql, getPool } = require('../database/mssql_db');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');
const checkPermission = require('../middleware/permissions');
const { requirePermission } = checkPermission;

async function isSuperAdmin(userId) {
    const pool = await getPool();
    const result = await pool.request()
        .input('id', sql.Int, userId)
        .query('SELECT is_super_admin FROM users WHERE id = @id');
    return result.recordset.length > 0 && result.recordset[0].is_super_admin === true;
}

async function bumpPermissionsVersionForRole(roleId, excludeUserId) {
    const pool = await getPool();
    const users = await pool.request()
        .input('role_id', sql.Int, roleId)
        .query('SELECT user_id FROM user_roles WHERE role_id = @role_id');
    let userIds = users.recordset.map(r => r.user_id);
    if (excludeUserId) userIds = userIds.filter(id => id !== excludeUserId);
    if (userIds.length === 0) return;
    const cases = userIds.map((_, i) => `WHEN id = @uid${i} THEN permissions_version + 1`).join(' ');
    const batch = pool.request();
    userIds.forEach((uid, i) => batch.input(`uid${i}`, sql.Int, uid));
    await batch.query(`UPDATE users SET permissions_version = CASE ${cases} ELSE permissions_version END WHERE id IN (${userIds.map((_, i) => `@uid${i}`).join(',')})`);
}

// check-permissions-version is public API (any authenticated user can poll)
router.get('/check-permissions-version', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request()
        .input('id', sql.Int, req.user.id)
        .query('SELECT permissions_version FROM users WHERE id = @id');
    const currentVersion = result.recordset[0]?.permissions_version || 0;
    res.json({ success: true, data: { clientVersion: parseInt(req.query.version) || 0, serverVersion: currentVersion, changed: (parseInt(req.query.version) || 0) !== currentVersion } });
}));

// All RBAC routes require granular permission management access
router.use(requirePermission('users.assign_permissions'));

const PROTECTED_PERMISSION_CODES = [
    'special.license_manage',
    'special.database_restore',
    'special.system_settings',
    'special.delete_journal',
    'special.reopen_period',
    'special.close_period',
    'users.roles'
];

router.get('/permissions', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request()
        .query('SELECT id, code, display_name, module, description FROM permissions ORDER BY module, id');
    res.json({ success: true, data: result.recordset });
}));

router.get('/permissions/grouped', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request()
        .query('SELECT id, code, display_name, module, description FROM permissions ORDER BY module, id');
    const grouped = {};
    for (const perm of result.recordset) {
        if (!grouped[perm.module]) grouped[perm.module] = [];
        grouped[perm.module].push(perm);
    }
    const totalCount = result.recordset.length;
    res.json({ success: true, data: grouped, totalPermissions: totalCount });
}));

router.get('/roles', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const total = await pool.request().query('SELECT COUNT(*) AS cnt FROM permissions');
    const totalPerms = total.recordset[0].cnt;
    const roles = await pool.request().query(`
        SELECT r.id, r.name, r.display_name, r.description, r.is_system, r.created_at,
               (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
        FROM roles r ORDER BY r.is_system DESC, r.id
    `);
    res.json({ success: true, data: roles.recordset, totalPermissions: totalPerms });
}));

router.post('/roles', asyncHandler(async (req, res) => {
    const { name, display_name, description } = req.body;
    if (!name || !display_name) {
        return res.status(400).json({ success: false, message: 'اسم الدور وعرضه مطلوبان' });
    }
    const pool = await getPool();
    const existing = await pool.request()
        .input('name', sql.NVarChar, name.trim().toLowerCase())
        .query('SELECT id FROM roles WHERE name = @name');
    if (existing.recordset.length > 0) {
        return res.status(400).json({ success: false, message: 'اسم الدور موجود بالفعل' });
    }
    const result = await pool.request()
        .input('name', sql.NVarChar, name.trim().toLowerCase())
        .input('display_name', sql.NVarChar, display_name)
        .input('description', sql.NVarChar, description || null)
        .query(`INSERT INTO roles (name, display_name, description) OUTPUT INSERTED.id VALUES (@name, @display_name, @description)`);
    logActivity(req, 'CREATE', 'roles', null, `Created role: ${name}`, null, { name, display_name, description }, 'SUCCESS', null);
    res.json({ success: true, message: 'تم إنشاء الدور', data: { id: result.recordset[0].id } });
}));

router.put('/roles/:id', asyncHandler(async (req, res) => {
    const { display_name, description } = req.body;
    const pool = await getPool();
    const role = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT * FROM roles WHERE id = @id');
    if (role.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'الدور غير موجود' });
    }
    if (role.recordset[0].is_system) {
        return res.status(400).json({ success: false, message: 'لا يمكن تعديل دور نظامي' });
    }
    await pool.request()
        .input('display_name', sql.NVarChar, display_name || role.recordset[0].display_name)
        .input('description', sql.NVarChar, description !== undefined ? description : role.recordset[0].description)
        .input('id', sql.Int, req.params.id)
        .query('UPDATE roles SET display_name = @display_name, description = @description WHERE id = @id');
    logActivity(req, 'UPDATE', 'roles', null, `Updated role ID: ${req.params.id}`, null, { display_name, description }, 'SUCCESS', null);
    res.json({ success: true, message: 'تم تحديث الدور' });
}));

router.delete('/roles/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const role = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT * FROM roles WHERE id = @id');
    if (role.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'الدور غير موجود' });
    }
    if (role.recordset[0].is_system) {
        return res.status(400).json({ success: false, message: 'لا يمكن حذف دور نظامي' });
    }
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('DELETE FROM role_permissions WHERE role_id = @id');
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('DELETE FROM user_roles WHERE role_id = @id');
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('DELETE FROM roles WHERE id = @id');
    logActivity(req, 'DELETE', 'roles', null, `Deleted role ID: ${req.params.id} (${role.recordset[0].name})`, null, null, 'SUCCESS', null);
    res.json({ success: true, message: 'تم حذف الدور' });
}));

router.get('/roles/:id/permissions', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT rp.permission_id, p.code, p.display_name, p.module FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = @id');
    res.json({ success: true, data: result.recordset.map(r => r.permission_id) });
}));

router.put('/roles/:id/permissions', asyncHandler(async (req, res) => {
    const { permission_ids } = req.body;
    if (!Array.isArray(permission_ids)) {
        return res.status(400).json({ success: false, message: 'مصفوفة الصلاحيات مطلوبة' });
    }
    const pool = await getPool();
    const role = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT * FROM roles WHERE id = @id');
    if (role.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'الدور غير موجود' });
    }
    if (role.recordset[0].name === 'super_admin' && !await isSuperAdmin(req.user.id)) {
        return res.status(403).json({ success: false, message: 'فقط مدير النظام يمكنه تعديل صلاحيات هذا الدور' });
    }

    const isSA = await isSuperAdmin(req.user.id);
    if (!isSA && permission_ids.length > 0) {
        const permCodes = await pool.request()
            .query(`SELECT id, code FROM permissions WHERE id IN (${permission_ids.join(',')})`);
        const protectedIds = permCodes.recordset
            .filter(p => PROTECTED_PERMISSION_CODES.includes(p.code))
            .map(p => p.id);
        if (protectedIds.length > 0) {
            const protectedNames = permCodes.recordset
                .filter(p => PROTECTED_PERMISSION_CODES.includes(p.code))
                .map(p => p.code).join(', ');
            return res.status(403).json({ success: false, message: 'لا يمكن إعطاء الصلاحيات المحمية: ' + protectedNames + '. هذه الصلاحيات مخصصة لمدير النظام فقط.' });
        }
    }

    const oldPerms = await pool.request()
        .input('role_id', sql.Int, req.params.id)
        .query('SELECT permission_id FROM role_permissions WHERE role_id = @role_id');
    const oldIds = oldPerms.recordset.map(r => r.permission_id);

    const transaction = pool.transaction();
    await transaction.begin();
    try {
        await transaction.request()
            .input('role_id', sql.Int, req.params.id)
            .query('DELETE FROM role_permissions WHERE role_id = @role_id');
        if (permission_ids.length > 0) {
            const batch = permission_ids.map((_, i) => `(@role_id, @pid${i})`).join(',');
            const reqBatch = transaction.request().input('role_id', sql.Int, req.params.id);
            permission_ids.forEach((pid, i) => reqBatch.input(`pid${i}`, sql.Int, pid));
            await reqBatch.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ${batch}`);
        }
        await transaction.commit();

        const added = permission_ids.filter(pid => !oldIds.includes(pid));
        const removed = oldIds.filter(pid => !permission_ids.includes(pid));
        if (added.length > 0 || removed.length > 0) {
            const permNames = await pool.request()
                .query(`SELECT id, code FROM permissions`);
            const nameMap = {};
            permNames.recordset.forEach(p => { nameMap[p.id] = p.code; });
            const details = {
                added: added.map(pid => nameMap[pid] || pid),
                removed: removed.map(pid => nameMap[pid] || pid)
            };
            await logActivity(req, 'UPDATE', 'roles', null, `Updated permissions for role ID: ${req.params.id}`, null, details, 'SUCCESS', null);
        }

        await bumpPermissionsVersionForRole(Number(req.params.id), req.user.id);
        res.json({ success: true, message: 'تم تحديث صلاحيات الدور', data: { added, removed } });
    } catch (e) {
        await transaction.rollback();
        throw e;
    }
}));

router.post('/roles/:id/clone', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const source = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT * FROM roles WHERE id = @id');
    if (source.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'الدور الأصلي غير موجود' });
    }
    const src = source.recordset[0];
    const baseName = src.name + '_clone';
    const cloneName = baseName + '_' + Date.now();
    const cloneDisplay = src.display_name + ' (نسخة)';

    const result = await pool.request()
        .input('name', sql.NVarChar, cloneName)
        .input('display_name', sql.NVarChar, cloneDisplay)
        .input('description', sql.NVarChar, (src.description || '') + ' (cloned from ' + src.name + ')')
        .query(`INSERT INTO roles (name, display_name, description) OUTPUT INSERTED.id VALUES (@name, @display_name, @description)`);
    const newId = result.recordset[0].id;

    const perms = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT permission_id FROM role_permissions WHERE role_id = @id');
    if (perms.recordset.length > 0) {
        const batch = perms.recordset.map((_, i) => `(@role_id, @pid${i})`).join(',');
        const reqBatch = pool.request().input('role_id', sql.Int, newId);
        perms.recordset.forEach((p, i) => reqBatch.input(`pid${i}`, sql.Int, p.permission_id));
        await reqBatch.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ${batch}`);
    }

    logActivity(req, 'CREATE', 'roles', null, `Cloned role: ${src.name} -> ${cloneName}`, newId, { source_id: req.params.id }, 'SUCCESS', null);
    res.json({ success: true, message: 'تم نسخ الدور', data: { id: newId, name: cloneName, display_name: cloneDisplay, permission_count: perms.recordset.length } });
}));

router.get('/roles/:id/history', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const role = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT name FROM roles WHERE id = @id');
    if (role.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'الدور غير موجود' });
    }
    const roleName = role.recordset[0].name;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const countResult = await pool.request()
        .input('target_type', sql.NVarChar, 'roles')
        .input('target_id', sql.Int, Number(req.params.id))
        .query("SELECT COUNT(*) AS total FROM user_audit_log WHERE target_type = @target_type AND (target_id = @target_id OR details LIKE '%' + @target_id + '%')");
    const total = countResult.recordset[0].total;

    const result = await pool.request()
        .input('target_type', sql.NVarChar, 'roles')
        .input('target_id', sql.Int, Number(req.params.id))
        .query(`
            SELECT * FROM user_audit_log
            WHERE target_type = @target_type AND (target_id = @target_id OR details LIKE '%' + @target_id + '%')
            ORDER BY created_at DESC
            OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
        `);

    res.json({
        success: true,
        data: result.recordset,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
}));

router.get('/roles/:id/export', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const role = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT id, name, display_name, description, is_system FROM roles WHERE id = @id');
    if (role.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'الدور غير موجود' });
    }
    const perms = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query(`SELECT p.code, p.display_name, p.module FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = @id ORDER BY p.module, p.code`);
    const exportData = {
        version: '1.0',
        exported_at: new Date().toISOString(),
        role: role.recordset[0],
        permissions: perms.recordset
    };
    res.json({ success: true, data: exportData });
}));

router.post('/roles/import', asyncHandler(async (req, res) => {
    const { role, permissions } = req.body;
    if (!role || !role.name || !role.display_name || !Array.isArray(permissions)) {
        return res.status(400).json({ success: false, message: 'بيانات غير صالحة. يجب توفير role.name, role.display_name, والمصفوفة permissions' });
    }
    const pool = await getPool();
    const existing = await pool.request()
        .input('name', sql.NVarChar, role.name)
        .query('SELECT id FROM roles WHERE name = @name');
    if (existing.recordset.length > 0) {
        return res.status(400).json({ success: false, message: 'دور بنفس الاسم موجود بالفعل' });
    }
    const codes = permissions.map(p => p.code);
    if (codes.length === 0) {
        return res.status(400).json({ success: false, message: 'لا توجد صلاحيات في ملف الاستيراد' });
    }
    const permResult = await pool.request()
        .query(`SELECT id, code FROM permissions WHERE code IN (${codes.map((_, i) => `@c${i}`).join(',')})`);
    codes.forEach((code, i) => permResult.input(`c${i}`, sql.NVarChar, code));
    const foundPerms = permResult.recordset;
    if (foundPerms.length === 0) {
        return res.status(400).json({ success: false, message: 'لم يتم العثور على أي صلاحية من الملف في النظام الحالي' });
    }

    const result = await pool.request()
        .input('name', sql.NVarChar, role.name)
        .input('display_name', sql.NVarChar, role.display_name)
        .input('description', sql.NVarChar, role.description || null)
        .query(`INSERT INTO roles (name, display_name, description) OUTPUT INSERTED.id VALUES (@name, @display_name, @description)`);
    const newId = result.recordset[0].id;

    const batch = foundPerms.map((_, i) => `(@rid, @pid${i})`).join(',');
    const reqBatch = pool.request().input('rid', sql.Int, newId);
    foundPerms.forEach((p, i) => reqBatch.input(`pid${i}`, sql.Int, p.id));
    await reqBatch.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ${batch}`);

    logActivity(req, 'CREATE', 'roles', null, `Imported role: ${role.name}`, newId, { source: 'import', codes: foundPerms.map(p => p.code) }, 'SUCCESS', null);
    res.json({ success: true, message: 'تم استيراد الدور بنجاح', data: { id: newId, name: role.name, display_name: role.display_name, permission_count: foundPerms.length } });
}));

router.get('/users/:id/permissions', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const userResult = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT id, username, full_name, is_super_admin FROM users WHERE id = @id');
    if (userResult.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
    const user = userResult.recordset[0];
    if (user.is_super_admin) {
        const allPerms = await pool.request().query('SELECT id, code, display_name, module FROM permissions ORDER BY module, id');
        return res.json({ success: true, data: { user, is_super_admin: true, permissions: allPerms.recordset, permission_ids: allPerms.recordset.map(p => p.id), roles: [] } });
    }
    const roles = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT r.id, r.name, r.display_name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = @id');
    const perms = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query(`SELECT DISTINCT p.id, p.code, p.display_name, p.module FROM permissions p
                JOIN role_permissions rp ON rp.permission_id = p.id
                JOIN user_roles ur ON ur.role_id = rp.role_id
                WHERE ur.user_id = @id ORDER BY p.module, p.id`);
    res.json({
        success: true,
        data: {
            user,
            is_super_admin: false,
            permissions: perms.recordset,
            permission_ids: perms.recordset.map(p => p.id),
            roles: roles.recordset
        }
    });
}));

router.get('/modules', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request()
        .query("SELECT DISTINCT module FROM permissions ORDER BY module");
    const modules = [];
    const moduleNames = {
        'dashboard': '\u0644\u0648\u062d\u0629 \u0627\u0644\u062a\u062d\u0643\u0645',
        'sales': '\u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a',
        'sales_returns': '\u0645\u0631\u062a\u062c\u0639\u0627\u062a \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a',
        'purchases': '\u0627\u0644\u0645\u0634\u062a\u0631\u064a\u0627\u062a',
        'purchase_returns': '\u0645\u0631\u062a\u062c\u0639\u0627\u062a \u0627\u0644\u0645\u0634\u062a\u0631\u064a\u0627\u062a',
        'customers': '\u0627\u0644\u0639\u0645\u0644\u0627\u0621',
        'collections': '\u0627\u0644\u062a\u062d\u0635\u064a\u0644\u0627\u062a',
        'suppliers': '\u0627\u0644\u0645\u0648\u0631\u062f\u064a\u0646',
        'payments': '\u0645\u062f\u0641\u0648\u0639\u0627\u062a \u0627\u0644\u0645\u0648\u0631\u062f\u064a\u0646',
        'products': '\u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a',
        'inventory': '\u0627\u0644\u0645\u062e\u0632\u0648\u0646',
        'stores': '\u0627\u0644\u0645\u062e\u0627\u0632\u0646',
        'reps': '\u0627\u0644\u0645\u0646\u062f\u0648\u0628\u064a\u0646',
        'treasury': '\u0627\u0644\u062e\u0632\u064a\u0646\u0629',
        'accounting': '\u0627\u0644\u0645\u062d\u0627\u0633\u0628\u0629',
        'accounts': '\u062f\u0644\u064a\u0644 \u0627\u0644\u062d\u0633\u0627\u0628\u0627\u062a',
        'reports': '\u0627\u0644\u062a\u0642\u0627\u0631\u064a\u0631',
        'users': '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645\u064a\u0646',
        'settings': '\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a',
        'logs': '\u0633\u062c\u0644 \u0627\u0644\u0639\u0645\u0644\u064a\u0627\u062a',
        'commission': '\u0627\u0644\u0639\u0645\u0648\u0644\u0627\u062a',
        'fiscal_periods': '\u0627\u0644\u0641\u062a\u0631\u0627\u062a \u0627\u0644\u0645\u0627\u0644\u064a\u0629',
        'hr': '\u0634\u0624\u0648\u0646 \u0627\u0644\u0645\u0648\u0638\u0641\u064a\u0646',
        'journals': '\u0642\u064a\u0648\u062f \u0627\u0644\u064a\u0648\u0645\u064a\u0629',
        'special': '\u0635\u0644\u0627\u062d\u064a\u0627\u062a \u062e\u0627\u0635\u0629'
    };
    for (const row of result.recordset) {
        modules.push({ module: row.module, display_name: moduleNames[row.module] || row.module });
    }
    res.json({ success: true, data: modules });
}));

router.get('/templates', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request()
        .query('SELECT id, name, display_name, description, is_system, permission_ids, created_at FROM role_templates ORDER BY is_system DESC, id');
    const data = result.recordset.map(t => ({
        ...t,
        permission_ids: t.permission_ids ? JSON.parse(t.permission_ids) : []
    }));
    res.json({ success: true, data });
}));

router.get('/templates/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT id, name, display_name, description, permission_ids FROM role_templates WHERE id = @id');
    if (result.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'القالب غير موجود' });
    }
    const t = result.recordset[0];
    t.permission_ids = t.permission_ids ? JSON.parse(t.permission_ids) : [];
    res.json({ success: true, data: t });
}));

router.post('/templates', asyncHandler(async (req, res) => {
    const { name, display_name, description, permission_ids } = req.body;
    if (!name || !display_name || !Array.isArray(permission_ids)) {
        return res.status(400).json({ success: false, message: 'الاسم وعرض القالب ومصفوفة الصلاحيات مطلوبة' });
    }
    const pool = await getPool();
    const existing = await pool.request()
        .input('name', sql.NVarChar, name.trim().toLowerCase())
        .query('SELECT id FROM role_templates WHERE name = @name');
    if (existing.recordset.length > 0) {
        return res.status(400).json({ success: false, message: 'اسم القالب موجود بالفعل' });
    }
    const result = await pool.request()
        .input('name', sql.NVarChar, name.trim().toLowerCase())
        .input('display_name', sql.NVarChar, display_name)
        .input('description', sql.NVarChar, description || null)
        .input('permission_ids', sql.NVarChar(sql.MAX), JSON.stringify(permission_ids))
        .query(`INSERT INTO role_templates (name, display_name, description, permission_ids) OUTPUT INSERTED.id VALUES (@name, @display_name, @description, @permission_ids)`);
    logActivity(req, 'CREATE', 'templates', null, `Created template: ${name}`, null, { name, display_name, permission_ids }, 'SUCCESS', null);
    res.json({ success: true, message: 'تم إنشاء القالب', data: { id: result.recordset[0].id } });
}));

router.put('/templates/:id', asyncHandler(async (req, res) => {
    const { display_name, description, permission_ids } = req.body;
    const pool = await getPool();
    const tpl = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT * FROM role_templates WHERE id = @id');
    if (tpl.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'القالب غير موجود' });
    }
    if (tpl.recordset[0].is_system) {
        return res.status(400).json({ success: false, message: 'لا يمكن تعديل قالب نظامي' });
    }
    await pool.request()
        .input('display_name', sql.NVarChar, display_name || tpl.recordset[0].display_name)
        .input('description', sql.NVarChar, description !== undefined ? description : tpl.recordset[0].description)
        .input('permission_ids', sql.NVarChar(sql.MAX), permission_ids ? JSON.stringify(permission_ids) : tpl.recordset[0].permission_ids)
        .input('id', sql.Int, req.params.id)
        .query('UPDATE role_templates SET display_name = @display_name, description = @description, permission_ids = @permission_ids WHERE id = @id');
    logActivity(req, 'UPDATE', 'templates', null, `Updated template ID: ${req.params.id}`, null, { display_name, permission_ids }, 'SUCCESS', null);
    res.json({ success: true, message: 'تم تحديث القالب' });
}));

router.delete('/templates/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const tpl = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT * FROM role_templates WHERE id = @id');
    if (tpl.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'القالب غير موجود' });
    }
    if (tpl.recordset[0].is_system) {
        return res.status(400).json({ success: false, message: 'لا يمكن حذف قالب نظامي' });
    }
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('DELETE FROM role_templates WHERE id = @id');
    logActivity(req, 'DELETE', 'templates', null, `Deleted template ID: ${req.params.id} (${tpl.recordset[0].name})`, null, null, 'SUCCESS', null);
    res.json({ success: true, message: 'تم حذف القالب' });
}));

router.post('/roles/:id/apply-template', asyncHandler(async (req, res) => {
    const { template_id } = req.body;
    if (!template_id) {
        return res.status(400).json({ success: false, message: 'معرف القالب مطلوب' });
    }
    const pool = await getPool();
    const role = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query('SELECT * FROM roles WHERE id = @id');
    if (role.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'الدور غير موجود' });
    }
    const tpl = await pool.request()
        .input('id', sql.Int, template_id)
        .query('SELECT permission_ids FROM role_templates WHERE id = @id');
    if (tpl.recordset.length === 0) {
        return res.status(404).json({ success: false, message: 'القالب غير موجود' });
    }
    const permissionIds = JSON.parse(tpl.recordset[0].permission_ids);
    const transaction = pool.transaction();
    await transaction.begin();
    try {
        await transaction.request()
            .input('role_id', sql.Int, req.params.id)
            .query('DELETE FROM role_permissions WHERE role_id = @role_id');
        if (permissionIds.length > 0) {
            const batch = permissionIds.map((_, i) => `(@role_id, @pid${i})`).join(',');
            const reqBatch = transaction.request().input('role_id', sql.Int, req.params.id);
            permissionIds.forEach((pid, i) => reqBatch.input(`pid${i}`, sql.Int, pid));
            await reqBatch.query(`INSERT INTO role_permissions (role_id, permission_id) VALUES ${batch}`);
        }
        await transaction.commit();
        await bumpPermissionsVersionForRole(Number(req.params.id), req.user.id);
        logActivity(req, 'UPDATE', 'roles', null, `Applied template ID: ${template_id} to role ID: ${req.params.id}`, null, { template_id, permission_ids: permissionIds }, 'SUCCESS', null);
        res.json({ success: true, message: 'تم تطبيق القالب على الدور', data: { applied_permissions: permissionIds.length } });
    } catch (e) {
        await transaction.rollback();
        throw e;
    }
}));

router.get('/audit-log', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const reqB = pool.request();
    let where = '';
    const conditions = [];
    if (req.query.target_type) {
        conditions.push('target_type = @target_type');
        reqB.input('target_type', sql.NVarChar, req.query.target_type);
    }
    if (req.query.action) {
        conditions.push('action = @action');
        reqB.input('action', sql.NVarChar, req.query.action);
    }
    if (req.query.target_id) {
        conditions.push('target_id = @target_id');
        reqB.input('target_id', sql.Int, parseInt(req.query.target_id));
    }
    if (conditions.length > 0) where = ' WHERE ' + conditions.join(' AND ');

    const countResult = await reqB.query(`SELECT COUNT(*) AS total FROM user_audit_log${where}`);
    const total = countResult.recordset[0].total;

    const result = await reqB.query(`
        SELECT * FROM user_audit_log${where}
        ORDER BY created_at DESC
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `);

    res.json({
        success: true,
        data: result.recordset,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
}));

router.get('/scopes/:userId', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request()
        .input('user_id', sql.Int, req.params.userId)
        .query('SELECT id, scope_type, scope_value FROM user_data_scopes WHERE user_id = @user_id ORDER BY scope_type');
    res.json({ success: true, data: result.recordset });
}));

router.put('/scopes/:userId', asyncHandler(async (req, res) => {
    const { scopes } = req.body;
    if (!Array.isArray(scopes)) {
        return res.status(400).json({ success: false, message: 'مصفوفة النطاقات مطلوبة' });
    }
    const pool = await getPool();
    const validTypes = ['company', 'branch', 'store', 'sales_rep', 'department'];
    for (const s of scopes) {
        if (!validTypes.includes(s.scope_type)) {
            return res.status(400).json({ success: false, message: `نطاق غير صالح: ${s.scope_type}` });
        }
    }
    const transaction = pool.transaction();
    await transaction.begin();
    try {
        await transaction.request()
            .input('user_id', sql.Int, req.params.userId)
            .query('DELETE FROM user_data_scopes WHERE user_id = @user_id');
        if (scopes.length > 0) {
            const batch = scopes.map((_, i) => `(@uid, @st${i}, @sv${i})`).join(',');
            const reqBatch = transaction.request().input('uid', sql.Int, req.params.userId);
            scopes.forEach((s, i) => {
                reqBatch.input(`st${i}`, sql.NVarChar(50), s.scope_type);
                reqBatch.input(`sv${i}`, sql.NVarChar(255), s.scope_value);
            });
            await reqBatch.query(`INSERT INTO user_data_scopes (user_id, scope_type, scope_value) VALUES ${batch}`);
        }
        await transaction.commit();
        logActivity(req, 'UPDATE', 'scopes', null, `Updated scopes for user ID: ${req.params.userId}`, null, { scopes }, 'SUCCESS', null);
        res.json({ success: true, message: 'تم تحديث نطاقات المستخدم' });
    } catch (e) {
        await transaction.rollback();
        throw e;
    }
}));

module.exports = router;
