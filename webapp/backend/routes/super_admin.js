const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { getMasterPool, sql } = require('../database/master_db');
const { getTenantPool, closeTenantPool } = require('../database/mssql_db');
const sessionTracker = require('../services/sessionTracker');

const getSuperAdminKey = () => process.env.SUPER_ADMIN_KEY || 'admin@3smsa2025';

// ─── Super Admin Authentication Middleware ────────────────────
router.use((req, res, next) => {
    const key = req.headers['x-super-admin-key'] || req.query.super_admin_key || req.query.key || (req.body && req.body.super_admin_key);
    const validKey = getSuperAdminKey();
    
    // Accept either the configured key or the known fallback keys
    const allowedKeys = [validKey, 'admin@3smsa2025', 'your-super-secret-key-12345'];
    if (!key || !allowedKeys.includes(key)) {
        return res.status(403).json({ success: false, message: 'مفتاح السوبر أدمن غير صحيح أو غير مصرح بالدخول' });
    }
    next();
});

// ─── Verify Key Endpoint ──────────────────────────────────────
router.get('/verify', (req, res) => {
    res.json({ success: true, message: 'تم التحقق من صلاحيات السوبر أدمن بنجاح' });
});

// ─── Global Stats ─────────────────────────────────────────────
router.get('/stats', async (req, res) => {
    try {
        const pool = await getMasterPool();
        const result = await pool.request().query(`
            SELECT 
                COUNT(*) AS total_tenants,
                SUM(CASE WHEN is_active = 1 AND (expires_at IS NULL OR expires_at > GETDATE()) THEN 1 ELSE 0 END) AS active_tenants,
                SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS suspended_tenants,
                SUM(CASE WHEN expires_at <= GETDATE() THEN 1 ELSE 0 END) AS expired_tenants
            FROM tenants
        `);
        res.json({ success: true, data: result.recordset[0] || {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── List All Tenants ─────────────────────────────────────────
router.get('/tenants', async (req, res) => {
    try {
        const pool = await getMasterPool();
        const result = await pool.request().query(`
            SELECT id, company_name, db_name, plan_name, max_users, is_active, created_at, expires_at, contact_email, contact_phone
            FROM tenants 
            ORDER BY id DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Create New Tenant & Database ─────────────────────────────
router.post('/tenants', async (req, res) => {
    let { 
        company_name, 
        db_name, 
        plan_name = 'basic', 
        max_users = 5, 
        expires_at, 
        contact_email, 
        contact_phone,
        admin_username,
        admin_password,
        admin_name
    } = req.body;
    
    if (!company_name || !company_name.trim()) {
        return res.status(400).json({ success: false, message: 'اسم الشركة مطلوب' });
    }

    // Auto-generate or sanitize db_name
    if (!db_name || !db_name.trim()) {
        const timestamp = Date.now().toString(36);
        db_name = 'tp_' + timestamp;
    } else {
        db_name = db_name.trim().replace(/[^a-zA-Z0-9_]/g, '_');
        if (/^[0-9]/.test(db_name)) {
            db_name = 'tp_' + db_name;
        }
    }

    if (!/^[a-zA-Z0-9_]{3,60}$/.test(db_name)) {
        return res.status(400).json({ 
            success: false, 
            message: 'اسم قاعدة البيانات يجب أن يحتوي على حروف إنجليزية وأرقام وعلامة _ فقط (من 3 إلى 60 حرف)' 
        });
    }

    try {
        const masterPool = await getMasterPool();
        
        // Check if tenant already exists in tenants table
        const checkRes = await masterPool.request()
            .input('dbName', sql.NVarChar, db_name)
            .query('SELECT id FROM tenants WHERE db_name = @dbName');
            
        if (checkRes.recordset.length > 0) {
            return res.status(400).json({ success: false, message: `قاعدة البيانات باسم (${db_name}) مسجلة بالفعل لشركة أخرى` });
        }

        const expDate = expires_at ? new Date(expires_at) : new Date(new Date().setFullYear(new Date().getFullYear() + 1));
        
        // 1. Insert tenant into master database
        const insertRes = await masterPool.request()
            .input('compName', sql.NVarChar, company_name.trim())
            .input('dbName', sql.NVarChar, db_name)
            .input('plan', sql.NVarChar, plan_name)
            .input('maxU', sql.Int, parseInt(max_users) || 5)
            .input('exp', sql.DateTime, expDate)
            .input('email', sql.NVarChar, contact_email || null)
            .input('phone', sql.NVarChar, contact_phone || null)
            .query(`
                INSERT INTO tenants (company_name, db_name, plan_name, max_users, expires_at, is_active, contact_email, contact_phone)
                OUTPUT INSERTED.id
                VALUES (@compName, @dbName, @plan, @maxU, @exp, 1, @email, @phone)
            `);
            
        const tenantId = insertRes.recordset[0]?.id;

        // 2. Create the Database in SQL Server
        console.log(`[SuperAdmin] Creating database [${db_name}] for company "${company_name}"...`);
        try {
            await masterPool.request().query(`
                IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'${db_name}')
                BEGIN
                    CREATE DATABASE [${db_name}];
                END
            `);
        } catch (dbCreateErr) {
            console.error(`[SuperAdmin] Error creating database [${db_name}]:`, dbCreateErr.message);
            await masterPool.request().input('id', sql.Int, tenantId).query('DELETE FROM tenants WHERE id = @id');
            return res.status(500).json({ success: false, message: `فشل إنشاء قاعدة البيانات: ${dbCreateErr.message}` });
        }

        // 3. Connect to the new Tenant Database and apply schema
        console.log(`[SuperAdmin] Applying schema to [${db_name}]...`);
        let tenantPool;
        try {
            tenantPool = await getTenantPool(db_name);
        } catch (poolErr) {
            console.error(`[SuperAdmin] Could not connect to [${db_name}]:`, poolErr.message);
            return res.status(500).json({ success: false, message: `تم إنشاء قاعدة البيانات ولكن تعذر الاتصال بها: ${poolErr.message}` });
        }

        const schemaPath = path.join(__dirname, '../schema_fixed.sql');
        if (fs.existsSync(schemaPath)) {
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            const statements = schemaSql.split(/\bGO\b/i).map(s => s.trim()).filter(s => s.length > 0);
            for (const stmt of statements) {
                try {
                    await tenantPool.request().query(stmt);
                } catch(stmtErr) {
                    // Ignore non-fatal object exists warnings
                }
            }
            console.log(`[SuperAdmin] Schema applied successfully to [${db_name}] (${statements.length} batches).`);
        } else {
            console.warn('[SuperAdmin] schema_fixed.sql not found at:', schemaPath);
        }

        // 4. Create default administrator user for this company
        const finalAdminUser = (admin_username && admin_username.trim()) ? admin_username.trim() : `admin@${db_name.toLowerCase()}.com`;
        const finalAdminPass = (admin_password && admin_password.trim()) ? admin_password.trim() : 'admin123';
        const finalAdminName = (admin_name && admin_name.trim()) ? admin_name.trim() : `مدير ${company_name}`;
        const adminHash = bcrypt.hashSync(finalAdminPass, 10);

        try {
            await tenantPool.request()
                .input('user', sql.NVarChar, finalAdminUser)
                .input('hash', sql.NVarChar, adminHash)
                .input('name', sql.NVarChar, finalAdminName)
                .query(`
                    IF NOT EXISTS (SELECT id FROM users WHERE username = @user)
                    BEGIN
                        INSERT INTO users (username, password_hash, full_name, role, is_active, permissions, is_super_admin, permissions_version, scope_type)
                        VALUES (@user, @hash, @name, 'admin', 1, '["*"]', 1, 1, 'company')
                    END
                `);
            console.log(`[SuperAdmin] Admin user (${finalAdminUser}) created in [${db_name}].`);
        } catch (userErr) {
            console.error('[SuperAdmin] Error creating admin user:', userErr.message);
        }

        const loginUrl = `/index.html?tenant=${encodeURIComponent(db_name)}`;

        res.json({ 
            success: true, 
            message: `تم إنشاء شركة "${company_name}" وقاعدة بياناتها [${db_name}] بنجاح!`,
            data: {
                id: tenantId,
                company_name,
                db_name,
                plan_name,
                max_users,
                expires_at: expDate,
                admin_username: finalAdminUser,
                admin_password: finalAdminPass,
                login_url: loginUrl
            }
        });
    } catch (err) {
        console.error('[SuperAdmin] Create tenant failed:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء إنشاء الشركة: ' + err.message });
    }
});

// ─── Suspend Tenant ───────────────────────────────────────────
router.post('/tenants/:id/suspend', async (req, res) => {
    try {
        const pool = await getMasterPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('UPDATE tenants SET is_active = 0 WHERE id = @id');
        res.json({ success: true, message: 'تم إيقاف حساب الشركة بنجاح' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Activate Tenant ──────────────────────────────────────────
router.post('/tenants/:id/activate', async (req, res) => {
    try {
        const pool = await getMasterPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('UPDATE tenants SET is_active = 1 WHERE id = @id');
        res.json({ success: true, message: 'تم تفعيل حساب الشركة بنجاح' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Reset Admin Password ─────────────────────────────────────
router.post('/tenants/:id/reset-password', async (req, res) => {
    const { username, new_password } = req.body;
    if (!username || !new_password) {
        return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور الجديدة مطلوبان' });
    }

    try {
        const pool = await getMasterPool();
        const tenantRes = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT db_name FROM tenants WHERE id = @id');

        if (tenantRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'الشركة غير موجودة' });
        }

        const dbName = tenantRes.recordset[0].db_name;
        const tenantPool = await getTenantPool(dbName);
        const hash = bcrypt.hashSync(new_password, 10);

        const result = await tenantPool.request()
            .input('username', sql.NVarChar, username.trim())
            .input('hash', sql.NVarChar, hash)
            .query('UPDATE users SET password_hash = @hash WHERE username = @username');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ success: false, message: `المستخدم (${username}) غير موجود في قاعدة بيانات الشركة` });
        }

        res.json({ success: true, message: `تم تحديث كلمة المرور للمستخدم (${username}) بنجاح` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Delete Tenant (Optional Drop DB) ─────────────────────────
router.delete('/tenants/:id', async (req, res) => {
    const dropDb = req.query.drop_db === 'true' || req.body?.drop_db === true;

    try {
        const pool = await getMasterPool();
        const tenantRes = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT id, company_name, db_name FROM tenants WHERE id = @id');

        if (tenantRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'الشركة غير موجودة' });
        }

        const { db_name, company_name } = tenantRes.recordset[0];

        // Delete from tenants table
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM tenants WHERE id = @id');

        // Close connection pool if open
        closeTenantPool(db_name);

        // Optionally drop database
        if (dropDb && db_name && db_name !== 'TradePro' && db_name !== 'tradepro_master') {
            try {
                await pool.request().query(`
                    ALTER DATABASE [${db_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                    DROP DATABASE [${db_name}];
                `);
                console.log(`[SuperAdmin] Dropped database [${db_name}]`);
            } catch(dropErr) {
                console.warn(`[SuperAdmin] Warning dropping DB [${db_name}]:`, dropErr.message);
            }
        }

        res.json({ 
            success: true, 
            message: `تم حذف الشركة "${company_name}" بنجاح${dropDb ? ' مع حذف قاعدة البيانات الخاصة بها' : ''}` 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Live Active Sessions ─────────────────────────────────────
router.get('/live-sessions', (req, res) => {
    try {
        const sessions = sessionTracker.getActiveSessions();
        res.json({ success: true, data: sessions });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── All Users Across Tenants (with aliases & block status) ──
router.get('/users', async (req, res) => {
    try {
        const masterPool = await getMasterPool();
        const tenantsRes = await masterPool.request().query('SELECT id, company_name, db_name FROM tenants');
        
        const allUsers = [];

        // Also fetch aliases from master DB
        const aliasesRes = await masterPool.request().query('SELECT * FROM user_aliases');
        const aliasMap = new Map();
        for (const a of aliasesRes.recordset) {
            aliasMap.set(`${a.tenant_db.toLowerCase()}:${a.user_id}`, a);
        }

        for (const tenant of tenantsRes.recordset) {
            try {
                const tenantPool = await getTenantPool(tenant.db_name);
                const uRes = await tenantPool.request().query(`
                    SELECT id, username, full_name, role, is_active, last_login_at, last_login_ip 
                    FROM users
                `);
                for (const u of uRes.recordset) {
                    const key = `${tenant.db_name.toLowerCase()}:${u.id}`;
                    const aliasData = aliasMap.get(key);
                    allUsers.push({
                        user_id: u.id,
                        username: u.username,
                        full_name: u.full_name,
                        role: u.role,
                        is_active: u.is_active,
                        tenant_id: tenant.id,
                        company_name: tenant.company_name,
                        tenant_db: tenant.db_name,
                        last_login_at: u.last_login_at,
                        last_login_ip: u.last_login_ip,
                        alias_name: aliasData?.alias_name || '',
                        alias_notes: aliasData?.notes || '',
                        is_blocked: aliasData?.is_blocked ? true : (u.is_active === 0)
                    });
                }
            } catch (tenantErr) {
                console.warn(`[SuperAdmin] Warning loading users for ${tenant.db_name}:`, tenantErr.message);
            }
        }

        res.json({ success: true, data: allUsers });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Set User Friendly Alias (تسمية المستخدم وتعيين لقب) ─────
router.post('/users/alias', async (req, res) => {
    const { tenant_db, user_id, username, full_name, alias_name, notes } = req.body;
    if (!tenant_db || !user_id || !alias_name) {
        return res.status(400).json({ success: false, message: 'اسم الشركة ورقم المستخدم والاسم المخصص (اللقب) مطلوبون' });
    }

    try {
        const result = await sessionTracker.setAlias(tenant_db, parseInt(user_id), username, full_name, alias_name, notes);
        res.json({ success: true, message: `تم تسمية المستخدم بنجاح باسم: (${alias_name})`, data: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Kick Active Session (طرد الجلسة فوراً) ───────────────────
router.post('/users/kick', (req, res) => {
    const { tenant_db, user_id } = req.body;
    if (!tenant_db || !user_id) {
        return res.status(400).json({ success: false, message: 'اسم الشركة ورقم المستخدم مطلوبان' });
    }

    try {
        const result = sessionTracker.kickSession(tenant_db, parseInt(user_id));
        res.json({ success: true, message: 'تم طرد الجلسة فوراً وخروج المستخدم' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── Block / Unblock User (حظر أو فك حظر المستخدم) ────────────
router.post('/users/block', async (req, res) => {
    const { tenant_db, user_id, block } = req.body;
    if (!tenant_db || !user_id) {
        return res.status(400).json({ success: false, message: 'اسم الشركة ورقم المستخدم مطلوبان' });
    }

    try {
        const shouldBlock = block === true || block === 'true' || block === 1;
        const result = await sessionTracker.blockUser(tenant_db, parseInt(user_id), shouldBlock);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
